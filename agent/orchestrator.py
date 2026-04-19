"""
orchestrator.py — Multi-agent LangGraph orchestrator for NetAgent.

Graph topology:
  load_context → search_rag → route_intent → run_specialists → synthesize
                                                                     ↓ (if propose_action)
                                                             handle_approval → END

Key improvements over previous single-node design:
  - Each specialist agent runs in its own LangGraph node with exclusive persona + tools
  - Intent router selects 1–3 specialist agents based on message + device type
  - propose_action is detected via __pending_action__ key (not fragile string search)
  - RAG supports tenant provider (Gemini or OpenAI)
  - Skills from DB become real executable tools via SkillExecutor
  - BaseTools eliminates duplicated code between Linux/MikroTik handlers
"""

import os
import json
import re
import asyncio
import logging
from typing import Optional, TypedDict, Annotated
import operator

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langgraph.graph import StateGraph, END

import db
from memory.rag import search_knowledge
from tools.linux_tools import LinuxTools
from tools.mikrotik_tools import MikroTikTools
from tools.skill_executor import build_skill_tools
from services.encryption_service import decrypt_password
from mcp.observability import logger as obs_logger, metrics as obs_metrics, PhaseTimer
from mcp.tool_bridge import mcp_tools_to_langchain


# ── Agent Mode Config ─────────────────────────────────────────────────────────

AGENT_MODE_CONFIG = {
    "restricted": {
        "label": "🔒 Restrito",
        "instructions": (
            "- MONITORAMENTO E DIAGNÓSTICO: execute IMEDIATAMENTE sem pedir aprovação\n"
            "- Comandos de leitura (get_*, fingerprint_device, run_command com df/ip/ss/ps): EXECUTE JÁ\n"
            "- Ações que MODIFICAM o sistema: use `propose_action`\n"
            "- Ações destrutivas: use `propose_action`\n"
            "- NUNCA explique um comando. Execute-o e mostre o resultado."
        ),
    },
    "standard": {
        "label": "⚡ Standard",
        "instructions": (
            "- Comandos de leitura e diagnóstico: EXECUTE IMEDIATAMENTE\n"
            "- Instalações, reinicializações, mudanças de configuração: use `propose_action`\n"
            "- Ações destrutivas: SEMPRE use `propose_action`\n"
            "- NUNCA explique um comando. Execute-o e mostre o resultado."
        ),
    },
    "root": {
        "label": "🔓 Root",
        "instructions": (
            "- Confiança total: execute qualquer comando diretamente\n"
            "- Use `propose_action` apenas para ações de altíssimo risco (apagar disco, mudar senha root)\n"
            "- NUNCA explique um comando. Execute-o e mostre o resultado."
        ),
    },
}

FORMAT_HINTS = {
    "whatsapp": (
        "- Use *negrito*, listas com •, e emojis para o WhatsApp\n"
        "- NÃO RESUMA DADOS TÉCNICOS. Se executar um ping, traceroute, log ou firewall, envie o log/resultado COMPLETO na resposta.\n"
        "- NUNCA instrua o usuário a executar comandos no terminal dele. Execute e mostre-lhe apenas os RESULTADOS."
    ),
    "web": (
        "- Pode usar Markdown completo: **negrito**, ```código```, tabelas, headers\n"
        "- NUNCA explique como executar. Execute e mostre o resultado."
    ),
}

# ── Agent Persona Directory ───────────────────────────────────────────────────

_AGENTS_DIR = os.path.join(os.path.dirname(__file__), "agents")

# Default persona per device type (used when no intent match)
AGENT_PERSONAS = {
    "mikrotik": "mikrotik-expert.md",
    "linux": "linux-infra.md",
    "default": "network-orchestrator.md",
}

# Intent routing: message keywords → specialist agent
INTENT_ROUTES = [
    {
        "agent": "network-security.md",
        "keywords": [
            "segurança", "security", "auditoria", "audit", "vulnerabilidade",
            "firewall", "porta aberta", "open port", "brute force", "invasão",
            "ataque", "pentest", "scan de porta", "teste de segurança",
            "ssh exposto", "acesso não autorizado", "log de falha",
        ],
        "mcp_scopes": ["firewall", "system", "network"],
    },
    {
        "agent": "incident-responder.md",
        "keywords": [
            "caiu", "caindo", "offline", "fora do ar", "down", "sem acesso",
            "não responde", "inacessível", "serviço parou", "travado",
            "lento demais", "perda de pacote", "timeout", "sem internet",
            "cliente sem acesso", "incidente",
        ],
        "mcp_scopes": ["system", "interfaces", "services", "network", "logs"],
    },
    {
        "agent": "capacity-planner.md",
        "keywords": [
            "capacidade", "crescimento", "tendência", "projeção", "satura",
            "disco cheio", "disco full", "vai encher", "planejamento",
            "quanto tempo", "previsão", "histórico de uso",
        ],
        "mcp_scopes": ["system", "storage", "interfaces"],
    },
    {
        "agent": "config-auditor.md",
        "keywords": [
            "auditoria de config", "config audit", "desvio", "baseline",
            "configuração inconsistente", "running vs saved", "drift",
            "comparar config", "revisar configuração",
        ],
        "mcp_scopes": ["system", "firewall", "routing", "interfaces"],
    },
    {
        "agent": "network-monitor.md",
        "keywords": [
            "monitorar", "monitoramento", "status", "métricas", "dashboard",
            "uptime", "disponibilidade", "tempo de resposta", "latência",
            "throughput", "tráfego",
        ],
        "mcp_scopes": ["system", "interfaces", "network"],
    },
    {
        "agent": "mikrotik-expert.md",
        "keywords": [
            "bgp", "ospf", "pppoe", "hotspot", "routeros", "queue", "qos",
            "vlan", "bridge", "mpls", "ldp", "mangle", "winbox", "mikrotik",
            "dhcp", "tunnel", "wireguard", "vpn", "backup", "arquivo", "file", "export",
            "ip", "rota", "route", "dns", "log", "ping", "user", "reboot", "rebootar",
            "openvpn", "ovpn", "comando", "command", "cli", "terminal", "raw", "traffico", "traffic", "torch", "traceroute", "macro", "workflow",
            "pcc", "load balance", "link", "failover", "dual wan"
        ],
        "mcp_scopes": ["routing", "pppoe", "hotspot", "queues", "queue", "firewall", "interfaces", "system", "bridge", "vlan", "tunnel", "wireguard", "dhcp", "file", "ip", "route", "dns", "user", "log", "diagnostic", "openvpn", "ovpn", "mangle", "raw", "connection", "workflow"],
    },
]


