import { BookOpen, Layers, Network, Shield, ShieldAlert, Rocket, MessageSquare, Zap } from 'lucide-react'

export default function DocsMikrotik() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <BookOpen className="text-primary" size={40} />
                    Documentação Oficial FastMCP — Universo MikroTik
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Este é o manual completo de capacidades do seu <strong>Agente Autônomo NetAgent</strong> para equipamentos MikroTik.
                    Ele não apenas executa comandos isolados, mas possui <strong>Inteligência de Encadeamento (Chaining)</strong>: a capacidade de entender um pedido complexo, quebrar em múltiplas ferramentas e executá-las de forma autônoma lidando com dependências e erros.
                </p>

                <div className="mt-8 bg-gradient-to-r from-primary/10 to-accent/5 p-6 rounded-xl border border-primary/20">
                    <h3 className="text-xl font-bold text-primary mb-3 flex items-center gap-2">
                        <Zap size={22} className="text-accent" /> O Poder do Encadeamento (Chaining)
                    </h3>
                    <p className="text-text-muted text-sm mb-4">
                        Você não precisa pedir passo a passo. O Agente sabe a ordem exata das coisas. Veja este exemplo:
                    </p>
                    <div className="bg-bg-elevated p-4 rounded-lg border border-border">
                        <span className="block text-primary mb-2 font-bold flex items-center gap-2">
                            <MessageSquare size={16} /> Exemplo de Prompt no Chat:
                        </span>
                        <p className="text-text italic font-medium">
                            "No roteador mikrotik-borda, cria uma VLAN de ID 500 na porta ether4 e chama de vlan-clientes. Adiciona o IP 10.0.0.1/24 nela. Depois, sobe um DHCP Server completo pra essa rede e já cria uma regra de NAT (Masquerade) pra eles acessarem a internet."
                        </p>
                    </div>
                </div>
            </header>

            {/* CATEGORIA 1: INTERFACES E LAYER 2 */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Layers className="text-blue-500" size={32} />
                    Interfaces & Layer 2 (Bridges / VLANs)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-blue-400 mb-3">VLANs e Bridge</h3>
                        <p className="text-sm text-text-muted mb-4">Gestão completa da camada física e lógica. Permite criar VLANs roteadas ou amarradas a Bridges.</p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">vlan_create</span>: name, interface_parent, vlan_id.</li>
                            <li><span className="text-accent font-mono">bridge_create / bridge_remove</span>: name. Cria a ponte lógica.</li>
                            <li><span className="text-accent font-mono">bridge_port_add</span>: bridge_name, interface. Coloca as interfaces dentro da Bridge.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-blue-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Cria uma bridge chamada br-local e adiciona a ether2 e ether3 nela no equipamento mikrotik-core."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-blue-400 mb-3">Interface Ethernet e Físicos</h3>
                        <p className="text-sm text-text-muted mb-4">Visualização e manipulação de portas físicas e transceivers SFP.</p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">interface_list</span>: Lista todas as interfaces, status (R), TX/RX bytes.</li>
                            <li><span className="text-accent font-mono">interface_enable / disable</span>: Desliga fisicamente ou liga a porta.</li>
                            <li><span className="text-accent font-mono">sfp_monitor</span>: Diagnóstico de sinal de fibra (TX/RX optical power).</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-blue-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Desativa a ether5 no mikrotik-core porque o cabo parece estar oxidado."
                        </div>
                    </div>
                </div>
            </section>

            {/* CATEGORIA 2: SERVIÇOS IP E ROTEAMENTO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Network className="text-orange-500" size={32} />
                    Serviços IP, DHCP & Roteamento Wan/LAN
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">IP e DHCP</h3>
                        <ul className="text-sm space-y-2 text-text flex-grow">
                            <li><span className="text-accent font-mono">ip_address_create</span>: address (CIDR), interface.</li>
                            <li><span className="text-accent font-mono">dhcp_server_create</span>: Resolve automaticamente o IP Pool e Network. Argumentos: name, interface, lease_time.</li>
                            <li><span className="text-accent font-mono">dhcp_lease_list</span>: Exibe os clientes pegando IP dinâmico com MAC e hostname.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-orange-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Põe o IP 192.168.88.1/24 na ether2 e sobe um DHCP pra ela no mikrotik-office."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Rotas Estáticas e DNS</h3>
                        <ul className="text-sm space-y-2 text-text flex-grow">
                            <li><span className="text-accent font-mono">route_add</span>: dst-address, gateway, distance, routing-mark, comment.</li>
                            <li><span className="text-accent font-mono">dns_servers_set</span>: servers, allow_remote_requests (para atuar como cache DNS).</li>
                            <li><span className="text-accent font-mono">dns_cache_flush</span>: Limpa o cache para resolver problemas de propagação.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-orange-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Muda o DNS do mikrotik-core para 8.8.8.8, permite conexões remotas e dá um flush no cache."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Roteamento Dinâmico (OSPF / BGP)</h3>
                        <ul className="text-sm space-y-2 text-text flex-grow">
                            <li><span className="text-accent font-mono">ospf_instance_create / area_add</span>: Configura o backbone corporativo e redistribuição (bgp, connected).</li>
                            <li><span className="text-accent font-mono">bgp_instance_create / peer_add</span>: Fechamento de trânsito ASN (local as, remote as, router id, in/out filters).</li>
                            <li><span className="text-accent font-mono">bgp_advertisements_list</span>: Verifica o que você está anunciando pro mundo.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-orange-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Lista os pacotes BGP do mikrotik-edge pra mim, quero ver as rotas."
                        </div>
                    </div>
                </div>
            </section>

            {/* CATEGORIA 3: VPNs, TÚNEIS E ISP */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Shield className="text-emerald-500" size={32} />
                    VPNs, PPPoE (Provedor) & Hotspot
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-emerald-400 mb-3">Conectividade e ISPs</h3>
                        <p className="text-sm text-text-muted mb-4">Suporte completo para gerenciamento de clientes de Provedor de Internet.</p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">pppoe_server_create</span>: Sobe o BNAS na interface desejada com perfis de banda.</li>
                            <li><span className="text-accent font-mono">pppoe_secret_add</span>: name, password, profile, local-address (IP Fixo).</li>
                            <li><span className="text-accent font-mono">hotspot_server_setup</span>: address-pool, interface, dns-name (Cria tela de login/Captive Portal).</li>
                            <li><span className="text-accent font-mono">hotspot_user_add</span>: MAC, server, profile (Controle de banda e vouchers).</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-emerald-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Cria o usuário PPPoE mario com a senha admin, para pegar o plano 100M no mikrotik-concentrador."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-emerald-400 mb-3">VPNs Corporativas</h3>
                        <p className="text-sm text-text-muted mb-4">Interligação de redes seguras Layer 2 e 3.</p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">openvpn_server_setup / openvpn_client_add</span>: Gestão de túneis OVPN nativos.</li>
                            <li><span className="text-accent font-mono">wireguard_peer_add</span>: Configuração de chaves públicas/privadas super rápido.</li>
                            <li><span className="text-accent font-mono">tunnel_eoip_create / tunnel_gre_create</span>: remote-address, tunnel-id, local-address. Layer 2 bridgeable pela WAN.</li>
                            <li><span className="text-accent font-mono">ipsec_peer_add / policy_add</span>: VPN Site-to-Site.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-emerald-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "No roteador mikrotik-matriz, me faz um túnel EoIP para o IP remoto 200.200.200.1 com ID 10."
                        </div>
                    </div>
                </div>
            </section>

            {/* CATEGORIA 4: FIREWALL E QOS */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <ShieldAlert className="text-red-500" size={32} />
                    Firewall Avançado, NAT e QoS
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-red-400 mb-3">Firewall e Traffic Control</h3>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">firewall_filter_add</span>: accept, drop, reject. Parâmetros: chain, src/dst-address, protocol, port, tcp-flags.</li>
                            <li><span className="text-accent font-mono">firewall_nat_add</span>: masquerade, dst-nat (Redirecionamento de portas), src-nat (CGNAT).</li>
                            <li><span className="text-accent font-mono">firewall_mangle_add</span>: Marcação de pacotes (mark-connection, mark-routing) para Failover e Balanceamento de Banda.</li>
                            <li><span className="text-accent font-mono">firewall_raw_add</span>: Proteção DDoS pré-routing sem onerar CPU (track=no).</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-red-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Faz um redirecionamento DST-NAT no mikrotik-borda para a porta 3389 apontando pro servidor local 192.168.1.50."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-red-400 mb-3">Quality of Service (QoS / Filas)</h3>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">simple_queue_add</span>: target-ip, max-limit (Ex: 50M/50M). Controle básico por IP ou Ponto.</li>
                            <li><span className="text-accent font-mono">queue_tree_add</span>: parent, packet-mark. Controle hierárquico avançado de provedores por priorização (Layer 7).</li>
                            <li><span className="text-accent font-mono">queue_type_set</span>: Configura o PCQ (Per Connection Queue) ou FQ-Codel para divisão igualitária da banda.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-red-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Cria uma simple queue chamada 'Diretoria' e limita o IP 192.168.1.10 a 200 Mega no Roteador principal."
                        </div>
                    </div>
                </div>
            </section>

            {/* CATEGORIA 5: WORKFLOWS ESPECIAIS E DIAGNÓSTICO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Rocket className="text-purple-500" size={32} />
                    Workflows Mágicos & Diagnósticos Profundos
                </h2>

                {/* Workflow: Load Balance */}
                <div className="bg-gradient-to-r from-purple-500/10 to-bg-surface p-6 rounded-xl border border-purple-500/20 shadow-sm mb-6">
                    <h3 className="text-2xl font-bold text-purple-400 mb-2">PCC Load Balance com Failover e WhatsApp</h3>
                    <p className="text-sm text-text-muted mb-4">
                        Macro autônoma que cria 100% da inteligência para você ter 2 operadoras roteando juntas (`workflow_setup_dual_wan_lb`). Ele escreve regras de Mangle complexas para divisão de conexão (PCC 2/0, 2/1), tabelas de roteamento FIB puras e um script de robô agendado para rodar a cada 10s. O script faz ping inteligente em 4 IPs públicos (monitoramento distribuído em host-routes exclusivas da interface) e, caso detecte queda massiva, envia um Webhook via Evolution API com um alerta de WhatsApp imediatamente, re-roteando tudo.
                    </p>
                    <div className="bg-bg-elevated p-4 rounded text-sm font-mono text-purple-300">
                        <strong className="text-purple-400 block mb-1">💡 Exemplo no Chat:</strong>
                        "Configura o load balance dual-wan no mikrotik-core. WAN1 é ether1 (IP 192.168.1.2/24 GW 192.168.1.1), WAN2 é ether2 (IP 10.0.0.2/24 GW 10.0.0.1) e LAN é a ether3. Se cair manda WhatsApp para 5511999999999."
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-purple-400 mb-3">Diagnósticos de Rede Interna</h3>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">ping / traceroute</span>: count, address, interface, router-table.</li>
                            <li><span className="text-accent font-mono">bandwidth_test</span>: Checa o throughput real de TCP/UDP contra um servidor BTest remoto.</li>
                            <li><span className="text-accent font-mono">torch</span>: Captura o tráfego em tempo real cruzando a interface. Ideal pra achar quem tá sugando banda!</li>
                            <li><span className="text-accent font-mono">connection_tracking</span>: Puxa o status de conexões vivas do firewall pra ver se o NAT aplicou.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-purple-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Roda um ping pro 8.8.8.8 usando a interface WAN do equipamento mikrotik-core."
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-purple-400 mb-3">Gestão Sistêmica do Router</h3>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">system_backup_create / export</span>: Puxa todo o script ou binário de backup de segurança.</li>
                            <li><span className="text-accent font-mono">logs_read</span>: Faz o "tail" nos logs críticos (error, warning, pppoe, bgp).</li>
                            <li><span className="text-accent font-mono">user_add / secret_change</span>: Gestão de operadores de TI logados no roteador.</li>
                            <li><span className="text-accent font-mono">intelligent_workflow_cli</span>: Acesso "root" (risco alto) permitindo enviar qualque comando puro RouterOS protegido pelo co-piloto limitador contra deletes acidentais.</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-purple-400 block mb-1">💡 Exemplo no Chat:</strong>
                            "Lê os últimos logs de PPPoE no mikrotik-borda, tem muito cliente reclamando."
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}
