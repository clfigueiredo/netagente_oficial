import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, ChevronDown, ChevronRight, Terminal, Cpu, Network, Box, Layers } from 'lucide-react'
import api from '../lib/api'
import clsx from 'clsx'

const CATEGORY_CONFIG = {
    linux: { label: 'Linux', icon: Cpu, color: '#f97316', bg: 'rgba(249,115,22,0.08)' },
    docker: { label: 'Docker', icon: Box, color: '#38bdf8', bg: 'rgba(56,189,248,0.08)' },
    mikrotik: { label: 'MikroTik', icon: Network, color: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
    network: { label: 'Rede', icon: Network, color: '#34d399', bg: 'rgba(52,211,153,0.08)' },
    general: { label: 'Geral', icon: Layers, color: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
}

function SkillCard({ skill, onToggle }) {
    const [expanded, setExpanded] = useState(false)
    const [toggling, setToggling] = useState(false)
    const cat = CATEGORY_CONFIG[skill.category] || CATEGORY_CONFIG.general
    const Icon = cat.icon
    const steps = Array.isArray(skill.steps) ? skill.steps : []
    const examples = Array.isArray(skill.examples) ? skill.examples : []
    const isEnabled = skill.enabled !== false

    const handleToggle = async () => {
        setToggling(true)
        await onToggle(skill.id, !isEnabled)
        setToggling(false)
    }

    return (
        <div style={{
            background: 'var(--bg-surface, #0f1117)',
            border: `1px solid ${isEnabled ? cat.color + '30' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '12px',
            overflow: 'hidden',
            opacity: isEnabled ? 1 : 0.55,
            transition: 'opacity 0.2s, border-color 0.2s',
        }}>
            {/* Header strip */}
            <div style={{ height: '3px', background: isEnabled ? cat.color : 'transparent', transition: 'background 0.2s' }} />

            <div style={{ padding: '16px' }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '8px',
                        background: cat.bg, border: `1px solid ${cat.color}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <Icon size={16} color={cat.color} />
                    </div>

                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: '14px', color: '#e2e8f0' }}>
                                {skill.display_name}
                            </span>
                            <span style={{
                                fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                                background: cat.bg, color: cat.color, fontWeight: 600,
                            }}>
                                {cat.label}
                            </span>
                            {skill.device_type && (
                                <span style={{
                                    fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                                    background: 'rgba(148,163,184,0.08)', color: '#94a3b8', fontWeight: 500,
                                }}>
                                    {skill.device_type}
                                </span>
                            )}
                        </div>
                        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.5 }}>
                            {skill.description}
                        </p>
                    </div>

                    {/* Toggle */}
                    <button
                        onClick={handleToggle}
                        disabled={toggling}
                        title={isEnabled ? 'Desativar skill' : 'Ativar skill'}
                        style={{
                            width: '40px', height: '22px', borderRadius: '999px', border: 'none',
                            background: isEnabled ? cat.color : 'rgba(100,116,139,0.3)',
                            position: 'relative', cursor: toggling ? 'not-allowed' : 'pointer',
                            transition: 'background 0.2s', flexShrink: 0,
                        }}
                    >
                        <span style={{
                            position: 'absolute', top: '3px',
                            left: isEnabled ? 'calc(100% - 19px)' : '3px',
                            width: '16px', height: '16px',
                            borderRadius: '50%', background: 'white',
                            transition: 'left 0.2s',
                        }} />
                    </button>
                </div>

                {/* Expandable steps & examples */}
                {(steps.length > 0 || examples.length > 0) && (
                    <div style={{ marginTop: '12px' }}>
                        <button
                            onClick={() => setExpanded(e => !e)}
                            style={{
                                background: 'none', border: 'none', padding: 0,
                                display: 'flex', alignItems: 'center', gap: '5px',
                                fontSize: '11px', color: '#64748b', cursor: 'pointer',
                            }}
                        >
                            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {steps.length} fase{steps.length !== 1 ? 's' : ''} de instalação
                            {examples.length > 0 ? ` · ${examples.length} exemplo${examples.length > 1 ? 's' : ''}` : ''}
                        </button>

                        {expanded && (
                            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {steps.map((step, i) => (
                                    <div key={i} style={{
                                        background: '#0d1117', borderRadius: '8px', padding: '10px 12px',
                                        borderLeft: `3px solid ${cat.color}50`,
                                    }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: cat.color, marginBottom: '6px' }}>
                                            <Terminal size={10} style={{ display: 'inline', marginRight: '4px' }} />
                                            {step.label || `Fase ${i + 1}`}
                                            {step.risk_level && (
                                                <span style={{
                                                    marginLeft: '8px', fontSize: '10px', padding: '1px 6px',
                                                    borderRadius: '4px', background: 'rgba(239,68,68,0.1)',
                                                    color: '#fca5a5',
                                                }}>
                                                    risco {step.risk_level}
                                                </span>
                                            )}
                                        </div>
                                        {(step.commands || []).map((cmd, j) => (
                                            <div key={j} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7dd3fc', lineHeight: 1.6 }}>
                                                <span style={{ color: '#475569' }}>$ </span>{cmd}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                                {examples.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                                        <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>Aciona com:</span>
                                        {examples.map((ex, i) => (
                                            <span key={i} style={{
                                                fontSize: '11px', padding: '2px 8px', borderRadius: '6px',
                                                background: 'rgba(148,163,184,0.08)', color: '#94a3b8',
                                                fontStyle: 'italic',
                                            }}>"{ex}"</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export default function Skills() {
    const queryClient = useQueryClient()

    const { data: skills = [], isLoading } = useQuery({
        queryKey: ['skills'],
        queryFn: () => api.get('/skills').then(r => r.data),
    })

    const toggleMutation = useMutation({
        mutationFn: ({ id, enabled }) => api.post(`/skills/${id}/toggle`, { enabled }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
    })

    const grouped = skills.reduce((acc, s) => {
        const cat = s.category || 'general'
        if (!acc[cat]) acc[cat] = []
        acc[cat].push(s)
        return acc
    }, {})

    const categoryOrder = ['linux', 'docker', 'mikrotik', 'network', 'general']
    const activeCount = skills.filter(s => s.enabled !== false).length

    return (
        <div style={{ padding: '28px', maxWidth: '900px', margin: '0 auto' }}>
            {/* Page header */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <Package size={22} color="#38bdf8" />
                    <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e2e8f0' }}>Skills de Automação</h1>
                    <span style={{
                        fontSize: '12px', padding: '3px 10px', borderRadius: '999px',
                        background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontWeight: 600,
                    }}>
                        {activeCount} ativas
                    </span>
                </div>
                <p style={{ fontSize: '13px', color: '#64748b' }}>
                    Receitas de automação disponíveis para o agente. Ative ou desative conforme sua necessidade.
                    O agente usará automaticamente as skills ativas ao detectar as intenções correspondentes.
                </p>

                {/* Magic Variables Banner */}
                <div style={{
                    marginTop: '16px', padding: '12px 16px', background: 'rgba(56,189,248,0.05)',
                    border: '1px solid rgba(56,189,248,0.2)', borderRadius: '8px', display: 'flex', gap: '8px'
                }}>
                    <Terminal size={16} color="#38bdf8" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', display: 'block', marginBottom: '4px' }}>
                            Variáveis Mágicas (Magic Variables)
                        </span>
                        <span style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                            Você pode usar as seguintes tags nos comandos das suas Skills. O sistema irá substituí-las dinamicamente durante a execução:<br />
                            <code style={{ color: '#38bdf8', background: '#0f1117', padding: '2px 6px', borderRadius: '4px', margin: '2px 4px 0 0' }}>{'<DEVICE_NAME>'}</code> Nome do dispositivo<br />
                            <code style={{ color: '#38bdf8', background: '#0f1117', padding: '2px 6px', borderRadius: '4px', margin: '2px 4px 0 0' }}>{'<DEVICE_IP>'}</code> Endereço IP do dispositivo<br />
                            <code style={{ color: '#38bdf8', background: '#0f1117', padding: '2px 6px', borderRadius: '4px', margin: '2px 4px 0 0' }}>{'<DATE>'}</code> Data atual (AAAA-MM-DD)<br />
                        </span>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>Carregando skills...</div>
            ) : skills.length === 0 ? (
                <div style={{
                    border: '1px dashed rgba(100,116,139,0.3)', borderRadius: '12px',
                    padding: '60px', textAlign: 'center',
                }}>
                    <Package size={32} color="#475569" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#64748b', fontSize: '14px' }}>Nenhuma skill disponível ainda.</p>
                    <p style={{ color: '#475569', fontSize: '12px', marginTop: '4px' }}>
                        O administrador pode criar skills em Painel Admin → Skills.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    {categoryOrder
                        .filter(cat => grouped[cat]?.length > 0)
                        .map(cat => {
                            const catCfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.general
                            const CatIcon = catCfg.icon
                            return (
                                <section key={cat}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <CatIcon size={14} color={catCfg.color} />
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: catCfg.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                            {catCfg.label}
                                        </span>
                                        <div style={{ flex: 1, height: '1px', background: `${catCfg.color}20` }} />
                                        <span style={{ fontSize: '11px', color: '#475569' }}>
                                            {grouped[cat].filter(s => s.enabled !== false).length}/{grouped[cat].length}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {grouped[cat].map(skill => (
                                            <SkillCard
                                                key={skill.id}
                                                skill={skill}
                                                onToggle={(id, enabled) => toggleMutation.mutateAsync({ id, enabled })}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )
                        })}
                </div>
            )}
        </div>
    )
}
