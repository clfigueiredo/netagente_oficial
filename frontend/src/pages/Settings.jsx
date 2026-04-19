import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2, Users, Phone, Settings2, Bot, Save, Key, Wifi, WifiOff } from 'lucide-react'
import api from '../lib/api'
import { SkeletonRow } from '../components/ui/Skeleton'
import { Badge } from '../components/ui/Badge'

const TABS = [
    { id: 'ai', label: 'IA', icon: Bot },
    { id: 'whatsapp', label: 'WhatsApp', icon: Phone },
    { id: 'users', label: 'Usuários', icon: Users },
    { id: 'settings', label: 'Configurações', icon: Settings2 },
]

const AGENT_MODES = [
    { value: 'restricted', label: '🔒 Restrito', desc: 'Somente leitura. Toda ação exige aprovação.' },
    { value: 'standard', label: '⚡ Standard', desc: 'Leitura livre. Instalações e reinícios exigem aprovação.' },
    { value: 'root', label: '🔓 Root', desc: 'Confiança total. Executa tudo diretamente via SSH.' },
]

const LLM_PROVIDERS = [
    { value: '', label: 'OpenAI (padrão do sistema)' },
    { value: 'openai', label: 'OpenAI (chave própria)' },
    { value: 'gemini', label: 'Google Gemini' },
]

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']

// ── AI Tab ────────────────────────────────────────────────────────────────────

