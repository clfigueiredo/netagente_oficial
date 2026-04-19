import { BookOpen, Activity } from 'lucide-react'

export default function DocsMonitor() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <BookOpen className="text-primary" size={40} />
                    Documentação — Monitoramento Ativo
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Entenda como o NetAgent supervisiona seu parque de ativos de rede autonomamente a cada minuto.
                </p>
            </header>

            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Activity className="text-pink-500" size={32} />
                    Monitoramento Ativo, Redis e WhatsApp
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-pink-500 mb-3">Como o Motor Funciona</h3>
                        <p className="text-sm text-text-muted mb-4">
                            Existe um <strong>Agendador (APScheduler)</strong> que roda de forma contínua a cada exatos <strong>60 segundos</strong> na memória Python. Ele varre o banco de dados procurando por todas as empresas (tenants).
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">Coleta via SSH</span>: Bate em cada equipamento ativamente para extrair Uptime, CPU e Memória (MikroTik ou Linux).</li>
                            <li><span className="text-accent font-mono">Cache Ultra Rápido (Redis)</span>: Grava a temperatura do dispositivo ("Estou vivo e com 25% de CPU") no Redis (TTL de 90 segundos) para o Dashboard.</li>
                            <li><span className="text-accent font-mono">Persistência (PostgreSQL)</span>: Renova apenas o campo <code>last_seen_at</code>, garantindo durabilidade.</li>
                        </ul>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-pink-500 mb-3">Alertas Inteligentes (WhatsApp)</h3>
                        <p className="text-sm text-text-muted mb-4">
                            Durante a coleta, o sistema valida métricas críticas para notificar os administradores via Evolution API.
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li><span className="text-accent font-mono">Queda (Offline)</span>: Erros de SSH ou timeout de ping alertam imediatamente.</li>
                            <li><span className="text-accent font-mono">Sobrecarga de CPU</span>: Ultrapassando 85% sustentados ou picos de tráfego.</li>
                            <li><span className="text-accent font-mono">Anti-Spam (Debounce)</span>: Sem flood. Se cair, ele entra num <strong>Cooldown de 30 minutos</strong> antes de avisar algo pendente daquele nó.</li>
                        </ul>
                    </div>
                </div>
            </section>
        </div>
    )
}
