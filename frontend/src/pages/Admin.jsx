import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Plus, ShieldCheck, Brain, BookOpen, Trash2, Loader2,
    ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Pencil, X, Check, Terminal
} from 'lucide-react'
import api from '../lib/api'
import { Badge } from '../components/ui/Badge'
import { SkeletonRow } from '../components/ui/Skeleton'

const TABS = [
    { id: 'tenants', label: 'Tenants', icon: ShieldCheck },
    { id: 'skills', label: 'Skills', icon: Brain },
    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
]

const CATEGORIES = ['monitoring', 'installation', 'networking', 'security', 'backup', 'automation', 'other']
const DEVICE_TYPES = ['', 'linux', 'mikrotik', 'windows', 'cisco']
const RISK_LEVELS = ['low', 'medium', 'high']

// ── Tenants Tab ───────────────────────────────────────────────────────────────

function TenantsTab() {
    const qc = useQueryClient()
    const [form, setForm] = useState({ name: '', slug: '', adminEmail: '', adminPassword: '' })
    const [open, setOpen] = useState(false)
    const { data, isLoading } = useQuery({ queryKey: ['admin-tenants'], queryFn: () => api.get('/admin/tenants').then(r => r.data) })
    const { mutate: create, isPending } = useMutation({
        mutationFn: () => api.post('/admin/tenants', form),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-tenants'] }); setOpen(false); setForm({ name: '', slug: '', adminEmail: '', adminPassword: '' }) }
    })
    const tenants = Array.isArray(data) ? data : (data?.tenants ?? [])
    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                    <Plus size={14} /> Novo Tenant
                </button>
            </div>
            {open && (
                <div className="bg-bg-base border border-border rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        {[['name', 'Nome'], ['slug', 'Slug'], ['adminEmail', 'Email Admin'], ['adminPassword', 'Senha Admin']].map(([k, label]) => (
                            <div key={k}>
                                <label className="text-xs text-text-muted mb-1 block">{label}</label>
                                <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                                    type={k.includes('Password') ? 'password' : 'text'}
                                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors" />
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setOpen(false)} className="flex-1 border border-border text-text-muted py-1.5 rounded-lg text-sm cursor-pointer">Cancelar</button>
                        <button onClick={() => create()} disabled={isPending} className="flex-1 bg-accent hover:bg-accent-hover text-white py-1.5 rounded-lg text-sm font-medium cursor-pointer flex items-center justify-center gap-2">
                            {isPending && <Loader2 size={13} className="animate-spin" />} Criar
                        </button>
                    </div>
                </div>
            )}
            <div className="bg-bg-base border border-border rounded-xl overflow-hidden">
                {isLoading ? <div className="p-4">{Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                    : tenants.map(t => (
                        <div key={t.id} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-text">{t.name}</p>
                                <p className="text-xs text-text-muted font-mono">{t.slug}</p>
                            </div>
                            <Badge variant={t.active ? 'success' : 'muted'}>{t.active ? 'Ativo' : 'Inativo'}</Badge>
                            <Badge variant="primary" className="capitalize font-mono">{t.planId ? 'premium' : 'free'}</Badge>
                        </div>
                    ))}
            </div>
        </div>
    )
}

// ── Skills Tab ────────────────────────────────────────────────────────────────

const EMPTY_SKILL = {
    name: '', display_name: '', description: '', category: 'installation',
    device_type: '', prompt_template: '', steps: [], examples: [], active: true
}

const EMPTY_STEP = { label: '', commands: [''] }

