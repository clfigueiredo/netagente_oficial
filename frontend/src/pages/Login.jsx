import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wifi, Eye, EyeOff, Loader2 } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'

export default function Login() {
    const navigate = useNavigate()
    const { login } = useAuthStore()

    const [form, setForm] = useState({ email: '', password: '' })
    const [showPass, setShowPass] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const { data } = await api.post('/auth/login', {
                email: form.email,
                password: form.password,
            })
            login(data.token, data.user, data.tenantSlug || null)
            navigate('/')
        } catch (err) {
            setError(err.response?.data?.error || 'Credenciais inválidas')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
            {/* Background glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-sm animate-fade-in">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4 glow-blue">
                        <Wifi size={24} className="text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold text-text font-mono">NetAgent</h1>
                    <p className="text-text-muted text-sm mt-1">Gestão de rede com IA</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-bg-surface border border-border rounded-2xl p-6 space-y-4">
                    <div>
                        <label className="text-xs text-text-muted mb-1.5 block font-medium">E-mail</label>
                        <input
                            type="email"
                            required
                            placeholder="seu@email.com"
                            value={form.email}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-primary transition-colors outline-none"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-text-muted mb-1.5 block font-medium">Senha</label>
                        <div className="relative">
                            <input
                                type={showPass ? 'text' : 'password'}
                                required
                                placeholder="••••••••"
                                value={form.password}
                                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-text placeholder:text-text-muted focus:border-primary transition-colors outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(s => !s)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors cursor-pointer"
                            >
                                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                        {loading && <Loader2 size={15} className="animate-spin" />}
                        {loading ? 'Entrando...' : 'Entrar'}
                    </button>
                </form>
            </div>
        </div>
    )
}
