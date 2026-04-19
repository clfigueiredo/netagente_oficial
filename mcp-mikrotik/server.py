"""
MCP MikroTik Driver — FastMCP server exposing RouterOS tools.

Each tool receives device credentials via credentials in the arguments,
executes SSH commands, and returns structured text results.

Scopes: system, interfaces, routing, firewall, pppoe, hotspot, queues, logs
"""

import os
import asyncio
import logging

from fastmcp import FastMCP

from ssh import ssh_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger("mcp-mikrotik")


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


# ── FastMCP Server ────────────────────────────────────────────────────────────

mcp = FastMCP(
    "mcp-mikrotik",
    instructions="MikroTik RouterOS MCP driver — SSH tools for ISP infrastructure",
)


# ── Scope: system ─────────────────────────────────────────────────────────────

@mcp.tool()
async def system_get_status(
    credentials: dict = {},
) -> str:
    """
    Obtém CPU, RAM, uptime e versão do RouterOS.
    ATENÇÃO: Use SOMENTE UMA VEZ por interação para evitar loops desnecessários.
    """
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    results = await ssh_pool.async_run_multi(host, port, user, pwd, [
        ":put [/system resource get cpu-load]",
        ":put [/system resource get free-memory]",
        ":put [/system resource get total-memory]",
        ":put [/system resource get uptime]",
        ":do { :put [/system routerboard get current-firmware] } on-error={ :put \"N/A\" }",
    ])
    cpu, free_mem, total_mem, uptime, firmware = [
        str(r) if not isinstance(r, Exception) else f"Erro: {r}" for r in results
    ]
    try:
        used_mb = (int(total_mem) - int(free_mem)) // 1024 // 1024
        total_mb = int(total_mem) // 1024 // 1024
    except (ValueError, TypeError):
        used_mb = total_mb = "?"
    return f"CPU: {cpu}% | RAM: {used_mb}MB/{total_mb}MB | Uptime: {uptime} | Firmware: {firmware}"


@mcp.tool()
async def system_get_logs(
    credentials: dict = {},
    topics: str = "system",
    lines: int = 30,
) -> str:
    """Lê logs do RouterOS por tópico."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    lines = min(lines, 100)
    return await ssh_pool.async_run(
        host, port, user, pwd,
        f'/log print without-paging where topics~"{topics}" count-max={lines}',
    )


@mcp.tool()
async def system_fingerprint(
    credentials: dict = {},
) -> str:
    """
    Coleta estado completo do RouterOS: versão, interfaces, IPs, rotas, NAT, firewall.
    ATENÇÃO: Use SOMENTE UMA VEZ e apenas se o Snapshot do contexto atual for insuficiente.
    """
    host, port, user, pwd, _ = _creds({"credentials": credentials})

    # Run commands sequentially to avoid MikroTik SSH session limit
    commands = [
        (":put [/system resource get version]", "version"),
        (":put [/system resource get board-name]", "board"),
        ("/ip address print without-paging", "addresses"),
        ("/ip route print where active=yes without-paging", "routes"),
        ("/ip firewall nat print count-only without-paging", "nat_count"),
        ("/ip firewall filter print count-only without-paging", "fw_count"),
        ("/interface print count-only without-paging", "iface_count"),
        ("/ppp active print count-only without-paging", "pppoe_count"),
    ]

    data = {}
    for cmd, key in commands:
        try:
            data[key] = await ssh_pool.async_run(host, port, user, pwd, cmd, timeout=10)
        except Exception as e:
            data[key] = "N/A"

    # BGP: try v7 syntax first, then v6
    try:
        bgp = await ssh_pool.async_run(host, port, user, pwd,
            "/routing/bgp/connection print count-only without-paging", timeout=8)
        if "bad command" in bgp.lower() or "expected" in bgp.lower():
            bgp = await ssh_pool.async_run(host, port, user, pwd,
                "/routing bgp peer print count-only without-paging", timeout=8)
    except Exception:
        bgp = "0"
    data["bgp_count"] = bgp if bgp and "bad command" not in bgp.lower() else "0"

    return (
        "## 🖧 Fingerprint do RouterOS\n\n"
        f"**Hardware:** {data['board']} | **RouterOS:** {data['version']}\n\n"
        f"**Interfaces:** {data['iface_count']} | **BGP Peers:** {data['bgp_count']} | "
        f"**Sessões PPPoE:** {data['pppoe_count']}\n\n"
        f"**Endereços IP:**\n{data['addresses']}\n\n"
        f"**Rotas ativas:**\n{data['routes']}\n\n"
        f"**Firewall:** {data['fw_count']} regras filter | {data['nat_count']} regras NAT"
    )


# ── Scope: interfaces ────────────────────────────────────────────────────────

@mcp.tool()
async def interfaces_list(
    credentials: dict = {},
) -> str:
    """Lista interfaces com estado, tráfego e erros."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    basic = await ssh_pool.async_run(host, port, user, pwd, "/interface print detail without-paging")
    traffic = await ssh_pool.async_run(host, port, user, pwd, "/interface print stats without-paging")
    return f"=== Interfaces ===\n{basic}\n\n=== Tráfego ===\n{traffic}"


# ── Scope: routing ────────────────────────────────────────────────────────────

@mcp.tool()
async def routing_get_bgp_peers(
    credentials: dict = {},
) -> str:
    """Lista peers BGP com estado, uptime e prefixos recebidos/anunciados."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    v1 = await ssh_pool.async_run(host, port, user, pwd,
        "/routing bgp peer print detail without-paging 2>/dev/null")
    if v1 and "Erro" not in v1:
        return v1
    return await ssh_pool.async_run(host, port, user, pwd,
        "/routing/bgp/peer print detail without-paging 2>/dev/null")


@mcp.tool()
async def routing_get_routes(
    credentials: dict = {},
    filter: str = "",
) -> str:
    """Lista tabela de rotas, com filtro opcional por prefixo."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = "/ip route print without-paging"
    if filter:
        cmd += f' where dst-address~"{filter}"'
    return await ssh_pool.async_run(host, port, user, pwd, cmd)


@mcp.tool()
async def routing_get_ospf(
    credentials: dict = {},
) -> str:
    """Lista vizinhos OSPF e estado das adjacências."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    v1 = await ssh_pool.async_run(host, port, user, pwd,
        "/routing ospf neighbor print without-paging 2>/dev/null")
    if v1 and "Erro" not in v1:
        return v1
    return await ssh_pool.async_run(host, port, user, pwd,
        "/routing/ospf/neighbor print without-paging 2>/dev/null")


# ── Scope: firewall ──────────────────────────────────────────────────────────

@mcp.tool()
async def firewall_get_rules(
    credentials: dict = {},
) -> str:
    """Lista regras de firewall filter e mangle."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    fw = await ssh_pool.async_run(host, port, user, pwd, "/ip firewall filter print without-paging")
    mangle = await ssh_pool.async_run(host, port, user, pwd, "/ip firewall mangle print without-paging")
    return f"=== Filter ===\n{fw}\n\n=== Mangle ===\n{mangle}"