function AITab() {
    const qc = useQueryClient()
    const { data, isLoading } = useQuery({ queryKey: ['kv-settings'], queryFn: () => api.get('/settings').then(r => r.data) })
    const [apiKey, setApiKey] = useState('')
    const [keySaved, setKeySaved] = useState(false)

    const { mutate: patch, isPending: saving } = useMutation({
        mutationFn: (body) => api.patch('/settings', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['kv-settings'] })
    })

    const { mutate: saveKey, isPending: savingKey } = useMutation({
        mutationFn: () => api.post('/settings/llm-key', { apiKey }),
        onSuccess: () => { setApiKey(''); setKeySaved(true); setTimeout(() => setKeySaved(false), 3000) }
    })

    const { mutate: removeKey } = useMutation({
        mutationFn: () => api.delete('/settings/llm-key'),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['kv-settings'] })
    })

    if (isLoading) return <div className="p-4">{Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>

    const s = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {}
    const provider = s.llm_provider || ''
    const model = s.llm_model || ''
    const mode = s.agent_mode || 'restricted'
    const models = provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS

    return (
        <div className="space-y-6">
            {/* Agent Mode */}
            <div>
                <p className="text-sm font-semibold text-text mb-3">Modo do Agente</p>
                <div className="grid gap-2">
                    {AGENT_MODES.map(m => (
                        <label key={m.value}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === m.value ? 'border-primary bg-primary/5' : 'border-border bg-bg-base hover:border-border-hover'}`}>
                            <input type="radio" name="agent_mode" value={m.value} checked={mode === m.value}
                                onChange={() => patch({ agent_mode: m.value })}
                                className="mt-0.5 accent-primary" />
                            <div>
                                <p className="text-sm font-medium text-text">{m.label}</p>
                                <p className="text-xs text-text-muted">{m.desc}</p>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            <hr className="border-border" />

            {/* LLM Provider */}
            <div>
                <p className="text-sm font-semibold text-text mb-3">Modelo de IA</p>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-text-muted mb-1 block">Provider</label>
                        <select value={provider} onChange={e => patch({ llm_provider: e.target.value })}
                            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary cursor-pointer">
                            {LLM_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-text-muted mb-1 block">Modelo</label>
                        <select value={model} onChange={e => patch({ llm_model: e.target.value })}
                            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary cursor-pointer">
                            <option value="">automático</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                </div>

                {provider !== '' && (
                    <div className="mt-3">
                        <label className="text-xs text-text-muted mb-1 block">
                            <Key size={11} className="inline mr-1" />
                            Chave de API {provider === 'gemini' ? '(Google AI Studio)' : '(OpenAI)'}
                            <span className="ml-2 text-text-dim">— armazenada criptografada</span>
                        </label>
                        <div className="flex gap-2">
                            <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                                type="password" placeholder={`${provider === 'gemini' ? 'AIza...' : 'sk-...'}`}
                                className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-primary" />
                            <button onClick={() => saveKey()} disabled={savingKey || apiKey.length < 8}
                                className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
                                {savingKey ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                {keySaved ? 'Salvo!' : 'Salvar'}
                            </button>
                            <button onClick={() => removeKey()}
                                className="text-text-muted hover:text-danger border border-border px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors" title="Remover chave (volta ao padrão do sistema)">
                                Remover
                            </button>
                        </div>
                        <p className="text-xs text-text-muted mt-1">
                            {s.llm_api_key ? '✅ Chave configurada' : '⚠️ Sem chave — usando padrão do sistema'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── WhatsApp Tab ──────────────────────────────────────────────────────────────

function WhatsappTab() {
    const qc = useQueryClient()
    const [phone, setPhone] = useState('')
    const [name, setName] = useState('')
    const [wa, setWa] = useState({ instance: '', apiKey: '' })
    const [waSaved, setWaSaved] = useState(false)

    const { data, isLoading } = useQuery({ queryKey: ['wa-users'], queryFn: () => api.get('/settings/whatsapp-users').then(r => r.data) })
    const { data: waStatus, refetch: refetchStatus } = useQuery({
        queryKey: ['wa-status'],
        queryFn: () => api.get('/settings/whatsapp-status').then(r => r.data),
        refetchInterval: 30000,
    })

    const { mutate: add, isPending } = useMutation({
        mutationFn: () => api.post('/settings/whatsapp-users', { number: phone, name: name || undefined }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['wa-users'] }); setPhone(''); setName('') }
    })
    const { mutate: remove } = useMutation({
        mutationFn: (id) => api.delete(`/settings/whatsapp-users/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-users'] })
    })
    const { mutate: saveConfig, isPending: savingConfig } = useMutation({
        mutationFn: () => api.post('/settings/whatsapp-config', wa),
        onSuccess: () => { setWaSaved(true); setTimeout(() => setWaSaved(false), 3000); refetchStatus() }
    })

    const users = Array.isArray(data) ? data : (data?.users ?? [])
    const state = waStatus?.state
    const isConnected = state === 'open'
    const isNotConfigured = state === 'not_configured'

    return (
        <div className="space-y-5">
            {/* Evolution API Config */}
            <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text">Configuração Evolution API</p>
                    {state && (
                        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${isConnected ? 'bg-success/10 text-success' : isNotConfigured ? 'bg-muted/10 text-text-muted' : 'bg-danger/10 text-danger'}`}>
                            {isConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {isConnected ? 'Conectado' : isNotConfigured ? 'Não configurado' : state}
                            {waStatus?.instance && <span className="font-mono ml-1">{waStatus.instance}</span>}
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-text-muted mb-1 block">Instance Name</label>
                        <input value={wa.instance} onChange={e => setWa(w => ({ ...w, instance: e.target.value }))}
                            placeholder="minha-instancia"
                            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-primary" />
                    </div>
                    <div>
                        <label className="text-xs text-text-muted mb-1 block">API Key <span className="text-text-dim">(criptografada)</span></label>
                        <input value={wa.apiKey} onChange={e => setWa(w => ({ ...w, apiKey: e.target.value }))}
                            type="password" placeholder="••••••••"
                            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-primary" />
                    </div>
                </div>
                <button onClick={() => saveConfig()} disabled={savingConfig || !wa.instance || !wa.apiKey}
                    className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
                    {savingConfig ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {waSaved ? 'Salvo!' : 'Salvar configuração'}
                </button>
            </div>

            {/* Authorized Numbers */}
            <div>
                <p className="text-sm font-semibold text-text mb-3">Números Autorizados</p>
                <div className="flex gap-2">
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="5511999..." className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors flex-1 font-mono" />
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome" className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors w-36" />
                    <button onClick={() => add()} disabled={isPending || !phone} className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
                        {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar
                    </button>
                </div>
                <div className="mt-3 bg-bg-base border border-border rounded-xl overflow-hidden">
                    {isLoading ? <div className="p-4">{Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                        : users.length === 0
                            ? <p className="text-xs text-text-muted p-6 text-center">Nenhum número autorizado. Números não cadastrados recebem mensagem de acesso negado.</p>
                            : users.map(u => (
                                <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                                    <div className="flex-1">
                                        <p className="text-sm font-mono text-text">{u.number}</p>
                                        {u.name && <p className="text-xs text-text-muted">{u.name}</p>}
                                    </div>
                                    {u.role && <Badge variant="muted" className="text-xs">{u.role}</Badge>}
                                    <button onClick={() => remove(u.id)} className="text-text-muted hover:text-danger transition-colors cursor-pointer p-1.5 rounded hover:bg-danger/10"><Trash2 size={13} /></button>
                                </div>
                            ))}
                </div>
            </div>
        </div>
    )
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
    const qc = useQueryClient()
    const [form, setForm] = useState({ email: '', password: '', role: 'operator' })
    const { data, isLoading } = useQuery({ queryKey: ['tenant-users'], queryFn: () => api.get('/settings/users').then(r => r.data) })
    const { mutate: add, isPending } = useMutation({
        mutationFn: () => api.post('/settings/users', form),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenant-users'] }); setForm({ email: '', password: '', role: 'operator' }) }
    })
    const { mutate: remove } = useMutation({ mutationFn: (id) => api.delete(`/settings/users/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-users'] }) })
    const users = Array.isArray(data) ? data : (data?.users ?? [])
    const ROLES = ['admin', 'operator', 'readonly']
    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@..." type="email" className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors" />
                <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Senha" type="password" className="w-32 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors" />
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors cursor-pointer">
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => add()} disabled={isPending || !form.email} className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
                    {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar
                </button>
            </div>
            <div className="bg-bg-base border border-border rounded-xl overflow-hidden">
                {isLoading ? <div className="p-4">{Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                    : users.map(u => (
                        <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                            <div className="flex-1"><p className="text-sm text-text">{u.email}</p></div>
                            <span className="text-xs bg-bg-elevated border border-border rounded px-2 py-0.5 text-text-dim font-mono">{u.role}</span>
                            <button onClick={() => remove(u.id)} className="text-text-muted hover:text-danger transition-colors cursor-pointer p-1.5 rounded hover:bg-danger/10"><Trash2 size={13} /></button>
                        </div>
                    ))}
            </div>
        </div>
    )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab() {
    const { data, isLoading } = useQuery({ queryKey: ['kv-settings'], queryFn: () => api.get('/settings').then(r => r.data) })
    if (isLoading) return <div className="p-4">{Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
    const settings = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {}
    const hidden = ['llm_api_key', 'evolution_key', 'llm_provider', 'llm_model', 'agent_mode']
    const visible = Object.entries(settings).filter(([k]) => !hidden.includes(k))
    return (
        <div className="space-y-3">
            {visible.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 bg-bg-base border border-border rounded-lg px-4 py-3">
                    <p className="flex-1 text-sm font-mono text-text-muted">{k}</p>
                    <p className="text-sm text-text font-mono">{String(v)}</p>
                </div>
            ))}
            {visible.length === 0 && <p className="text-xs text-text-muted text-center py-8">Nenhuma configuração encontrada.</p>}
        </div>
    )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Settings() {
    const [tab, setTab] = useState('ai')
    return (
        <div className="space-y-5 animate-fade-in">
            <div>
                <h1 className="text-xl font-bold text-text font-mono">Configurações</h1>
                <p className="text-sm text-text-muted mt-0.5">Modo do agente, IA, WhatsApp e usuários</p>
            </div>
            <div className="flex gap-1 bg-bg-surface border border-border rounded-xl p-1 w-fit flex-wrap">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${tab === id ? 'bg-primary text-white' : 'text-text-muted hover:text-text'}`}>
                        <Icon size={13} /> {label}
                    </button>
                ))}
            </div>
            <div className="bg-bg-surface border border-border rounded-xl p-5">
                {tab === 'ai' && <AITab />}
                {tab === 'whatsapp' && <WhatsappTab />}
                {tab === 'users' && <UsersTab />}
                {tab === 'settings' && <SettingsTab />}
            </div>
        </div>
    )
}
