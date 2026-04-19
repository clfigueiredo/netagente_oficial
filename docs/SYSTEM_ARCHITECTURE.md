# 🛰️ NetAgent — Documentação Completa do Sistema

## 1. Visão Geral

O **NetAgent** é uma plataforma SaaS multi-tenant para ISPs gerenciarem infraestrutura de rede via um agente de IA conversacional. O agente entende linguagem natural (texto e áudio), executa comandos SSH em dispositivos MikroTik e Linux, gerencia backups, VPN WireGuard, e envia alertas via WhatsApp.

### Arquitetura de Alto Nível

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE ENTRADA                           │
│                                                                     │
│   [Browser/Dashboard]          [WhatsApp]           [Automações]    │
│         │                          │                     │          │
│    WebSocket/REST            Evolution API          Cron/Scheduler  │
│         │                          │                     │          │
│         └──────────┬───────────────┘                     │          │
│                    ▼                                     │          │
│           ┌─────────────────┐                            │          │
│           │   API Node.js   │◄───────────────────────────┘          │
│           │   (Express)     │                                       │
│           └────────┬────────┘                                       │
│                    │ HTTP POST /chat                                 │
│                    ▼                                                 │
│           ┌─────────────────┐                                       │
│           │  Agent Python   │                                       │
│           │  (FastAPI)      │                                       │
│           └────────┬────────┘                                       │
│                    │                                                 │
├────────────────────┼────────────────────────────────────────────────┤
│                    │       CAMADA DE INTELIGÊNCIA                    │
│                    ▼                                                 │
│    ┌───────────────────────────────────┐                            │
│    │       LangGraph Orchestrator      │                            │
│    │                                   │                            │
│    │  load_context → search_rag →      │                            │
│    │  route_intent → run_specialists → │                            │
│    │  synthesize → END                 │                            │
│    └───────────┬───────────────────────┘                            │
│                │                                                     │
│    ┌───────────┼────────────┐                                       │
│    ▼           ▼            ▼                                       │
│ [MCP Tools] [Legacy SSH] [Skill Tools]                              │
│    │           │            │                                       │
├────┼───────────┼────────────┼───────────────────────────────────────┤
│    │    CAMADA DE EXECUÇÃO  │                                       │
│    ▼           ▼            ▼                                       │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
│ │MCP       │ │Paramiko  │ │Skill     │                              │
│ │MikroTik  │ │SSH Direct│ │Executor  │                              │
│ │(Docker)  │ │          │ │(Steps)   │                              │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘                             │
│      └────────────┼────────────┘                                    │
│                   ▼                                                  │
│        ┌─────────────────────┐                                      │
│        │  Dispositivos Reais │                                      │
│        │  MikroTik / Linux   │                                      │
│        └─────────────────────┘                                      │
├─────────────────────────────────────────────────────────────────────┤
│                    CAMADA DE DADOS                                   │
│                                                                     │
│  ┌────────────┐  ┌───────┐  ┌──────────┐  ┌──────────┐            │
│  │PostgreSQL  │  │Redis 7│  │WireGuard │  │vsftpd    │             │
│  │16+pgvector │  │       │  │VPN       │  │FTP Backup│             │
│  └────────────┘  └───────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Componentes Principais

### 2.1 API Node.js (Express)

**Localização:** `api/`

A API REST é o gateway principal. Gerencia autenticação, multi-tenancy, e serve como bridge entre o frontend e o agent Python.

**Fluxo de uma mensagem do chat web:**
1. Frontend envia mensagem via WebSocket (`socket.io`)
2. API Node salva a mensagem no banco
3. API faz `POST /chat` para o Agent Python
4. Agent processa e retorna resposta
5. API salva resposta e emite via WebSocket ao frontend

**Rotas principais:**

| Rota | Descrição |
|------|-----------|
| `POST /auth/login` | Autenticação JWT |
| `GET/POST /devices` | CRUD de dispositivos |
| `POST /messages` | Enviar mensagem ao agent |
| `GET /status/:deviceId` | Status do dispositivo (Redis cache) |
| `POST /actions/:id/execute` | Executar ação pendente aprovada |
| `GET/POST /automations` | Gerenciar automações |
| `GET/POST /backups` | Gerenciar backups FTP |
| `GET/POST /wireguard` | Gerenciar túneis VPN |
| `POST /internal/emit` | Endpoint interno: agent → socket.io |
| `POST /admin/tenants` | Super-admin: CRUD de tenants |

**Multi-tenancy:** Cada tenant tem um schema PostgreSQL dedicado. O middleware `tenant.js` injeta `req.tenantSlug` em toda request autenticada.

