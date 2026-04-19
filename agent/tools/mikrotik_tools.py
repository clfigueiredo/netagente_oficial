"""
mikrotik_tools.py — SSH tools for MikroTik RouterOS with correct LangChain tool patterns.
Each tool has an explicit Pydantic schema so LLMs can bind and call them reliably.
"""

import asyncio
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from tools.base_tools import BaseTools


class MikroTikTools(BaseTools):
    DEVICE_TYPE = "mikrotik"

    def get_tools(self) -> list[StructuredTool]:
        return [
            self._tool_get_status(),
            self._tool_get_interfaces(),
            self._tool_get_bgp_peers(),
            self._tool_get_routes(),
            self._tool_get_logs(),
            self._tool_get_firewall_rules(),
            self._tool_get_nat_rules(),
            self._tool_get_dhcp_leases(),
            self._tool_get_queues(),
            self._tool_get_hotspot_users(),
            self._tool_get_ospf(),
            self._tool_get_address_lists(),
            self._tool_get_pppoe_sessions(),
            self._get_ping_host_tool(),
            self._tool_fingerprint_device(),
            self._get_propose_action_tool(),
            self._get_save_knowledge_tool("mikrotik, networking, bgp, firewall, qos, pppoe"),
            self._get_save_memory_tool(),
        ]

    # ── Tool definitions ───────────────────────────────────────────────────────

    def _tool_get_status(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_status()

        return StructuredTool(
            name="get_status",
            description="Obtém CPU, RAM, uptime e versão do RouterOS",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_interfaces(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_interfaces()

        return StructuredTool(
            name="get_interfaces",
            description="Lista interfaces com estado, tráfego e erros",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_bgp_peers(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_bgp_peers()

        return StructuredTool(
            name="get_bgp_peers",
            description="Lista peers BGP com estado, uptime e prefixos recebidos/anunciados",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_routes(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            filter: str = Field(default="", description="filtro opcional ex: '0.0.0.0/0' ou IP de prefixo")

        async def fn(filter: str = "") -> str:
            return await _self.get_routes(filter)

        return StructuredTool(
            name="get_routes",
            description="Lista tabela de rotas",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_logs(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            topics: str = Field(default="system", description="tópicos: bgp, firewall, system, dhcp, ppp, etc")
            lines: int = Field(default=30, description="número de linhas (max 100)")

        async def fn(topics: str = "system", lines: int = 30) -> str:
            return await _self.get_logs(topics, lines)

        return StructuredTool(
            name="get_logs",
            description="Lê logs do RouterOS",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_firewall_rules(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_firewall_rules()

        return StructuredTool(
            name="get_firewall_rules",
            description="Lista regras de firewall filter e mangle",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_nat_rules(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_nat_rules()

        return StructuredTool(
            name="get_nat_rules",
            description="Lista regras NAT (masquerade, dst-nat, src-nat)",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_dhcp_leases(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_dhcp_leases()

        return StructuredTool(
            name="get_dhcp_leases",
            description="Lista leases DHCP ativos com IP, MAC e hostname",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_queues(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_queues()

        return StructuredTool(
            name="get_queues",
            description="Lista filas simples e queue tree com limites de banda",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_hotspot_users(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_hotspot_users()

        return StructuredTool(
            name="get_hotspot_users",
            description="Lista usuários hotspot ativos",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_ospf(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_ospf()

        return StructuredTool(
            name="get_ospf",
            description="Lista vizinhos OSPF e estado das adjacências",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_address_lists(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_address_lists()

        return StructuredTool(
            name="get_address_lists",
            description="Lista address-lists do firewall",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_pppoe_sessions(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_pppoe_sessions()

        return StructuredTool(
            name="get_pppoe_sessions",
            description="Lista sessões PPPoE ativas com usuário, IP e uptime",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_fingerprint_device(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.fingerprint_device()

        return StructuredTool(
            name="fingerprint_device",
            description=(
                "Coleta estado completo do RouterOS: versão, interfaces, IPs, rotas, NAT, firewall. "
                "Use SOMENTE se o Snapshot que você tem no contexto atual for insuficiente para responder à requisição."
            ),
            args_schema=_In, coroutine=fn, func=None,
        )

    # ── Implementations ────────────────────────────────────────────────────────

    async def get_status(self) -> str:
        cmd = (
            ":put [/system resource get cpu-load]; "
            ":put [/system resource get free-memory]; "
            ":put [/system resource get total-memory]; "
            ":put [/system resource get uptime]; "
            ":do { :put [/system routerboard get current-firmware] } on-error={ :put \"N/A\" }"
        )
        res = await self._async_run(cmd)
        lines = [x.strip() for x in res.splitlines() if x.strip()]
        if len(lines) >= 5:
            cpu, free_mem, total_mem, uptime, firmware = lines[-5:]
            try:
                used_mb = (int(total_mem) - int(free_mem)) // 1024 // 1024
                total_mb = int(total_mem) // 1024 // 1024
            except (ValueError, TypeError):
                used_mb = total_mb = "?"
            return f"CPU: {cpu}% | RAM: {used_mb}MB/{total_mb}MB | Uptime: {uptime} | Firmware: {firmware}"
        return f"Erro ao ler status: {res}"

    async def get_interfaces(self) -> str:
        basic = await self._async_run("/interface print detail without-paging")
        traffic = await self._async_run("/interface print stats without-paging")
        return f"=== Interfaces ===\n{basic}\n\n=== Tráfego ===\n{traffic}"

    async def get_bgp_peers(self) -> str:
        v1 = await self._async_run("/routing bgp peer print detail without-paging 2>/dev/null")
        if v1 and "Erro" not in v1:
            return v1
        return await self._async_run("/routing/bgp/peer print detail without-paging 2>/dev/null")

    async def get_routes(self, filter: str = "") -> str:
        cmd = "/ip route print without-paging"
        if filter:
            cmd += f' where dst-address~"{filter}"'
        return await self._async_run(cmd)

    async def get_logs(self, topics: str = "system", lines: int = 30) -> str:
        lines = min(lines, 100)
        return await self._async_run(
            f'/log print without-paging where topics~"{topics}" count-max={lines}'
        )

    async def get_firewall_rules(self) -> str:
        fw = await self._async_run("/ip firewall filter print without-paging")
        mangle = await self._async_run("/ip firewall mangle print without-paging")
        return f"=== Filter ===\n{fw}\n\n=== Mangle ===\n{mangle}"

    async def get_nat_rules(self) -> str:
        return await self._async_run("/ip firewall nat print without-paging")

    async def get_dhcp_leases(self) -> str:
        return await self._async_run("/ip dhcp-server lease print without-paging")

    async def get_queues(self) -> str:
        simple = await self._async_run("/queue simple print without-paging")
        tree = await self._async_run("/queue tree print without-paging")
        return f"=== Filas Simples ===\n{simple}\n\n=== Queue Tree ===\n{tree}"

    async def get_hotspot_users(self) -> str:
        return await self._async_run("/ip hotspot active print without-paging")

    async def get_ospf(self) -> str:
        v1 = await self._async_run("/routing ospf neighbor print without-paging 2>/dev/null")
        if v1 and "Erro" not in v1:
            return v1
        return await self._async_run("/routing/ospf/neighbor print without-paging 2>/dev/null")

    async def get_address_lists(self) -> str:
        return await self._async_run("/ip firewall address-list print without-paging")

    async def get_pppoe_sessions(self) -> str:
        return await self._async_run("/ppp active print without-paging")

    async def ping_host(self, host: str, count: int = 4) -> str:
        count = min(count, 10)
        return await self._async_run(f"/ping address={host} count={count}")

    async def fingerprint_device(self) -> str:
        cmds = [
            ":put [/system resource get version]",
            ":put [/system resource get board-name]",
            "/ip address print without-paging",
            "/ip route print where active=yes without-paging",
            "/ip firewall nat print count-only without-paging",
            "/ip firewall filter print count-only without-paging",
            "/interface print count-only without-paging",
            "/routing bgp peer print count-only without-paging 2>/dev/null || echo 0",
            "/ppp active print count-only without-paging",
        ]
        results = []
        for cmd in cmds:
            try:
                res = await self._async_run(cmd)
                results.append(str(res))
            except Exception as e:
                results.append(f"Erro: {e}")
                
        version, board, addresses, routes, nat_count, fw_count, iface_count, bgp_count, pppoe_count = results
        return (
            "## 🖧 Fingerprint do RouterOS\n\n"
            f"**Hardware:** {board} | **RouterOS:** {version}\n\n"
            f"**Interfaces:** {iface_count} | **BGP Peers:** {bgp_count} | "
            f"**Sessões PPPoE:** {pppoe_count}\n\n"
            f"**Endereços IP:**\n{addresses}\n\n"
            f"**Rotas ativas:**\n{routes}\n\n"
            f"**Firewall:** {fw_count} regras filter | {nat_count} regras NAT"
        )
