import { BookOpen, Cpu } from 'lucide-react'

export default function DocsLinux() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <BookOpen className="text-primary" size={40} />
                    Documentação — Universo Linux
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Referência completa para gerenciamento e diagnóstico de Servidores Linux baseados em Debian/Ubuntu.
                </p>
            </header>

            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Cpu className="text-emerald-500" size={32} />
                    Ubuntu / Linux Servers Integration
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-emerald-500 mb-2">Recursos da Máquina</h3>
                        <ul className="text-sm text-text-muted space-y-2">
                            <li><strong>Monitoramento de Memória:</strong> Análise de <code>free -m</code>, consumo de RAM e estabilidade do Swap.</li>
                            <li><strong>Analise de Disco (df/du):</strong> Mapeamento do uso das partições cruciais e caçada a logs gigantes que tombaram o disco.</li>
                            <li><strong>CPU Profile:</strong> Análise do <code>top / htop</code> e Load Average para descobrir gargalos de thread.</li>
                        </ul>
                    </div>

                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-emerald-500 mb-2">Serviços e Systemd</h3>
                        <ul className="text-sm text-text-muted space-y-2">
                            <li>Recuperação de status e logs do <code>systemctl</code> (Nginx, PM2, Docker, PostgreSQL, Redis).</li>
                            <li>Leitura de <code>journalctl</code> com filtros inteligentes de crash/traceback.</li>
                            <li>Execução de scripts de shell e intervenção manual (Reiniciar containers / Daemons).</li>
                        </ul>
                    </div>
                </div>
            </section>
        </div>
    )
}