### 2.2 Agent Python (FastAPI)

**Localização:** `agent/`

O coração do sistema. Recebe mensagens, orquestra agentes especialistas via LangGraph, executa ferramentas SSH/MCP, e retorna respostas inteligentes.

**Endpoints:**

| Rota | Descrição |
|------|-----------|
| `POST /chat` | Recebe mensagem da API Node |
| `POST /webhook` | Recebe mensagens do WhatsApp (Evolution API) |
| `POST /skills/convert` | Converte bash script em skill estruturada |
| `GET /mcp/status` | Status dos drivers MCP e circuit breakers |

**Singletons (inicializados no startup):**
- `Orchestrator` — grafo LangGraph
- `WhatsAppClient` — cliente Evolution API
- `MonitorScheduler` — polling de dispositivos a cada 60s
- `MCPManager` — registry de drivers MCP
- `AutoScheduler` — executor de automações cron

---

## 3. O Orquestrador de Agentes (Core)

**Arquivo:** `agent/orchestrator.py` (1238 linhas — o arquivo mais importante)

### 3.1 Grafo LangGraph

O orquestrador é um **StateGraph do LangGraph** com 5 nós sequenciais:

```
load_context → search_rag → route_intent → run_specialists → synthesize → END
```

Cada nó recebe e retorna um `AgentState` — um TypedDict com ~25 campos que carrega todo o contexto da conversa.

### 3.2 Nó 1: `load_context`

**Objetivo:** Carregar todas as "camadas de memória" do agente.

**Execução paralela (`asyncio.gather`):**
1. **Short-term (conversa):** Últimas 12 mensagens da conversa (`db.get_recent_messages`)
2. **Settings + Skills:** Configurações do tenant e skills ativas
3. **Operational (dispositivo):** Se há device_id, carrega:
   - Informações do dispositivo (host, tipo, credenciais)
   - Último snapshot (OS, disco, serviços, portas)
   - Histórico recente (últimos 5 snapshots com CPU/RAM/Disco)

**Recuperação de device_id:** Se não veio na request, tenta recuperar do último `messages.device_id` da conversa.

### 3.3 Nó 2: `search_rag`

**Objetivo:** Busca semântica em duas bases de conhecimento.

1. **Long-term (Knowledge Base global):** Busca em `public.knowledge_base` usando embeddings pgvector. Retorna os 3 documentos mais relevantes (manuais, dicas, soluções).

2. **Medium-term (Tenant Memories):** Busca em `{tenant}.tenant_memories` — preferências do cliente, fatos sobre a rede, configurações específicas.

**Providers de embedding:** OpenAI (`text-embedding-3-small`) ou Google Gemini (`text-embedding-004`), configurável por tenant.

**Fallback:** Se o embedding falhar, usa busca por keywords com `ILIKE`.

### 3.4 Nó 3: `route_intent`

**Objetivo:** Selecionar 1-2 agentes especialistas e os escopos MCP relevantes.

**Lógica de roteamento:**

```python
# 1. Intent-based: analisa keywords na mensagem
INTENT_ROUTES = [
    {"agent": "network-security.md",   "keywords": ["firewall", "segurança", ...]},
    {"agent": "incident-responder.md", "keywords": ["caiu", "offline", ...]},
    {"agent": "capacity-planner.md",   "keywords": ["capacidade", "disco cheio", ...]},
    {"agent": "config-auditor.md",     "keywords": ["auditoria", "desvio", ...]},
    {"agent": "network-monitor.md",    "keywords": ["monitorar", "status", ...]},
    {"agent": "mikrotik-expert.md",    "keywords": ["bgp", "pppoe", "firewall", ...]},
]

# 2. Device-type fallback (se nenhum intent matchou):
#    MikroTik → mikrotik-expert.md
#    Linux    → linux-infra.md
#    Default  → network-orchestrator.md
```

**Detecção automática de dispositivo (fuzzy match):**
Se o usuário não selecionou um dispositivo, o sistema:
1. Verifica se digitou um número referenciando uma lista anterior
2. Normaliza o nome (remove acentos, lowercase)
3. Faz fuzzy match com `difflib.SequenceMatcher` (threshold 0.6)
4. Se encontrar com score > 60%, carrega o dispositivo automaticamente

### 3.5 Nó 4: `run_specialists`

**Objetivo:** Executar cada agente especialista selecionado com sua persona e ferramentas.

**Sequência para cada agente:**

