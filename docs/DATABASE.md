# Banco de Dados

> Auditado em: 2026-04-21
> Comandos usados: `docker exec netagent-postgres psql -U netagent -l`, `docker exec netagent-postgres psql -U netagent -d netagent -c "\dn"`, `docker exec netagent-redis redis-cli -a $REDIS_PASSWORD INFO server`, `docker exec netagent-redis redis-cli -a $REDIS_PASSWORD DBSIZE`.

## Visão geral

A plataforma usa dois data stores, ambos empacotados como containers com bind loopback no host:

- **PostgreSQL 16** com a extensão **pgvector 0.8.1**, servindo todos os dados relacionais + embeddings vetoriais da RAG.
- **Redis 7** (imagem `redis:7-alpine`) para cache leve, sessões e possível pub/sub.

O modelo é **multi-tenant por schema**: o schema `public` armazena as tabelas globais (planos, tenants, skills, knowledge_base, platform_users) e cada tenant recebe um schema dedicado com seu próprio conjunto de tabelas operacionais, criado dinamicamente pela função `public.create_tenant_schema(slug)`. Na auditoria foi identificado um único tenant real: `forumtelecom`.

## PostgreSQL

### Databases existentes

| Database  | Owner    | Encoding | Tamanho   | Propósito                                            |
|-----------|----------|----------|-----------|------------------------------------------------------|
| netagent  | netagent | UTF8     | 11 MB     | Schema público + schemas por tenant (app principal)  |
| evolution | netagent | UTF8     | 59 MB     | Banco isolado da Evolution API v2 (WhatsApp)         |
| postgres  | netagent | UTF8     | 7.5 MB    | Database padrão do cluster, não usado pela aplicação |
| template0 | netagent | UTF8     | –         | Template read-only nativo do PostgreSQL              |
| template1 | netagent | UTF8     | –         | Template base para novos databases                   |

Todos os databases pertencem ao mesmo role `netagent`, que é superuser do cluster (não há separação de privilégios entre app e Evolution — ver ponto de atenção abaixo).

### Extensões habilitadas (database `netagent`)

| Extensão    | Versão | Uso                                                                     |
|-------------|--------|-------------------------------------------------------------------------|
| `pgcrypto`  | 1.3    | Criptografia e geração de UUID via `gen_random_uuid()`                  |
| `plpgsql`   | 1.0    | Linguagem procedural padrão (usada por `public.create_tenant_schema`)   |
| `uuid-ossp` | 1.1    | Geração de UUIDs alternativa (`uuid_generate_v4()`)                     |
| `vector`    | 0.8.1  | pgvector — coluna `VECTOR(1536)` para embeddings da RAG                 |

A criação das extensões está em `/var/www/agente_forum_telecom/api/src/db/init.sql` (linhas 8–10).

### Modelo multi-tenant (schemas)

O schema `public` contém as tabelas SaaS globais. Para cada tenant cadastrado, a aplicação chama `SELECT public.create_tenant_schema('<slug>')` — um bloco PL/pgSQL que executa `CREATE SCHEMA IF NOT EXISTS` e cria todas as tabelas operacionais do tenant isoladas naquele namespace.

| Schema         | Tabelas | Papel                                                                          |
|----------------|---------|--------------------------------------------------------------------------------|
| `public`       | 6       | Tabelas globais: tenants, plans, skills, knowledge_base, platform_users, skill_tenant_overrides |
| `forumtelecom` | 15      | Schema do único tenant ativo — dados isolados (devices, chats, backups, etc.)  |

Tabelas de `public` observadas na auditoria:

- `public.plans` — planos SaaS (Starter / Professional / Enterprise), seed automático no `init.sql`.
- `public.tenants` — clientes SaaS (slug, plan_id, evolution_instance, openai_key_encrypted, gpt_model, admin_email).
- `public.skills` — catálogo global versionado de skills do agente (12 skills MikroTik seed).
- `public.skill_tenant_overrides` — customizações de skills por tenant (não definida no `init.sql` principal; adicionada posteriormente).
- `public.knowledge_base` — base global de RAG com coluna `embedding VECTOR(1536)` + índice IVFFLAT cosseno.
- `public.platform_users` — super-admins da plataforma (role `superadmin` / `admin`).

