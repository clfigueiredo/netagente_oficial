"""MCP Postgres Driver — FastMCP server para CRUD de devices do tenant.

Expõe o schema "{TENANT_SCHEMA}".devices via MCP streamable-http,
protegido por Bearer token estático (MCP_DB_TOKEN).
"""

import os
import json
import logging
from typing import Any

from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

import db
import crypto

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger("mcp-postgres")


# ── FastMCP Server ────────────────────────────────────────────────────────────

mcp = FastMCP(
    "mcp-postgres",
    instructions=(
        "Postgres MCP driver — CRUD sobre devices do tenant. "
        "Use device_get_credentials apenas quando precisar da senha em claro "
        "(ex.: para passar a um MCP de SSH)."
    ),
)


def _ok(payload: Any) -> str:
    return json.dumps({"ok": True, "data": payload}, ensure_ascii=False, default=str)


def _err(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)


# ── Read tools ────────────────────────────────────────────────────────────────

@mcp.tool()
async def device_list(type: str = "", active: str = "") -> str:
    """Lista equipamentos do tenant (sem senha).

    Args:
        type: filtra por tipo (ex.: "mikrotik", "linux"). Vazio = todos.
        active: "true" / "false" para filtrar por ativo. Vazio = todos.
    """
    type_filter = type or None
    active_filter: bool | None = None
    if active.lower() == "true":
        active_filter = True
    elif active.lower() == "false":
        active_filter = False
    devices = await db.list_devices(type_filter, active_filter)
    return _ok(devices)


@mcp.tool()
async def device_get(id: str) -> str:
    """Retorna um equipamento pelo id (sem senha)."""
    if not id:
        return _err("id é obrigatório")
    device = await db.get_device(id)
    if device is None:
        return _err(f"device não encontrado: {id}")
    return _ok(device)


@mcp.tool()
async def device_search(query: str) -> str:
    """Busca equipamentos por name, host ou tags (ILIKE %query%)."""
    if not query:
        return _err("query é obrigatório")
    devices = await db.search_devices(query)
    return _ok(devices)


@mcp.tool()
async def device_get_credentials(id: str) -> str:
    """Retorna credenciais em claro (host, port, username, password) para conexão SSH.

    Use com cautela: devolve senha decifrada.
    """
    if not id:
        return _err("id é obrigatório")
    device = await db.get_device_with_encrypted(id)
    if device is None:
        return _err(f"device não encontrado: {id}")
    enc = device.get("password_encrypted")
    try:
        password = crypto.decrypt_password(enc) if enc else ""
    except Exception as e:
        return _err(f"falha ao decifrar senha: {e}")
    return _ok({
        "id": device["id"],
        "name": device["name"],
        "type": device["type"],
        "host": device["host"],
        "port": device["port"],
        "username": device["username"],
        "password": password,
    })


# ── Write tools ───────────────────────────────────────────────────────────────

@mcp.tool()
async def device_create(
    name: str,
    type: str,
    host: str,
    username: str,
    password: str,
    port: int = 22,
    description: str = "",
    location: str = "",
    tags: list | None = None,
) -> str:
    """Cria um novo equipamento no tenant. password é cifrado antes de persistir."""
    for field, value in [("name", name), ("type", type), ("host", host), ("username", username), ("password", password)]:
        if not value:
            return _err(f"{field} é obrigatório")
    try:
        encrypted = crypto.encrypt_password(password)
    except Exception as e:
        return _err(f"falha ao cifrar senha: {e}")
    device = await db.create_device(
        name=name, type_=type, host=host, username=username,
        password_encrypted=encrypted, port=port,
        description=description or None, location=location or None,
        tags=tags or [],
    )
    return _ok(device)


@mcp.tool()
async def device_update(
    id: str,
    name: str = "",
    type: str = "",
    host: str = "",
    port: int = 0,
    description: str = "",
    location: str = "",
    tags: list | None = None,
    active: str = "",
) -> str:
    """Atualiza campos não sensíveis. Passe "" (ou 0 para port) para não alterar.

    Para active use "true" / "false". Para credenciais (username/password)
    use device_update_credentials.
    """
    if not id:
        return _err("id é obrigatório")
    fields: dict[str, Any] = {}
    if name: fields["name"] = name
    if type: fields["type"] = type
    if host: fields["host"] = host
    if port: fields["port"] = port
    if description: fields["description"] = description
    if location: fields["location"] = location
    if tags is not None: fields["tags"] = tags
    if active.lower() == "true": fields["active"] = True
    elif active.lower() == "false": fields["active"] = False
    device = await db.update_device_fields(id, fields)
    if device is None:
        return _err(f"device não encontrado: {id}")
    return _ok(device)


@mcp.tool()
async def device_update_credentials(
    id: str,
    username: str = "",
    password: str = "",
) -> str:
    """Atualiza username e/ou password. Passe "" para não alterar."""
    if not id:
        return _err("id é obrigatório")
    if not username and not password:
        return _err("forneça username, password, ou ambos")
    encrypted = None
    if password:
        try:
            encrypted = crypto.encrypt_password(password)
        except Exception as e:
            return _err(f"falha ao cifrar senha: {e}")
    device = await db.update_device_credentials(id, username or None, encrypted)
    if device is None:
        return _err(f"device não encontrado: {id}")
    return _ok(device)


@mcp.tool()
async def device_delete(id: str) -> str:
    """Apaga um equipamento do tenant."""
    if not id:
        return _err("id é obrigatório")
    deleted = await db.delete_device(id)
    if not deleted:
        return _err(f"device não encontrado: {id}")
    return _ok({"id": id, "deleted": True})


# ── Auth middleware ───────────────────────────────────────────────────────────

class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Exige Authorization: Bearer <MCP_DB_TOKEN> em todas as rotas, exceto /health."""

    def __init__(self, app, token: str):
        super().__init__(app)
        self._token = token

    async def dispatch(self, request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        header = request.headers.get("authorization", "")
        expected = f"Bearer {self._token}"
        if header != expected:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


# ── Health + App ──────────────────────────────────────────────────────────────

async def health(request):
    return JSONResponse({"status": "ok", "driver": "mcp-postgres"})


app = mcp.http_app(path="/mcp", transport="streamable-http")
app.routes.append(Route("/health", health))

_token = os.environ.get("MCP_DB_TOKEN", "").strip()
if not _token:
    raise RuntimeError("MCP_DB_TOKEN não definido no ambiente")
app.add_middleware(BearerAuthMiddleware, token=_token)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)
