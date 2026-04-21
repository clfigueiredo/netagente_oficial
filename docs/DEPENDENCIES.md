# Dependências

> Auditado em: 2026-04-21
> Comandos usados: `npm audit --omit=dev`, `pnpm audit --prod`, `pip check`, `pip list --outdated`, `docker image ls`, `node -v`, `python3 --version`, `docker --version`

Este documento consolida as versões de runtimes, imagens Docker e bibliotecas das três
aplicações da plataforma (API Node.js, Frontend React, Agent Python) além dos drivers
MCP (Mikrotik e Linux). Bugs consolidados (IDs `AUDIT-BUG-XXX`) ficam em
[`AUDIT-2026-04-21.md`](AUDIT-2026-04-21.md).

---

## Runtimes (host)

Versões observadas na VM de produção (Debian 12):

| Runtime        | Versão                | Instalação                |
|----------------|-----------------------|---------------------------|
| Node.js        | v20.20.0              | apt/NodeSource            |
| npm            | 10.8.2                | empacotado com Node 20    |
| pnpm           | 10.30.1               | corepack/npm global       |
| Python         | 3.11.2                | apt (Debian 12)           |
| Docker         | 29.2.1 (build a5c7197)| docker-ce                 |
| Docker Compose | v5.0.2 (plugin)       | plugin docker compose     |
| PM2            | 6.0.14                | npm global                |
| vsftpd         | 3.0.3-13+b2           | apt (Debian 12)           |

