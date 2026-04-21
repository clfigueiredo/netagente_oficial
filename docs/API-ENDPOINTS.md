# API Endpoints

> Auditado em: 2026-04-21
> Comandos usados: leitura de `api/src/routes/`, `api/src/middleware/`, `api/src/socket.js`, `api/src/index.js`, `api/src/app.js`, `api/src/services/`, `api/package.json`

## Visão geral

A API do NetAgent é um servidor **Node.js (>=20) com Express 5.0.1 + Prisma 5.22**, montado em `api/src/app.js` e iniciado em `api/src/index.js`. Escuta em `0.0.0.0:4000` (variável `PORT`, gerenciado por PM2 como `netagent-api`). É **multi-tenant com isolamento por schema PostgreSQL** — o middleware `tenantMiddleware` extrai `tenantSlug` do JWT e todas as queries SQL usam `req.tenantSchema` como prefixo (ex.: `"tenant_slug".devices`). Expõe REST (prefixos `/auth`, `/devices`, `/conversations`, etc.) e WebSocket via Socket.io em `/socket.io`. O frontend Vue consome essa API via Traefik (`https://agente.forumtelecom.com.br/api`), mas a porta 4000 também fica **exposta publicamente na internet por regra UFW** (ver AUDIT-BUG-002).

## Entrypoint

- **`api/src/index.js`** (19 linhas): carrega `.env`, cria `httpServer` do `http` nativo, injeta o `app` Express e chama `initSocket(httpServer)` — importante porque Socket.io compartilha o mesmo servidor HTTP da API. Listen em `PORT || 4000`. Registra handler `process.on('unhandledRejection')` (apenas loga, não mata o processo).
- **`api/src/app.js`** (98 linhas): monta todos os routers. Ordem dos middlewares globais:
  1. `helmet()` — headers de segurança padrão
  2. `cors({ origin: process.env.PUBLIC_URL, credentials: true })` — apenas a origem canônica do frontend
  3. `express.json({ limit: '10mb' })` — para uploads de conversas/áudios
  4. `morgan('combined')` — log de acesso em stdout (capturado pelo PM2)
- **Health check público:** `GET /health` → `{ status: 'ok', timestamp }` (sem auth, montado **antes** do `authMiddleware`).
- **Endpoint interno não autenticado com secret:** `POST /internal/emit` — valida header `x-internal-secret` contra `INTERNAL_API_SECRET` e repassa eventos Socket.io (`emitToTenant(tenant, event, data)`). Usado pelo Agent Python para empurrar eventos de "step" em tempo real para o frontend.
- **Auth/tenant aplicados globalmente:** após `/auth` e `/internal/emit`, o app faz `app.use(authMiddleware); app.use(tenantMiddleware);` — tudo abaixo exige JWT válido + tenant ativo.
- **Error handler global:** `app.js:83-95` — retorna `{ error, stack? }` respeitando `err.status` (fallback 500); loga no console se status >= 500; stack só em `NODE_ENV=development`.
- **Sem rate limiting ativo** — `express-rate-limit@7.4.1` está no `package.json` mas **não é usado em nenhum arquivo** (confirmar ausência de `rateLimit(` em `api/src/`).

## Middlewares

### auth middleware — `api/src/middleware/auth.js`
- **`authMiddleware` (linhas 8-22):** lê `Authorization: Bearer <token>`, verifica com `jwt.verify(token, JWT_SECRET)` e anexa `req.user` com payload `{ userId, role, tenantId, tenantSlug, isSuperAdmin }`. Erros → `401 'Token ausente'` ou `'Token inválido ou expirado'` via `createError()` (do `lib/errors.js`).
- **`requireSuperAdmin` (linhas 27-32):** exige `req.user.isSuperAdmin === true`. Usado nas rotas `/admin/*` via `router.use(requireSuperAdmin)`.
- **`requireAdmin` (linhas 37-42):** exige `req.user.role === 'admin'` (tenant admin, não superadmin). **Definido mas não usado em nenhum router** — rota `/settings/*` confia apenas em JWT válido, sem distinção de papel.

### tenant isolation middleware — `api/src/middleware/tenant.js`
Resolve o schema PostgreSQL e anexa `req.tenantSchema` + `req.tenantId`.

