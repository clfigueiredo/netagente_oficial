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
| **FTP** | vsftpd | Servidor FTP para receber backups automáticos dos MikroTik |

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
├── installer/              # Pacote de instalação
│   ├── build.sh            #   Script de geração do pacote
│   └── scripts/
│       └── install.sh      #   Instalador universal (Debian/Ubuntu)
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
├── docker-compose.yml      # Orquestração de todos os containers
├── deploy.sh               # Deploy in-place (produção)
├── deploy-frontend.sh      # Build e deploy do frontend
├── server-setup.sh         # Setup completo do servidor (Debian 12)
└── .env.example            # Template de variáveis de ambiente
```

---

## 🚀 Quick Start

### Pré-requisitos
- Debian 12 / Ubuntu 22.04+
- Domínio apontando para o servidor
- Chave da API OpenAI

### Instalação Automática (Servidor Novo)

```bash
# 1. Clone o repositório
git clone https://github.com/SEU_USUARIO/agente_forum_telecom.git /opt/netagent
cd /opt/netagent

# 2. Use o instalador universal
sudo bash installer/scripts/install.sh
```

O instalador configura automaticamente:
- Docker + containers (PostgreSQL, Redis, Evolution, Traefik, WireGuard, MCPs)
- Node.js 20 + PM2
- Python 3.11 + venv
- vsftpd (FTP para backups)
- UFW (firewall)
- SSL automático (Let's Encrypt)

### Instalação Manual

```bash
# 1. Clone e configure
git clone https://github.com/SEU_USUARIO/agente_forum_telecom.git /opt/netagent
cd /opt/netagent
cp .env.example .env
nano .env  # Preencha todos os valores

# 2. Setup do servidor
sudo bash server-setup.sh

# 3. Deploy
bash deploy.sh
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

Copie `.env.example` para `.env` e configure:

| Variável | Descrição |
|---|---|
| `POSTGRES_PASSWORD` | Senha do PostgreSQL (gere com `openssl rand -hex 32`) |
| `REDIS_PASSWORD` | Senha do Redis |
| `JWT_SECRET` | Secret para tokens JWT |
| `ENCRYPTION_KEY` | Chave para criptografia de credenciais de dispositivos |
| `OPENAI_KEY` | Chave da API OpenAI |
| `EVOLUTION_GLOBAL_KEY` | Chave da Evolution API |
| `PUBLIC_URL` | URL pública da plataforma |
| `DOMAIN_PLATFORM` | Domínio principal (usado no instalador) |
| `DOMAIN_EVOLUTION` | Domínio da Evolution API |

### Portas

| Porta | Serviço |
|---|---|
| 80/443 | Traefik (HTTP/HTTPS) |
| 4000 | API Node.js (host) |
| 8000 | Agent Python (host) |
| 8001 | MCP MikroTik (Docker) |
| 8002 | MCP Linux (Docker) |
| 5432 | PostgreSQL (localhost only) |
| 6379 | Redis (localhost only) |
| 2121 | FTP (vsftpd) |
| 51820+ | WireGuard VPN (UDP) |

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
