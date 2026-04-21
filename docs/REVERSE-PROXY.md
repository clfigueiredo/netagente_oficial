# Reverse Proxy

> Auditado em: 2026-04-21
> Comandos usados: `docker logs traefik`, `curl -I https://...`, `openssl s_client -connect ...:443`, `ss -tlnp`, `docker inspect traefik`, `cat traefik/config/*.yml`

## Resposta objetiva

**O proxy reverso público do sistema é o Traefik v3.6.1**, que expõe as portas 80 e 443 ao mundo e termina TLS usando certificados emitidos automaticamente pelo Let's Encrypt via HTTP-01 challenge. **O Nginx existe mas em papel secundário de sidecar**: roda dentro do container `netagent-frontend` (imagem `nginx:alpine`), serve exclusivamente os arquivos estáticos do bundle do frontend React/Vite (`frontend/dist/`) para o Traefik dentro da rede Docker `netagent-net`, e **nunca fica diretamente exposto à internet**. Além de servir estáticos, esse Nginx interno também atua como roteador L7 para a API Node.js (`/api/`, `/socket.io/`) e para o Agent Python (`/webhook`) via `host-gateway` — mas sempre atrás do Traefik.

## Diagrama de fluxo

```
                         Internet (62.72.8.248)
                                   │
                                   ▼  :80 / :443
                       ┌──────────────────────────┐
                       │ Traefik v3.6.1           │
                       │ - entrypoints web/websec │
                       │ - ACME Let's Encrypt R12 │
                       │ - providers: docker+file │
                       └────────────┬─────────────┘
                                    │ Docker network: netagent-net
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
 ┌──────────────┐           ┌───────────────┐          ┌──────────────────┐
 │ netagent-    │           │ evolution-api │          │ file provider    │
 │ frontend     │           │  :8080        │          │ host-services.yml│
 │ nginx:alpine │           │ (Evolution    │          │                  │
 │ :80 interno  │           │  v2.3.4)      │          │ api-host  →      │
 │              │           │               │          │  host-gw:4000    │
 │ serve        │           │ Host=         │          │ agent-host →     │
 │ /dist +      │           │ agenteevo.... │          │  host-gw:8000    │
 │ proxies      │           └───────────────┘          └──────────────────┘
 │ /api, /ws,   │
 │ /webhook     │
 │ para host-gw │
 └──────────────┘
 Host=agente.forumtelecom.com.br
```

## Traefik — proxy público

### Configuração (do `docker-compose.yml` linhas 3-35)

| Item                     | Valor                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| Imagem                   | `traefik:v3.6.1`                                                       |
| Container name           | `traefik`                                                              |
| Restart policy           | `unless-stopped`                                                       |
| Entrypoints              | `web` (`:80`), `websecure` (`:443`), além de API/dashboard em `:8080`  |
| Providers                | Docker (labels, `exposedbydefault=false`) + File (`/etc/traefik/config`, `watch=true`) |
| Dashboard                | `--api.dashboard=true` + `--api.insecure=false`                        |
| TLS / ACME               | Resolver `letsencrypt`, HTTP-01 challenge via entrypoint `web`         |
| Email ACME               | `admin@forumtelecom.com.br`                                            |
| Storage de certs         | `/certs/acme.json` → host `./traefik/certs/acme.json`                  |
| Docker socket            | `/run/docker.sock` montado em `/var/run/docker.sock`                   |
| `extra_hosts`            | `host-gateway:host-gateway` (resolve serviços do host via bridge)      |
| Rede                     | `netagent-net` (bridge Docker)                                         |
| Portas publicadas (host) | `80:80`, `443:443`, `8080:8080` (dashboard — ver AUDIT-BUG-009)        |

### Roteamento via labels Docker (docker-compose.yml)

| Host                             | Router                | Serviço destino          | Entrypoint | TLS            | Middlewares            |
| -------------------------------- | --------------------- | ------------------------ | ---------- | -------------- | ---------------------- |
| `agente.forumtelecom.com.br`     | `frontend-https`      | `netagent-frontend:80`   | websecure  | letsencrypt    | —                      |
| `agente.forumtelecom.com.br`     | `frontend-http`       | `netagent-frontend:80`   | web        | —              | `https-redirect`       |
| `agenteevo.forumtelecom.com.br`  | `evolution-https`     | `evolution-api:8080`     | websecure  | letsencrypt    | —                      |
| `agenteevo.forumtelecom.com.br`  | `evolution-http`      | `evolution-api:8080`     | web        | —              | `https-redirect`       |