- **Usuários normais:** extrai `tenantId` do JWT, consulta `prisma.tenant.findUnique({ id: tenantId })` e bloqueia se tenant inativo (`403 'Tenant inativo ou não encontrado'`). `req.tenantSchema = tenant.slug`.
- **Superadmin:** pode passar header `x-tenant-slug: <slug>` para alternar contexto; se ausente, escolhe o primeiro tenant ativo por `createdAt asc`. Sem bloqueio por `active` (superadmin vê tudo).
- **Não usa `SET search_path`** — o padrão do codebase é **interpolar o slug literal em queries raw**: `prisma.$queryRawUnsafe('SELECT ... FROM "${schema}".devices WHERE ...', params)`. O slug passou pela validação `/^[a-z0-9-]+/` na criação (`admin/tenants.js:14`), mas ainda assim **a string chega sem escape em toda a API** — esse é um padrão de SQLi latente se alguém contornar a validação (não é bug listado, mas vale observar).

### Outros middlewares
- **`helmet`, `cors`, `express.json`, `morgan`** — globais em `app.js`. Sem configuração customizada além de CORS origin = `PUBLIC_URL`.
- **Não há middleware de logging estruturado** (apenas `morgan combined` em stdout).
- **Não há middleware de rate limit, captcha ou brute-force protection** — o endpoint `POST /auth/login` é exposto publicamente e itera sobre **todos os tenants ativos** chamando `bcrypt.compare` (custo O(n_tenants)), o que é um vetor de enumeração/timing + CPU burn (não listado em AUDIT, mas relevante).

## Rotas REST (por domínio)

### Auth — `api/src/routes/auth.js` (montado em `/auth`, público)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| POST | /auth/login | routes/auth.js:17 | nenhuma | Auto-descoberta de tenant pelo e-mail. Primeiro tenta `platform_users` (superadmin). Se não achar, itera `prisma.tenant.findMany({ active: true })` rodando `SELECT ... FROM "<slug>".users WHERE email = $1` até encontrar. Valida com `bcrypt.compare`, atualiza `last_login_at`, retorna `{ token, user, tenantSlug }`. JWT expira em **8h**. |
| POST | /auth/refresh | routes/auth.js:109 | JWT válido (não expirado) | Renova token com mesmo payload por mais 8h. Não implementa refresh tokens rotativos. |

### Devices — `api/src/routes/devices.js` (montado em `/devices`, JWT + tenant)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /devices | routes/devices.js:22 | JWT | Lista dispositivos ativos do tenant, ordenados por nome. |
| GET | /devices/:id | routes/devices.js:36 | JWT | Retorna um dispositivo (inclui tags, location, last_seen_at). |
| POST | /devices | routes/devices.js:50 | JWT | Cria dispositivo. Valida payload com Zod (`name`, `type` em `mikrotik\|linux\|docker_host`, `host`, `port` 1-65535 default 22, `username`, `password`, `description?`, `location?`, `tags[]`). Senha é criptografada via `encryptionService.encryptPassword` (AES-256-GCM) antes de gravar em `password_encrypted`. |
| PATCH | /devices/:id | routes/devices.js:71 | JWT | Update parcial com whitelist de campos `['name', 'host', 'port', 'username', 'description', 'location', 'tags', 'active']`. Se `password` vier no body, re-criptografa. |
| DELETE | /devices/:id | routes/devices.js:97 | JWT | **Soft delete** (`active = false`). |
| POST | /devices/:id/test | routes/devices.js:109 | JWT | Teste SSH síncrono com `ssh2@1.17`. Timeout 12s. Para `mikrotik` roda `/system resource print`; para Linux roda bloco de comandos (`uptime`, CPU, MEM, OS, hostname). Retorna `{ ok: true, metrics }` ou `{ ok: false, error }`. Handle de erros traduz `ECONNREFUSED`, `ETIMEDOUT`, `Authentication`, `ENOTFOUND` para PT-BR. Usa algoritmos legados (`aes128-cbc`, `3des-cbc`, `diffie-hellman-group14-sha1`) para compatibilidade com RouterOS antigos. |

### Conversations — `api/src/routes/conversations.js` (montado em `/conversations`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /conversations | routes/conversations.js:9 | JWT | Lista conversas do tenant com preview (última mensagem não-vazia). Query params: `channel` (filtro literal interpolado — ver bug latente de SQLi se `channel` vier com aspas), `limit=50`, `offset=0`. |
| GET | /conversations/:id | routes/conversations.js:37 | JWT | Retorna conversa + todas as mensagens (role, content, device_id, tool_calls, reasoning, audio_url, tokens_used). |
| POST | /conversations | routes/conversations.js:61 | JWT | Cria conversa `channel='web'` vinculada ao `req.user.userId`. |
| DELETE | /conversations/:id | routes/conversations.js:75 | JWT | Remove conversa (cascata apaga mensagens via FK). |

