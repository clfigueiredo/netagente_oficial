"""
rag.py — Semantic knowledge base search and indexing using pgvector.

Supports multiple embedding providers: OpenAI (default) and Google Gemini.
Provider is selected based on tenant settings passed at call time, or falls
back to environment variables.
"""

import os
import logging
import asyncpg
from typing import Optional

DATABASE_URL = os.getenv("DATABASE_URL")
_log = logging.getLogger(__name__)
_pool = None  # set by main.py lifespan startup


# ── Embedding clients (lazy init) ─────────────────────────────────────────────

_openai_client = None
_google_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import AsyncOpenAI
        _openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_KEY"))
    return _openai_client


def _get_google_client():
    global _google_client
    if _google_client is None:
        try:
            import google.generativeai as genai
            genai.configure(api_key=os.getenv("GOOGLE_API_KEY", ""))
            _google_client = genai
        except ImportError:
            _google_client = None
    return _google_client


# ── Embedding Generation ───────────────────────────────────────────────────────

async def get_embedding(
    text: str,
    provider: str = "openai",
    api_key: Optional[str] = None,
) -> list[float]:
    """
    Generate text embedding using the specified provider.
    - provider: 'openai' (default) or 'gemini'
    - api_key: override the environment key if provided
    """
    text = text[:8000]  # safety limit

    if provider == "gemini":
        try:
            import google.generativeai as genai
            key = api_key or os.getenv("GOOGLE_API_KEY", "")
            if key:
                genai.configure(api_key=key)
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=text,
                task_type="retrieval_query",
            )
            return result["embedding"]
        except Exception:
            pass  # fall through to OpenAI

    # OpenAI (default + Gemini fallback)
    client = _get_openai_client()
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return response.data[0].embedding


# ── Knowledge Search ───────────────────────────────────────────────────────────

async def search_knowledge(
    query: str,
    limit: int = 3,
    category: Optional[str] = None,
    provider: str = "openai",
    api_key: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    """
    Search public.knowledge_base using cosine similarity (pgvector).
    Returns a formatted string with the top matching knowledge entries.
    Matches global knowledge (tenant_id IS NULL) OR tenant knowledge (tenant_id = $tenant_id).
    """
    try:
        embedding = await get_embedding(query, provider=provider, api_key=api_key)
    except Exception as emb_err:
        _log.warning(f"[rag] embedding failed: {emb_err} — falling back to keyword search")
        return await _keyword_fallback(query, limit, category, tenant_id)

    vector_str = f"[{','.join(str(x) for x in embedding)}]"

    async def _fetch(conn):
        if category:
            return await conn.fetch(
                """
                SELECT title, content, category, quality_score
                FROM public.knowledge_base
                WHERE category = $3
                  AND (tenant_id IS NULL OR tenant_id = $4::uuid)
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                vector_str, limit, category, tenant_id,
            )
        return await conn.fetch(
            """
            SELECT title, content, category, quality_score
            FROM public.knowledge_base
            WHERE tenant_id IS NULL OR tenant_id = $3::uuid
            ORDER BY embedding <=> $1::vector
            LIMIT $2
            """,
            vector_str, limit, tenant_id,
        )

    if _pool:
        async with _pool.acquire() as conn:
            rows = await _fetch(conn)
            if rows:
                titles = [row["title"] for row in rows]
                await conn.execute(
                    "UPDATE public.knowledge_base SET use_count = use_count + 1 WHERE title = ANY($1)",
                    titles,
                )
    else:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            rows = await _fetch(conn)
            if rows:
                titles = [row["title"] for row in rows]
                await conn.execute(
                    "UPDATE public.knowledge_base SET use_count = use_count + 1 WHERE title = ANY($1)",
                    titles,
                )
        finally:
            await conn.close()

    if not rows:
        return ""
    return "\n\n---\n\n".join(
        f"[{r['category']}] {r['title']}\n{r['content'][:500]}" for r in rows
    )



async def _keyword_fallback(query: str, limit: int, category: Optional[str], tenant_id: Optional[str] = None) -> str:
    """Fallback when embedding fails: simple ILIKE keyword search."""
    try:
        words = [w for w in query.split() if len(w) > 3][:5]
        if not words:
            return ""
        pattern = "%" + "%".join(words[:3]) + "%"

        async def _fetch(conn):
            if category:
                return await conn.fetch(
                    "SELECT title, content, category FROM public.knowledge_base "
                    "WHERE category = $2 AND (tenant_id IS NULL OR tenant_id = $4::uuid) AND (title ILIKE $1 OR content ILIKE $1) LIMIT $3",
                    pattern, category, limit, tenant_id,
                )
            return await conn.fetch(
                "SELECT title, content, category FROM public.knowledge_base "
                "WHERE (tenant_id IS NULL OR tenant_id = $3::uuid) AND (title ILIKE $1 OR content ILIKE $1) LIMIT $2",
                pattern, limit, tenant_id,
            )

        if _pool:
            async with _pool.acquire() as conn:
                rows = await _fetch(conn)
        else:
            conn = await asyncpg.connect(DATABASE_URL)
            try:
                rows = await _fetch(conn)
            finally:
                await conn.close()

        if not rows:
            return ""
        return "\n\n---\n\n".join(
            f"[{r['category']}] {r['title']}\n{r['content'][:500]}" for r in rows
        )
    except Exception as e:
        _log.warning(f"[rag] keyword fallback also failed: {e}")
        return ""


# ── Knowledge Indexing ─────────────────────────────────────────────────────────

async def index_knowledge(
    title: str,
    content: str,
    category: str,
    device_type: Optional[str] = None,
    tenant_id: Optional[str] = None,
    source: str = "learned",
    provider: str = "openai",
    api_key: Optional[str] = None,
) -> str:
    """
    Index a new knowledge entry with its embedding vector.
    Used by the agent's save_knowledge tool after successful interactions.
    """
    embedding = await get_embedding(
        f"{title}\n{content}", provider=provider, api_key=api_key
    )
    vector_str = f"[{','.join(str(x) for x in embedding)}]"

    async def _insert(conn):
        return await conn.fetchval(
            """
            INSERT INTO public.knowledge_base
              (title, content, embedding, category, device_type, source, tenant_id)
            VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
            RETURNING id
            """,
            title, content, vector_str, category,
            device_type, source, tenant_id,
        )

    if _pool:
        async with _pool.acquire() as conn:
            row_id = await _insert(conn)
    else:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            row_id = await _insert(conn)
        finally:
            await conn.close()

    return str(row_id)
