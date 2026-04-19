"""
linux_tools.py — SSH tools for Linux servers with correct LangChain tool patterns.
Each tool has an explicit Pydantic schema so LLMs can bind and call them reliably.
"""

import asyncio
import json
import logging
from typing import Optional, Callable
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from tools.base_tools import BaseTools


class LinuxTools(BaseTools):
    DEVICE_TYPE = "linux"
    _log = logging.getLogger("linux_tools")

    def get_tools(self) -> list[StructuredTool]:
        return [
            self._tool_get_status(),
            self._tool_get_processes(),
            self._tool_get_network(),
            self._tool_get_routes(),
            self._tool_get_default_route(),
            self._tool_get_logs(),
            self._tool_get_docker_status(),
            self._tool_get_services(),
            self._tool_get_disk_usage(),
            self._tool_run_command(),
            self._get_ping_host_tool(),
            self._tool_fingerprint_device(),
            self._tool_run_skill(),
            self._get_propose_action_tool(),
            self._get_save_knowledge_tool("linux, networking, security, monitoring, docker"),
            self._get_save_memory_tool(),
        ]

    # ── Tool definitions ───────────────────────────────────────────────────────

    def _tool_run_skill(self) -> StructuredTool:
        """
        run_skill tool — executes a DB skill step-by-step via SSH.
        Does fingerprint_device first as mandatory pre-check.
        Emits real-time socket events per step via _emit_fn (injected by orchestrator).
        """
        _self = self

        class _In(BaseModel):
            skill_name: str = Field(
                description="Nome exato da skill no banco (ex: install_zabbix_docker, install_docker)"
            )

        async def fn(skill_name: str) -> str:
            import db
            from skill_executor import run_skill_steps

            # Use real conversation_id and tenant_slug from BaseTools (injected by orchestrator)
            conversation_id = _self.conversation_id
            tenant_slug = _self.tenant_slug

            _self._log.warning(f"[run_skill] START skill={skill_name} conv={conversation_id} tenant={tenant_slug}")

            # Step 0: mandatory pre-check via fingerprint_device
            fingerprint = await _self.fingerprint_device()
            precheck_summary = (
                f"## 🔍 Pré-verificação do servidor\n{fingerprint[:1000]}"
            )
            _self._log.warning(f"[run_skill] fingerprint done, len={len(fingerprint)}")

            # Emit pre-check info
            emit = _self._emit_fn
            _self._log.warning(f"[run_skill] emit_fn={'SET' if emit else 'NONE (no streaming)'}")
            if emit:
                emit("agent:skill_step", {
                    "conversationId": conversation_id,
                    "skillName": skill_name,
                    "stepId": -1,
                    "description": "🔍 Verificando ambiente do servidor...",
                    "status": "ok",
                    "output": fingerprint[:800],
                })

            # Load skill steps from DB
            skill_row = await db.get_skill_by_name(skill_name)
            _self._log.warning(f"[run_skill] DB lookup skill_name='{skill_name}' found={skill_row is not None}")
            if not skill_row:
                return (
                    f"Skill '{skill_name}' não encontrada na base de dados.\n"
                    f"Use `propose_action` para instalar manualmente."
                )

            steps = skill_row.get("steps") or []
            _self._log.warning(f"[run_skill] steps count={len(steps)} types={[type(s).__name__ for s in steps[:3]]}")
            if not steps:
                return f"Skill '{skill_name}' existe mas não tem steps definidos."

            # Execute steps with streaming
            async def ssh_runner(cmd: str, timeout: int) -> tuple[str, int]:
                _self._log.warning(f"[run_skill] ssh_runner cmd={cmd[:60]!r} timeout={timeout}")
                result = await _self._async_run_with_exit_code(cmd, timeout)
                _self._log.warning(f"[run_skill] ssh_runner exit_code={result[1]} output={result[0][:80]!r}")
                return result

            _self._log.warning(f"[run_skill] calling run_skill_steps...")
            try:
                summary = await run_skill_steps(
                    steps=steps,
                    ssh_runner=ssh_runner,
                    emit=emit or (lambda *a, **kw: None),
                    conversation_id=conversation_id,
                    skill_name=skill_name,
                )
                _self._log.warning(f"[run_skill] run_skill_steps done, summary len={len(summary)}")
            except Exception as exc:
                _self._log.error(f"[run_skill] run_skill_steps EXCEPTION: {exc}", exc_info=True)
                raise

            return precheck_summary + "\n\n" + summary

        return StructuredTool(
            name="run_skill",
            description=(
                "Executa uma skill de instalação/configuração do banco, step-by-step, via SSH. "
                "Faz fingerprint_device primeiro como pré-verificação. "
                "Use quando o usuário pedir para instalar Zabbix, Grafana, Docker, NGINX, etc. "
                "e a skill já existir no banco. Apenas informe o nome da skill."
            ),
            args_schema=_In,
            coroutine=fn,
            func=None,
        )

    def _tool_get_status(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_status()

        return StructuredTool(
            name="get_status",
            description="Obtém CPU, RAM, disco e uptime do servidor Linux",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_processes(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_processes()

        return StructuredTool(
            name="get_processes",
            description="Lista os 15 processos com maior uso de CPU",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_network(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_network()

        return StructuredTool(
            name="get_network",
            description="Mostra interfaces de rede, IPs e portas abertas (ss -tulpn)",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_routes(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_routes()

        return StructuredTool(
            name="get_routes",
            description="Mostra tabela de rotas (ip route show)",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_default_route(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_default_route()

        return StructuredTool(
            name="get_default_route",
            description="Obtém a rota default do servidor",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_logs(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            service: str = Field(description="nome do serviço: nginx, syslog, freeradius, etc")
            lines: int = Field(default=30, description="número de linhas (max 100)")

        async def fn(service: str = "syslog", lines: int = 30) -> str:
            return await _self.get_logs(service, lines)

        return StructuredTool(
            name="get_logs",
            description="Lê logs de um serviço (journalctl ou /var/log)",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_docker_status(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_docker_status()

        return StructuredTool(
            name="get_docker_status",
            description="Lista containers Docker e seu status",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_services(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_services()

        return StructuredTool(
            name="get_services",
            description="Lista todos os serviços ativos (systemd)",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_get_disk_usage(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            pass

        async def fn() -> str:
            return await _self.get_disk_usage()

        return StructuredTool(
            name="get_disk_usage",
            description="Mostra uso de disco por partição (df -h) e maiores diretórios",
            args_schema=_In, coroutine=fn, func=None,
        )

    def _tool_run_command(self) -> StructuredTool:
        _self = self

        class _In(BaseModel):
            command: str = Field(description="comando shell a executar")

        async def fn(command: str) -> str:
            return await _self.run_command(command)

        return StructuredTool(
            name="run_command",
            description=(
                "Executa um comando no servidor. "
                "Em modo restricted: somente leitura. "
                "Em modo standard/root: qualquer comando autorizado."
            ),
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
                "Coleta estado completo do servidor: OS, RAM, disco, Docker, serviços, pacotes instalados, portas. "
                "Use SOMENTE se o Snapshot que você tem no contexto atual for insuficiente para responder à requisição."
            ),
            args_schema=_In, coroutine=fn, func=None,
        )

    # ── Implementations ────────────────────────────────────────────────────────

    async def get_status(self) -> str:
        cpu = await self._async_run(
            "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1 2>/dev/null "
            "|| mpstat 1 1 | awk '/Average/{print 100-$NF}'"
        )
        mem = await self._async_run(
            "free -m | awk 'NR==2{printf \"%s/%sMB (%.0f%%)\", $3,$2,$3*100/$2}'"
        )
        disk = await self._async_run(
            "df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'"
        )
        uptime = await self._async_run("uptime -p 2>/dev/null || uptime")
        return f"CPU: {cpu}% | RAM: {mem} | Disco: {disk} | {uptime}"

    async def get_processes(self) -> str:
        return await self._async_run("ps aux --sort=-%cpu | head -16")

    async def get_network(self) -> str:
        return await self._async_run(
            "ip -brief addr show 2>/dev/null && echo '--- Portas ---' "
            "&& ss -tulpn 2>/dev/null | head -25"
        )

    async def get_routes(self) -> str:
        return await self._async_run("ip route show")

    async def get_default_route(self) -> str:
        return await self._async_run("ip route show default")

    async def get_logs(self, service: str = "syslog", lines: int = 30) -> str:
        lines = min(lines, 100)
        return await self._async_run(
            f"journalctl -u {service} -n {lines} --no-pager 2>/dev/null || "
            f"tail -n {lines} /var/log/{service} 2>/dev/null || "
            f"tail -n {lines} /var/log/syslog 2>/dev/null"
        )

    async def get_docker_status(self) -> str:
        return await self._async_run(
            "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null "
            "|| echo 'Docker não disponível'"
        )

    async def get_services(self) -> str:
        return await self._async_run(
            "systemctl list-units --type=service --state=running --no-pager --plain 2>/dev/null | head -40"
        )

    async def get_disk_usage(self) -> str:
        return await self._async_run(
            "df -h && echo '' && du -sh /opt/* /var/lib/* 2>/dev/null | sort -rh | head -10"
        )

    async def run_command(self, command: str) -> str:
        cmd = command.lower().strip()

        if self.agent_mode == "root":
            return await self._async_run(command)

        if self.agent_mode == "standard":
            destructive = ["rm -rf /", "mkfs", "dd if=", "shred", "> /dev/",
                           "shutdown", "reboot", "poweroff"]
            if any(p in cmd for p in destructive):
                return "🚫 Comando destrutivo bloqueado. Use propose_action."
            return await self._async_run(command)

        blocked_patterns = [
            "apt ", "apt-get ", "yum ", "dnf ", "pip install", "npm install",
            "rm ", "rmdir", "shred", "dd ", "mkfs", "fdisk", "truncate",
            "shutdown", "reboot", "poweroff", "halt",
            "systemctl start", "systemctl stop", "systemctl restart",
            "systemctl enable", "systemctl disable",
            "chmod", "chown", "iptables ", "ufw ", "nft ",
            "ip link set", "ip addr add", "ip addr del", "ip route add", "ip route del",
            "useradd", "userdel", "usermod", "passwd ",
            "curl | ", "wget | ", "bash -c", "sh -c", "eval ", "crontab",
            "kill ", "killall", "pkill", "sed -i", "tee ",
        ]
        if any(p in cmd for p in blocked_patterns):
            return (
                "🚫 **Comando bloqueado** (modo restricted).\n"
                "Use `propose_action` para que o usuário aprove instalações ou modificações."
            )
        return await self._async_run(command)

    async def ping_host(self, host: str, count: int = 4) -> str:
        count = min(count, 10)
        return await self._async_run(f"ping -c {count} -W 2 {host}")

    async def fingerprint_device(self) -> str:
        """Collect full device state in ONE SSH session (single connection)."""
        script = (
            "echo '===OS===' && (uname -a 2>/dev/null; lsb_release -d 2>/dev/null || head -5 /etc/os-release 2>/dev/null) && "
            "echo '===MEM===' && free -h && "
            "echo '===DISK===' && df -h && "
            "echo '===DOCKER===' && (docker --version 2>/dev/null && docker ps --format '{{.Names}}:{{.Status}}' 2>/dev/null || echo 'Docker: não instalado') && "
            "echo '===SERVICES===' && (systemctl list-units --type=service --state=running --no-pager --plain 2>/dev/null | awk '{print $1}' | head -30) && "
            "echo '===PORTS===' && (ss -tulpn 2>/dev/null | awk 'NR>1{print $1,$5}' | head -20) && "
            "echo '===PKGS===' && (dpkg -l 2>/dev/null | awk 'NR>5 && $1==\"ii\" {print $2}' | grep -E 'nginx|apache|mysql|postgres|redis|php|python|node|zabbix|grafana|prometheus' || rpm -qa 2>/dev/null | grep -E 'nginx|apache|mysql|postgres|redis|php|node|zabbix' || echo 'gestor não identificado')"
        )
        raw = await self._async_run(script, timeout=30)

        # Parse sections
        sections = {}
        current = "header"
        for line in raw.splitlines():
            for tag in ("OS", "MEM", "DISK", "DOCKER", "SERVICES", "PORTS", "PKGS"):
                if line.strip() == f"==={tag}===":
                    current = tag
                    break
            else:
                sections.setdefault(current, []).append(line)

        def _sec(key):
            return "\n".join(sections.get(key, ["(sem dados)"])).strip() or "(sem dados)"

        return (
            "## 🖥️ Fingerprint do Servidor\n\n"
            f"**OS:** {_sec('OS')}\n\n"
            f"**Memória:**\n{_sec('MEM')}\n\n"
            f"**Disco:**\n{_sec('DISK')}\n\n"
            f"**Docker:**\n{_sec('DOCKER')}\n\n"
            f"**Serviços ativos:**\n{_sec('SERVICES')}\n\n"
            f"**Portas abertas:**\n{_sec('PORTS')}\n\n"
            f"**Pacotes relevantes instalados:**\n{_sec('PKGS')}"
        )