### Messages — `api/src/routes/messages.js` (montado em `/messages`) — **endpoint mais crítico**
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| POST | /messages | routes/messages.js:10 | JWT | Envia mensagem pelo chat web. Salva `user message`, atualiza `conversations.last_activity_at`, emite `agent:thinking` no socket, chama **`POST ${AGENT_URL}/chat`** com **timeout axios de 120_000ms** (ver AUDIT-BUG-011). Recebe `response, tool_calls, reasoning, tokens_used, pending_action, resolved_device_id`. Se há `pending_action`, persiste em `pending_actions` e emite `agent:pending_action`. Emite `agent:tool_calls` e `agent:response`. Tratamento de erro distingue `ECONNREFUSED` (503), timeout e erro genérico — emite `agent:error` antes de responder. |
| GET | /messages/:conversationId | routes/messages.js:149 | JWT | Mensagens paginadas (query `limit=50`, `before=<timestamp>`). Faz LEFT JOIN com `pending_actions` para anexar objeto `pending_action`. |
| DELETE | /messages/:conversationId | routes/messages.js:188 | JWT | Apaga histórico de mensagens da conversa. |

### WhatsApp Users — `api/src/routes/whatsappUsers.js` (montado em `/whatsapp-users`)
Arquivo é **stub vazio**; todas as rotas efetivas ficam em `/settings/whatsapp-users` (ver settings.js). O import existe só para não quebrar `app.js`.

### Settings — `api/src/routes/settings.js` (montado em `/settings`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /settings/users | routes/settings.js:25 | JWT | Lista usuários do tenant. |
| POST | /settings/users | routes/settings.js:35 | JWT | Cria usuário (`email`, `password>=8`, `name?`, `role` ∈ admin\|operator\|readonly). `bcrypt.hash` com 12 salt rounds. |
| GET | /settings/whatsapp-users | routes/settings.js:54 | JWT | Lista whatsapp_users autorizados a falar com o bot. |
| POST | /settings/whatsapp-users | routes/settings.js:64 | JWT | Adiciona número WhatsApp autorizado (`number` 10-20 chars, `role`). |
| DELETE | /settings/whatsapp-users/:id | routes/settings.js:80 | JWT | Soft delete (`active = false`). |
| GET | /settings | routes/settings.js:93 | JWT | Lista settings não-criptografados do tenant como objeto `{ key: value }`. |
| PATCH | /settings | routes/settings.js:103 | JWT | Upsert de settings com whitelist: `alert_cpu_threshold`, `alert_check_interval`, `daily_report_hour`, `daily_report_enabled`, `require_approval_for`, `language`, `agent_mode`, `llm_provider`, `llm_model`. |
| POST | /settings/llm-key | routes/settings.js:126 | JWT | Salva API key LLM criptografada (AES-256-GCM). |
| DELETE | /settings/llm-key | routes/settings.js:145 | JWT | Limpa `llm_api_key` (fallback para `.env` do Agent). |
| POST | /settings/whatsapp-config | routes/settings.js:158 | JWT | Grava `evolution_instance` (plain) + `evolution_key` (criptografado). |
| GET | /settings/whatsapp-status | routes/settings.js:183 | JWT | Descriptografa a chave e chama `GET ${EVOLUTION_BASE_URL}/instance/connectionState/<instance>` com timeout 8s. Retorna `{ state }`. |

### Status — `api/src/routes/status.js` (montado em `/status`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /status | routes/status.js:7 | JWT | Lista devices ativos e, para cada um, consulta `redis://...` na chave `status:<schema>:<deviceId>` (escrita pelo Agent Python). Se Redis indisponível, retorna devices com `metrics: null` (não falha). |

### Pending Actions (v1) — `api/src/routes/pendingActions.js` (montado em `/pending-actions`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /pending-actions | routes/pendingActions.js:9 | JWT | Lista ações pendentes (query `status=pending`). |
| POST | /pending-actions/:id/approve | routes/pendingActions.js:25 | JWT | Muda status para `approved`, emite `action:approved` no socket. **Não executa** — espera o Agent escutar o evento. |
| POST | /pending-actions/:id/reject | routes/pendingActions.js:48 | JWT | Muda status para `rejected`, emite `action:rejected`. |

