import { BookOpen, HardDrive, ShieldCheck, Server, AlertCircle } from 'lucide-react'

export default function DocsBackups() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <BookOpen className="text-primary" size={40} />
                    Documentação Oficial FastMCP — Backup & FTP
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Este é o manual completo de funcionamento do sistema de <strong>Backups Automatizados</strong> do NetAgent via protocolo FTP nativo.
                    O objetivo desta plataforma é unificar a guarda de configurações sensíveis, simplificar o processo de restore em equipamentos de rede
                    e remover dependências de servidores de terceiros ou nuvens externas complexas.
                </p>

                <div className="mt-8 bg-gradient-to-r from-blue-500/10 to-indigo-500/5 p-6 rounded-xl border border-blue-500/20">
                    <h3 className="text-xl font-bold text-blue-400 mb-3 flex items-center gap-2">
                        <HardDrive size={22} className="text-indigo-400" /> Como o Sistema Funciona
                    </h3>
                    <p className="text-text-muted text-sm mb-4">
                        O NetAgent roda um servidor FTP embutido (baseado em <code>vsftpd</code>) que recebe os arquivos diretamente dos equipamentos. O fluxo é construído com segurança e isolamento por inquilino/dispositivo:
                    </p>
                    <ul className="list-disc pl-5 text-text-muted text-sm space-y-2">
                        <li><strong>Vinculação:</strong> No painel, você vincula um dispositivo. Nos bastidores, o NetAgent cria uma pasta FTP isolada com o nome do <strong>UUID (ID Único)</strong> estrutural desse equipamento no sistema Linux interno.</li>
                        <li><strong>Isolamento:</strong> O usuário de FTP <code>backup_user</code> só enxerga o diretório matriz <code>/var/backups/netagent</code>, sem ter qualquer acesso ao sistema operacional (shell <code>/bin/false</code>).</li>
                        <li><strong>Recebimento:</strong> O equipamento de rede (ex. MikroTik) envia o arquivo de backup e o sistema o correlaciona no Front-End lendo esse UUID e exibindo sob o nome fantasia cadastrado no dashboard.</li>
                    </ul>
                </div>
            </header>

            {/* SEÇÃO 1: INSTRUÇÕES TÉCNICAS E PERMISSÕES */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Server className="text-emerald-500" size={32} />
                    Migração de Servidor e Permissões (Setup Técnico)
                </h2>
                <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                    <h3 className="text-xl font-bold text-emerald-400 mb-3">O que fazer se eu mudar de Servidor Linux?</h3>
                    <p className="text-sm text-text-muted mb-4">
                        Se você decidir migrar a plataforma NetAgent para outro VPS ou formato de infraestrutura, os serviços de FTP precisam de algumas proteções no OS hospedeiro para garantir a integridade e segurança.
                        O script de instalação original cria isso, mas se você estiver subindo manualmente em um novo Linux, siga os passos abaixo:
                    </p>
                    <div className="bg-bg-elevated p-4 rounded-lg border border-border mt-4">
                        <ol className="list-decimal pl-5 text-sm text-text space-y-4">
                            <li>
                                <strong>Criação de Usuário com Shell Bloqueado:</strong>
                                <p className="text-text-muted mt-1 shadow-sm px-2">É vital que o usuário não consiga abrir um terminal SSH.</p>
                                <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded text-accent font-mono mt-2 overflow-x-auto text-xs">
                                    sudo useradd -m -d /var/backups/netagent -s /bin/false backup_user<br />
                                    sudo echo "backup_user:SUA_SENHA_AQUI" | sudo chpasswd
                                </pre>
                            </li>
                            <li>
                                <strong>Corrigir o PAM (FTP Block):</strong>
                                <p className="text-text-muted mt-1 px-2">O FTP no Linux muitas vezes nega acesso se o usuário não possuir um shell na lista oficial.</p>
                                <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded text-accent font-mono mt-2 overflow-x-auto text-xs">
                                    echo "/bin/false" | sudo tee -a /etc/shells
                                </pre>
                            </li>
                            <li>
                                <strong>Configuração do VSFTPD:</strong>
                                <p className="text-text-muted mt-1 px-2">A edição passiva das configurações FTP.</p>
                                <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded text-accent font-mono mt-2 overflow-x-auto text-xs">
                                    sudo sed -i 's/listen_port=.*/listen_port=2121/' /etc/vsftpd.conf<br />
                                    echo "pasv_min_port=40000" | sudo tee -a /etc/vsftpd.conf<br />
                                    echo "pasv_max_port=40500" | sudo tee -a /etc/vsftpd.conf<br />
                                    sudo systemctl restart vsftpd
                                </pre>
                            </li>
                            <li>
                                <strong>Liberação do Firewall (UFW):</strong>
                                <p className="text-text-muted mt-1 px-2">Para evitar Timeout passivo, as portas passivas precisam ser liberadas pro mundo.</p>
                                <pre className="bg-zinc-900 border border-zinc-800 p-3 rounded text-accent font-mono mt-2 overflow-x-auto text-xs">
                                    sudo ufw allow 2121/tcp<br />
                                    sudo ufw allow 40000:40500/tcp
                                </pre>
                            </li>
                        </ol>
                    </div>
                </div>
            </section>

            {/* SEÇÃO 2: BOAS PRÁTICAS E CUIDADOS */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <ShieldCheck className="text-orange-500" size={32} />
                    Gestão, Segurança e Troubleshooting
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Rotinas de Limpeza (Retention)</h3>
                        <p className="text-sm text-text-muted mb-4 flex-grow">
                            Atualmente os dispositivos acumulam backups. Não deixe o disco do seu servidor principal encher de backups antigos de configurações de Roteadores, gerando custos de armazenamento desnecessários no seu Cloud.
                            <strong> Como apagar:</strong> Você pode excluir pontualmente pelo front-end no botão <span className="text-danger">Excluir</span> ou rodar em crontab local no NetAgent comandos Linux antigos usando <code className="text-accent">find /var/backups -mtime +30 -delete</code>.
                        </p>
                    </div>

                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Gerando o Script MikroTik</h3>
                        <p className="text-sm text-text-muted mb-4 flex-grow">
                            Ao clicar em <strong>"Ver Script"</strong> o sistema já te entrega a rotina (Schedule e Script) formatada com a sua senha e porta corretas.
                            Caso o backup falhe de subir:
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><AlertCircle size={14} className="inline text-danger mr-1" /> Veja os logs no MikroTik (<code>/log print</code>).</li>
                            <li><AlertCircle size={14} className="inline text-danger mr-1" /> A porta passiva do Firewall Ubuntu (UFW) pode estar bloqueando a transferência.</li>
                        </ul>
                    </div>
                </div>
            </section>
        </div>
    )
}
