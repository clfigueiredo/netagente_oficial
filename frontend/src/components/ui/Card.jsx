import clsx from 'clsx'

export function Card({ children, className, glow }) {
    return (
        <div className={clsx(
            'bg-bg-surface border border-border rounded-xl p-5',
            glow && 'glow-blue',
            className
        )}>
            {children}
        </div>
    )
}

export function CardHeader({ title, subtitle, action }) {
    return (
        <div className="flex items-start justify-between mb-4">
            <div>
                <h3 className="text-sm font-semibold text-text font-mono">{title}</h3>
                {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
            </div>
            {action && <div>{action}</div>}
        </div>
    )
}

export function StatCard({ label, value, icon: Icon, trend, color = 'primary' }) {
    const colors = {
        primary: 'text-primary bg-primary/10 border-primary/20',
        success: 'text-success bg-success/10 border-success/20',
        warning: 'text-warning bg-warning/10 border-warning/20',
        danger: 'text-danger bg-danger/10 border-danger/20',
        accent: 'text-accent bg-accent/10 border-accent/20',
    }
    return (
        <div className="bg-bg-surface border border-border rounded-xl p-5 hover:border-border-subtle transition-colors">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-text-muted">{label}</span>
                {Icon && (
                    <div className={clsx('w-8 h-8 rounded-lg border flex items-center justify-center', colors[color])}>
                        <Icon size={15} />
                    </div>
                )}
            </div>
            <p className="text-2xl font-bold font-mono text-text">{value}</p>
            {trend && <p className="text-xs text-text-muted mt-1">{trend}</p>}
        </div>
    )
}
