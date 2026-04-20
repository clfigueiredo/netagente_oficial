import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import Chat from './pages/Chat'
import Conversations from './pages/Conversations'
import PendingActions from './pages/PendingActions'
import Settings from './pages/Settings'
import Admin from './pages/Admin'
import Skills from './pages/Skills'
import Automations from './pages/Automations'
import Backups from './pages/Backups'
import KnowledgeBase from './pages/KnowledgeBase'
import WireGuard from './pages/WireGuard'
import DocsMikrotik from './pages/DocsMikrotik'
import DocsLinux from './pages/DocsLinux'
import DocsMonitor from './pages/DocsMonitor'
import DocsAutomations from './pages/DocsAutomations'
import DocsBackups from './pages/DocsBackups'
import DocsWireguard from './pages/DocsWireguard'
import DocsDeploy from './pages/DocsDeploy'
import DocsMemory from './pages/DocsMemory'

function ProtectedRoute({ children, requireSuperAdmin = false }) {
    const { token, user } = useAuthStore()
    if (!token) return <Navigate to="/login" replace />
    if (requireSuperAdmin && !user?.isSuperAdmin) return <Navigate to="/" replace />
    return children
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={
                    <ProtectedRoute><Layout /></ProtectedRoute>
                }>
                    <Route index element={<Dashboard />} />
                    <Route path="devices" element={<Devices />} />
                    <Route path="chat" element={<Chat />} />
                    <Route path="conversations" element={<Conversations />} />
                    <Route path="pending" element={<PendingActions />} />
                    <Route path="skills" element={<Skills />} />
                    <Route path="automations" element={<Automations />} />
                    <Route path="backups" element={<Backups />} />
                    <Route path="knowledge" element={<KnowledgeBase />} />
                    <Route path="wireguard" element={<WireGuard />} />
                    <Route path="docs">
                        <Route path="mikrotik" element={<DocsMikrotik />} />
                        <Route path="linux" element={<DocsLinux />} />
                        <Route path="monitor" element={<DocsMonitor />} />
                        <Route path="automations" element={<DocsAutomations />} />
                        <Route path="backups" element={<DocsBackups />} />
                        <Route path="wireguard" element={<DocsWireguard />} />
                        <Route path="deploy" element={<DocsDeploy />} />
                        <Route path="memory" element={<DocsMemory />} />
                    </Route>
                    <Route path="settings" element={<Settings />} />
                    <Route path="admin" element={
                        <ProtectedRoute requireSuperAdmin><Admin /></ProtectedRoute>
                    } />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    )
}
