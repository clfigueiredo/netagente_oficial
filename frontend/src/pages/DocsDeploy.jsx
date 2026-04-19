import React from 'react';
import { Terminal, Shield, Box, Server, CheckCircle2 } from 'lucide-react';

export default function DocsDeploy() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            {/* Header */}
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <Box className="text-primary" size={40} />
                    Implantação e Instalação (Deploy)
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Manual de empacotamento e implantação oficial do NetAgent Platform para novos servidores (Debian/Ubuntu).
                </p>
            </header>

            {/* Architecture Overview */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Server className="text-blue-500" size={32} />
                    Arquitetura do Pacote
                </h2>
                <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                    <p className="text-sm text-text-muted mb-4">
                        O pacote de instalação (`netagent-installer.tar.gz`) é híbrido. Ele utiliza o Docker para a camada de serviços pesados e o Host para processos que gerenciam a rede diretamente.
                    </p>
                    <ul className="text-sm space-y-2 text-text list-inside list-disc">
                        <li><strong>Docker (Infraestrutura):</strong> PostgreSQL 16 (pgvector), Redis 7, Traefik (Proxy/SSL), Evolution API v1, MCP MikroTik, MCP Linux, Servidor WireGuard e Nginx (servindo o Frontend estático).</li>
                        <li><strong>Host (Debian 12):</strong> Node.js 20 (API Backend), Python 3.12 (Agente de IA), VSFTPD (para recebimento nativo de Backups Mirkotik isolados por inquilino).</li>
                        <li><strong>PM2:</strong> Orquestrador de processos que mantém a API e o Agente Python rodando no Host.</li>
                    </ul>
                </div>
            </section>

            {/* Generation Phase */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Box className="text-emerald-500" size={32} />
                    1. Como Gerar o Pacote (Origem)
                </h2>
                <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                    <p className="text-sm text-text-muted mb-4">
                        Para gerar o pacote inteiro pronto para deploy, rode o script `build.sh` no servidor atual. Ele fará o build do React, copiará os drivers MCP, limpará os `node_modules` locais e criará um `.tar.gz`.
                    </p>
                    <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden flex flex-col mt-4">
                        <div className="flex px-4 py-2 bg-white/5 border-b border-border text-xs font-mono text-text-muted">
                            Terminal
                        </div>
                        <pre className="p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9]">
                            {`cd /var/www/agente_forum_telecom
bash installer/build.sh

# Resultado: netagent-installer.tar.gz será gerado na raiz.`}
                        </pre>
                    </div>
                </div>
            </section>

            {/* Installation Phase */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Terminal className="text-purple-500" size={32} />
                    2. Instalação no Novo Servidor (Destino)
                </h2>
                <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                    <p className="text-sm text-text-muted mb-4">
                        Envie o arquivo `netagent-installer.tar.gz` para o novo servidor (Debian 12 recomendado) e extraia-o. Depois execute o `install.sh`.
                    </p>
                    <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden flex flex-col mt-4">
                        <pre className="p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9]">
                            {`tar -xzf netagent-installer.tar.gz
sudo bash install.sh`}
                        </pre>
                    </div>

                    <h3 className="text-lg font-bold text-purple-400 mt-6 mb-3">O que o script pergunta:</h3>
                    <ul className="text-sm space-y-2 text-text list-inside list-disc">
                        <li><strong>Domínio da Plataforma</strong>: ex: agente.suaempresa.com.br</li>
                        <li><strong>Domínio Evolution</strong>: ex: evo.suaempresa.com.br</li>
                        <li><strong>E-mail Let's Encrypt</strong>: Para geração automática do SSL.</li>
                        <li><strong>OpenAI Key</strong>: A chave de API do ChatGPT (`sk-...`).</li>
                    </ul>
                </div>
            </section>

            {/* Security and Firewall */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Shield className="text-red-500" size={32} />
                    Segurança, Senhas e Firewall
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-red-400 mb-3">Autogeração de Segredos</h3>
                        <p className="text-sm text-text-muted">
                            Todas as senhas sensíveis (Evolution, PostgreSQL, Redis, JWT) são blindadas geradas automaticamente por <strong>openssl</strong> no script e salvas no arquivo <code>/opt/netagent/.env</code>.
                        </p>
                    </div>

                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-red-400 mb-3">Firewall (UFW)</h3>
                        <p className="text-sm text-text-muted">
                            O UFW será ativado pelo instalador trancando o servidor e deixando aberto apenas:
                        </p>
                        <ul className="text-sm space-y-1 text-text list-inside list-disc mt-2">
                            <li>22 (SSH)</li>
                            <li>80 / 443 (Traefik / Nginx HTTPS)</li>
                            <li>51820 UDP (WireGuard VPN)</li>
                            <li>2121 TCP (vsftpd Port)</li>
                            <li>40000:40500 TCP (vsftpd Passivo)</li>
                        </ul>
                    </div>
                </div>
            </section>

            {/* Completion */}
            <div className="bg-green-500/10 border border-green-500/20 p-6 rounded-xl flex items-center gap-4">
                <CheckCircle2 className="w-10 h-10 text-green-500 shrink-0" />
                <div>
                    <h3 className="text-lg font-bold text-green-600 dark:text-green-400">Primeiro Acesso</h3>
                    <p className="text-sm text-green-600/80 dark:text-green-400/80 mt-1">
                        Se este for um servidor novo, o script imprimirá no terminal os dados do usuário <strong>Superadmin</strong> recém-criado na base de dados (email e senha) para você poder fazer login imediatamente.
                    </p>
                </div>
            </div>

        </div>
    );
}
