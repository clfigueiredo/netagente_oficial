import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { History, MessageSquare, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { SkeletonRow } from '../components/ui/Skeleton'
import { Badge } from '../components/ui/Badge'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default function Conversations() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const { data, isLoading } = useQuery({
        queryKey: ['conversations'],
        queryFn: () => api.get('/conversations?limit=50').then(r => r.data),
        staleTime: 0,
        refetchOnMount: 'always',
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/conversations/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['conversations'] })
        }
    })

    const conversations = Array.isArray(data) ? data : (data?.conversations ?? [])

    const handleDelete = (e, id) => {
        e.stopPropagation()
        if (confirm('Tem certeza que deseja excluir esta conversa?')) {
            deleteMutation.mutate(id)
        }
    }

    return (
        <div className="space-y-5 animate-fade-in relative">
            <div>
                <h1 className="text-xl font-bold text-text font-mono">Histórico</h1>
                <p className="text-sm text-text-muted mt-0.5">{conversations.length} conversas</p>
            </div>

            <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
                {isLoading ? (
                    <div className="p-4 space-y-2">{Array(6).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                ) : conversations.length === 0 ? (
                    <div className="py-16 flex flex-col items-center gap-3">
                        <History size={32} className="text-border" />
                        <p className="text-sm text-text-muted">Nenhuma conversa ainda.</p>
                    </div>
                ) : conversations.map(c => (
                    <div key={c.id} onClick={() => navigate('/chat', { state: { conversationId: c.id, channel: c.channel } })}
                        className="group flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4 border-b border-border last:border-0 hover:bg-bg-elevated/50 transition-colors cursor-pointer">

                        <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-text-muted flex-shrink-0">
                                <MessageSquare size={15} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-text truncate">{c.title ?? 'Conversa'}</p>
                                    <span className="text-xs text-text-muted hidden sm:inline-block">
                                        • {c.started_at ? format(new Date(c.started_at), "d 'de' MMM, HH:mm", { locale: ptBR }) : '—'}
                                    </span>
                                </div>
                                {c.preview && (
                                    <p className="text-sm text-text-muted line-clamp-1 mt-0.5" title={c.preview}>
                                        {c.preview}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 pl-13 sm:pl-0">
                            <div className="text-xs text-text-muted sm:hidden">
                                {c.started_at ? format(new Date(c.started_at), "d 'de' MMM, HH:mm", { locale: ptBR }) : '—'}
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant={c.channel === 'whatsapp' ? 'success' : 'primary'} className="capitalize">{c.channel}</Badge>
                                <button
                                    onClick={(e) => handleDelete(e, c.id)}
                                    className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
                                    title="Excluir conversa"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