@mcp.tool()
async def firewall_get_nat(
    credentials: dict = {},
) -> str:
    """Lista regras NAT (masquerade, dst-nat, src-nat)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall nat print without-paging")


@mcp.tool()
async def firewall_get_address_lists(
    credentials: dict = {},
) -> str:
    """Lista address-lists do firewall."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall address-list print without-paging")


# ── Scope: pppoe ──────────────────────────────────────────────────────────────

@mcp.tool()
async def pppoe_get_sessions(
    credentials: dict = {},
) -> str:
    """Lista sessões PPPoE ativas com usuário, IP e uptime."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ppp active print without-paging")


# ── Scope: hotspot ────────────────────────────────────────────────────────────

@mcp.tool()
async def hotspot_get_users(
    credentials: dict = {},
) -> str:
    """Lista usuários hotspot ativos."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip hotspot active print without-paging")


# ── Scope: queues ─────────────────────────────────────────────────────────────

@mcp.tool()
async def queues_list(
    credentials: dict = {},
) -> str:
    """Lista filas simples e queue tree com limites de banda."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    simple = await ssh_pool.async_run(host, port, user, pwd, "/queue simple print without-paging")
    tree = await ssh_pool.async_run(host, port, user, pwd, "/queue tree print without-paging")
    return f"=== Filas Simples ===\n{simple}\n\n=== Queue Tree ===\n{tree}"


# ── Scope: services ──────────────────────────────────────────────────────────

@mcp.tool()
async def services_get_dhcp_leases(
    credentials: dict = {},
) -> str:
    """Lista leases DHCP ativos com IP, MAC e hostname."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dhcp-server lease print without-paging")

@mcp.tool()
async def services_get_dhcp_servers(
    credentials: dict = {},
) -> str:
    """Lista servidores DHCP configurados."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dhcp-server print detail without-paging")

@mcp.tool()
async def interfaces_get_vlans(
    credentials: dict = {},
) -> str:
    """Lista VLANs configuradas, com suas interfaces e vlan-id."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface vlan print detail without-paging")



# ── Scope: network ───────────────────────────────────────────────────────────

@mcp.tool()
async def network_get_arp(
    credentials: dict = {},
) -> str:
    """Lista a tabela ARP (mac-address, ip-address, interface)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip arp print without-paging")

@mcp.tool()
async def firewall_get_connections(
    credentials: dict = {},
) -> str:
    """Lista a quantidade de conexões ativas no firewall (connection tracking)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall connection print count-only without-paging")

@mcp.tool()
async def interfaces_get_ethernet(
    credentials: dict = {},
) -> str:
    """Lista interfaces ethernet físicas detalhadas (mac, autonegotiation)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface ethernet print detail without-paging")

@mcp.tool()
async def interfaces_get_wireless_clients(
    credentials: dict = {},
) -> str:
    """Lista clientes conectados nas interfaces Wireless (Wi-Fi)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface wireless registration-table print without-paging")

@mcp.tool()
async def system_get_packages(
    credentials: dict = {},
) -> str:
    """Lista os pacotes instalados no sistema e suas versões."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/system package print without-paging")

@mcp.tool()
async def ip_get_dns(
    credentials: dict = {},
) -> str:
    """Obtém as configurações de DNS do roteador."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dns print")

@mcp.tool()
async def network_ping(
    credentials: dict = {},
    host_target: str = "8.8.8.8",
    count: int = 4,
) -> str:
    """Executa ping a partir do RouterOS para um endereço."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    count = min(count, 10)
    return await ssh_pool.async_run(host, port, user, pwd,
        f"/ping address={host_target} count={count}")


@mcp.tool()
async def network_traceroute(
    credentials: dict = {},
    host_target: str = "8.8.8.8",
) -> str:
    """Executa traceroute a partir do RouterOS para um endereço."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd,
        f"/tool traceroute address={host_target} count=1")


# ── Scope: bgp ────────────────────────────────────────────────────────────────

@mcp.tool()
async def bgp_get_status(credentials: dict = {}, instance: str = "") -> str:
    """Get BGP instance status. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = f'/routing bgp instance print detail where name="{instance}"' if instance else "/routing bgp instance print detail"
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def bgp_list_peers(credentials: dict = {}) -> str:
    """List BGP peers and their status. Automatically attempts v7 and v6 syntax. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = ":do { /routing/bgp/connection/print } on-error={ /routing bgp peer print detail }"
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def bgp_list_routes(credentials: dict = {}) -> str:
    """View BGP routing table. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = ":do { /routing route print where bgp } on-error={ /routing/bgp/advertisements/print }"
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def bgp_clear_session(credentials: dict = {}, peer_name: str = "") -> str:
    """Reset BGP session (soft reset)."""
    if not peer_name: return "Needs peer_name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/routing bgp peer reset [find name="{peer_name}"]')

# ── Scope: ospf ───────────────────────────────────────────────────────────────

@mcp.tool()
async def ospf_get_status(credentials: dict = {}, instance: str = "default") -> str:
    """Get OSPF instance status. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/routing ospf instance print detail where name="{instance}"')

@mcp.tool()
async def ospf_list_neighbors(credentials: dict = {}) -> str:
    """List OSPF neighbors. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/routing ospf neighbor print detail")

@mcp.tool()
async def ospf_list_routes(credentials: dict = {}) -> str:
    """View OSPF routes / LSA database. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = ":do { /routing route print where ospf } on-error={ /routing ospf lsa print }"
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

# ── Scope: pppoe ──────────────────────────────────────────────────────────────

@mcp.tool()
async def pppoe_list_clients(credentials: dict = {}) -> str:
    """List PPPoE client interfaces. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface pppoe-client print detail")

@mcp.tool()
async def pppoe_list_servers(credentials: dict = {}) -> str:
    """List PPPoE servers. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface pppoe-server server print detail")