> `api/package.json` declara `"engines": { "node": ">=20.0.0" }` — compatível.
> O `cron` daemon **NÃO está instalado** — ver [AUDIT-BUG-001](AUDIT-2026-04-21.md#audit-bug-001).

---

## Imagens Docker

Resumo das imagens declaradas em `/var/www/agente_forum_telecom/docker-compose.yml`:

| Serviço       | Imagem                          | Tag       | Tipo          | Observação                                                    |
|---------------|----------------------------------|-----------|---------------|----------------------------------------------------------------|
| traefik       | `traefik`                       | `v3.6.1`  | upstream      | Tag fixa (pin explícito, bom para reproducibilidade)           |
| postgres      | `pgvector/pgvector`             | `pg16`    | upstream      | Tag móvel (extensão pgvector sobre Postgres 16)                |
| redis         | `redis`                         | `7-alpine`| upstream      | Tag móvel                                                      |
| evolution     | `evoapicloud/evolution-api`     | `v2.3.4`  | upstream      | Pin explícito                                                  |
| frontend      | `nginx`                         | `alpine`  | upstream      | Tag móvel — serve o `frontend/dist` estático                   |
| mcp-mikrotik  | build local                      | —         | Dockerfile    | `./mcp-mikrotik/Dockerfile`                                    |
| mcp-linux     | build local                      | —         | Dockerfile    | `./mcp-linux/Dockerfile`                                       |
| wireguard     | build local                      | —         | Dockerfile    | `./docker/wireguard/Dockerfile` (host-net, NET_ADMIN)          |

### Release / tag hygiene
- `traefik:v3.6.1` — pin explícito; verificar periodicamente se há release v3.x.y mais nova.
- `evoapicloud/evolution-api:v2.3.4` — pin explícito; confirmar no Docker Hub (`evoapicloud/evolution-api`).
- `pgvector/pgvector:pg16` — **tag móvel**; recomenda-se rebuild com `docker pull` mensal.
- `redis:7-alpine` — **tag móvel** sobre Redis 7.x.
- `nginx:alpine` — **tag móvel**; é atualizada pelo publisher.
- Builds locais (`mcp-mikrotik`, `mcp-linux`, `wireguard`) herdam a imagem base declarada no respectivo Dockerfile — qualquer update requer `docker compose build --no-cache`.

---

## API Node.js — `npm audit`

Escopo: `/var/www/agente_forum_telecom/api`.

### Resumo
**9 vulnerabilidades** (3 moderate, 6 high).

### Vulnerabilidades reportadas

| Pacote                   | Versão vulnerável | Severidade | Advisory(s)                                                                                                                                                                                      | Recomendação                        |
|--------------------------|-------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| `axios`                  | 1.0.0 – 1.14.0    | moderate   | GHSA-3p68-rc4w-qgx5 (SSRF via NO_PROXY bypass), GHSA-fvcv-3m26-pcqx (cloud metadata exfiltration via header injection)                                                                            | `npm audit fix`                     |
| `brace-expansion`        | <1.1.13           | moderate   | GHSA-f886-m6hf-6m8v (zero-step sequence → process hang / memory exhaustion)                                                                                                                       | `npm audit fix`                     |
| `follow-redirects`       | <=1.15.11         | moderate   | GHSA-r4q5-vmmm-2653 (custom auth headers leak em cross-domain redirect)                                                                                                                           | `npm audit fix`                     |
| `minimatch`              | <=3.1.3           | high       | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 (ReDoS em múltiplos padrões)                                                                                                        | `npm audit fix`                     |
| `path-to-regexp`         | 8.0.0 – 8.3.0     | high       | GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7 (ReDoS em grupos opcionais sequenciais e múltiplos wildcards)                                                                                             | `npm audit fix`                     |
| `socket.io-parser`       | 4.0.0 – 4.2.5     | high       | GHSA-677m-j7p3-52f9 (unbounded binary attachments)                                                                                                                                                | `npm audit fix`                     |
| `tar`                    | <=7.5.10          | high       | GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w (path traversal via hardlink, symlink poisoning, race condition APFS) | `npm audit fix --force` (breaking)  |
| `@mapbox/node-pre-gyp`   | <=1.0.11          | high       | (transitivo via `tar`)                                                                                                                                                                           | `npm audit fix --force`             |
| `bcrypt`                 | 5.0.1 – 5.1.1     | high       | (transitivo via `@mapbox/node-pre-gyp`)                                                                                                                                                          | `npm audit fix --force` (sobe p/ 6) |

> `npm audit fix --force` instala `bcrypt@6.0.0`, que é **breaking change**. Validar em staging antes de deploy.

### Dependências principais (do `api/package.json`)

| Pacote                   | Declarado no package.json | Papel                                         |
|--------------------------|---------------------------|-----------------------------------------------|
| `express`                | `^5.0.1`                  | HTTP framework (Express 5, ainda recente)      |
| `@prisma/client`         | `^5.22.0`                 | ORM (client)                                   |
| `prisma`                 | `^5.22.0`                 | CLI/migrate                                    |
| `socket.io`              | `^4.8.1`                  | WebSocket server                               |
| `redis`                  | `^4.7.0`                  | Client Redis                                   |
| `axios`                  | `^1.7.7`                  | HTTP client (Agent/MCP/Evolution)              |
| `bcrypt`                 | `^5.1.1`                  | Hash de senha (vulnerável — ver acima)         |
| `jsonwebtoken`           | `^9.0.2`                  | JWT auth                                       |
| `zod`                    | `^3.23.8`                 | Validação de schemas                           |
| `helmet`                 | `^8.0.0`                  | Middleware headers de segurança                |
| `cors`                   | `^2.8.5`                  | CORS                                           |
| `express-rate-limit`     | `^7.4.1`                  | Rate limiting                                  |
| `morgan`                 | `^1.10.0`                 | Logger HTTP                                    |
| `dotenv`                 | `^16.4.5`                 | Variáveis de ambiente                          |
| `ssh2`                   | `^1.17.0`                 | Cliente SSH (interação direta com dispositivos)|
| `nodemon` (dev)          | `^3.1.7`                  | Watcher de desenvolvimento                     |

---

## Frontend — `pnpm audit`

Escopo: `/var/www/agente_forum_telecom/frontend`.

### Resumo
**6 vulnerabilidades** (4 moderate, 2 high).

### Vulnerabilidades reportadas

| Pacote             | Versão vulnerável | Severidade | Advisory                                            | Caminho (transitivo)                 | Recomendação                       |
|--------------------|-------------------|------------|-----------------------------------------------------|--------------------------------------|-------------------------------------|
| `socket.io-parser` | >=4.0.0 <4.2.6    | high       | GHSA-677m-j7p3-52f9 (unbounded binary attachments)  | `.>socket.io-client>socket.io-parser`| `pnpm update socket.io-client`      |
| `lodash`           | >=4.0.0 <=4.17.23 | high       | GHSA-r5fr-rjxr-66jc (code injection via `_.template`)| `.>recharts>lodash`                  | Atualizar `recharts` (pin transitivo)|
| `lodash`           | <=4.17.23         | moderate   | GHSA-f23m-r3pf-42rh (prototype pollution em `_.unset`/`_.omit`)| `.>recharts>lodash`          | idem                               |
| `follow-redirects` | <=1.15.11         | moderate   | GHSA-r4q5-vmmm-2653 (leak de auth headers)          | `.>axios>follow-redirects`           | `pnpm update axios`                 |
| `axios`            | >=1.0.0 <1.15.0   | moderate   | GHSA-3p68-rc4w-qgx5 (SSRF via NO_PROXY bypass)      | `.>axios`                            | `pnpm update axios` (>=1.15.0)      |
| `axios`            | >=1.0.0 <1.15.0   | moderate   | GHSA-fvcv-3m26-pcqx (cloud metadata exfiltration)   | `.>axios`                            | `pnpm update axios`                 |

### Dependências principais (do `frontend/package.json`)

| Pacote                   | Declarado                | Papel                              |
|--------------------------|--------------------------|-------------------------------------|
| `react`                  | `^18.3.1`                | Biblioteca UI                       |
| `react-dom`              | `^18.3.1`                | DOM renderer                        |
| `react-router-dom`       | `^6.28.0`                | Roteamento client-side              |
| `@tanstack/react-query`  | `^5.62.7`                | Cache/fetching                      |
| `zustand`                | `^5.0.2`                 | State global                        |
| `axios`                  | `^1.7.7`                 | HTTP client (vulnerável — atualizar)|
| `socket.io-client`       | `^4.8.1`                 | WS client                           |
| `recharts`               | `^2.13.3`                | Gráficos (traz `lodash` vulnerável) |
| `date-fns`               | `^4.1.0`                 | Datas                               |
| `lucide-react`           | `^0.460.0`               | Ícones                              |
| `clsx`                   | `^2.1.1`                 | Utilitário classnames               |
| `vite` (dev)             | `^5.4.21`                | Bundler/dev server                  |
| `@vitejs/plugin-react`   | `^4.3.3`                 | Plugin Vite                         |
| `tailwindcss` (dev)      | `^3.4.16`                | CSS framework                       |
| `postcss` (dev)          | `^8.4.49`                | Pipeline CSS                        |
| `autoprefixer` (dev)     | `^10.4.20`               | Prefixos CSS                        |

---

## Agent Python — `pip check` + `pip list --outdated`

Escopo: `/var/www/agente_forum_telecom/agent` (venv de produção).

### `pip check`
`No broken requirements found.` — sem incompatibilidades de dependências resolvidas.

### Ausência de scan de CVE
`pip-audit` **não está instalado** no venv do Agent. Assim, não foi possível escanear CVEs
específicos das libs Python. Recomenda-se:
```
pip install pip-audit
pip-audit --strict
```

### Pacotes desatualizados (de `pip list --outdated`)

| Pacote                   | Atual      | Latest     | Tipo de update |
|--------------------------|------------|------------|----------------|
| aiohttp                  | 3.13.3     | 3.13.5     | patch          |
| anyio                    | 4.12.1     | 4.13.0     | minor          |
| attrs                    | 25.4.0     | 26.1.0     | major          |
| certifi                  | 2026.1.4   | 2026.2.25  | bundle roots   |
| charset-normalizer       | 3.4.4      | 3.4.7      | patch          |
| click                    | 8.3.1      | 8.3.2      | patch          |
| cryptography             | 46.0.5     | 46.0.7     | patch          |
| fastapi                  | 0.129.0    | 0.136.0    | minor          |
| google-auth              | 2.48.0     | 2.49.2     | minor          |
| google-genai             | 1.64.0     | 1.73.1     | minor          |
| idna                     | 3.11       | 3.12       | minor          |
| invoke                   | 2.2.1      | 3.0.3      | major          |
| jiter                    | 0.13.0     | 0.14.0     | minor          |
| jsonpointer              | 3.0.0      | 3.1.1      | minor          |
| langchain                | 1.2.10     | 1.2.15     | patch          |
| langchain-core           | 1.2.14     | 1.3.0      | minor          |
| langchain-google-genai   | 4.2.1      | 4.2.2      | patch          |
| langchain-openai         | 1.1.10     | 1.1.15     | patch          |
| langgraph                | 1.0.9      | 1.1.9      | minor          |
| langgraph-checkpoint     | 4.0.0      | 4.0.2      | patch          |
| langgraph-prebuilt       | 1.0.8      | 1.0.10     | patch          |
| langgraph-sdk            | 0.3.8      | 0.3.13     | patch          |
| langsmith                | 0.7.6      | 0.7.33     | patch          |
| numpy                    | 2.4.2      | 2.4.4      | patch          |
| openai                   | 2.21.0     | 2.32.0     | minor          |
| orjson                   | 3.11.7     | 3.11.8     | patch          |
| packaging                | 26.0       | 26.1       | minor          |
| psycopg2-binary          | 2.9.11     | 2.9.12     | patch          |
| pyasn1                   | 0.6.2      | 0.6.3      | patch          |
| pydantic                 | 2.12.5     | 2.13.3     | minor          |
| pydantic_core            | 2.41.5     | 2.46.3     | minor          |
| pydantic-settings        | 2.13.1     | 2.14.0     | minor          |
| python-dotenv            | 1.2.1      | 1.2.2      | patch          |
| python-multipart         | 0.0.22     | 0.0.26     | patch          |
| redis                    | 7.2.0      | 7.4.0      | minor          |
| regex                    | 2026.2.19  | 2026.4.4   | patch          |
| requests                 | 2.32.5     | 2.33.1     | minor          |
| setuptools               | 82.0.0     | 82.0.1     | patch          |

> Observação: `pip list --outdated` reporta versões instaladas no venv em tempo real,
> que em geral são **mais recentes** que as versões pinadas em `requirements.txt`
> (que define mínimos). Os pins reais no repositório estão na tabela abaixo.

### Declarado em `agent/requirements.txt`

| Pacote                   | Pin exato    | Papel                                            |
|--------------------------|--------------|--------------------------------------------------|
| `fastapi`                | `==0.115.4`  | HTTP framework do Agent                          |
| `uvicorn[standard]`      | `==0.32.1`   | ASGI server                                      |
| `aiohttp`                | `==3.10.10`  | HTTP client async                                |
| `httpx`                  | `==0.27.2`   | HTTP client (LangChain + Google SDK usam)        |
| `asyncpg`                | `==0.30.0`   | Driver Postgres async                            |
| `psycopg2-binary`        | `==2.9.10`   | Driver Postgres sync (apscheduler)               |
| `pgvector`               | `==0.3.5`    | Client pgvector                                  |
| `redis`                  | `==5.2.0`    | Client Redis                                     |
| `langchain`              | `==0.3.7`    | Framework LLM                                    |
| `langchain-openai`       | `==0.2.9`    | Integração OpenAI                                |
| `langgraph`              | `==0.2.53`   | Grafos de agente                                 |
| `openai`                 | `==1.54.5`   | SDK OpenAI                                       |
| `paramiko`               | `==3.5.0`    | Cliente SSH (fallback ao MCP Linux)              |
| `apscheduler`            | `==3.10.4`   | Scheduler do `MonitorScheduler` (ver AUDIT-BUG-012)|
| `pydantic`               | `==2.9.2`    | Validação                                        |
| `pydantic-settings`      | `==2.6.1`    | Configs por env                                  |
| `python-dotenv`          | `==1.0.1`    | .env loader                                      |
| `python-multipart`       | `==0.0.17`   | Uploads multipart (FastAPI)                      |

> O gap entre o **pin** do `requirements.txt` (ex.: `fastapi==0.115.4`) e a versão
> instalada no venv (ex.: `fastapi 0.129.0`) indica que o lockfile pinado e o ambiente
> efetivo divergem — recomenda-se regenerar `requirements.txt` (ou migrar para
> `uv`/`pip-tools` com lock) para evitar drift silencioso em reinstalações.

---

## MCP drivers — `requirements.txt`

### mcp-mikrotik (`/var/www/agente_forum_telecom/mcp-mikrotik/requirements.txt`)
```
mcp[cli]>=1.8.0
fastmcp>=3.0.0
paramiko>=3.4.0
uvicorn>=0.30.0
```

### mcp-linux (`/var/www/agente_forum_telecom/mcp-linux/requirements.txt`)
```
mcp[cli]>=1.8.0
fastmcp>=3.0.0
paramiko>=3.4.0
uvicorn>=0.30.0
```

> Ambos MCPs compartilham o mesmo conjunto mínimo: SDK MCP + FastMCP + Paramiko (SSH)
> + Uvicorn. Os pins são **lower bound** (`>=`), sem teto. `pip check` no container e
> `pip-audit` não foram executados aqui porque os drivers rodam dentro de containers
> builds locais — ao rebuild, a versão instalada será a **última compatível** no momento
> do build (fonte de drift).

---

## Release dates / tag hygiene (observações)

- `traefik:v3.6.1` — última release da série 3.x observada no Docker Hub. Verificar se há `v3.x.y` mais recente periodicamente.
- `evoapicloud/evolution-api:v2.3.4` — confirmar no Docker Hub se há patch posterior (esta série 2.x ainda recebe updates).
- `pgvector/pgvector:pg16` — tag móvel; recomenda-se `docker pull` + rebuild periódico (ex.: mensal) para capturar patches do Postgres 16.
- `redis:7-alpine` — tag móvel sobre Redis 7.x.
- `nginx:alpine` — tag móvel; absorve updates do Alpine.

---

## Pontos de atenção

- [AUDIT-BUG-004 — 6 vulnerabilidades HIGH em dependências da API (path-to-regexp, socket.io-parser, tar)](AUDIT-2026-04-21.md#audit-bug-004)
- [AUDIT-BUG-013 — 6 vulnerabilidades no frontend (axios SSRF + lodash code injection via recharts)](AUDIT-2026-04-21.md#audit-bug-013)
- Drift entre `agent/requirements.txt` (pins mais antigos) e o venv efetivo — considerar regenerar o lock.
- MCPs (`mcp-mikrotik` e `mcp-linux`) usam apenas lower-bound (`>=`) — cada rebuild pode trazer versões diferentes.
- `pip-audit` ausente no venv do Agent: nenhum scan de CVE Python foi feito nesta auditoria.
- `cron` daemon ausente — se houver plano futuro de rodar `npm audit` / `pip audit` agendado, depende de corrigir [AUDIT-BUG-001](AUDIT-2026-04-21.md#audit-bug-001) primeiro.
