# NetAgent Audit & Documentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the live NetAgent Platform on this server, produce 8 modular `.md` documents under `docs/`, list bugs by severity, and give a definitive answer on Traefik vs Nginx.

**Architecture:** Three-phase approach. (1) Gather evidence via read-only runtime commands and static file reading, accumulating notes in a scratch file at `/tmp/audit-notes-2026-04-21.md`. (2) Synthesize the notes into 8 final `.md` files in `docs/`. (3) Review and commit locally.

**Tech Stack:** Bash/Docker read-only commands, file reading, Markdown authoring. No code changes, no TDD.

**Spec:** `docs/AUDIT-DESIGN-2026-04-21.md`

---

## File Structure

### Created files
- `/tmp/audit-notes-2026-04-21.md` — scratch evidence dump (not committed)
- `docs/AUDIT-2026-04-21.md` — audit report (bugs, status, proxy answer)
- `docs/INFRASTRUCTURE.md` — Docker Compose, network, volumes, ports
- `docs/DEPENDENCIES.md` — versions, CVEs, audit results
- `docs/DATABASE.md` — PostgreSQL, pgvector, Redis, tenant schemas
- `docs/AGENT-AND-MCP.md` — Python orchestrator, RAG memory, MCP drivers
- `docs/API-ENDPOINTS.md` — REST routes, websocket, auth middleware
- `docs/DEPLOY-AND-OPS.md` — cron, FTP vsftpd, PM2, deploy scripts
- `docs/REVERSE-PROXY.md` — Traefik v3 vs Nginx container, definitive

### Unchanged
- Everything outside `docs/`. Zero edits to source code, configs, `.env`, etc.

---

## Phase 1 — Evidence Gathering

### Task 1: Runtime discovery (Docker, PM2, systemd, network)

**Files:**
- Create: `/tmp/audit-notes-2026-04-21.md`

- [ ] **Step 1: Initialize scratch notes file**

```bash
cat > /tmp/audit-notes-2026-04-21.md <<'EOF'
# Audit Notes 2026-04-21

## 1. Docker runtime
EOF
```

Run and verify file exists:
```bash
ls -la /tmp/audit-notes-2026-04-21.md
```
Expected: file exists, ~30 bytes.

- [ ] **Step 2: Capture docker ps + compose config**

```bash
{
  echo ""
  echo "### docker ps -a"
  echo '```'
  docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
  echo '```'
  echo ""
  echo "### docker compose config (normalized)"
  echo '```yaml'
  cd /var/www/agente_forum_telecom && docker compose config 2>&1 | head -300
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: output contains lines for `traefik`, `netagent-frontend`, `netagent-postgres`, `netagent-redis`, `evolution-api`, `mcp-mikrotik`, `mcp-linux`, `netagent-wireguard`.

- [ ] **Step 3: Capture docker inspect (critical containers)**

For each container name in: traefik, netagent-postgres, netagent-redis, mcp-mikrotik, mcp-linux, evolution-api, netagent-frontend, netagent-wireguard:

```bash
for c in traefik netagent-postgres netagent-redis mcp-mikrotik mcp-linux evolution-api netagent-frontend netagent-wireguard; do
  {
    echo ""
    echo "### docker inspect $c — relevant fields"
    echo '```json'
    docker inspect "$c" 2>/dev/null | jq '.[0] | {State:.State, RestartCount:.RestartCount, Image:.Config.Image, RestartPolicy:.HostConfig.RestartPolicy, Mounts:[.Mounts[]|{Source,Destination,RW}], Ports:.NetworkSettings.Ports, Networks:(.NetworkSettings.Networks|keys)}' 2>&1
    echo '```'
  } >> /tmp/audit-notes-2026-04-21.md
done
```

Expected: each container's State.Running=true (UP), RestartCount noted. If container not found, note it for the bug list.

- [ ] **Step 4: Capture recent docker logs (last 100 lines each)**

```bash
for c in traefik netagent-postgres netagent-redis mcp-mikrotik mcp-linux evolution-api netagent-frontend; do
  {
    echo ""
    echo "### docker logs $c --tail 100"
    echo '```'
    docker logs "$c" --tail 100 2>&1 | tail -100
    echo '```'
  } >> /tmp/audit-notes-2026-04-21.md
