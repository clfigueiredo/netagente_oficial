import { Bell, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../store/authStore'

export default function Topbar() {
    const client = useQueryClient()
    const { tenantSlug } = useAuthStore()

    return (
        <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-bg-surface flex-shrink-0">
            <div>
                <p className="text-xs text-text-muted font-mono">
                    tenant: <span className="text-primary">{tenantSlug ?? 'platform'}</span>
                </p>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => client.invalidateQueries()}
                    title="Atualizar dados"
                    className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-bg-elevated transition-all cursor-pointer"
                >
                    <RefreshCw size={15} />
                </button>
                <button
                    title="Notificações"
                    className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-bg-elevated transition-all cursor-pointer relative"
                >
                    <Bell size={15} />
                </button>
            </div>
        </header>
    )
}
