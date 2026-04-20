import { Brain, Database, Search, Sparkles, BookOpen, MessageSquare, Layers, ArrowRight, Cpu, Server, Zap } from 'lucide-react'

export default function DocsMemory() {
    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-12">
            <header className="mb-8 border-b border-border pb-8">
                <h1 className="text-4xl font-extrabold text-text mb-4 flex items-center gap-4">
                    <Brain className="text-primary" size={40} />
                    Memória RAG — O Cérebro do NetAgent
                </h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-4xl">
                    O NetAgent possui um <strong>sistema de memória de 3 camadas</strong> que permite ao agente
                    lembrar de conversas, aprender com experiências e consultar uma base de conhecimento permanente.
                    Tudo isso é alimentado por <strong>busca semântica via pgvector</strong> — o agente não procura por palavras-chave,
                    mas pelo <strong>significado</strong> da sua pergunta.
                </p>

                <div className="mt-8 bg-gradient-to-r from-primary/10 to-accent/5 p-6 rounded-xl border border-primary/20">
                    <h3 className="text-xl font-bold text-primary mb-3 flex items-center gap-2">
                        <Sparkles size={22} className="text-accent" /> Como funciona a busca semântica?
                    </h3>
                    <p className="text-text-muted text-sm mb-4">
                        Cada texto salvo na base é convertido em um <strong>vetor matemático de 1536 dimensões</strong> (embedding)
                        usando o modelo da OpenAI. Quando você faz uma pergunta, ela também é convertida em vetor e o banco
                        encontra os documentos mais similares por <strong>distância de cosseno</strong>. Isso significa que
                        perguntar "meu MikroTik tá lento" vai encontrar artigos sobre "alta CPU no RouterOS" mesmo sem usar
                        as mesmas palavras.
                    </p>
                    <div className="bg-bg-elevated p-4 rounded-lg border border-border flex items-center gap-3 flex-wrap">
                        <div className="bg-primary/10 px-3 py-2 rounded-lg border border-primary/20 text-sm text-primary font-medium">
                            Sua pergunta
                        </div>
                        <ArrowRight size={16} className="text-text-muted" />
                        <div className="bg-accent/10 px-3 py-2 rounded-lg border border-accent/20 text-sm text-accent font-medium">
                            Embedding (vetor 1536D)
                        </div>
                        <ArrowRight size={16} className="text-text-muted" />
                        <div className="bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20 text-sm text-emerald-400 font-medium">
                            pgvector (busca cosseno)
                        </div>
                        <ArrowRight size={16} className="text-text-muted" />
                        <div className="bg-orange-500/10 px-3 py-2 rounded-lg border border-orange-500/20 text-sm text-orange-400 font-medium">
                            Top 3 artigos relevantes
                        </div>
                    </div>
                </div>
            </header>

            {/* CAMADA 1: CURTO PRAZO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <MessageSquare className="text-blue-500" size={32} />
                    Camada 1 — Memória de Curto Prazo (Sessão)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-blue-400 mb-3">Histórico da Conversa</h3>
                        <p className="text-sm text-text-muted mb-4">
                            A cada mensagem, o agente carrega as <strong>últimas 12 mensagens</strong> da conversa atual.
                            Isso permite que ele mantenha o contexto do que foi dito e evite repetições.
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li>📋 <strong>Fonte:</strong> <span className="text-accent font-mono">messages</span> (tabela por tenant)</li>
                            <li>⏱️ <strong>TTL:</strong> Duração da conversa</li>
                            <li>📊 <strong>Limite:</strong> 12 mensagens mais recentes</li>
                            <li>🔄 <strong>Carregado em:</strong> <span className="text-accent font-mono">load_context</span> (nó 1 do grafo)</li>
                        </ul>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-blue-400 mb-3">Snapshots do Dispositivo</h3>
                        <p className="text-sm text-text-muted mb-4">
                            Se há um dispositivo selecionado, o agente carrega os <strong>últimos 5 snapshots</strong> —
                            fotografias do estado do equipamento (CPU, RAM, OS, serviços, portas).
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li>📋 <strong>Fonte:</strong> <span className="text-accent font-mono">device_snapshots</span></li>
                            <li>⏱️ <strong>TTL:</strong> Permanente (mas só carrega os 5 mais recentes)</li>
                            <li>🔧 <strong>Criado por:</strong> Tool <span className="text-accent font-mono">fingerprint_device</span></li>
                            <li>📊 <strong>Dados:</strong> CPU%, RAM%, Disco%, OS info, serviços ativos</li>
                        </ul>
                        <div className="mt-4 p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-blue-400 block mb-1">💡 Como é usado:</strong>
                            O agente vê tendências: "CPU estava 20% ontem e hoje está 90%" — isso ajuda no diagnóstico.
                        </div>
                    </div>
                </div>
            </section>

            {/* CAMADA 2: MÉDIO PRAZO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Brain className="text-emerald-500" size={32} />
                    Camada 2 — Memória de Médio Prazo (Preferências)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-emerald-400 mb-3">Tenant Memories</h3>
                        <p className="text-sm text-text-muted mb-4">
                            Memórias persistentes sobre <strong>preferências do cliente</strong> e <strong>peculiaridades da rede</strong>.
                            São lembranças que o agente carrega em todas as conversas futuras.
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li>📋 <strong>Fonte:</strong> <span className="text-accent font-mono">tenant_memories</span> (pgvector)</li>
                            <li>⏱️ <strong>TTL:</strong> Permanente</li>
                            <li>🔍 <strong>Busca:</strong> Semântica (embedding cosine similarity)</li>
                            <li>📊 <strong>Tipos:</strong></li>
                        </ul>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">user_preference</span>
                            <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">device_fact</span>
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">network_topology</span>
                            <span className="text-xs px-2 py-1 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">misc</span>
                        </div>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-emerald-400 mb-3">Como salvar memórias</h3>
                        <p className="text-sm text-text-muted mb-4">
                            O agente possui a tool <span className="text-accent font-mono">save_memory</span> que é ativada quando você pede para ele lembrar de algo.
                        </p>
                        <div className="space-y-3">
                            <div className="p-3 bg-bg-elevated rounded border border-border/50">
                                <span className="block text-primary mb-1 font-bold flex items-center gap-2 text-xs">
                                    <MessageSquare size={12} /> Exemplo no Chat:
                                </span>
                                <p className="text-text italic text-sm">"Lembra que eu prefiro fazer reboots sempre de madrugada, nunca durante o dia."</p>
                            </div>
                            <div className="p-3 bg-bg-elevated rounded border border-border/50">
                                <span className="block text-primary mb-1 font-bold flex items-center gap-2 text-xs">
                                    <MessageSquare size={12} /> Exemplo no Chat:
                                </span>
                                <p className="text-text italic text-sm">"O link da Vivo entra pela ether1 e o da Claro pela ether2 no roteador de borda."</p>
                            </div>
                            <div className="p-3 bg-bg-elevated rounded border border-border/50">
                                <span className="block text-primary mb-1 font-bold flex items-center gap-2 text-xs">
                                    <MessageSquare size={12} /> Exemplo no Chat:
                                </span>
                                <p className="text-text italic text-sm">"O gateway da rede de clientes é sempre o .1 e o DHCP começa no .100."</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CAMADA 3: LONGO PRAZO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <BookOpen className="text-orange-500" size={32} />
                    Camada 3 — Memória de Longo Prazo (Base de Conhecimento RAG)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Knowledge Base</h3>
                        <p className="text-sm text-text-muted mb-4">
                            Uma base de <strong>artigos técnicos permanentes</strong> que o agente consulta em toda conversa.
                            Funciona como um "manual" que o agente lê antes de responder.
                        </p>
                        <ul className="text-sm space-y-2 text-text">
                            <li>📋 <strong>Fonte:</strong> <span className="text-accent font-mono">public.knowledge_base</span> (pgvector)</li>
                            <li>⏱️ <strong>TTL:</strong> Permanente</li>
                            <li>🔍 <strong>Busca:</strong> Semântica (embedding) + fallback por keywords</li>
                            <li>📊 <strong>Retorna:</strong> Top 3 artigos mais relevantes</li>
                            <li>🎯 <strong>Quality Score:</strong> Artigos com score maior aparecem primeiro</li>
                            <li>📈 <strong>Use Count:</strong> Incrementa quando o agente usa um artigo</li>
                        </ul>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-xl font-bold text-orange-400 mb-3">Categorias e Fontes</h3>
                        <p className="text-sm text-text-muted mb-4">Cada artigo na base tem categorização e origem.</p>

                        <div className="mb-4">
                            <span className="text-xs font-bold text-text-muted uppercase tracking-wider block mb-2">Categorias</span>
                            <div className="flex flex-wrap gap-2">
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 font-medium">troubleshooting</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">configuration</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">operations</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 font-medium">security</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-500/10 text-gray-400 border border-gray-500/20 font-medium">general</span>
                            </div>
                        </div>

                        <div className="mb-4">
                            <span className="text-xs font-bold text-text-muted uppercase tracking-wider block mb-2">Fontes</span>
                            <div className="flex flex-wrap gap-2">
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">📝 Manual — Adicionado pelo admin</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">🤖 Learned — Agente aprendeu sozinho</span>
                                <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">📚 Documentation — Importado de docs</span>
                            </div>
                        </div>

                        <div className="p-3 bg-bg-elevated rounded border border-border/50 text-xs italic text-text-muted">
                            <strong className="not-italic text-orange-400 block mb-1">💡 Gerenciar:</strong>
                            Acesse <strong>Base de Conhecimento</strong> no menu lateral para adicionar, editar ou remover artigos da base RAG.
                        </div>
                    </div>
                </div>

                {/* Como o agente aprende */}
                <div className="bg-gradient-to-r from-orange-500/10 to-bg-surface p-6 rounded-xl border border-orange-500/20 shadow-sm">
                    <h3 className="text-2xl font-bold text-orange-400 mb-3 flex items-center gap-2">
                        <Zap size={22} /> O agente pode aprender sozinho?
                    </h3>
                    <p className="text-sm text-text-muted mb-4">
                        <strong>Sim!</strong> O agente possui a tool <span className="text-accent font-mono">save_knowledge</span>.
                        Quando ele descobre algo útil durante uma interação (uma configuração específica, um problema resolvido,
                        um padrão detectado), ele pode salvar esse conhecimento automaticamente na base para usar em conversas futuras.
                    </p>
                    <div className="bg-bg-elevated p-4 rounded-lg border border-border text-sm">
                        <strong className="text-orange-400 block mb-2">Exemplo real:</strong>
                        <p className="text-text-muted">
                            Você pede pro agente investigar por que o MikroTik-Borda está com CPU alta. Ele descobre que o problema
                            era um flood de DNS na porta 53 sem regra de drop. Depois de resolver, ele salva:
                        </p>
                        <div className="mt-2 p-3 bg-bg-surface rounded border border-emerald-500/20">
                            <span className="text-emerald-400 text-xs font-bold">✅ Conhecimento salvo:</span>
                            <p className="text-text text-sm mt-1">
                                "MikroTik-Borda: CPU alta causada por DNS flood externo na porta 53. Solução: regra de drop
                                no chain input para tráfego UDP/TCP porta 53 de origem externa."
                            </p>
                        </div>
                        <p className="text-text-muted mt-2 text-xs">
                            Na próxima vez que alguém perguntar sobre CPU alta em qualquer MikroTik, o agente já terá esse conhecimento no contexto.
                        </p>
                    </div>
                </div>
            </section>

            {/* FLUXO COMPLETO */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Layers className="text-primary" size={32} />
                    Fluxo Completo — Como o agente usa a memória
                </h2>

                <div className="bg-bg-surface p-6 rounded-xl border border-border">
                    <div className="space-y-4">
                        {[
                            {
                                step: '1',
                                title: 'load_context',
                                color: 'text-blue-400',
                                bg: 'bg-blue-500/10',
                                border: 'border-blue-500/20',
                                desc: 'Carrega as últimas 12 mensagens da conversa + dados do dispositivo + últimos 5 snapshots',
                                tag: 'Curto prazo',
                            },
                            {
                                step: '2',
                                title: 'search_rag',
                                color: 'text-emerald-400',
                                bg: 'bg-emerald-500/10',
                                border: 'border-emerald-500/20',
                                desc: 'Converte a pergunta em embedding → busca na Knowledge Base (top 3) + busca nas Tenant Memories',
                                tag: 'Médio + Longo prazo',
                            },
                            {
                                step: '3',
                                title: 'route_intent',
                                color: 'text-orange-400',
                                bg: 'bg-orange-500/10',
                                border: 'border-orange-500/20',
                                desc: 'Analisa keywords + tipo de dispositivo → seleciona 1-2 agentes especialistas (ex: mikrotik-expert)',
                                tag: 'Roteamento',
                            },
                            {
                                step: '4',
                                title: 'run_specialists',
                                color: 'text-purple-400',
                                bg: 'bg-purple-500/10',
                                border: 'border-purple-500/20',
                                desc: 'Monta prompt com: persona do agente + memória 3 camadas + snapshot + ferramentas. Executa até 5 iterações de tool calls.',
                                tag: 'Execução',
                            },
                            {
                                step: '5',
                                title: 'synthesize',
                                color: 'text-primary',
                                bg: 'bg-primary/10',
                                border: 'border-primary/20',
                                desc: 'Se múltiplos agentes responderam, combina em uma resposta coesa. Adapta formato (web/WhatsApp).',
                                tag: 'Resposta',
                            },
                        ].map(({ step, title, color, bg, border, desc, tag }) => (
                            <div key={step} className={`flex items-start gap-4 p-4 rounded-xl ${bg} border ${border}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bg} border ${border} flex-shrink-0`}>
                                    <span className={`text-lg font-bold ${color}`}>{step}</span>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className={`font-mono font-bold ${color}`}>{title}</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${bg} ${color} border ${border} font-medium`}>{tag}</span>
                                    </div>
                                    <p className="text-sm text-text-muted">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* DETALHES TÉCNICOS */}
            <section className="space-y-6">
                <h2 className="text-3xl font-bold text-text flex items-center gap-3 border-b border-border pb-3">
                    <Database className="text-gray-400" size={32} />
                    Detalhes Técnicos
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-text mb-3 flex items-center gap-2">
                            <Database size={18} className="text-primary" /> Banco de Dados
                        </h3>
                        <ul className="text-sm space-y-2 text-text-muted">
                            <li>• <strong>PostgreSQL 16</strong> com extensão <strong>pgvector 0.8</strong></li>
                            <li>• Embeddings: <strong>vector(1536)</strong></li>
                            <li>• Índice: <strong>IVFFlat</strong> (100 listas)</li>
                            <li>• Distância: <strong>cosine similarity</strong></li>
                        </ul>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-text mb-3 flex items-center gap-2">
                            <Sparkles size={18} className="text-accent" /> Modelo de Embedding
                        </h3>
                        <ul className="text-sm space-y-2 text-text-muted">
                            <li>• <strong>OpenAI:</strong> text-embedding-3-small</li>
                            <li>• <strong>Google:</strong> text-embedding-004 (alternativa)</li>
                            <li>• Configurável por tenant via settings</li>
                            <li>• Fallback: busca por keywords (ILIKE)</li>
                        </ul>
                    </div>
                    <div className="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-text mb-3 flex items-center gap-2">
                            <Server size={18} className="text-emerald-400" /> Tabelas Envolvidas
                        </h3>
                        <ul className="text-sm space-y-2 text-text-muted font-mono">
                            <li>• <span className="text-blue-400">public.</span>knowledge_base</li>
                            <li>• <span className="text-emerald-400">{'{tenant}'}.</span>tenant_memories</li>
                            <li>• <span className="text-emerald-400">{'{tenant}'}.</span>device_snapshots</li>
                            <li>• <span className="text-emerald-400">{'{tenant}'}.</span>messages</li>
                        </ul>
                    </div>
                </div>
            </section>
        </div>
    )
}
