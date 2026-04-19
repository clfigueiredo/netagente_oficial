"""
MCP Linux Driver — FastMCP server exposing Linux server tools.

Each tool receives device credentials via credentials in the arguments,
executes SSH commands, and returns structured text results.

Scopes: system, network, services, docker, logs, storage
"""

import os
import asyncio
import logging

from fastmcp import FastMCP

from ssh import ssh_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger("mcp-linux")


# ── Credential helper ─────────────────────────────────────────────────────────

def _creds(args: dict) -> tuple[str, int, str, str, dict]:
    """Extract and remove credentials from args. Returns (host, port, user, pass, clean_args)."""
    creds = args.pop("credentials", {})
    host = creds.get("host", "")
    port = int(creds.get("port", 22))
    username = creds.get("username", "")
    password = creds.get("password", "")
    if not host or not username:
        raise ValueError("Missing device credentials (credentials.host and credentials.username required)")
    return host, port, username, password, args


# ── Agent mode helper ─────────────────────────────────────────────────────────

BLOCKED_PATTERNS_RESTRICTED = [
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

DESTRUCTIVE_PATTERNS = ["rm -rf /", "mkfs", "dd if=", "shred", "> /dev/",
                         "shutdown", "reboot", "poweroff"]


def _check_command_allowed(command: str, agent_mode: str) -> str | None:
    """Return error message if command is blocked, None if allowed."""
    cmd = command.lower().strip()
    if agent_mode == "root":
        return None
    if agent_mode == "standard":
        if any(p in cmd for p in DESTRUCTIVE_PATTERNS):
            return "🚫 Comando destrutivo bloqueado. Use propose_action."
        return None
    # restricted (default)
    if any(p in cmd for p in BLOCKED_PATTERNS_RESTRICTED):
        return ("🚫 **Comando bloqueado** (modo restricted).\n"
                "Use `propose_action` para que o usuário aprove instalações ou modificações.")
    return None


# ── FastMCP Server ────────────────────────────────────────────────────────────

mcp = FastMCP(
    "mcp-linux",
    instructions="Linux Server MCP driver — SSH tools for ISP infrastructure",
)


# ── Scope: system ─────────────────────────────────────────────────────────────

@mcp.tool()
async def system_get_status(
    credentials: dict = {},
) -> str:
    """
    Obtém CPU, RAM, disco e uptime do servidor Linux.
    ATENÇÃO: Use SOMENTE UMA VEZ por interação para evitar loops desnecessários.
    """
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cpu = await ssh_pool.async_run(host, port, user, pwd,
        "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1 2>/dev/null "
        "|| mpstat 1 1 | awk '/Average/{print 100-$NF}'")
    mem = await ssh_pool.async_run(host, port, user, pwd,
        "free -m | awk 'NR==2{printf \"%s/%sMB (%.0f%%)\", $3,$2,$3*100/$2}'")
    disk = await ssh_pool.async_run(host, port, user, pwd,
        "df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'")
    uptime = await ssh_pool.async_run(host, port, user, pwd,
        "uptime -p 2>/dev/null || uptime")
    return f"CPU: {cpu}% | RAM: {mem} | Disco: {disk} | {uptime}"


@mcp.tool()
async def system_get_processes(
    credentials: dict = {},
) -> str:
    """Lista os 15 processos com maior uso de CPU."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "ps aux --sort=-%cpu | head -16")


@mcp.tool()
async def system_fingerprint(
    credentials: dict = {},
) -> str:
    """
    Coleta estado completo do servidor: OS, RAM, disco, Docker, serviços, pacotes, portas.
    ATENÇÃO: Use SOMENTE UMB VEZ e apenas se o Snapshot do contexto atual for insuficiente.
    """
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    script = (
        "echo '===OS===' && (uname -a 2>/dev/null; lsb_release -d 2>/dev/null || head -5 /etc/os-release 2>/dev/null) && "
        "echo '===MEM===' && free -h && "
        "echo '===DISK===' && df -h && "
        "echo '===DOCKER===' && (docker --version 2>/dev/null && docker ps --format '{{.Names}}:{{.Status}}' 2>/dev/null || echo 'Docker: não instalado') && "
        "echo '===SERVICES===' && (systemctl list-units --type=service --state=running --no-pager --plain 2>/dev/null | awk '{print $1}' | head -30) && "
        "echo '===PORTS===' && (ss -tulpn 2>/dev/null | awk 'NR>1{print $1,$5}' | head -20) && "
        "echo '===PKGS===' && (dpkg -l 2>/dev/null | awk 'NR>5 && $1==\"ii\" {print $2}' | "
        "grep -E 'nginx|apache|mysql|postgres|redis|php|python|node|zabbix|grafana|prometheus' || "
        "rpm -qa 2>/dev/null | grep -E 'nginx|apache|mysql|postgres|redis|php|node|zabbix' || "
        "echo 'gestor não identificado')"
    )
    raw = await ssh_pool.async_run(host, port, user, pwd, script, timeout=30)

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


# ── Scope: network ───────────────────────────────────────────────────────────

@mcp.tool()
async def network_get_info(
    credentials: dict = {},
) -> str:
    """Mostra interfaces de rede, IPs e portas abertas (ss -tulpn)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd,
        "ip -brief addr show 2>/dev/null && echo '--- Portas ---' "
        "&& ss -tulpn 2>/dev/null | head -25")