def _read_agent_file(fname: str) -> str:
    """Read agent .md file and strip YAML frontmatter."""
    path = os.path.join(_AGENTS_DIR, fname)
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if content.startswith("---"):
            end = content.find("---", 3)
            content = content[end + 3:].strip() if end != -1 else content
        return content
    except FileNotFoundError:
        return ""


def _select_agents(device_type: str, user_message: str) -> tuple[list[str], list[str]]:
    """
    Select specialist agent file names and MCP scopes for this request.
    Intent-based routing first; device-type fallback.
    Returns (agent_files, mcp_scopes).
    """
    msg_lower = (user_message or "").lower()
    matched = []
    scopes = set()

    for route in INTENT_ROUTES:
        if any(kw in msg_lower for kw in route["keywords"]):
            agent_file = route["agent"]
            if agent_file not in matched:
                matched.append(agent_file)
                scopes.update(route.get("mcp_scopes", []))
            if len(matched) >= 2:
                break

    if not matched:
        fallback = AGENT_PERSONAS.get((device_type or "").lower(), AGENT_PERSONAS["default"])
        matched = [fallback]
        # Default scopes based on device type
        if device_type == "mikrotik":
            scopes.update(["system", "interfaces", "routing", "firewall", "bridge", "vlan", "tunnel", "wireguard", "dhcp", "hotspot", "pppoe", "queues", "queue", "file", "ip", "route", "dns", "user", "log", "diagnostic", "openvpn", "ovpn", "mangle", "raw", "connection", "workflow"])
        elif device_type == "linux":
            scopes.update(["system", "network", "services", "storage"])
        else:
            scopes.update(["system"])

    return matched, sorted(scopes)


# ── LLM Builder ───────────────────────────────────────────────────────────────

def _build_llm(settings: dict, tenant: dict):
    """Build LLM instance from tenant settings, falling back to env vars."""
    provider = settings.get("llm_provider", "").strip()
    model = settings.get("llm_model", "").strip()

    if provider == "gemini":
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            api_key = settings.get("llm_api_key_decrypted") or os.getenv("GOOGLE_API_KEY", "")
            return ChatGoogleGenerativeAI(
                model=model or "gemini-2.0-flash",
                google_api_key=api_key,
                temperature=0,
            )
        except ImportError:
            pass

    api_key = settings.get("llm_api_key_decrypted") or os.getenv("OPENAI_KEY", "")
    chosen_model = model or tenant.get("gpt_model") or "gpt-4o"
    return ChatOpenAI(model=chosen_model, api_key=api_key, temperature=0)


def _get_rag_provider(settings: dict) -> tuple[str, Optional[str]]:
    """Return (provider, api_key) for RAG embeddings matching the tenant's LLM."""
    provider = settings.get("llm_provider", "openai").strip()
    api_key = settings.get("llm_api_key_decrypted")
    return provider, api_key


# ── Snapshot Formatter ────────────────────────────────────────────────────────

def _format_snapshot(snapshot: Optional[dict]) -> str:
    if not snapshot:
        return "Nenhum snapshot disponível. Use `system_fingerprint` para coletar o estado atual."
    captured = snapshot.get("captured_at", "")
    if hasattr(captured, "strftime"):
        captured = captured.strftime("%d/%m/%Y %H:%M")
    parts = [f"*Capturado em: {captured}*"]
    if snapshot.get("os_info"):
        parts.append(f"**OS:** {snapshot['os_info'][:200]}")
    if snapshot.get("disk_info"):
        parts.append(f"**Disco:** {snapshot['disk_info'][:200]}")
    services = snapshot.get("services") or []
    if services:
        parts.append(f"**Serviços:** {', '.join(str(s) for s in services[:10])}")
    pkgs = snapshot.get("installed_pkgs") or []
    if pkgs:
        parts.append(f"**Pacotes relevantes:** {', '.join(str(p) for p in pkgs[:15])}")
    ports = snapshot.get("open_ports") or []
    if ports:
        parts.append(f"**Portas abertas:** {', '.join(str(p) for p in ports[:10])}")
    if snapshot.get("notes"):
        parts.append(f"**Notas:** {snapshot['notes']}")
    return "\n".join(parts)


def _format_skills_context(skills: list) -> str:
    if not skills:
        return "Nenhuma skill ativa."
    lines = []
    for s in skills:
        lines.append(f"**{s['display_name']}** (`{s['name']}`)")
        lines.append(f"  Categoria: {s['category']} | Dispositivo: {s.get('device_type') or 'qualquer'}")
        lines.append(f"  {s['description']}")
        steps = s.get("steps") or []
        if isinstance(steps, str):
            try:
                steps = json.loads(steps)
            except Exception:
                steps = []
        for step in steps:
            if not isinstance(step, dict):
                continue
            label = step.get("label", "Passo")
            cmds = step.get("commands", [])
            preview = ", ".join(str(c) for c in cmds[:2])
            lines.append(f"  📌 {label}: `{preview}`{'...' if len(cmds) > 2 else ''}")
        lines.append("")
    return "\n".join(lines)


# ── WhatsApp Formatter ────────────────────────────────────────────────────────

