"""Pool asyncpg e queries sobre o schema do tenant."""

import os
import asyncpg
from typing import Any, Optional

_pool: Optional[asyncpg.Pool] = None


def _schema() -> str:
    s = os.environ.get("TENANT_SCHEMA", "").strip()
    if not s:
        raise RuntimeError("TENANT_SCHEMA não definido no ambiente")
    # Schema é embutido na query (identifier), então travamos o formato.
    if not all(c.isalnum() or c == "_" for c in s):
        raise RuntimeError(f"TENANT_SCHEMA inválido: {s!r}")
    return s


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            host=os.environ.get("DB_HOST", "netagent-postgres"),
            port=int(os.environ.get("DB_PORT", "5432")),
            database=os.environ.get("DB_NAME", "netagent"),
            user=os.environ.get("DB_USER", "netagent"),
            password=os.environ["DB_PASSWORD"],
            min_size=1,
            max_size=5,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


_PUBLIC_COLS = (
    "id, name, type, host, port, username, description, location, tags, "
    "active, last_seen_at, created_at"
)


def _row_to_dict(row: asyncpg.Record | None) -> dict[str, Any] | None:
    if row is None:
        return None
    d = dict(row)
    if "id" in d and d["id"] is not None:
        d["id"] = str(d["id"])
    for k in ("last_seen_at", "created_at"):
        if k in d and d[k] is not None:
            d[k] = d[k].isoformat()
    return d


async def list_devices(type_filter: str | None, active: bool | None) -> list[dict]:
    schema = _schema()
    clauses, args = [], []
    if type_filter is not None:
        args.append(type_filter)
        clauses.append(f"type = ${len(args)}")
    if active is not None:
        args.append(active)
        clauses.append(f"active = ${len(args)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f'SELECT {_PUBLIC_COLS} FROM "{schema}".devices {where} ORDER BY name'
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [_row_to_dict(r) for r in rows]


async def get_device(device_id: str) -> dict | None:
    schema = _schema()
    sql = f'SELECT {_PUBLIC_COLS} FROM "{schema}".devices WHERE id = $1'
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, device_id)
    return _row_to_dict(row)


async def get_device_with_encrypted(device_id: str) -> dict | None:
    schema = _schema()
    sql = (
        f'SELECT id, name, type, host, port, username, password_encrypted '
        f'FROM "{schema}".devices WHERE id = $1'
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, device_id)
    return _row_to_dict(row)


async def search_devices(query: str) -> list[dict]:
    schema = _schema()
    sql = (
        f'SELECT {_PUBLIC_COLS} FROM "{schema}".devices '
        f"WHERE name ILIKE $1 OR host ILIKE $1 OR tags::text ILIKE $1 "
        f"ORDER BY name"
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, f"%{query}%")
    return [_row_to_dict(r) for r in rows]


async def create_device(
    name: str,
    type_: str,
    host: str,
    username: str,
    password_encrypted: str,
    port: int = 22,
    description: str | None = None,
    location: str | None = None,
    tags: list | None = None,
) -> dict:
    schema = _schema()
    import json
    sql = (
        f'INSERT INTO "{schema}".devices '
        f"(name, type, host, port, username, password_encrypted, description, location, tags) "
        f"VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) "
        f"RETURNING {_PUBLIC_COLS}"
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            sql, name, type_, host, port, username, password_encrypted,
            description, location, json.dumps(tags or []),
        )
    return _row_to_dict(row)


async def update_device_fields(device_id: str, fields: dict) -> dict | None:
    if not fields:
        return await get_device(device_id)
    schema = _schema()
    sets, args = [], []
    import json
    for k, v in fields.items():
        args.append(json.dumps(v) if k == "tags" else v)
        cast = "::jsonb" if k == "tags" else ""
        sets.append(f"{k} = ${len(args)}{cast}")
    args.append(device_id)
    sql = (
        f'UPDATE "{schema}".devices SET {", ".join(sets)} '
        f"WHERE id = ${len(args)} RETURNING {_PUBLIC_COLS}"
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *args)
    return _row_to_dict(row)


async def update_device_credentials(
    device_id: str,
    username: str | None,
    password_encrypted: str | None,
) -> dict | None:
    schema = _schema()
    sets, args = [], []
    if username is not None:
        args.append(username)
        sets.append(f"username = ${len(args)}")
    if password_encrypted is not None:
        args.append(password_encrypted)
        sets.append(f"password_encrypted = ${len(args)}")
    if not sets:
        return await get_device(device_id)
    args.append(device_id)
    sql = (
        f'UPDATE "{schema}".devices SET {", ".join(sets)} '
        f"WHERE id = ${len(args)} RETURNING {_PUBLIC_COLS}"
    )
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *args)
    return _row_to_dict(row)


async def delete_device(device_id: str) -> bool:
    schema = _schema()
    sql = f'DELETE FROM "{schema}".devices WHERE id = $1'
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(sql, device_id)
    return result.endswith(" 1")
