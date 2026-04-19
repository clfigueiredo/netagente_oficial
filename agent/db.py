"""
db.py — Database access layer using shared asyncpg connection pool.

Pool is initialized in main.py lifespan, NOT at import time.
All functions use pool.acquire() — no more per-query connect/close.
"""

import os
import json
import asyncpg
import logging
from typing import Optional

DATABASE_URL = os.getenv("DATABASE_URL")
_log = logging.getLogger(__name__)

# Pool initialized by init_pool() called from main.py lifespan
_pool: Optional[asyncpg.Pool] = None


async def init_pool(min_size: int = 2, max_size: int = 10):
    """Initialize the shared connection pool. Called once from FastAPI lifespan."""
    global _pool
    if _pool is not None:
        return
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=min_size, max_size=max_size)
    _log.info(f"[db] asyncpg pool initialized (min={min_size}, max={max_size})")


async def close_pool():
    """Close the pool gracefully. Called from FastAPI lifespan shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        _log.info("[db] asyncpg pool closed")


async def _acquire():
    """Acquire a connection from the pool, or create one if pool not initialized."""
    if _pool:
        return _pool.acquire()
    # Fallback for tests or CLI usage outside FastAPI
    _log.warning("[db] pool not initialized — creating single connection")
    conn = await asyncpg.connect(DATABASE_URL)
    return _FakeAcquire(conn)


class _FakeAcquire:
    """Context manager that wraps a single connection to match pool.acquire() API."""
    def __init__(self, conn):
        self._conn = conn
    async def __aenter__(self):
        return self._conn
    async def __aexit__(self, *args):
        await self._conn.close()


# ── Tenant ────────────────────────────────────────────────────────────────────

async def get_tenant_by_instance(instance_name: str) -> Optional[dict]:
    """Find tenant by Evolution API instance name."""
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, slug, evolution_instance, evolution_key, gpt_model, openai_key_encrypted "
            "FROM public.tenants WHERE evolution_instance = $1 AND active = true",
            instance_name
        )
        return dict(row) if row else None


async def get_tenant_by_slug(slug: str) -> Optional[dict]:
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, slug, evolution_instance, evolution_key, gpt_model, openai_key_encrypted "
            "FROM public.tenants WHERE slug = $1 AND active = true",
            slug
        )
        return dict(row) if row else None


# ── Devices ───────────────────────────────────────────────────────────────────

async def get_device_by_id(tenant_slug: str, device_id: str) -> Optional[dict]:
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            f'SELECT * FROM "{tenant_slug}".devices WHERE id = $1::uuid AND active = true',
            device_id
        )
        return dict(row) if row else None


async def get_conversation_device_id(tenant_slug: str, conversation_id: str) -> Optional[str]:
    """Get the device_id associated with the most recent message in a conversation."""
    async with await _acquire() as conn:
        try:
            row = await conn.fetchrow(
                f'SELECT device_id FROM "{tenant_slug}".messages '
                f'WHERE conversation_id = $1::uuid AND device_id IS NOT NULL '
                f'ORDER BY created_at DESC LIMIT 1',
                conversation_id
            )
            return str(row["device_id"]) if row else None
        except Exception:
            return None


async def get_all_active_devices(tenant_slug: str) -> list:
    async with await _acquire() as conn:
        rows = await conn.fetch(
            f'SELECT id, name, type, host, port, description, location, tags '
            f'FROM "{tenant_slug}".devices WHERE active = true ORDER BY name'
        )
        return [dict(r) for r in rows]


# ── Conversations ─────────────────────────────────────────────────────────────

async def get_or_create_whatsapp_conversation(tenant_slug: str, whatsapp_number: str) -> str:
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            f'SELECT id FROM "{tenant_slug}".conversations '
            f'WHERE whatsapp_number = $1 ORDER BY started_at DESC LIMIT 1',
            whatsapp_number
        )
        if row:
            return str(row['id'])
        new_id = await conn.fetchval(
            f'INSERT INTO "{tenant_slug}".conversations '
            f'(title, channel, whatsapp_number) VALUES ($1, $2, $3) RETURNING id',
            f"WhatsApp {whatsapp_number}", "whatsapp", whatsapp_number
        )
        return str(new_id)


async def get_recent_messages(tenant_slug: str, conversation_id: str, limit: int = 12) -> list:
    async with await _acquire() as conn:
        rows = await conn.fetch(
            f'''SELECT m.role, m.content, m.device_id,
                       pa.status AS pa_status, pa.description AS pa_description
                FROM "{tenant_slug}".messages m
                LEFT JOIN "{tenant_slug}".pending_actions pa ON pa.id = m.pending_action_id
                WHERE m.conversation_id = $1
                ORDER BY m.created_at DESC LIMIT $2''',
            conversation_id, limit
        )
        result = []
        for r in reversed(rows):
            row = dict(r)
            content = row["content"] or ""
            if row.get("pa_status") and row["pa_status"] in ("executed", "rejected", "failed"):
                content += (
                    f"\n\n[SYSTEM: A ação proposta '{row.get('pa_description', '')}' "
                    f"foi {row['pa_status'].upper()} pelo usuário. NÃO proponha esta ação novamente.]"
                )
            result.append({"role": row["role"], "content": content, "device_id": row["device_id"]})
        return result


# ── Skills ───────────────────────────────────────────────────────────────────

async def get_skill_by_name(name: str) -> Optional[dict]:
    """Fetch a skill from public.skills by exact name. Parses steps JSONB to list."""
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, display_name, description, category, device_type, steps "
            "FROM public.skills WHERE name = $1 AND active = true LIMIT 1",
            name
        )
        if not row:
            return None
        result = dict(row)
        steps = result.get("steps")
        if isinstance(steps, str):
            result["steps"] = json.loads(steps)
        elif steps is None:
            result["steps"] = []
        return result


async def save_skill(
    name: str,
    display_name: str,
    description: str,
    category: str,
    device_type: str,
    steps: list,
    prompt_template: str = "",
) -> str:
    """Insert or update a skill in public.skills. Returns the skill id."""
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO public.skills (name, display_name, description, category, device_type, steps, prompt_template, active)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true)
               ON CONFLICT (name) DO UPDATE SET
                 display_name = EXCLUDED.display_name,
                 description = EXCLUDED.description,
                 steps = EXCLUDED.steps,
                 active = true
               RETURNING id""",
            name, display_name, description, category, device_type,
            json.dumps(steps), prompt_template,
        )
        return str(row["id"])