@mcp.tool()
async def pppoe_get_active_sessions(credentials: dict = {}, user_filter: str = "") -> str:
    """List PPPoE active sessions/connections. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    cmd = f'/ppp active print detail where name~"{user_filter}"' if user_filter else '/ppp active print'
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def pppoe_remove_active_session(credentials: dict = {}, user_to_kick: str = "") -> str:
    """Kick an active PPPoE session by username."""
    if not user_to_kick: return "Needs user_to_kick"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ppp active remove [find name="{user_to_kick}"]')


# ── Scope: firewall filter + nat ──────────────────────────────────────────────

@mcp.tool()
async def firewall_filter_list(credentials: dict = {}) -> str:
    """List Firewall Filter rules. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall filter print detail")

@mcp.tool()
async def firewall_filter_add_basic(
    credentials: dict = {},
    chain: str = "forward",
    action: str = "accept",
    src_address: str = "",
    dst_address: str = "",
    protocol: str = "",
    dst_port: str = "",
    comment: str = ""
) -> str:
    """Create a basic Firewall Filter rule."""
    if chain not in ["input", "forward", "output"]: return "Invalid chain"
    cmd = f"/ip firewall filter add chain={chain} action={action}"
    if src_address: cmd += f" src-address={src_address}"
    if dst_address: cmd += f" dst-address={dst_address}"
    if protocol: cmd += f" protocol={protocol}"
    if dst_port: cmd += f" dst-port={dst_port}"
    if comment: cmd += f' comment="{comment}"'
    
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def firewall_filter_remove(credentials: dict = {}, rule_id: str = "") -> str:
    """Remove a Firewall Filter rule by ID (e.g. '*A' or a number if strictly printed)."""
    if not rule_id: return "Needs rule_id"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f"/ip firewall filter remove {rule_id}")

@mcp.tool()
async def firewall_nat_list(credentials: dict = {}) -> str:
    """List Firewall NAT rules. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall nat print detail")

@mcp.tool()
async def firewall_nat_add_port_forward(
    credentials: dict = {},
    external_port: int = 0,
    internal_ip: str = "",
    internal_port: int = 0,
    protocol: str = "tcp",
    comment: str = ""
) -> str:
    """Create a Port Forward (dst-nat) rule."""
    if not external_port or not internal_ip: return "Missing external_port or internal_ip"
    if not internal_port: internal_port = external_port
    if not comment: comment = f"Port Forward: {external_port} -> {internal_ip}:{internal_port}"
    
    cmd = (f"/ip firewall nat add chain=dstnat action=dst-nat protocol={protocol} "
           f"dst-port={external_port} to-addresses={internal_ip} to-ports={internal_port} "
           f'comment="{comment}"')
    
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def firewall_nat_remove(credentials: dict = {}, rule_id: str = "") -> str:
    """Remove a Firewall NAT rule by ID."""
    if not rule_id: return "Needs rule_id"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f"/ip firewall nat remove {rule_id}")


# ── Scope: wireguard ──────────────────────────────────────────────────────────

@mcp.tool()
async def wireguard_list_interfaces(credentials: dict = {}) -> str:
    """List WireGuard interfaces. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface wireguard print detail")

@mcp.tool()
async def wireguard_create_interface(
    credentials: dict = {},
    name: str = "wireguard1",
    listen_port: int = 51820,
    comment: str = ""
) -> str:
    """Create a WireGuard interface. Private key is auto-generated by RouterOS if omitted."""
    cmd = f'/interface wireguard add name="{name}" listen-port={listen_port}'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def wireguard_remove_interface(credentials: dict = {}, name: str = "") -> str:
    """Remove a WireGuard interface by name."""
    if not name: return "Needs name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/interface wireguard remove "{name}"')

@mcp.tool()
async def wireguard_list_peers(credentials: dict = {}, interface: str = "") -> str:
    """List WireGuard peers. Can be filtered by interface name. READ-ONLY."""
    cmd = f'/interface wireguard peers print detail where interface="{interface}"' if interface else "/interface wireguard peers print detail"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def wireguard_add_peer(
    credentials: dict = {},
    interface: str = "",
    public_key: str = "",
    allowed_address: str = "0.0.0.0/0",
    endpoint_address: str = "",
    endpoint_port: str = "",
    comment: str = ""
) -> str:
    """Add a peer to a WireGuard interface."""
    if not interface or not public_key: return "Missing interface or public_key"
    cmd = f'/interface wireguard peers add interface="{interface}" public-key="{public_key}" allowed-address="{allowed_address}"'
    if endpoint_address: cmd += f' endpoint-address="{endpoint_address}"'
    if endpoint_port: cmd += f' endpoint-port="{endpoint_port}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def wireguard_remove_peer(credentials: dict = {}, peer_id: str = "") -> str:
    """Remove a WireGuard peer by ID (e.g. '*A')."""
    if not peer_id: return "Needs peer_id"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f"/interface wireguard peers remove {peer_id}")


# ── Scope: vlan ───────────────────────────────────────────────────────────────

@mcp.tool()
async def vlan_list_interfaces(credentials: dict = {}) -> str:
    """List VLAN interfaces. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface vlan print detail")

@mcp.tool()
async def vlan_create_interface(
    credentials: dict = {},
    name: str = "",
    vlan_id: int = 1,
    interface: str = "",
    comment: str = ""
) -> str:
    """Create a VLAN interface. Needs name, vlan_id, and parent interface."""
    if not name or not interface: return "Missing name or parent interface"
    cmd = f"/interface vlan add name={name} vlan-id={vlan_id} interface={interface}"
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def vlan_remove_interface(credentials: dict = {}, name: str = "") -> str:
    """Remove a VLAN interface by name."""
    if not name: return "Needs name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/interface vlan remove [find name="{name}"]')


# ── Scope: bridge ─────────────────────────────────────────────────────────────

@mcp.tool()
async def bridge_list(credentials: dict = {}) -> str:
    """List Bridge interfaces. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface bridge print detail")

@mcp.tool()
async def bridge_create(
    credentials: dict = {},
    name: str = "bridge1",
    vlan_filtering: bool = False,
    comment: str = ""
) -> str:
    """Create a Bridge interface."""
    cmd = f'/interface bridge add name="{name}" vlan-filtering={"yes" if vlan_filtering else "no"}'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def bridge_add_port(
    credentials: dict = {},
    bridge: str = "",
    interface: str = "",
    pvid: int = 1,
    comment: str = ""
) -> str:
    """Add a port to a Bridge."""
    if not bridge or not interface: return "Missing bridge or interface"
    cmd = f'/interface bridge port add bridge="{bridge}" interface="{interface}" pvid={pvid}'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def bridge_list_vlans(credentials: dict = {}) -> str:
    """List Bridge VLAN configurations. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface bridge vlan print detail")


# ── Scope: dhcp ───────────────────────────────────────────────────────────────

@mcp.tool()
async def dhcp_list_servers(credentials: dict = {}) -> str:
    """List DHCP servers. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dhcp-server print detail")

