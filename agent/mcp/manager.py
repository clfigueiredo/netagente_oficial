"""
manager.py — MCP Manager: discovers, routes, and manages MCP driver microservices.

Responsibilities:
  1. Registry: maintain a map of driver_name → MCPDriver
  2. Health: periodically check driver health endpoints
  3. Discovery: fetch available tools from each driver via MCP protocol
  4. Routing: given a set of scopes, return only relevant tools
  5. Execution: route tool calls through circuit breakers to the correct driver
  6. Credentials: inject device credentials per-request (multi-tenant)
"""

import asyncio
import logging
import time
from typing import Optional

import json as _json

import httpx

from .models import MCPDriver, MCPToolInfo, MCPCallResult, DriverStatus, CircuitState
from .circuit_breaker import CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError
from .observability import logger as obs_logger, metrics as obs_metrics, ToolMetrics

_log = logging.getLogger(__name__)


class MCPManager:
    """
    Central manager for MCP driver microservices.

    Usage:
        manager = MCPManager()
        manager.register("mcp-mikrotik", "http://mcp-mikrotik:8001", "mikrotik",
                         scopes=["system", "interfaces", "routing", "firewall"])
        
        # Discover tools (filtered by scopes from INTENT_ROUTES)
        tools = await manager.discover_tools(scopes=["routing", "system"])
        
        # Call a tool
        result = await manager.call_tool("get_bgp_peers", args={...}, 
                                          credentials={...})
    """

    def __init__(self):
        self._drivers: dict[str, MCPDriver] = {}
        self._circuit_breakers: dict[str, CircuitBreaker] = {}
        self._tool_cache: dict[str, list[MCPToolInfo]] = {}  # driver_name → tools
        self._tool_driver_map: dict[str, str] = {}           # tool_name → driver_name
        self._http_client: Optional[httpx.AsyncClient] = None
        self._sessions: dict[str, str] = {}                  # driver_name → Mcp-Session-Id
        self._cache_ttl_s = 300  # 5 min tool cache
        self._cache_timestamps: dict[str, float] = {}
        self._msg_counter = 0

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    def _next_id(self) -> int:
        self._msg_counter += 1
        return self._msg_counter

    @staticmethod
    def _parse_sse_response(raw: str) -> dict:
        """Parse an SSE response, extracting the last JSON-RPC data payload."""
        result = {}
        for line in raw.splitlines():
            if line.startswith("data: "):
                try:
                    result = _json.loads(line[6:])
                except _json.JSONDecodeError:
                    pass
        return result

    async def _init_session(self, driver: MCPDriver) -> str:
        """Initialize an MCP session with the driver, returns session ID."""
        cached = self._sessions.get(driver.name)
        if cached:
            return cached

        client = await self._get_client()
        resp = await client.post(
            f"{driver.url}{driver.mcp_endpoint}",
            json={
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "netagent-mcp-manager", "version": "1.0"},
                },
            },
            headers={"Accept": "application/json, text/event-stream"},
            timeout=10.0,
        )
        resp.raise_for_status()
        session_id = resp.headers.get("mcp-session-id", "")
        if session_id:
            self._sessions[driver.name] = session_id
        return session_id

    async def _mcp_request(
        self, driver: MCPDriver, method: str, params: dict, timeout: float = 15.0
    ) -> dict:
        """Send a JSON-RPC request to an MCP driver with session management."""
        session_id = await self._init_session(driver)
        client = await self._get_client()

        headers = {"Accept": "application/json, text/event-stream"}
        if session_id:
            headers["Mcp-Session-Id"] = session_id

        resp = await client.post(
            f"{driver.url}{driver.mcp_endpoint}",
            json={
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": method,
                "params": params,
            },
            headers=headers,
            timeout=timeout,
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            data = self._parse_sse_response(resp.text)
        else:
            data = resp.json()

        # If session expired, retry once with fresh session
        if data.get("error", {}).get("code") == -32600:
            self._sessions.pop(driver.name, None)
            return await self._mcp_request(driver, method, params, timeout)

        return data

    async def close(self):
        """Shutdown: close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    async def load_from_db(self, tenant_slug: str = None):
        """
        Load and register MCP drivers from the database.
        If tenant_slug is None, loads from all tenants.
        """
        try:
            import db as _db
            slugs = [tenant_slug] if tenant_slug else await _db.get_all_tenant_slugs()
            loaded = 0
            for slug in slugs:
                drivers = await _db.get_mcp_drivers(slug)
                for d in drivers:
                    if d["name"] not in self._drivers:
                        # Scopes may come as a JSON string or list from DB
                        raw_scopes = d.get("scopes", [])
                        if isinstance(raw_scopes, str):
                            try:
                                raw_scopes = _json.loads(raw_scopes)
                            except (ValueError, TypeError):
                                raw_scopes = []
                        self.register(
                            name=d["name"],
                            url=d["url"],
                            device_type=d["device_type"],
                            scopes=raw_scopes if isinstance(raw_scopes, list) else [],
                        )
                        loaded += 1
            if loaded:
                await self.check_all_health()
                obs_logger.info("drivers_loaded_from_db",
                    count=loaded,
                    tenant=tenant_slug or "all",
                )
        except Exception as e:
            obs_logger.warning("drivers_load_from_db_failed", error=str(e)[:200])

    # ── Registry ──────────────────────────────────────────────────────────────

    def register(
        self,
        name: str,
        url: str,
        device_type: str,
        scopes: list[str] = None,
        config: Optional[CircuitBreakerConfig] = None,
    ):
        """Register an MCP driver microservice."""
        driver = MCPDriver(
            name=name,
            url=url.rstrip("/"),
            device_type=device_type,
            scopes=scopes or [],
            status=DriverStatus.STARTING,
        )
        self._drivers[name] = driver
        self._circuit_breakers[name] = CircuitBreaker(name, config)
        obs_logger.info("driver_registered", driver=name, url=url, scopes=scopes)

    def unregister(self, name: str):
        """Remove a driver from the registry."""
        self._drivers.pop(name, None)
        self._circuit_breakers.pop(name, None)
        self._tool_cache.pop(name, None)
        # Clean tool_driver_map
        self._tool_driver_map = {
            k: v for k, v in self._tool_driver_map.items() if v != name
        }

    def get_driver(self, name: str) -> Optional[MCPDriver]:
        return self._drivers.get(name)

    def list_drivers(self) -> list[dict]:
        """Return status of all registered drivers."""
        result = []
        for name, driver in self._drivers.items():
            cb = self._circuit_breakers.get(name)
            result.append({
                "name": name,
                "url": driver.url,
                "device_type": driver.device_type,
                "scopes": driver.scopes,
                "status": driver.status.value,
                "circuit": cb.get_status() if cb else None,
            })
        return result

    # ── Health Check ──────────────────────────────────────────────────────────

    async def check_health(self, driver_name: str) -> bool:
        """Check if a driver is healthy via its health endpoint."""
        driver = self._drivers.get(driver_name)
        if not driver:
            return False

        try:
            client = await self._get_client()
            resp = await client.get(
                f"{driver.url}{driver.health_endpoint}",
                timeout=5.0,
            )
            healthy = resp.status_code == 200
            driver.status = DriverStatus.ONLINE if healthy else DriverStatus.DEGRADED
            return healthy
        except Exception as e:
            driver.status = DriverStatus.OFFLINE
            obs_logger.warning("health_check_failed", driver=driver_name, error=str(e)[:200])
            return False

    async def check_all_health(self):
        """Check health of all registered drivers concurrently."""
        tasks = [self.check_health(name) for name in self._drivers]
        await asyncio.gather(*tasks, return_exceptions=True)

    # ── Tool Discovery ────────────────────────────────────────────────────────

    async def discover_tools(
        self,
        scopes: list[str] = None,
        device_type: str = None,
        force_refresh: bool = False,
    ) -> list[MCPToolInfo]:
        """
        Discover tools from all relevant drivers, filtered by scopes.

        This is the key function for the Tool Filtering Strategy:
        INTENT_ROUTES → mcp_scopes → discover_tools(scopes) → filtered tool list
        """
        relevant_drivers = self._filter_drivers(scopes, device_type)

        all_tools = []
        for driver_name in relevant_drivers:
            tools = await self._get_driver_tools(driver_name, force_refresh)
            if scopes:
                tools = [t for t in tools if t.scope in scopes]
            all_tools.extend(tools)

        obs_logger.info("tools_discovered",
            total=len(all_tools),
            scopes=scopes,
            drivers=[d for d in relevant_drivers],
        )
        return all_tools

    def _filter_drivers(
        self,
        scopes: list[str] = None,
        device_type: str = None,
    ) -> list[str]:
        """Filter drivers by scopes and/or device_type."""
        result = []
        for name, driver in self._drivers.items():
            if driver.status == DriverStatus.OFFLINE:
                continue
            cb = self._circuit_breakers.get(name)
            if cb and cb.state == CircuitState.OPEN:
                continue
            if device_type and driver.device_type != device_type:
                continue
            if scopes and not any(s in driver.scopes for s in scopes):
                continue
            result.append(name)
        return result

    async def _get_driver_tools(
        self, driver_name: str, force_refresh: bool = False
    ) -> list[MCPToolInfo]:
        """
        Get tool list from a driver. Uses cache unless expired or force_refresh.
        
        Calls the MCP tools/list endpoint to discover available tools.
        """
        now = time.monotonic()
        cached_at = self._cache_timestamps.get(driver_name, 0)

        if not force_refresh and (now - cached_at) < self._cache_ttl_s:
            cached = self._tool_cache.get(driver_name, [])
            if cached:
                return cached

        driver = self._drivers.get(driver_name)
        if not driver:
            return []

        try:
            data = await self._mcp_request(driver, "tools/list", {})
            raw_tools = data.get("result", {}).get("tools", [])

            tools = []
            for t in raw_tools:
                tool_name = t.get("name", "")
                # Derive scope from tool name prefix: "routing_get_bgp" → "routing"
                scope = tool_name.split("_")[0] if "_" in tool_name else "general"
                info = MCPToolInfo(
                    name=tool_name,
                    description=t.get("description", ""),
                    driver=driver_name,
                    scope=scope,
                    input_schema=t.get("inputSchema", {}),
                )
                tools.append(info)
                self._tool_driver_map[tool_name] = driver_name

            self._tool_cache[driver_name] = tools
            self._cache_timestamps[driver_name] = now

            obs_logger.info("tools_fetched",
                driver=driver_name,
                count=len(tools),
            )
            return tools

        except Exception as e:
            obs_logger.error("tools_fetch_failed",
                driver=driver_name,
                error=str(e)[:200],
            )
            return self._tool_cache.get(driver_name, [])

    # ── Tool Execution ────────────────────────────────────────────────────────

    async def call_tool(
        self,
        tool_name: str,
        args: dict = None,
        credentials: dict = None,
        tenant: str = "",
        conversation_id: str = "",
    ) -> MCPCallResult:
        """
        Call an MCP tool through its driver's circuit breaker.

        Credentials are injected per-request for multi-tenant support:
        {host, port, username, password}
        """
        driver_name = self._tool_driver_map.get(tool_name)
        if not driver_name:
            return MCPCallResult(
                tool=tool_name, driver="unknown",
                success=False, error=f"Tool '{tool_name}' not found in any driver",
            )

        driver = self._drivers.get(driver_name)
        if not driver:
            return MCPCallResult(
                tool=tool_name, driver=driver_name,
                success=False, error=f"Driver '{driver_name}' not registered",
            )

        cb = self._circuit_breakers.get(driver_name)
        if not cb:
            return MCPCallResult(
                tool=tool_name, driver=driver_name,
                success=False, error=f"No circuit breaker for '{driver_name}'",
            )

        start = time.monotonic()
        try:
            result = await cb.call(
                self._execute_mcp_call,
                driver, tool_name, args or {}, credentials or {},
            )
            elapsed = (time.monotonic() - start) * 1000

            obs_metrics.record_tool_call(ToolMetrics(
                tool=tool_name, duration_ms=round(elapsed, 1),
                success=True, tenant=tenant, conversation_id=conversation_id,
            ))

            return MCPCallResult(
                tool=tool_name, driver=driver_name,
                success=True, result=str(result),
                duration_ms=round(elapsed, 1),
            )

        except CircuitBreakerError as e:
            elapsed = (time.monotonic() - start) * 1000
            return MCPCallResult(
                tool=tool_name, driver=driver_name,
                success=False, error=str(e),
                duration_ms=round(elapsed, 1),
            )

        except Exception as e:
            elapsed = (time.monotonic() - start) * 1000
            obs_metrics.record_tool_call(ToolMetrics(
                tool=tool_name, duration_ms=round(elapsed, 1),
                success=False, error=str(e),
                tenant=tenant, conversation_id=conversation_id,
            ))
            return MCPCallResult(
                tool=tool_name, driver=driver_name,
                success=False, error=str(e),
                duration_ms=round(elapsed, 1),
            )

    async def _execute_mcp_call(
        self,
        driver: MCPDriver,
        tool_name: str,
        args: dict,
        credentials: dict,
    ) -> str:
        """Execute a JSON-RPC tools/call to the MCP driver."""
        call_args = {**args}
        if credentials:
            call_args["credentials"] = credentials

        timeout = self._circuit_breakers[driver.name].config.call_timeout_s
        data = await self._mcp_request(
            driver, "tools/call",
            {"name": tool_name, "arguments": call_args},
            timeout=timeout,
        )

        if "error" in data:
            raise RuntimeError(data["error"].get("message", str(data["error"])))

        # Extract text content from MCP response
        content = data.get("result", {}).get("content", [])
        text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
        return "\n".join(text_parts) or str(data.get("result", ""))

    # ── Convenience ───────────────────────────────────────────────────────────

    def get_circuit_status(self) -> dict:
        """Return circuit breaker status for all drivers."""
        return {
            name: cb.get_status()
            for name, cb in self._circuit_breakers.items()
        }

    def reset_circuit(self, driver_name: str):
        """Manually reset a driver's circuit breaker."""
        cb = self._circuit_breakers.get(driver_name)
        if cb:
            cb.reset()
