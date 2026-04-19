import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Download, Trash2, FolderOpen, ShieldCheck, Settings, Link as LinkIcon, X, Server, CheckCircle, Copy, Terminal, Unlink } from 'lucide-react'
import api from '../lib/api'
import { SkeletonRow } from '../components/ui/Skeleton'

const API_BASE_URL = import.meta.env.VITE_API_URL

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export default function Backups() {
    const queryClient = useQueryClient()
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)
    const [ftpPort, setFtpPort] = useState('')
    const [ftpPass, setFtpPass] = useState('')
    const [selectedDevice, setSelectedDevice] = useState('')
    const [linkSuccessInfo, setLinkSuccessInfo] = useState(null)

    const { data: backups, isLoading } = useQuery({
        queryKey: ['backups'],
        queryFn: () => api.get('/backups').then(r => r.data),
    })

    const { data: linkedDevices, isLoading: isLinkedLoading } = useQuery({
        queryKey: ['linked-devices'],
        queryFn: () => api.get('/backups/linked').then(r => r.data),
    })

    const { data: ftpSettings } = useQuery({
        queryKey: ['ftp-settings'],
        queryFn: () => api.get('/backups/settings').then(r => r.data),
    })

    const { data: devicesData } = useQuery({
        queryKey: ['devices'],
        queryFn: () => api.get('/devices').then(r => r.data),
    })

    const devices = Array.isArray(devicesData) ? devicesData : (devicesData?.devices ?? [])

    const deleteMutation = useMutation({
        mutationFn: ({ deviceId, filename }) => api.delete(`/backups/${deviceId}/${filename}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] })
    })

    const settingsMutation = useMutation({
        mutationFn: (data) => api.put('/backups/settings', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ftp-settings'] })
            setIsSettingsOpen(false)
            alert('Configurações salvas e servidor FTP reiniciado!')
        },
        onError: (err) => alert(err.response?.data?.error || 'Erro ao salvar configurações')
    })

    const folderMutation = useMutation({
        mutationFn: (deviceId) => api.post(`/backups/folders/${deviceId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['linked-devices'] })
            const device = devices.find(d => String(d.id) === String(selectedDevice))
            setLinkSuccessInfo(device)
            setIsLinkOpen(false)
        },
        onError: (err) => alert(err.response?.data?.error || 'Erro ao criar pasta')
    })

    const unlinkFolderMutation = useMutation({
        mutationFn: (deviceId) => api.delete(`/backups/folders/${deviceId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['linked-devices'] })
            queryClient.invalidateQueries({ queryKey: ['backups'] })
            alert('A pasta do FTP e os backups deste dispositivo foram apagados com sucesso!')
        },
        onError: (err) => alert(err.response?.data?.error || 'Erro ao desvincular dispositivo')
    })

    const handleDownload = (deviceId, filename) => {
        api.get(`/backups/download/${deviceId}/${filename}`, { responseType: 'blob' })
            .then((response) => {
                const href = URL.createObjectURL(response.data);
                const a = Object.assign(document.createElement('a'), {
                    href,
                    style: 'display:none',
                    download: filename
                });
                document.body.appendChild(a);
                a.click();
                URL.revokeObjectURL(href);
                a.remove();
            })
            .catch(err => {
                console.error("Failed to download", err)
                alert("Erro ao baixar o backup.")
            })
    }

    const handleDelete = (deviceId, filename) => {
        if (window.confirm(`Tem certeza que deseja apagar permanentemente o backup '${filename}' ?`)) {
            deleteMutation.mutate({ deviceId, filename })
        }
    }

    const handleSaveSettings = (e) => {
        e.preventDefault()
        settingsMutation.mutate({ port: ftpPort, password: ftpPass })
    }

    const handleLinkDevice = (e) => {
        e.preventDefault()
        if (selectedDevice) {
            folderMutation.mutate(selectedDevice)
        }
    }

    const openSettings = () => {
        if (ftpSettings) {
            setFtpPort(ftpSettings.port)
            setFtpPass(ftpSettings.password)
        }
        setIsSettingsOpen(true)
    }

    return (
        <div className="space-y-6 animate-fade-in max-w-5xl pb-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl font-bold text-text font-mono flex items-center gap-2">
                        <HardDrive size={20} className="text-primary" />
                        Backups (FTP)
                    </h1>
                    <p className="text-sm text-text-muted mt-1 leading-relaxed">
                        Arquivos enviados para o repositório seguro. URL base para os roteadores:<br />
                        <code className="bg-bg-elevated px-1.5 py-0.5 rounded font-mono text-xs text-primary mt-1 inline-block">
                            ftp://{ftpSettings?.user || 'backup_user'}:{ftpSettings?.password || '***'}@{window.location.hostname}:{ftpSettings?.port || '2121'}
                        </code>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsLinkOpen(true)}
                        className="px-3 py-1.5 bg-bg-surface border border-border rounded-lg text-sm text-text font-medium hover:bg-bg-elevated transition-colors flex items-center gap-2"
                    >
                        <LinkIcon size={14} className="text-emerald-500" />
                        Vincular Dispositivo (Criar Pasta)
                    </button>
                    <button
                        onClick={openSettings}
                        className="px-3 py-1.5 bg-bg-surface border border-border rounded-lg text-sm text-text font-medium hover:bg-bg-elevated transition-colors flex items-center gap-2"
                    >
                        <Settings size={14} className="text-text-muted" />
                        Configurar FTP
                    </button>
                </div>
            </div>

            {/* Dispositivos Vinculados */}
            <div className="bg-bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-bg-surface flex items-center gap-2">
                    <Server size={16} className="text-emerald-500" />
                    <h3 className="text-sm font-semibold text-text font-mono">Dispositivos Vinculados (Prontos)</h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {isLinkedLoading ? (
                        Array(3).fill(0).map((_, i) => <div key={i}><SkeletonRow /></div>)
                    ) : linkedDevices?.length === 0 ? (
                        <div className="col-span-full py-6 text-center text-text-muted text-sm font-mono opacity-60">
                            Nenhum dispositivo vinculado ainda.
                        </div>
                    ) : (
                        linkedDevices?.map(d => (
                            <div key={d.id} className="border border-border rounded-lg p-3 bg-bg-elevated flex flex-col gap-1 relative group">
                                <span className="text-sm font-medium text-text truncate pr-6" title={d.name}>{d.name}</span>
                                <span className="text-xs text-text-muted font-mono">{d.host}</span>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 mt-2">
                                    {d.type === 'mikrotik' && (
                                        <button
                                            onClick={() => setLinkSuccessInfo(d)}
                                            className="text-[11px] font-medium text-primary hover:text-primary-hover flex items-center gap-1 w-fit transition-colors"
                                        >
                                            <Terminal size={12} /> Ver Script
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (window.confirm(`Tem certeza que deseja desvincular o dispositivo '${d.name}'?\nIsso apagará a pasta do FTP e TODOS os backups permanentemente.`)) {
                                                unlinkFolderMutation.mutate(d.id)
                                            }
                                        }}
                                        disabled={unlinkFolderMutation.isPending}
                                        className="text-[11px] font-medium text-danger hover:text-danger/80 disabled:opacity-50 flex items-center gap-1 w-fit transition-colors"
                                    >
                                        <Unlink size={12} /> Desvincular e Apagar
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="bg-bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-bg-surface flex items-center gap-2">
                    <FolderOpen size={16} className="text-primary" />
                    <h3 className="text-sm font-semibold text-text font-mono">Arquivos em /var/backups</h3>
                </div>

                <div className="divide-y divide-border">
                    {isLoading ? (
                        Array(5).fill(0).map((_, i) => <div className="p-4" key={i}><SkeletonRow /></div>)
                    ) : backups?.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center">
                            <ShieldCheck size={40} className="text-text-muted mb-4 opacity-50" />
                            <p className="text-sm text-text-muted font-mono">Nenhum backup encontrado no servidor.</p>
                            <p className="text-xs text-text-muted mt-1">Vincule um dispositivo primeiro e configure sua RB para enviar.</p>
                        </div>
                    ) : (
                        backups?.map((b) => (
                            <div key={b.id} className="flex items-center justify-between p-4 hover:bg-bg-elevated/50 transition-colors group">
                                <div>
                                    <h4 className="text-sm font-medium text-text font-mono break-all">{b.filename}</h4>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                                        <span className="font-medium text-emerald-500">{b.deviceName}</span>
                                        <span>•</span>
                                        <span>{new Date(b.createdAt).toLocaleString()}</span>
                                        <span>•</span>
                                        <span>{formatBytes(b.sizeBytes)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => handleDownload(b.deviceId, b.filename)}
                                        className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                                        title="Baixar Backup"
                                    >
                                        <Download size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(b.deviceId, b.filename)}
                                        className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                                        title="Excluir Backup"
                                        disabled={deleteMutation.isPending}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Modal de Configurações */}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-bg-surface border border-border rounded-xl shadow-xl w-full max-w-md animate-scale-in">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <h2 className="text-base font-semibold text-text font-mono flex items-center gap-2">
                                <Settings size={16} className="text-primary" />
                                Configurações FTP
                            </h2>
                            <button onClick={() => setIsSettingsOpen(false)} className="text-text-muted hover:text-text">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveSettings} className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Usuário</label>
                                <input type="text" value={ftpSettings?.user || 'backup_user'} disabled className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-muted cursor-not-allowed font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Senha do Usuário</label>
                                <input
                                    type="text"
                                    value={ftpPass}
                                    onChange={(e) => setFtpPass(e.target.value)}
                                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none transition-colors font-mono"
                                    placeholder="Senha segura..."
                                    required
                                />
                                <p className="text-[11px] text-text-muted mt-1">Ao salvar, a senha será alterada no sistema operacional local.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Porta de Escuta</label>
                                <input
                                    type="number"
                                    value={ftpPort}
                                    onChange={(e) => setFtpPort(e.target.value)}
                                    className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none transition-colors font-mono"
                                    min="1024" max="65535"
                                    required
                                />
                                <p className="text-[11px] text-text-muted mt-1">O serviço vsftpd será reiniciado automaticamente.</p>
                            </div>

                            <div className="pt-4 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-sm font-medium text-text-muted hover:bg-bg-elevated rounded-lg transition-colors">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={settingsMutation.isPending} className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                                    {settingsMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Vincular Dispositivo */}
            {isLinkOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-bg-surface border border-border rounded-xl shadow-xl w-full max-w-lg animate-scale-in">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <h2 className="text-base font-semibold text-text font-mono flex items-center gap-2">
                                <LinkIcon size={16} className="text-emerald-500" />
                                Vincular Dispositivo ao FTP
                            </h2>
                            <button onClick={() => setIsLinkOpen(false)} className="text-text-muted hover:text-text">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleLinkDevice} className="p-5 space-y-4">
                            <p className="text-sm text-text-muted">
                                Isso criará a pasta raiz do dispositivo no servidor local de forma isolada (<code className="text-xs">/var/backups/netagent/ID</code>).
                            </p>
                            <div>
                                <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Selecione o Dispositivo</label>
                                <div className="relative">
                                    <Server size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                    <select
                                        value={selectedDevice}
                                        onChange={(e) => setSelectedDevice(e.target.value)}
                                        className="w-full bg-bg-elevated border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text focus:border-primary outline-none transition-colors appearance-none"
                                        required
                                    >
                                        <option value="" disabled>-- Escolha um Roteador / Servidor --</option>
                                        {devices.map(d => (
                                            <option key={d.id} value={d.id}>{d.name} ({d.host})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsLinkOpen(false)} className="px-4 py-2 text-sm font-medium text-text-muted hover:bg-bg-elevated rounded-lg transition-colors">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={folderMutation.isPending || !selectedDevice} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    {folderMutation.isPending ? 'Criando Pasta...' : 'Criar Pasta e Vincular'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Sucesso / Script */}
            {linkSuccessInfo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-bg-surface border border-border rounded-xl shadow-xl w-full max-w-3xl animate-scale-in flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <h2 className="text-base font-semibold text-emerald-500 font-mono flex items-center gap-2">
                                <CheckCircle size={18} />
                                Script de Backup para {linkSuccessInfo.name}
                            </h2>
                            <button onClick={() => setLinkSuccessInfo(null)} className="text-text-muted hover:text-text">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto space-y-4">
                            <p className="text-sm text-text-muted">
                                A pasta <code className="bg-bg-elevated border border-border px-1.5 py-0.5 rounded text-primary">/var/backups/netagent/{linkSuccessInfo.id}</code> foi criada no servidor.
                                Abaixo está o script MikroTik pronto para automatizar o envio de backups deste roteador.
                            </p>

                            <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden flex flex-col">
                                <div className="flex justify-between items-center px-4 py-2 bg-white/5 border-b border-border">
                                    <span className="text-xs font-mono text-text-muted flex items-center gap-2"><Terminal size={12} /> Mikrotik Terminal - Script</span>
                                    <button
                                        onClick={() => {
                                            const script = `/system script add name="Backup_NetAgent" source="\\r\\n  :local filename (\\"backup_\\" . [/system clock get date] . \\".rsc\\");\\r\\n  :set filename ([:pick \\$filename 0 11] . [:pick \\$filename 12 14] . \\".rsc\\");\\r\\n  /export file=\\$filename;\\r\\n  /delay 2s;\\r\\n  /tool fetch address=\\"${window.location.hostname}\\" port=${ftpSettings?.port || 2121} user=\\"${ftpSettings?.user || 'backup_user'}\\" password=\\"${ftpSettings?.password || '888'}\\" src-path=\\$filename dst-path=\\"/${linkSuccessInfo.id}/\\$filename\\" mode=ftp upload=yes;\\r\\n  /file remove \\$filename;\\r\\n"`;
                                            navigator.clipboard.writeText(script);
                                            alert("Script copiado para a área de transferência!");
                                        }}
                                        className="text-xs flex items-center gap-1 text-text-muted hover:text-primary transition-colors"
                                    >
                                        <Copy size={12} /> Copiar Código
                                    </button>
                                </div>
                                <pre className="p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9] whitespace-pre">
                                    <span className="text-[#ff7b72]">/system script add</span> name=<span className="text-[#a5d6ff]">"Backup_NetAgent"</span> source=<span className="text-[#a5d6ff]">"</span>
                                    <span className="text-[#a5d6ff]">  :local filename (\"backup_\" . [/system clock get date] . \".rsc\");</span>
                                    <span className="text-[#a5d6ff]">  :set filename ([:pick \$filename 0 11] . [:pick \$filename 12 14] . \".rsc\");</span>
                                    <span className="text-[#a5d6ff]">  /export file=\$filename;</span>
                                    <span className="text-[#a5d6ff]">  /delay 2s;</span>
                                    <span className="text-[#a5d6ff]">  /tool fetch address=\"{window.location.hostname}\" port={ftpSettings?.port || 2121} user=\"{ftpSettings?.user || 'backup_user'}\" password=\"{ftpSettings?.password || '888'}\" src-path=\$filename dst-path=\"/{linkSuccessInfo.id}/\$filename\" mode=ftp upload=yes;</span>
                                    <span className="text-[#a5d6ff]">  /file remove \$filename;</span>
                                    <span className="text-[#a5d6ff]">"</span>
                                </pre>
                            </div>

                            <p className="text-sm text-text-muted mt-4">
                                Depois de adicionar o script, você deve criar um agendamento (`/system scheduler`) para rodá-lo periodicamente (ex: todos os dias às 02:00):
                            </p>
                            <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden flex flex-col">
                                <div className="flex justify-between items-center px-4 py-2 bg-white/5 border-b border-border">
                                    <span className="text-xs font-mono text-text-muted flex items-center gap-2"><Terminal size={12} /> Mikrotik Terminal - Agendamento</span>
                                    <button
                                        onClick={() => {
                                            const sched = `/system scheduler add interval=1d name="Run_Backup_NetAgent" on-event="Backup_NetAgent" start-time=02:00:00`;
                                            navigator.clipboard.writeText(sched);
                                            alert("Agendamento copiado para a área de transferência!");
                                        }}
                                        className="text-xs flex items-center gap-1 text-text-muted hover:text-primary transition-colors"
                                    >
                                        <Copy size={12} /> Copiar Código
                                    </button>
                                </div>
                                <pre className="p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9] whitespace-pre">
                                    <span className="text-[#ff7b72]">/system scheduler add</span> interval=1d name=<span className="text-[#a5d6ff]">"Run_Backup_NetAgent"</span> on-event=<span className="text-[#a5d6ff]">"Backup_NetAgent"</span> start-time=02:00:00
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
