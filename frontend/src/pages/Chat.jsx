import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { Send, Loader2, Bot, User, Plus, Wrench, Brain, AlertCircle, ChevronDown, ChevronRight, Terminal, CheckCircle2, XCircle, Clock, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { getSocket, setActiveConversation } from '../lib/socket'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'
import ActionCard from '../components/ActionCard'

/* ─── Step status icon ─── */
function StepIcon({ status }) {
    if (status === 'ok') return <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
    if (status === 'error') return <XCircle size={12} className="text-red-400 flex-shrink-0" />
    if (status === 'running') return <Loader2 size={12} className="text-accent animate-spin flex-shrink-0" />
    return <Clock size={12} className="text-yellow-400 animate-pulse flex-shrink-0" />
}

/* ─── Agent Step (tool call / reasoning) ─── */
function AgentStep({ step, index }) {
    const [expanded, setExpanded] = useState(false)
    const isRunning = step.status === 'running'
    const hasDetail = step.args || step.result
    return (
        <div className="flex gap-2 items-start text-xs">
            <div className={clsx(
                'w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5',
                isRunning ? 'bg-accent/20 border-accent/50' : 'bg-accent/15 border-accent/30'
            )}>
                {isRunning
                    ? <Loader2 size={10} className="text-accent animate-spin" />
                    : step.status === 'ok'
                        ? <CheckCircle2 size={10} className="text-emerald-400" />
                        : step.status === 'error'
                            ? <XCircle size={10} className="text-red-400" />
                            : <Wrench size={10} className="text-accent" />}
            </div>
            <div className="flex-1 min-w-0">
                <button
                    onClick={() => hasDetail && setExpanded(e => !e)}
                    className={clsx(
                        'flex items-center gap-1 transition-colors font-medium',
                        hasDetail ? 'cursor-pointer hover:text-accent-hover' : 'cursor-default',
                        step.status === 'error' ? 'text-red-400' : 'text-accent'
                    )}
                >
                    {hasDetail && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                    <span className="font-mono">{(step.tool || step.step || `Step ${index + 1}`).replace(/^[🔧⚙️🛠️]\s*/, '')}</span>
                    {isRunning && <span className="text-text-muted font-normal">executando...</span>}
                </button>
                {expanded && (
                    <div className="mt-1.5 space-y-1">
                        {step.args && (
                            <pre className="text-text-dim bg-bg-base border border-border rounded-md p-2 overflow-x-auto text-[10px] leading-tight font-mono">
                                {typeof step.args === 'string' ? step.args : JSON.stringify(step.args, null, 2)}
                            </pre>
                        )}
                        {step.result && (
                            <pre className={clsx(
                                'bg-bg-base border rounded-md p-2 overflow-x-auto text-[10px] leading-tight font-mono max-h-32',
                                step.status === 'error' ? 'border-red-500/30 text-red-300' : 'border-border text-text-muted'
                            )}>
                                {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

/* ─── Skill Terminal ─── */
function SkillTerminal({ skillName, steps }) {
    const [expanded, setExpanded] = useState({})
    if (!steps || steps.length === 0) return null

    const statusIcon = (status) => {
        if (status === 'ok') return <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
        if (status === 'error') return <XCircle size={12} className="text-red-400 flex-shrink-0" />
        return <Clock size={12} className="text-yellow-400 animate-pulse flex-shrink-0" />
    }

    return (
        <div className="rounded-xl border border-border bg-bg-base overflow-hidden text-[11px] font-mono">
            <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated border-b border-border">
                <Terminal size={11} className="text-accent" />
                <span className="text-accent font-medium">{skillName}</span>
                <span className="ml-auto text-text-dim">{steps.length} steps</span>
            </div>
            <div className="divide-y divide-border/40">
                {steps.map((s, i) => (
                    <div key={i} className="px-3 py-2">
                        <button
                            onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                            className="flex items-center gap-2 w-full text-left"
                        >
                            {statusIcon(s.status)}
                            <span className={clsx(
                                'flex-1 truncate',
                                s.status === 'ok' ? 'text-text-muted' : s.status === 'error' ? 'text-red-300' : 'text-yellow-300'
                            )}>
                                {s.description}
                            </span>
                            {s.output && (expanded[i] ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                        </button>
                        {expanded[i] && s.output && (
                            <pre className="mt-2 text-[10px] text-text-dim bg-bg-surface rounded p-2 overflow-x-auto max-h-40 leading-relaxed">
                                {s.output}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

function ChatBubble({ msg, liveSteps }) {
    const isUser = msg.role === 'user'
    // Normalise tool_calls from DB (format: {tool, args, result})
    // and reasoning (format: {step: "🔧 name", args})
    // Prefer liveSteps (real-time) if provided and DB not yet loaded
    const dbToolCalls = msg.tool_calls && msg.tool_calls.length > 0 ? msg.tool_calls : null
    const dbReasoning = msg.reasoning && msg.reasoning.length > 0 ? msg.reasoning : null
    const hasDbSteps = dbToolCalls || dbReasoning
    // Use live steps if DB hasn't loaded them yet (immediately after response)
    const toolCalls = dbToolCalls || (liveSteps && liveSteps.length > 0 ? liveSteps : null)
    const reasoning = dbReasoning
    const hasSteps = toolCalls || reasoning
    const pendingAction = msg.pending_action ?? null

    return (
        <div className={clsx('flex gap-3 max-w-3xl', isUser ? 'ml-auto flex-row-reverse' : '')}>
            <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                isUser ? 'bg-primary/20 border border-primary/30' : 'bg-bg-overlay border border-border'
            )}>
                {isUser ? <User size={13} className="text-primary" /> : <Bot size={13} className="text-text-muted" />}
            </div>
            <div className="flex flex-col gap-1.5 max-w-[80%]">
                {/* Agent steps (tool calls / reasoning) */}
                {hasSteps && !isUser && (
                    <div className="bg-bg-elevated/60 border border-border/60 rounded-xl px-3.5 py-2.5 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
                            <Brain size={11} />
                            <span>Ações do agente</span>
                        </div>
                        {(reasoning || []).map((r, i) => <AgentStep key={`r${i}`} step={r} index={i} />)}
                        {(toolCalls || []).map((tc, i) => <AgentStep key={`t${i}`} step={tc} index={i} />)}
                    </div>
                )}
                {/* Message content */}
                <div className={clsx('px-4 py-3 text-sm leading-relaxed',
                    isUser ? 'bubble-user' : 'bubble-assistant'
                )}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={clsx('text-xs mt-1.5', isUser ? 'text-primary/60 text-right' : 'text-text-muted')}>
                        {msg.created_at && format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                    </p>
                </div>
                {/* Pending Action Card (approve / reject) */}
                {!isUser && pendingAction && (
                    <ActionCard action={pendingAction} />
                )}
            </div>
        </div>
    )
}

const PHASE_LABELS = {
    loading_context: '📋 Carregando contexto...',
    routing: '🧭 Selecionando especialistas...',
    executing: '⚡ Executando ferramentas...',
    search_rag: '🔍 Buscando conhecimento...',
}

/* ─── Thinking / Working Indicator ─── */
function AgentWorking({ steps, activeSkill, phase, systemLogs }) {
    const phaseLabel = PHASE_LABELS[phase] || null
    return (
        <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-bg-overlay border border-border flex items-center justify-center animate-pulse">
                <Bot size={13} className="text-primary" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
                {/* Steps panel — appears as soon as first step arrives */}
                {steps.length > 0 && (
                    <div className="bg-bg-elevated/60 border border-accent/20 rounded-xl px-3.5 py-2.5 space-y-2 animate-fade-in">
                        <div className="flex items-center gap-1.5 text-xs text-accent font-medium">
                            <Wrench size={11} className="animate-spin" />
                            <span>{activeSkill ? 'Instalando...' : 'Executando...'}</span>
                        </div>
                        {steps.map((s, i) => <AgentStep key={s.stepId ?? i} step={s} index={i} />)}
                    </div>
                )}
                {/* Skill terminal */}
                {activeSkill && (
                    <SkillTerminal skillName={activeSkill.name} steps={activeSkill.steps} />
                )}
                {/* Always-visible thinking dots */}
                <div className="bubble-assistant px-4 py-3">
                    <div className="flex gap-1.5 items-center h-4">
                        <div className="flex gap-1">
                            {[0, 1, 2].map(i => (
                                <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                                    style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                        <span className="text-xs text-text-muted ml-1">
                            {phaseLabel || (activeSkill ? 'Executando step...' : steps.length > 0 ? 'Processando resultado...' : 'Analisando...')}
                        </span>
                    </div>
                </div>
                {/* System Terminal Logs */}
                {systemLogs?.length > 0 && (
                    <div className="bg-[#0f111a] border border-border/40 rounded-lg p-3 text-[10px] text-[#8b949e] font-mono leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-48 mt-2 shadow-inner">
                        {systemLogs.map((log, i) => (
                            <div key={i} className="mb-0.5 last:mb-0 flex gap-1.5">
                                <span className="text-[#a5d6ff] opacity-75">{'>'}</span>
                                <span>{log}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}


/* ─── Main Chat Component ─── */
export default function Chat() {
    const qc = useQueryClient()
    const [convId, setConvId] = useState(null)
    const [input, setInput] = useState('')
    const [agentState, setAgentState] = useState('idle') // idle | thinking | done
    const [agentSteps, setAgentSteps] = useState([])
    const [agentError, setAgentError] = useState(null)
    const [activeSkill, setActiveSkill] = useState(null)      // { name, steps[] }
    const [systemLogs, setSystemLogs] = useState([])          // terminal diagnostics
    const [liveMsgSteps, setLiveMsgSteps] = useState(null)    // steps to inject into last msg
    const [agentPhase, setAgentPhase] = useState(null)        // current pipeline phase
    const bottomRef = useRef(null)
    const creatingRef = useRef(false)
    const lastStepsRef = useRef([])  // capture steps before clearing

    const location = useLocation()
    // If navigating from history, use the passed conversationId directly
    const historyConvId = location.state?.conversationId ?? null
    const historyChannel = location.state?.channel ?? null

    // Create or get active web conversation (prevent double-create)
    // Skip if we already have a conversation from history
    const { data: convData } = useQuery({
        queryKey: ['active-conversation', historyConvId],
        queryFn: async () => {
            // If coming from history, fetch that specific conversation
            if (historyConvId) {
                const conv = await api.get(`/conversations/${historyConvId}`).then(r => r.data)
                return conv
            }
            // Otherwise find or create latest web conversation
            if (creatingRef.current) return null
            creatingRef.current = true
            try {
                const list = await api.get('/conversations?channel=web&limit=1').then(r => r.data)
                const conversations = Array.isArray(list) ? list : (list.conversations ?? [])
                if (conversations.length > 0) return conversations[0]
                const created = await api.post('/conversations').then(r => r.data)
                return created
            } finally {
                creatingRef.current = false
            }
        },
        staleTime: Infinity,
        retry: false,
    })

    useEffect(() => {
        if (convData?.id) {
            setConvId(convData.id)
            setActiveConversation(convData.id)  // keep socket module in sync
        }
    }, [convData])

    const { data: msgData, isLoading } = useQuery({
        queryKey: ['messages', convId],
        queryFn: () => api.get(`/messages/${convId}`).then(r => r.data),
        enabled: !!convId,
        refetchInterval: false, // rely on socket
    })

    // Socket listeners → real-time agent work
    useEffect(() => {
        const socket = getSocket()
        if (!socket || !convId) return

        const onThinking = (data) => {
            if (data.conversationId === convId) {
                setAgentState('thinking')
                setAgentSteps([])
                setSystemLogs([])
                setAgentError(null)
                setActiveSkill(null)
                setAgentPhase(null)
            }
        }
        const onPhase = (data) => {
            if (data.conversationId === convId) {
                setAgentPhase(data.phase)
            }
        }
        // Real-time: tool call started (Python emits before SSH/execution)
        const onStepStart = (data) => {
            if (data.conversationId !== convId) return
            setAgentSteps(prev => {
                const exists = prev.find(s => s.stepId === data.stepId)
                if (exists) return prev
                const next = [...prev, { stepId: data.stepId, tool: data.tool, args: data.args, status: 'running' }]
                lastStepsRef.current = next
                return next
            })
        }
        // Real-time: tool call finished
        const onStepDone = (data) => {
            if (data.conversationId !== convId) return
            setAgentSteps(prev => {
                const next = prev.map(s =>
                    s.stepId === data.stepId
                        ? { ...s, result: data.result, status: data.status }
                        : s
                )
                lastStepsRef.current = next
                return next
            })
        }
        const onToolCalls = (data) => {
            if (data.conversationId === convId) {
                // Merge reasoning steps without wiping real-time steps
                setAgentSteps(prev => {
                    const reasoningSteps = (data.reasoning || []).map((r, i) => ({
                        stepId: `r_${i}`, tool: r.step || r.tool, args: r.args, status: 'ok'
                    }))
                    // Keep real-time steps if they already exist, otherwise use reasoning
                    return prev.length > 0 ? prev : reasoningSteps
                })
            }
        }
        const onSkillStep = (data) => {
            if (data.conversationId === convId) {
                setActiveSkill(prev => {
                    const existingSteps = prev?.steps || []
                    const idx = existingSteps.findIndex(s => s.stepId === data.stepId)
                    const newStep = { stepId: data.stepId, description: data.description, status: data.status, output: data.output }
                    if (idx >= 0) {
                        const updated = [...existingSteps]
                        updated[idx] = newStep
                        return { name: data.skillName, steps: updated }
                    }
                    return { name: data.skillName, steps: [...existingSteps, newStep] }
                })
            }
        }
        const onSkillDone = (data) => {
            if (data.conversationId === convId) {
                // Keep terminal visible until next message
            }
        }
        const onResponse = (data) => {
            if (data.conversationId === convId) {
                if (lastStepsRef.current.length > 0) {
                    setLiveMsgSteps(lastStepsRef.current)
                }
                setAgentState('idle')
                setAgentSteps([])
                setAgentPhase(null)
                lastStepsRef.current = []
                qc.invalidateQueries({ queryKey: ['messages', convId] })
            }
        }
        const onError = (data) => {
            if (data.conversationId === convId) {
                // Mark any still-running steps as errored
                setAgentSteps(prev => prev.map(s =>
                    s.status === 'running' ? { ...s, status: 'error', result: data.error } : s
                ))
                setTimeout(() => {
                    setAgentState('idle')
                    setAgentSteps([])
                    setAgentError(data.error)
                }, 800)
            }
        }
        const onSystemLog = (data) => {
            if (data.conversationId === convId) {
                setSystemLogs(prev => [...prev, data.log])
            }
        }

        // Action approval lifecycle — refresh messages so ActionCard shows correct status
        const onActionExecuted = () => qc.invalidateQueries({ queryKey: ['messages', convId] })
        const onActionFailed = () => qc.invalidateQueries({ queryKey: ['messages', convId] })
        const onActionRejected = () => qc.invalidateQueries({ queryKey: ['messages', convId] })

        socket.on('agent:thinking', onThinking)
        socket.on('agent:phase', onPhase)
        socket.on('agent:step_start', onStepStart)
        socket.on('agent:step_done', onStepDone)
        socket.on('agent:tool_calls', onToolCalls)
        socket.on('agent:skill_step', onSkillStep)
        socket.on('agent:skill_done', onSkillDone)
        socket.on('agent:response', onResponse)
        socket.on('agent:error', onError)
        socket.on('agent:system_log', onSystemLog)
        socket.on('action:executed', onActionExecuted)
        socket.on('action:failed', onActionFailed)
        socket.on('action:rejected', onActionRejected)

        return () => {
            socket.off('agent:thinking', onThinking)
            socket.off('agent:phase', onPhase)
            socket.off('agent:step_start', onStepStart)
            socket.off('agent:step_done', onStepDone)
            socket.off('agent:tool_calls', onToolCalls)
            socket.off('agent:skill_step', onSkillStep)
            socket.off('agent:skill_done', onSkillDone)
            socket.off('agent:response', onResponse)
            socket.off('agent:error', onError)
            socket.off('agent:system_log', onSystemLog)
            socket.off('action:executed', onActionExecuted)
            socket.off('action:failed', onActionFailed)
            socket.off('action:rejected', onActionRejected)
        }
    }, [convId, qc])


    const messages = Array.isArray(msgData) ? msgData : (msgData?.messages ?? [])
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, agentState, agentSteps])

    const { mutate: sendMsg, isPending } = useMutation({
        mutationFn: (content) => api.post('/messages', { conversationId: convId, content }),
        onMutate: () => {
            setAgentState('thinking')
            setAgentSteps([])
            setSystemLogs([])
            setAgentError(null)
            setActiveSkill(null)
            setLiveMsgSteps(null)   // clear previous live steps on new message
            lastStepsRef.current = []
        },
        onSuccess: (res) => {
            setInput('')
            setAgentState('idle')
            setAgentSteps([])
            qc.invalidateQueries({ queryKey: ['messages', convId] })
        },
        onError: (err) => {
            setAgentState('idle')
            setAgentError(err.response?.data?.error || 'Erro ao enviar')
        },
    })

    const handleSend = (e) => {
        e.preventDefault()
        if (!input.trim() || isPending || !convId) return
        sendMsg(input.trim())
    }

    const handleNewConv = useCallback(async () => {
        const created = await api.post('/conversations').then(r => r.data)
        setConvId(created.id)
        qc.setQueryData(['active-conversation'], created)
        qc.removeQueries({ queryKey: ['messages'] })
        setAgentState('idle')
        setAgentSteps([])
        setAgentError(null)
    }, [qc])

    const { mutate: clearHistory, isPending: isClearing } = useMutation({
        mutationFn: () => api.delete(`/messages/${convId}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['messages', convId] })
        }
    })

    return (
        <div className="flex flex-col h-full animate-fade-in" style={{ height: 'calc(100vh - 8rem)' }}>
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-xl font-bold text-text font-mono">Chat</h1>
                    <p className="text-sm text-text-muted mt-0.5">Converse com o agente de redes</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { if (window.confirm('Apagar todo o histórico de mensagens desta tela?')) clearHistory() }}
                        disabled={isClearing || !convId || messages.length === 0}
                        className="flex items-center gap-2 border border-border text-text-muted hover:text-danger hover:border-danger/50 hover:bg-danger/10 px-3 py-1.5 rounded-lg text-sm transition-all cursor-pointer disabled:opacity-50"
                        title="Limpar Histórico"
                    >
                        {isClearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        <span className="hidden sm:inline">Limpar Histórico</span>
                    </button>
                    <button
                        onClick={handleNewConv}
                        className="flex items-center gap-2 border border-border text-text-muted hover:text-text hover:bg-bg-elevated px-3 py-1.5 rounded-lg text-sm transition-all cursor-pointer"
                    >
                        <Plus size={14} /> <span className="hidden sm:inline">Nova Conversa</span>
                    </button>
                </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 bg-bg-surface border border-border rounded-xl p-4 overflow-y-auto space-y-4 mb-4">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 size={20} className="animate-spin text-text-muted" />
                    </div>
                ) : messages.length === 0 && agentState === 'idle' ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                            <Bot size={22} className="text-primary" />
                        </div>
                        <p className="text-sm font-medium text-text">Olá! Sou o NetAgent.</p>
                        <p className="text-xs text-text-muted mt-1">Pergunte sobre seus dispositivos de rede.</p>
                    </div>
                ) : (
                    messages.map((m, idx) => {
                        // Inject live steps into the last assistant message while DB reloads
                        const isLastAssistant = m.role === 'assistant' && idx === messages.length - 1
                        const liveSteps = isLastAssistant ? liveMsgSteps : null
                        return <ChatBubble key={m.id} msg={m} liveSteps={liveSteps} />
                    })
                )}
                {agentState === 'thinking' && <AgentWorking steps={agentSteps} activeSkill={activeSkill} phase={agentPhase} systemLogs={systemLogs} />}
                {agentError && (
                    <div className="flex gap-2 items-center text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
                        <AlertCircle size={14} />
                        <span>{agentError}</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="flex gap-2">
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Digite sua pergunta sobre a rede..."
                    disabled={isPending || !convId}
                    className="flex-1 bg-bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text placeholder:text-text-muted focus:border-primary transition-colors outline-none disabled:opacity-50"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) } }}
                />
                <button
                    type="submit"
                    disabled={isPending || !input.trim() || !convId}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-40 text-white px-4 py-3 rounded-xl transition-colors cursor-pointer flex items-center gap-2"
                >
                    {isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </form>
        </div>
    )
}
