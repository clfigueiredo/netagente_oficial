import React from 'react';
import { ShieldCheck, Server, Key, Users, BookOpen, AlertTriangle, Workflow, Download, Activity, Cog } from 'lucide-react';

export default function DocsWireguard() {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8 text-cyan-500" />
                    Documentação Oficial FastMCP — VPN WireGuard
                </h1>
                <p className="text-text-muted mt-2">
                    Arquitetura, funcionamento interno e guia de migração do Concentrador VPN NetAgent.
                </p>
            </div>

            <div className="bg-bg-elevated border border-border p-6 rounded-xl">
                <h2 className="text-lg font-bold text-text flex items-center gap-2 mb-4">
                    <Workflow className="w-5 h-5 text-primary" />
                    Arquitetura: Isolamento por Tenant (Multi-Empresa)
                </h2>
                <div className="space-y-4 text-sm text-text-muted">
                    <p>
                        O NetAgent atua como um <strong>Concentrador WireGuard nativo</strong>. Em vez de utilizar uma única interface global para todos os clientes, a arquitetura foi desenhada para garantir <strong>isolamento lateral absoluto</strong> entre as empresas (Tenants).
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>1 Interface por Empresa:</strong> Cada tenant no GIN recebe uma interface WireGuard exclusiva no Docker Host (ex: <code>wg_forumtelecom</code>).</li>
                        <li><strong>Sub-redes Únicas (CIDR /24):</strong> O sistema aloca automaticamente redes privadas sequenciais (ex: <code>10.100.1.0/24</code>, <code>10.100.2.0/24</code>, etc.) impedindo que pacotes de uma empresa alcancem roteadores de outra.</li>
                        <li><strong>Alocação de Portas UDP:</strong> Para cada nova empresa, uma nova porta é reservada a partir da porta base <code>51821</code>.</li>
                        <li><strong>Host Networking:</strong> O container do WireGuard executa no modo <code>network_mode: "host"</code>. Isso significa que as interfaces virtuais (<code>wg_*</code>) são injetadas diretamente no Kernel do servidor Ubuntu principal, permitindo roteamento direto pelo Agente NetAgent.</li>
                    </ul>
                </div>
            </div>

            <div className="bg-bg-elevated border border-border p-6 rounded-xl">
                <h2 className="text-lg font-bold text-text flex items-center gap-2 mb-4">
                    <Cog className="w-5 h-5 text-indigo-500" />
                    Fluxo de Funcionamento e Arquivos
                </h2>
                <div className="space-y-4 text-sm text-text-muted">
                    <p>
                        Quando um cliente clica em "Adicionar Peer" no Dashboard, o backend executa o seguinte fluxo:
                    </p>
                    <ol className="list-decimal pl-5 space-y-3">
                        <li><strong>Verificação de Tenant:</strong> O sistema checa em <code>public.tenants</code> se o tenant já tem <code>wg_port</code>, <code>wg_private_key</code> e <code>wg_subnet</code>. Se não tiver, essas informações são geradas e o banco é atualizado.</li>
                        <li><strong>Geração do Arquivo de Configuração (Interface):</strong> O arquivo <code>/data/wireguard/wg_nome_da_empresa.conf</code> é gerado contendo a chave privada do servidor e regras de <code>iptables</code> de MASQUERADE.</li>
                        <li><strong>Interface Up:</strong> O comando <code>wg-quick up wg_nome_da_empresa</code> é invocado para subir a interface no kernel.</li>
                        <li><strong>Alocação de Peer:</strong> O sistema gera a chave do cliente e encontra o próximo IP disponível no range <code>/24</code> daquele tenant.</li>
                        <li><strong>Injeção a Quente (Hot Reload):</strong> O peer é adicionado ao arquivo <code>.conf</code> do servidor. Em seguida, usamos <code>wg syncconf</code> para aplicar a nova rede VPN <em>sem derrubar as conexões ativas</em>.</li>
                    </ol>

                    <h3 className="font-bold text-gray-900 dark:text-gray-100 mt-6 mb-2">Estrutura de Arquivos no Servidor NetAgent</h3>
                    <pre className="bg-gray-900 text-gray-300 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                        {`/var/www/agente_forum_telecom
├── docker-compose.yml              # wireguard service using network_mode: "host"
├── docker/wireguard/Dockerfile     # Minimal image (ubuntu + wireguard-tools)
└── data/wireguard/                 # Arquivos de configuração gerados (Volume)
    ├── wg_forumtelec.conf          # Config da empresa Forum Telecom
    ├── wg_empresa2.conf            # Config da empresa 2
    └── wg_empresa3.conf            # Config da empresa 3
`}
                    </pre>
                </div>
            </div>

            <div className="bg-bg-elevated border border-border p-6 rounded-xl">
                <h2 className="text-lg font-bold text-text flex items-center gap-2 mb-4">
                    <Server className="w-5 h-5 text-emerald-500" />
                    Guia de Migração de Servidor (Setup Inicial)
                </h2>
                <div className="space-y-4 text-sm text-text-muted">
                    <p>
                        Se você migrar todo o painel NetAgent para um novo VPS (ex: da Hetzner para AWS), você precisa reconfigurar o WireGuard e as proteções de Firewall no SO Ubuntu subjacente. Siga estes passos de infraestrutura:
                    </p>

                    <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg mt-4">
                        <h4 className="font-bold text-primary mb-2">1. Preparar o Kernel do Ubuntu (Host OS)</h4>
                        <p className="mb-2">É imperativo habilitar o roteamento de pacotes IPv4 no SO base do servidor.</p>
                        <pre className="bg-gray-900 text-gray-300 p-3 rounded-lg font-mono text-xs select-all">
                            {`# 1. Edite o arquivo sysctl
sudo nano /etc/sysctl.conf

# 2. Descomente a seguinte linha:
net.ipv4.ip_forward=1

# 3. Aplique as mudanças imediatamente sem reboot
sudo sysctl -p`}
                        </pre>
                    </div>

                    <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg mt-4">
                        <h4 className="font-bold text-primary mb-2">2. Liberar Portas no UFW (Firewall do Host)</h4>
                        <p className="mb-2">
                            Como o container WireGuard utiliza <code>network_mode: "host"</code>, o proxy reverso (Traefik/Docker) <strong>não injeta regras em iptables automaticamente</strong>. O tráfego bate direto na placa de rede eth0 do VPS e para na porta (DROP) do UFW se não for liberado explicitamente.
                        </p>
                        <p className="mb-2 text-red-500 dark:text-red-400 font-medium">Atenção: A ausência dessa regra resultará no erro de roteamento "Destination Host Unreachable" e falha de handshake nos clientes MikroTik.</p>
                        <pre className="bg-gray-900 text-gray-300 p-3 rounded-lg font-mono text-xs select-all">
                            {`# Libera um range massivo de portas UDP 
# (do 51820 até 51870 atende 50 empresas distintas)
sudo ufw allow 51820:51870/udp

# Verifique as regras de firewall
sudo ufw status`}
                        </pre>
                    </div>

                    <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg mt-4">
                        <h4 className="font-bold text-primary mb-2">3. Restauração do Docker Compose</h4>
                        <p className="mb-2">O deploy do frontend já compilará a imagem minimalista de WireGuard do sistema.</p>
                        <pre className="bg-gray-900 text-gray-300 p-3 rounded-lg font-mono text-xs select-all">
                            {`cd /var/www/agente_forum_telecom
# O comando abaixo vai recriar o container se necessário
docker compose up -d wireguard --build`}
                        </pre>
                    </div>
                </div>
            </div>

            <div className="bg-bg-elevated border border-border p-6 rounded-xl">
                <h2 className="text-lg font-bold text-text flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    Troubleshooting (Resolução de Problemas Avançados)
                </h2>
                <div className="space-y-6 text-sm text-text-muted">

                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-2">
                            <Activity className="w-4 h-4 text-primary" />
                            Problema: Handshake zerado ou "Destination Host Unreachable"
                        </h4>
                        <p className="mb-2"><strong>Sintoma:</strong> No dashboard do NetAgent, o "Último Handshake" diz "--". Ao enviar um ping do Host Linux ou tentar conectar via Winbox no IP privado do MikroTik, você toma block.</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><strong>Causa 1 (UFW Blocando):</strong> Confirmar se as portas UDP do tenant estão abertas (<code>ufw status</code>) pois o <code>network_mode: "host"</code> do Docker bypassa a automação de portas iptables padrão do Docker.</li>
                            <li><strong>Causa 2 (Sub-rede Clashing):</strong> Se a rede local do roteador do cliente (ex: hotspot local em 10.100.X.X) sobrepor o prefixo exato da VPN do respectivo tenant, ocorrerá falha de encaminhamento de rotas. O CIDR no Allowed-Address resolve isso, mas avalie a tabela IP Route de borda.</li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-2">
                            <Key className="w-4 h-4 text-primary" />
                            Problema: Peers Duplicados ou Conflitos de AllowedIPs
                        </h4>
                        <p className="mb-2"><strong>Regra Fundamental do WireGuard:</strong> Dois peers não podem ter o mesmo "AllowedIPs" sob penalidade de erro no Kernel Layer 3 (Required key not available) e a interface "capota".</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>A API do NetAgent gerencia <code>wg syncconf wg_nome_da_empresa %i</code> precisamente isolando IP /32.</li>
                            <li>Em caso extremo, no terminal do NetAgent, use o comando <code>nano /var/www/agente_forum_telecom/data/wireguard/wg_SUA_EMPRESA.conf</code> para ver manualmente duplicidade excessiva e delete a dupla manualmente e salve.</li>
                            <li>Depois force o refresh do Kernel: <code>docker exec netagent-wireguard wg-quick down wg_NOME_AQUI && docker exec netagent-wireguard wg-quick up wg_NOME_AQUI</code></li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-2">
                            <Users className="w-4 h-4 text-primary" />
                            Problema: Agente LLM não enxerga os roteadores no MikroTik-Expert
                        </h4>
                        <p className="mb-2">O Agente Python utiliza a conexão direta via IP (porta custom SSH ou API). Ele vai conectar no IP configurado no <em>Dispositivo</em> do Dashboard principal (geralmente o IP VPN do MikroTik, ex: <code>10.100.1.2</code>).</p>
                        <p>Certifique-se que você "vinculou" o Peer do WireGuard ao Cadastro de Dispositivo respectivo ao rodar o Wizard.</p>
                    </div>

                </div>
            </div>

            <div className="bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/20 p-6 rounded-xl flex max-md:flex-col items-center justify-between gap-6">
                <div>
                    <h3 className="text-lg font-bold text-cyan-500 mb-1">Backup Descentralizado do VPN</h3>
                    <p className="text-sm text-text-muted">A pasta <code>/data/wireguard/</code> contém todas as chaves privadas de servidor, chaves simétricas providas em scripts, e ips de handshakes em interfaces operativas.</p>
                </div>
            </div>
        </div>
    );
}