```
1. Carregar persona (.md file do agent/agents/)
2. Construir system prompt com:
   - Regras fundamentais do NetAgent
   - Modo do agente (restricted/standard/root)
   - Info do dispositivo + snapshot
   - Memória de 3 camadas (curto/médio/longo prazo)
   - Skills disponíveis
   - Formato de saída (web/whatsapp)
   - Persona do especialista

3. Carregar ferramentas:
   - MCP tools (preferido) OU Legacy SSH tools
   - + Skill tools (do banco de dados)

4. Invocar LLM com tools (até 5 iterações):
   - LLM retorna tool_calls → executa → retorna resultado → LLM continua
   - Anti-hallucination guard: se TODOS os tools falharem, retorna erro
   - Pending action detection: se propose_action, para e pede aprovação
```

**Sistema de ferramentas (3 fontes):**

| Fonte | Descrição | Prioridade |
|-------|-----------|------------|
| **MCP Tools** | Via JSON-RPC para microserviços Docker | Alta (preferida) |
| **Legacy Tools** | SSH direto via Paramiko (MikroTikTools / LinuxTools) | Fallback |
| **Skill Tools** | Skills do banco convertidas em tools executáveis | Adicional |

### 3.6 Nó 5: `synthesize`

**Objetivo:** Combinar resultados de múltiplos especialistas.

- **1 agente:** Pass-through direto
- **2+ agentes:** LLM sintetiza uma resposta coesa, eliminando repetições
- **WhatsApp:** Normaliza markdown para formato WhatsApp (`**bold**` → `*bold*`)

---

## 4. Sistema de Memória (RAG de 3 Camadas)

```
┌──────────────────────────────────────────────────┐
│              MEMÓRIA DO AGENTE                    │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │ 💬 CURTO PRAZO (Sessão)                  │     │
│  │ • Últimas 12 mensagens da conversa       │     │
│  │ • Últimos 5 snapshots do dispositivo     │     │
│  │ • TTL: duração da conversa               │     │
│  └─────────────────────────────────────────┘     │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │ 🧠 MÉDIO PRAZO (Tenant Memories)         │     │
│  │ • Preferências do cliente                │     │
│  │ • Fatos sobre a rede/dispositivos        │     │
│  │ • Busca semântica (pgvector)             │     │
│  │ • Salvo via tool: save_memory            │     │
│  │ • TTL: permanente                        │     │
│  └─────────────────────────────────────────┘     │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │ 📚 LONGO PRAZO (Knowledge Base)          │     │
│  │ • Manuais, dicas, soluções conhecidas    │     │
│  │ • Global + per-tenant                    │     │
│  │ • Busca semântica (pgvector)             │     │
│  │ • Salvo via tool: save_knowledge         │     │
│  │ • TTL: permanente                        │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

---

## 5. Agentes Especialistas

Cada agente é um arquivo Markdown em `agent/agents/` com persona, regras e exemplos:

| Agente | Arquivo | Domínio | Quando é ativado |
|--------|---------|---------|------------------|
| **MikroTik Expert** | `mikrotik-expert.md` | RouterOS, PPPoE, BGP, OSPF, firewall | Keywords: bgp, pppoe, vlan, queue, mikrotik... |
| **Linux Infra** | `linux-infra.md` | Servidores Linux, processos, discos | Device type = linux |
| **Network Orchestrator** | `network-orchestrator.md` | Coordenação multi-domínio | Fallback quando nenhum match |
| **Incident Responder** | `incident-responder.md` | Incidentes ativos | Keywords: caiu, offline, down, timeout... |
| **Network Security** | `network-security.md` | Auditoria, firewall, vulnerabilidades | Keywords: segurança, firewall, porta aberta... |
| **Capacity Planner** | `capacity-planner.md` | Tendências, saturação | Keywords: capacidade, disco cheio, projeção... |
| **Config Auditor** | `config-auditor.md` | Desvios de configuração | Keywords: auditoria, baseline, drift... |
| **Network Monitor** | `network-monitor.md` | Métricas em tempo real | Keywords: monitorar, status, uptime... |

### Modos do Agente

| Modo | Comportamento |
|------|---------------|
| 🔒 **Restricted** | Leitura imediata. Modificações exigem `propose_action` |
| ⚡ **Standard** | Leitura + configurações. Destrutivas exigem aprovação |
| 🔓 **Root** | Confiança total. Só ações de altíssimo risco pedem aprovação |

---

## 6. MCP (Model Context Protocol)

### 6.1 Arquitetura

```
┌──────────────┐     JSON-RPC      ┌─────────────────┐
│  MCPManager  │ ──────────────── │  MCP MikroTik   │ (Docker :8001)
│  (Python)    │     /mcp          │  server.py 68KB │
│              │                   │  150+ tools     │
│  Registry    │     JSON-RPC      ├─────────────────┤
│  CircuitBrkr │ ──────────────── │  MCP Linux      │ (Docker :8002)
│  ToolCache   │     /mcp          │  server.py 13KB │
└──────────────┘                   │  30+ tools      │
                                   └─────────────────┘