### Actions (v2) — `api/src/routes/actions.js` (montado em `/actions`) — executa SSH direto
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /actions | routes/actions.js:47 | JWT | Lista pending_actions com JOIN em devices (device_name, device_type), query `status=pending`, `limit=20`. |
| POST | /actions/:id/approve | routes/actions.js:66 | JWT | **Aprova E executa** sequencialmente os comandos via SSH (função `runSSHCommands` interna, ssh2@1.17, readyTimeout 15s). Transições de status: `pending → executing → executed` ou `failed`. Emite `action:executing`, `action:executed`, `action:failed`. Persiste outputs em `impact_analysis` (json). |
| POST | /actions/:id/reject | routes/actions.js:130 | JWT | Rejeita, emite `action:rejected`. |

> **Coexistência de dois caminhos de aprovação:** o frontend pode usar ambos. `/pending-actions/approve` só marca e delega ao Agent via socket; `/actions/approve` executa SSH na própria API Node. Ver `AGENT-AND-MCP.md` para o fluxo preferido.

### Skills (tenant view) — `api/src/routes/skills.js` (montado em `/skills`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /skills | routes/skills.js:10 | JWT | Lista skills globais ativas (`public.skills`) com LEFT JOIN em `public.skill_tenant_overrides` para computar `enabled` no contexto do tenant. |
| POST | /skills/:id/toggle | routes/skills.js:34 | JWT | `{ enabled: boolean }` — se `true`, deleta override (volta ao default global); se `false`, upsert com `active=false`. |

### Automations — `api/src/routes/automations.js` (montado em `/automations`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /automations | routes/automations.js:10 | JWT | Lista automações do tenant com JOIN em `public.skills` (skill_name, skill_category). Faz parse defensivo de `target_devices` (vem como string JSON). |
| POST | /automations | routes/automations.js:29 | JWT | Cria (`name`, `skill_id`, `target_devices[]`, `cron_expression`, `notification_target` default `'default'`). Usa `escapeId()` (aspas duplas) para o schema. |
| PUT | /automations/:id | routes/automations.js:53 | JWT | Update parcial (COALESCE em cada campo). |
| DELETE | /automations/:id | routes/automations.js:80 | JWT | Remove. |

### Backups — `api/src/routes/backups.js` (montado em `/backups`)
Opera em `/var/backups/netagent/<deviceId>/<arquivo>` (filesystem, não DB). Diretório organizado por UUID do dispositivo.

| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /backups | routes/backups.js:20 | JWT | Lista arquivos nas pastas de devices **que pertencem ao tenant** (filtra por `deviceMap`). Retorna `{ id, deviceId, deviceName, filename, sizeBytes, createdAt }`. |
| GET | /backups/linked | routes/backups.js:85 | JWT | Lista devices do tenant que já têm pasta criada em `/var/backups/netagent/`. |
| GET | /backups/download/:deviceId/:filename | routes/backups.js:118 | JWT | `res.download(filePath)`. Valida path traversal (`..`, `/` no filename) + ownership do device. |
| DELETE | /backups/folders/:deviceId | routes/backups.js:149 | JWT | `fs.rm(deviceDir, { recursive: true })` após validar ownership. |
| DELETE | /backups/:deviceId/:filename | routes/backups.js:178 | JWT | Apaga arquivo individual com validação de path. |
| GET | /backups/settings | routes/backups.js:210 | JWT | Lê `/var/backups/netagent/.ftp_settings.json` (`{ user, password, port }`). |
| PUT | /backups/settings | routes/backups.js:225 | JWT | **Executa `chpasswd`, `sed -i /etc/vsftpd.conf` e `systemctl restart vsftpd`** como root (PM2 roda como root). Muda senha do `backup_user` no sistema + porta do vsftpd. Qualquer usuário autenticado pode alterar — não há checagem de `requireAdmin`. |
| POST | /backups/folders/:deviceId | routes/backups.js:264 | JWT | Cria pasta `/var/backups/netagent/<id>` e roda `chown backup_user:backup_user` + `chmod 755` via `exec`. |