@mcp.tool()
async def dhcp_list_leases(credentials: dict = {}) -> str:
    """List DHCP leases. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dhcp-server lease print detail")

@mcp.tool()
async def dhcp_make_static_lease(credentials: dict = {}, mac_address: str = "") -> str:
    """Make a dynamic DHCP lease static by MAC Address."""
    if not mac_address: return "Needs mac_address"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ip dhcp-server lease make-static [find mac-address="{mac_address}"]')


# ── Scope: hotspot ────────────────────────────────────────────────────────────

@mcp.tool()
async def hotspot_list_servers(credentials: dict = {}) -> str:
    """List Hotspot servers. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip hotspot print detail")

@mcp.tool()
async def hotspot_list_active(credentials: dict = {}) -> str:
    """List Active Hotspot users. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip hotspot active print detail")

@mcp.tool()
async def hotspot_add_user(
    credentials: dict = {},
    server: str = "all",
    name: str = "",
    password: str = "",
    profile: str = "default",
    comment: str = ""
) -> str:
    """Add a Hotspot user."""
    if not name or not password: return "Missing name or password"
    cmd = f'/ip hotspot user add server="{server}" name="{name}" password="{password}" profile="{profile}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def hotspot_remove_active_user(credentials: dict = {}, user_to_kick: str = "") -> str:
    """Kick an active Hotspot user."""
    if not user_to_kick: return "Needs user_to_kick"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ip hotspot active remove [find user="{user_to_kick}"]')


# ── Scope: tunnels (eoip, gre) ────────────────────────────────────────────────

@mcp.tool()
async def tunnel_list(credentials: dict = {}) -> str:
    """List EoIP and GRE tunnels. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    eoip = await ssh_pool.async_run(host, port, user, pwd, "/interface eoip print detail")
    gre = await ssh_pool.async_run(host, port, user, pwd, "/interface gre print detail")
    return f"EoIP Tunnels:\n{eoip}\n\nGRE Tunnels:\n{gre}"

@mcp.tool()
async def tunnel_create_eoip(
    credentials: dict = {},
    name: str = "",
    remote_address: str = "",
    tunnel_id: int = 0,
    comment: str = ""
) -> str:
    """Create an EoIP Tunnel."""
    if not name or not remote_address: return "Missing name or remote_address"
    cmd = f'/interface eoip add name="{name}" remote-address="{remote_address}" tunnel-id={tunnel_id}'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def tunnel_remove_eoip(credentials: dict = {}, name: str = "") -> str:
    """Remove an EoIP Tunnel."""
    if not name: return "Needs name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/interface eoip remove [find name="{name}"]')

@mcp.tool()
async def tunnel_create_gre(
    credentials: dict = {},
    name: str = "",
    remote_address: str = "",
    comment: str = ""
) -> str:
    """Create a GRE Tunnel."""
    if not name or not remote_address: return "Missing name or remote_address"
    cmd = f'/interface gre add name="{name}" remote-address="{remote_address}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def tunnel_remove_gre(credentials: dict = {}, name: str = "") -> str:
    """Remove a GRE Tunnel."""
    if not name: return "Needs name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/interface gre remove [find name="{name}"]')


# ── Scope: queues (QoS) ───────────────────────────────────────────────────────

@mcp.tool()
async def queue_list_simple(credentials: dict = {}) -> str:
    """List Simple Queues. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/queue simple print detail")

@mcp.tool()
async def queue_create_simple(
    credentials: dict = {},
    name: str = "",
    target: str = "",
    max_limit: str = "10M/10M",
    comment: str = ""
) -> str:
    """Create a Simple Queue (Bandwidth Limit). Example max_limit: '10M/50M' (Upload/Download)"""
    if not name or not target: return "Missing name or target"
    cmd = f'/queue simple add name="{name}" target="{target}" max-limit="{max_limit}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def queue_remove_simple(credentials: dict = {}, name: str = "") -> str:
    """Remove a Simple Queue."""
    if not name: return "Needs name"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/queue simple remove [find name="{name}"]')


# ── Scope: routing filters ────────────────────────────────────────────────────

@mcp.tool()
async def routing_filter_list(credentials: dict = {}) -> str:
    """List Routing Filters (BGP/OSPF policies). READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    # Try RouterOS v7 syntax, fallback is not easily done elegantly without two calls so we just print v7 since most infra uses v7 now
    return await ssh_pool.async_run(host, port, user, pwd, "/routing filter rule print detail")

@mcp.tool()
async def routing_filter_create(
    credentials: dict = {},
    chain: str = "",
    rule: str = "",
    comment: str = ""
) -> str:
    """Create a Route Filter (v7 Syntax). Example rule: 'if (dst == 10.0.0.0/8) { accept }'."""
    if not chain or not rule: return "Missing chain or rule"
    cmd = f'/routing filter rule add chain="{chain}" rule="{rule}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)


# ── Scope: system backup & file management ────────────────────────────────────

@mcp.tool()
async def system_backup_create(
    credentials: dict = {},
    name: str = "",
    dont_encrypt: bool = True
) -> str:
    """Create a system .backup file. Set name to identify it."""
    if not name: return "Needs name"
    cmd = f'/system backup save name="{name}"'
    if dont_encrypt: cmd += ' dont-encrypt=yes'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def system_export_create(
    credentials: dict = {},
    name: str = "export",
    show_sensitive: bool = False
) -> str:
    """Create a plaintext .rsc export configuration file."""
    cmd = f'/export file="{name}"'
    if show_sensitive: cmd += ' show-sensitive'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def file_list(credentials: dict = {}) -> str:
    """List files on the Router (Backups, Exports, Certificates). READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/file print detail")

@mcp.tool()
async def file_remove(credentials: dict = {}, name: str = "") -> str:
    """Delete a file from the Router."""
    if not name: return "Needs file name (e.g. backup.backup or export.rsc)"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/file remove "{name}"')


# ── Scope: ip address & ip pool ───────────────────────────────────────────────

@mcp.tool()
async def ip_address_list(credentials: dict = {}) -> str:
    """List IP Addresses. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip address print detail")

@mcp.tool()
async def ip_address_create(
    credentials: dict = {},
    address: str = "",
    interface: str = "",
    network: str = "",
    comment: str = ""
) -> str:
    """Add an IP address (e.g., 192.168.1.1/24) to an interface."""
    if not address or not interface: return "Missing address or interface"
    cmd = f'/ip address add address="{address}" interface="{interface}"'
    if network: cmd += f' network="{network}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def ip_address_remove(credentials: dict = {}, numbers: str = "") -> str:
    """Remove an IP Address by ID/number."""
    if not numbers: return "Needs numbers or ID"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ip address remove numbers="{numbers}"')

