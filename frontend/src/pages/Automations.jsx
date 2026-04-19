import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap, Plus, Trash2, Clock, CheckCircle2, XCircle, Settings, Network, Play } from 'lucide-react'
import api from '../lib/api'
import clsx from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const CRON_PRESETS = [
    { label: 'A cada minuto (Teste)', value: '* * * * *' },
    { label: 'A cada hora', value: '0 * * * *' },
    { label: 'Todo dia à meia-noite', value: '0 0 * * *' },
    { label: 'Todo dia às 03:00', value: '0 3 * * *' },
    { label: 'Toda segunda às 08:00', value: '0 8 * * 1' },
    { label: 'Todo domingo às 04:00', value: '0 4 * * 0' },
]

export default function Automations() {
    const queryClient = useQueryClient()
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        skill_id: '',
        target_devices: [],
        cron_expression: '0 3 * * *',
        notification_target: ''
    })

    const { data: automations = [], isLoading } = useQuery({
        queryKey: ['automations'],
        queryFn: () => api.get('/automations').then(r => r.data)
    })

    const { data: skills = [] } = useQuery({
        queryKey: ['skills'],
        queryFn: () => api.get('/skills').then(r => r.data)
    })

    // Filter available skills that are actually usable (enabled normally)
    const availableSkills = skills.filter(s => s.enabled !== false)

    const { data: devices = [] } = useQuery({
        queryKey: ['devices'],
        queryFn: () => api.get('/devices').then(r => r.data)
    })

    const createMutation = useMutation({
        mutationFn: (data) => api.post('/automations', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['automations'] })
            setIsFormOpen(false)
            setFormData({ name: '', skill_id: '', target_devices: [], cron_expression: '0 3 * * *', notification_target: '' })
        }
    })

    const toggleMutation = useMutation({
        mutationFn: ({ id, is_active }) => api.put(`/automations/${id}`, { is_active }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] })
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => api.delete(`/automations/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] })
    })

    const handleSubmit = (e) => {
        e.preventDefault()
        createMutation.mutate(formData)
    }

    const toggleDevice = (id) => {
        setFormData(prev => ({
            ...prev,
            target_devices: prev.target_devices.includes(id)
                ? prev.target_devices.filter(d => d !== id)
                : [...prev.target_devices, id]
        }))
    }

    const activeCount = automations.filter(a => a.is_active).length

    return (
        <div style={{ padding: '28px', maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                        <Zap size={22} color="#fbbf24" />
                        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Automações (Cron Jobs)</h1>
                        <span style={{
                            fontSize: '12px', padding: '3px 10px', borderRadius: '999px',
                            background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontWeight: 600,
                        }}>
                            {activeCount} ativas
                        </span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#64748b' }}>
                        Agende a execução automática de Skills. Use a variável mágica <code>{'<DEVICE_NAME>'}</code> nas
                        Skills para injetar o nome dinamicamente durante o lote.
                    </p>
                </div>
                {!isFormOpen && (
                    <button
                        onClick={() => setIsFormOpen(true)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: '#fbbf24', color: '#451a03', fontWeight: 600,
                            padding: '8px 16px', borderRadius: '8px', border: 'none',
                            fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s',
                        }}
                        onMouseOver={(e) => e.target.style.background = '#f59e0b'}
                        onMouseOut={(e) => e.target.style.background = '#fbbf24'}
                    >
                        <Plus size={16} />
                        Nova Automação
                    </button>
                )}
            </div>

            {isFormOpen && (
                <div style={{
                    background: '#0f1117', border: '1px solid #1e293b',
                    borderRadius: '12px', padding: '24px', marginBottom: '32px'
                }}>
                    <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={18} color="#fbbf24" />
                        Configurar Nova Automação
                    </h2>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* Nome & Destino */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>Nome da Automação *</label>
                                <input
                                    required
                                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ex: Backup Diário"
                                    style={{ width: '100%', background: '#090a0f', border: '1px solid #334155', color: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>WhatsApp (Alerta Final)</label>
                                <input
                                    value={formData.notification_target} onChange={e => setFormData({ ...formData, notification_target: e.target.value })}
                                    placeholder="Deixe vazio para o Admin Padrão"
                                    style={{ width: '100%', background: '#090a0f', border: '1px solid #334155', color: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}
                                />
                            </div>
                        </div>

                        {/* Skill & Cron */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>Skill Executada *</label>
                                <select
                                    required
                                    value={formData.skill_id} onChange={e => setFormData({ ...formData, skill_id: e.target.value })}
                                    style={{ width: '100%', background: '#090a0f', border: '1px solid #334155', color: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}
                                >
                                    <option value="">Selecione uma skill...</option>
                                    {availableSkills.map(s => (
                                        <option key={s.id} value={s.id}>{s.display_name} ({s.category})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>Frequência (Cron) *</label>
                                <select
                                    required
                                    value={formData.cron_expression} onChange={e => setFormData({ ...formData, cron_expression: e.target.value })}
                                    style={{ width: '100%', background: '#090a0f', border: '1px solid #334155', color: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '13px' }}
                                >
                                    {CRON_PRESETS.map(p => (
                                        <option key={p.value} value={p.value}>{p.label} [{p.value}]</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Target Devices */}
                        <div>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>Dispositivos Alvo *</label>
                            <div style={{
                                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px',
                                background: '#090a0f', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b',
                                maxHeight: '200px', overflowY: 'auto'
                            }}>
                                {devices.map(d => (
                                    <div
                                        key={d.id}
                                        onClick={() => toggleDevice(d.id)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
                                            borderRadius: '6px', cursor: 'pointer',
                                            background: formData.target_devices.includes(d.id) ? 'rgba(56,189,248,0.1)' : 'transparent',
                                            border: `1px solid ${formData.target_devices.includes(d.id) ? '#38bdf850' : '#1e293b'}`,
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <div style={{
                                            width: '16px', height: '16px', borderRadius: '4px', border: '1px solid #38bdf8',
                                            display: 'flex', alignItems: 'center', justifyItems: 'center',
                                            background: formData.target_devices.includes(d.id) ? '#38bdf8' : 'transparent',
                                        }}>
                                            {formData.target_devices.includes(d.id) && <CheckCircle2 size={12} color="#090a0f" />}
                                        </div>
                                        <Network size={14} color="#94a3b8" />
                                        <span style={{ fontSize: '13px', color: formData.target_devices.includes(d.id) ? '#e2e8f0' : '#94a3b8', userSelect: 'none' }}>
                                            {d.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <span style={{ fontSize: '11px', color: '#64748b', marginTop: '6px', display: 'block' }}>
                                {formData.target_devices.length} dispositivo(s) selecionado(s) para execução paralela inteligente.
                            </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                            <button
                                type="button"
                                onClick={() => setIsFormOpen(false)}
                                style={{ background: 'transparent', border: '1px solid #334155', color: '#cbd5e1', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={createMutation.isPending || formData.target_devices.length === 0 || !formData.skill_id}
                                style={{
                                    background: createMutation.isPending || formData.target_devices.length === 0 ? '#fbbf2450' : '#fbbf24',
                                    color: '#451a03', border: 'none', padding: '8px 20px', borderRadius: '8px', fontSize: '13px',
                                    cursor: createMutation.isPending || formData.target_devices.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 600
                                }}
                            >
                                {createMutation.isPending ? 'Salvando...' : 'Criar Automação'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Carregando automações...</div>
            ) : automations.length === 0 && !isFormOpen ? (
                <div style={{
                    border: '1px dashed rgba(100,116,139,0.3)', borderRadius: '12px',
                    padding: '60px', textAlign: 'center',
                }}>
                    <Zap size={32} color="#475569" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#64748b', fontSize: '14px' }}>Nenhuma automação agendada ainda.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {automations.map(auto => {
                        const isEnabled = auto.is_active
                        return (
                            <div key={auto.id} style={{
                                background: '#0f1117', border: `1px solid ${isEnabled ? 'rgba(251,191,36,0.2)' : 'rgba(100,116,139,0.2)'}`,
                                borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '20px',
                                opacity: isEnabled ? 1 : 0.6, transition: 'all 0.2s'
                            }}>
                                <div style={{
                                    width: '42px', height: '42px', borderRadius: '10px',
                                    background: isEnabled ? 'rgba(251,191,36,0.1)' : 'rgba(100,116,139,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                }}>
                                    <Zap size={20} color={isEnabled ? '#fbbf24' : '#64748b'} />
                                </div>

                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                        <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0', margin: 0 }}>{auto.name}</h3>
                                        <span style={{ fontSize: '11px', color: '#38bdf8', background: 'rgba(56,189,248,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                                            {auto.skill_name}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#64748b', fontSize: '12px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Clock size={12} /> {auto.cron_expression}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Network size={12} /> {(auto.target_devices || []).length} alvo(s)
                                        </span>
                                        {auto.last_run_at && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {auto.last_status === 'success' ? <CheckCircle2 size={12} color="#34d399" />
                                                    : auto.last_status === 'failed' ? <XCircle size={12} color="#f87171" />
                                                        : <Play size={12} color="#fbbf24" />}
                                                Último run: {formatDistanceToNow(new Date(auto.last_run_at), { addSuffix: true, locale: ptBR })}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <button
                                        onClick={() => toggleMutation.mutate({ id: auto.id, is_active: !isEnabled })}
                                        title={isEnabled ? 'Desativar automação' : 'Ativar automação'}
                                        style={{
                                            width: '40px', height: '22px', borderRadius: '999px', border: 'none',
                                            background: isEnabled ? '#fbbf24' : 'rgba(100,116,139,0.3)',
                                            position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                                        }}
                                    >
                                        <span style={{
                                            position: 'absolute', top: '3px', left: isEnabled ? 'calc(100% - 19px)' : '3px',
                                            width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.2s'
                                        }} />
                                    </button>

                                    <button
                                        onClick={() => { if (window.confirm('Excluir esta automação?')) deleteMutation.mutate(auto.id) }}
                                        title="Excluir"
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px', color: '#ef4444', opacity: 0.7 }}
                                        onMouseOver={(e) => e.target.style.opacity = 1}
                                        onMouseOut={(e) => e.target.style.opacity = 0.7}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