### WireGuard client-side (interfaces em Mikrotik do cliente) — `api/src/routes/wireguard.js` (montado em `/wireguard`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /wireguard/interfaces | routes/wireguard.js:61 | JWT | Lista interfaces wg configuradas em devices do tenant. |
| POST | /wireguard/interfaces | routes/wireguard.js:74 | JWT | Cria interface no Mikrotik via SSH (`/interface wireguard add ...`) e persiste no DB. Zod: `deviceId`, `name`, `listenPort`, `privateKey`, `publicKey`, `comment?`. |
| DELETE | /wireguard/interfaces/:id | routes/wireguard.js:109 | JWT | Remove via SSH (`/interface wireguard remove [find name=...]`) e do DB. Se SSH falha, ainda apaga do DB (com warning). |
| GET | /wireguard/pools | routes/wireguard.js:145 | JWT | Lista pools de IP. |
| POST | /wireguard/pools | routes/wireguard.js:158 | JWT | Cria pool (`interfaceId`, `name`, `startIp`, `endIp`). Apenas DB — não toca no Mikrotik. |
| DELETE | /wireguard/pools/:id | routes/wireguard.js:184 | JWT | Apaga pool do DB. |
| GET | /wireguard/peers | routes/wireguard.js:211 | JWT | Lista peers com JOIN em interfaces/devices. |
| POST | /wireguard/peers | routes/wireguard.js:225 | JWT | Cria peer (3 comandos SSH separados): `/interface wireguard peers add`, `/queue simple add` (bandwidth), `/system scheduler add` (expiração). Grava no DB com `traffic_limit` convertido em bytes. |
| DELETE | /wireguard/peers/:id | routes/wireguard.js:307 | JWT | Remove peer + queue + scheduler do Mikrotik (best-effort) e do DB. |

### WireGuard server-side (VPN hospedada no container `netagent-wireguard`) — `api/src/routes/wg_server.js` (montado em `/wg_server`)
Cada tenant recebe uma interface `wg_<slug>` isolada em `/var/www/agente_forum_telecom/data/wireguard/wg_<slug>.conf`, porta `51821+`, subnet `10.100.<n>.0/24`. Usa `docker exec netagent-wireguard` para chamar `wg genkey`, `wg-quick up`, `wg syncconf`, `wg show`.

| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /wg_server/status | routes/wg_server.js:114 | JWT | `ensureTenantVPN(slug)` (aloca porta/subnet/keys na 1ª chamada), lê `wg show ... dump` para dados live (handshake, bytes rx/tx), junta com peers do DB e retorna `{ interfaceName, subnet, serverIp, port, serverPublicKey, endpoint, peers[] }`. |
| POST | /wg_server/peers | routes/wg_server.js:175 | JWT | Aloca próximo IP livre, gera par de chaves cliente, appendFile no conf, roda `wg syncconf` (sem restart), salva no DB. Retorna **`private_key` do cliente em claro** no JSON de resposta (necessário para gerar config, mas sensível). |
| DELETE | /wg_server/peers/:id | routes/wg_server.js:243 | JWT | Remove bloco `[Peer]` do conf via regex, roda `wg syncconf`, apaga do DB. |

> `wg_server.js` instancia seu próprio `new PrismaClient()` em vez de usar `../db/prisma` — pequena inconsistência no codebase.

### Admin — Tenants — `api/src/routes/admin/tenants.js` (montado em `/admin/tenants`, requer `isSuperAdmin`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /admin/tenants | admin/tenants.js:21 | superadmin | Lista todos os tenants com `plan.name`. |
| POST | /admin/tenants | admin/tenants.js:32 | superadmin | Cria tenant. Zod valida `slug` como `/^[a-z0-9-]+$/`. Chama `tenantService.createTenant` que: (1) insere em `public.tenants`; (2) `SELECT public.create_tenant_schema($1)` para materializar o schema com todas as tabelas (stored function no Postgres); (3) insere primeiro user `admin` no schema do tenant. |
| PATCH | /admin/tenants/:id | admin/tenants.js:44 | superadmin | Update parcial com whitelist `['name', 'active', 'planId', 'evolutionInstance', 'evolutionKey', 'gptModel']`. |

### Admin — Skills (globais) — `api/src/routes/admin/skills.js` (montado em `/admin/skills`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /admin/skills | admin/skills.js:9 | superadmin | Lista `public.skills` + contagem de tenants que desabilitaram (`disabled_count`). Trata BigInt via JSON.stringify custom. |
| POST | /admin/skills | admin/skills.js:24 | superadmin | Cria skill global (aceita camelCase e snake_case). Campos: `name`, `display_name`, `description`, `category`, `device_type?`, `prompt_template?`, `steps[]`, `examples[]`. |
| PATCH | /admin/skills/:id | admin/skills.js:51 | superadmin | Update parcial com dynamic SQL (constrói `SET $1, $2...`). |
| DELETE | /admin/skills/:id | admin/skills.js:79 | superadmin | Hard delete. |