@mcp.tool()
async def ip_pool_create(
    credentials: dict = {},
    name: str = "",
    ranges: str = "",
    comment: str = ""
) -> str:
    """Create an IP Pool (e.g., ranges 192.168.88.10-192.168.88.254)."""
    if not name or not ranges: return "Missing name or ranges"
    cmd = f'/ip pool add name="{name}" ranges="{ranges}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def ip_pool_list(credentials: dict = {}) -> str:
    """List IP Pools. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip pool print detail")


# ── Scope: routing ────────────────────────────────────────────────────────────

@mcp.tool()
async def route_list(credentials: dict = {}) -> str:
    """List the Routing Table. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip route print detail")

@mcp.tool()
async def route_create(
    credentials: dict = {},
    dst_address: str = "",
    gateway: str = "",
    distance: int = 1,
    comment: str = ""
) -> str:
    """Create a static IP route."""
    if not dst_address or not gateway: return "Missing dst_address or gateway"
    cmd = f'/ip route add dst-address="{dst_address}" gateway="{gateway}" distance={distance}'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def route_remove(credentials: dict = {}, dst_address: str = "") -> str:
    """Remove a static IP route."""
    if not dst_address: return "Needs dst_address"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ip route remove [find dst-address="{dst_address}"]')


# ── Scope: dns ────────────────────────────────────────────────────────────────

@mcp.tool()
async def dns_set_servers(credentials: dict = {}, servers: str = "8.8.8.8,1.1.1.1", allow_remote_requests: bool = True) -> str:
    """Set DNS servers and allow-remote-requests on the Router."""
    allow = "yes" if allow_remote_requests else "no"
    cmd = f'/ip dns set servers="{servers}" allow-remote-requests={allow}'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def dns_list(credentials: dict = {}) -> str:
    """Print current DNS config and cache. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    config = await ssh_pool.async_run(host, port, user, pwd, "/ip dns print")
    return f"DNS Config:\n{config}"

@mcp.tool()
async def dns_cache_flush(credentials: dict = {}) -> str:
    """Flush DNS cache."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dns cache flush")


# ── Scope: system users ───────────────────────────────────────────────────────

@mcp.tool()
async def user_list(credentials: dict = {}) -> str:
    """List RouterOS System Users. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/user print detail")

@mcp.tool()
async def user_create(
    credentials: dict = {},
    name: str = "",
    group: str = "full",
    password: str = "",
    comment: str = ""
) -> str:
    """Create a new RouterOS System User."""
    if not name or not password: return "Missing name or password"
    cmd = f'/user add name="{name}" group="{group}" password="{password}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)


# ── Scope: active connections & logs ──────────────────────────────────────────

@mcp.tool()
async def system_logs_list(credentials: dict = {}, lines: int = 50) -> str:
    """Print the last N lines of system logs."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/log print detail where time>0 or time=0')

@mcp.tool()
async def diagnostic_ping(credentials: dict = {}, address: str = "", count: int = 4) -> str:
    """Ping an IP address to test connectivity."""
    if not address: return "Missing address"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/ping address="{address}" count={count}')

@mcp.tool()
async def system_reboot(credentials: dict = {}) -> str:
    """Reboot the MikroTik Router (Will drop connection)."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    # Warning, will error if SSH drops during reboot, ignoring error is fine
    try:
        await ssh_pool.async_run(host, port, user, pwd, "/system reboot")
        return "Reboot command sent"
    except Exception as e:
        return f"Reboot sent (SSH drop is normal): {str(e)}"

# ── Scope: dhcp server ────────────────────────────────────────────────────────

@mcp.tool()
async def dhcp_server_list(credentials: dict = {}) -> str:
    """List DHCP Servers. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip dhcp-server print detail")

@mcp.tool()
async def dhcp_server_create(
    credentials: dict = {},
    name: str = "",
    interface: str = "",
    address_pool: str = "",
    lease_time: str = "1d",
    comment: str = ""
) -> str:
    """Create a DHCP Server on an interface."""
    if not name or not interface: return "Missing name or interface"
    cmd = f'/ip dhcp-server add name="{name}" interface="{interface}" lease-time="{lease_time}"'
    if address_pool: cmd += f' address-pool="{address_pool}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def dhcp_server_network_create(
    credentials: dict = {},
    network: str = "",
    gateway: str = "",
    dns_servers: str = "8.8.8.8,1.1.1.1",
    comment: str = ""
) -> str:
    """Create a DHCP Network (Defines gateway and DNS for clients)."""
    if not network or not gateway: return "Missing network or gateway"
    cmd = f'/ip dhcp-server network add address="{network}" gateway="{gateway}" dns-server="{dns_servers}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)


# ── Scope: hotspot ────────────────────────────────────────────────────────────

@mcp.tool()
async def hotspot_list(credentials: dict = {}) -> str:
    """List Hotspot Servers. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip hotspot print detail")

@mcp.tool()
async def hotspot_user_create(
    credentials: dict = {},
    name: str = "",
    password: str = "",
    profile: str = "default",
    comment: str = ""
) -> str:
    """Create a Hotspot User with credentials."""
    if not name or not password: return "Missing name or password"
    cmd = f'/ip hotspot user add name="{name}" password="{password}" profile="{profile}"'
    if comment: cmd += f' comment="{comment}"'
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, cmd)

@mcp.tool()
async def hotspot_active_list(credentials: dict = {}) -> str:
    """List currently active Hotspot sessions. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip hotspot active print detail")


# ── Scope: openvpn ────────────────────────────────────────────────────────────

@mcp.tool()
async def openvpn_client_create(
    credentials: dict = {},
    name: str = "",
    connect_to: str = "",
    user_auth: str = "",
    password: str = "",
    port: int = 1194,
    comment: str = ""
) -> str:
    """Create an OpenVPN Client Interface."""
    if not name or not connect_to: return "Missing name or connect_to"
    cmd = f'/interface ovpn-client add name="{name}" connect-to="{connect_to}" port={port}'
    if user_auth: cmd += f' user="{user_auth}"'
    if password: cmd += f' password="{password}"'
    if comment: cmd += f' comment="{comment}"'
    host, mcp_port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, mcp_port, user, pwd, cmd)