done
```

Expected: logs for each. Look for ERROR, FATAL, panic, traceback, restart loops, auth failures.

- [ ] **Step 5: Capture PM2 state**

```bash
{
  echo ""
  echo "## 2. PM2"
  echo '```'
  pm2 list 2>&1
  echo '```'
  echo ""
  echo "### pm2 logs --lines 80 --nostream"
  echo '```'
  pm2 logs --lines 80 --nostream 2>&1 | tail -200
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: two processes (api on port 4000 and agent on port 8000), both `online`. If absent or `errored`, flag for bug list.

- [ ] **Step 6: Capture systemd + cron + firewall + network**

```bash
{
  echo ""
  echo "## 3. Systemd & Cron & Firewall"
  echo ""
  echo "### systemctl status vsftpd"
  echo '```'
  systemctl status vsftpd --no-pager 2>&1 | head -30
  echo '```'
  echo ""
  echo "### systemctl status docker"
  echo '```'
  systemctl status docker --no-pager 2>&1 | head -30
  echo '```'
  echo ""
  echo "### crontab -l"
  echo '```'
  crontab -l 2>&1
  echo '```'
  echo ""
  echo "### ls -la /etc/cron.d/"
  echo '```'
  ls -la /etc/cron.d/ 2>&1
  echo '```'
  echo ""
  echo "### /etc/cron.d/ contents"
  echo '```'
  for f in /etc/cron.d/*; do
    [ -f "$f" ] && echo "--- $f ---" && cat "$f"
  done 2>&1
  echo '```'
  echo ""
  echo "### ss -tlnp (listening TCP)"
  echo '```'
  ss -tlnp 2>&1
  echo '```'
  echo ""
  echo "### ufw status verbose"
  echo '```'
  ufw status verbose 2>&1
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: vsftpd active, docker active, cron entries for monitor/backup/scheduler, listening ports include 80/443/4000/8000/8001/8002/5432/6379/2121, ufw rules match README.md.

- [ ] **Step 7: Localhost health checks**

```bash
{
  echo ""
  echo "## 4. Local health endpoints"
  for url in "http://localhost:4000/health" "http://localhost:8000/health" "http://localhost:8001/health" "http://localhost:8002/health"; do
    echo ""
    echo "### $url"
    echo '```'
    curl -fsS --max-time 10 "$url" 2>&1 || echo "FAILED: exit=$?"
    echo '```'
  done
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: each returns 200 with a JSON/text body. Any non-200 is flagged.

- [ ] **Step 8: Confirm notes captured**

```bash
wc -l /tmp/audit-notes-2026-04-21.md
```
Expected: > 400 lines. If < 100, the previous steps failed silently — investigate.

---

### Task 2: External domain & SSL verification

**Files:**
- Modify: `/tmp/audit-notes-2026-04-21.md` (append)

- [ ] **Step 1: HTTP headers from both public domains**

```bash
{
  echo ""
  echo "## 5. External HTTPS — frontend & evolution domains"
  for d in "agente.forumtelecom.com.br" "agenteevo.forumtelecom.com.br"; do
    echo ""
    echo "### curl -I https://$d"
    echo '```'
    curl -Is --max-time 15 "https://$d" 2>&1 | head -30
    echo '```'
    echo ""
    echo "### curl -I http://$d (should redirect 301/308 to https)"
    echo '```'
    curl -Is --max-time 15 "http://$d" 2>&1 | head -20
    echo '```'
  done
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: HTTPS returns 200 (or 401 for evolution if auth required). HTTP returns 3xx redirect to HTTPS. If neither, flag.

- [ ] **Step 2: SSL certificate inspection**

```bash
{
  echo ""
  echo "## 6. SSL certs"
  for d in "agente.forumtelecom.com.br" "agenteevo.forumtelecom.com.br"; do
    echo ""
    echo "### Cert for $d"
    echo '```'
    timeout 15 openssl s_client -servername "$d" -connect "$d:443" </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer -subject 2>&1 || echo "FAILED"
    echo '```'
  done
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: issuer contains "Let's Encrypt", notAfter in the future (>30 days ideally). If expired or self-signed, bug.

- [ ] **Step 3: DNS resolution sanity check**

```bash
{
  echo ""
  echo "## 7. DNS"
  for d in "agente.forumtelecom.com.br" "agenteevo.forumtelecom.com.br"; do
    echo ""
    echo "### $d"
    echo '```'
    getent hosts "$d" 2>&1
    echo '```'
  done
  echo ""
  echo "### Public IP (this server)"
  echo '```'
  curl -s --max-time 10 https://api.ipify.org 2>&1
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: both domains resolve to the same public IP as this server.

---

### Task 3: Dependency audit (npm + pnpm + pip)

**Files:**
- Modify: `/tmp/audit-notes-2026-04-21.md`

- [ ] **Step 1: npm audit on api/**

```bash
{
  echo ""
  echo "## 8. Dependency audits"
  echo ""
  echo "### api/ — npm audit"
  echo '```'
  cd /var/www/agente_forum_telecom/api && timeout 120 npm audit --production 2>&1 | tail -200
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: summary line like "X vulnerabilities (X low, X moderate, X high, X critical)" or "found 0 vulnerabilities". If times out, note.

- [ ] **Step 2: pnpm audit on frontend/ (fallback to npm if pnpm absent)**

```bash
{
  echo ""
  echo "### frontend/ — pnpm audit (or npm)"
  echo '```'
  cd /var/www/agente_forum_telecom/frontend
  if command -v pnpm >/dev/null 2>&1 && [ -f pnpm-lock.yaml ]; then
    timeout 120 pnpm audit --prod 2>&1 | tail -200
  else
    timeout 120 npm audit --production 2>&1 | tail -200
  fi
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: summary line as above.

- [ ] **Step 3: pip check on agent/**

```bash
{
  echo ""
  echo "### agent/ — pip check"
  echo '```'
  cd /var/www/agente_forum_telecom/agent
  if [ -d venv ]; then
    source venv/bin/activate && timeout 60 pip check 2>&1 && pip list --outdated 2>&1 | head -40
    deactivate
  else
    echo "No venv found"
    timeout 60 pip check 2>&1
  fi
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: "No broken requirements found." Any broken deps go to bug list.

- [ ] **Step 4: Record key version numbers**

```bash
{
  echo ""
  echo "## 9. Versions"
  echo '```'
  echo "node: $(node -v 2>&1)"
  echo "npm: $(npm -v 2>&1)"
  echo "pnpm: $(pnpm -v 2>/dev/null || echo absent)"
  echo "python: $(python3 --version 2>&1)"
  echo "docker: $(docker --version 2>&1)"
  echo "docker compose: $(docker compose version 2>&1)"
  echo "pm2: $(pm2 --version 2>&1)"
  echo "vsftpd: $(vsftpd -v 2>&1 || dpkg -l vsftpd 2>/dev/null | tail -1)"
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: node 20.x, python 3.11+, docker compose v2.

---

### Task 4: Database sanity

**Files:**
- Modify: `/tmp/audit-notes-2026-04-21.md`

- [ ] **Step 1: List databases in Postgres**

```bash
{
  echo ""
  echo "## 10. PostgreSQL"
  echo ""
  echo "### Databases"
  echo '```'
  docker exec netagent-postgres psql -U netagent -tAc '\l' 2>&1 || echo "FAILED"
  echo '```'
  echo ""
  echo "### Extensions (expect pgvector)"
  echo '```'
  docker exec netagent-postgres psql -U netagent -d netagent -tAc "SELECT extname, extversion FROM pg_extension;" 2>&1
  echo '```'
  echo ""
  echo "### Schemas"
  echo '```'
  docker exec netagent-postgres psql -U netagent -d netagent -tAc "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;" 2>&1
  echo '```'
  echo ""
  echo "### Public tables"
  echo '```'
  docker exec netagent-postgres psql -U netagent -d netagent -tAc "\dt public.*" 2>&1
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: databases `netagent`, `evolution`; extension `vector` present; schemas include `public` + one per tenant.

- [ ] **Step 2: Redis ping**

```bash
{
  echo ""
  echo "## 11. Redis"
  echo '```'
  REDIS_PW=$(grep '^REDIS_PASSWORD=' /var/www/agente_forum_telecom/.env | cut -d= -f2-)
  docker exec netagent-redis redis-cli -a "$REDIS_PW" ping 2>&1
  docker exec netagent-redis redis-cli -a "$REDIS_PW" INFO server 2>&1 | head -15
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: `PONG`, redis_version 7.x.

- [ ] **Step 3: Git state**

```bash
{
  echo ""
  echo "## 12. Git"
  echo '```'
  cd /var/www/agente_forum_telecom && git log --oneline -30 2>&1
  echo '--- status ---'
  git status 2>&1 | head -40
  echo '```'
} >> /tmp/audit-notes-2026-04-21.md
```

Expected: matches recent commit list from README. Untracked files noted.

- [ ] **Step 4: Final notes length check**

```bash
wc -l /tmp/audit-notes-2026-04-21.md
```
Expected: > 700 lines. This is the raw evidence base for all 8 final docs.

---

## Phase 2 — Synthesis (write 8 docs under `docs/`)

Each task below reads the scratch notes at `/tmp/audit-notes-2026-04-21.md` plus specific source files, then writes exactly one `.md`. No placeholders, real content only.

### Task 5: Write `docs/INFRASTRUCTURE.md`

**Files:**
- Create: `docs/INFRASTRUCTURE.md`
- Reads: `/tmp/audit-notes-2026-04-21.md` sections 1,3; `docker-compose.yml`

- [ ] **Step 1: Author the file**

Content required:
1. Header: title, "Auditado em: 2026-04-21", commands used.
2. "Visão geral" — 3-5 lines explaining that infra uses Docker Compose with Traefik as the single public entry, backed by containers for DB/cache/proxies and host processes for API/Agent.
3. Tabela de containers: Name | Image | Role | Restart policy | Exposed ports | Volumes | Network
4. Tabela de portas (host): 80, 443, 8080, 4000, 8000, 8001, 8002, 2121, 5432 (loopback), 6379 (loopback), 51820+ UDP.
5. Rede Docker `netagent-net` — confirmação.
6. Volumes bind-mount em `./data/*` — lista + pasta no host.
7. Seção "Pontos de atenção" com links para bugs do `AUDIT-2026-04-21.md` (se houver).

Use the actual `docker ps` output captured in Task 1 Step 2. Use table formatting.

- [ ] **Step 2: Verify file is non-trivial**

```bash
wc -l /var/www/agente_forum_telecom/docs/INFRASTRUCTURE.md
```
Expected: >= 80 lines.

---

### Task 6: Write `docs/REVERSE-PROXY.md`

**Files:**
- Create: `docs/REVERSE-PROXY.md`
- Reads: `docker-compose.yml`, `traefik/nginx-frontend.conf`, `traefik/config/*`, scratch notes sections 5,6

- [ ] **Step 1: Author the definitive answer**

Required content:
1. Header + "Auditado em: 2026-04-21".
2. **Resposta objetiva em 1 parágrafo**: o proxy reverso público é **Traefik v3.6.1**. Nginx é usado apenas como sidecar interno servindo estáticos do frontend (`./frontend/dist`) dentro da rede Docker; não escuta em porta pública.
3. Diagrama ASCII simples:
   ```
   Internet → :80/:443 → Traefik → (docker network) → nginx-frontend :80 → static files
                                                     → evolution-api :8080
                                                     → host-gateway:4000 (API)
                                                     → host-gateway:8000 (Agent)
   ```
4. Tabela "Como o Traefik roteia":
   | Host | Serviço destino | Via |
   | `agente.forumtelecom.com.br` | netagent-frontend:80 | docker label |
   | `agenteevo.forumtelecom.com.br` | evolution-api:8080 | docker label |
   | (se existir em `traefik/config/*.yml`) api/agent | host:4000 / host:8000 | file provider |

   *(Verificar conteúdo de `traefik/config/` e listar cada arquivo YAML e o host que ele expõe. Se vazio, documentar.)*
5. HTTPS redirect: confirmar que HTTP redireciona 301/308 para HTTPS, com base na saída do Task 2 Step 1.
6. SSL Let's Encrypt: issuer e validade da evidência do Task 2 Step 2.
7. Por que há Nginx container? Justificar: Traefik não serve estáticos nativamente; Nginx é leve e bem otimizado para isso; continua atrás do Traefik.
8. Seção "Pontos de atenção".

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/REVERSE-PROXY.md
grep -c "Traefik" /var/www/agente_forum_telecom/docs/REVERSE-PROXY.md
```
Expected: >= 60 lines, "Traefik" referenced at least 5 times.

---

### Task 7: Write `docs/DATABASE.md`

**Files:**
- Create: `docs/DATABASE.md`
- Reads: `api/prisma/schema.prisma`, `api/src/db/init.sql`, `api/scripts/*.sql`, scratch notes sections 10,11

- [ ] **Step 1: Author**

Required content:
1. Header.
2. Visão geral — PostgreSQL 16 + pgvector em container (porta loopback 5432), Redis 7 em container (loopback 6379).
3. **PostgreSQL**:
   - Databases existentes (do scratch Task 4 Step 1): `netagent` (app), `evolution` (whatsapp api).
   - Extensões instaladas (do scratch).
   - Modelo multi-tenant: schema `public` + 1 schema por tenant. Listar schemas reais encontrados.
   - Tabelas do schema `public` (listar nomes).
   - Link para `api/prisma/schema.prisma:<linhas>` para cada modelo principal.
   - Migrations: `api/scripts/*.sql` — listar os arquivos SQL existentes com sua ordem de aplicação.
4. **Redis**:
   - Versão (do scratch).
   - Uso: sessões, cache, filas (confirmar grep no código do api/).
5. **pgvector**:
   - Usado por `agent/memory/*` para RAG. Citar tabelas de embeddings.
6. Volumes: `./data/postgres`, `./data/redis` no host.
7. Backup: vsftpd armazena em quê? (ler `installer/scripts/install.sh` e cron para achar o caminho de backup).
8. Seção "Pontos de atenção".

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/DATABASE.md
```
Expected: >= 80 lines.

---

### Task 8: Write `docs/API-ENDPOINTS.md`

**Files:**
- Create: `docs/API-ENDPOINTS.md`
- Reads: `api/src/routes/**`, `api/src/middleware/**`, `api/src/socket.js`

- [ ] **Step 1: Enumerate routes**

Run (for your own discovery, not for the doc):
```bash
grep -rE "router\.(get|post|put|patch|delete)" /var/www/agente_forum_telecom/api/src/routes/ | head -200
```

- [ ] **Step 2: Author**

Required content:
1. Header.
2. Visão geral — Express + Prisma, multi-tenant via middleware, WebSocket via Socket.io.
3. **Middlewares** (ler cada arquivo em `api/src/middleware/`):
   - Auth (JWT): onde é aplicado, como extrai tenant.
   - Tenant isolation: como seleciona schema.
   - Rate limit (se houver).
4. **Endpoints REST** — uma tabela por domínio (auth, devices, chat, backups, wireguard, etc.):
   | Método | Path | Arquivo:linha | Auth? | Descrição curta |
5. **WebSocket (Socket.io)**: eventos emitidos/escutados (ler `socket.js`).
6. **Services** (breve): encryption, tenant, outros em `api/src/services/`.
7. Seção "Pontos de atenção".

- [ ] **Step 3: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/API-ENDPOINTS.md
grep -cE "^\|" /var/www/agente_forum_telecom/docs/API-ENDPOINTS.md
```
Expected: >= 120 lines, >= 30 linhas de tabela (markdown `|`).

---

### Task 9: Write `docs/AGENT-AND-MCP.md`

**Files:**
- Create: `docs/AGENT-AND-MCP.md`
- Reads: `agent/orchestrator.py`, `agent/monitor.py`, `agent/scheduler.py`, `agent/whatsapp.py`, `agent/mcp/**`, `agent/memory/**`, `agent/tools/**`, `agent/agents/*.md`, `mcp-linux/**`, `mcp-mikrotik/**`

- [ ] **Step 1: Author**

Required content:
1. Header.
2. Visão geral — FastAPI + OpenAI no host (8000). Ciclo: request → orquestrador → skill → tool → MCP → dispositivo.
3. **Orquestrador** (`orchestrator.py`): qual framework, como delega para skills, como usa RAG (`memory/`).
4. **Especialistas** (`agents/*.md`): listar cada arquivo e o título/skill definida.
5. **RAG memory** (`memory/`): tabela(s) de embeddings, modelo de embedding usado, ponto de gravação (hooks que geram embeddings).
6. **Tools** (`tools/`): base.py + mikrotik + linux — listar funções expostas.
7. **Monitor** (`monitor.py`): o que monitora, com que frequência, como dispara alertas.
8. **Scheduler** (`scheduler.py`): que tarefas agenda, integração com cron ou loop interno.
9. **WhatsApp webhook** (`whatsapp.py`): endpoint, validação, fluxo.
10. **MCP drivers** (containers):
    - `mcp-mikrotik` (porta 8001) — SSH → RouterOS CLI. Endpoints expostos.
    - `mcp-linux` (porta 8002) — SSH → shell. Endpoints expostos.
    - Healthchecks (do Dockerfile).
11. Circuit breaker + MCP bridge no cliente Python (`agent/mcp/`).
12. Seção "Pontos de atenção".

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/AGENT-AND-MCP.md
```
Expected: >= 150 lines.

---

### Task 10: Write `docs/DEPENDENCIES.md`

**Files:**
- Create: `docs/DEPENDENCIES.md`
- Reads: scratch sections 8,9; `api/package.json`; `agent/requirements.txt`; `frontend/package.json`; `docker-compose.yml`

- [ ] **Step 1: Author**

Required content:
1. Header + comandos usados (`npm audit`, `pnpm audit`, `pip check`, `docker image ls`).
2. **Runtimes** (tabela): Node, Python, Docker, Docker Compose, PM2, pnpm — versão encontrada.
3. **Images Docker** (tabela): serviço | imagem | tag | image-id. Usar `docker images --format` se útil.
4. **api/ — npm audit**: copiar o summary do scratch + top 5 vulnerabilidades mais graves com package/CVE/severity.
5. **frontend/ — npm/pnpm audit**: mesma estrutura.
6. **agent/ — pip check + outdated**: lista de pacotes com versão desatualizada ou quebrada.
7. Tag por release (Evolution v2.3.4, Traefik v3.6.1, Postgres pgvector:pg16, Redis 7-alpine) — comentário sobre release dates vs. última estável.
8. Seção "Pontos de atenção".

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/DEPENDENCIES.md
```
Expected: >= 100 lines.

---

### Task 11: Write `docs/DEPLOY-AND-OPS.md`

**Files:**
- Create: `docs/DEPLOY-AND-OPS.md`
- Reads: `deploy.sh`, `deploy-frontend.sh`, `server-setup.sh`, `installer/scripts/install.sh`, `installer/build.sh`, scratch section 3 (cron, systemd, ufw, ss)

- [ ] **Step 1: Author**

Required content:
1. Header.
2. Visão geral — deploy in-place via `deploy.sh`; setup inicial via `server-setup.sh` ou `installer/`.
3. **Scripts** (tabela): script | papel | o que toca | idempotente?
4. **PM2**: quais processos, log path, startup configurado? (Evidências do scratch Task 1 Step 5).
5. **Cron** (do scratch): listar cada entry e o que dispara.
6. **FTP (vsftpd)**: porta 2121 (conforme README), diretório de recebimento, usuário, credenciais (só confirmar que criptografadas/env — não expor), como o agent consome os backups.
7. **UFW**: portas liberadas (do scratch).
8. **Logs**: pastas `logs/` e `data/*/logs`.
9. **Fluxo de deploy resumido**: pull → build frontend → restart api+agent → docker compose up -d (se mudou) → health checks.
10. Seção "Pontos de atenção".

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/DEPLOY-AND-OPS.md
```
Expected: >= 100 lines.

---

### Task 12: Write `docs/AUDIT-2026-04-21.md` (final report)

**Files:**
- Create: `docs/AUDIT-2026-04-21.md`
- Reads: `/tmp/audit-notes-2026-04-21.md` (all sections)

- [ ] **Step 1: Author**

This is the most important deliverable. Required structure:

```markdown
# Auditoria NetAgent Platform — 2026-04-21

> Realizada em: 2026-04-21
> Escopo: opção B (leitura + execução read-only)
> Spec: AUDIT-DESIGN-2026-04-21.md

## 1. Resumo executivo
<5-10 linhas em prosa objetiva: estado geral, bugs críticos, proxy, recomendações top-3>

## 2. Status dos serviços
| Serviço | Estado | Evidência |
| --- | --- | --- |
| Traefik | UP/DOWN/DEGRADED | docker ps + logs |
| Nginx (frontend) | ... | ... |
| PostgreSQL | ... | ... |
| Redis | ... | ... |
| Evolution API | ... | ... |
| MCP MikroTik | ... | ... |
| MCP Linux | ... | ... |
| WireGuard | ... | ... |
| API Node (PM2) | ... | ... |
| Agent Python (PM2) | ... | ... |
| vsftpd | ... | ... |

## 3. Reverse proxy — resposta objetiva
<Parágrafo: Traefik v3.6.1 é o proxy público, 100%. Nginx é sidecar interno só para estáticos do frontend.>

## 4. Bugs encontrados
| ID | Severidade | Local | Descrição | Recomendação |
| --- | --- | --- | --- | --- |
| AUDIT-BUG-001 | 🔴/🟡/🟢 | arquivo:linha ou serviço | ... | ... |

Se nenhum bug encontrado, escrever explicitamente: "Nenhum bug bloqueante identificado nesta auditoria read-only. Recomenda-se auditoria C (pentest) em cadência anual."

## 5. Dependências com vulnerabilidades
| Pacote | Versão | CVE | Severidade | Ação sugerida |

## 6. Verificações específicas
- **TLS**: issuer, validade, dias até expirar
- **Portas expostas externamente**: lista
- **Firewall UFW**: regras
- **Cron**: quantidade de entries e cobertura
- **FTP vsftpd**: status, porta, credenciais protegidas?
- **Multi-tenant**: quantos schemas em Postgres?

## 7. Recomendações priorizadas
**P0 (crítico, agir em <48h):** ...
**P1 (alto, agir em <2 semanas):** ...
**P2 (médio/baixo, próxima janela de manutenção):** ...

## 8. Limitações desta auditoria
<O que NÃO foi testado: pentest, fuzzing, teste de carga, teste de isolamento multi-tenant real, revisão de permissões de IAM, segredos rotativos, etc.>
```

Critérios de preenchimento:
- Severidade dos bugs usa 3 tags: 🔴 crítico / 🟡 médio / 🟢 cosmético.
- Bug crítico = bloqueia produção ou expõe dados. Médio = falha operacional sem vazamento. Cosmético = lint, typo, log, dead code.
- Tabelas reais — não placeholders. Se linha não aplicável, remover.

- [ ] **Step 2: Verify**

```bash
wc -l /var/www/agente_forum_telecom/docs/AUDIT-2026-04-21.md
grep -c "AUDIT-BUG-" /var/www/agente_forum_telecom/docs/AUDIT-2026-04-21.md
grep -c "^|" /var/www/agente_forum_telecom/docs/AUDIT-2026-04-21.md
```
Expected: >= 120 linhas, ao menos 1 "AUDIT-BUG-" referenciado (ou nota explícita de zero bugs), >= 20 linhas de tabela.

---

### Task 13: Cross-link passes + commit + summary

**Files:**
- Modify: todos os 7 .md temáticos (para ter seção "Pontos de atenção" com links para bugs relevantes do AUDIT)
- Commit: `docs/*` novos

- [ ] **Step 1: Pass de cross-referência**

Para cada bug em `AUDIT-2026-04-21.md`, decidir qual .md temático deve citá-lo em "Pontos de atenção". Editar o .md correspondente com o link:
```
- `AUDIT-2026-04-21.md#audit-bug-00X` — <título curto do bug>
```

- [ ] **Step 2: Git status pré-commit**

```bash
cd /var/www/agente_forum_telecom && git status
```
Expected: só arquivos novos em `docs/` + scratch em `/tmp` (fora do repo, não aparece).

- [ ] **Step 3: Commit local**

```bash
cd /var/www/agente_forum_telecom && \
git add docs/AUDIT-DESIGN-2026-04-21.md \
        docs/AUDIT-2026-04-21.md \
        docs/INFRASTRUCTURE.md \
        docs/DEPENDENCIES.md \
        docs/DATABASE.md \
        docs/AGENT-AND-MCP.md \
        docs/API-ENDPOINTS.md \
        docs/DEPLOY-AND-OPS.md \
        docs/REVERSE-PROXY.md \
        docs/superpowers/plans/2026-04-21-netagent-audit.md && \
git commit -m "$(cat <<'EOF'
docs: add full system audit and modular documentation (2026-04-21)

Evidence-based audit across Docker runtime, PM2 processes, cron, FTP,
TLS, dependencies. Adds 8 modular docs and an audit report with bug
severity classification. Read-only audit (opção B). No code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify commit**

```bash
cd /var/www/agente_forum_telecom && git log -1 --stat
```
Expected: 1 commit, todos os .md listados, 0 arquivos fora de `docs/`.

- [ ] **Step 5: Deliver chat summary**

No chat, responder ao usuário com ~50 linhas seguindo o formato da seção 8 do spec. Incluir:
- Veredicto 1-linha (estado geral).
- Reverse proxy (2-3 linhas).
- Arquitetura (3-5 bullets + link `docs/INFRASTRUCTURE.md`).
- Dependências (3-5 bullets + link `docs/DEPENDENCIES.md`).
- Bugs (top 5 + link `docs/AUDIT-2026-04-21.md`).
- Ops & Deploy (3-5 bullets + link `docs/DEPLOY-AND-OPS.md`).
- Próximos passos sugeridos (lista curta).

---

## Self-Review

- [ ] **Spec coverage**:
  - Spec §2 objetivo 1 (verificação ponta-a-ponta) → Tasks 1-4. ✅
  - Spec §2 objetivo 2 (8 .md modulares) → Tasks 5-12. ✅ (Tasks 5,6,7,8,9,10,11,12 = 8 docs; mas REVERSE-PROXY = task 6, INFRASTRUCTURE = task 5, DATABASE = task 7, API-ENDPOINTS = task 8, AGENT-AND-MCP = task 9, DEPENDENCIES = task 10, DEPLOY-AND-OPS = task 11, AUDIT = task 12)
  - Spec §2 objetivo 3 (proxy definitivo) → Task 6 (REVERSE-PROXY.md) + §3 do AUDIT. ✅
  - Spec §2 objetivo 4 (vulnerabilidades) → Task 3 + Task 10. ✅
  - Spec §2 objetivo 5 (resumo ~50 linhas) → Task 13 Step 5. ✅
  - Spec §9 git (commit local, sem push) → Task 13 Step 3. ✅
  - Spec §10 critérios → cobertos.

- [ ] **Placeholder scan**: plan has no TBD/TODO. Cada .md tem a estrutura exigida. ✅

- [ ] **Type consistency**: IDs de bug seguem padrão `AUDIT-BUG-00X` em todos os docs. Caminho do scratch é `/tmp/audit-notes-2026-04-21.md` em todo o plano. ✅
