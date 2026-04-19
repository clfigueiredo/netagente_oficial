import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react'
import api from '../lib/api'
import { Badge } from '../components/ui/Badge'
import { SkeletonRow } from '../components/ui/Skeleton'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const STATUS_TABS = [
    { value: 'pending', label: 'Pendentes' },
    { value: 'approved', label: 'Aprovadas' },
    { value: 'rejected', label: 'Rejeitadas' },
]

export default function PendingActions() {
    const qc = useQueryClient()
    const [tab, setTab] = useState('pending')

    const { data, isLoading } = useQuery({
        queryKey: ['pending', tab],
        queryFn: () => api.get(`/pending-actions?status=${tab}`).then(r => r.data),
        refetchInterval: tab === 'pending' ? 10_000 : false,
    })

    const { mutate: decide, isPending } = useMutation({
        mutationFn: ({ id, action }) => api.post(`/pending-actions/${id}/${action}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['pending'] }),
    })

    const actions = Array.isArray(data) ? data : (data?.actions ?? [])

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-text font-mono">Aprovações</h1>
                    <p className="text-sm text-text-muted mt-0.5">Ações do agente que requerem aprovação</p>
                </div>
                <button onClick={() => qc.invalidateQueries({ queryKey: ['pending'] })} className="p-2 border border-border rounded-lg text-text-muted hover:text-text hover:bg-bg-elevated transition-all cursor-pointer">
                    <RefreshCw size={15} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-bg-surface border border-border rounded-xl p-1 w-fit">
                {STATUS_TABS.map(t => (
                    <button key={t.value} onClick={() => setTab(t.value)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${tab === t.value ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
                {isLoading ? (
                    <div className="p-4 space-y-3">{Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                ) : actions.length === 0 ? (
                    <div className="py-16 flex flex-col items-center gap-3">
                        <Clock size={32} className="text-border" />
                        <p className="text-sm text-text-muted">Nenhuma ação {tab === 'pending' ? 'pendente' : tab}.</p>
                    </div>
                ) : actions.map(a => (
                    <div key={a.id} className="px-5 py-4 border-b border-border last:border-0">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <p className="text-sm font-medium text-text font-mono truncate">{a.description}</p>
                                    <Badge variant={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'danger'} className="capitalize flex-shrink-0">
                                        {a.status}
                                    </Badge>
                                </div>
                                {a.toolName && <p className="text-xs text-text-muted">Ferramenta: <span className="font-mono text-primary">{a.toolName}</span></p>}
                                <p className="text-xs text-text-muted mt-1">
                                    {a.requested_at ? format(new Date(a.requested_at), "d 'de' MMM, HH:mm", { locale: ptBR }) : '—'}
                                </p>
                                {a.toolInput && (
                                    <pre className="mt-2 text-xs bg-bg-elevated border border-border rounded-lg p-3 text-text-dim overflow-x-auto max-h-24">
                                        {JSON.stringify(JSON.parse(a.toolInput || '{}'), null, 2)}
                                    </pre>
                                )}
                            </div>
                            {tab === 'pending' && (
                                <div className="flex gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => decide({ id: a.id, action: 'reject' })}
                                        disabled={isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
                                    >
                                        <XCircle size={13} /> Rejeitar
                                    </button>
                                    <button
                                        onClick={() => decide({ id: a.id, action: 'approve' })}
                                        disabled={isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30 text-success hover:bg-success/20 text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
                                    >
                                        {isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />} Aprovar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
