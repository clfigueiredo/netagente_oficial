# Spec — Auditoria e Documentação Modular do NetAgent Platform

- **Data:** 2026-04-21
- **Autor:** Forum Telecom (com apoio do Claude Code)
- **Projeto:** agente_forum_telecom (NetAgent Platform)
- **Tipo:** Auditoria + geração de documentação (não-implementação)

---

## 1. Contexto e motivação

O projeto **NetAgent Platform** é uma solução SaaS multi-tenant para ISPs (Forum Telecom) que combina:

- Frontend React/Vite servido por Nginx container (atrás do Traefik)
- API REST/WebSocket em Node.js + Express + Prisma (no host, porta 4000)
- Agente de IA em Python + FastAPI + OpenAI (no host, porta 8000)
- MCP drivers em Python (containers, portas 8001/8002)
- PostgreSQL 16 + pgvector (container, 127.0.0.1:5432)
- Redis 7 (container, 127.0.0.1:6379)
- Evolution API v2.3.4 para WhatsApp (container)
- WireGuard concentrador multi-tenant (container host-network)
- Traefik v3.6.1 como proxy reverso com SSL Let's Encrypt
- vsftpd no host para receber backups dos MikroTik via FTP
- Cron / PM2 para agendamentos e processo de longa duração

O usuário demanda:
1. Verificação ponta-a-ponta do sistema em execução no servidor
2. Documentação modular e navegável
3. Resposta objetiva sobre o uso de Traefik ou Nginx
4. Listagem de bugs encontrados (sem correção nesta tarefa)
5. Resumo final no chat (~50 linhas, formato médio)

## 2. Objetivos

- Produzir **8 novos arquivos .md** na pasta `docs/`, cobrindo cada subsistema
- Registrar um **relatório de auditoria datado** com bugs classificados por severidade
- Confirmar o estado de runtime de todos os serviços (UP / DOWN / DEGRADED)
- Apontar vulnerabilidades conhecidas em dependências (via `npm audit` e `pip check`)
- Validar 100% o funcionamento do reverse proxy (HTTP→HTTPS redirect, certificados SSL válidos)
- Entregar um resumo executivo médio (~50 linhas) no chat, com links para os `.md`

## 3. Fora de escopo (YAGNI)

- Correção de qualquer bug encontrado (apenas documentar)
- Pentest aprofundado (injeção SQL, XSS manual, bypass de auth, fuzzing)
- Mudanças em `.env` ou configurações do servidor
- Restart ou rebuild de serviços
- Alterações em código-fonte
- Migrations ou mexer em dados do banco
- Push para remoto

## 4. Metodologia

### Fase 1 — Discovery estática (leitura)

Ferramentas: `Read`, `Grep`, `Glob`.

- `docker-compose.yml`, `deploy.sh`, `deploy-frontend.sh`, `server-setup.sh`
- `installer/scripts/install.sh`, `installer/build.sh`
- `api/src/**` (routes, middleware, services, db, socket)
- `api/prisma/schema.prisma`, `api/src/db/init.sql`, `api/scripts/*.sql`
- `agent/**` (orchestrator, monitor, scheduler, whatsapp, mcp, memory, tools)
- `agent/agents/*.md` (definições de especialistas)
- `frontend/src/**` (superficial — pages, lib/api, store)
- `mcp-linux/**`, `mcp-mikrotik/**`
- `traefik/config/**`, `traefik/nginx-frontend.conf`
- `.env.example`

### Fase 2 — Runtime (execução read-only)

Comandos autorizados pelo usuário:

| Categoria | Comandos |
|---|---|
| Docker | `docker ps`, `docker inspect <container>`, `docker logs --tail 200 <container>`, `docker compose config` |
| PM2 | `pm2 list`, `pm2 logs --lines 100 --nostream` |
| Systemd | `systemctl status vsftpd`, `systemctl status docker` |
| Cron | `crontab -l`, `ls -la /etc/cron.d/`, `cat /etc/cron.d/*` |
| Rede | `ss -tlnp`, `ufw status verbose` |
| Health | `curl -fsS http://localhost:4000/health`, idem 8000, 8001, 8002 |
| Domínios | `curl -I https://agente.forumtelecom.com.br`, `curl -I https://agenteevo.forumtelecom.com.br` |
| SSL | `openssl s_client -servername <dom> -connect <dom>:443 < /dev/null` |
| Deps | `cd api && npm audit --json`, `cd frontend && pnpm audit --json`, `cd agent && pip check` |
| DB | `docker exec netagent-postgres psql -U netagent -c '\l'` (lista DBs, sem vazar dados) |
| Git | `git log --oneline -30`, `git status` |