O middleware `https-redirect` é declarado **uma única vez** como label do container `frontend` (`redirectscheme.scheme=https`) e é referenciado pelos routers HTTP dos dois serviços. Isso gera o warning documentado em AUDIT-BUG-006 (`middleware "https-redirect@docker" does not exist entryPointName=web routerName=evolution-http@docker`) — provavelmente por ordem de carregamento ou porque o Traefik procura `https-redirect@docker` no escopo do próprio router `evolution-http`. Apesar do warning, o redirect funciona em produção (307 confirmado via `curl -I`).

### Roteamento via file provider (`traefik/config/host-services.yml`)

A pasta `traefik/config/` contém **um único arquivo** no momento da auditoria: `host-services.yml` (1.728 bytes, última modificação 2026-02-21). Ele define routers para serviços que rodam **no host, fora do Docker** (API Node.js via PM2 na porta 4000 e Agent Python na porta 8000):

| Host                         | Router         | Serviço    | Entrypoint | TLS         | Middlewares             |
| ---------------------------- | -------------- | ---------- | ---------- | ----------- | ----------------------- |
| `api.forumtelecom.com.br`    | `api-https`    | `api-host` | websecure  | letsencrypt | `cors-api`              |
| `api.forumtelecom.com.br`    | `api-http`     | `api-host` | web        | —           | `https-redirect`        |
| `agent.forumtelecom.com.br`  | `agent-https`  | `agent-host` | websecure | letsencrypt | —                       |
| `agent.forumtelecom.com.br`  | `agent-http`   | `agent-host` | web        | —           | `https-redirect`        |

Services:
- `api-host` → `http://host-gateway:4000`
- `agent-host` → `http://host-gateway:8000`

Middlewares (file provider):
- `https-redirect` → `redirectScheme { scheme: https, permanent: true }`
- `cors-api` → headers permitindo `GET/POST/PUT/DELETE/OPTIONS`, origem única `https://agente.forumtelecom.com.br`, max-age 3600.

**Observação importante:** esses dois hosts (`api.forumtelecom.com.br` e `agent.forumtelecom.com.br`) **não constam nos logs de ACME como certificados emitidos**. Os únicos certs ativos hoje são para `agente.*` e `agenteevo.*`. Se os hosts `api.*`/`agent.*` não tiverem registros DNS apontando para `62.72.8.248`, os routers do file provider são inertes. Se tiverem, Traefik tentará ACME sob demanda no próximo acesso HTTPS.

### Certificados SSL (evidência 2026-04-21)

Valores extraídos com `openssl s_client -servername <host> -connect <host>:443 | openssl x509 -noout -dates -issuer -subject`:

| Domínio                           | Issuer                                 | notBefore            | notAfter             | Status                    |
| --------------------------------- | -------------------------------------- | -------------------- | -------------------- | ------------------------- |
| `agente.forumtelecom.com.br`      | C=US, O=Let's Encrypt, CN=R12          | 2026-02-21 02:02:08  | 2026-05-22 02:02:07  | Válido (31 dias restantes) |
| `agenteevo.forumtelecom.com.br`   | C=US, O=Let's Encrypt, CN=R12          | 2026-02-21 04:09:16  | 2026-05-22 04:09:15  | Válido (31 dias restantes) |

Ambos os certs são ECDSA/Let's Encrypt R12 emitidos no mesmo dia (21/02/2026), sugerindo que foram criados juntos no bootstrap inicial do sistema. A janela de 31 dias restantes está **dentro do limiar de renovação do Traefik (30 dias)** — veja AUDIT-BUG-005.

### Redirect HTTP → HTTPS (verificado em 2026-04-21 via `curl -I`)

```
http://agente.forumtelecom.com.br    → HTTP/1.1 307 Temporary Redirect → https://agente.forumtelecom.com.br/
http://agenteevo.forumtelecom.com.br → HTTP/1.1 307 Temporary Redirect → https://agenteevo.forumtelecom.com.br/
```

Ambos funcionando. O status `307` é o default do Traefik quando `permanent: false` (nos labels do Docker); no file provider, `permanent: true` retornaria `308`. Como não há cert para `api.*`/`agent.*` em produção, esses hosts não foram testados.

### DNS

Ambos os hosts HTTPS ativos resolvem para o IP público `62.72.8.248`:

```
agente.forumtelecom.com.br     A   62.72.8.248
agenteevo.forumtelecom.com.br  A   62.72.8.248
```

## Nginx — sidecar interno

### Papel

O container `netagent-frontend` usa a imagem oficial `nginx:alpine` e serve **dois propósitos** atrás do Traefik:

1. **Servir estáticos do frontend** — React/Vite bundle montado em `/usr/share/nginx/html` (read-only) a partir de `./frontend/dist/`. SPA fallback via `try_files $uri $uri/ /index.html`.
2. **Proxy L7 para serviços do host** — redireciona subcaminhos específicos (`/api/`, `/socket.io/`, `/webhook`) para processos rodando no host via `host-gateway`.

