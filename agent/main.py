import os
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

# Load .env from the directory where main.py lives, regardless of cwd
_HERE = Path(__file__).parent
load_dotenv(_HERE / ".env")

import db
from orchestrator import Orchestrator
from whatsapp import WhatsAppClient
from db import get_tenant_by_instance
from monitor import MonitorScheduler
from mcp.manager import MCPManager
from scheduler import scheduler as auto_scheduler, start_scheduler as start_auto_scheduler

# Singleton instances (must be before lifespan)
orchestrator = Orchestrator()
whatsapp_client = WhatsAppClient()
scheduler = MonitorScheduler()
mcp_manager = MCPManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging

    # Initialize shared DB connection pool (used by db.py)
    try:
        await db.init_pool(min_size=2, max_size=10)
    except Exception as e:
        logging.warning(f"[startup] DB pool init failed: {e}")

    # Initialize RAG pool (shares same DB, separate pool for vector ops)
    from memory import rag as rag_module
    db_url = os.getenv("DATABASE_URL", "")
    if db_url:
        try:
            import asyncpg
            rag_module._pool = await asyncpg.create_pool(db_url, min_size=2, max_size=8)
            logging.info("[startup] RAG asyncpg pool initialized")
        except Exception as e:
            logging.warning(f"[startup] RAG pool init failed: {e}")

    # Load MCP drivers from DB and run initial health checks
    try:
        await mcp_manager.load_from_db()
        logging.info(f"[startup] MCP drivers loaded: {len(mcp_manager._drivers)} registered")
    except Exception as e:
        logging.warning(f"[startup] MCP driver loading failed: {e}")

    scheduler.start()
    start_auto_scheduler()
    yield
    scheduler.stop()
    auto_scheduler.shutdown()

    # Close pools and MCP manager gracefully
    await mcp_manager.close()
    await db.close_pool()
    if getattr(rag_module, "_pool", None):
        await rag_module._pool.close()



app = FastAPI(title="NetAgent Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("API_URL", "http://localhost:4000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

def normalize_phone(raw: str) -> str:
    """
    Normalize Brazilian WhatsApp numbers to DDD + 9-digit format (11 digits).
    Handles any format users might enter: +5511999999999, 5511999999999,
    11999999999, 11 99999-9999, etc.
    Also handles Evolution API format (may include or omit country code, may have 8-digit number).

    Examples:
      5555999493554  → 55999493554  (removes country 55, DDD 55, adds 9 if 8 digits)
      555599493554   → 5599493554   → 55999493554 (country 55 + DDD 55 + 8 digits → add 9)
      5511987654321  → 11987654321
      11987654321    → 11987654321
      1187654321     → 11987654321  (8 digits → add 9)
    """
    import re
    phone = re.sub(r'\D', '', raw)

    # Remove country code 55 if present and number is longer than 11 digits
    if phone.startswith('55') and len(phone) > 11:
        phone = phone[2:]

    ddd = phone[:2]
    numero = phone[2:]

    # Add 9th digit if number part is 8 digits (older format)
    if len(numero) == 8:
        numero = '9' + numero

    return ddd + numero


# ── Models ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    tenant_slug: str
    tenant_schema: Optional[str] = None   # DB schema = socket room key (may differ from slug)
    conversation_id: str
    message: str
    device_id: Optional[str] = None
    channel: str = "web"
    user_id: Optional[str] = None


class WebhookPayload(BaseModel):
    """Evolution API v2 sends: {instance: str, data: dict, event: str, ...}"""
    model_config = {"extra": "allow"}  # accept any extra fields from v2
    instance: Optional[str] = None
    data: Optional[dict] = None
    event: Optional[str] = None


class SkillConvertRequest(BaseModel):
    script: str
    name: str
    display_name: str
    description: str
    category: str = "install"
    device_type: str = "linux"
    tenant_slug: str  # used to retrieve LLM settings


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "service": "netagent-agent"}


@app.get("/mcp/status")
def mcp_status():
    """Return MCP driver registry and circuit breaker states."""
    return {
        "drivers": mcp_manager.list_drivers(),
        "circuits": mcp_manager.get_circuit_status(),
    }


@app.post("/skills/convert")
async def skills_convert(req: SkillConvertRequest):
    """
    Convert a bash script into structured skill steps and store in public.skills.
    Uses the tenant's configured LLM provider.
    """
    try:
        from skill_converter import parse_bash_to_steps
        settings = await db.get_tenant_settings(req.tenant_slug)
        provider = settings.get("llm_provider", "openai")
        api_key = settings.get("llm_api_key_decrypted") or os.getenv("OPENAI_KEY")

        steps = await parse_bash_to_steps(req.script, api_key=api_key, provider=provider)
        skill_id = await db.save_skill(
            name=req.name,
            display_name=req.display_name,
            description=req.description,
            category=req.category,
            device_type=req.device_type,
            steps=steps,
        )
        return {"id": skill_id, "name": req.name, "steps": steps, "total": len(steps)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat(req: ChatRequest):
    """Called by the Node.js API when a web chat message arrives."""
    try:
        result = await orchestrator.process(
            tenant_slug=req.tenant_slug,
            tenant_schema=req.tenant_schema or req.tenant_slug,
            conversation_id=req.conversation_id,
            message=req.message,
            device_id=req.device_id,
            channel=req.channel,
            user_id=req.user_id,
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e) or repr(e))