Tabelas criadas dentro de cada schema de tenant (via `create_tenant_schema` em `init.sql` linhas 125–398):

1. `devices` — inventário (mikrotik / linux / docker_host)
2. `users` — usuários do tenant (web)
3. `whatsapp_users` — números autorizados no WhatsApp
4. `conversations` — threads de chat (whatsapp / web)
5. `messages` — mensagens com `tool_calls` + `reasoning` JSONB
6. `pending_actions` — ações aguardando aprovação humana
7. `device_history` — histórico de comandos executados em devices
8. `settings` — key-value de configurações do tenant
9. `device_snapshots` — fingerprint coletado pelo agente
10. `mcp_drivers` — registro de drivers MCP por tenant
11. `automations` — execução agendada de skills (cron)
12. `tenant_memories` — memória RAG de médio prazo com `embedding VECTOR(1536)`
13. `wireguard_interfaces` — interfaces WG
14. `wireguard_pools` — pools IP WG
15. `wireguard_peers` + `wireguard_server_peers` — peers cliente e do concentrador

### Modelos Prisma (`api/prisma/schema.prisma`)

O Prisma Client é configurado com `previewFeatures = ["multiSchema"]` e `schemas = ["public"]` — **somente o schema público é mapeado via Prisma**. Os schemas de tenant são acessados via `$queryRawUnsafe` com o slug injetado em runtime (ver comentário nas linhas 1–2 do arquivo).

Modelos declarados (todos em `@@schema("public")`):

| Linha | Modelo          | Tabela            | Observações                                          |
|-------|-----------------|-------------------|------------------------------------------------------|
| 15–29 | `Plan`          | `plans`           | Plano SaaS com `maxDevices`, `priceMonthly`, `features JSON` |
| 32–49 | `Tenant`        | `tenants`         | FK opcional para `Plan`, campos Evolution + OpenAI   |
| 51–67 | `Skill`         | `skills`          | Catálogo de skills com `tools JSON` e `examples JSON` |
| 69–78 | `PlatformUser`  | `platform_users`  | Super-admins com `passwordHash` e `role`             |

Tabelas de `public` presentes no banco mas **sem modelo Prisma**: `knowledge_base` e `skill_tenant_overrides` — são manipuladas exclusivamente por SQL raw (`knowledge_base` pelo Agent Python em `agent/memory/rag.py`).

### Migrations SQL

A aplicação **não usa Prisma Migrate** nem uma pasta `migrations/`. O schema é aplicado via scripts SQL diretos:

| Arquivo                                        | Propósito                                                                        |
|------------------------------------------------|----------------------------------------------------------------------------------|
| `api/src/db/init.sql`                          | Bootstrap do schema `public` + definição da função `create_tenant_schema` (403 linhas). Executado na primeira subida do container. |
| `api/scripts/create_tenant_schema.sql`         | Versão standalone (mais antiga) da função `create_tenant_schema` — divergente de `init.sql` em alguns DEFAULTs (ex.: `alert_cpu_threshold=80` vs `85`). |
| `api/scripts/add_mcp_drivers.sql`              | Migration one-shot que adiciona `mcp_drivers` em cada schema de tenant já existente, iterando `information_schema.schemata`. |

**Ponto de atenção:** há duplicação entre `init.sql` e `scripts/create_tenant_schema.sql`. Convém escolher uma única fonte de verdade.

## Redis

- **Versão:** 7.4.7 (imagem `redis:7-alpine`)
- **Bind:** `127.0.0.1:6379` (apenas loopback do host, declarado em `docker-compose.yml` linha 87)
- **Auth:** password via variável `REDIS_PASSWORD` no `.env`, passada por `--requirepass` (linha 83)
- **Modo:** standalone (sem cluster, sem sentinel)
- **Status na auditoria:** PONG em 2026-04-21, DBSIZE = 1 chave
- **Persistência:** volume `./data/redis` → `/data` no container
- **Uso esperado (a validar no código):** sessões JWT, cache de respostas do agente, pub/sub para WebSocket e possíveis filas leves. A quantidade de chaves (1) sugere uso bastante limitado no momento.

