import React, { useEffect, useState } from 'react';
import {
    Database, Copy, Check, Terminal, Shield, Eye, EyeOff,
    AlertTriangle, Key, ExternalLink,
} from 'lucide-react';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

function CopyBlock({ label, code, displayCode, multiline = false }) {
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };
    return (
        <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-border text-xs font-mono text-text-muted">
                <span>{label}</span>
                <button
                    onClick={onCopy}
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/10 transition-colors text-text"
                >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copied ? 'Copiado' : 'Copiar'}
                </button>
            </div>
            <pre className={`p-4 overflow-x-auto text-[13px] font-mono leading-relaxed text-[#c9d1d9] ${multiline ? 'whitespace-pre' : ''}`}>
                {displayCode ?? code}
            </pre>
        </div>
    );
}

export default function DocsMcpDb() {
    const { user } = useAuthStore();
    const isAdmin = user?.role === 'admin' || user?.isSuperAdmin;

    const [cfg, setCfg] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showToken, setShowToken] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const { data } = await api.get('/settings/mcp-db');
                if (active) setCfg(data);
            } catch (err) {
                if (active) setError(err.response?.data?.message || err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const configured = cfg?.configured;
    const url = cfg?.url || 'https://mcpdb.SEU-DOMINIO/mcp';
    const token = cfg?.token || 'SEU_MCP_DB_TOKEN';
    const tenant = cfg?.tenantSchema || 'SEU_TENANT';
    const maskedToken = token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token;
    const displayToken = showToken ? token : maskedToken;

    const addCmd = `claude mcp add --transport http netagent-db \\
  ${url} \\
  --header "Authorization: Bearer ${token}"`;

    const addCmdDisplay = `claude mcp add --transport http netagent-db \\
  ${url} \\
  --header "Authorization: Bearer ${showToken ? token : maskedToken}"`;

    const verifyCmd = `claude mcp list`;

    const examplePrompts = [
        'Liste meus equipamentos MikroTik ativos.',
        'Qual é o IP e a porta do device "core-rj"?',
        'Pegue as credenciais do device {id} pra eu abrir SSH.',
        'Atualize a tag "critico" no device {id}.',
        'Crie um novo MikroTik: host 10.0.0.5, user admin, senha ...',
    ];

    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto space-y-10">
            {/* Header */}
            <header className="mb-2 border-b border-border pb-6">
                <h1 className="text-4xl font-extrabold text-text mb-3 flex items-center gap-4">
                    <Database className="text-primary" size={36} />
                    MCP Postgres — Claude Code Remoto
                </h1>
                <p className="text-text-muted text-base leading-relaxed max-w-4xl">
                    Conecte um Claude Code rodando em outra máquina ao Postgres deste servidor para
                    listar, criar, atualizar e recuperar credenciais de equipamentos do seu tenant.
                    A conexão usa HTTPS + Bearer token; o token é gerado na instalação.
                </p>
            </header>

            {/* Admin gate */}
            {!isAdmin && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-5 flex gap-4">
                    <AlertTriangle className="text-amber-400 shrink-0" size={24} />
                    <div className="text-sm text-text">
                        Somente administradores do tenant podem visualizar o token MCP.
                        Peça a um admin pra abrir esta página e copiar o comando de conexão.
                    </div>
                </div>
            )}

            {isAdmin && loading && (
                <div className="text-sm text-text-muted">Carregando configuração…</div>
            )}

            {isAdmin && error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-5 text-sm text-text">
                    Erro ao carregar: {error}
                </div>
            )}

            {isAdmin && !loading && !error && !configured && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-5 flex gap-4">
                    <AlertTriangle className="text-amber-400 shrink-0" size={24} />
                    <div className="text-sm text-text leading-relaxed">
                        MCP Postgres não configurado. Rode o instalador (<code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">bash install.sh</code>)
                        ou adicione <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">MCP_DB_TOKEN</code>,{' '}
                        <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">MCP_DB_URL</code> e{' '}
                        <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">MCP_DB_TENANT_SCHEMA</code> ao{' '}
                        <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">.env</code> e reinicie o container <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">mcp-postgres</code>.
                    </div>
                </div>
            )}

            {/* Connection details */}
            {isAdmin && !loading && !error && configured && (
                <section className="space-y-4">
                    <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                        <Key className="text-emerald-500" size={24} />
                        Seus dados de conexão
                    </h2>
                    <div className="grid md:grid-cols-3 gap-4">
                        <div className="bg-bg-surface border border-border rounded-xl p-4">
                            <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-1">URL</div>
                            <div className="font-mono text-sm text-text break-all">{url}</div>
                        </div>
                        <div className="bg-bg-surface border border-border rounded-xl p-4">
                            <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Tenant schema</div>
                            <div className="font-mono text-sm text-text">{tenant}</div>
                        </div>
                        <div className="bg-bg-surface border border-border rounded-xl p-4">
                            <div className="flex items-center justify-between mb-1">
                                <div className="text-xs font-bold text-text-muted uppercase tracking-wider">Bearer token</div>
                                <button
                                    onClick={() => setShowToken(!showToken)}
                                    className="text-xs text-text-muted hover:text-text flex items-center gap-1"
                                >
                                    {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                                    {showToken ? 'Ocultar' : 'Mostrar'}
                                </button>
                            </div>
                            <div className="font-mono text-sm text-text break-all">{displayToken}</div>
                        </div>
                    </div>
                </section>
            )}

            {/* Step 1 — install */}
            <section className="space-y-4">
                <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                    <Terminal className="text-primary" size={24} />
                    1. Adicionar ao Claude Code remoto
                </h2>
                <p className="text-sm text-text-muted max-w-3xl">
                    Na máquina onde seu outro Claude Code roda, execute o comando abaixo no terminal.
                    Ele registra o servidor MCP em nome <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">netagent-db</code> com o
                    token já preenchido.
                </p>
                <CopyBlock
                    label="Comando (Copiar leva o token real pro clipboard)"
                    code={addCmd}
                    displayCode={addCmdDisplay}
                    multiline
                />
                <p className="text-xs text-text-muted">
                    O token é mascarado na tela por segurança, mas <strong>Copiar</strong> sempre leva o token completo pro clipboard —
                    só colar no terminal do outro Claude Code.
                </p>
            </section>

            {/* Step 2 — verify */}
            <section className="space-y-4">
                <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                    <Shield className="text-cyan-500" size={24} />
                    2. Verificar conexão
                </h2>
                <p className="text-sm text-text-muted max-w-3xl">
                    Depois de rodar o comando do passo 1, liste os servidores registrados:
                </p>
                <CopyBlock label="Terminal" code={verifyCmd} />
                <p className="text-sm text-text-muted">
                    <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">netagent-db</code> deve aparecer como{' '}
                    <strong>connected</strong>. Se aparecer <em>failed</em>, confira se o token foi colado inteiro e se o domínio
                    resolve nesta máquina.
                </p>
            </section>

            {/* Step 3 — tools */}
            <section className="space-y-4">
                <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                    <Database className="text-indigo-500" size={24} />
                    3. Tools disponíveis
                </h2>
                <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-white/5 text-text-muted text-xs uppercase tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-2">Tool</th>
                                <th className="text-left px-4 py-2">O que faz</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            <tr><td className="px-4 py-2 font-mono text-text">device_list</td><td className="px-4 py-2 text-text-muted">Lista equipamentos (sem senha). Filtros opcionais: type, active.</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-text">device_get</td><td className="px-4 py-2 text-text-muted">Busca um equipamento pelo id (sem senha).</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-text">device_search</td><td className="px-4 py-2 text-text-muted">Busca por name/host/tags (ILIKE).</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-amber-400">device_get_credentials</td><td className="px-4 py-2 text-text-muted">Decifra e retorna senha em claro (use só quando for abrir SSH).</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-text">device_create</td><td className="px-4 py-2 text-text-muted">Cria equipamento. Senha é cifrada antes de persistir.</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-text">device_update</td><td className="px-4 py-2 text-text-muted">Atualiza campos não sensíveis (name, host, tags, active, etc).</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-text">device_update_credentials</td><td className="px-4 py-2 text-text-muted">Atualiza username/password (re-cifra).</td></tr>
                            <tr><td className="px-4 py-2 font-mono text-red-400">device_delete</td><td className="px-4 py-2 text-text-muted">Apaga equipamento. Sem soft-delete — cuidado.</td></tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Step 4 — examples */}
            <section className="space-y-4">
                <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                    <Terminal className="text-yellow-500" size={24} />
                    4. Como usar (prompts de exemplo)
                </h2>
                <p className="text-sm text-text-muted max-w-3xl">
                    Depois de conectado, converse normalmente com seu Claude Code. Ele vai escolher e chamar as tools sozinho:
                </p>
                <div className="space-y-2">
                    {examplePrompts.map((p, i) => (
                        <div key={i} className="bg-bg-surface border border-border rounded-lg px-4 py-3 text-sm text-text font-mono">
                            › {p}
                        </div>
                    ))}
                </div>
                <p className="text-sm text-text-muted max-w-3xl">
                    Fluxo típico pra abrir SSH: <em>“Liste meus MikroTiks”</em> → <em>“Pegue as credenciais do device X”</em> →
                    Claude usa <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">device_get_credentials</code> e devolve host, porta, user e senha em claro pra você logar.
                </p>
            </section>

            {/* Security */}
            <section className="space-y-4">
                <h2 className="text-2xl font-bold text-text flex items-center gap-3 border-b border-border pb-2">
                    <Shield className="text-red-500" size={24} />
                    Notas de segurança
                </h2>
                <ul className="text-sm text-text-muted space-y-2 list-disc list-inside">
                    <li>O token é equivalente a uma senha de admin do tenant. Se vazar, regenere: <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">openssl rand -hex 32</code>, troque <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">MCP_DB_TOKEN</code> no <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">.env</code> e <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">docker compose up -d mcp-postgres</code>.</li>
                    <li><code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">device_get_credentials</code> devolve senha em claro — evite executá-la em prompts compartilhados ou colados em chats públicos.</li>
                    <li>O endpoint é público (atrás de Traefik/SSL). Token inválido retorna 401 imediatamente.</li>
                    <li>Todas as escritas vão pro schema <code className="bg-black/30 px-1.5 py-0.5 rounded text-xs">{tenant}</code>; o MCP só vê este tenant.</li>
                </ul>
                <a
                    href="https://docs.anthropic.com/en/docs/agents-and-tools/mcp"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                    Docs oficiais do MCP <ExternalLink size={14} />
                </a>
            </section>
        </div>
    );
}
