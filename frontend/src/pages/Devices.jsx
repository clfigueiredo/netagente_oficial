import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, Plus, Trash2, Pencil, RefreshCw, Loader2, Eye, EyeOff, X, Zap, CheckCircle2, AlertCircle, Cpu, MemoryStick, Clock, Monitor } from 'lucide-react'
import api from '../lib/api'
import { SkeletonRow } from '../components/ui/Skeleton'

const TYPES = ['mikrotik', 'linux']

function DeviceFormModal({ device, onClose }) {
    const qc = useQueryClient()
    const isEdit = !!device
    const [form, setForm] = useState({
        name: device?.name || '',
        host: device?.host || '',
        port: device?.port || 22,
        type: device?.type || 'mikrotik',
        username: device?.username || '',
        password: ''
    })
    const [showPass, setShowPass] = useState(false)

    const { mutate, isPending, error } = useMutation({
        mutationFn: (data) => {
            if (isEdit) {
                const payload = { ...data }
                if (!payload.password) delete payload.password
                return api.patch(`/devices/${device.id}`, payload)
            }
            return api.post('/devices', data)
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); onClose() },
    })

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-bg-surface border border-border rounded-2xl w-full max-w-md p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-base font-bold font-mono text-text">{isEdit ? 'Editar Dispositivo' : 'Adicionar Dispositivo'}</h3>
                    <button onClick={onClose} className="text-text-muted hover:text-text transition-colors cursor-pointer"><X size={18} /></button>
                </div>
                <form onSubmit={e => { e.preventDefault(); mutate(form) }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <label className="text-xs text-text-muted mb-1 block">Nome</label>
                            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors" />
                        </div>
                        <div>
                            <label className="text-xs text-text-muted mb-1 block">Host / IP</label>
                            <input required value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors font-mono" />
                        </div>
                        <div>
                            <label className="text-xs text-text-muted mb-1 block">Porta SSH</label>
                            <input type="number" required value={form.port} onChange={e => setForm(f => ({ ...f, port: +e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors font-mono" />
                        </div>
                        <div>
                            <label className="text-xs text-text-muted mb-1 block">Tipo</label>
                            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors">
                                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-text-muted mb-1 block">Usuário</label>
                            <input required={!isEdit} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors font-mono" />
                        </div>
                        <div className="col-span-2">
                            <label className="text-xs text-text-muted mb-1 block">Senha {isEdit && <span className="text-text-dim">(deixe vazio para manter)</span>}</label>
                            <div className="relative">
                                <input type={showPass ? 'text' : 'password'} required={!isEdit} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 pr-9 text-sm text-text outline-none focus:border-primary transition-colors" />
                                <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer">
                                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        </div>
                    </div>
                    {error && <p className="text-xs text-danger">{error.response?.data?.error ?? 'Erro ao salvar'}</p>}
                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 border border-border text-text-muted hover:text-text py-2 rounded-lg text-sm transition-colors cursor-pointer">Cancelar</button>
                        <button type="submit" disabled={isPending} className="flex-1 bg-primary hover:bg-primary-hover text-white py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2">
                            {isPending && <Loader2 size={13} className="animate-spin" />}
                            {isEdit ? 'Salvar' : 'Adicionar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

function ConfirmDeleteModal({ device, onClose, onConfirm, isPending }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-bg-surface border border-border rounded-2xl w-full max-w-sm p-6 animate-slide-up text-center">
                <div className="w-12 h-12 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center mx-auto mb-4">
                    <Trash2 size={20} className="text-danger" />
                </div>
                <h3 className="text-base font-bold text-text mb-2">Remover dispositivo?</h3>
                <p className="text-sm text-text-muted mb-5">
                    <span className="font-mono text-text">{device.name}</span> ({device.host}) será desativado.
                </p>
                <div className="flex gap-2">
                    <button onClick={onClose} className="flex-1 border border-border text-text-muted hover:text-text py-2 rounded-lg text-sm transition-colors cursor-pointer">Cancelar</button>
                    <button onClick={onConfirm} disabled={isPending} className="flex-1 bg-danger hover:bg-danger/80 text-white py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2">
                        {isPending && <Loader2 size={13} className="animate-spin" />}
                        Remover
                    </button>
                </div>
            </div>
        </div>
    )
}

function TestConnectionModal({ device, onClose }) {
    const [phase, setPhase] = useState('testing') // 'testing' | 'success' | 'error'
    const [result, setResult] = useState(null)

    const { mutate: runTest } = useMutation({
        mutationFn: () => api.post(`/devices/${device.id}/test`).then(r => r.data),
        onSuccess: (data) => {
            setResult(data)
            setPhase(data.ok ? 'success' : 'error')
        },
        onError: (err) => {
            setResult({ error: err.response?.data?.error ?? 'Falha ao comunicar com a API' })
            setPhase('error')
        },
    })

    // Auto-run on mount
    useEffect(() => { runTest() }, [])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-bg-surface border border-border rounded-2xl w-full max-w-md p-6 animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${phase === 'testing' ? 'bg-primary/10 border border-primary/20' :
                            phase === 'success' ? 'bg-success/10 border border-success/20' :
                                'bg-danger/10 border border-danger/20'
                            }`}>
                            {phase === 'testing' && <Loader2 size={15} className="text-primary animate-spin" />}
                            {phase === 'success' && <CheckCircle2 size={15} className="text-success" />}
                            {phase === 'error' && <AlertCircle size={15} className="text-danger" />}
                        </div>
                        <h3 className="text-sm font-bold font-mono text-text">
                            {phase === 'testing' ? 'Testando Conexão' :
                                phase === 'success' ? 'Conectado' : 'Falha na Conexão'}
                        </h3>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text transition-colors cursor-pointer"><X size={16} /></button>
                </div>

                {/* Device info */}
                <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-bg-elevated border border-border rounded-lg">
                    <Server size={14} className="text-text-muted flex-shrink-0" />
                    <span className="text-xs font-mono text-text">{device.name}</span>
                    <span className="text-xs text-text-muted ml-auto font-mono">{device.host}:{device.port}</span>
                    <span className="text-xs bg-bg-surface border border-border rounded px-1.5 py-0.5 text-text-dim font-mono">{device.type}</span>
                </div>

                {/* Testing state */}
                {phase === 'testing' && (
                    <div className="py-8 flex flex-col items-center gap-3">
                        <div className="relative">
                            <div className="w-14 h-14 rounded-full border-2 border-primary/20 animate-ping absolute inset-0" />
                            <div className="w-14 h-14 rounded-full border-2 border-primary/40 flex items-center justify-center relative">
                                <Zap size={22} className="text-primary" />
                            </div>
                        </div>
                        <p className="text-sm text-text-muted">Acessando <span className="font-mono text-text">{device.host}</span>...</p>
                        <p className="text-xs text-text-dim">Conectando via SSH</p>
                    </div>
                )}

                {/* Success state */}
                {phase === 'success' && result?.metrics && (
                    <div className="space-y-2.5">
                        {result.metrics.hostname && (
                            <div className="flex items-center gap-2 text-xs text-text-dim">
                                <Monitor size={12} />
                                <span className="font-mono">{result.metrics.hostname}</span>
                                <span className="ml-auto text-text-muted">{result.metrics.os}</span>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <MetricCard icon={<Clock size={15} />} label="Uptime" value={result.metrics.uptime} color="primary" />
                            <MetricCard icon={<Cpu size={15} />} label="CPU" value={result.metrics.cpu} color="warning" />
                            <MetricCard icon={<MemoryStick size={15} />} label="RAM Livre" value={result.metrics.ram_free} color="success" />
                            <MetricCard icon={<MemoryStick size={15} />} label="RAM Total" value={result.metrics.ram_total} color="muted" />
                        </div>
                        {result.metrics.platform && (
                            <p className="text-xs text-text-dim text-center pt-1">{result.metrics.platform}</p>
                        )}
                    </div>
                )}

                {/* Error state */}
                {phase === 'error' && (
                    <div className="py-6 flex flex-col items-center gap-3 text-center">
                        <div className="w-12 h-12 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center">
                            <AlertCircle size={22} className="text-danger" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-text mb-1">Não foi possível conectar</p>
                            <p className="text-xs text-text-muted font-mono">{result?.error ?? 'Erro desconhecido'}</p>
                        </div>
                        <button onClick={() => { setPhase('testing'); runTest() }}
                            className="mt-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer flex items-center gap-1">
                            <RefreshCw size={11} /> Tentar novamente
                        </button>
                    </div>
                )}

                <button onClick={onClose}
                    className="mt-4 w-full border border-border text-text-muted hover:text-text py-2 rounded-lg text-sm transition-colors cursor-pointer">
                    Fechar
                </button>
            </div>
        </div>
    )
}

function MetricCard({ icon, label, value, color }) {
    const colorMap = {
        primary: 'text-primary',
        warning: 'text-yellow-400',
        success: 'text-success',
        muted: 'text-text-muted',
    }
    return (
        <div className="flex flex-col gap-1 bg-bg-elevated border border-border rounded-xl px-3 py-2.5">
            <div className={`flex items-center gap-1.5 ${colorMap[color] ?? 'text-text-muted'}`}>
                {icon}
                <span className="text-xs text-text-muted">{label}</span>
            </div>
            <span className="text-sm font-medium font-mono text-text">{value ?? 'N/A'}</span>
        </div>
    )
}

export default function Devices() {
    const qc = useQueryClient()
    const [modal, setModal] = useState(null) // null | 'add' | device object for edit
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [testTarget, setTestTarget] = useState(null)

    const { data, isLoading } = useQuery({
        queryKey: ['devices'],
        queryFn: () => api.get('/devices').then(r => r.data),
        refetchInterval: 60_000,
    })

    const { mutate: deleteDevice, isPending: isDeleting } = useMutation({
        mutationFn: (id) => api.delete(`/devices/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); setDeleteTarget(null) },
    })

    const devices = Array.isArray(data) ? data : (data?.devices ?? [])

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-text font-mono">Dispositivos</h1>
                    <p className="text-sm text-text-muted mt-0.5">{devices.length} dispositivos cadastrados</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => qc.invalidateQueries({ queryKey: ['devices'] })} className="p-2 border border-border rounded-lg text-text-muted hover:text-text hover:bg-bg-elevated transition-all cursor-pointer">
                        <RefreshCw size={15} />
                    </button>
                    <button onClick={() => setModal('add')} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                        <Plus size={15} /> Adicionar
                    </button>
                </div>
            </div>

            <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border">
                            {['Dispositivo', 'Host', 'Tipo', 'Usuário', 'Ações'].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-text-muted">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            Array(4).fill(0).map((_, i) => (
                                <tr key={i} className="border-b border-border"><td colSpan={5} className="px-4 py-3"><SkeletonRow /></td></tr>
                            ))
                        ) : devices.length === 0 ? (
                            <tr><td colSpan={5} className="py-16 text-center">
                                <Server size={32} className="mx-auto text-border mb-3" />
                                <p className="text-sm text-text-muted">Nenhum dispositivo. Adicione o primeiro!</p>
                            </td></tr>
                        ) : devices.map(d => (
                            <tr key={d.id} className="border-b border-border last:border-0 hover:bg-bg-elevated/50 transition-colors">
                                <td className="px-4 py-3">
                                    <p className="text-sm font-medium text-text font-mono">{d.name}</p>
                                </td>
                                <td className="px-4 py-3 text-sm text-text-muted font-mono">{d.host}:{d.port}</td>
                                <td className="px-4 py-3">
                                    <span className="text-xs bg-bg-elevated border border-border rounded px-2 py-0.5 text-text-dim font-mono">{d.type}</span>
                                </td>
                                <td className="px-4 py-3 text-sm text-text-muted font-mono">{d.username}</td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setTestTarget(d)} className="text-text-muted hover:text-yellow-400 transition-colors cursor-pointer p-1.5 rounded hover:bg-yellow-400/10" title="Testar conexão">
                                            <Zap size={14} />
                                        </button>
                                        <button onClick={() => setModal(d)} className="text-text-muted hover:text-primary transition-colors cursor-pointer p-1.5 rounded hover:bg-primary/10" title="Editar">
                                            <Pencil size={14} />
                                        </button>
                                        <button onClick={() => setDeleteTarget(d)} className="text-text-muted hover:text-danger transition-colors cursor-pointer p-1.5 rounded hover:bg-danger/10" title="Remover">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {modal && <DeviceFormModal device={modal === 'add' ? null : modal} onClose={() => setModal(null)} />}
            {deleteTarget && <ConfirmDeleteModal device={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteDevice(deleteTarget.id)} isPending={isDeleting} />}
            {testTarget && <TestConnectionModal device={testTarget} onClose={() => setTestTarget(null)} />}
        </div>
    )
}
