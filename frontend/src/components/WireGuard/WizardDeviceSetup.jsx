import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Server, CheckCircle, ChevronRight, Terminal, Network, Copy, Check, Download } from 'lucide-react';
import api from '../../lib/api';

const WizardDeviceSetup = ({ onClose, onComplete, initialOsType = 'mikrotik', initialStep = 1 }) => {
    const queryClient = useQueryClient();
    const [step, setStep] = useState(initialStep);
    const [osType, setOsType] = useState(initialOsType);
    const [deviceName, setDeviceName] = useState('');
    const [deviceId, setDeviceId] = useState('');
    const [configData, setConfigData] = useState(null);
    const [copied, setCopied] = useState(false);

    const { data: devices = [] } = useQuery({
        queryKey: ['devices'],
        queryFn: () => api.get('/devices').then(r => r.data),
    });

    const setupMutation = useMutation({
        mutationFn: (data) => api.post('/wg_server/peers', data).then(r => r.data),
        onSuccess: (data) => {
            setConfigData(data);
            setStep(3);
            queryClient.invalidateQueries({ queryKey: ['wg-server-status'] });
        },
        onError: (err) => {
            alert(err.response?.data?.error || 'Erro ao gerar configuração VPN');
        },
    });

    const handleNext = () => {
        if (step === 1) {
            setStep(2);
        } else if (step === 2) {
            if (!deviceName) return alert('Por favor, defina um nome.');
            setupMutation.mutate({ name: deviceName, deviceId: deviceId || null, osType });
        }
    };

    const getScriptText = () => {
        if (!configData) return '';
        const { peer, server } = configData;
        const [endpointHost, endpointPort] = server.endpoint.split(':');

        if (osType === 'mikrotik') {
            return [
                `/interface wireguard add listen-port=13231 mtu=1420 name="wg-netagent" private-key="${peer.private_key}"`,
                `/interface wireguard peers add allowed-address=${server.server_ip}/24 endpoint-address=${endpointHost} endpoint-port=${endpointPort} interface="wg-netagent" public-key="${server.public_key}" persistent-keepalive=25`,
                `/ip address add address=${peer.ip_address}/24 interface="wg-netagent" network=${peer.ip_address.replace(/\.\d+$/, '.0')}`,
            ].join('\n');
        }

        // Linux: script bash auto-executável e idempotente.
        const serverSubnet = `${server.server_ip.replace(/\.\d+$/, '.0')}/24`;
        return `#!/usr/bin/env bash
# NetAgent WireGuard — instala e ativa o peer "${deviceName}"
# Gerado em ${new Date().toISOString()}
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Rode como root: sudo bash $0"
    exit 1
fi

IFACE="wg-netagent"

echo "[1/4] Instalando wireguard-tools..."
if ! command -v wg-quick >/dev/null 2>&1; then
    if   command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y wireguard-tools iproute2
    elif command -v dnf     >/dev/null; then dnf install -y wireguard-tools
    elif command -v yum     >/dev/null; then yum install -y epel-release && yum install -y wireguard-tools
    elif command -v apk     >/dev/null; then apk add wireguard-tools iproute2
    else echo "Gerenciador de pacotes desconhecido. Instale wireguard-tools manualmente e reexecute."; exit 1
    fi
fi

echo "[2/4] Gravando /etc/wireguard/\${IFACE}.conf..."
install -d -m 700 /etc/wireguard
umask 077
cat > /etc/wireguard/\${IFACE}.conf <<'EOF'
[Interface]
PrivateKey = ${peer.private_key}
Address    = ${peer.ip_address}/24

[Peer]
PublicKey           = ${server.public_key}
Endpoint            = ${server.endpoint}
AllowedIPs          = ${serverSubnet}
PersistentKeepalive = 25
EOF
chmod 600 /etc/wireguard/\${IFACE}.conf

echo "[3/4] Ativando e habilitando no boot..."
if systemctl is-active --quiet wg-quick@\${IFACE}; then
    systemctl restart wg-quick@\${IFACE}
else
    systemctl enable --now wg-quick@\${IFACE}
fi

echo "[4/4] Verificando..."
sleep 2
if wg show \${IFACE} >/dev/null 2>&1; then
    echo
    echo "✅ Túnel ativo."
    echo "   IP local: ${peer.ip_address}"
    echo "   Servidor: ${server.server_ip}"
    echo
    echo "Teste: ping -c2 ${server.server_ip}"
else
    echo "❌ Falha ao subir o túnel. Logs:"
    journalctl -u wg-quick@\${IFACE} --no-pager -n 30 || true
    exit 1
fi
`;
    };

    const scriptFilename = () =>
        osType === 'mikrotik'
            ? `wg-${(deviceName || 'peer').replace(/[^a-zA-Z0-9_-]/g, '_')}.rsc`
            : `install-wg-${(deviceName || 'peer').replace(/[^a-zA-Z0-9_-]/g, '_')}.sh`;

    const handleCopy = () => {
        navigator.clipboard.writeText(getScriptText()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleDownload = () => {
        const blob = new Blob([getScriptText()], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scriptFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <Network className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Adicionar Peer VPN</h2>
                            <p className="text-xs text-text-muted">Conectar dispositivo ao concentrador WireGuard</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress */}
                <div className="px-6 pt-6">
                    <div className="flex items-center justify-between relative">
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full z-0"></div>
                        <div className={'absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full z-0 transition-all duration-300 ' + (step === 1 ? 'w-0' : step === 2 ? 'w-1/2' : 'w-full')}></div>
                        {[{ n: 1, label: 'Plataforma' }, { n: 2, label: 'Identificação' }, { n: 3, label: 'Instalação' }].map(s => (
                            <div key={s.n} className={`relative z-10 flex flex-col items-center gap-2 ${step >= s.n ? 'text-primary' : 'text-gray-400'}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= s.n ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>{s.n}</div>
                                <span className="text-xs font-medium">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {step === 1 && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 text-center mb-6">Que tipo de dispositivo vai conectar?</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {[
                                    { id: 'mikrotik', label: 'MikroTik (RouterOS)', desc: 'Gera comandos RouterOS', icon: Server },
                                    { id: 'linux', label: 'Servidor Linux', desc: 'Gera conf para wg-quick', icon: Terminal },
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => setOsType(opt.id)}
                                        className={`p-6 rounded-xl border-2 flex flex-col items-center gap-4 transition-all relative ${osType === opt.id
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border bg-bg-elevated hover:border-primary/50'
                                            }`}
                                    >
                                        <opt.icon className={`w-12 h-12 ${osType === opt.id ? 'text-primary' : 'text-gray-400'}`} />
                                        <div className="text-center">
                                            <div className="font-bold text-gray-900 dark:text-white">{opt.label}</div>
                                            <div className="text-xs text-text-muted mt-1">{opt.desc}</div>
                                        </div>
                                        {osType === opt.id && <CheckCircle className="w-5 h-5 text-primary absolute top-3 right-3" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Detalhes da Conexão</h3>
                            <p className="text-sm text-text-muted mb-6">Dê um nome para identificar e o sistema cuidará das chaves e IP automaticamente.</p>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome de Identificação *</label>
                                    <input
                                        type="text"
                                        className="input w-full"
                                        placeholder={osType === 'mikrotik' ? 'Ex: Matriz - RB4011' : 'Ex: Servidor Zabbix'}
                                        value={deviceName}
                                        onChange={e => setDeviceName(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vincular a Dispositivo (Opcional)</label>
                                    <select className="input w-full" value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                                        <option value="">— Não vincular —</option>
                                        {devices.filter(d => osType === 'mikrotik' ? d.type === 'mikrotik' : d.type === 'linux').map(d => (
                                            <option key={d.id} value={d.id}>{d.name} ({d.host})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && configData && (
                        <div className="space-y-4">
                            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg flex gap-3">
                                <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />
                                <div>
                                    <h4 className="font-bold text-green-600 dark:text-green-400">Túnel Preparado!</h4>
                                    <p className="text-sm text-green-600/80 dark:text-green-400/80 mt-1">
                                        IP <strong className="font-mono">{configData.peer.ip_address}</strong> reservado.
                                        O servidor responde em <strong className="font-mono">{configData.server.server_ip}</strong>.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                        {osType === 'mikrotik' ? 'Comandos RouterOS (MikroTik)' : 'Script de instalação Linux'}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleDownload}
                                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text hover:bg-bg-muted transition-colors"
                                            title={`Baixar ${scriptFilename()}`}
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            Baixar .{osType === 'mikrotik' ? 'rsc' : 'sh'}
                                        </button>
                                        <button
                                            onClick={handleCopy}
                                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                        >
                                            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                            {copied ? 'Copiado!' : 'Copiar'}
                                        </button>
                                    </div>
                                </div>
                                {osType === 'linux' && (
                                    <p className="text-xs text-text-muted mb-2">
                                        Salve como <code className="bg-black/30 px-1 rounded">{scriptFilename()}</code> no servidor Linux e rode <code className="bg-black/30 px-1 rounded">sudo bash {scriptFilename()}</code>. Ele instala wireguard-tools, grava o conf e sobe o serviço no boot.
                                    </p>
                                )}
                                <pre className="p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9] bg-[#0d1117] rounded-lg border border-border select-all whitespace-pre-wrap">
                                    {getScriptText()}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between">
                    {step < 3 ? (
                        <>
                            <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
                            <button
                                onClick={handleNext}
                                disabled={setupMutation.isPending}
                                className="btn btn-primary flex items-center gap-2"
                            >
                                {setupMutation.isPending ? 'Gerando...' : 'Avançar'} <ChevronRight className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <div className="w-full flex justify-end">
                            <button onClick={() => { onComplete(); onClose(); }} className="btn btn-primary">
                                Concluído
                            </button>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default WizardDeviceSetup;