### Fase 3 — Síntese

- Classifica bugs em crítico / médio / cosmético
- Consolida em tabela no `AUDIT-2026-04-21.md`
- Cada `.md` modular liga para bugs relacionados via ID (`AUDIT-BUG-001`, etc.)

## 5. Entregáveis — estrutura final de `docs/`

```
docs/
├── SYSTEM_ARCHITECTURE.md       (existente — mantém sem alteração)
├── PLAN.md                      (existente — mantém sem alteração)
├── AUDIT-DESIGN-2026-04-21.md   (este spec)
├── AUDIT-2026-04-21.md          (novo — relatório de auditoria)
├── INFRASTRUCTURE.md            (novo — Docker Compose, rede, volumes, portas)
├── DEPENDENCIES.md              (novo — Node, Python, containers, CVE/audit)
├── DATABASE.md                  (novo — Postgres, pgvector, Redis, schemas multi-tenant)
├── AGENT-AND-MCP.md             (novo — orquestrador, RAG, MCP MikroTik/Linux)
├── API-ENDPOINTS.md             (novo — rotas REST, websocket, auth, middleware)
├── DEPLOY-AND-OPS.md            (novo — cron, FTP vsftpd, PM2, scripts deploy)
└── REVERSE-PROXY.md             (novo — Traefik vs Nginx resposta definitiva)
```

## 6. Padrão de cada arquivo `.md`

Estrutura obrigatória:

```markdown
# <Título>

> Auditado em: 2026-04-21
> Comandos usados: <lista dos comandos de verificação relevantes>

## Visão geral
<2–5 linhas>

## <Seções específicas do tópico>
<conteúdo com tabelas sempre que aplicável>

## Pontos de atenção
- Link para `AUDIT-2026-04-21.md#bug-00X`
```

Idioma: **português**.

## 7. Padrão do `AUDIT-2026-04-21.md`

Seções:

1. **Resumo executivo** (5–10 linhas)
2. **Status dos serviços** — tabela UP/DOWN/DEGRADED com evidência
3. **Reverse proxy** — resposta objetiva "Traefik 100%" + explicação do papel do Nginx
4. **Bugs encontrados** — tabela: ID | Severidade | Local | Descrição | Recomendação
5. **Dependências com vulnerabilidades** — tabela: Pacote | Versão | CVE | Severidade | Ação
6. **Verificações específicas** — TLS, portas expostas, firewall, cron, FTP
7. **Recomendações priorizadas** — lista ordenada (P0/P1/P2)

## 8. Formato do resumo no chat (entrega final)

Formato médio (~50 linhas) com seções:

- **Resumo de 1 linha**
- **Reverse proxy** — 2–3 linhas
- **Arquitetura** (3–5 bullets + link)
- **Dependências** (3–5 bullets + link)
- **Bugs encontrados** (top 5 + link)
- **Ops & Deploy** (3–5 bullets + link)
- **Próximos passos sugeridos**

## 9. Git

- Commit local com os 9 arquivos (1 spec + 8 docs). Sem push.
- Mensagem: `docs: add full system audit and modular documentation (2026-04-21)`

## 10. Critérios de sucesso

- Todos os 8 `.md` existem em `docs/` com cabeçalho padronizado
- `AUDIT-2026-04-21.md` contém: status de serviços, resposta sobre proxy, tabela de bugs, tabela de deps
- Resumo ~50 linhas entregue no chat com links funcionais
- Zero alterações fora de `docs/`
- Commit criado localmente, sem push

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Comando read-only falha (serviço down) | Registra como DEGRADED, não trava a auditoria |
| `npm audit` lento | Timeout 120s; se não terminar, registra limitação |
| Logs grandes poluindo contexto | `--tail 200` sempre |
| Domínios não respondem | Documenta; faz DNS lookup para isolar causa |
| Banco inacessível via docker exec | Tenta via porta local; documenta se falhar |
