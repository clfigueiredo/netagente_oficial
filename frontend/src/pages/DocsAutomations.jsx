import { BookOpen, Zap } from 'lucide-react'

export default function DocsAutomations() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <BookOpen className="text-primary" size={40} />
                    Documentação — Automações e Agendamentos
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    Aprenda a criar rotinas crons ativas que disparam <strong>Skills Inteligentes</strong> de forma recorrente sem depender de ações manuais.
                </p>

                <div className="mt-8 bg-gradient-to-r from-primary/10 to-accent/5 p-6 rounded-xl border border-primary/20">
                    <h3 className="text-xl font-bold text-primary mb-3 flex items-center gap-2">
                        <Zap size={22} className="text-accent" /> O Padrão Cron
                    </h3>
                    <p className="text-text-muted text-sm mb-4">
                        O painel de Automações usa a sintaxe universal de Crontab <code>* * * * *</code> (Minuto Hora Dia Mês DiaDaSemana).
                    </p>
                    <div className="bg-bg-elevated p-4 rounded-lg border border-border">
                        <ul className="text-sm font-mono text-text space-y-1">
                            <li><span className="text-accent">0 2 * * *</span> : Todo dia às 02:00 da manhã.</li>
                            <li><span className="text-accent">*/15 * * * *</span> : A cada 15 minutos.</li>
                            <li><span className="text-accent">0 18 * * 5</span> : Toda sexta-feira às 18:00.</li>
                        </ul>
                    </div>
                </div>
            </header>

            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Zap className="text-yellow-500" size={32} />
                    Casos de Uso Comuns
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-yellow-500 mb-3">Backup Diário e Semanal</h3>
                        <p className="text-sm text-text-muted mb-4">Conecte uma Skill de <code>Backup</code> a uma Automação. Selecione seus dispositivos core e marque-os para rodar às <code>0 3 * * *</code>. O arquivo será salvo, e o Agente fará uma cópia de segurança notificando você se houver alguma falha no SSH.</p>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-yellow-500 mb-3">Aviso de Limpeza e Fechamento</h3>
                        <p className="text-sm text-text-muted mb-4">Rotinas de limpeza de log, expurgo de leases temporários inativos, ou reinício de processos críticos de Linux programados de madrugada.</p>
                    </div>
                </div>
            </section>
        </div>
    )
}