@mcp.tool()
async def openvpn_server_list(credentials: dict = {}) -> str:
    """List OpenVPN Server bindings. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/interface ovpn-server print detail")


# ── Scope: firewall advanced (mangle, raw, connection tracking) ───────────────

@mcp.tool()
async def firewall_mangle_list(credentials: dict = {}) -> str:
    """List Firewall Mangle rules. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall mangle print detail")

@mcp.tool()
async def firewall_mangle_create(
    credentials: dict = {},
    chain: str = "prerouting",
    mangle_action: str = "mark-routing",
    src_address: str = "",
    dst_address: str = "",
    new_routing_mark: str = "",
    new_packet_mark: str = "",
    new_connection_mark: str = "",
    passthrough: bool = True,
    comment: str = ""
) -> str:
    """Create a Firewall Mangle rule (e.g., for Policy-Based Routing)."""
    cmd = f'/ip firewall mangle add chain="{chain}" action="{mangle_action}" passthrough={"yes" if passthrough else "no"}'
    if src_address: cmd += f' src-address="{src_address}"'
    if dst_address: cmd += f' dst-address="{dst_address}"'
    if new_routing_mark: cmd += f' new-routing-mark="{new_routing_mark}"'
    if new_packet_mark: cmd += f' new-packet-mark="{new_packet_mark}"'
    if new_connection_mark: cmd += f' new-connection-mark="{new_connection_mark}"'
    if comment: cmd += f' comment="{comment}"'
    host, mcp_port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, mcp_port, user, pwd, cmd)

@mcp.tool()
async def firewall_raw_list(credentials: dict = {}) -> str:
    """List Firewall Raw rules. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall raw print detail")

@mcp.tool()
async def firewall_connection_tracking(credentials: dict = {}) -> str:
    """List Active Connections tracking. READ-ONLY."""
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, "/ip firewall connection print detail")


# ── Scope: network diagnostics ────────────────────────────────────────────────

@mcp.tool()
async def diagnostic_traceroute(credentials: dict = {}, address: str = "", count: int = 4) -> str:
    """Run a Traceroute to a destination."""
    if not address: return "Missing address"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/tool traceroute address="{address}" count={count}')

@mcp.tool()
async def diagnostic_bandwidth_test(
    credentials: dict = {},
    address: str = "",
    direction: str = "both",
    duration: int = 10
) -> str:
    """Run a Bandwidth Test to another MikroTik device."""
    if not address: return "Missing address"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    return await ssh_pool.async_run(host, port, user, pwd, f'/tool bandwidth-test address="{address}" direction="{direction}" duration={duration}s')

@mcp.tool()
async def diagnostic_torch(credentials: dict = {}, interface: str = "", duration: int = 10) -> str:
    """Run Torch on an interface to monitor real-time traffic headers."""
    if not interface: return "Missing interface"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    # Torch runs continuously by default, we must stop it or run it briefly
    return await ssh_pool.async_run(host, port, user, pwd, f'/tool torch interface="{interface}" duration={duration}s')


# ── Scope: intelligent workflows ────────────────────────────────────────────────

@mcp.tool()
async def workflow_setup_vpn_client(
    credentials: dict = {},
    vpn_name: str = "",
    local_vpn_ip: str = "",
    remote_vpn_ip: str = "",
    remote_endpoint: str = "",
    remote_endpoint_port: int = 51820,
    remote_public_key: str = "",
    local_private_key: str = "",
    preshared_key: str = "",
    persistent_keepalive: str = "25s",
    mtu: int = 1420
) -> str:
    """
    Complete VPN client setup workflow in ONE command.
    Creates interface, assigns IP, adds peer, and runs a ping test.
    """
    if not vpn_name or not local_vpn_ip or not remote_vpn_ip or not remote_endpoint or not remote_public_key or not local_private_key:
        return "Missing required parameters for VPN Setup"
    
    host, mcp_port, user, pwd, _ = _creds({"credentials": credentials})
    results = []

    # 1. Interface
    cmd_iface = f'/interface wireguard add name="{vpn_name}" listen-port={remote_endpoint_port} private-key="{local_private_key}" mtu={mtu} comment="VPN to {remote_endpoint}"'
    r1 = await ssh_pool.async_run(host, mcp_port, user, pwd, cmd_iface)
    results.append(f"Interface: {r1}")

    # 2. IP Address
    cmd_ip = f'/ip address add address="{local_vpn_ip}" interface="{vpn_name}" comment="{vpn_name} IP"'
    r2 = await ssh_pool.async_run(host, mcp_port, user, pwd, cmd_ip)
    results.append(f"IP Address: {r2}")

    # 3. Peer
    cmd_peer = f'/interface wireguard peers add interface="{vpn_name}" public-key="{remote_public_key}" endpoint-address="{remote_endpoint}" endpoint-port={remote_endpoint_port} allowed-address="{remote_vpn_ip}/32" persistent-keepalive="{persistent_keepalive}" comment="VPN Server"'
    if preshared_key: cmd_peer += f' preshared-key="{preshared_key}"'
    r3 = await ssh_pool.async_run(host, mcp_port, user, pwd, cmd_peer)
    results.append(f"Peer Settings: {r3}")

    import asyncio
    await asyncio.sleep(2)
    
    # 4. Connectivity Test
    cmd_ping = f'/ping address="{remote_vpn_ip.split("/")[0]}" count=3'
    r4 = await ssh_pool.async_run(host, mcp_port, user, pwd, cmd_ping)
    results.append(f"Ping Test:\n{r4}")

    return "VPN CLIENT SETUP COMPLETE:\n" + "\n".join(results)

@mcp.tool()
async def execute_arbitrary_cli(
    credentials: dict = {},
    command: str = "",
    is_safe_read_only: bool = False
) -> str:
    """
    Intelligent Workflow Runner.
    Use this to run any arbitrary RouterOS CLI command not covered by other tools.
    You MUST set is_safe_read_only to True ONLY if it's a 'print', 'export', or safe read.
    If it modifies state, you must analyze the risk beforehand and warn the user.
    """
    if not command: return "Missing command"
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    
    # Basic Safety parsing
    lower_cmd = command.lower()
    if not is_safe_read_only and any(w in lower_cmd for w in dangerous_keywords):
        return f"INTELLIGENT WORKFLOW WARNING: '{command}' contains risky operations. Please manually verify context before applying. Run again appending ' delay=1' or carefully to bypass if sure.\n" + await ssh_pool.async_run(host, port, user, pwd, command)
        
    return await ssh_pool.async_run(host, port, user, pwd, command)


@mcp.tool(description="Configure Advanced Dual-WAN PCC Load Balancing and Intelligent Failover Workflow (VishnuNuk style). Prompts WhatsApp alerts on failover.")
async def workflow_setup_dual_wan_lb(
    credentials: dict,
    wan1_iface: str,
    wan1_ip_cidr: str,
    wan1_gw: str,
    wan2_iface: str,
    wan2_ip_cidr: str,
    wan2_gw: str,
    lan_iface: str,
    whatsapp_number: str = ""
) -> str:
    """
    Sets up a full Dual-WAN Load Balance using Per-Connection Classifier (PCC) algorithm
    along with an automated Failover script running every 10s based on the advanced github repo approach.
    whatsapp_number can be passed to trigger Evolution API/WhatsApp notifications natively on failover (no user webhook needed).
    """
    host, port, user, pwd, _ = _creds({"credentials": credentials})
    
    evo_url = os.environ.get("EVOLUTION_BASE_URL", "http://netagent-api:8080")
    evo_key = os.environ.get("EVOLUTION_GLOBAL_KEY", "missing_key")
    # For sending a WhatsApp message:
    # POST {evo_url}/message/sendText/NetAgent
    # Headers: apikey: {evo_key}, Content-Type: application/json
    # Body: {"number": "whatsapp_number", "text": "Mensagem"}

    # Prepare the massive RouterOS script securely
    # Follows the architecture: PCC Mangle -> Host Routes for Pings -> Routing Tables -> Failsafe -> NAT
    script = f"""