@app.post("/webhook")
async def webhook(request: Request, background_tasks: BackgroundTasks):
    """Receives WhatsApp messages from Evolution API v2."""
    import logging
    body = await request.json()
    logging.warning(f"[WEBHOOK] received: instance={body.get('instance')} event={body.get('event')} type={body.get('data', {}).get('messageType') if isinstance(body.get('data'), dict) else 'n/a'}")

    instance_name = body.get("instance")
    data = body.get("data", {})
    event = body.get("event", "")

    # Filter: only process incoming messages (not sent by us)
    # Evolution v2 sends 'messages.upsert', v1 sent 'MESSAGES_UPSERT' — normalize both
    event_normalized = event.upper().replace(".", "_") if event else ""
    if event_normalized and "MESSAGES_UPSERT" not in event_normalized:
        return {"ok": True, "reason": f"ignored event: {event}"}

    # Also check messageType if no event field
    msg_type = data.get("messageType") if isinstance(data, dict) else None
    if not msg_type:
        msg_type = data.get("message", {}).get("messageType") if isinstance(data, dict) else None

    if msg_type and msg_type not in ("conversation", "extendedTextMessage", "audioMessage"):
        return {"ok": True, "reason": f"ignored type: {msg_type}"}

    if not instance_name:
        logging.warning("[WEBHOOK] no instance in payload")
        return {"ok": True, "reason": "no instance"}

    # Identify tenant by Evolution instance name
    tenant = await get_tenant_by_instance(instance_name)
    if not tenant:
        logging.warning(f"[WEBHOOK] tenant not found for instance: {instance_name}")
        return {"ok": True, "reason": "tenant not found"}

    # Process in background to return 200 quickly to Evolution
    background_tasks.add_task(
        _process_whatsapp_message,
        tenant=tenant,
        data=data,
    )

    return {"ok": True}


async def _process_whatsapp_message(tenant: dict, data: dict):
    """Processes an incoming WhatsApp message in the background."""
    import logging
    # Evolution v2 payload: data.key.remoteJid or data.key.id
    key = data.get("key", {})
    remote_jid = key.get("remoteJid", "")
    from_me = key.get("fromMe", False)
    # Normalize number: removes country code 55, adds 9 digit if 8-digit number
    number = normalize_phone(remote_jid.replace("@s.whatsapp.net", "").replace("@g.us", ""))
    number_with_country = "55" + number  # stored format may include country code

    message_text = data.get("message", {}).get("conversation") or \
                   data.get("message", {}).get("extendedTextMessage", {}).get("text", "")

    logging.warning(f"[WA] from_me={from_me} number={number!r} text={message_text!r}")

    # Ignore messages sent by us
    if from_me:
        return

    # Handle audio transcription
    # messageType can be at root (data.messageType) or nested — check both
    msg_type_effective = (
        data.get("messageType")
        or (data.get("message") or {}).get("messageType")
        or ""
    )
    if msg_type_effective == "audioMessage":
        # Evolution v2: base64 may NOT be in payload — fetch via API
        audio_b64 = (
            data.get("message", {}).get("audioMessage", {}).get("base64")
            or data.get("message", {}).get("base64")
            or data.get("base64")
        )
        if not audio_b64:
            # Fetch base64 from Evolution API using the message key
            audio_b64 = await whatsapp_client.get_media_base64(
                instance=tenant["evolution_instance"],
                api_key=tenant["evolution_key"],
                message_key=data.get("key", {}),
            )
        if audio_b64:
            from tools.audio_tools import transcribe_audio
            transcribed = await transcribe_audio(audio_b64)
            logging.warning(f"[WA] audio transcribed: {transcribed!r}")
            if transcribed and not transcribed.startswith("[Erro"):
                message_text = transcribed
        else:
            logging.warning("[WA] audio: could not get base64 — skipping")
            return

    if not message_text or not number:
        return

    # Check if this WhatsApp number is authorized
    whatsapp_user = await db.get_whatsapp_user(tenant["slug"], number)
    logging.warning(f"[WA] user_found={whatsapp_user is not None} tenant={tenant['slug']!r}")
    if not whatsapp_user:
        await whatsapp_client.send_message(
            instance=tenant["evolution_instance"],
            api_key=tenant["evolution_key"],
            number=number,
            text=(
                "⚠️ *Acesso não autorizado.*\n\n"
                "Seu número não está cadastrado para usar o NetAgent.\n"
                "Entre em contato com o administrador para solicitar acesso."
            )
        )
        return

    try:
        # Get conversation ID (creates one if first message)
        conv_id = await db.get_or_create_whatsapp_conversation(tenant["slug"], number)

        # Save user message to DB so history is available next turn
        await db.save_message(tenant["slug"], conv_id, "user", message_text)

        logging.warning(f"[WA] calling orchestrator tenant={tenant['slug']!r} conv={conv_id} msg={message_text!r}")
        result = await orchestrator.process(
            tenant_slug=tenant["slug"],
            conversation_id=conv_id,
            message=message_text,
            channel="whatsapp",
            whatsapp_number=number,
        )
        reply = result["response"]
        logging.warning(f"[WA] reply: {reply[:80]!r}")

        # Save assistant response to DB for future context
        await db.save_message(
            tenant["slug"], conv_id, "assistant", reply,
            device_id=result.get("resolved_device_id"),
            tool_calls=result.get("tool_calls", []),
            tokens_used=result.get("tokens_used", 0),
        )

        await whatsapp_client.send_message(
            instance=tenant["evolution_instance"],
            api_key=tenant["evolution_key"],
            number=number,
            text=reply,
        )
        logging.warning("[WA] sent ✅")
    except Exception as exc:
        import traceback
        logging.error(f"[WA] EXCEPTION: {exc}")
        logging.error(traceback.format_exc())



# ── Startup / Shutdown via lifespan (see top of file) ────────────────────────


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("AGENT_PORT", 8000)),
        reload=os.getenv("NODE_ENV") != "production",
    )
