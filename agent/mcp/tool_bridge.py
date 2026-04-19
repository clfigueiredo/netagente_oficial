"""
tool_bridge.py — Bridge between MCP tools and LangChain StructuredTool.

Converts MCPToolInfo objects (from MCPManager.discover_tools) into
LangChain StructuredTool instances that can be bound to LLMs via
llm.bind_tools(). When the LLM calls a tool, it routes through
MCPManager.call_tool() → CircuitBreaker → JSON-RPC → MCP driver.
"""

import logging
from typing import Optional

from pydantic import BaseModel, Field, create_model
from langchain_core.tools import StructuredTool

from .models import MCPToolInfo

_log = logging.getLogger(__name__)


def _build_pydantic_schema(tool_info: MCPToolInfo) -> type[BaseModel]:
    """
    Dynamically build a Pydantic model from an MCP tool's inputSchema.

    MCP inputSchema follows JSON Schema. We convert simple types:
    string, integer, number, boolean. Nested objects become dict.
    """
    input_schema = tool_info.input_schema
    properties = input_schema.get("properties", {})
    required_fields = set(input_schema.get("required", []))

    if not properties:
        # No input parameters → empty schema
        return create_model(f"{tool_info.name}_Input")

    field_defs = {}
    type_map = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "object": dict,
        "array": list,
    }

    for name, prop in properties.items():
        # Skip credentials — injected by the bridge, not by the LLM
        if name == "credentials":
            continue

        py_type = type_map.get(prop.get("type", "string"), str)
        description = prop.get("description", "")
        default = prop.get("default")

        if name in required_fields:
            field_defs[name] = (py_type, Field(description=description))
        else:
            field_defs[name] = (
                Optional[py_type],
                Field(default=default, description=description),
            )

    if not field_defs:
        return create_model(f"{tool_info.name}_Input")

    return create_model(f"{tool_info.name}_Input", **field_defs)


def mcp_tool_to_langchain(
    tool_info: MCPToolInfo,
    mcp_manager,  # MCPManager instance
    credentials: dict = None,
    tenant: str = "",
    conversation_id: str = "",
    agent_mode: str = "restricted",
) -> StructuredTool:
    """
    Convert an MCPToolInfo into a LangChain StructuredTool.

    The resulting tool, when invoked by the LLM, calls:
      MCPManager.call_tool(tool_name, args, credentials)
    which routes through CircuitBreaker → MCP driver.
    """
    schema = _build_pydantic_schema(tool_info)

    # Capture in closure
    _manager = mcp_manager
    _tool_name = tool_info.name
    _creds = credentials or {}
    _tenant = tenant
    _conv_id = conversation_id
    _mode = agent_mode

    # Heuristic for read-only vs destructive tools
    # Usually read-only tools contain get_, list_, _print, _ping, _traceroute, _fingerprint
    # We will block if mode is restricted and tool doesn't look like a read tool
    _read_keywords = ["get_", "list_", "ping", "traceroute", "fingerprint"]
    _is_safe = any(kw in _tool_name for kw in _read_keywords)

    async def _invoke(**kwargs) -> str:
        if _mode == "restricted" and not _is_safe:
            return "🚫 **Comando bloqueado** (modo restricted). Ações que modificam o sistema não são permitidas. Para fazer isso, altere o modo do agente para 'Standard' ou 'Root'."

        result = await _manager.call_tool(
            tool_name=_tool_name,
            args=kwargs,
            credentials=_creds,
            tenant=_tenant,
            conversation_id=_conv_id,
        )
        if result.success:
            return result.result
        return f"Erro: {result.error}"

    return StructuredTool(
        name=tool_info.name,
        description=tool_info.description,
        args_schema=schema,
        coroutine=_invoke,
        func=None,
    )


def mcp_tools_to_langchain(
    tools: list[MCPToolInfo],
    mcp_manager,
    credentials: dict = None,
    tenant: str = "",
    conversation_id: str = "",
    agent_mode: str = "restricted",
) -> list[StructuredTool]:
    """Convert a list of MCPToolInfo into LangChain StructuredTools."""
    return [
        mcp_tool_to_langchain(t, mcp_manager, credentials, tenant, conversation_id, agent_mode)
        for t in tools
    ]
