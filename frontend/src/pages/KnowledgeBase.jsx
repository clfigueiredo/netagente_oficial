import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    BookOpen, Plus, Search, Trash2, Edit3, Save, X, Star,
    Server, Cpu, Filter, Sparkles, ChevronDown, FileText, Eye
} from 'lucide-react'
import api from '../lib/api'

const CATEGORY_OPTIONS = [
    { value: '', label: 'Todas' },
    { value: 'troubleshooting', label: 'Troubleshooting' },
    { value: 'configuration', label: 'Configuração' },
    { value: 'operations', label: 'Operações' },
    { value: 'security', label: 'Segurança' },
    { value: 'general', label: 'Geral' },
]

const DEVICE_OPTIONS = [
    { value: '', label: 'Todos' },
    { value: 'mikrotik', label: 'MikroTik' },
    { value: 'linux', label: 'Linux' },
]

const SOURCE_OPTIONS = [
    { value: '', label: 'Todas' },
    { value: 'manual', label: 'Manual' },
    { value: 'learned', label: 'Aprendido pelo Agente' },
    { value: 'documentation', label: 'Documentação' },
]

const CATEGORY_COLORS = {
    troubleshooting: { color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
    configuration: { color: '#38bdf8', bg: 'rgba(56,189,248,0.08)' },
    operations: { color: '#34d399', bg: 'rgba(52,211,153,0.08)' },
    security: { color: '#f43f5e', bg: 'rgba(244,63,94,0.08)' },
    general: { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
}

const SOURCE_ICONS = {
    manual: { color: '#38bdf8', label: 'Manual' },
    learned: { color: '#a78bfa', label: 'Agente' },
    documentation: { color: '#34d399', label: 'Docs' },
}

function Badge({ children, color, bg }) {
    return (
        <span style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
            background: bg, color, fontWeight: 600, whiteSpace: 'nowrap',
        }}>{children}</span>
    )
}

function SelectField({ label, value, onChange, options, icon: Icon }) {
    return (
        <div style={{ position: 'relative' }}>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{
                    appearance: 'none', background: '#0f1117', border: '1px solid rgba(100,116,139,0.2)',
                    borderRadius: '8px', padding: '8px 32px 8px 12px', fontSize: '12px', color: '#e2e8f0',
                    cursor: 'pointer', minWidth: '120px',
                }}
            >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={12} style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                color: '#64748b', pointerEvents: 'none',
            }} />
        </div>
    )
}