function StepEditor({ steps, onChange }) {
    const addStep = () => onChange([...steps, { ...EMPTY_STEP }])
    const removeStep = (i) => onChange(steps.filter((_, idx) => idx !== i))
    const updateStep = (i, field, val) => {
        const updated = steps.map((s, idx) => idx === i ? { ...s, [field]: val } : s)
        onChange(updated)
    }
    const addCmd = (i) => {
        const updated = steps.map((s, idx) => idx === i ? { ...s, commands: [...s.commands, ''] } : s)
        onChange(updated)
    }
    const updateCmd = (stepIdx, cmdIdx, val) => {
        const updated = steps.map((s, i) => i === stepIdx
            ? { ...s, commands: s.commands.map((c, j) => j === cmdIdx ? val : c) }
            : s
        )
        onChange(updated)
    }
    const removeCmd = (stepIdx, cmdIdx) => {
        const updated = steps.map((s, i) => i === stepIdx
            ? { ...s, commands: s.commands.filter((_, j) => j !== cmdIdx) }
            : s
        )
        onChange(updated)
    }

    return (
        <div className="space-y-3">
            {steps.map((step, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-bg-base">
                    <div className="flex items-center gap-2">
                        <input value={step.label} onChange={e => updateStep(i, 'label', e.target.value)}
                            placeholder={`Fase ${i + 1}: ex. Instalar pacotes`}
                            className="flex-1 bg-bg-elevated border border-border rounded-md px-2 py-1 text-xs text-text outline-none focus:border-primary" />
                        <button onClick={() => removeStep(i)} className="text-text-muted hover:text-danger cursor-pointer p-1"><X size={12} /></button>
                    </div>
                    {step.commands.map((cmd, j) => (
                        <div key={j} className="flex items-center gap-1 pl-3">
                            <span className="text-text-muted text-xs font-mono mr-1">$</span>
                            <input value={cmd} onChange={e => updateCmd(i, j, e.target.value)}
                                placeholder="comando..."
                                className="flex-1 bg-bg-elevated border border-border rounded-md px-2 py-1 text-xs font-mono text-text outline-none focus:border-primary" />
                            {step.commands.length > 1 && (
                                <button onClick={() => removeCmd(i, j)} className="text-text-muted hover:text-danger cursor-pointer p-1"><X size={10} /></button>
                            )}
                        </div>
                    ))}
                    <button onClick={() => addCmd(i)} className="text-xs text-primary hover:text-primary/80 cursor-pointer pl-3">+ comando</button>
                </div>
            ))}
            <button onClick={addStep} className="text-xs text-primary hover:text-primary/80 cursor-pointer flex items-center gap-1">
                <Plus size={11} /> Adicionar fase
            </button>
        </div>
    )
}

function SkillForm({ initial, onSave, onCancel, isPending }) {
    const [form, setForm] = useState(initial || EMPTY_SKILL)
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

    return (
        <div className="bg-bg-base border border-border rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-text-muted mb-1 block">Nome interno <span className="text-danger">*</span></label>
                    <input value={form.name} onChange={e => set('name', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                        placeholder="ex: instalar_zabbix"
                        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-primary" />
                </div>
                <div>
                    <label className="text-xs text-text-muted mb-1 block">Nome exibição <span className="text-danger">*</span></label>
                    <input value={form.display_name} onChange={e => set('display_name', e.target.value)}
                        placeholder="ex: Instalar Zabbix"
                        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary" />
                </div>
                <div>
                    <label className="text-xs text-text-muted mb-1 block">Categoria</label>
                    <select value={form.category} onChange={e => set('category', e.target.value)}
                        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary cursor-pointer">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs text-text-muted mb-1 block">Tipo de dispositivo</label>
                    <select value={form.device_type} onChange={e => set('device_type', e.target.value)}
                        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary cursor-pointer">
                        {DEVICE_TYPES.map(d => <option key={d} value={d}>{d || 'qualquer'}</option>)}
                    </select>
                </div>
            </div>

            <div>
                <label className="text-xs text-text-muted mb-1 block">Descrição <span className="text-danger">*</span></label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)}
                    rows={2} placeholder="Explique o que essa skill faz..."
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary resize-none" />
            </div>

            <div>
                <label className="text-xs text-text-muted mb-1 block">Prompt Template (opcional)</label>
                <textarea value={form.prompt_template} onChange={e => set('prompt_template', e.target.value)}
                    rows={3} placeholder="Instrução extra para o agente ao usar essa skill..."
                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary resize-none font-mono text-xs" />
            </div>

            {/* Magic Variables Banner */}
            <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg flex gap-2">
                <Terminal size={14} className="text-primary mt-0.5 shrink-0" />
                <div>
                    <span className="text-xs font-semibold text-text block mb-1">
                        Variáveis Mágicas (Auto-replace)
                    </span>
                    <span className="text-[11px] text-text-muted leading-relaxed">
                        Estas tags serão substituídas nos comandos de Automação:<br />
                        <code className="text-primary bg-bg-base px-1.5 py-0.5 rounded ml-1">{'<DEVICE_NAME>'}</code> Nome do Router<br />
                        <code className="text-primary bg-bg-base px-1.5 py-0.5 rounded ml-1">{'<DEVICE_IP>'}</code> Endereço IP<br />
                        <code className="text-primary bg-bg-base px-1.5 py-0.5 rounded ml-1">{'<DATE>'}</code> Data (AAAA-MM-DD)<br />
                    </span>
                </div>
            </div>

            <div>
                <label className="text-xs text-text-muted mb-2 block font-medium">📌 Fases de execução (steps)</label>
                <StepEditor steps={form.steps} onChange={v => set('steps', v)} />
            </div>

            <div className="flex gap-2 pt-2">
                <button onClick={onCancel} className="flex-1 border border-border text-text-muted py-2 rounded-lg text-sm cursor-pointer hover:bg-bg-elevated transition-colors">
                    Cancelar
                </button>
                <button onClick={() => onSave(form)} disabled={isPending || !form.name || !form.display_name || !form.description}
                    className="flex-1 bg-accent hover:bg-accent-hover text-white py-2 rounded-lg text-sm font-medium cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {isPending && <Loader2 size={13} className="animate-spin" />}
                    <Check size={14} /> Salvar
                </button>
            </div>
        </div>
    )
}

