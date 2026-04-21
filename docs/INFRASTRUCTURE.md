# Infraestrutura

> Auditado em: 2026-04-21
> Comandos usados: `docker ps -a`, `docker inspect <container>`, `docker compose config`, `ss -tlnp`, `ufw status verbose`, `systemctl status docker`

## Visão geral

O NetAgent roda em um servidor Debian 12 (`srv624012`) e é orquestrado por Docker Compose (arquivo `docker-compose.yml`, 194 linhas) expondo 8 containers em uma única rede bridge `netagent-net`. Dois componentes da aplicação (API Node em `:4000` e Agent Python em `:8000`) rodam diretamente no host sob gerenciamento do PM2 — fora do Compose — e se comunicam com os containers via `host-gateway`. Um terceiro processo no host é o `vsftpd` (porta `2121`, systemd), que recebe os backups dos MikroTik dos clientes. O Traefik `v3.6.1` é o único ponto de entrada público HTTPS e termina TLS em `80/443`. O container WireGuard usa `network_mode: host` para operar as interfaces VPN por tenant diretamente na stack de rede do host.

Docker Engine está ativo desde `2026-04-14 17:12:24 -03` e todos os containers acumulam `RestartCount: 0` desde essa data (uptime de ~6 dias na janela da auditoria).

## Containers

| Nome | Imagem | Papel | Restart | Portas host | Volumes-chave | Rede |
|---|---|---|---|---|---|---|
| `traefik` | `traefik:v3.6.1` | Reverse proxy / ACME Let's Encrypt | `unless-stopped` | `0.0.0.0:80->80`, `0.0.0.0:443->443`, `0.0.0.0:8080->8080` (dashboard) | `/run/docker.sock`, `./traefik/certs`, `./traefik/config:ro` | `netagent-net` |
| `netagent-frontend` | `nginx:alpine` | Serve frontend React (dist estático) | `unless-stopped` | não publica no host (exposto via Traefik) | `./frontend/dist:ro`, `./traefik/nginx-frontend.conf:ro` | `netagent-net` |
| `netagent-postgres` | `pgvector/pgvector:pg16` | PostgreSQL 16 + pgvector (multi-tenant) | `unless-stopped` | `127.0.0.1:5432->5432` | `./data/postgres` | `netagent-net` |
| `netagent-redis` | `redis:7-alpine` | Cache, filas, sessões (com `requirepass`) | `unless-stopped` | `127.0.0.1:6379->6379` | `./data/redis` | `netagent-net` |
| `evolution-api` | `evoapicloud/evolution-api:v2.3.4` | Gateway WhatsApp (v2, PostgreSQL-backed) | `unless-stopped` | não publica no host (exposto via Traefik) | `./data/evolution` | `netagent-net` |
| `mcp-mikrotik` | build `./mcp-mikrotik` | Driver SSH para RouterOS | `unless-stopped` (+ healthcheck) | `0.0.0.0:8001->8001`, `[::]:8001->8001` | — | `netagent-net` |
| `mcp-linux` | build `./mcp-linux` | Driver SSH para servidores Linux | `unless-stopped` (+ healthcheck) | `0.0.0.0:8002->8002`, `[::]:8002->8002` | — | `netagent-net` |
| `netagent-wireguard` | build `./docker/wireguard` | Concentrador VPN (interfaces por tenant) | `unless-stopped` | — (usa `network_mode: host`) | `./data/wireguard`, `/lib/modules:ro` | `host` |

Capabilities especiais: o container `netagent-wireguard` recebe `cap_add: NET_ADMIN, SYS_MODULE` e `TZ=America/Sao_Paulo`. O container `traefik` roda com `group_add: "994"` (grupo do socket Docker) para poder ler `/run/docker.sock`. Todos os containers de serviço declaram `extra_hosts: "host-gateway:host-gateway"` quando precisam alcançar os processos PM2 no host.

## Processos no host

| Processo | Gerenciador | Porta | Binding observado | Comando |
|---|---|---|---|---|
| `netagent-api` | PM2 | 4000 | `*:4000` (wildcard IPv4+IPv6) | `node /var/www/agente_forum_telecom/api/...` (pid 761896 no `ss`) |
| `netagent-agent` | PM2 | 8000 | `0.0.0.0:8000` | `uvicorn` (pid 8148 no `ss`) |
| `vsftpd` | systemd | 2121 | `0.0.0.0:2121` | `/usr/sbin/vsftpd /etc/vsftpd.conf` (pid 543) |

Detalhes de deploy, PM2 ecosystem e configuração do `vsftpd` estão documentados em `DEPLOY-AND-OPS.md`.

## Portas do host (mapeamento externo)

