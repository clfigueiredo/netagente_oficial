import { useQuery } from '@tanstack/react-query'
import { Server, CheckCircle2, AlertTriangle, Activity, Code2, Cpu, Wrench } from 'lucide-react'
import api from '../lib/api'
import { StatCard } from '../components/ui/Card'
import { SkeletonCard, SkeletonRow } from '../components/ui/Skeleton'
import { StatusBadge } from '../components/ui/Badge'

function DeviceRow({ device }) {
    const isOnline = device.last_seen_at && (Date.now() - new Date(device.last_seen_at).getTime()) < 300000

    return (
        <div className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-bg-elevated/50 transition-colors px-2 rounded-lg">
            <div className="flex items-center gap-4 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-text-muted flex-shrink-0">
                    <Server size={14} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate font-mono">{device.name}</p>
                    <p className="text-xs text-text-muted truncate mt-0.5">{device.host}</p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <StatusBadge online={isOnline} />
            </div>
        </div>
    )
}

export default function Dashboard() {
    const { data: devicesData, isLoading: devLoading } = useQuery({
        queryKey: ['devices'],
        queryFn: () => api.get('/devices').then(r => r.data),
        refetchInterval: 30_000,
    })

    const { data: skillsData, isLoading: skillLoading } = useQuery({
        queryKey: ['skills'],
        queryFn: () => api.get('/skills').then(r => r.data),
    })

    const { data: automationsData, isLoading: autoLoading } = useQuery({
        queryKey: ['automations'],
        queryFn: () => api.get('/automations').then(r => r.data),
    })

    const devices = Array.isArray(devicesData) ? devicesData : (devicesData?.devices ?? [])
    const skills = Array.isArray(skillsData) ? skillsData : []
    const automations = Array.isArray(automationsData) ? automationsData : []

    const onlineCount = devices.filter(d => d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 300000).length
    const offlineCount = devices.length - onlineCount

    return (
        <div className="space-y-6 animate-fade-in pb-8">
            <div>
                <h1 className="text-xl font-bold text-text font-mono">Dashboard</h1>
                <p className="text-sm text-text-muted mt-0.5">Visão geral da infraestrutura e integrações</p>
            </div>

            {/* Stat cards - Top Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {devLoading ? (
                    Array(4).fill(0).map((_, i) => <SkeletonCard key={i} />)
                ) : (
                    <>
                        <StatCard label="Dispositivos" value={devices.length} icon={Server} color="primary" trend={`${onlineCount} online`} />
                        <StatCard label="Online" value={onlineCount} icon={CheckCircle2} color="success" />
                        <StatCard label="Offline" value={offlineCount} icon={AlertTriangle} color={offlineCount > 0 ? 'danger' : 'muted'} />
                        <StatCard
                            label="Automações"
                            value={autoLoading ? '...' : automations.length}
                            icon={Activity}
                            color="warning"
                        />
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Device list */}
                <div className="xl:col-span-2 bg-bg-surface border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-6">
                        <Activity size={16} className="text-primary" />
                        <h3 className="text-sm font-semibold text-text font-mono">Status dos Dispositivos</h3>
                    </div>
                    <div className="flex flex-col gap-1">
                        {devLoading ? (
                            Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />)
                        ) : devices.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg">
                                <Server size={32} className="text-text-muted mb-3" />
                                <p className="text-sm text-text-muted font-mono">Nenhum dispositivo cadastrado no momento.</p>
                            </div>
                        ) : (
                            devices.map(d => <DeviceRow key={d.id} device={d} />)
                        )}
                    </div>
                </div>

                {/* Right column - Additional stats */}
                <div className="space-y-6">
                    <div className="bg-bg-surface border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-6">
                            <Code2 size={16} className="text-purple-500" />
                            <h3 className="text-sm font-semibold text-text font-mono">Custom Skills</h3>
                        </div>

                        <div className="flex items-baseline justify-between">
                            <h2 className="text-3xl font-bold font-mono text-text">
                                {skillLoading ? '...' : skills.length}
                            </h2>
                            <span className="text-xs text-text-muted font-mono bg-bg-elevated px-2 py-1 rounded">
                                Habilidades Customizadas
                            </span>
                        </div>
                        <p className="text-xs text-text-muted mt-4 font-mono leading-relaxed">
                            Skills ativas prontas para extender as capacidades do agente inteligente na rede.
                        </p>
                    </div>

                    <div className="bg-bg-surface border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-6">
                            <Wrench size={16} className="text-blue-500" />
                            <h3 className="text-sm font-semibold text-text font-mono">Ferramentas MCP</h3>
                        </div>

                        <div className="flex items-baseline justify-between mb-4">
                            <h2 className="text-3xl font-bold font-mono text-text">123</h2>
                            <span className="text-xs text-blue-500 font-mono bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">
                                Model Context Protocol
                            </span>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 text-text">
                                    <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                                    <span className="font-mono">RouterOS (MikroTik)</span>
                                </div>
                                <span className="font-mono font-medium text-text">109 nativas</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 text-text">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                    <span className="font-mono">Linux (Debian/Ubuntu)</span>
                                </div>
                                <span className="font-mono font-medium text-text">14 nativas</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

