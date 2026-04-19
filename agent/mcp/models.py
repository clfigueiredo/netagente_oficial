"""
models.py — Data models for MCP driver registry and tool discovery.
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


class DriverStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    DEGRADED = "degraded"
    STARTING = "starting"


class CircuitState(str, Enum):
    CLOSED = "closed"       # Normal operation
    OPEN = "open"           # Failing, reject calls
    HALF_OPEN = "half_open" # Testing recovery


@dataclass
class MCPDriver:
    """Represents a registered MCP driver microservice."""
    name: str                              # e.g. "mcp-mikrotik"
    url: str                               # e.g. "http://mcp-mikrotik:8001"
    device_type: str                       # "mikrotik" | "linux"
    scopes: list[str] = field(default_factory=list)  # ["system", "routing", "firewall"]
    status: DriverStatus = DriverStatus.OFFLINE
    circuit_state: CircuitState = CircuitState.CLOSED
    version: str = ""
    health_endpoint: str = "/health"
    transport: str = "streamable-http"     # "streamable-http" | "sse" | "stdio"
    mcp_endpoint: str = "/mcp"            # MCP protocol endpoint


@dataclass
class MCPToolInfo:
    """Lightweight tool descriptor from MCP discovery."""
    name: str
    description: str
    driver: str                            # which driver provides this tool
    scope: str                             # which scope it belongs to
    input_schema: dict = field(default_factory=dict)


@dataclass
class MCPCallResult:
    """Result from an MCP tool call."""
    tool: str
    driver: str
    success: bool
    result: str = ""
    error: Optional[str] = None
    duration_ms: float = 0.0
    retried: bool = False