def _normalize_for_whatsapp(text: str) -> str:
    """Convert Markdown to WhatsApp-friendly format."""
    text = re.sub(r"\*\*(.+?)\*\*", r"*\1*", text)
    text = re.sub(r"```[\w]*\n?", "", text)
    return text


# ── State ─────────────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    # Core request context
    tenant_slug: str
    tenant_schema: str              # DB schema = socket room key (may differ from slug)
    conversation_id: str
    channel: str
    user_message: str

    # Device context
    device_id: Optional[str]
    device_info: Optional[dict]
    device_snapshot: Optional[dict]

    # Conversation context
    history: list

    # Memory tiers
    knowledge: str           # long-term: RAG semantic search result
    tenant_memories: str     # medium-term: Semantic preferences for this tenant/device
    operational_memory: list  # operational: recent device_history entries

    # Agent configuration
    agent_mode: str
    tenant_settings: dict
    skills: list

    # Routing
    selected_agents: list  # agent file names selected by route_intent

    # Per-specialist results [{agent, response, tool_calls, reasoning}]
    agent_results: list

    # Final output
    response: str
    tool_calls: list
    reasoning: list
    tokens_used: int

    # Approval flow
    requires_approval: bool
    approval_data: Optional[dict]


# ── Orchestrator ──────────────────────────────────────────────────────────────