```

### 6.2 Fluxo de chamada MCP

```
1. Orchestrator pede tools → MCPManager.discover_tools(scopes, device_type)
2. Manager filtra drivers por scope/device_type/saúde/circuit breaker
3. Manager chama tools/list via JSON-RPC → cacheia por 5 min
4. Tool bridge converte MCPToolInfo → LangChain StructuredTool
5. LLM invoca tool → StructuredTool.ainvoke()
6. Bridge injeta credenciais SSH do dispositivo
7. MCPManager.call_tool() → CircuitBreaker → JSON-RPC tools/call
8. MCP driver executa SSH no dispositivo e retorna resultado
```

### 6.3 Circuit Breaker

Cada driver MCP tem um circuit breaker independente:

| Estado | Comportamento |
|--------|---------------|
| **CLOSED** | Normal. Após 3 falhas → OPEN |
| **OPEN** | Rejeita todas as chamadas. Após 30s → HALF_OPEN |
| **HALF_OPEN** | Uma chamada de teste. Sucesso → CLOSED, Falha → OPEN |

Retry com backoff exponencial: 1s → 3s antes de abrir o circuito.

---

## 7. Sistema de Skills

Skills são **receitas executáveis** armazenadas no banco (`public.skills`).

### 7.1 Estrutura de uma Skill

```json
{
  "name": "install-zabbix-agent",
  "display_name": "Instalar Zabbix Agent",
  "category": "install",
  "device_type": "linux",
  "steps": [
    {
      "id": 1,
      "description": "Adicionar repositório Zabbix",
      "cmd": "wget https://repo.zabbix.com/...",
      "timeout": 60,
      "on_error": "stop"
    },
    {
      "id": 2,
      "description": "Instalar pacote",
      "cmd": "apt-get install -y zabbix-agent2",
      "timeout": 120,
      "on_error": "stop"
    }
  ]
}
```

### 7.2 Fluxo de Execução

```
1. Orchestrator carrega skills do banco (get_tenant_skills)
2. build_skill_tools() converte skills em LangChain StructuredTools
3. LLM decide usar skill → invoca tool
4. SkillExecutor executa steps sequencialmente via SSH
5. Cada step emite progresso em tempo real (agent:skill_step)
6. Resultado final retornado ao LLM para resposta
```

### 7.3 Conversão de Script → Skill

O endpoint `POST /skills/convert` usa LLM para:
1. Receber um bash script bruto
2. Parsear em steps estruturados (cmd, timeout, on_error)
3. Salvar no banco como skill reutilizável

---

## 8. Monitor de Dispositivos

**Arquivo:** `agent/monitor.py`

### Funcionamento

```
A cada 60 segundos:
  1. Busca todos os tenants ativos
  2. Para cada tenant, busca todos os devices ativos
  3. Para cada device (MikroTik ou Linux):
     a. Conecta via SSH e coleta status (CPU, RAM, uptime)
     b. Se online → atualiza last_seen_at no banco
     c. Se CPU > threshold → envia alerta WhatsApp
     d. Se offline → envia alerta WhatsApp
     e. Cacheia métricas no Redis (TTL 90s)
```

### Alertas WhatsApp

- **Debounce:** Mesmo alerta não é repetido em 30 minutos
- **Destinatários:** Todos os whatsapp_users ativos do tenant
- **Tipos:** CPU alta, dispositivo offline, dispositivo voltou online

---

## 9. Automações (Scheduler)

**Arquivo:** `agent/scheduler.py`

### Funcionamento

```
1. Loop a cada 60s sincroniza com banco:
   - Busca automations ativas de todos os tenants
   - Cria/atualiza/remove APScheduler jobs (CronTrigger)

2. Quando um cron trigger dispara:
   a. Carrega skill associada
   b. Extrai comandos dos steps
   c. Para cada device alvo (max 5 concorrentes):
      - Substitui variáveis mágicas (<DEVICE_NAME>, <DEVICE_IP>, <DATE>)
      - Executa comandos via SSH
   d. Envia relatório via WhatsApp (sucesso/falhas)