function KnowledgeModal({ item, onClose, onSave }) {
    const isEdit = !!item?.id
    const [form, setForm] = useState({
        title: item?.title || '',
        content: item?.content || '',
        category: item?.category || 'general',
        device_type: item?.device_type || '',
        source: item?.source || 'manual',
        quality_score: item?.quality_score ?? 0.5,
    })
    const [saving, setSaving] = useState(false)

    const handleSubmit = async () => {
        if (!form.title.trim() || !form.content.trim()) return
        setSaving(true)
        try {
            await onSave(form, item?.id)
            onClose()
        } catch (e) {
            console.error(e)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
        }} onClick={onClose}>
            <div style={{
                background: '#0f1117', border: '1px solid rgba(100,116,139,0.2)',
                borderRadius: '16px', width: '100%', maxWidth: '680px', maxHeight: '90vh',
                overflow: 'auto', padding: '24px',
            }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '36px', height: '36px', borderRadius: '10px',
                            background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            {isEdit ? <Edit3 size={16} color="#38bdf8" /> : <Plus size={16} color="#38bdf8" />}
                        </div>
                        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>
                            {isEdit ? 'Editar Conhecimento' : 'Novo Conhecimento'}
                        </h2>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#64748b',
                        padding: '4px', borderRadius: '6px',
                    }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Title */}
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                            Título *
                        </label>
                        <input
                            value={form.title}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="Ex: MikroTik Alta CPU - Diagnóstico"
                            style={{
                                width: '100%', background: '#080a0f', border: '1px solid rgba(100,116,139,0.2)',
                                borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#e2e8f0',
                                outline: 'none', boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Content */}
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                            Conteúdo *
                        </label>
                        <textarea
                            value={form.content}
                            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                            placeholder="Descreva o conhecimento detalhadamente. O agente usará isso para responder perguntas via busca semântica (RAG)..."
                            rows={8}
                            style={{
                                width: '100%', background: '#080a0f', border: '1px solid rgba(100,116,139,0.2)',
                                borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#e2e8f0',
                                outline: 'none', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Row: Category + Device + Source */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                                Categoria
                            </label>
                            <select
                                value={form.category}
                                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                                style={{
                                    width: '100%', appearance: 'none', background: '#080a0f',
                                    border: '1px solid rgba(100,116,139,0.2)', borderRadius: '8px',
                                    padding: '10px 14px', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer',
                                }}
                            >
                                {CATEGORY_OPTIONS.filter(o => o.value).map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                                Tipo de Dispositivo
                            </label>
                            <select
                                value={form.device_type}
                                onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))}
                                style={{
                                    width: '100%', appearance: 'none', background: '#080a0f',
                                    border: '1px solid rgba(100,116,139,0.2)', borderRadius: '8px',
                                    padding: '10px 14px', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer',
                                }}
                            >
                                <option value="">Ambos</option>
                                <option value="mikrotik">MikroTik</option>
                                <option value="linux">Linux</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                                Fonte
                            </label>
                            <select
                                value={form.source}
                                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                                style={{
                                    width: '100%', appearance: 'none', background: '#080a0f',
                                    border: '1px solid rgba(100,116,139,0.2)', borderRadius: '8px',
                                    padding: '10px 14px', fontSize: '12px', color: '#e2e8f0', cursor: 'pointer',
                                }}
                            >
                                {SOURCE_OPTIONS.filter(o => o.value).map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Quality Score */}
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', display: 'block' }}>
                            Score de Qualidade: {(form.quality_score * 100).toFixed(0)}%
                        </label>
                        <input
                            type="range" min="0" max="1" step="0.05"
                            value={form.quality_score}
                            onChange={e => setForm(f => ({ ...f, quality_score: parseFloat(e.target.value) }))}
                            style={{ width: '100%', accentColor: '#38bdf8' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569' }}>
                            <span>Baixo</span><span>Alto</span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex', justifyContent: 'flex-end', gap: '10px',
                    marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(100,116,139,0.15)',
                }}>
                    <button onClick={onClose} style={{
                        padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                        background: 'transparent', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8',
                        cursor: 'pointer',
                    }}>Cancelar</button>
                    <button onClick={handleSubmit} disabled={saving || !form.title.trim() || !form.content.trim()} style={{
                        padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                        background: '#38bdf8', border: 'none', color: '#0f172a', cursor: 'pointer',
                        opacity: (saving || !form.title.trim() || !form.content.trim()) ? 0.5 : 1,
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        <Save size={14} />
                        {saving ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar'}
                    </button>
                </div>
            </div>
        </div>
    )
}

function KnowledgeCard({ item, onEdit, onDelete }) {
    const [expanded, setExpanded] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.general
    const srcInfo = SOURCE_ICONS[item.source] || SOURCE_ICONS.manual

    const handleDelete = async () => {
        if (!confirm('Excluir este conhecimento? Essa ação não pode ser desfeita.')) return
        setDeleting(true)
        await onDelete(item.id)
    }

    return (
        <div style={{
            background: 'var(--bg-surface, #0f1117)',
            border: `1px solid ${catColor.color}20`,
            borderRadius: '12px', overflow: 'hidden',
            transition: 'border-color 0.2s',
        }}>
            <div style={{ height: '3px', background: catColor.color }} />
            <div style={{ padding: '16px' }}>
                {/* Top Row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '8px',
                        background: catColor.bg, border: `1px solid ${catColor.color}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <FileText size={16} color={catColor.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: '14px', color: '#e2e8f0' }}>
                                {item.title}
                            </span>
                            <Badge color={catColor.color} bg={catColor.bg}>
                                {CATEGORY_OPTIONS.find(c => c.value === item.category)?.label || item.category}
                            </Badge>
                            {item.device_type && (
                                <Badge color="#94a3b8" bg="rgba(148,163,184,0.08)">
                                    {item.device_type === 'mikrotik' ? '🔴 MikroTik' : '🐧 Linux'}
                                </Badge>
                            )}
                            <Badge color={srcInfo.color} bg={`${srcInfo.color}15`}>
                                {srcInfo.label}
                            </Badge>
                        </div>

                        {/* Preview */}
                        <p style={{
                            fontSize: '12px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: expanded ? 999 : 2, WebkitBoxOrient: 'vertical',
                        }}>
                            {item.content}
                        </p>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                        <button onClick={() => setExpanded(e => !e)} title="Ver conteúdo" style={{
                            background: 'none', border: '1px solid rgba(100,116,139,0.15)', borderRadius: '6px',
                            padding: '6px', cursor: 'pointer', color: '#64748b',
                        }}>
                            <Eye size={14} />
                        </button>
                        <button onClick={() => onEdit(item)} title="Editar" style={{
                            background: 'none', border: '1px solid rgba(100,116,139,0.15)', borderRadius: '6px',
                            padding: '6px', cursor: 'pointer', color: '#64748b',
                        }}>
                            <Edit3 size={14} />
                        </button>
                        <button onClick={handleDelete} disabled={deleting} title="Excluir" style={{
                            background: 'none', border: '1px solid rgba(244,63,94,0.15)', borderRadius: '6px',
                            padding: '6px', cursor: deleting ? 'not-allowed' : 'pointer', color: '#f43f5e',
                            opacity: deleting ? 0.5 : 1,
                        }}>
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>

                {/* Footer stats */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '16px', marginTop: '10px',
                    paddingTop: '10px', borderTop: '1px solid rgba(100,116,139,0.08)',
                }}>
                    <span style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Star size={10} />
                        Qualidade: {(item.quality_score * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: '11px', color: '#475569' }}>
                        Usos: {item.use_count}
                    </span>
                    <span style={{
                        fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px',
                        color: item.has_embedding ? '#34d399' : '#f97316',
                    }}>
                        <Sparkles size={10} />
                        {item.has_embedding ? 'Embedding ✓' : 'Sem embedding'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#475569', marginLeft: 'auto' }}>
                        {new Date(item.created_at).toLocaleDateString('pt-BR')}
                    </span>
                </div>
            </div>
        </div>
    )
}

export default function KnowledgeBase() {
    const queryClient = useQueryClient()
    const [modal, setModal] = useState(null) // null | {} (new) | item (edit)
    const [search, setSearch] = useState('')
    const [catFilter, setCatFilter] = useState('')
    const [deviceFilter, setDeviceFilter] = useState('')
    const [sourceFilter, setSourceFilter] = useState('')

    const { data, isLoading } = useQuery({
        queryKey: ['knowledge', catFilter, deviceFilter, sourceFilter, search],
        queryFn: () => {
            const params = new URLSearchParams()
            if (catFilter) params.set('category', catFilter)
            if (deviceFilter) params.set('device_type', deviceFilter)
            if (sourceFilter) params.set('source', sourceFilter)
            if (search) params.set('search', search)
            return api.get(`/admin/knowledge?${params}`).then(r => r.data)
        },
    })

    const items = data?.items || []
    const total = data?.total || 0

    const saveMutation = useMutation({
        mutationFn: async ({ form, id }) => {
            if (id) {
                return api.put(`/admin/knowledge/${id}`, form).then(r => r.data)
            }
            return api.post('/admin/knowledge', form).then(r => r.data)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/admin/knowledge/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
    })

    const embeddingMutation = useMutation({
        mutationFn: () => api.post('/admin/knowledge/generate-embeddings'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
    })

    const withoutEmbedding = items.filter(i => !i.has_embedding).length

    // Stats
    const stats = useMemo(() => {
        const cats = {}
        items.forEach(i => {
            const c = i.category || 'general'
            cats[c] = (cats[c] || 0) + 1
        })
        return cats
    }, [items])

    return (
        <div style={{ padding: '28px', maxWidth: '960px', margin: '0 auto' }}>
            {/* Page Header */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <BookOpen size={22} color="#38bdf8" />
                    <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Base de Conhecimento</h1>
                    <span style={{
                        fontSize: '12px', padding: '3px 10px', borderRadius: '999px',
                        background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontWeight: 600,
                    }}>
                        {total} artigos
                    </span>
                </div>
                <p style={{ fontSize: '13px', color: '#64748b' }}>
                    Base RAG do agente. O conteúdo aqui é pesquisado semanticamente pelo agente para enriquecer respostas.
                    Artigos com embedding ativo são encontrados via busca vetorial (pgvector).
                </p>
            </div>

            {/* Actions bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap',
            }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={14} style={{
                        position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                        color: '#64748b',
                    }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por título ou conteúdo..."
                        style={{
                            width: '100%', background: '#0f1117', border: '1px solid rgba(100,116,139,0.2)',
                            borderRadius: '8px', padding: '8px 14px 8px 34px', fontSize: '12px', color: '#e2e8f0',
                            outline: 'none', boxSizing: 'border-box',
                        }}
                    />
                </div>

                <SelectField value={catFilter} onChange={setCatFilter} options={CATEGORY_OPTIONS} />
                <SelectField value={deviceFilter} onChange={setDeviceFilter} options={DEVICE_OPTIONS} />
                <SelectField value={sourceFilter} onChange={setSourceFilter} options={SOURCE_OPTIONS} />

                {withoutEmbedding > 0 && (
                    <button onClick={() => embeddingMutation.mutate()} disabled={embeddingMutation.isPending}
                        style={{
                            padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                            background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)',
                            color: '#a78bfa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                            opacity: embeddingMutation.isPending ? 0.5 : 1,
                        }}>
                        <Sparkles size={13} />
                        {embeddingMutation.isPending ? 'Gerando...' : `Gerar Embeddings (${withoutEmbedding})`}
                    </button>
                )}

                <button onClick={() => setModal({})} style={{
                    padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                    background: '#38bdf8', border: 'none', color: '#0f172a', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                    <Plus size={14} />
                    Novo Artigo
                </button>
            </div>

            {/* Stats row */}
            {Object.keys(stats).length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    {Object.entries(stats).map(([cat, count]) => {
                        const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS.general
                        return (
                            <button key={cat} onClick={() => setCatFilter(catFilter === cat ? '' : cat)} style={{
                                padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                                background: catFilter === cat ? cc.color : cc.bg,
                                color: catFilter === cat ? '#0f172a' : cc.color,
                                border: `1px solid ${cc.color}30`, cursor: 'pointer',
                                transition: 'all 0.15s',
                            }}>
                                {CATEGORY_OPTIONS.find(c => c.value === cat)?.label || cat} ({count})
                            </button>
                        )
                    })}
                </div>
            )}

            {/* Content */}
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Carregando...</div>
            ) : items.length === 0 ? (
                <div style={{
                    border: '1px dashed rgba(100,116,139,0.3)', borderRadius: '12px',
                    padding: '60px', textAlign: 'center',
                }}>
                    <BookOpen size={32} color="#475569" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#64748b', fontSize: '14px' }}>Nenhum artigo encontrado.</p>
                    <p style={{ color: '#475569', fontSize: '12px', marginTop: '4px' }}>
                        Clique em "Novo Artigo" para adicionar conhecimento à base RAG do agente.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {items.map(item => (
                        <KnowledgeCard
                            key={item.id}
                            item={item}
                            onEdit={(item) => setModal(item)}
                            onDelete={(id) => deleteMutation.mutateAsync(id)}
                        />
                    ))}
                </div>
            )}

            {/* Modal */}
            {modal !== null && (
                <KnowledgeModal
                    item={modal.id ? modal : null}
                    onClose={() => setModal(null)}
                    onSave={(form, id) => saveMutation.mutateAsync({ form, id })}
                />
            )}
        </div>
    )
}