# ── Operational Memory ────────────────────────────────────────────────────────

async def get_device_recent_history(
    tenant_slug: str, device_id: str, limit: int = 5
) -> list:
    """Return recent device snapshots as operational memory."""
    async with await _acquire() as conn:
        try:
            rows = await conn.fetch(
                f'''SELECT id, captured_at, os_info, disk_info, notes, extra
                    FROM "{tenant_slug}".device_snapshots
                    WHERE device_id = $1::uuid
                    ORDER BY captured_at DESC
                    LIMIT $2''',
                device_id, limit
            )
            result = []
            for r in rows:
                d = dict(r)
                extra = d.get("extra")
                if isinstance(extra, str):
                    try:
                        import json
                        extra = json.loads(extra)
                    except Exception:
                        extra = {}
                d["cpu_percent"] = (extra or {}).get("cpu_percent")
                d["memory_percent"] = (extra or {}).get("memory_percent")
                d["disk_percent"] = (extra or {}).get("disk_percent")
                d["event_type"] = "snapshot"
                d["summary"] = d.get("notes") or d.get("os_info", "")[:80]
                d["recorded_at"] = d["captured_at"]
                result.append(d)
            return result
        except Exception as e:
            logging.error(f"[db] get_device_recent_history error: {e}")
            return []


# ── Medium-Term Memory (Tenant Memories) ─────────────────────────────────────

