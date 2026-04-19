import clsx from 'clsx'

const variants = {
    default: 'bg-bg-elevated text-text-dim border-border',
    primary: 'bg-primary/10 text-primary border-primary/30',
    success: 'bg-success/10 text-success border-success/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
    accent: 'bg-accent/10 text-accent border-accent/30',
    muted: 'bg-bg-overlay text-text-muted border-border',
}

export function Badge({ children, variant = 'default', className }) {
    return (
        <span className={clsx(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
            variants[variant], className
        )}>
            {children}
        </span>
    )
}

export function StatusBadge({ online }) {
    if (online === true) return <Badge variant="success"><span className="dot-online animate-pulse-slow" />Online</Badge>
    if (online === false) return <Badge variant="danger"><span className="dot-offline" />Offline</Badge>
    return <Badge variant="muted"><span className="dot-unknown" />Desconhecido</Badge>
}