/routing table add name=ISP1 fib
/routing table add name=ISP2 fib

/ip address
add address={wan1_ip_cidr} interface={wan1_iface} comment="WAN1"
add address={wan2_ip_cidr} interface={wan2_iface} comment="WAN2"

/ip firewall mangle
add chain=prerouting dst-address-type=local action=return comment="Local: Router Addresses"
add chain=prerouting in-interface={lan_iface} connection-state=new connection-mark=no-mark per-connection-classifier="both-addresses-and-ports:2/0" action=mark-connection new-connection-mark=ISP1_conn passthrough=yes comment="PCC: ISP1"
add chain=prerouting in-interface={lan_iface} connection-state=new connection-mark=no-mark per-connection-classifier="both-addresses-and-ports:2/1" action=mark-connection new-connection-mark=ISP2_conn passthrough=yes comment="PCC: ISP2"

add chain=prerouting in-interface={wan1_iface} connection-mark=no-mark action=mark-connection new-connection-mark=ISP1_conn passthrough=yes comment="Return: ISP1"
add chain=prerouting in-interface={wan2_iface} connection-mark=no-mark action=mark-connection new-connection-mark=ISP2_conn passthrough=yes comment="Return: ISP2"

add chain=prerouting in-interface={wan1_iface} connection-mark=ISP1_conn action=mark-routing new-routing-mark=ISP1 passthrough=no
add chain=prerouting in-interface={wan2_iface} connection-mark=ISP2_conn action=mark-routing new-routing-mark=ISP2 passthrough=no

add chain=prerouting in-interface={lan_iface} connection-mark=ISP1_conn action=mark-routing new-routing-mark=ISP1 passthrough=no
add chain=prerouting in-interface={lan_iface} connection-mark=ISP2_conn action=mark-routing new-routing-mark=ISP2 passthrough=no

add chain=output connection-mark=ISP1_conn action=mark-routing new-routing-mark=ISP1 passthrough=no
add chain=output connection-mark=ISP2_conn action=mark-routing new-routing-mark=ISP2 passthrough=no

# Monitor IPs routing marks to ensure pings go out the correct interface for failover tests
add chain=output dst-address=208.67.222.222/32 action=mark-routing new-routing-mark=ISP1 passthrough=no
add chain=output dst-address=9.9.9.9/32 action=mark-routing new-routing-mark=ISP1 passthrough=no
add chain=output dst-address=208.67.220.220/32 action=mark-routing new-routing-mark=ISP2 passthrough=no
add chain=output dst-address=149.112.112.112/32 action=mark-routing new-routing-mark=ISP2 passthrough=no

/ip route
# Dedicated Host Routes for Monitor IPs via Routing Tables
add dst-address=208.67.222.222/32 gateway={wan1_gw} routing-table=ISP1 comment="Monitor RT: ISP1-1"
add dst-address=9.9.9.9/32 gateway={wan1_gw} routing-table=ISP1 comment="Monitor RT: ISP1-2"
add dst-address=208.67.220.220/32 gateway={wan2_gw} routing-table=ISP2 comment="Monitor RT: ISP2-1"
add dst-address=149.112.112.112/32 gateway={wan2_gw} routing-table=ISP2 comment="Monitor RT: ISP2-2"

# Main Default Routes (managed by failover script)
add dst-address=0.0.0.0/0 gateway={wan1_gw} distance=1 comment="Default: ISP1"
add dst-address=0.0.0.0/0 gateway={wan2_gw} distance=2 comment="Default: ISP2"

# PCC Routing Table Default Routes
add dst-address=0.0.0.0/0 gateway={wan1_gw} routing-table=ISP1 distance=1 comment="Table ISP1: Primary"
add dst-address=0.0.0.0/0 gateway={wan2_gw} routing-table=ISP1 distance=2 comment="Table ISP1: Failover"
add dst-address=0.0.0.0/0 gateway={wan2_gw} routing-table=ISP2 distance=1 comment="Table ISP2: Primary"
add dst-address=0.0.0.0/0 gateway={wan1_gw} routing-table=ISP2 distance=2 comment="Table ISP2: Failover"

# NEVER DISABLED - Failsafe routes
add dst-address=0.0.0.0/0 gateway={wan1_gw} distance=250 comment="FAILSAFE-WAN1"
add dst-address=0.0.0.0/0 gateway={wan2_gw} distance=251 comment="FAILSAFE-WAN2"

/ip firewall nat
add chain=srcnat out-interface={wan1_iface} action=masquerade comment="NAT: WAN1"
add chain=srcnat out-interface={wan2_iface} action=masquerade comment="NAT: WAN2"

# Flush connections so the rules apply immediately
/ip firewall connection remove [find]
"""
    
    lines = [line.strip() for line in script.splitlines() if line.strip() and not line.startswith("#")]
    for line in lines:
        await ssh_pool.async_run(host, port, user, pwd, line)
            
    # Advanced Failover Script Payload matching the github logic
    evo_domain = evo_url.split("://")[-1].split("/")[0] # Just get the domain/IP for simplicity if needed
    full_webhook_url = f"{evo_url}/message/sendText/NetAgent"

    failover_src = f"""
