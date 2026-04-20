import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
    LayoutDashboard, Server, MessageSquare, History,
    Clock, Settings, ShieldCheck, LogOut, Wifi, Zap, BookOpen, ChevronDown, ChevronRight, Layers, Activity, Cpu, HardDrive, Network, Box, Brain
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { disconnectSocket } from '../../lib/socket'
import clsx from 'clsx'

const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/devices', icon: Server, label: 'Dispositivos' },
    { to: '/chat', icon: MessageSquare, label: 'Chat LLM' },
    { to: '/conversations', icon: History, label: 'Histórico' },
    { to: '/automations', icon: Zap, label: 'Automações' },
    { to: '/backups', icon: HardDrive, label: 'Backups FTP' },
    { to: '/knowledge', icon: Brain, label: 'Base de Conhecimento' },
    { to: '/wireguard', icon: Network, label: 'VPN WireGuard' },
    { to: '/pending', icon: Clock, label: 'Aprovações' },
    { to: '/settings', icon: Settings, label: 'Configurações' },
]

export default function Sidebar() {
    const { user, logout } = useAuthStore()
    const navigate = useNavigate()
    const [docsOpen, setDocsOpen] = useState(false)

    const handleLogout = () => {
        disconnectSocket()
        logout()
        navigate('/login')
    }

    return (
        <aside className="w-64 flex-shrink-0 bg-bg-surface border-r border-border flex flex-col">
            {/* Logo */}
            <div className="h-16 flex items-center gap-3 px-5 border-b border-border">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center glow-blue">
                    <Wifi size={16} className="text-white" strokeWidth={2.5} />
                </div>
                <span className="font-mono font-bold text-lg text-text tracking-tight">NetAgent</span>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
                {navItems.map(({ to, icon: Icon, label, exact }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={exact}
                        className={({ isActive }) =>
                            clsx(
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-150',
                                isActive
                                    ? 'bg-primary/10 text-primary border border-primary/20'
                                    : 'text-text-muted hover:text-text hover:bg-bg-elevated'
                            )
                        }
                    >
                        <Icon size={17} strokeWidth={1.8} />
                        {label}
                    </NavLink>
                ))}

                {/* Super admin link */}
                {user?.isSuperAdmin && (
                    <div className="mt-6 pt-4 border-t border-border">
                        <NavLink
                            to="/admin"
                            className={({ isActive }) =>
                                clsx(
                                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-150',
                                    isActive
                                        ? 'bg-accent/10 text-accent border border-accent/20'
                                        : 'text-text-muted hover:text-text hover:bg-bg-elevated'
                                )
                            }
                        >
                            <ShieldCheck size={17} strokeWidth={1.8} />
                            Admin
                        </NavLink>
                    </div>
                )}

                {/* Documentação */}
                <div className="mt-6">
                    <button
                        onClick={() => setDocsOpen(!docsOpen)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-muted uppercase tracking-wider hover:text-text transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <BookOpen size={14} />
                            <span>Documentação</span>
                        </div>
                        {docsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {docsOpen && (
                        <div className="mt-1 space-y-0.5 border-l-2 border-border/50 ml-4 pl-2">
                            <NavLink
                                to="/docs/mikrotik"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-primary bg-primary/5" : "text-text-muted hover:text-text")}
                            >
                                <Layers size={14} /> Mikrotik
                            </NavLink>
                            <NavLink
                                to="/docs/linux"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-emerald-500 bg-emerald-500/5" : "text-text-muted hover:text-text")}
                            >
                                <Cpu size={14} /> Linux
                            </NavLink>
                            <NavLink
                                to="/docs/monitor"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-pink-500 bg-pink-500/5" : "text-text-muted hover:text-text")}
                            >
                                <Activity size={14} /> Monitoramento
                            </NavLink>
                            <NavLink
                                to="/docs/automations"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-yellow-500 bg-yellow-500/5" : "text-text-muted hover:text-text")}
                            >
                                <Zap size={14} /> Automações
                            </NavLink>
                            <NavLink
                                to="/docs/backups"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-indigo-500 bg-indigo-500/5" : "text-text-muted hover:text-text")}
                            >
                                <HardDrive size={14} /> Backups FTP
                            </NavLink>
                            <NavLink
                                to="/docs/wireguard"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-cyan-500 bg-cyan-500/5" : "text-text-muted hover:text-text")}
                            >
                                <Network size={14} /> VPN WireGuard
                            </NavLink>
                            <NavLink
                                to="/docs/deploy"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-orange-500 bg-orange-500/5" : "text-text-muted hover:text-text")}
                            >
                                <Box size={14} /> Deploy & Instalação
                            </NavLink>
                            <NavLink
                                to="/docs/memory"
                                className={({ isActive }) => clsx("flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors", isActive ? "text-primary bg-primary/5" : "text-text-muted hover:text-text")}
                            >
                                <Brain size={14} /> Memória RAG
                            </NavLink>
                        </div>
                    )}
                </div>
            </nav>

            {/* User footer */}
            <div className="border-t border-border p-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-muted border border-primary/30 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary uppercase">
                            {user?.email?.[0] ?? 'U'}
                        </span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text truncate">{user?.email ?? 'Usuário'}</p>
                        <p className="text-xs text-text-muted capitalize">{user?.role ?? 'operator'}</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        title="Sair"
                        className="text-text-muted hover:text-danger transition-colors cursor-pointer p-1 rounded"
                    >
                        <LogOut size={15} />
                    </button>
                </div>
            </div>
        </aside>
    )
}
