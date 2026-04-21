# Agent & MCP Drivers

> Auditado em: 2026-04-21
> Comandos usados: leitura de `agent/**`, `mcp-mikrotik/**`, `mcp-linux/**`

## Visão geral

O **Agent** é um serviço FastAPI/Uvicorn Python 3 rodando diretamente no host (PM2, fora do Docker) escutando em `0.0.0.0:8000`. Ele recebe chats do frontend (via API Node.js) e webhooks do Evolution API (WhatsApp), e processa cada mensagem através de um grafo LangGraph multi-agente. O grafo:

1. Carrega contexto do Postgres (histórico, skills, settings, fingerprint do device)
2. Busca conhecimento via RAG pgvector (3 camadas)
3. Roteia para 1–3 especialistas com base em palavras-chave e `device_type`
4. Invoca o LLM (OpenAI ou Gemini) com tools vindas dos **MCP drivers** (preferencial) ou dos `tools/` legados (fallback)
5. Sintetiza a resposta e emite eventos em tempo real via `POST /internal/emit` na API Node.js

As ações concretas em dispositivos acontecem nos **MCP drivers**: dois containers Docker independentes (`mcp-mikrotik` em `:8001` e `mcp-linux` em `:8002`) construídos com `fastmcp`, que expõem o protocolo MCP (JSON-RPC 2.0 streamable-http) e abrem SSH para os equipamentos de clientes. O agente fala com eles via HTTP no docker network (`host-gateway`). Credenciais são injetadas por-request via chave `credentials` no payload — os drivers não guardam estado de clientes.

---

## Entrypoint — `agent/main.py`

Arquivo de 369 linhas. Sobe `FastAPI(title="NetAgent Agent", version="1.0.0")` e usa um `lifespan` async-context-manager para ciclo de vida. Binda `0.0.0.0:8000` (env `AGENT_PORT`). CORS restrito a `API_URL` (`http://localhost:4000`).

**Singletons instanciados no módulo (antes do `lifespan`):**
- `orchestrator = Orchestrator()` — grafo LangGraph
- `whatsapp_client = WhatsAppClient()` — cliente Evolution
- `scheduler = MonitorScheduler()` — APScheduler AsyncIO para polling
- `mcp_manager = MCPManager()` — registry dos MCP drivers

**Lifespan (startup/shutdown):**
- `db.init_pool(min=2, max=10)` — pool asyncpg compartilhado
- `rag_module._pool = asyncpg.create_pool(..., min=2, max=8)` — pool dedicado para operações pgvector
- `mcp_manager.load_from_db()` — lê a tabela `public.mcp_drivers` e faz health-check inicial
- `scheduler.start()` + `start_auto_scheduler()` — inicia monitor de devices e scheduler de automations
- No shutdown: fecha tudo (`mcp_manager.close()`, `db.close_pool()`, `rag_module._pool.close()`)

**Helper `normalize_phone`** (linhas 81–109): normaliza formatos de número WhatsApp BR (remove 55 do country, adiciona 9º dígito se 8 dígitos, etc.).

### Endpoints FastAPI