async def save_tenant_memory(
    tenant_slug: str,
    memory_type: str,
    content: str,
    device_id: Optional[str] = None,
    conversation_id: Optional[str] = None
) -> str:
    """Save a user or device preference / fact to Medium-Term Memory using pgvector."""
    from memory.rag import get_embedding
    
    # Generate embedding
    meta_text = f"[{memory_type}] "
    if device_id:
        meta_text += f"device_id={device_id} "
    embedding = await get_embedding(f"{meta_text}\n{content}")
    vector_str = f"[{','.join(str(x) for x in embedding)}]"
    
    async with await _acquire() as conn:
        row_id = await conn.fetchval(
            f"""
            INSERT INTO "{tenant_slug}".tenant_memories
              (conversation_id, device_id, memory_type, content, embedding)
            VALUES ($1, $2, $3, $4, $5::vector)
            RETURNING id
            """,
            conversation_id if conversation_id else None,
            device_id if device_id else None,
            memory_type,
            content,
            vector_str
        )
        return str(row_id)

async def search_tenant_memories(
    tenant_slug: str,
    query: str,
    device_id: Optional[str] = None,
    limit: int = 5
) -> str:
    """Semantic search on Medium-Term memory for a specific tenant and device."""
    from memory.rag import get_embedding
    
    try:
        embedding = await get_embedding(query)
    except Exception as e:
        logging.warning(f"[db] search_tenant_memories embedding failed: {e}")
        return ""
        
    vector_str = f"[{','.join(str(x) for x in embedding)}]"
    
    async with await _acquire() as conn:
        if device_id:
            rows = await conn.fetch(
                f"""
                SELECT memory_type, content
                FROM "{tenant_slug}".tenant_memories
                WHERE device_id = $2 OR device_id IS NULL
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                vector_str, device_id, limit
            )
        else:
            rows = await conn.fetch(
                f"""
                SELECT memory_type, content
                FROM "{tenant_slug}".tenant_memories
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                vector_str, limit
            )
            
    if not rows:
        return ""
        
    return "\n".join(f"- [{r['memory_type']}] {r['content']}" for r in rows)


async def get_recent_device_knowledge(
    device_type: str, limit: int = 3
) -> str:
    """Fetch recently-used knowledge_base entries matching device type."""
    async with await _acquire() as conn:
        try:
            rows = await conn.fetch(
                """SELECT title, content, category
                   FROM public.knowledge_base
                   WHERE (device_type = $1 OR device_type IS NULL)
                     AND source = 'agent_learned'
                   ORDER BY use_count DESC, created_at DESC
                   LIMIT $2""",
                device_type, limit
            )
            if not rows:
                return ""
            parts = [f"[{r['category']}] {r['title']}: {r['content'][:200]}" for r in rows]
            return "\n".join(parts)
        except Exception:
            return ""


from typing import Optional

async def save_message(tenant_slug: str, conversation_id: str, role: str, content: str,
                       device_id: Optional[str] = None,
                       tool_calls: list = None, tokens_used: int = 0) -> None:
    """Persist a message to the conversation history."""
    async with await _acquire() as conn:
        await conn.execute(
            f'INSERT INTO "{tenant_slug}".messages '
            f'(conversation_id, role, content, device_id, tool_calls, tokens_used) '
            f'VALUES ($1, $2, $3, $4::uuid, $5, $6)',
            conversation_id,
            role,
            content,
            device_id if device_id else None,
            json.dumps(tool_calls or []),
            tokens_used,
        )
        await conn.execute(
            f'UPDATE "{tenant_slug}".conversations '
            f'SET last_activity_at = NOW() WHERE id = $1',
            conversation_id,
        )


# ── Settings ──────────────────────────────────────────────────────────────────

async def get_tenant_settings(tenant_slug: str) -> dict:
    """Return all non-encrypted settings as key→value dict."""
    async with await _acquire() as conn:
        rows = await conn.fetch(
            f'SELECT key, value FROM "{tenant_slug}".settings WHERE encrypted = false'
        )
        return {r['key']: r['value'] for r in rows}


async def get_encrypted_setting(tenant_slug: str, key: str) -> Optional[str]:
    """Return a single encrypted setting value (raw ciphertext)."""
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            f'SELECT value FROM "{tenant_slug}".settings WHERE key = $1 AND encrypted = true',
            key
        )
        return row['value'] if row else None


# ── Device Snapshots ──────────────────────────────────────────────────────────

