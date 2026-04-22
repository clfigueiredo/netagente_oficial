import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, Trash2, Shield, Wifi, WifiOff, ArrowUpDown, Plus, Terminal } from 'lucide-react';
import api from '../lib/api';
import WizardDeviceSetup from '../components/WireGuard/WizardDeviceSetup';

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(isoString) {
    if (!isoString) return '—';
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s atrás`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`;
    return `${Math.floor(seconds / 86400)}d atrás`;
}

const WireGuard = () => {
    const queryClient = useQueryClient();
    const [wizardState, setWizardState] = useState(null); // null | { initialOsType, initialStep }

    const { data: serverStatus, isLoading } = useQuery({
        queryKey: ['wg-server-status'],
        queryFn: () => api.get('/wg_server/status').then(r => r.data),
        refetchInterval: 15000, // live refresh every 15s
    });

    const removePeer = useMutation({
        mutationFn: (id) => api.delete(`/wg_server/peers/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wg-server-status'] }),
    });

    const connectedCount = serverStatus?.peers?.filter(p => p.connected).length || 0;
    const totalCount = serverStatus?.peers?.length || 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Network className="w-8 h-8 text-primary" />
                    VPN WireGuard
                </h1>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setWizardState({ initialOsType: 'linux', initialStep: 2 })}
                        className="btn btn-secondary flex items-center gap-2"
                        title="Cria peer Linux e entrega um script .sh pronto pra rodar no servidor"
                    >
                        <Terminal className="w-4 h-4" /> Peer Linux (rápido)
                    </button>
                    <button
                        onClick={() => setWizardState({ initialOsType: 'mikrotik', initialStep: 1 })}
                        className="btn btn-primary flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Adicionar Peer
                    </button>
                </div>
            </div>

            {/* Server Info Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-bg-elevated border border-border p-4 rounded-xl">
                    <span className="text-xs text-text-muted uppercase tracking-wider block mb-1">Sub-rede</span>
                    <span className="text-xl font-mono text-text font-bold">{serverStatus?.subnet || '—'}</span>
                </div>
                <div className="bg-bg-elevated border border-border p-4 rounded-xl">
                    <span className="text-xs text-text-muted uppercase tracking-wider block mb-1">Endpoint</span>
                    <span className="text-lg font-mono text-primary font-bold">{serverStatus?.endpoint || '—'}</span>
                </div>
                <div className="bg-bg-elevated border border-border p-4 rounded-xl">
                    <span className="text-xs text-text-muted uppercase tracking-wider block mb-1">Server IP</span>
                    <span className="text-lg font-mono text-text font-bold">{serverStatus?.serverIp || '—'}</span>
                </div>
                <div className="bg-bg-elevated border border-border p-4 rounded-xl">
                    <span className="text-xs text-text-muted uppercase tracking-wider block mb-1">Peers</span>
                    <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-text">{connectedCount}</span>
                        <span className="text-sm text-text-muted">/ {totalCount} online</span>
                    </div>
                </div>
            </div>

            {/* Public Key (collapsible) */}
            {serverStatus?.serverPublicKey && (
                <div className="bg-bg-elevated border border-border p-3 rounded-xl flex items-center gap-3">
                    <Shield className="w-5 h-5 text-text-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-xs text-text-muted uppercase tracking-wider block">Server Public Key</span>
                        <code className="text-sm font-mono text-text break-all">{serverStatus.serverPublicKey}</code>
                    </div>
                </div>
            )}

            {/* Peers Table */}
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Identificação</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP VPN</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Último Handshake</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tráfego</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {serverStatus?.peers?.map((p) => (
                            <tr key={p.id} className={p.connected ? '' : 'opacity-60'}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {p.connected ? (
                                        <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                            <Wifi className="w-4 h-4" />
                                            <span className="text-xs font-medium">Online</span>
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1.5 text-gray-400">
                                            <WifiOff className="w-4 h-4" />
                                            <span className="text-xs font-medium">Offline</span>
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900 dark:text-gray-100 font-semibold">{p.name}</div>
                                    {p.device_name && <div className="text-xs text-gray-500">→ {p.device_name}</div>}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-bold text-gray-900 dark:text-gray-100">
                                    {p.ip_address}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.os_type === 'mikrotik'
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                        }`}>
                                        {p.os_type === 'mikrotik' ? 'MikroTik' : 'Linux'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                    {p.live?.latestHandshake ? timeAgo(p.live.latestHandshake) : '—'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                    {p.live ? (
                                        <span className="flex items-center gap-1">
                                            <ArrowUpDown className="w-3.5 h-3.5" />
                                            <span>↓{formatBytes(p.live.transferRx)} ↑{formatBytes(p.live.transferTx)}</span>
                                        </span>
                                    ) : '—'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <button
                                        onClick={() => {
                                            if (window.confirm(`Excluir peer "${p.name}"? O túnel será derrubado.`))
                                                removePeer.mutate(p.id);
                                        }}
                                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                        title="Excluir"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!serverStatus?.peers?.length && !isLoading && (
                            <tr>
                                <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                                    <Network className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">Nenhum peer conectado</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Clique em "Adicionar Peer" para conectar um dispositivo MikroTik ou Linux.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Wizard Modal */}
            {wizardState && (
                <WizardDeviceSetup
                    initialOsType={wizardState.initialOsType}
                    initialStep={wizardState.initialStep}
                    onClose={() => setWizardState(null)}
                    onComplete={() => queryClient.invalidateQueries({ queryKey: ['wg-server-status'] })}
                />
            )}
        </div>
    );
};

export default WireGuard;