## pgvector (RAG memory)

A camada de memória semântica do agente vive em `/var/www/agente_forum_telecom/agent/memory/`:

| Arquivo       | Papel                                                                              |
|---------------|------------------------------------------------------------------------------------|
| `__init__.py` | Package marker (vazio, 1 linha)                                                    |
| `rag.py`      | Busca e indexação por similaridade cosseno em `public.knowledge_base`              |

Pontos-chave de `rag.py`:

- **Modelo de embedding padrão (OpenAI):** `text-embedding-3-small`, dimensão 1536 (linha 77).
- **Provider alternativo (Gemini):** `models/text-embedding-004` com `task_type=retrieval_query` (linhas 59–70). Cai para OpenAI em caso de falha.
- **Busca (`search_knowledge`):** usa operador `<=>` (cosine distance) do pgvector sobre `public.knowledge_base.embedding`, filtrando por `tenant_id IS NULL OR tenant_id = $tenant`, opcionalmente por `category`. Incrementa `use_count` das linhas retornadas.
- **Fallback por keyword (`_keyword_fallback`):** se a geração do embedding falhar, faz `ILIKE` sobre título/conteúdo.
- **Indexação (`index_knowledge`):** insere nova linha com `embedding` computado e retorna o UUID.
- **Pool:** `_pool` é injetado externamente pelo `main.py` via lifespan; se ausente, abre conexão ad-hoc com `asyncpg.connect(DATABASE_URL)`.

Tabelas vetoriais existentes:

| Tabela                               | Coluna      | Dimensão | Índice                                                        |
|--------------------------------------|-------------|----------|---------------------------------------------------------------|
| `public.knowledge_base`              | `embedding` | 1536     | `knowledge_base_embedding_idx` IVFFLAT `vector_cosine_ops` lists=100 |
| `{tenant}.tenant_memories`           | `embedding` | 1536     | sem índice IVFFLAT declarado em `init.sql` (busca sequencial) |

Memória de médio prazo por tenant (`tenant_memories`) classifica entradas em `user_preference`, `device_fact`, `network_topology`, `misc`.

## Volumes e persistência

| Volume host                 | Destino no container              | Container          |
|-----------------------------|-----------------------------------|--------------------|
| `./data/postgres`           | `/var/lib/postgresql/data`        | `netagent-postgres` |
| `./data/redis`              | `/data`                           | `netagent-redis`    |

Ambos estão em bind-mount (não volumes nomeados), o que simplifica backup baseado em arquivo mas requer parar o container para snapshots consistentes. Estratégia de backup: ver DEPLOY-AND-OPS.md.

## Pontos de atenção

- **Sem ferramenta de migrations:** mudanças de schema são aplicadas manualmente via scripts SQL (`init.sql` + `scripts/*.sql`), sem histórico versionado — há risco de drift entre dev e prod. Avaliar adoção de Prisma Migrate ou Flyway.
- **Divergência entre `init.sql` e `scripts/create_tenant_schema.sql`:** a segunda função, mais antiga, tem defaults ligeiramente diferentes e falta colunas (ex.: `device_history`, `device_snapshots`, `tenant_memories`, WireGuard). Um tenant criado via o script standalone ficará com schema incompleto.
- **Role único superuser:** o owner `netagent` controla tanto o database `netagent` quanto o `evolution`, sem separação de privilégios. Um comprometimento da Evolution API exporia o banco da plataforma.
- **`tenant_memories` sem índice IVFFLAT:** buscas por similaridade escalam linearmente com o número de memórias do tenant. OK para volumes pequenos, mas recomenda-se criar um `ivfflat` análogo ao de `knowledge_base`.
- [AUDIT-BUG-007 — UFW x Redis: regra 6379/tcp inconsistente com bind loopback](AUDIT-2026-04-21.md#audit-bug-007)
- [AUDIT-BUG-020 — Tenant isolation via interpolação raw, risco de SQL injection](AUDIT-2026-04-21.md#audit-bug-020)
- **Nenhum bug crítico DB-exclusivo identificado.** Ver [AUDIT-2026-04-21.md](AUDIT-2026-04-21.md) para os 24 bugs do sistema.
