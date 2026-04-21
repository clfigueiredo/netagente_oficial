# 🛰️ NetAgent Platform

**Plataforma de gerenciamento inteligente de redes para ISPs.** Agente de IA que monitora, diagnostica e gerencia MikroTiks e servidores Linux via chat web e WhatsApp.

---

## 📋 Visão Geral

Multi-tenant SaaS: cada cliente tem um schema dedicado em Postgres, isolamento por tenant em todas as rotas, agente Python com orquestrador de skills + RAG memory, MCPs dedicados para MikroTik e Linux, e WireGuard concentrador para acesso seguro às redes dos clientes.

```
┌─────────────┐   ┌──────────────┐   ┌──────────────────┐
│   Frontend   │──▶│   API Node   │──▶│  Agent Python    │
│  React/Vite  │   │   Express    │   │  FastAPI + GPT   │
└─────────────┘   └──────┬───────┘   └──────┬───────────┘
                         │                   │
              ┌──────────┼───────────────────┤
              ▼          ▼                   ▼
        ┌──────────┐ ┌───────┐    ┌──────────────────┐
        │PostgreSQL│ │ Redis │    │   MCP Drivers    │
        │+pgvector │ │   7   │    │ MikroTik + Linux │
        └──────────┘ └───────┘    └──────────────────┘
              │                          │
              ▼                          ▼
        ┌───────────┐          ┌──────────────────┐
        │ WireGuard │          │  Evolution API   │
        │   VPN     │          │   (WhatsApp)     │
        └───────────┘          └──────────────────┘
```

---

## 🏗️ Componentes