```

---

## 10. WhatsApp (Evolution API)

### Fluxo de mensagem recebida

```
1. Evolution API recebe mensagem WhatsApp
2. Webhook POST /webhook no Agent Python
3. Filtra: só messages.upsert, só conversation/text/audio
4. Identifica tenant pela evolution_instance
5. Normaliza número (remove +55, adiciona 9° dígito)
6. Verifica se número está autorizado (whatsapp_users)
7. Se áudio: busca base64 na Evolution API → transcreve com OpenAI Whisper
8. Processa no Orchestrator (channel="whatsapp")
9. Salva mensagem + resposta no banco
10. Envia resposta via Evolution API sendText
```

---

## 11. Banco de Dados

### Schema público (`public.`)

| Tabela | Descrição |
|--------|-----------|
| `tenants` | Empresas clientes (slug, plan, evolution keys) |
| `plans` | Planos SaaS (limites, preço) |
| `platform_users` | Super-admins da plataforma |
| `skills` | Skills globais reutilizáveis |
| `knowledge_base` | Base de conhecimento RAG (com embeddings pgvector) |
| `skill_tenant_overrides` | Override de skills por tenant |

### Schema por tenant (`{tenant_slug}.`)

| Tabela | Descrição |
|--------|-----------|
| `devices` | Dispositivos gerenciados (host, credenciais criptografadas) |
| `conversations` | Conversas (web e WhatsApp) |
| `messages` | Mensagens com tool_calls e tokens_used |
| `device_snapshots` | Snapshots de estado (OS, disco, portas, serviços) |
| `tenant_memories` | Memória de médio prazo (pgvector embeddings) |
| `settings` | Configurações (modo agente, LLM provider, thresholds) |
| `whatsapp_users` | Números autorizados para WhatsApp |
| `pending_actions` | Ações aguardando aprovação |
| `automations` | Automações agendadas (cron + skill + devices) |
| `mcp_drivers` | Drivers MCP registrados |
| `backups` | Registro de backups recebidos via FTP |

---

## 12. Fluxo de Aprovação (Pending Actions)

```
1. LLM decide que ação requer aprovação
2. Chama tool propose_action(type, description, commands, risk)
3. Tool retorna JSON com __pending_action__: true
4. Orchestrator detecta e retorna approval_data
5. API Node salva em pending_actions (status: pending)
6. Frontend exibe card de aprovação com detalhes e comandos
7. Usuário clica Aprovar ou Rejeitar
8. API executa comandos via SSH (se aprovado)
9. Status atualizado para executed/rejected
10. Próxima mensagem do LLM sabe que a ação foi executada/rejeitada
```

---

## 13. WireGuard VPN

- **Container Docker** com `wg-quick` e `iptables`
- **Multi-tenant:** Cada tenant pode ter sua interface WireGuard
- **API endpoints:** Criar/listar/remover peers, gerar configs
- **Frontend:** Wizard de setup com script MikroTik gerado automaticamente

---

## 14. FTP Backup

- **vsftpd** no host (porta 2121)
- Dispositivos MikroTik fazem backup via FTP automaticamente
- API gerencia pastas e links device↔pasta
- Frontend mostra arquivos com download/delete

---

## 15. Segurança

| Camada | Implementação |
|--------|---------------|
| **Autenticação** | JWT (bcrypt hash) |
| **Multi-tenancy** | PostgreSQL schemas isolados |
| **Credenciais** | AES-256 encryption (devices passwords) |
| **API interna** | Secret header (agent → API) |
| **Rede** | PostgreSQL/Redis em localhost only |
| **SSL** | Traefik + Let's Encrypt automático |
| **Firewall** | UFW (80, 443, 2121, 51820 UDP) |
| **VPN** | WireGuard para acesso a redes dos clientes |
| **WhatsApp** | Números autorizados por tenant |

---

## 16. Deploy e Infraestrutura

### Docker Compose (7 containers)

| Container | Imagem | Função |
|-----------|--------|--------|
| `traefik` | traefik:v3.6 | Reverse proxy + SSL |
| `netagent-frontend` | nginx:alpine | Serve frontend estático |
| `netagent-postgres` | pgvector/pgvector:pg16 | Banco de dados |
| `netagent-redis` | redis:7-alpine | Cache e sessões |
| `evolution-api` | evolution-api:v2.3.4 | WhatsApp |
| `mcp-mikrotik` | build local | Driver MikroTik |
| `mcp-linux` | build local | Driver Linux |
| `netagent-wireguard` | build local | VPN concentrador |

### Host (PM2)

| Processo | Tecnologia | Porta |
|----------|------------|-------|
| `netagent-api` | Node.js | 4000 |
| `netagent-agent` | Python/uvicorn | 8000 |

---

*Última atualização: Abril 2026*
*Forum Telecom © 2026*