### Admin — Knowledge Base (RAG) — `api/src/routes/admin/knowledge.js` (montado em `/admin/knowledge`)
| Método | Path | Arquivo:linha | Auth | Descrição |
|---|---|---|---|---|
| GET | /admin/knowledge | admin/knowledge.js:9 | superadmin | Lista `public.knowledge_base` com filtros `category`, `source`, `device_type`, `search` (ILIKE em title/content), paginação `limit=100, offset=0`. Retorna `has_embedding` (flag, não o vetor em si). |
| GET | /admin/knowledge/:id | admin/knowledge.js:38 | superadmin | Detalhe de uma entrada. |
| POST | /admin/knowledge | admin/knowledge.js:52 | superadmin | Cria entrada manual (`title`, `content`, `category?`, `device_type?`, `source?` default `'manual'`). Embedding fica NULL — gerado depois via endpoint abaixo. |
| PUT | /admin/knowledge/:id | admin/knowledge.js:68 | superadmin | Atualiza e **zera embedding** (`embedding = NULL`) para forçar regeneração. |
| PATCH | /admin/knowledge/:id | admin/knowledge.js:88 | superadmin | Ajuste apenas do `quality_score`. |
| DELETE | /admin/knowledge/:id | admin/knowledge.js:102 | superadmin | Remove. |
| POST | /admin/knowledge/generate-embeddings | admin/knowledge.js:112 | superadmin | Proxy para `POST ${AGENT_URL}/admin/generate-embeddings` (usa `node-fetch` via dynamic import). |

## WebSocket (Socket.io) — `api/src/socket.js`

- Versão `socket.io@4.8.1` (afetada pela CVE de socket.io-parser — ver AUDIT-BUG-004).
- Path: `/socket.io`. CORS com `origin: PUBLIC_URL`, methods `GET/POST`, `credentials: true`.
- **Autenticação:** `io.use()` middleware lê `socket.handshake.auth.token`, verifica JWT com mesmo `JWT_SECRET` da REST API. Falha → `next(new Error('Token inválido'))`.
- **Rooms que o cliente entra automaticamente ao conectar:**
  - `tenant:<tenantSlug>` — usado por `emitToTenant()`
  - `user:<userId>` — usado por `emitToUser()`
- **Eventos escutados do cliente:**
  - `join_conversation(conversationId: string)` — entra em `conversation:<id>` para re-sincronização após reconexão.
  - `leave_conversation(conversationId: string)` — sai do room.
  - `disconnect` — cleanup automático do Socket.io.
- **Eventos emitidos pelo servidor** (encontrados nos routers):
  - `agent:thinking` — início da conversa com o Agent (messages.js:37)
  - `agent:tool_calls` — lista de ferramentas chamadas + reasoning (messages.js:100)
  - `agent:pending_action` — ação pendente criada (messages.js:93)
  - `agent:response` — resposta final do assistente (messages.js:114)
  - `agent:error` — erro ao chamar o Agent (messages.js:136)
  - `action:approved` — pending_actions.js:41
  - `action:rejected` — pending_actions.js:63, actions.js:147
  - `action:executing` — actions.js:94
  - `action:executed` — actions.js:113
  - `action:failed` — actions.js:122
  - eventos customizados de skills — empurrados pelo Agent via `POST /internal/emit`
- **Helpers exportados:** `emitToTenant(tenantSlug, event, data)`, `emitToUser(userId, event, data)`.

## Services (`api/src/services/`)

| Arquivo | Propósito |
|---|---|
| `encryptionService.js` | AES-256-GCM. Chave de 32 bytes lida de `process.env.ENCRYPTION_KEY` (hex). Formato do cipher: `ivHex:tagHex:dataHex`. Usado para senhas SSH de devices e API keys (LLM, Evolution). |
| `tenantService.js` | `createTenant({ name, slug, adminEmail, adminPassword, planId? })` — transação em 3 passos: (1) `prisma.tenant.create`; (2) `SELECT public.create_tenant_schema($1)` (função PL/pgSQL que materializa o schema com ~12 tabelas); (3) insere primeiro user admin em `"<slug>".users` com bcrypt 12 rounds. |