O Nginx **não tem porta publicada no host** (ver `docker-compose.yml` linhas 38-60 — só expõe via label Traefik, sem `ports:`). Logo, é inalcançável diretamente da internet; qualquer requisição chega via Traefik.

### Configuração

- Arquivo: `/var/www/agente_forum_telecom/traefik/nginx-frontend.conf` (53 linhas)
- Montagem: `./traefik/nginx-frontend.conf:/etc/nginx/conf.d/default.conf:ro`
- Volume estático: `./frontend/dist:/usr/share/nginx/html:ro`
- Porta interna: 80 (somente rede Docker `netagent-net`, não exposta ao host)
- Server header exposto: `nginx/1.29.5` (verificado em `curl -I https://agente.forumtelecom.com.br`)

### Diretivas principais do `nginx-frontend.conf`

```nginx
server {
    listen 80;
    root  /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    location /assets/       { expires 1y; add_header Cache-Control "public, immutable"; }
    location /webhook       { proxy_pass http://host-gateway:8000/webhook; ... }   # Agent Python
    location /api/          { proxy_pass http://host-gateway:4000/;       ... }   # API Node.js
    location /socket.io/    { proxy_pass http://host-gateway:4000;        ... }   # WebSocket Upgrade
    location /              { try_files $uri $uri/ /index.html; }                 # SPA fallback
}
```

Headers propagados nos proxies: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`. WebSocket em `/socket.io/` usa `Upgrade/Connection` + `proxy_read_timeout 86400s`.

**Consequência arquitetural:** existem **dois caminhos paralelos para chegar na API Node.js (4000) e no Agent (8000)**:
- (a) Pelo nginx sidecar: `https://agente.forumtelecom.com.br/api/...` → Traefik → nginx → host-gateway:4000
- (b) Pelo file provider: `https://api.forumtelecom.com.br/...` → Traefik → host-gateway:4000 (sem passar pelo nginx)

Ambos convergem no mesmo backend, mas o caminho (a) é o usado em produção hoje (o frontend faz `fetch('/api/...')` no mesmo host) e o (b) depende de DNS que pode não estar configurado.

### Por que dois proxies?

Traefik é excelente em roteamento dinâmico (labels Docker), terminação TLS e ACME, mas não é o mais eficiente para servir arquivos estáticos (não tem cache de disco nativo, não tem gzip afinado, não otimiza `expires`/`Cache-Control` por extensão). Nginx é especialista nisso. A arquitetura adotada segue um padrão comum: **Traefik na borda** (SNI, HTTP→HTTPS, ACME, roteamento por Host), **Nginx atrás** servindo assets do SPA e fazendo proxy L7 para serviços do host que não estão em containers Docker. O Nginx só escuta na rede Docker interna — nunca recebe tráfego público direto.

## Verificações específicas da auditoria

- [x] Container Traefik UP e healthy no momento da auditoria
- [x] Certs Let's Encrypt R12 válidos para ambos domínios em produção (31 dias restantes)
- [x] Redirect HTTP→HTTPS funcionando nos dois domínios (307)
- [x] Dashboard Traefik configurado com `api.insecure=false` (exige auth)
- [x] File provider `host-services.yml` carrega sem erro (Traefik aceita o YAML)
- [x] Nginx sidecar responde com `server: nginx/1.29.5`
- [x] Nginx sidecar **não** tem porta publicada no host (apenas rede Docker)
- [ ] ACME auto-renewal está em risco — token failure recente (ver AUDIT-BUG-005)
- [ ] Middleware `https-redirect@docker` reporta "não existe" em logs apesar de funcionar (ver AUDIT-BUG-006)
- [ ] Porta 8080 do dashboard Traefik em `0.0.0.0` (ver AUDIT-BUG-009)
- [ ] Hosts `api.forumtelecom.com.br` e `agent.forumtelecom.com.br` configurados no file provider podem não ter DNS/certs ativos — verificar

## Pontos de atenção

- [AUDIT-BUG-005 — ACME token failure, certs expiram em 31 dias](AUDIT-2026-04-21.md#audit-bug-005)
- [AUDIT-BUG-006 — middleware `https-redirect@docker` não encontrado em logs](AUDIT-2026-04-21.md#audit-bug-006)
- [AUDIT-BUG-009 — dashboard Traefik (8080) bindando em 0.0.0.0](AUDIT-2026-04-21.md#audit-bug-009)
- [AUDIT-BUG-015 — scanner externo sondando `/assets/.git/config` pelo nginx sidecar](AUDIT-2026-04-21.md#audit-bug-015)
- [AUDIT-BUG-016 — warnings Traefik de containers stale](AUDIT-2026-04-21.md#audit-bug-016)
