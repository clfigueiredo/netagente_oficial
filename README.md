# 🛰️ NetAgent Platform

**Plataforma de Gerenciamento Inteligente de Redes para ISPs** — Agente de IA que monitora, diagnostica e gerencia dispositivos MikroTik e servidores Linux via chat conversacional e WhatsApp.

---

## 📋 Visão Geral

O NetAgent é uma plataforma multi-tenant SaaS que permite ISPs gerenciarem sua infraestrutura de rede usando um agente de IA especializado. O agente entende comandos em linguagem natural, executa diagnósticos via SSH, gerencia backups automáticos e envia alertas via WhatsApp.

### Arquitetura

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
        │+pgvector │ │  7    │    │ MikroTik + Linux │
        └──────────┘ └───────┘    └──────────────────┘
                                         │
              ┌──────────────────────────┤
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
| **Frontend** | React + Vite + Tailwind | Dashboard com chat, devices, backups, WireGuard, automações |
| **API** | Node.js + Express + Prisma | REST API multi-tenant, WebSocket (Socket.io) |
| **Agent** | Python + FastAPI + OpenAI | Agente IA com orquestrador de skills e RAG memory |
| **MCP MikroTik** | Python (Docker) | Driver SSH para dispositivos MikroTik via RouterOS CLI |
| **MCP Linux** | Python (Docker) | Driver SSH para servidores Linux |
| **WireGuard** | Docker container | VPN concentrador para acesso seguro a redes dos clientes |
| **Database** | PostgreSQL 16 + pgvector | Multi-schema (tenant isolation) + embeddings para RAG |
| **Cache** | Redis 7 | Sessões, cache, filas |
| **WhatsApp** | Evolution API v2 | Integração WhatsApp para alertas e chat com o agente |
| **Proxy** | Traefik v3 | Reverse proxy com SSL automático (Let's Encrypt) |

---

## 📁 Estrutura de Diretórios

```
agente_forum_telecom/
├── api/                    # Backend Node.js (Express)
│   ├── prisma/             #   Schema Prisma (models públicos)
│   ├── scripts/            #   SQL migrations & seeds
│   └── src/
│       ├── db/             #   init.sql (schema completo)
│       ├── lib/            #   Utilitários
│       ├── middleware/     #   Auth, tenant isolation
│       ├── routes/         #   REST endpoints
│       ├── services/       #   Encryption, tenant
│       └── socket.js       #   WebSocket events
│
├── agent/                  # Agente Python (FastAPI)
│   ├── agents/             #   Definições de especialistas (MD)
│   ├── mcp/                #   MCP client (circuit breaker, bridge)
│   ├── memory/             #   RAG memory (pgvector embeddings)
│   ├── services/           #   Encryption
│   ├── tools/              #   MikroTik, Linux, base tools
│   ├── orchestrator.py     #   Orquestrador principal de skills
│   ├── monitor.py          #   Monitor de dispositivos
│   ├── scheduler.py        #   Agendador de tarefas
│   └── whatsapp.py         #   Webhook WhatsApp
│
├── frontend/               # Frontend React (Vite)
│   └── src/
│       ├── components/     #   UI components
│       ├── pages/          #   19 páginas (Dashboard, Chat, Devices, etc)
│       ├── lib/            #   API client, socket
│       └── store/          #   Auth store
│
├── mcp-mikrotik/           # MCP Driver MikroTik (Docker)
├── mcp-linux/              # MCP Driver Linux (Docker)
│
├── docker/
│   └── wireguard/          #   Dockerfile do WireGuard concentrador
│
├── installer/              # Pacote de instalação legado
│   ├── build.sh            #   Geração de tarball distribuível
│   └── scripts/install.sh  #   Instalador antigo (DEPRECATED — usar scripts da raiz)
│
├── traefik/                # Config do reverse proxy
│   ├── certs/              #   Certificados SSL (auto-gerados)
│   ├── config/             #   Rotas para serviços no host
│   └── nginx-frontend.conf
│
├── data/                   # Runtime data (NÃO versionado)
│   ├── postgres/
│   ├── redis/
│   ├── evolution/
│   └── wireguard/
│
├── docs/                   # Documentação
│
├── docker-compose.yml           # Orquestração de todos os containers
├── install.sh                   # ✅ Instalador completo (plataforma + Evolution)
├── install-no-evolution.sh      # ✅ Plataforma sem Evolution API
├── install-evolution-only.sh    # ✅ Evolution API em servidor dedicado
├── deploy.sh                    # Deploy incremental (produção)
├── deploy-frontend.sh           # Build + redeploy do frontend
├── server-setup.sh              # (legado) apenas infra Docker
└── .env.example                 # Template de variáveis de ambiente
```

---

## 🚀 Quick Start

### Pré-requisitos
- Debian 12 (Bookworm) limpo
- DNS dos domínios apontando para o servidor (SSL do Let's Encrypt depende disso)
- Chave da API OpenAI (`sk-...`)

### Cenário 1 — Plataforma completa (tudo num servidor só)

Instala API + Agent + Frontend + Postgres + Redis + **Evolution API** + MCPs + WireGuard + Traefik.

```bash
git clone https://github.com/clfigueiredo/netagente_oficial.git /var/www/agente_forum_telecom
cd /var/www/agente_forum_telecom
sudo bash install.sh
```

O script:
- Pergunta domínio da plataforma, domínio da Evolution, e-mail SSL, e-mail do superadmin, chave OpenAI
- Gera Postgres/Redis/JWT/Encryption/InternalAPI/EvolutionGlobal (chaves novas a cada run)
- Instala Docker 29, Node 20 + PM2 + logrotate, Python 3.11, UFW (22/80/443/51820-udp), cron, fail2ban
- Build do frontend (Vite), `npm install` da API, venv do Agent
- Sobe 8 containers (`docker compose up -d --build`)
- Aplica schema (plans, skills, `create_tenant_schema()`) + migrations
- Cria banco `evolution` (Evolution v2 exige)
- Cria superadmin inicial com senha aleatória
- Inicia API + Agent no PM2 (com `pm2 startup systemd`)
- Imprime URLs, chave Evolution e senha do superadmin

### Cenário 2 — Plataforma SEM Evolution API

Idêntico ao cenário 1, mas o container e o banco `evolution` não são criados. Use quando a Evolution vai rodar em um servidor separado (ou não vai rodar). Pré-requisito do WhatsApp/Agent fica inoperante.

```bash
git clone https://github.com/clfigueiredo/netagente_oficial.git /var/www/agente_forum_telecom
cd /var/www/agente_forum_telecom
sudo bash install-no-evolution.sh
```

Pergunta apenas o domínio da plataforma + e-mail SSL + superadmin + chave OpenAI. No final imprime um guia de 5 passos pra reativar a Evolution depois.

### Cenário 3 — Evolution API dedicada (servidor separado)

Um servidor Debian 12 só pra rodar a Evolution API (Traefik + Postgres + evolution). Não depende do resto do repo — o script é self-contained e escreve o próprio `docker-compose.yml`.

```bash
# Num servidor limpo:
curl -fsSL https://raw.githubusercontent.com/clfigueiredo/netagente_oficial/main/install-evolution-only.sh -o install-evolution-only.sh
sudo bash install-evolution-only.sh
```

Pergunta domínio da Evolution + e-mail SSL + diretório de instalação (default `/opt/evolution-api`). Gera `POSTGRES_PASSWORD` e `EVOLUTION_GLOBAL_KEY` novos, imprime a chave no final. Depois é só apontar `EVOLUTION_BASE_URL` + `EVOLUTION_GLOBAL_KEY` no `.env` da plataforma principal.

### Deploy incremental (servidor já instalado)

Para atualizar código após `git pull` num servidor que já rodou o `install.sh`:

```bash
cd /var/www/agente_forum_telecom
git pull
bash deploy.sh           # reinstala deps, reaplica schema, reinicia PM2
bash deploy-frontend.sh  # apenas rebuild do frontend
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

Os scripts `install.sh` / `install-no-evolution.sh` / `install-evolution-only.sh` **geram** o `.env` automaticamente. As chaves abaixo são criadas com `openssl rand -hex 32` a cada instalação — você só precisa fornecer `OPENAI_KEY` (e apenas nos scripts da plataforma).

| Variável | Origem | Descrição |
|---|---|---|
| `POSTGRES_PASSWORD` | gerada | Senha do PostgreSQL |
| `REDIS_PASSWORD` | gerada | Senha do Redis |
| `JWT_SECRET` | gerada | Secret para tokens JWT |
| `ENCRYPTION_KEY` | gerada | AES-256 para credenciais de dispositivos |
| `INTERNAL_API_SECRET` | gerada | Auth Agent→API interno |
| `EVOLUTION_GLOBAL_KEY` | gerada | Chave global da Evolution API |
| `OPENAI_KEY` | **fornecida** | Chave da OpenAI (`sk-...`) — perguntada pelo script |
| `PUBLIC_URL` | derivada | `https://${DOMAIN_PLATFORM}` |
| `VITE_API_URL` / `VITE_WS_URL` | derivadas | Injetadas no build do frontend |

O `.env.example` serve só como referência. Se você precisar regenerar um `.env` manualmente (ex.: restauração), use o template como base.

### Portas

| Porta | Serviço | Exposição |
|---|---|---|
| 80 / 443 | Traefik (HTTP/HTTPS) | Pública |
| 51820/udp | WireGuard VPN | Pública (concentrador) |
| 4000 | API Node.js (host, PM2) | loopback |
| 8000 | Agent Python (host, PM2) | loopback |
| 8001 | MCP MikroTik (Docker) | loopback |
| 8002 | MCP Linux (Docker) | loopback |
| 5432 | PostgreSQL | loopback |
| 6379 | Redis | loopback |
| 22 | SSH | Pública |

O instalador configura UFW permitindo somente SSH + 80 + 443 + 51820/udp. Os demais serviços ficam em `127.0.0.1:*`.

---

## 🔧 Desenvolvimento

```bash
# API
cd api && npm install && npm run dev

# Agent
cd agent && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend && pnpm install && pnpm dev

# Docker services
docker compose up -d postgres redis
```

---

## 📦 Gerar Pacote de Instalação

```bash
bash installer/build.sh
# Gera: netagent-installer.tar.gz
```

---

## 🛡️ Segurança

- Multi-tenant isolation via PostgreSQL schemas
- Credenciais de dispositivos criptografadas (AES-256)
- JWT authentication com bcrypt
- WireGuard VPN para acesso seguro
- UFW firewall configurado
- SSL automático via Let's Encrypt
- Banco e Redis apenas em localhost

---

## 📄 Licença

Proprietário — Forum Telecom © 2026