Há também helpers utilitários **inline em routes** (não em `services/`): `runSSHCommand` em `wireguard.js` e `actions.js`, `testSSHConnection` + parsers em `devices.js`, `ensureTenantVPN`/`generateKeys` em `wg_server.js`.

## Integração com Agent Python

A API chama o Agent em `${process.env.AGENT_URL || 'http://localhost:8000'}` via **axios direto**, não via fila ou event bus. Pontos de integração:

- `POST /messages` → `POST ${AGENT_URL}/chat` com **timeout de 120_000 ms** (messages.js:50). Esse é o ponto mais provável do AUDIT-BUG-011 (`AxiosError: timeout of 120000ms exceeded`).
- `POST /admin/knowledge/generate-embeddings` → `POST ${AGENT_URL}/admin/generate-embeddings` (admin/knowledge.js:117).
- No sentido inverso: o Agent usa `POST /internal/emit` (header `x-internal-secret`) para empurrar eventos ao Socket.io da API (streaming de steps de skill).

Detalhes do Agent (FastAPI, uvicorn, tools MCP) em `AGENT-AND-MCP.md`.

## Integração com Evolution API

A API **não recebe webhooks do WhatsApp diretamente** — quem recebe é o Agent (ver `AGENT-AND-MCP.md`). A API apenas:

- Armazena config criptografada (`evolution_instance`, `evolution_key`) em `POST /settings/whatsapp-config`.
- Consulta status de conexão em `GET /settings/whatsapp-status` chamando `${EVOLUTION_BASE_URL || 'https://agenteevo.forumtelecom.com.br'}/instance/connectionState/<instance>` com header `apikey` descriptografada, timeout 8s.

## Pontos de atenção

- [AUDIT-BUG-002 — porta 4000 aberta publicamente](AUDIT-2026-04-21.md#audit-bug-002) — `httpServer.listen(PORT)` em `index.js:11` não especifica host, então bind em `0.0.0.0`. Combinada com regra UFW `allow 4000/tcp`, a API fica acessível sem passar pelo Traefik (sem TLS, sem WAF).
- [AUDIT-BUG-004 — vulnerabilidades npm em path-to-regexp, socket.io-parser, tar/bcrypt](AUDIT-2026-04-21.md#audit-bug-004) — Express 5 e Socket.io 4.8.1 arrastam dependências com 6 CVEs HIGH. `npm audit fix --force` requer testar `bcrypt@6`.
- [AUDIT-BUG-010 — PrismaClientKnownRequestError recorrente 2026-03-03](AUDIT-2026-04-21.md#audit-bug-010) — Múltiplas falhas em ~20s. Principais suspeitos: violação de FK em `messages.pending_action_id`, race na criação de `pending_actions` com `device_id` NULL, ou tentativa de `INSERT` em schema de tenant recém-desativado.
- [AUDIT-BUG-011 — AxiosError timeout 120s](AUDIT-2026-04-21.md#audit-bug-011) — Origem quase certa: `messages.js:50` (`axios.post(AGENT_URL + '/chat', ..., { timeout: 120_000 })`). Agent demora > 2 min em chats com múltiplas chamadas SSH sequenciais ou LLM travado.
- **Observações adicionais não listadas no AUDIT:**
  - `POST /auth/login` itera todos os tenants com `bcrypt.compare` em cada match — custo O(n_tenants) e permite enumeração por timing.
  - `requireAdmin` está definido mas **não é usado** em nenhuma rota; qualquer usuário autenticado (`role='readonly'` inclusive) pode chamar `PUT /backups/settings` e rodar `chpasswd`/`systemctl restart vsftpd` como root.
  - Padrão em todo o codebase: `prisma.$queryRawUnsafe('... "${schema}" ...')` interpolando o slug. Seguro enquanto a validação Zod de criação (`/^[a-z0-9-]+$/`) for respeitada, mas vulnerável se alguém inserir tenant manualmente no DB sem passar pela API.
  - `express-rate-limit@7.4.1` está no `package.json` mas **nenhum router usa** — endpoints `/auth/login`, `/messages`, `/devices/:id/test` ficam sem proteção de taxa.
  - `wg_server.js:10` cria `new PrismaClient()` próprio em vez de reusar `db/prisma.js` — dobra o connection pool.