| Porta | Protocolo | Serviço | Binding efetivo | Origem | UFW |
|---|---|---|---|---|---|
| 22 | tcp | SSH (sshd) | `0.0.0.0` + `[::]` | host | `ALLOW` (v4+v6) |
| 80 | tcp | Traefik HTTP | `0.0.0.0` + `[::]` | docker-proxy | `ALLOW` (v4+v6) |
| 443 | tcp | Traefik HTTPS | `0.0.0.0` + `[::]` | docker-proxy | `ALLOW` (v4+v6) |
| 2121 | tcp | vsftpd FTP | `0.0.0.0` | host (systemd) | `ALLOW` (v4) + `ALLOW` duplicada (v6) |
| 4000 | tcp | API Node.js (PM2) | `*` (wildcard) | host | `ALLOW` (v4+v6) |
| 5355 | tcp | systemd-resolved LLMNR | `0.0.0.0` + `[::]` | host | — |
| 5432 | tcp | PostgreSQL | `127.0.0.1` | docker-proxy | — |
| 6379 | tcp | Redis | `127.0.0.1` | docker-proxy | `ALLOW` (inconsistente) |
| 8000 | tcp | Agent Python (PM2) | `0.0.0.0` | host (uvicorn) | `ALLOW` (v4+v6) |
| 8001 | tcp | MCP MikroTik | `0.0.0.0` + `[::]` | docker-proxy | default deny |
| 8002 | tcp | MCP Linux | `0.0.0.0` + `[::]` | docker-proxy | default deny |
| 8080 | tcp | Traefik dashboard | `0.0.0.0` + `[::]` | docker-proxy | default deny |
| 40000–40500 | tcp | FTP passive range | — (não observado em `ss`) | — | `ALLOW` (v4+v6) |
| 51820 | tcp/udp | WireGuard | — (host-mode, conforme tenant) | container `netagent-wireguard` | `ALLOW` tcp+udp (v4+v6) |
| 51820–51870 | udp | WireGuard range multi-tenant | host-mode | container `netagent-wireguard` | `ALLOW` (v4+v6) |
| `wg0` | any | Tráfego dentro do túnel | interface | WireGuard | `ALLOW IN` on `wg0` (v4+v6) |

UFW reportado como `Status: active`, `Default: deny (incoming), allow (outgoing), deny (routed)`, `Logging: on (low)`, `New profiles: skip`.

## Rede Docker

A única rede bridge do projeto é `netagent-net`, declarada no final do `docker-compose.yml` com `name: netagent-net` (nome explícito para evitar prefixo do Compose). O Docker atribui a sub-rede `172.18.0.0/16` a ela — observada via `docker-proxy` apontando para `172.18.0.4` (mcp-linux), `172.18.0.5` (traefik) e `172.18.0.6` (postgres).

Sete containers participam dessa rede (`traefik`, `netagent-frontend`, `netagent-postgres`, `netagent-redis`, `evolution-api`, `mcp-mikrotik`, `mcp-linux`) e se resolvem mutuamente via DNS interno do Docker pelo `container_name` (ex.: `netagent-postgres:5432` na `DATABASE_CONNECTION_URI` da Evolution). O `netagent-wireguard` é a exceção: usa `network_mode: "host"` e portanto não está em `netagent-net` — ele manipula interfaces `wg*` diretamente no namespace de rede do host.

Os processos PM2 no host (API `:4000`, Agent `:8000`) não participam da rede Docker; containers que precisam chamá-los usam `host-gateway` (declarado em `extra_hosts`), resolvido pelo Docker para o IP do bridge do host.

## Volumes bind-mount

| Host | Container | Modo | Propósito |
|---|---|---|---|
| `./data/postgres` | `/var/lib/postgresql/data` | rw | Dados persistentes do PostgreSQL 16 + pgvector |
| `./data/redis` | `/data` | rw | Dumps RDB/AOF do Redis 7 |
| `./data/evolution` | `/evolution/instances` | rw | Sessões WhatsApp / instâncias da Evolution API |
| `./data/wireguard` | `/etc/wireguard` | rw | Configs `wg*.conf` por tenant |
| `/lib/modules` | `/lib/modules` | ro | Módulos do kernel para `wg` no container WireGuard |
| `./traefik/certs` | `/certs` | rw | `acme.json` (Let's Encrypt) e certificados |
| `./traefik/config` | `/etc/traefik/config` | ro | Dynamic file provider (rotas para serviços no host) |
| `./traefik/nginx-frontend.conf` | `/etc/nginx/conf.d/default.conf` | ro | Config do Nginx que serve o frontend |
| `./frontend/dist` | `/usr/share/nginx/html` | ro | Build estático React/Vite |
| `/run/docker.sock` | `/var/run/docker.sock` | rw | Socket Docker para o provider `docker` do Traefik |

Todo o estado persistente (bancos, sessões WhatsApp, VPN) mora em `./data/*` — esse diretório é o que precisa de backup. A pasta `./traefik/certs` também deve ser incluída em qualquer rotina de backup para não re-emitir certificados Let's Encrypt a cada restore.

## Healthchecks

Dois containers declaram healthcheck no `docker-compose.yml`; os demais dependem apenas do `restart: unless-stopped`.

| Container | Endpoint testado | Intervalo | Timeout | Retries |
|---|---|---|---|---|
| `mcp-mikrotik` | `http://localhost:8001/health` (via `urllib.request`) | 30s | 5s | 3 |
| `mcp-linux` | `http://localhost:8002/health` (via `urllib.request`) | 30s | 5s | 3 |

Ambos estavam reportando `(healthy)` em `docker ps -a` no momento da auditoria. PostgreSQL, Redis, Evolution, Traefik, Frontend e WireGuard não possuem healthcheck declarado — seu estado é inferido apenas pelo `Running: true` do Docker.

## Pontos de atenção

- [AUDIT-BUG-002 — API 4000 exposta publicamente](AUDIT-2026-04-21.md#audit-bug-002)
- [AUDIT-BUG-003 — Agent 8000 exposta publicamente](AUDIT-2026-04-21.md#audit-bug-003)
- [AUDIT-BUG-008 — MCPs 8001/8002 em 0.0.0.0](AUDIT-2026-04-21.md#audit-bug-008)
- [AUDIT-BUG-009 — Traefik dashboard 8080 em 0.0.0.0](AUDIT-2026-04-21.md#audit-bug-009)
- [AUDIT-BUG-007 — Regra UFW 6379 inconsistente](AUDIT-2026-04-21.md#audit-bug-007)
- [AUDIT-BUG-018 — UFW duplicada 2121 ipv6](AUDIT-2026-04-21.md#audit-bug-018)