class Orchestrator:
    def __init__(self):
        self.graph = self._build_graph()
        self._http_client = None  # lazy init async client

    async def _get_http_client(self):
        """Lazy-init shared async HTTP client for phase emissions."""
        if self._http_client is None:
            import httpx
            self._http_client = httpx.AsyncClient(timeout=3.0)
        return self._http_client

    async def _async_emit(self, state: dict, event: str, payload: dict):
        """Emit a socket event to the Node.js API (non-blocking)."""
        tenant = state.get("tenant_slug", "")
        api_url = os.getenv("API_URL", "http://localhost:4000")
        internal_secret = os.getenv("INTERNAL_API_SECRET", "")
        try:
            client = await self._get_http_client()
            await client.post(
                f"{api_url}/internal/emit",
                headers={"x-internal-secret": internal_secret},
                json={"tenant": tenant, "event": event, "data": payload},
            )
        except Exception as exc:
            obs_logger.error("async_emit_failed", event=event, error=str(exc))

    def _build_graph(self) -> StateGraph:
        g = StateGraph(AgentState)
        g.add_node("load_context", self._load_context)
        g.add_node("search_rag", self._search_rag)
        g.add_node("route_intent", self._route_intent)
        g.add_node("run_specialists", self._run_specialists)
        g.add_node("synthesize", self._synthesize)

        g.set_entry_point("load_context")
        g.add_edge("load_context", "search_rag")
        g.add_edge("search_rag", "route_intent")
        g.add_edge("route_intent", "run_specialists")
        g.add_edge("run_specialists", "synthesize")
        g.add_edge("synthesize", END)
        return g.compile()

    async def process(
        self,
        tenant_slug: str,
        conversation_id: Optional[str],
        message: str,
        tenant_schema: str = "",
        channel: str = "web",
        device_id: Optional[str] = None,
        whatsapp_number: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        if not conversation_id:
            conversation_id = await db.get_or_create_whatsapp_conversation(
                tenant_slug, whatsapp_number
            )

        initial_state = AgentState(
            tenant_slug=tenant_slug,
            tenant_schema=tenant_schema or tenant_slug,
            conversation_id=conversation_id,
            channel=channel,
            user_message=message,
            device_id=device_id,
            device_info=None,
            device_snapshot=None,
            history=[],
            knowledge="",
            operational_memory=[],
            agent_mode="restricted",
            tenant_settings={},
            skills=[],
            selected_agents=[],
            agent_results=[],
            response="",
            tool_calls=[],
            reasoning=[],
            tokens_used=0,
            requires_approval=False,
            approval_data=None,
        )

        result = await self.graph.ainvoke(initial_state)
        return {
            "response": result["response"],
            "tool_calls": result["tool_calls"],
            "reasoning": result["reasoning"],
            "tokens_used": result["tokens_used"],
            "pending_action": result.get("approval_data"),
            "resolved_device_id": result.get("device_id"),  # detected during this request
        }

    # ── Node: load_context ────────────────────────────────────────────────────

    async def _load_context(self, state: AgentState) -> AgentState:
        """Load all memory tiers concurrently:
        - Short-term: last N conversation messages
        - Operational: device info, snapshot, recent metric history
        - Long-term semantic RAG: searched in _search_rag node
        """
        with PhaseTimer("load_context", tenant=state["tenant_slug"], conv=state["conversation_id"]):
            # Emit phase start
            await self._async_emit(state, "agent:phase", {
                "conversationId": state["conversation_id"],
                "phase": "loading_context",
                "status": "running",
            })
            await self._async_emit(state, "agent:system_log", {
                "conversationId": state["conversation_id"],
                "log": "🔍 Lendo histórico da conversa e carregando contexto do banco de dados..."
            })

            # ── 1. Short-term: conversation history ──────────────────────────
            history = await db.get_recent_messages(state["tenant_slug"], state["conversation_id"])
            state["history"] = history

            # ── 2. Settings + skills (parallel) ─────────────────────────────
            settings, skills = await asyncio.gather(
                db.get_tenant_settings(state["tenant_slug"]),
                db.get_tenant_skills(state["tenant_slug"]),
            )

            encrypted_key = await db.get_encrypted_setting(state["tenant_slug"], "llm_api_key")
            if encrypted_key:
                try:
                    settings["llm_api_key_decrypted"] = decrypt_password(encrypted_key)
                except Exception:
                    settings["llm_api_key_decrypted"] = ""
            
            tenant_record = await db.get_tenant_by_slug(state["tenant_slug"])
            settings["tenant_id"] = str(tenant_record["id"]) if tenant_record else None

            state["tenant_settings"] = settings
            state["agent_mode"] = settings.get("agent_mode", "restricted")
            state["skills"] = skills

            # ── 3. Operational: resolve device_id, then load info + history ──
            device_id = state["device_id"]

            if not device_id:
                device_id = await db.get_conversation_device_id(
                    state["tenant_slug"], state["conversation_id"]
                )
                if device_id:
                    state["device_id"] = device_id
                    obs_logger.info("device_id_recovered", device_id=device_id)

            if device_id:
                device, snapshot, recent_history = await asyncio.gather(
                    db.get_device_by_id(state["tenant_slug"], device_id),
                    db.get_device_snapshot(state["tenant_slug"], device_id, max_age_hours=24),
                    db.get_device_recent_history(state["tenant_slug"], device_id, limit=5),
                )
                if device:
                    state["device_info"] = device
                    state["device_snapshot"] = snapshot
                    state["operational_memory"] = recent_history  # type: ignore[index]
                else:
                    # Device was deleted or deactivated — clear device_id so fuzzy match can run
                    logging.warning(f"[load_context] device_id={device_id} returned None (inactive/deleted), clearing")
                    state["device_id"] = None
                    state["device_info"] = None
                    state["operational_memory"] = []  # type: ignore[index]
            else:
                state["operational_memory"] = []  # type: ignore[index]

            obs_logger.info("context_loaded",
                device_id=device_id,
                has_device=state.get("device_info") is not None,
                has_snapshot=state.get("device_snapshot") is not None,
                op_history_len=len(state.get("operational_memory", [])),
            )
        return state



    # ── Node: search_rag ─────────────────────────────────────────────────────

    async def _search_rag(self, state: AgentState) -> AgentState:
        """Semantic knowledge search using tenant's configured provider."""
        with PhaseTimer("search_rag", tenant=state["tenant_slug"]):
            provider, api_key = _get_rag_provider(state["tenant_settings"])
            
            # 1. Long-term Knowledge Base (Global + Tenant technical docs)
            knowledge = await search_knowledge(
                state["user_message"], limit=3,
                provider=provider, api_key=api_key,
                tenant_id=state["tenant_settings"].get("tenant_id"),
            )
            state["knowledge"] = knowledge or ""
            
            # 2. Medium-term Knowledge Base (Contextual Tenant/Device Facts)
            memories = await db.search_tenant_memories(
                tenant_slug=state["tenant_slug"],
                query=state["user_message"],
                device_id=state.get("device_id"),
                limit=3
            )
            state["tenant_memories"] = memories or ""
            
        return state

    # ── Node: route_intent ────────────────────────────────────────────────────

    async def _route_intent(self, state: AgentState) -> AgentState:
        """Select which specialist agents will handle this request."""
        with PhaseTimer("route_intent", tenant=state["tenant_slug"]):
            device = state.get("device_info")
            device_type = device.get("type", "") if device else ""

            # Auto-detect device from message if not already set
            if not device and not state.get("device_id"):
                import re
                import unicodedata
                
                # Helper to normalize accents and special chars
                def _normalize_str(s: str, keep_spaces=False) -> str:
                    s = str(s).lower()
                    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
                    if keep_spaces:
                        return re.sub(r'[^a-z0-9\s]', '', s)
                    return re.sub(r'[^a-z0-9]', '', s)

                all_devices = await db.get_all_active_devices(state["tenant_slug"])
                msg_lower = state["user_message"].lower()
                msg_clean = _normalize_str(state["user_message"])
                msg_words = _normalize_str(state["user_message"], keep_spaces=True).split()

                matched = None
                best_score = 0.0  # must be defined before any match path
                
                # 1. Check if user typed a number corresponding to a list from the previous assistant message
                last_assistant_msg = next((m for m in reversed(state["history"]) if m["role"] == "assistant"), None)
                if last_assistant_msg and msg_lower.strip().isdigit():
                    idx = msg_lower.strip()
                    m = re.search(rf"(?:^|\n)\s*{idx}\.\s*(?:\*\*)?([a-zA-Z0-9_-]+)", last_assistant_msg["content"])
                    if m:
                        selected_name = _normalize_str(m.group(1))
                        for d in all_devices:
                            if _normalize_str(d["name"]) == selected_name:
                                matched = d
                                best_score = 1.0
                                break

                # 2. Fuzzy match string tokens against the device names
                if not matched:
                    for d in all_devices:
                        name_lower = d["name"].lower()
                        name_clean = _normalize_str(d["name"])
                        
                        if name_clean and name_clean in msg_clean:
                            matched = d
                            best_score = 1.0
                            break
                            
                        import difflib
                        
                        # Token similarity matching over non-normalized words
                        parts = re.split(r"[-_.\s]+", d["name"])
                        tokens = []
                        for p in parts:
                            sub = re.sub(r"([a-z])([A-Z])", r"\1 \2", p).lower().split()
                            tokens.extend(sub)
                        tokens = [t for t in tokens if len(t) >= 3]
                        
                        if not tokens:
                            continue
                        
                        score = 0
                        for t in tokens:
                            t_norm = _normalize_str(t)
                            if t_norm in msg_clean:
                                score += 1
                            else:
                                best_sim = max([difflib.SequenceMatcher(None, t_norm, w).ratio() for w in msg_words] + [0])
                                if best_sim > 0.8:
                                    score += 1
                                    
                        final_score = score / len(tokens)
                        if final_score >= 0.6 and final_score > best_score:
                            best_score = final_score
                            matched = d

                import logging
                logging.warning(f"[fuzzy_match] user_message={state['user_message']} best_score={best_score} matched={matched['name'] if matched else 'None'}")

                if matched:
                    full_device = await db.get_device_by_id(state["tenant_slug"], str(matched["id"]))
                    if full_device:
                        state["device_id"] = str(matched["id"])
                        state["device_info"] = full_device
                        device_type = full_device.get("type", "")
                        snapshot = await db.get_device_snapshot(
                            state["tenant_slug"], str(matched["id"]), max_age_hours=24
                        )
                        state["device_snapshot"] = snapshot
                        
                        await self._async_emit(state, "agent:system_log", {
                            "conversationId": state["conversation_id"],
                            "log": f"📡 Equipamento detectado: {full_device['name']} ({device_type})"
                        })

            selected, mcp_scopes = _select_agents(device_type, state["user_message"])
            state["selected_agents"] = selected
            # Store scopes for future MCP tool filtering (Phase 3+)
            state["mcp_scopes"] = mcp_scopes  # type: ignore[typeddict-unknown-key]

            obs_logger.info("intent_routed",
                agents=selected, mcp_scopes=mcp_scopes,
                device_type=device_type,
            )

            # Emit routing info to frontend
            await self._async_emit(state, "agent:phase", {
                "conversationId": state["conversation_id"],
                "phase": "routing",
                "status": "done",
                "agents": [a.replace('.md', '') for a in selected],
                "mcp_scopes": mcp_scopes,
            })
            await self._async_emit(state, "agent:system_log", {
                "conversationId": state["conversation_id"],
                "log": f"🧭 Agentes selecionados: {', '.join([a.replace('.md', '') for a in selected])}"
            })
        return state

    # ── Node: run_specialists ─────────────────────────────────────────────────

    async def _run_specialists(self, state: AgentState) -> AgentState:
        """Run each selected specialist agent with its own persona and tools."""
        with PhaseTimer("run_specialists", tenant=state["tenant_slug"]):
            return await self._run_specialists_inner(state)

    async def _run_specialists_inner(self, state: AgentState) -> AgentState:
        tenant = await db.get_tenant_by_slug(state["tenant_slug"])
        settings = state["tenant_settings"]
        device = state.get("device_info")
        agent_mode = state["agent_mode"]

        await self._async_emit(state, "agent:phase", {
            "conversationId": state["conversation_id"],
            "phase": "executing",
            "status": "running",
        })

        # Build the tool handler for this device
        # Strategy: try MCP tools first, fall back to legacy tools
        tools_handler = None
        emit_fn = None
        mcp_tools = []

        if device:
            device_type = device.get("type", "").lower()
            _tenant = state.get("tenant_slug", "")
            _api_url = os.getenv("API_URL", "http://localhost:4000")

            def _make_emit(tenant_slug: str, api_url: str):
                """Create a sync emit function for tool handlers (they call it from sync context)."""
                import httpx as _httpx
                import os
                internal_secret = os.getenv("INTERNAL_API_SECRET", "")
                def _emit(event: str, payload: dict) -> None:
                    try:
                        _httpx.post(
                            f"{api_url}/internal/emit",
                            headers={"x-internal-secret": internal_secret},
                            json={"tenant": tenant_slug, "event": event, "data": payload},
                            timeout=2.0,
                        )
                    except Exception as exc:
                        obs_logger.error("emit_sync_failed", event=event, error=str(exc))
                return _emit

            emit_fn = _make_emit(_tenant, _api_url)

            # ── Try MCP tools first ──────────────────────────────────────────
            try:
                from main import mcp_manager
                mcp_scopes = state.get("mcp_scopes", [])
                mcp_tool_infos = await mcp_manager.discover_tools(
                    scopes=mcp_scopes or None,
                    device_type=device_type,
                )
                if mcp_tool_infos:
                    credentials = {
                        "host": device["host"],
                        "port": device["port"],
                        "username": device["username"],
                        "password": decrypt_password(device["password_encrypted"]),
                    }
                    mcp_tools = mcp_tools_to_langchain(
                        mcp_tool_infos,
                        mcp_manager,
                        credentials=credentials,
                        tenant=state.get("tenant_slug", ""),
                        conversation_id=state.get("conversation_id", ""),
                        agent_mode=agent_mode,
                    )
                    obs_logger.info("mcp_tools_loaded",
                        count=len(mcp_tools),
                        scopes=mcp_scopes,
                        device_type=device_type,
                    )
            except Exception as e:
                obs_logger.warning("mcp_tools_fallback",
                    error=str(e)[:200],
                    reason="falling back to legacy tools",
                )

            # ── Initialize legacy tools (needed for Skills SSH execution) ────
            kwargs = dict(
                host=device["host"],
                port=device["port"],
                username=device["username"],
                password_encrypted=device["password_encrypted"],
                agent_mode=agent_mode,
                emit_fn=emit_fn,
                conversation_id=state.get("conversation_id", ""),
                tenant_slug=state.get("tenant_slug", ""),
            )
            if device_type == "mikrotik":
                tools_handler = MikroTikTools(**kwargs)
            elif device_type == "linux":
                tools_handler = LinuxTools(**kwargs)

        # Build device tool list: MCP tools (preferred) OR legacy tools + skill tools
        tool_source = "MCP" if mcp_tools else "LEGACY"
        base_tools = mcp_tools if mcp_tools else (tools_handler.get_tools() if tools_handler else [])
        skill_tools = build_skill_tools(
            skills=state.get("skills", []),
            device_type=(device.get("type", "") if device else ""),
            ssh_executor=tools_handler,
            agent_mode=agent_mode,
        )
        all_tools = base_tools + skill_tools
        log_msg = f"[tools] source={tool_source} base={len(base_tools)} skills={len(skill_tools)} total={len(all_tools)}"
        logging.warning(log_msg)
        await self._async_emit(state, "agent:system_log", {
            "conversationId": state["conversation_id"],
            "log": log_msg
        })

        # Build shared context strings
        mode_cfg = AGENT_MODE_CONFIG.get(agent_mode, AGENT_MODE_CONFIG["restricted"])
        all_devices_list = await db.get_all_active_devices(state["tenant_slug"])
        devices_str = ", ".join(f"{d['name']} ({d['type']})" for d in all_devices_list) or "Nenhum"

        if device:
            device_info_str = (
                f"**{device['name']}** | Tipo: `{device['type']}` | "
                f"Host: `{device['host']}:{device['port']}`"
            )
            if device.get("description"):
                device_info_str += f"\nDescrição: {device['description']}"
            if device.get("location"):
                device_info_str += f" | Local: {device['location']}"
        else:
            device_info_str = f"Nenhum selecionado. Disponíveis: {devices_str}"

        # Format conversation history for LangChain
        lc_history = []
        for msg in state["history"][:-1]:
            if msg["role"] == "user":
                lc_history.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                lc_history.append(AIMessage(content=msg["content"]))

        all_tool_calls = []
        all_reasoning = []
        total_tokens = 0
        pending_action = None
        agent_results = []

        # Run each selected specialist
        for agent_file in state["selected_agents"]:
            persona = _read_agent_file(agent_file)

            system_prompt = self._build_system_prompt(
                persona=persona,
                mode_cfg=mode_cfg,
                device_info_str=device_info_str,
                snapshot_str=_format_snapshot(state.get("device_snapshot")),
                skills_str=_format_skills_context(state.get("skills", [])),
                knowledge=state["knowledge"] or "",
                history=state["history"],
                settings=settings,
                channel=state["channel"],
                operational_memory=state.get("operational_memory", []),
                tenant_memories=state.get("tenant_memories", ""),
            )

            if not all_tools:
                system_prompt += (
                    "\n\n**🛑 AVISO CRÍTICO DE SISTEMA:**\n"
                    "Você **NÃO POSSUI NENHUMA FERRAMENTA (TOOLS)** no momento, pois nenhum equipamento "
                    "foi identificado com sucesso no seu contexto de execução.\n"
                    "NÃO TENTE INVENTAR OU ALUCINAR UMA ANÁLISE! NÃO DIGA 'VOU VERIFICAR'.\n"
                    "**Responda APENAS informando ao usuário que não foi possível detectar de qual equipamento "
                    "ele está falando e peça para ele especificar um nome válido.**"
                )


            llm = _build_llm(settings, tenant or {})
            messages = (
                [SystemMessage(content=system_prompt)]
                + lc_history
                + [HumanMessage(content=state["user_message"])]
            )
            
            llm_log = f"[specialist:{agent_file}] invoking LLM with {len(all_tools)} tools"
            logging.warning(llm_log)
            await self._async_emit(state, "agent:system_log", {
                "conversationId": state["conversation_id"],
                "log": llm_log
            })

            specialist_response, tool_calls, reasoning, tokens, pa = await self._invoke_specialist(
                llm=llm,
                messages=messages,
                all_tools=all_tools,
                agent_file=agent_file,
                state=state,
                emit_fn=emit_fn,
                tool_source=tool_source,
            )

            agent_results.append({
                "agent": agent_file.replace(".md", ""),
                "response": specialist_response,
            })
            all_tool_calls.extend(tool_calls)
            all_reasoning.extend(reasoning)
            total_tokens += tokens
            if pa and not pending_action:
                pending_action = pa

        state["agent_results"] = agent_results
        state["tool_calls"] = all_tool_calls
        state["reasoning"] = all_reasoning
        state["tokens_used"] = total_tokens
        state["requires_approval"] = bool(pending_action)
        state["approval_data"] = pending_action
        return state

    def _build_system_prompt(
        self,
        persona: str,
        mode_cfg: dict,
        device_info_str: str,
        snapshot_str: str,
        skills_str: str,
        knowledge: str,
        history: list,
        settings: dict,
        channel: str,
        operational_memory: list = None,
        tenant_memories: str = "",
    ) -> str:
        # ── Tier 1: Short-term memory (conversation) ─────────────────────────
        # Limit the conversational window to the last 20 messages to prevent token overflow
        history_str = (
            "\n".join(
                f"{m['role'].upper()}: {m['content'][:500]}"
                for m in history[-20:-1]  # exclude current user message
            )
            or "Início de conversa."
        )

        # ── Tier 2: Operational memory (recent device metrics/events) ────────
        op_memory_str = "Nenhum histórico operacional disponível."
        if operational_memory:
            lines = []
            for entry in operational_memory:
                ts = str(entry.get("recorded_at", ""))[:16]
                ev = entry.get("event_type", "metric")
                summary = entry.get("summary") or ""
                cpu = entry.get("cpu_percent")
                mem = entry.get("memory_percent")
                disk = entry.get("disk_percent")
                metrics = ", ".join(
                    p for p in [
                        f"CPU {cpu:.0f}%" if cpu is not None else "",
                        f"RAM {mem:.0f}%" if mem is not None else "",
                        f"Disco {disk:.0f}%" if disk is not None else "",
                    ] if p
                )
                line = f"[{ts}] {ev.upper()}"
                if metrics:
                    line += f" — {metrics}"
                if summary:
                    line += f" — {summary[:120]}"
                lines.append(line)
            op_memory_str = "\n".join(lines)

        base = (
            f"Você é o **NetAgent**, agente de infraestrutura de rede para ISPs e provedores.\n\n"
            f"## ⚡ REGRAS FUNDAMENTAIS\n"
            f"1. **NUNCA explique como fazer algo.** Quando o usuário pede informação ou pede para executar um comando, → **USE A TOOL NA PRIMEIRA RESPOSTA**.\n"
            f"2. **MEMÓRIA:** Quando o usuário pedir para 'lembrar', 'nunca mais fazer', ou gravar uma preferência → **USE IMEDIATAMENTE a tool `save_memory`** antes de responder.\n"
            f"3. **SEM FORMATAÇÃO EM IPs:** NUNCA use asteriscos duplos (**) ou formatação Markdown ao redor de endereços IP ou nomes de dispositivos (Exemplo: escreva 192.168.1.1 e não **192.168.1.1**).\n\n"
            f"---\n"
            f"## 🔐 Modo atual: **{mode_cfg['label']}**\n"
            f"{mode_cfg['instructions']}\n\n"
            f"---\n"
            f"## 🖥️ Dispositivo atual:\n{device_info_str}\n\n"
            f"## 📸 Estado conhecido (snapshot):\n{snapshot_str}\n\n"
            f"**⚠️ REGRA DE SNAPSHOT: Se o snapshot acima JÁ contém dados do dispositivo, NÃO chame `system_fingerprint`, `system_get_status` ou `fingerprint_device` novamente.**\n"
            f"**Use os dados do snapshot atual e vá direto para a ação solicitada pelo usuário.**\n\n"
            f"---\n"
            f"## 🧠 MEMÓRIA DO AGENTE (RAG de 3 Camadas)\n\n"
            f"### 💬 [CURTO PRAZO] Memória de Sessão (conversa atual):\n"
            f"{history_str}\n\n"
            f"### 📌 [CURTO PRAZO] Memória Operacional (últimos eventos do dispositivo):\n"
            f"{op_memory_str}\n\n"
            f"### 🧠 [MÉDIO PRAZO] Preferências e Fatos (Específicos do Cliente/Dispositivo):\n"
            f"{tenant_memories or 'Nenhuma preferência registrada para este contexto.'}\n\n"
            f"### 📚 [LONGO PRAZO] Base de Conhecimento RAG (Manuais e Dicas Globais):\n"
            f"{knowledge or 'Nenhum conhecimento indexado para esta consulta.'}\n\n"
            f"---\n"
            f"## 🛠️ Skills disponíveis:\n{skills_str}\n\n"
            f"---\n"
            f"## 🌐 Formato:\n"
            f"- Idioma: {settings.get('language', 'pt-BR')}\n"
            f"- Canal: {channel}\n"
            f"{FORMAT_HINTS.get(channel, FORMAT_HINTS['web'])}\n"
        )
        if persona:
            base += f"\n\n---\n## 🤖 Sua Especialização\n\n{persona}"
        return base

    async def _invoke_specialist(
        self,
        llm,
        messages: list,
        all_tools: list,
        agent_file: str,
        state: AgentState,
        emit_fn=None,
        tool_source: str = "UNKNOWN",
    ) -> tuple[str, list, list, int, Optional[dict]]:
        """
        Invoke a single specialist agent with its tools.
        Supports multi-turn tool calling (up to 5 iterations) for autonomous error fixing.
        Returns (response_text, tool_calls_log, reasoning, tokens, pending_action).
        """
        import logging
        tool_map = {t.name: t for t in all_tools}  # O(1) lookup by name
        reasoning = []
        tool_calls_log = []
        pending_action = None
        total_tokens = 0

        # Bind tools if available
        llm_with_tools = llm.bind_tools(all_tools) if all_tools else llm
        
        MAX_ITERATIONS = 5
        
        for iteration in range(MAX_ITERATIONS):
            logging.warning(f"[specialist:{agent_file}] iter {iteration+1}/{MAX_ITERATIONS}: invoking LLM with {len(all_tools)} tools, {len(messages)} msgs")
            
            ai_msg = await llm_with_tools.ainvoke(messages)
            total_tokens += (ai_msg.usage_metadata or {}).get("output_tokens", 0)

            logging.warning(
                f"[specialist:{agent_file}] got tool_calls={len(ai_msg.tool_calls)} "
                f"content_len={len(ai_msg.content or '')} "
                f"content_preview={repr((ai_msg.content or '')[:80])}"
            )

            # If the LLM didn't return any tool calls, it is done. Return its text.
            if not all_tools or not ai_msg.tool_calls:
                response_text = ai_msg.content
                return response_text, tool_calls_log, reasoning, total_tokens, pending_action

            # Execute tool calls for this iteration
            tool_messages = []
            snapshot_updated = False

            for tc in ai_msg.tool_calls:
                reasoning.append({"step": f"🔧 {tc['name']}", "args": tc["args"]})

                # Emit step start in real time
                try:
                    await self._async_emit(state, "agent:system_log", {
                        "conversationId": state["conversation_id"],
                        "log": f"⚡ Acionando ferramenta: {tc['name']}..."
                    })
                    await self._async_emit(state, "agent:step_start", {
                        "conversationId": state["conversation_id"],
                        "stepId": tc["id"],
                        "tool": tc["name"],
                        "args": {k: str(v)[:100] for k, v in (tc.get("args") or {}).items()} if isinstance(tc.get("args"), dict) else {},
                        "status": "running",
                    })
                except Exception as _e:
                    logging.warning(f"[emit] step_start failed: {_e}")

                # Dispatch to tool handler via tool_map
                logging.warning(f"[tool:{tool_source}] calling {tc['name']} args={list(tc['args'].keys()) if isinstance(tc.get('args'), dict) else []}")
                result = await self._dispatch_tool(tc, tool_map)
                logging.warning(f"[tool:{tool_source}] {tc['name']} done, result[:80]={str(result)[:80]!r}")

                # Emit step done in real time
                result_str = str(result)
                is_error = result_str.startswith("Erro") or "error" in result_str[:80].lower()
                try:
                    await self._async_emit(state, "agent:system_log", {
                        "conversationId": state["conversation_id"],
                        "log": f"✅ Sucesso na ferramenta {tc['name']}, recebendo dados..." if not is_error else f"⚠️ Falha na ferramenta: {result_str[:60]}"
                    })
                    await self._async_emit(state, "agent:step_done", {
                        "conversationId": state["conversation_id"],
                        "stepId": tc["id"],
                        "tool": tc["name"],
                        "result": result_str[:400],
                        "status": "error" if is_error else "ok",
                    })
                except Exception as _e:
                    logging.warning(f"[emit] step_done failed: {_e}")

                # Save fingerprint as device snapshot
                if tc["name"] in ("fingerprint_device", "system_fingerprint", "system_get_status", "network_get_info") and state.get("device_id") and not snapshot_updated:
                    snapshot_updated = True
                    try:
                        await db.save_device_snapshot(
                            state["tenant_slug"],
                            str(state["device_id"]),
                            notes=str(result)[:2000],
                        )
                    except Exception:
                        pass

                # Detect propose_action via __pending_action__ key
                if self._is_pending_action(result):
                    try:
                        pa = json.loads(result) if isinstance(result, str) else result
                        if pa.get("__pending_action__"):
                            pending_action = {
                                "action_type": pa["action_type"],
                                "description": pa["description"],
                                "commands": pa["commands"],
                                "risk_level": pa["risk_level"],
                                "device_id": state.get("device_id"),
                            }
                            tool_calls_log.append({
                                "tool": tc["name"], "args": tc["args"],
                                "result": pa["description"],
                            })
                            tool_messages.append(
                                ToolMessage(
                                    content=f"Ação proposta: {pa['description']}",
                                    tool_call_id=tc["id"],
                                )
                            )
                            continue
                    except (json.JSONDecodeError, KeyError):
                        pass

                tool_calls_log.append({
                    "tool": tc["name"], "args": tc["args"],
                    "result": str(result)[:500],
                })
                tool_messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))

            # ── Anti-hallucination guard ─────────────────────────────────────────
            # If ALL tool results are connection errors, skip further iterations and return
            _ERROR_PATTERNS = (
                "Erro SSH:", "Erro: falha de autenticação", "Erro: não foi possível conectar",
                "Erro ao executar", "Ferramenta '", "não encontrada",
                "Connection refused", "Connection timed out", "Authentication failed",
                "Permission denied", "Host key verification failed",
                "No route to host", "Network is unreachable",
                "Erro: MCP call to",
            )
            error_results = [
                m.content for m in tool_messages
                if isinstance(m.content, str) and (
                    any(m.content.strip().startswith(p) for p in _ERROR_PATTERNS)
                    or any(m.content.strip().startswith(f"Erro: {p}") for p in _ERROR_PATTERNS)
                )
            ]
            if error_results and len(error_results) == len(tool_messages):
                obs_logger.warning("all_tools_failed",
                    agent=agent_file,
                    error_count=len(error_results),
                    first_error=error_results[0][:200],
                )
                error_detail = error_results[0][:300]
                return (
                    f"❌ **Não foi possível conectar ao dispositivo ou executar a ferramenta.**\n\n"
                    f"**Erro:** {error_detail}\n\n"
                    f"Verifique as credenciais ou a conexão com o roteador."
                ), tool_calls_log, reasoning, total_tokens, pending_action

            # Add this iteration's messages to the chat history so the next LLM call knows what happened
            messages.append(ai_msg)
            messages.extend(tool_messages)

            # If there's a pending action, stop chaining immediately and ask the LLM to summarize
            if pending_action:
                break

        # Max iterations reached or pending action found. Do one final run to get text output.
        logging.warning(f"[specialist:{agent_file}] final text synthesis run")
        final_msg = await llm.ainvoke(messages)
        total_tokens += (final_msg.usage_metadata or {}).get("output_tokens", 0)
        return final_msg.content, tool_calls_log, reasoning, total_tokens, pending_action


    @staticmethod
    def _is_pending_action(result) -> bool:
        """Detect a propose_action result — more robust than string search."""
        if isinstance(result, dict):
            return result.get("__pending_action__", False)
        if isinstance(result, str):
            return '"__pending_action__": true' in result or "'__pending_action__': True" in result
        return False

    @staticmethod
    async def _dispatch_tool(tc: dict, tool_map: dict) -> str:
        """
        Invoke a tool by name using the pre-built tool_map (name → StructuredTool).
        Uses tool.ainvoke() which is the correct LangChain async dispatch path.
        """
        tool_name = tc["name"]
        args = tc.get("args", {})

        tool = tool_map.get(tool_name)
        if not tool:
            return f"Ferramenta '{tool_name}' não encontrada"

        try:
            # ainvoke accepts a dict of args or a str; always pass dict
            result = await tool.ainvoke(args or {})
            return str(result)
        except Exception as e:
            import traceback
            import logging
            logging.error(f"[tool:{tool_name}] error: {e}\n{traceback.format_exc()}")
            return f"Erro ao executar {tool_name}: {e}"

    # ── Node: synthesize ──────────────────────────────────────────────────────

    async def _synthesize(self, state: AgentState) -> AgentState:
        """
        Combine results from one or more specialists into a single response.
        If only one specialist ran, passes through directly.
        If multiple ran, uses LLM to synthesize a unified answer.
        """
        results = state.get("agent_results", [])

        if not results:
            state["response"] = "Não foi possível processar a solicitação."
            return state

        await self._async_emit(state, "agent:system_log", {
            "conversationId": state["conversation_id"],
            "log": "📝 Processamento concluído. Gerando resposta final para o usuário..."
        })

        if len(results) == 1:
            # Single agent — pass through directly
            response_text = results[0]["response"]
        else:
            # Multiple agents — synthesize
            parts = []
            for r in results:
                parts.append(f"## {r['agent']}\n{r['response']}")
            combined = "\n\n".join(parts)

            tenant = await db.get_tenant_by_slug(state["tenant_slug"])
            llm = _build_llm(state["tenant_settings"], tenant or {})

            synth_prompt = (
                "Você recebeu análises de múltiplos agentes especialistas sobre a mesma solicitação. "
                "Sintetize as informações em UMA resposta coesa, eliminando repetições e ordenando "
                "por prioridade (críticos primeiro). Mantenha o mesmo idioma e canal de formato.\n\n"
                f"Canal: {state['channel']}\n\n"
                f"Solicitação original: {state['user_message']}\n\n"
                f"Análises:\n\n{combined}"
            )
            synth_msg = await llm.ainvoke([SystemMessage(content=synth_prompt)])
            response_text = synth_msg.content
            state["tokens_used"] += (synth_msg.usage_metadata or {}).get("output_tokens", 0)

        # Normalize for WhatsApp
        if state.get("channel") == "whatsapp":
            response_text = _normalize_for_whatsapp(response_text)

        state["response"] = response_text
        return state