@mcp.tool()
async def network_get_routes(
    credentials: dict = {},
) -> str:
    """Mostra tabela de rotas (ip route show)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "ip route show")


@mcp.tool()
async def network_get_default_route(
    credentials: dict = {},
) -> str:
    """Obtém a rota default do servidor."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "ip route show default")


@mcp.tool()
async def network_ping(
    credentials: dict = {},
    host_target: str = "8.8.8.8",
    count: int = 4,
) -> str:
    """Executa ping a partir do servidor para um endereço."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    count = min(count, 10)
    return await ssh_pool.async_run(host, port, user, pwd, f"ping -c {count} -W 2 {host_target}")


# ── Scope: services ──────────────────────────────────────────────────────────

@mcp.tool()
async def services_list(
    credentials: dict = {},
) -> str:
    """Lista todos os serviços ativos (systemd)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd,
        "systemctl list-units --type=service --state=running --no-pager --plain 2>/dev/null | head -40")


# ── Scope: docker ─────────────────────────────────────────────────────────────

@mcp.tool()
async def docker_get_status(
    credentials: dict = {},
) -> str:
    """Lista containers Docker e seu status."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd,
        "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null "
        "|| echo 'Docker não disponível'")


# ── Scope: logs ──────────────────────────────────────────────────────────────

@mcp.tool()
async def logs_get(
    credentials: dict = {},
    service: str = "syslog",
    lines: int = 30,
) -> str:
    """Lê logs de um serviço (journalctl ou /var/log)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    lines = min(lines, 100)
    return await ssh_pool.async_run(host, port, user, pwd,
        f"journalctl -u {service} -n {lines} --no-pager 2>/dev/null || "
        f"tail -n {lines} /var/log/{service} 2>/dev/null || "
        f"tail -n {lines} /var/log/syslog 2>/dev/null")


# ── Scope: storage ───────────────────────────────────────────────────────────

@mcp.tool()
async def storage_get_disk_usage(
    credentials: dict = {},
) -> str:
    """Mostra uso de disco por partição (df -h) e maiores diretórios."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd,
        "df -h && echo '' && du -sh /opt/* /var/lib/* 2>/dev/null | sort -rh | head -10")


# ── Scope: network ───────────────────────────────────────────────────────────

@mcp.tool()
async def network_ping(
    credentials: dict = {},
    host_target: str = "8.8.8.8",
    count: int = 4,
) -> str:
    """Executa ping a partir do servidor para um endereço."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    count = min(count, 10)
    return await ssh_pool.async_run(host, port, user, pwd,
        f"ping -c {count} {host_target}")


@mcp.tool()
async def network_traceroute(
    credentials: dict = {},
    host_target: str = "8.8.8.8",
) -> str:
    """Executa traceroute a partir do servidor para um endereço."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    result = await ssh_pool.async_run(host, port, user, pwd,
        f"traceroute {host_target}")
    if "command not found" in result.lower():
        result = await ssh_pool.async_run(host, port, user, pwd,
            f"mtr -r -c 1 {host_target} || tracepath {host_target}")
    return result


# ── Scope: commands ──────────────────────────────────────────────────────────

@mcp.tool()
async def commands_run(
    credentials: dict = {},
    command: str = "",
    agent_mode: str = "restricted",
) -> str:
    """Executa um comando no servidor. Modo restricted: somente leitura. Modo standard/root: conforme permissões."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    block = _check_command_allowed(command, agent_mode)
    if block:
        return block
    return await ssh_pool.async_run(host, port, user, pwd, command)


# ── Health endpoint + ASGI app ────────────────────────────────────────────────

from starlette.responses import JSONResponse
from starlette.routing import Route


async def health(request):
    return JSONResponse({"status": "ok", "driver": "mcp-linux"})


# Create the MCP ASGI app, then add health route
app = mcp.http_app(path="/mcp", transport="streamable-http")
app.routes.append(Route("/health", health))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(app, host="0.0.0.0", port=port)