| Componente | Tecnologia | Descrição |
|---|---|---|
| Frontend | React + Vite + Tailwind | Dashboard: chat, devices, backups, WireGuard, automações |
| API | Node.js 20 + Express + Prisma | REST API multi-tenant + WebSocket (Socket.io) |
| Agent | Python 3.11 + FastAPI + OpenAI | Orquestrador de skills + RAG memory (pgvector) |
| MCP MikroTik | Python (Docker) | Driver SSH para RouterOS |
| MCP Linux | Python (Docker) | Driver SSH para servidores Linux |
| WireGuard | Docker (host network) | VPN concentrador |
| Database | PostgreSQL 16 + pgvector | Multi-schema (1 schema por tenant) |
| Cache | Redis 7 | Sessões, filas |
| WhatsApp | Evolution API v2 | Integração WhatsApp |
| Proxy | Traefik v3 | SSL automático (Let's Encrypt) |

---

## 📁 Estrutura do Repositório

```
agente_forum_telecom/
├── api/                         # Backend Node.js
│   └── src/db/init.sql          # Schema + seeds (gerado via pg_dump da produção)
├── agent/                       # Agent Python
├── frontend/                    # Frontend React
├── mcp-mikrotik/                # MCP MikroTik (Docker build)
├── mcp-linux/                   # MCP Linux (Docker build)
├── docker/wireguard/            # Dockerfile do WireGuard
├── traefik/                     # Reverse proxy + SSL
├── docs/                        # Documentação detalhada
├── docker-compose.yml           # Stack completa
├── install.sh                   # Instalador completo (plataforma + Evolution)
├── install-no-evolution.sh      # Plataforma sem Evolution API
├── install-evolution-only.sh    # Evolution API dedicada (servidor separado)
├── deploy.sh                    # Deploy incremental pós-git-pull
├── deploy-frontend.sh           # Rebuild + redeploy do frontend
└── .env.example                 # Template de variáveis (referência)
```

---

## 🚀 Instalação

### Pré-requisitos

1. **Servidor** — Debian 12 (Bookworm) com acesso root e IP público.
2. **Recursos mínimos** — 2 vCPU, 4 GB RAM, 50 GB disco (8 GB RAM recomendado para produção).
3. **DNS** — Registros A/AAAA apontando para o IP do servidor. Para `install.sh` você precisa de 2 domínios (ex.: `agente.seucliente.com.br` e `agenteevo.seucliente.com.br`). Para `install-no-evolution.sh` só 1 domínio. Let's Encrypt só emite cert se o DNS já estiver propagado.
4. **Chave OpenAI** — formato `sk-...`, pedida no prompt do installer (exceto em `install-evolution-only.sh`).

---

### Cenário 1 — Plataforma completa (recomendado para cliente único)

Instala **tudo num único servidor**: API, Agent, Frontend, Postgres, Redis, Evolution API, MCPs, WireGuard, Traefik.

```bash
# 1. Conectar no servidor como root
ssh root@SEU_IP_DO_SERVIDOR

# 2. Instalar git
apt-get update && apt-get install -y git

# 3. Clonar o repositório no caminho padrão
git clone https://github.com/clfigueiredo/netagente_oficial.git /var/www/agente_forum_telecom

# 4. Entrar na pasta e rodar o instalador
cd /var/www/agente_forum_telecom
bash install.sh
```

O `install.sh` vai perguntar:
- Domínio da Plataforma (ex.: `agente.seucliente.com.br`)
- Domínio da Evolution API (ex.: `agenteevo.seucliente.com.br`)
- E-mail para Let's Encrypt
- E-mail do superadmin
- **Slug do tenant inicial** (default: subdomínio da plataforma, ex.: `agente`)
- **Nome amigável do tenant** (ex.: `Forum Telecom`)
- Chave OpenAI (`sk-...`)

E em seguida executa automaticamente:
1. `apt install` pacotes base (curl, jq, openssl, ufw, fail2ban, cron, build-essential, postgresql-client-15)
2. Docker CE + Compose plugin
3. Node.js 20 + PM2 + `pm2-logrotate`
4. Python 3.11 + venv
5. UFW (22 / 80 / 443 / 51820-udp + docker bridge liberada)
6. Gera `.env` com chaves novas (Postgres, Redis, JWT, Encryption, Internal, Evolution) — só OpenAI vem do prompt
7. `sed` do `docker-compose.yml` (substitui domínios + detecta GID do grupo docker para o Traefik)
8. Build do frontend (Vite) com `VITE_API_URL` correto
9. `npm install` da API + `pip install` do Agent
10. `docker compose up -d --build` (8 containers)
11. Aguarda Postgres, cria banco `evolution`, aplica `api/src/db/init.sql` (gerado via `pg_dump` da produção — estrutura + seeds de plans/skills/knowledge_base)
12. Cria **superadmin** (email = o que você informou, senha random de 16 chars mostrada no final)
13. Cria o **tenant inicial** (schema próprio no Postgres com 15 tabelas + admin do tenant com a mesma senha do superadmin)
14. Inicia PM2 (`netagent-api` + `netagent-agent`) com `pm2 startup systemd`
15. Health checks + resumo final com URLs e credenciais

**Ao terminar**, o instalador imprime as credenciais. Anote — a senha não é reexibida. Acesse `https://SEU_DOMINIO_PLATAFORMA` e logue.

---

### Cenário 2 — Plataforma SEM Evolution API

Idêntico ao cenário 1, mas o container da Evolution não é criado e nenhum banco `evolution` é provisionado. Use quando a Evolution vai rodar em um servidor separado (cenário 3) ou quando o WhatsApp não é necessário.

```bash
ssh root@SEU_IP_DO_SERVIDOR
apt-get update && apt-get install -y git
git clone https://github.com/clfigueiredo/netagente_oficial.git /var/www/agente_forum_telecom
cd /var/www/agente_forum_telecom
bash install-no-evolution.sh
```

O prompt pede os mesmos dados do cenário 1, sem o domínio da Evolution. No resumo final tem um guia de 5 passos para reativar a Evolution quando quiser.

---

### Cenário 3 — Evolution API em servidor dedicado

Script **self-contained** — não depende do resto do repo, escreve o próprio `docker-compose.yml`.

```bash
ssh root@SEU_IP_DO_SERVIDOR_EVOLUTION
apt-get update && apt-get install -y git
git clone https://github.com/clfigueiredo/netagente_oficial.git /opt/netagent-src
cd /opt/netagent-src
bash install-evolution-only.sh
```

O prompt pede: domínio da Evolution (ex.: `evo.seucliente.com.br`), e-mail SSL, diretório de instalação (default `/opt/evolution-api`).

Sobe 3 containers: `traefik` (SSL), `evolution-postgres` (banco dedicado, usuário `evolution`), `evolution-api` v2.3.4. No final imprime a `EVOLUTION_GLOBAL_KEY` gerada — use no `.env` da plataforma principal em `EVOLUTION_GLOBAL_KEY` e `EVOLUTION_BASE_URL`.

---

## 📲 Webhook da Evolution API (WhatsApp)

O Agent Python expõe `POST /webhook` para receber mensagens do WhatsApp. O Traefik + nginx-frontend já proxy-passam esse path, então a URL pública pra configurar em cada instância da Evolution é:

```
https://SEU_DOMINIO_PLATAFORMA/webhook
```

**Configurar pela UI da Evolution** — abra `https://SEU_DOMINIO_EVOLUTION/manager`, selecione a instância → *Webhook* → cole a URL acima, marque os eventos `MESSAGES_UPSERT` (e outros que quiser) → salvar.

**Configurar via API** (mesma coisa em CLI):
```bash
curl -X POST https://SEU_DOMINIO_EVOLUTION/webhook/set/NOME_DA_INSTANCIA \
  -H "apikey: SUA_EVOLUTION_GLOBAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "url": "https://SEU_DOMINIO_PLATAFORMA/webhook",
    "webhookByEvents": false,
    "webhookBase64": false,
    "events": ["MESSAGES_UPSERT","CONNECTION_UPDATE","QRCODE_UPDATED"]
  }'
```

A `EVOLUTION_GLOBAL_KEY` está em `/var/www/agente_forum_telecom/.env` — o instalador também imprime no resumo final.

Vale para os 3 cenários de instalação: o webhook é sempre o **domínio da plataforma**, independente de a Evolution estar no mesmo servidor (cenário 1) ou em um servidor separado (cenário 3).

---

## 🔄 Atualizações em servidores já instalados

**Nunca rode `install.sh` duas vezes no mesmo servidor** — ele regenera o `.env` com senhas novas enquanto os volumes Postgres/Redis ainda têm as senhas antigas, e a stack quebra. Pra atualizar código:

```bash
cd /var/www/agente_forum_telecom
git pull
bash deploy.sh              # reinstala deps da API/Agent/Frontend + reaplica init.sql + reinicia PM2
# ou apenas:
bash deploy-frontend.sh     # rebuild + redeploy só do frontend
```

O `init.sql` é idempotente: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`. `deploy.sh` pode rodar várias vezes sem corromper dados.

**Se precisar reinstalar do zero no mesmo servidor:**
```bash
cd /var/www/agente_forum_telecom && docker compose down -v
pm2 delete netagent-api netagent-agent 2>/dev/null
rm -rf /var/www/agente_forum_telecom
# agora pode clonar de novo e rodar install.sh
```

---

## ⚙️ Variáveis de Ambiente

Os instaladores geram `.env` automaticamente. Você só informa `OPENAI_KEY` no prompt.

| Variável | Origem | Descrição |
|---|---|---|
| `POSTGRES_PASSWORD` | gerada | Senha do PostgreSQL |
| `REDIS_PASSWORD` | gerada | Senha do Redis |
| `JWT_SECRET` | gerada | Secret para tokens JWT |
| `ENCRYPTION_KEY` | gerada | AES-256 de credenciais de dispositivos |
| `INTERNAL_API_SECRET` | gerada | Auth Agent → API interno |
| `EVOLUTION_GLOBAL_KEY` | gerada | Header `apikey` da Evolution |
| `OPENAI_KEY` | **você fornece** | Chave OpenAI (`sk-...`) |
| `PUBLIC_URL` | derivada | `https://${DOMAIN_PLATFORM}` |
| `VITE_API_URL` / `VITE_WS_URL` | derivadas | Injetadas no build do frontend |

O `.env.example` é apenas referência — serve caso precise regenerar um `.env` manualmente.

---

## 🔌 Portas

| Porta | Serviço | Exposição |
|---|---|---|
| 22 | SSH | Pública |
| 80 / 443 | Traefik (HTTP/HTTPS) | Pública |
| 51820/udp | WireGuard VPN | Pública |
| 4000 | API Node.js (host, PM2) | loopback |
| 8000 | Agent Python (host, PM2) | loopback |
| 8001 | MCP MikroTik (Docker) | loopback |
| 8002 | MCP Linux (Docker) | loopback |
| 5432 | PostgreSQL | loopback |
| 6379 | Redis | loopback |

UFW: somente 22 / 80 / 443 / 51820-udp abertas + regra de liberação da bridge `docker0` (para o nginx-frontend conversar com API/Agent no host).

---

## 🧪 Desenvolvimento local

```bash
# API
cd api && npm install && npm run dev

# Agent
cd agent
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev

# Infra mínima para subir só o banco/cache
docker compose up -d postgres redis
```

---

## 🛡️ Segurança

- Multi-tenant via schemas Postgres isolados (criados por `public.create_tenant_schema(slug)`).
- Credenciais de dispositivos criptografadas em repouso (AES-256 com `ENCRYPTION_KEY`).
- Senhas de usuário em bcrypt cost 12.
- JWT expira em 8h; `/auth/refresh` emite novo token.
- WireGuard VPN para acesso às redes dos clientes.
- SSL automático (Let's Encrypt via Traefik).
- Postgres/Redis/API/Agent em `127.0.0.1` — somente Traefik (80/443), SSH e WireGuard expostos publicamente.

---

## 🩹 Troubleshooting

**Frontend abre mas login dá "credenciais inválidas"**
Teste direto contra a API:
```bash
curl -X POST http://127.0.0.1:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@seudominio.com.br","password":"SUA_SENHA"}'
```
Se aqui retorna `200` com token, o problema é o caminho HTTPS → container → host. Confira se a UFW liberou a bridge docker0:
```bash
ufw status | grep docker0
# Se ausente:
ufw allow in on docker0 to any
ufw allow from 172.16.0.0/12
ufw reload
```

**Let's Encrypt não emite certificado**
```bash
docker logs traefik 2>&1 | grep -i "acme\|error" | tail -20
```
Causas comuns: DNS ainda não propagou, porta 80 fechada no firewall do provedor, domínio com `/` no final (sanitizado no `install.sh` atual — reinstale se usou versão antiga).

**Chat com input desabilitado**
Verifique se existe um tenant ativo com schema criado:
```bash
docker exec netagent-postgres psql -U netagent -d netagent -tAc \
  "SELECT t.slug, (SELECT count(*) FROM information_schema.schemata WHERE schema_name=t.slug) AS schema_exists FROM public.tenants t"
```
Cada linha deve ter `schema_exists = 1`. Se o schema não foi criado (`0`), o tenant está quebrado — rode manualmente:
```bash
docker exec -i netagent-postgres psql -U netagent -d netagent -c "SELECT public.create_tenant_schema('SLUG_DO_TENANT')"
```
Depois faça logout/login no frontend pra o JWT pegar o tenant novo.

**Erro de coluna em tabela de tenant**
O `init.sql` é gerado do `pg_dump` da produção — novos tenants têm o schema completo. Se for servidor antigo com schema stale, rode `bash deploy.sh` que reaplica o `init.sql` com as migrations de retro-compat.

---

## 📄 Licença

Proprietário — Forum Telecom © 2026