async def get_device_snapshot(tenant_slug: str, device_id: str, max_age_hours: int = 24) -> Optional[dict]:
    """Return the most recent device snapshot if younger than max_age_hours."""
    async with await _acquire() as conn:
        row = await conn.fetchrow(
            f'''SELECT id, device_id, captured_at, os_info, services,
                       installed_pkgs, open_ports, disk_info, extra, notes
                FROM "{tenant_slug}".device_snapshots
                WHERE device_id = $1::uuid
                  AND captured_at > NOW() - INTERVAL '{max_age_hours} hours'
                ORDER BY captured_at DESC
                LIMIT 1''',
            device_id
        )
        if not row:
            return None
        d = dict(row)
        for f in ('services', 'installed_pkgs', 'open_ports'):
            if isinstance(d.get(f), str):
                try:
                    d[f] = json.loads(d[f])
                except Exception:
                    d[f] = []
        return d


async def save_device_snapshot(tenant_slug: str, device_id: str,
                               os_info: str = "",
                               services: list = None,
                               installed_pkgs: list = None,
                               open_ports: list = None,
                               disk_info: str = "",
                               extra: dict = None,
                               notes: str = "") -> str:
    """Save a new device snapshot and return its id."""
    async with await _acquire() as conn:
        row_id = await conn.fetchval(
            f'''INSERT INTO "{tenant_slug}".device_snapshots
                (device_id, os_info, services, installed_pkgs, open_ports, disk_info, extra, notes)
                VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)
                RETURNING id''',
            device_id,
            os_info,
            json.dumps(services or []),
            json.dumps(installed_pkgs or []),
            json.dumps(open_ports or []),
            disk_info,
            json.dumps(extra or {}),
            notes,
        )
        return str(row_id)


# ── WhatsApp ──────────────────────────────────────────────────────────────────

async def get_whatsapp_user(tenant_slug: str, number: str) -> Optional[dict]:
    """Return whatsapp_user if the number is authorized for this tenant."""
    async with await _acquire() as conn:
        number_stripped = number.lstrip("55") if number.startswith("55") and len(number) == 13 else number
        number_with_cc = "55" + number if not number.startswith("55") else number
        row = await conn.fetchrow(
            f'SELECT id, number, name, role FROM "{tenant_slug}".whatsapp_users '
            f'WHERE (number = $1 OR number = $2 OR number = $3) AND active = true',
            number, number_stripped, number_with_cc
        )
        return dict(row) if row else None


# ── Skills (tenant-scoped) ────────────────────────────────────────────────────

async def get_tenant_skills(tenant_slug: str) -> list:
    """Return active global skills. Uses tenant slug to look up tenant_id for overrides."""
    async with await _acquire() as conn:
        # Look up tenant UUID first — skill_tenant_overrides.tenant_id is UUID, not slug
        tenant_row = await conn.fetchrow(
            "SELECT id FROM public.tenants WHERE slug = $1", tenant_slug
        )
        if not tenant_row:
            # If tenant not found, return all active skills without overrides
            rows = await conn.fetch(
                """SELECT id, name, display_name, description, category,
                          device_type, prompt_template, steps, examples
                   FROM public.skills WHERE active = true
                   ORDER BY category, display_name"""
            )
            return [dict(r) for r in rows]

        tenant_id = str(tenant_row["id"])
        rows = await conn.fetch(
            """
            SELECT s.id, s.name, s.display_name, s.description, s.category,
                   s.device_type, s.prompt_template, s.steps, s.examples
            FROM public.skills s
            LEFT JOIN public.skill_tenant_overrides sto
                   ON sto.skill_id = s.id AND sto.tenant_id = $1
            WHERE s.active = true
              AND COALESCE(sto.active, true) = true
            ORDER BY s.category, s.display_name
            """,
            tenant_id
        )
        return [dict(r) for r in rows]


async def get_mcp_drivers(tenant_slug: str) -> list[dict]:
    """Get all active MCP drivers for a tenant."""
    async with await _acquire() as conn:
        rows = await conn.fetch(
            f'SELECT * FROM "{tenant_slug}".mcp_drivers WHERE active = true'
        )
        return [dict(r) for r in rows]


async def get_all_tenant_slugs() -> list[str]:
    """Get all tenant slugs from the public.tenants table."""
    async with await _acquire() as conn:
        rows = await conn.fetch("SELECT slug FROM public.tenants")
        return [r["slug"] for r in rows]