| Método | Path | Linha | Papel |
|---|---|---|---|
| GET | `/` | 144 | Health check — retorna `{"status":"ok","service":"netagent-agent"}`. **Não existe `/health`** — [AUDIT-BUG-017](AUDIT-2026-04-21.md#audit-bug-017) |
| GET | `/mcp/status` | 149 | Lista drivers registrados + estado dos circuit breakers |
| POST | `/skills/convert` | 158 | Converte bash script em passos estruturados via LLM (usa `skill_converter.parse_bash_to_steps`) e grava em `public.skills` |
| POST | `/chat` | 185 | Chamado pela API Node.js em chats web — chama `orchestrator.process(...)` |
| POST | `/webhook` | 205 | Recebe eventos do Evolution API v2 (filtra `MESSAGES_UPSERT` + tipos `conversation`/`extendedTextMessage`/`audioMessage`), identifica o tenant por `instance` e dispara `_process_whatsapp_message` em `BackgroundTasks` para responder 200 rápido ao Evolution |

A função `_process_whatsapp_message` (linhas 250–356) faz transcrição via Whisper quando `messageType == "audioMessage"` (busca base64 via `/chat/getBase64FromMediaMessage/{instance}` porque Evolution v2 não manda inline), valida se o número está em `whatsapp_users`, cria/recupera conversation, persiste mensagens em `messages`, e envia resposta via `whatsapp_client.send_message(...)`.

---

## Orchestrator — `agent/orchestrator.py`

Arquivo de 1238 linhas. **Framework:** LangGraph sobre LangChain (`from langgraph.graph import StateGraph, END`, `from langchain_openai import ChatOpenAI`). Usa `TypedDict` `AgentState` com ~18 campos (device context, memory tiers, skills, routing, results).

### Topologia do grafo

```
load_context → search_rag → route_intent → run_specialists → synthesize → END
```

Compilado em `_build_graph()` (linha 372). Execução em `process()` (linha 388) via `self.graph.ainvoke(initial_state)`.

### Nós

- **`_load_context`** (442): paralelamente carrega `history` (últimas mensagens), `settings`, `skills`, e — se há `device_id` — `device_info`, `device_snapshot` (max 24h) e `operational_memory` (últimos 5 eventos de `device_history`). Se não há `device_id`, tenta recuperar da tabela `conversations.device_id`.
- **`_search_rag`** (525): invoca `memory.rag.search_knowledge(query, provider, api_key, tenant_id)` — longo prazo — e `db.search_tenant_memories(...)` — médio prazo (fatos/preferências por tenant+device).
- **`_route_intent`** (551): se não há device ainda, faz **fuzzy match** do nome dos devices contra a mensagem (com normalização de acentos, tokenização por `-_.\s`, `difflib.SequenceMatcher` score ≥ 0.6, e suporte a "resposta por número" quando o user digita "1"/"2" após uma lista). Depois seleciona especialistas via `INTENT_ROUTES` (palavras-chave → agent .md + `mcp_scopes`); fallback para persona por `device_type`.
- **`_run_specialists`** (675): para cada agente selecionado, constrói tool list, prompt de sistema com persona + 3 camadas de memória + modo + formato do canal, invoca o LLM, e executa um loop de tool-calling de até 5 iterações (`MAX_ITERATIONS = 5`, linha 1002) com guarda anti-alucinação: se TODOS os tool results casam padrões de erro (Erro SSH, Connection refused, timeout etc.), encerra e retorna erro amigável.
- **`_synthesize`** (1190): se só rodou 1 especialista, passa direto; se ≥ 2, faz sintetização via LLM eliminando redundância. Aplica `_normalize_for_whatsapp()` se o canal é `whatsapp` (troca `**...**` por `*...*`, remove fences ```).

### Seleção de tools (MCP vs legacy)

Em `_run_specialists_inner` (linha 680 em diante):

1. Tenta MCP primeiro: `mcp_manager.discover_tools(scopes=mcp_scopes, device_type=device_type)`
2. Se retornar tools, converte via `mcp_tools_to_langchain(...)` com credenciais do device injetadas
3. Sempre instancia também o `tools_handler` legacy (`MikroTikTools` ou `LinuxTools`) porque o `run_skill` precisa dele como executor SSH
4. `base_tools = mcp_tools if mcp_tools else legacy_tools.get_tools()`
5. Junta com `skill_tools = build_skill_tools(skills, device_type, ssh_executor, agent_mode)` — tools dinâmicas criadas a partir da tabela `public.skills`
6. Loga `source=MCP` ou `source=LEGACY` e conta totais

### Agent modes (linha 42)

Três modos: `restricted` (padrão, leitura livre mas `propose_action` para mudanças), `standard` (bloqueia apenas destrutivas), `root` (confiança total). A instrução de modo entra no system prompt.

### Emissão de eventos em tempo real

`_async_emit(state, event, payload)` faz `POST {API_URL}/internal/emit` com header `x-internal-secret` para a API Node.js relayar via Socket.IO ao browser. Eventos emitidos: `agent:phase`, `agent:system_log`, `agent:step_start`, `agent:step_done`, `agent:skill_step`.

---

## Especialistas — `agent/agents/*.md`

YAML frontmatter + markdown de persona. O orchestrator strip-a o frontmatter via `_read_agent_file()` (linha 159) e injeta o corpo no system prompt.

| Arquivo | Nome | Modo YAML | Propósito |
|---|---|---|---|
| `network-orchestrator.md` | network-orchestrator | — | Master orchestrator (fallback padrão) |
| `mikrotik-expert.md` | mikrotik-expert | standard | Expert RouterOS (BGP, OSPF, PPPoE, firewall, VLAN, hotspot, QoS) |
| `linux-infra.md` | linux-infra | standard | Linux (NGINX, MySQL, Radius, Zabbix, DHCP, DNS, serviços, storage) |
| `network-security.md` | network-security | restricted | Auditoria de firewall, CVEs, portas, intrusões |
| `incident-responder.md` | incident-responder | root | Resposta a incidentes (serviço caído, latência, sem internet) |
| `capacity-planner.md` | capacity-planner | restricted | Planejamento de capacidade, projeção, saturação |
| `config-auditor.md` | config-auditor | — | Drift de config (running vs saved, baseline) |
| `network-monitor.md` | network-monitor | restricted | Coleta de métricas em tempo real, somente leitura |

Intent routing (linha 96 de `orchestrator.py`): cada rota mapeia `keywords` → `agent` + `mcp_scopes`. Ex: palavra-chave "bgp" ou "mikrotik" → `mikrotik-expert.md` + scopes `routing`, `pppoe`, `firewall`, etc.

---

## Tools — `agent/tools/`

### `base_tools.py` — `BaseTools`

Classe abstrata com SSH via `paramiko` (AutoAddPolicy, `look_for_keys=False`, `allow_agent=False`). Decripta password via `services.encryption_service.decrypt_password`. Dois métodos:
- `_async_run(cmd, timeout)` — retorna string (output ou erro amigável)
- `_async_run_with_exit_code(cmd, timeout)` — retorna `(output, exit_code)` para `skill_executor`

Fábricas `_make_async_tool`, `_make_noarg_tool` e tools compartilhadas (herdadas por Linux e MikroTik):

| Tool | Argumentos | Descrição |
|---|---|---|
| `propose_action` | `action_type, description, commands (JSON array), risk_level` | Retorna JSON com `__pending_action__: true` — detectado pelo loop do orchestrator e transformado em aprovação pendente |
| `save_knowledge` | `title, content, category` | Chama `memory.rag.index_knowledge` e insere em `public.knowledge_base` com `tenant_id` do chamador |
| `save_memory` | `memory_type, content, is_device_specific` | `db.save_tenant_memory(...)` — memória de médio prazo |
| `ping_host` | `host, count (max 10)` | Subclasses implementam |

### `mikrotik_tools.py` — `MikroTikTools(BaseTools)`

18 tools expostas ao LLM via `get_tools()`:

`get_status`, `get_interfaces`, `get_bgp_peers`, `get_routes(filter)`, `get_logs(topics, lines)`, `get_firewall_rules`, `get_nat_rules`, `get_dhcp_leases`, `get_queues`, `get_hotspot_users`, `get_ospf`, `get_address_lists`, `get_pppoe_sessions`, `ping_host`, `fingerprint_device`, `propose_action`, `save_knowledge`, `save_memory`.

`fingerprint_device` (linha 334) roda 9 comandos RouterOS (versão, board, IPs, rotas ativas, counts de NAT/filter/interfaces/BGP/PPPoE) e formata em Markdown `## 🖧 Fingerprint do RouterOS`.

### `linux_tools.py` — `LinuxTools(BaseTools)`

16 tools: `get_status`, `get_processes`, `get_network`, `get_routes`, `get_default_route`, `get_logs(service, lines)`, `get_docker_status`, `get_services`, `get_disk_usage`, `run_command(command)`, `ping_host`, `fingerprint_device`, **`run_skill(skill_name)`**, `propose_action`, `save_knowledge`, `save_memory`.

`run_command` (linha 363) tem 3 políticas por `agent_mode`: root executa tudo; standard bloqueia patterns destrutivos (`rm -rf /`, `mkfs`, `dd if=`, `shutdown`); restricted bloqueia instalação/serviços/chmod/iptables/etc.

`fingerprint_device` (linha 399) roda UM script SSH único com seções `===OS===`, `===MEM===`, `===DISK===`, `===DOCKER===`, `===SERVICES===`, `===PORTS===`, `===PKGS===` e parseia pelas tags.

`run_skill(skill_name)` (linha 42): busca a skill por nome em `public.skills`, executa `fingerprint_device` como pré-verificação obrigatória, depois chama `skill_executor.run_skill_steps(...)` passando um `ssh_runner` que usa `_async_run_with_exit_code`. Emite `agent:skill_step` via socket a cada passo.

### `audio_tools.py`

`transcribe_audio(audio_base64)` — decodifica base64, envia para `openai.AsyncOpenAI.audio.transcriptions.create(model="whisper-1", language="pt", response_format="text")`.

### `skill_executor.py` (em `tools/`)

`build_skill_tools(skills, device_type, ssh_executor, agent_mode)` filtra skills por `device_type` (ou 'any'), extrai todos os commands de `steps[].commands` e variáveis `<var>` via regex, cria um `StructuredTool` dinâmico `skill_<name>` com `args_schema` pydantic gerado em runtime (`create_model`). Ao ser invocado, substitui variáveis e executa sequencialmente via `_executor._async_run(cmd)`.

**As tools de MikroTik/Linux NÃO chamam os MCP drivers** — elas abrem SSH direto do processo Agent. A integração com MCP acontece na camada separada `mcp/` (descrita abaixo). Quando `mcp_manager.discover_tools()` retorna tools, o orchestrator usa MCP e **ignora** o legacy. O legacy só entra quando MCP não está disponível ou o scope não casa.

---

## MCP Client — `agent/mcp/`

### `manager.py` — `MCPManager` (485 linhas)

Registry central. Estrutura interna:
- `_drivers: dict[name, MCPDriver]` — registry
- `_circuit_breakers: dict[name, CircuitBreaker]` — um por driver
- `_tool_cache: dict[driver_name, list[MCPToolInfo]]` — TTL 300 s
- `_tool_driver_map: dict[tool_name, driver_name]` — lookup reverso
- `_sessions: dict[driver_name, session_id]` — `Mcp-Session-Id` do protocolo
- `_http_client: httpx.AsyncClient(timeout=30)` — lazy init

**Protocolo:** JSON-RPC 2.0 sobre `POST {driver.url}/mcp` com headers `Accept: application/json, text/event-stream` e `Mcp-Session-Id`. Parsing de respostas SSE feito em `_parse_sse_response()` (extrai a linha `data:` final). Handshake com `initialize` (`protocolVersion: "2025-03-26"`) na primeira request; retry automático se `code == -32600` (session expired).

**Funções principais:**
- `load_from_db(tenant_slug=None)`: lê `public.mcp_drivers` e registra todos os drivers que ainda não estão; roda `check_all_health()` em seguida
- `register(name, url, device_type, scopes, config)`: instancia `MCPDriver` (status `STARTING`) + `CircuitBreaker`
- `check_health(name)` / `check_all_health()`: `GET {url}/health` com timeout 5 s; atualiza status para `ONLINE` / `DEGRADED` / `OFFLINE`
- `discover_tools(scopes, device_type, force_refresh)`: filtra drivers por status/circuito, chama `tools/list` via JSON-RPC, deriva `scope` do prefixo do nome (`routing_get_bgp` → scope `routing`), cacheia por 5 min
- `call_tool(tool_name, args, credentials, tenant, conversation_id)`: acha o driver no `_tool_driver_map`, dispara via circuit breaker, injeta `credentials` no payload. Retorna `MCPCallResult(success, result, error, duration_ms)`. Registra métricas em `obs_metrics`.

### `circuit_breaker.py` — `CircuitBreaker` (223 linhas)

Estados `CLOSED` / `OPEN` / `HALF_OPEN`. Config padrão (`CircuitBreakerConfig`):
- `failure_threshold: 3`
- `recovery_timeout_s: 30.0`
- `call_timeout_s: 30.0` (sobreposto em `_execute_mcp_call`)
- `retry_delays: [1.0, 3.0]` — backoff exponencial

Fluxo:
- CLOSED: executa `_attempt_with_retry` (1 tentativa + 2 retries com delays `[1, 3]` seg). Todas falharam → `_record_failure()`. Se `failure_count >= 3` → OPEN.
- OPEN: rejeita imediatamente com `CircuitBreakerError` até `recovery_timeout_s` passar.
- HALF_OPEN (após timeout): permite 1 call "probe". Sucesso → CLOSED (reset); falha → OPEN de novo.

Cada `_attempt` é envolvido em `asyncio.wait_for(fn, timeout=call_timeout_s)`. Todos os eventos vão para `obs_logger` (structured JSON) — eventos como `circuit_call_ok`, `circuit_retry`, `circuit_opened`, `circuit_closed`, `circuit_half_open`, `circuit_manual_reset`.

### `tool_bridge.py`

`mcp_tools_to_langchain(tools, mcp_manager, credentials, tenant, conversation_id, agent_mode)` converte cada `MCPToolInfo` em `StructuredTool` LangChain. Schema pydantic é construído dinamicamente (`create_model`) a partir de `input_schema["properties"]` — mapeia types JSON Schema para Python (`string → str`, `integer → int`, etc.), pula o campo `credentials` (ele é injetado pelo bridge, não pelo LLM).

Heurística de segurança: se `agent_mode == "restricted"` e o nome da tool não contém nenhum de `["get_", "list_", "ping", "traceroute", "fingerprint"]`, a invocação é bloqueada com mensagem "🚫 Comando bloqueado (modo restricted)".

### `models.py` — Dataclasses

`DriverStatus` (`ONLINE`, `OFFLINE`, `DEGRADED`, `STARTING`), `CircuitState` (`CLOSED`, `OPEN`, `HALF_OPEN`), `MCPDriver` (name, url, device_type, scopes, status, `health_endpoint="/health"`, `mcp_endpoint="/mcp"`, `transport="streamable-http"`), `MCPToolInfo` (name, description, driver, scope, input_schema), `MCPCallResult` (tool, driver, success, result, error, duration_ms).

### `observability.py`

`StructuredLogger` emite JSON por linha (`event`, `ts`, context). `MetricsCollector` é singleton in-memory contando `tool_calls_total/success/error`, durações, phases (últimas 10), erros recentes (últimos 20 com falha). `PhaseTimer` é context manager usado no orchestrator (`with PhaseTimer("load_context", ...)`).

---

## Memory/RAG — `agent/memory/rag.py`

Pool `asyncpg` dedicado (8 conexões) inicializado em `main.lifespan`. Dois providers de embedding:
- OpenAI (padrão): `text-embedding-3-small` (1536 dims)
- Google Gemini: `models/text-embedding-004` (`task_type="retrieval_query"`, 768 dims)

Seleção por tenant settings (`llm_provider`) — se Gemini falha, cai para OpenAI.

Texto truncado a 8000 caracteres antes do embedding.

**Tabela de destino:** `public.knowledge_base` (detalhes em [DATABASE.md](DATABASE.md)). Busca com operador de distância cosseno `<=>` do pgvector (`ORDER BY embedding <=> $1::vector`), `LIMIT 3`. Filtro por `tenant_id IS NULL OR tenant_id = $tenant_id` — knowledge global é compartilhado entre todos os tenants, tenant-específico só pro dono. Após um hit, incrementa `use_count` das linhas retornadas.

Fallback quando embedding falha: `_keyword_fallback` com `ILIKE` sobre `title`/`content`.

`index_knowledge(title, content, category, device_type, tenant_id, source, provider, api_key)`: gera embedding de `f"{title}\n{content}"` e insere com `RETURNING id`. Chamado pelo tool `save_knowledge`.

**Quando é lido:** no nó `_search_rag` (uma vez por request). **Quando é salvo:** quando o LLM explicitamente chama `save_knowledge` durante a execução de um especialista.

Memórias "médio prazo" ficam em `{tenant}.tenant_memories` (não em `knowledge_base`) e usam full-text / keyword search — lidas em `search_tenant_memories` a partir de `db.py`.

---

## Monitor — `agent/monitor.py`

Classe `MonitorScheduler` (237 linhas) com `apscheduler.schedulers.asyncio.AsyncIOScheduler`.

**Loop:** `self.scheduler.add_job(self._poll_all_tenants, "interval", seconds=60, misfire_grace_time=None)`. Frequência **hardcoded a 60 s**, não configurável via settings.

**Fluxo por tick:**
1. `_poll_all_tenants`: `SELECT slug, evolution_instance, evolution_key FROM public.tenants WHERE active` e cria uma task por tenant (`asyncio.create_task(self._poll_tenant(tenant))`)
2. `_poll_tenant`: lê os devices ativos do schema do tenant, carrega `alert_cpu_threshold` (default 85), carrega lista de `whatsapp_users` ativos, e dispara `_poll_device` concorrente por device
3. `_poll_device`: instancia `MikroTikTools` ou `LinuxTools` diretamente (SSH direto, sem passar pelo MCP) e chama `get_status()`. Parseia CPU de `"CPU: NN%"` na saída.

**Alertas:**
- CPU ≥ threshold: envia WhatsApp `⚠️ Alerta NetAgent — CPU alta: X%` para todos os `whatsapp_users` ativos
- Device offline (exception): envia `🔴 Alerta NetAgent — Dispositivo Offline`
- Debounce: dict global `_alert_sent[tenant:device_id:alert_type]` com cooldown de **30 minutos** (`ALERT_COOLDOWN_MINUTES = 30`). Quando o device volta online, a chave `:offline` é apagada.

**Persistência:**
- Se online, `UPDATE "{tenant}".devices SET last_seen_at = NOW()`
- Cache em Redis: `SETEX status:{tenant}:{device_id} 90 <json>` — 90 s TTL. Lido pelo frontend via API Node.js.

**⚠️ Bug conhecido:** [AUDIT-BUG-012](AUDIT-2026-04-21.md#audit-bug-012) — tasks criadas com `asyncio.create_task` não são guardadas em referência, e no shutdown do APScheduler algumas coroutines ficam pendentes, gerando `Task was destroyed but it is pending` nos logs do PM2. Solução: keep-refs em `set` e `gather` com cancelamento no `stop()`.

---

## Scheduler — `agent/scheduler.py`

Arquivo separado de 283 linhas, também usando APScheduler `AsyncIOScheduler` — mas agora executando **automations** (tarefas cron do usuário), não o monitor.

**Mecanismo:** NÃO depende do cron daemon do sistema. É 100 % in-process usando `apscheduler.triggers.cron.CronTrigger.from_crontab(expression)`. Não afetado por [AUDIT-BUG-001](AUDIT-2026-04-21.md#audit-bug-001) (cron ausente).

**Sincronização:** `sync_automations_loop()` é um `while True: sleep 60`. A cada minuto:
1. Lê todos os tenants (`db.get_all_tenant_slugs()`)
2. Para cada tenant: `SELECT * FROM {tenant}.automations WHERE is_active = true`
3. Para cada automação, reconcilia o dicionário `_job_store` (chave `"{tenant}_{auto_id}"`):
   - Se existe e o cron mudou → `job.reschedule(...)`
   - Se não existe → `scheduler.add_job(execute_automation, CronTrigger, args=[tenant, auto], max_instances=1, misfire_grace_time=None)`
4. Remove jobs de automations deletadas/desativadas

**`execute_automation(tenant, automation)`:**
- Atualiza status → `running`
- Carrega skill de `public.skills` via `skill_id`
- Extrai commands de `steps[].commands`, aplica **magic variables** (`<DEVICE_NAME>`, `<DEVICE_IP>`, `<DATE>`, `<datadoarquivo>`)
- `asyncio.Semaphore(5)` limitando a 5 devices concorrentes
- Para cada device-alvo: instancia `MikroTikTools`/`LinuxTools` com `agent_mode="restricted"` e executa cada comando via `_async_run`
- Status final: `success`, `partial_error` ou `failed`
- Envia relatório WhatsApp com total sucessos/falhas (ao `notification_target` ou primeiro admin ativo)

---

## WhatsApp — `agent/whatsapp.py`

Cliente fino para Evolution API. `base_url` default `https://agenteevo.forumtelecom.com.br` (env `EVOLUTION_BASE_URL`).

Três métodos:
- `send_message(instance, api_key, number, text)`: `POST /message/sendText/{instance}` com header `apikey`. Prepend `55` ao número normalizado. `timeout=30`.
- `get_instance_status(instance, api_key)`: `GET /instance/connectionState/{instance}`.
- `get_media_base64(instance, api_key, message_key)`: `POST /chat/getBase64FromMediaMessage/{instance}` com `{"message": {"key": ...}, "convertToMp4": false}`. Necessário porque Evolution v2 não envia base64 inline no webhook.

Webhook entra por `/webhook` (em `main.py`) e o fluxo de resposta é:
1. `get_tenant_by_instance(instance_name)` identifica o tenant
2. `BackgroundTasks` chama `_process_whatsapp_message`
3. (opcional) `transcribe_audio` via Whisper
4. `get_whatsapp_user(tenant, number)` valida autorização
5. `get_or_create_whatsapp_conversation`, `save_message("user", text)`
6. `orchestrator.process(tenant_slug, conv_id, message, channel="whatsapp", whatsapp_number=number)`
7. `save_message("assistant", reply)` + `whatsapp_client.send_message(...)`

---

## MCP MikroTik — container `mcp-mikrotik`

- **Porta:** 8001 (publicada em `0.0.0.0:8001` — ver [AUDIT-BUG-008](AUDIT-2026-04-21.md#audit-bug-008))
- **Imagem:** build local `./mcp-mikrotik` (`python:3.12-slim`, `uvicorn server:app --host 0.0.0.0 --port 8001`)
- **Dependências:** `mcp[cli] >= 1.8.0`, `fastmcp >= 3.0.0`, `paramiko >= 3.4.0`, `uvicorn >= 0.30.0`
- **Healthcheck:** `GET /health` (linha 1460 de `server.py`) retorna `{"status":"ok","driver":"mcp-mikrotik"}` via Starlette `Route`
- **Endpoint MCP:** `POST /mcp` (streamable-http) — handshake `initialize`, depois `tools/list`, `tools/call`
- **Tools expostas:** **108** tools via decorador `@mcp.tool()`. Prefixos de scope: `system_`, `interfaces_`, `routing_`, `firewall_`, `pppoe_`, `hotspot_`, `queues_`, `services_`, `network_`, `ip_`, `bgp_`, `ospf_`, `wireguard_`, `vlan_`, `bridge_`, `dhcp_`, `tunnel_`, etc.
- **Exemplos:** `system_get_status`, `system_fingerprint`, `system_get_logs`, `interfaces_list`, `routing_get_bgp_peers`, `routing_get_ospf`, `firewall_filter_list`, `firewall_filter_add_basic`, `firewall_filter_remove`, `firewall_nat_add_port_forward`, `wireguard_create_interface`, `wireguard_add_peer`, `vlan_create_interface`, `bridge_create`, `bridge_add_port`, `dhcp_make_static_lease`, `hotspot_add_user`, `tunnel_create_eoip`, `pppoe_remove_active_session`, super-workflow para dual-WAN PCC failover.
- **Credenciais:** cada tool extrai `credentials = args.pop("credentials")` → `(host, port, username, password)` via helper `_creds()`. Multi-tenant friendly: driver é stateless.
- **Protocolo:** HTTP REST sobre docker network `netagent_default` → SSH de saída (porta TCP 22 por padrão) para RouterOS via `paramiko.SSHClient` com `AutoAddPolicy`.

---

## MCP Linux — container `mcp-linux`

- **Porta:** 8002 (publicada em `0.0.0.0:8002` — ver [AUDIT-BUG-008](AUDIT-2026-04-21.md#audit-bug-008))
- **Imagem:** build local `./mcp-linux` (`python:3.12-slim`, `uvicorn server:app --host 0.0.0.0 --port 8002`)
- **Dependências:** mesmas do MikroTik (`fastmcp`, `paramiko`, `uvicorn`, `mcp[cli]`)
- **Healthcheck:** `GET /health` (linha 308 de `server.py`) retorna `{"status":"ok","driver":"mcp-linux"}`
- **Endpoint MCP:** `POST /mcp` (streamable-http)
- **Tools expostas:** **14** via `@mcp.tool()`:
  - Scope `system`: `system_get_status`, `system_get_processes`, `system_fingerprint`
  - Scope `network`: `network_get_info`, `network_get_routes`, `network_get_default_route`, `network_ping`, `network_traceroute` (com fallback para `mtr`/`tracepath`)
  - Scope `services`: `services_list`
  - Scope `docker`: `docker_get_status`
  - Scope `logs`: `logs_get(service, lines)`
  - Scope `storage`: `storage_get_disk_usage`
  - Scope `commands`: `commands_run(command, agent_mode)` — valida modo via `_check_command_allowed` com listas `BLOCKED_PATTERNS_RESTRICTED` e `DESTRUCTIVE_PATTERNS`
- **Credenciais:** idêntico ao MikroTik — `_creds()` extrai host/port/user/pass
- **Protocolo:** HTTP REST sobre docker network → SSH de saída para servidor Linux via `paramiko`

---

## Pontos de atenção

- [AUDIT-BUG-003 — Agent 8000 exposto publicamente via UFW](AUDIT-2026-04-21.md#audit-bug-003) — `/chat`, `/webhook` e `/skills/convert` ficam acessíveis externamente sem TLS. Custo OpenAI/Gemini pode escalar se explorado.
- [AUDIT-BUG-008 — MCPs 8001/8002 em 0.0.0.0](AUDIT-2026-04-21.md#audit-bug-008) — UFW bloqueia por default (sem rule allow), mas é defesa em profundidade frágil. Como MCP executa SSH arbitrário em devices de clientes, o impacto é alto.
- [AUDIT-BUG-012 — asyncio bug em MonitorScheduler](AUDIT-2026-04-21.md#audit-bug-012) — `RuntimeError: no running event loop` + `Task was destroyed but it is pending` no PM2 logs. `_poll_device` tasks perdidas no shutdown.
- [AUDIT-BUG-017 — Agent usa `/` em vez de `/health`](AUDIT-2026-04-21.md#audit-bug-017) — inconsistente com API Node.js e MCP drivers (que usam `/health`). Monitoramento externo reporta DOWN incorretamente.