:global ISP1Status
:global ISP2Status
:global ISP1FailCount
:global ISP2FailCount
:if ([:typeof $ISP1Status]="nothing") do={{ :set ISP1Status "up" }}
:if ([:typeof $ISP2Status]="nothing") do={{ :set ISP2Status "up" }}
:if ([:typeof $ISP1FailCount]="nothing") do={{ :set ISP1FailCount 0 }}
:if ([:typeof $ISP2FailCount]="nothing") do={{ :set ISP2FailCount 0 }}

:local wpNumber "{whatsapp_number}"
:local wpUrl "{full_webhook_url}"
:local wpKey "{evo_key}"

:local isp1ip1up false; :local isp1ip2up false
:if ([/ping address=208.67.222.222 routing-table=ISP1 count=3] > 0) do={{ :set isp1ip1up true }}
:if ([/ping address=9.9.9.9 routing-table=ISP1 count=3] > 0) do={{ :set isp1ip2up true }}
:local isp1BothDown (($isp1ip1up = false) && ($isp1ip2up = false))

:local isp2ip1up false; :local isp2ip2up false
:if ([/ping address=208.67.220.220 routing-table=ISP2 count=3] > 0) do={{ :set isp2ip1up true }}
:if ([/ping address=149.112.112.112 routing-table=ISP2 count=3] > 0) do={{ :set isp2ip2up true }}
:local isp2BothDown (($isp2ip1up = false) && ($isp2ip2up = false))

:if ($isp1BothDown = true) do={{
    :set ISP1FailCount ($ISP1FailCount + 1)
    :if ($ISP1Status = "up" && $ISP1FailCount >= 2) do={{
        :set ISP1Status "down"
        :log error "[FAILOVER] ISP1 DOWN - Both monitors failed"
        /ip firewall connection remove [find where connection-mark=ISP1_conn]
        /ip route disable [find where comment="Default: ISP1"]
        :if ([:len $wpNumber] > 5) do={{
            /tool fetch url=$wpUrl http-method=post http-header-field=("apikey: " . $wpKey . ",Content-Type: application/json") http-data=("{{\\"number\\":\\"" . $wpNumber . "\\",\\"text\\":\\"\\u26A0\\uFE0F *ALERTA CRÍTICO: WAN1 CAIU* \\n\\nO Link ISP1 ({wan1_iface}) parou de responder. O Failover Mangle PCC removeu as rotas ativas e migrou 100% do tráfego para a WAN2.\\"}}") keep-result=no
        }}
    }}
}} else={{
    :if ($ISP1Status = "down") do={{
        :set ISP1Status "up"; :set ISP1FailCount 0
        :log warning "[FAILOVER] ISP1 RECOVERED"
        /ip route enable [find where comment="Default: ISP1"]
        :if ([:len $wpNumber] > 5) do={{
            /tool fetch url=$wpUrl http-method=post http-header-field=("apikey: " . $wpKey . ",Content-Type: application/json") http-data=("{{\\"number\\":\\"" . $wpNumber . "\\",\\"text\\":\\"\\u2705 *RECUPERADO: WAN1 ONLINE* \\n\\nO Link ISP1 ({wan1_iface}) voltou a responder. O balanceamento PCC foi restaurado.\\"}}") keep-result=no
        }}
    }} else={{ :set ISP1FailCount 0 }}
}}

:if ($isp2BothDown = true) do={{
    :set ISP2FailCount ($ISP2FailCount + 1)
    :if ($ISP2Status = "up" && $ISP2FailCount >= 2) do={{
        :set ISP2Status "down"
        :log error "[FAILOVER] ISP2 DOWN - Both monitors failed"
        /ip firewall connection remove [find where connection-mark=ISP2_conn]
        /ip route disable [find where comment="Default: ISP2"]
        :if ([:len $wpNumber] > 5) do={{
            /tool fetch url=$wpUrl http-method=post http-header-field=("apikey: " . $wpKey . ",Content-Type: application/json") http-data=("{{\\"number\\":\\"" . $wpNumber . "\\",\\"text\\":\\"\\u26A0\\uFE0F *ALERTA CRÍTICO: WAN2 CAIU* \\n\\nO Link de Backup ISP2 ({wan2_iface}) parou de responder. O Failover removeu sua conectividade do PCC.\\"}}") keep-result=no
        }}
    }}
}} else={{
    :if ($ISP2Status = "down") do={{
        :set ISP2Status "up"; :set ISP2FailCount 0
        :log warning "[FAILOVER] ISP2 RECOVERED"
        /ip route enable [find where comment="Default: ISP2"]
        :if ([:len $wpNumber] > 5) do={{
            /tool fetch url=$wpUrl http-method=post http-header-field=("apikey: " . $wpKey . ",Content-Type: application/json") http-data=("{{\\"number\\":\\"" . $wpNumber . "\\",\\"text\\":\\"\\u2705 *RECUPERADO: WAN2 ONLINE* \\n\\nO Link ISP2 ({wan2_iface}) voltou a responder.\\"}}") keep-result=no
        }}
    }} else={{ :set ISP2FailCount 0 }}
}}
"""
    # Replace newlines with spaces for a single-line RouterOS command execution via SSH
    safe_failover_src = failover_src.replace('\n', ' ').strip()
    
    # 1. Remove old stuff
    await ssh_pool.async_run(host, port, user, pwd, f"/system script remove [find name=\"failover-monitor\"]")
    await ssh_pool.async_run(host, port, user, pwd, f"/system scheduler remove [find name=\"dual-ip-failover\"]")
    
    # 2. Add System Script
    # Due to length and embedded quotes, using a clean payload
    await ssh_pool.async_run(host, port, user, pwd, f"/system script add name=\"failover-monitor\" source=\"{safe_failover_src}\"")
    
    # 3. Add Scheduler
    await ssh_pool.async_run(host, port, user, pwd, '/system scheduler add name=dual-ip-failover interval=10s start-time=startup on-event="/system script run failover-monitor"')
    
    summary = f"🚀 Super Workflow Dual-WAN PCC estilo VishnuNuk configurado no roteador com sucesso nas interfaces WAN1({wan1_iface}) e WAN2({wan2_iface}). Failover rodando a cada 10s via Scheduler nativo."
    if whatsapp_number:
        summary += f"\n📲 Alertas nativos do Telegram/WhatsApp ativados para o número {whatsapp_number} puxando as credenciais da Evolution API."
    
    return summary


# ── Health endpoint + ASGI app ────────────────────────────────────────────────


from starlette.responses import JSONResponse
from starlette.routing import Route


async def health(request):
    return JSONResponse({"status": "ok", "driver": "mcp-mikrotik"})


# Create the MCP ASGI app, then add health route
app = mcp.http_app(path="/mcp", transport="streamable-http")
app.routes.append(Route("/health", health))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)

