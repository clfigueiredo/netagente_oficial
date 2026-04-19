import { useState } from 'react';
import { Check, X, Terminal, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../lib/api';

const RISK_CONFIG = {
    low: { label: 'Baixo', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    medium: { label: 'Médio', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    high: { label: 'Alto', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const ACTION_TYPE_LABEL = {
    install: '📦 Instalação',
    restart: '🔄 Reinício de Serviço',
    config: '⚙️ Configuração',
    firewall: '🛡️ Firewall',
    remove: '🗑️ Remoção',
    update: '⬆️ Atualização',
    nat: '🔀 NAT',
    routing: '🗺️ Roteamento',
    backup: '💾 Backup',
};

export default function ActionCard({ action, onResult }) {
    const [status, setStatus] = useState(action.status || 'pending');
    const [outputs, setOutputs] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const risk = RISK_CONFIG[action.risk_level] || RISK_CONFIG.medium;
    const typeLabel = ACTION_TYPE_LABEL[action.action_type] || action.action_type;
    const commands = Array.isArray(action.commands) ? action.commands : [];

    const handleApprove = async () => {
        setLoading(true);
        try {
            const res = await api.post(`/actions/${action.id}/approve`);
            setOutputs(res.data.outputs);
            setStatus('executed');
            onResult?.({ status: 'executed', outputs: res.data.outputs });
        } catch (e) {
            setError(e.response?.data?.error || e.message);
            setStatus('failed');
        } finally {
            setLoading(false);
        }
    };

    const handleReject = async () => {
        setLoading(true);
        try {
            await api.post(`/actions/${action.id}/reject`);
            setStatus('rejected');
            onResult?.({ status: 'rejected' });
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            border: `1px solid ${risk.color}40`,
            borderRadius: '12px',
            background: 'rgba(10,10,20,0.6)',
            backdropFilter: 'blur(8px)',
            marginTop: '8px',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                background: risk.bg,
                borderBottom: `1px solid ${risk.color}30`,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
            }}>
                <AlertTriangle size={16} color={risk.color} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: risk.color, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {typeLabel} — Risco {risk.label}
                    </div>
                    <div style={{ fontSize: '14px', color: '#e2e8f0', fontWeight: 500, marginTop: '2px' }}>
                        {action.description}
                    </div>
                </div>

                {/* Status badge */}
                {status !== 'pending' && (
                    <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: '6px',
                        background: status === 'executed' ? 'rgba(34,197,94,0.2)' :
                            status === 'rejected' ? 'rgba(100,116,139,0.2)' :
                                status === 'failed' ? 'rgba(239,68,68,0.2)' : 'rgba(249,115,22,0.2)',
                        color: status === 'executed' ? '#22c55e' :
                            status === 'rejected' ? '#94a3b8' :
                                status === 'failed' ? '#ef4444' : '#f97316',
                    }}>
                        {status === 'executed' ? '✅ Executado' :
                            status === 'rejected' ? '⛔ Rejeitado' :
                                status === 'failed' ? '❌ Falhou' :
                                    status === 'executing' ? '⚙️ Executando...' : status}
                    </div>
                )}
            </div>

            {/* Commands section */}
            <div style={{ padding: '12px 16px' }}>
                <button
                    onClick={() => setExpanded(!expanded)}
                    style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        fontSize: '12px', color: '#94a3b8', marginBottom: expanded ? '8px' : 0,
                    }}
                >
                    <Terminal size={13} />
                    {commands.length} comando{commands.length !== 1 ? 's' : ''}
                    {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {expanded && (
                    <div style={{
                        background: '#0d1117', borderRadius: '8px',
                        padding: '10px 12px', marginBottom: '12px',
                        fontFamily: 'monospace', fontSize: '12px', color: '#7dd3fc',
                    }}>
                        {commands.map((cmd, i) => (
                            <div key={i} style={{ marginBottom: i < commands.length - 1 ? '4px' : 0 }}>
                                <span style={{ color: '#475569' }}>$ </span>{cmd}
                            </div>
                        ))}
                    </div>
                )}

                {/* Output after execution */}
                {outputs && (
                    <div style={{
                        background: '#0d1117', borderRadius: '8px',
                        padding: '10px 12px', marginBottom: '12px',
                        fontFamily: 'monospace', fontSize: '12px', color: '#86efac',
                        maxHeight: '200px', overflowY: 'auto',
                    }}>
                        {outputs.map((o, i) => (
                            <div key={i} style={{ marginBottom: '8px' }}>
                                <span style={{ color: '#475569' }}>$ {o.command}</span>
                                <div style={{ color: '#86efac', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
                                    {o.output}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)', borderRadius: '8px',
                        padding: '8px 12px', marginBottom: '12px',
                        fontSize: '12px', color: '#fca5a5',
                    }}>
                        ❌ {error}
                    </div>
                )}

                {/* Action buttons */}
                {status === 'pending' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={handleApprove}
                            disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '8px 16px', borderRadius: '8px', border: 'none',
                                background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                                fontWeight: 600, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.6 : 1,
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => !loading && (e.target.style.background = 'rgba(34,197,94,0.25)')}
                            onMouseLeave={e => !loading && (e.target.style.background = 'rgba(34,197,94,0.15)')}
                        >
                            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                            Aprovar e Executar
                        </button>

                        <button
                            onClick={handleReject}
                            disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(100,116,139,0.3)',
                                background: 'transparent', color: '#94a3b8',
                                fontWeight: 600, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.6 : 1,
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => !loading && (e.target.style.color = '#e2e8f0')}
                            onMouseLeave={e => !loading && (e.target.style.color = '#94a3b8')}
                        >
                            <X size={14} />
                            Rejeitar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