function SkillsTab() {
    const qc = useQueryClient()
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [expanded, setExpanded] = useState(null)

    const { data, isLoading } = useQuery({
        queryKey: ['admin-skills'],
        queryFn: () => api.get('/admin/skills').then(r => r.data)
    })

    const { mutate: toggle } = useMutation({
        mutationFn: (s) => api.patch(`/admin/skills/${s.id}`, { active: !s.active }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-skills'] })
    })

    const { mutate: create, isPending: creating } = useMutation({
        mutationFn: (form) => api.post('/admin/skills', {
            ...form,
            steps: form.steps || [],
            examples: form.examples || [],
        }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-skills'] }); setShowForm(false) }
    })

    const { mutate: update, isPending: updating } = useMutation({
        mutationFn: ({ id, form }) => api.patch(`/admin/skills/${id}`, {
            ...form, steps: form.steps || [], examples: form.examples || [],
        }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-skills'] }); setEditingId(null) }
    })

    const { mutate: remove } = useMutation({
        mutationFn: (id) => api.delete(`/admin/skills/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-skills'] })
    })

    const skills = Array.isArray(data) ? data : (data?.skills ?? [])

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button onClick={() => { setShowForm(true); setEditingId(null) }}
                    className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                    <Plus size={14} /> Nova Skill
                </button>
            </div>

            {showForm && !editingId && (
                <SkillForm isPending={creating} onSave={create} onCancel={() => setShowForm(false)} />
            )}

            <div className="bg-bg-base border border-border rounded-xl overflow-hidden">
                {isLoading
                    ? <div className="p-4">{Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                    : skills.length === 0
                        ? <p className="text-xs text-text-muted p-6 text-center">Nenhuma skill cadastrada. Clique em "Nova Skill" para criar.</p>
                        : skills.map(s => (
                            <div key={s.id} className="border-b border-border last:border-0">
                                {editingId === s.id ? (
                                    <div className="p-3">
                                        <SkillForm
                                            initial={{
                                                ...s,
                                                steps: s.steps || [],
                                                examples: s.examples || [],
                                            }}
                                            isPending={updating}
                                            onSave={(form) => update({ id: s.id, form })}
                                            onCancel={() => setEditingId(null)}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-3 px-4 py-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-text">{s.display_name || s.name}</p>
                                                <Badge variant="primary" className="text-xs">{s.category}</Badge>
                                                {s.device_type && <Badge variant="muted" className="text-xs font-mono">{s.device_type}</Badge>}
                                                {(s.steps?.length > 0) && <Badge variant="success" className="text-xs">{s.steps.length} etapas</Badge>}
                                            </div>
                                            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{s.description}</p>
                                            {s.disabled_count > 0 && (
                                                <p className="text-xs text-warning mt-0.5">{s.disabled_count} tenant(s) desativou</p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                                                className="text-text-muted hover:text-text cursor-pointer p-1.5 rounded hover:bg-bg-elevated transition-colors">
                                                {expanded === s.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            </button>
                                            <button onClick={() => { setEditingId(s.id); setShowForm(false) }}
                                                className="text-text-muted hover:text-primary cursor-pointer p-1.5 rounded hover:bg-bg-elevated transition-colors">
                                                <Pencil size={13} />
                                            </button>
                                            <button onClick={() => remove(s.id)}
                                                className="text-text-muted hover:text-danger cursor-pointer p-1.5 rounded hover:bg-danger/10 transition-colors">
                                                <Trash2 size={13} />
                                            </button>
                                            <button onClick={() => toggle(s)}
                                                className={`cursor-pointer transition-colors ${s.active ? 'text-success' : 'text-text-muted hover:text-text'}`}>
                                                {s.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {expanded === s.id && !editingId && (
                                    <div className="px-4 pb-3 pt-0 bg-bg-elevated border-t border-border">
                                        <p className="text-xs font-mono text-text-muted mt-2 mb-1">name: {s.name}</p>
                                        {s.prompt_template && (
                                            <pre className="text-xs text-text-muted bg-bg-base rounded-lg p-2 mt-1 overflow-x-auto whitespace-pre-wrap">{s.prompt_template}</pre>
                                        )}
                                        {(s.steps?.length > 0) && (
                                            <div className="mt-2 space-y-1">
                                                <p className="text-xs font-medium text-text">Fases:</p>
                                                {s.steps.map((step, i) => (
                                                    <div key={i} className="text-xs text-text-muted pl-2 border-l border-border">
                                                        <span className="font-medium">{step.label}</span>
                                                        {step.commands?.map((c, j) => (
                                                            <div key={j} className="font-mono pl-2">$ {c}</div>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                }
            </div>
        </div>
    )
}

// ── Knowledge Tab ─────────────────────────────────────────────────────────────

function KnowledgeTab() {
    const qc = useQueryClient()
    const { data, isLoading } = useQuery({ queryKey: ['admin-knowledge'], queryFn: () => api.get('/admin/knowledge').then(r => r.data) })
    const { mutate: remove } = useMutation({ mutationFn: (id) => api.delete(`/admin/knowledge/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-knowledge'] }) })
    const entries = data?.knowledge ?? []
    return (
        <div className="bg-bg-base border border-border rounded-xl overflow-hidden">
            {isLoading ? <div className="p-4">{Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />)}</div>
                : entries.length === 0
                    ? <p className="text-xs text-text-muted p-6 text-center">Base de conhecimento vazia. O agente ainda não aprendeu nada.</p>
                    : entries.map(e => (
                        <div key={e.id} className="flex items-start gap-4 px-4 py-3 border-b border-border last:border-0">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-text line-clamp-1 font-medium">{e.title}</p>
                                <p className="text-xs text-text-muted line-clamp-1 mt-0.5">{e.content}</p>
                                {e.category && <Badge variant="muted" className="text-xs mt-1">{e.category}</Badge>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-xs font-mono text-text-muted">{(e.quality_score ?? e.qualityScore ?? 0).toFixed(1)}★</span>
                                <button onClick={() => remove(e.id)} className="text-text-muted hover:text-danger transition-colors cursor-pointer p-1.5 rounded hover:bg-danger/10"><Trash2 size={13} /></button>
                            </div>
                        </div>
                    ))}
        </div>
    )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Admin() {
    const [tab, setTab] = useState('tenants')
    return (
        <div className="space-y-5 animate-fade-in">
            <div>
                <h1 className="text-xl font-bold text-text font-mono">Admin</h1>
                <p className="text-sm text-text-muted mt-0.5">Gerenciamento global da plataforma</p>
            </div>
            <div className="flex gap-1 bg-bg-surface border border-border rounded-xl p-1 w-fit">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${tab === id ? 'bg-accent text-white' : 'text-text-muted hover:text-text'}`}>
                        <Icon size={13} /> {label}
                    </button>
                ))}
            </div>
            <div className="bg-bg-surface border border-border rounded-xl p-5">
                {tab === 'tenants' && <TenantsTab />}
                {tab === 'skills' && <SkillsTab />}
                {tab === 'knowledge' && <KnowledgeTab />}
            </div>
        </div>
    )
}
