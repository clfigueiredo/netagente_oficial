# Deploy & Operações

> Auditado em: 2026-04-21
> Comandos usados: leitura de `deploy.sh`, `deploy-frontend.sh`, `server-setup.sh`, `installer/scripts/install.sh`, `installer/build.sh`; `pm2 jlist`; `systemctl status vsftpd`; `systemctl is-active cron`; `ls /etc/cron.d/`; `ufw status verbose`; `ss -tlnp`; leitura de `/etc/vsftpd.conf`.

## Visão geral

A plataforma NetAgent é operada em um único servidor Debian 12 (`srv624012`) com arquitetura mista:

- **Host (bare-metal, via PM2):** API Node.js 20 (`netagent-api`, porta 4000) e Agent Python 3.11 (`netagent-agent`, porta 8000).
- **Docker Compose:** Traefik 3.2, PostgreSQL 16 + pgvector, Redis 7, Evolution API v1.8.2, MCPs (mikrotik 8001, linux 8002), netagent-frontend (nginx), netagent-wireguard.
- **Serviço nativo do host:** `vsftpd` em `127.0.0.1:2121` (na verdade bind `0.0.0.0:2121`, ver Firewall) como destino de backups FTP agendados dentro dos próprios MikroTiks.
- **Deploy:** scripts shell in-place em `/var/www/agente_forum_telecom/`. Não há CI/CD, nem blue/green, nem GitHub Actions ativos.
- **IMPORTANTE — bug crítico:** o daemon `cron` NÃO está instalado no servidor (`Unit cron.service could not be found`, binário `crontab` ausente). Arquivos em `/etc/cron.d/` existem mas nunca executam. Ver [AUDIT-BUG-001](AUDIT-2026-04-21.md#audit-bug-001).
- Tarefas recorrentes da plataforma rodam **in-process** via APScheduler dentro do Agent Python (ver `AGENT-AND-MCP.md`). O sistema NÃO depende do cron do SO para nada de negócio — apenas tarefas de housekeeping do SO ficam quebradas.

## Scripts de deploy

| Script | Propósito | Idempotente? | Observação |
|---|---|---|---|
| `deploy.sh` | Deploy in-place em produção no caminho atual (`/var/www/agente_forum_telecom/`) | Parcialmente (reaplica `init.sql` toda vez; `pm2 delete` + `pm2 start`) | Requer `.env` pronto. Gera superadmin apenas se `platform_users` estiver vazio. |
| `deploy-frontend.sh` | Build do frontend + `docker restart netagent-frontend` | Sim | Trivial — o nginx monta `./frontend/dist` via volume, basta rebuildar. |
| `server-setup.sh` | Setup completo de servidor novo **em `/opt/netagent`** | Parcialmente (checa se Docker/Node/Python já existem) | **Não instala `cron`**, **não instala `vsftpd`** — divergente de `install.sh`. Gera `.env` com segredos. Faz `ufw --force reset`. |
| `installer/scripts/install.sh` | Instalador "universal" Debian/Ubuntu — inclui vsftpd e Wireguard | Parcialmente | **Também não instala `cron`**. Instala `vsftpd`, libera UFW 2121/40000-40500, instala Node/Python/Docker/PM2. |
| `installer/build.sh` | Gera pacote `netagent-installer.tar.gz` distribuível (contém frontend buildado + API + Agent + MCPs + Traefik + install.sh) | Sim (limpa `netagent-release/` antes) | 7 passos, empacotamento tar.gz na raiz do repo. |

### Divergência importante

Existem **três caminhos de deploy distintos** com comportamentos não idênticos:
1. `deploy.sh` (produção in-place, assume servidor já preparado, PROJECT_DIR = dir do script).
2. `server-setup.sh` (bootstrap Debian 12, usa `/opt/netagent`, sem vsftpd, UFW mínima).
3. `installer/scripts/install.sh` (bootstrap genérico, `/opt/netagent`, COM vsftpd e WireGuard, UFW estendida).

O **servidor em produção atual** usa `/var/www/agente_forum_telecom/` (não `/opt/netagent`), e a UFW corresponde ao que `install.sh` configura (2121, 40000-40500, 51820), mais regras extras abertas manualmente (4000, 6379, 8000) — ver seção UFW. O deploy corrente provavelmente foi feito via `install.sh` → re-relocado para `/var/www/` → subsequentes iterações via `deploy.sh`.

## Fluxo de deploy in-place (`deploy.sh`)

Passo-a-passo com linhas de `/var/www/agente_forum_telecom/deploy.sh`:

1. **L17–18:** carrega `.env` (aborta se não existir) e exporta vars.
2. **L21–26:** cria diretórios `data/postgres`, `data/redis`, `data/evolution`, `traefik/certs`, `traefik/config`, `logs`; toca `acme.json` com `chmod 600`.
3. **L29–84:** **sobrescreve** `traefik/config/host-services.yml` toda vez (domínio hard-coded como `agente.forumtelecom.com.br`, rotas para `host-gateway:4000` API, `:8000` Agent, `:3000` frontend — mas hoje frontend é servido pelo container `netagent-frontend` na 80/443 do Traefik via labels, não pelo file provider; ver `REVERSE-PROXY.md`).
4. **L87–91:** `docker compose up -d --remove-orphans` + `sleep 8` + `docker compose ps`.
5. **L94–97:** `PGPASSWORD=… psql … < api/src/db/init.sql` — **reaplica o schema inteiro toda vez** (`init.sql` precisa ser idempotente, do contrário quebra).
6. **L100–105:** se existir `api/scripts/add_mcp_drivers.sql`, aplica também (silencia erros com `|| true`).
7. **L108–111:** `cp .env api/.env && cd api && npm install --production && npx prisma generate`.
8. **L114–120:** `cp .env agent/.env`; cria venv `python3.11 -m venv venv` se não existir; `pip install -r requirements.txt` silencioso.
9. **L123–125:** `cd frontend && npm install && npm run build`.
10. **L128–146:** conta `platform_users`; se 0, cria superadmin com senha aleatória gerada via `openssl rand -base64 16` + bcrypt `cost=12` e imprime credenciais.
11. **L149–166:** `pm2 delete` ambos (silencia erro), `pm2 start api/src/index.js --name netagent-api` e `pm2 start ./venv/bin/uvicorn --name netagent-agent -- main:app --host 0.0.0.0 --port 8000`; `pm2 save`.
12. **L169–178:** `pm2 list` + mensagem final com URLs.

**Observações operacionais:**
- Não há `git pull` — assume-se que o operador já fez `git pull` antes de rodar `./deploy.sh`.
- Não há health check no final. Se a API subir e crashar, o script retorna sucesso.
- `pm2 delete` + `pm2 start` causa **downtime de ~3–5s** a cada deploy.
- Não existe rollback automático.

## Fluxo de instalação em servidor novo

### Via `server-setup.sh` (Debian 12 limpo)

Passo-a-passo das linhas de `/var/www/agente_forum_telecom/server-setup.sh`:

1. **L35–45:** exige root, valida Debian 12.
2. **L50–58 (`setup_system`):** `apt-get update && upgrade`; instala `curl wget git unzip ca-certificates gnupg lsb-release openssl ufw fail2ban htop jq build-essential software-properties-common apt-transport-https`.
3. **L62–79 (`install_docker`):** instala Docker CE via repo oficial, `systemctl enable --now docker`.
4. **L82–92 (`install_nodejs`):** Node 20 via NodeSource + `npm install -g pm2`.
5. **L95–105 (`install_python`):** Python 3.11 + venv + dev + pip.
6. **L108–118 (`setup_firewall`):** `ufw --force reset`, default deny incoming, libera **apenas** `ssh`, `80/tcp`, `443/tcp`. (Notar: não libera 2121, 40000-40500, nem WireGuard — divergência do estado atual do servidor.)
7. **L121–134 (`setup_dirs`):** cria `/opt/netagent/` + subpastas traefik/postgres/redis/evolution/logs + `acme.json` 600.
8. **L137–183 (`generate_env`):** gera segredos com `openssl rand -hex 32` para `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `EVOLUTION_KEY`; escreve `/opt/netagent/.env` com `chmod 600`.
9. **L186–267 (`setup_traefik_file_config`):** escreve `traefik/config/host-services.yml` com substituição do domínio via `sed`.
10. **L270–372 (`create_docker_compose`):** escreve `docker-compose.yml` (Traefik 3.2, Postgres pgvector/pg16, Redis 7, Evolution v1.8.2).
11. **L375–384 (`start_containers`):** `docker compose up -d`, `sleep 10`, `docker compose ps`.
12. **L387–413 (`verify`):** health check de Postgres (`pg_isready`), Redis (`redis-cli PING`), Evolution (curl 8080), Traefik (`docker inspect`).
13. **L416–457 (`print_summary`):** imprime resumo + chave EVOLUTION_GLOBAL_KEY gerada.

**NÃO inclui:** vsftpd, WireGuard, deploy da API/Agent/Frontend, cron daemon, fail2ban config (embora instale o pacote).

### Via `installer/scripts/install.sh` (mais completo)

Passo-a-passo das linhas de `/var/www/agente_forum_telecom/installer/scripts/install.sh`:

1. **L27–35 (`prompt_config`):** pergunta interativamente domínios + email SSL + OPENAI_KEY.
2. **L37–41 (`install_system_deps`):** instala `curl wget git unzip ca-certificates gnupg lsb-release ufw vsftpd build-essential`.
3. **L43–50 (`install_docker`):** `curl get.docker.com | bash` + enable.
4. **L52–60 (`install_nodejs`):** Node 20 via NodeSource + PM2.
5. **L62–68 (`install_python`):** `python3 python3-venv python3-pip python3-dev` (Python do SO, não 3.11 explícito).
6. **L70–89 (`setup_vsftpd`):** configura `/etc/vsftpd.conf` via `sed` — `listen=YES`, `listen_ipv6=NO` (comentado), `anonymous_enable=NO`, `local_enable=YES`, `write_enable=YES`, `listen_port=2121`, `pasv_min_port=40000`, `pasv_max_port=40500`; `systemctl enable --now vsftpd`.
7. **L91–105 (`setup_firewall`):** `ufw --force reset`, libera ssh + 80 + 443 + **2121/tcp** + **40000:40500/tcp** + **51820/udp**.
8. **L107–152 (`setup_env`):** gera `.env` com 5 segredos (iguais ao server-setup), distribui cópia para `api/.env` e `agent/.env`.
9. **L154–214 (`prepare_host_routing`):** reescreve `traefik/config/host-services.yml` com domínio fornecido.
10. **L216–227 (`deploy_docker`):** `docker compose up -d --build` + `sleep 15`.
11. **L229–255 (`deploy_host_pm2`):** `npm install --production` na API; aplica `init.sql` (silencia erro); cria venv Python e instala `requirements.txt`; `pm2 start` api + agent.
12. **L257–268 (`create_superadmin`):** idêntico a `deploy.sh` (bcrypt cost 12, mas senha apenas 12 chars vs. 16 do deploy.sh — inconsistência cosmética).

**NÃO inclui:** instalação do daemon `cron` (bug), configuração de fail2ban, configuração de WireGuard server (apesar de liberar a porta), deploy do frontend.

### `installer/build.sh`

Gera `netagent-installer.tar.gz` contendo: `frontend/dist` (buildado), `api/` (sem node_modules), `agent/` (sem venv nem __pycache__), `mcp-mikrotik/`, `mcp-linux/`, `docker/`, `traefik/`, `docker-compose.yml`, `install.sh` (renomeado de `installer/scripts/install.sh`). Executa `npm install && npm run build` no frontend como passo 1 — requer Node já instalado na máquina que gera o pacote.

## PM2

### Processos ativos (snapshot 2026-04-21)

| Nome | ID | Status | PID | Restarts | Uptime | Mem | CPU | Modo | CWD | Comando |
|---|---|---|---|---|---|---|---|---|---|---|
| `netagent-api` | 0 | online | 761896 | 1 | 39h | 103.4 MB | 0% | fork | `/var/www/agente_forum_telecom/api` | `node src/index.js` |
| `netagent-agent` | 1 | online | 8148 | 2 | 6 dias | 145.0 MB | 0% | fork | `/var/www/agente_forum_telecom/agent` | `./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000` |

Ambos rodam como `root` (não ideal — deveriam rodar como usuário dedicado sem privilégios).

### Configuração PM2

- **Ecosystem file:** NÃO existe (`ls /var/www/agente_forum_telecom/ecosystem*` → 0 resultados, `find` também vazio). Os serviços são iniciados via argumentos de CLI do `pm2 start` dentro do `deploy.sh` (L149–165). Vantagem: simples. Desvantagem: qualquer mudança de ENV/flags exige editar o shell script; `pm2 resurrect` depende do `pm2 save` prévio ser compatível.
- **Autostart no boot:** depende de `pm2 startup systemd -u root --hp /root` ter sido rodado em algum momento (provavelmente sim, já que o Agent tem 6 dias de uptime mesmo após reboots de container). `pm2 save` é chamado ao final do `deploy.sh` (L165).
- **Log files:**
  - `netagent-api` out: `/root/.pm2/logs/netagent-api-out.log`; err: `/root/.pm2/logs/netagent-api-error.log`; além disso `deploy.sh` passa `--log /var/www/agente_forum_telecom/logs/api.log` (log combinado).
  - `netagent-agent` out: `/root/.pm2/logs/netagent-agent-out.log`; err idem; combinado em `/var/www/agente_forum_telecom/logs/agent.log`.
- **Modo:** ambos em `fork` mode (1 instância). Sem cluster mode — para escalar a API seria necessário `pm2 start -i max` ou ecosystem file com `instances: 'max'`.

### Observações nos logs

- **Agent sendo varrido por scanners externos** (`:8000` aberto publicamente — ver AUDIT-BUG-003): logs mostram muitos `404` vindos de IPs aleatórios (`172.233.29.203`, `43.98.196.102`, `159.223.166.102`, `167.172.136.255` etc.) probando paths genéricos (`/wp-content/...`, `/sap/bc/...`, `/nifi-api/...`).
- **API também está sendo probada na porta 4000 diretamente** (AUDIT-BUG-002): logs mostram `::ffff:71.6.236.70 GET / HTTP/1.0 401` e `::ffff:178.62.97.113 GET / HTTP/1.1 401` — IPs externos hitando `http://62.72.8.248:4000/` (IP público do servidor).
- Circuit breaker timeouts no `mcp-mikrotik` são logados como esperado (`circuit_timeout driver=mcp-mikrotik timeout_s=30.0`).
- Erros de asyncio no MonitorScheduler (ver AUDIT-BUG-012).

## Cron

### Estado do daemon

| Item | Valor |
|---|---|
| `systemctl is-active cron` | `inactive` |
| `systemctl status cron` | `Unit cron.service could not be found.` |
| Binário `crontab` | Ausente (`crontab: command not found`) |
| `/var/spool/cron/crontabs/` | Não existe |
| Diretório `/etc/cron.d/` | Existe, com arquivos dentro |

**Ou seja: os arquivos em `/etc/cron.d/` são completamente inertes.** Nenhum dos scripts de deploy (`deploy.sh`, `server-setup.sh`, `installer/scripts/install.sh`) instala o pacote `cron`. Bug crítico → [AUDIT-BUG-001](AUDIT-2026-04-21.md#audit-bug-001).

### Entries presentes (nunca executam)

| Arquivo | Schedule | Comando | Origem | Status |
|---|---|---|---|---|
| `/etc/cron.d/docker-image-prune` | `16 0 * * *` (root) | `docker image prune -af --filter "until=24h" > /dev/null 2>&1` | Provavelmente criado manualmente pelo operador em 2026-04-16 | NUNCA EXECUTA |
| `/etc/cron.d/e2scrub_all` | `30 3 * * 0` (dom 03:30, root) + `10 3 * * *` (diário 03:10, root) | `e2scrub_all_cron` / `e2scrub_all -A -r` | Pacote `e2fsprogs` (default Debian) | NUNCA EXECUTA |

**Impacto operacional:**
- Imagens Docker antigas se acumulam → disco enche com o tempo. Hoje (21/04/2026) o `docker image prune` deveria ter rodado 5 vezes desde 16/04 e não rodou nenhuma.
- `e2scrub_all` verifica integridade de filesystems ext4 — também não roda. Risco silencioso.

### Scheduler in-process (não afetado)

O Agent Python usa `APScheduler` internamente para:
- Tarefas recorrentes por tenant (automations) via `CronTrigger.from_crontab(expr, timezone=...)`.
- Polling de dispositivos via `IntervalTrigger` no `MonitorScheduler` (ver AGENT-AND-MCP.md).

Essas tarefas rodam dentro do processo `netagent-agent` (PID 8148) e **não dependem do cron do SO**. Portanto toda a automação de negócio continua funcionando mesmo com o cron daemon ausente — mas isso é coincidência, não design intencional.

## FTP — vsftpd

### Estado

| Item | Valor |
|---|---|
| Serviço | `vsftpd.service`, `active (running)`, enabled |
| PID | 543 |
| Uptime | desde 2026-04-14 17:12:17 -03 (~6 dias) |
| Versão | `3.0.3-13+b2` (Debian Bookworm padrão) |
| Memória | 1.4 MB |
| Arquivo config | `/etc/vsftpd.conf` |
| Systemd unit | `/lib/systemd/system/vsftpd.service` |

### Configuração ativa (`/etc/vsftpd.conf`, linhas não-comentadas)

```ini
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
rsa_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem
rsa_private_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
ssl_enable=NO
listen_port=2121
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40500
allow_writeable_chroot=YES
user_sub_token=$USER
local_root=/var/backups/netagent
```

**Pontos importantes:**
- **FTP em plaintext** (`ssl_enable=NO`) — credenciais e arquivos transmitidos sem criptografia. Aceitável porque clientes são MikroTiks numa rede interna, mas a porta 2121 está **aberta publicamente na UFW** (ver seção UFW), o que viabiliza MITM/sniffing.
- Port binding: `0.0.0.0:2121` (confirmado em `ss -tlnp`).
- Chroot por usuário ativado (`chroot_local_user=YES` + `allow_writeable_chroot=YES` — combinação que tem warning de segurança no manpage, mas funcional).
- `local_root=/var/backups/netagent` com `user_sub_token=$USER` — cada usuário é jailed em `/var/backups/netagent/<username>/`.
- Passive mode ports 40000–40500 (500 conexões simultâneas máx).

### Propósito

Receber arquivos de backup `.rsc` / `.backup` dos MikroTiks via FTP PUT agendado dentro do RouterOS de cada cliente (o comando `/system backup save` + `/tool fetch mode=ftp upload=yes` no próprio script do MikroTik).

### Onde chegam os backups

Diretório base: `/var/backups/netagent/` — owner `backup_user:backup_user`, `drwxr-xr-x`.

Estrutura observada em 2026-04-21:
```
/var/backups/netagent/
├── .bash_logout  (backup_user)
├── .bashrc       (backup_user)
├── .ftp_settings.json  (root, 66 bytes, 2026-03-02)
├── .profile      (backup_user)
└── 950fae8c-7d75-4157-885b-2a4a1b78cdff/   (subpasta por device UUID)
```

O UUID de subpasta corresponde a um `device_id` da tabela `devices` (ver DATABASE.md) — cada device tem sua própria pasta dentro do chroot do `backup_user`. Os arquivos `.rsc` chegam via FTP e são catalogados pela API (endpoints `/backups/*`, ver API-ENDPOINTS.md).

## UFW (firewall do host)

Estado: `active`. Default: `deny (incoming), allow (outgoing), deny (routed)`.

### Regras IPv4

| # | Regra | Justificativa | Avaliação |
|---|---|---|---|
| 1 | `22/tcp ALLOW Anywhere` | SSH admin | OK |
| 2 | `80/tcp ALLOW Anywhere # HTTP (Traefik)` | Redirect HTTP→HTTPS + ACME challenge | OK |
| 3 | `443/tcp ALLOW Anywhere # HTTPS (Traefik)` | HTTPS público | OK |
| 4 | `4000/tcp ALLOW Anywhere` | (sem comentário) | **BUG** — API Node deveria estar apenas em localhost; ver [AUDIT-BUG-002](AUDIT-2026-04-21.md#audit-bug-002) |
| 5 | `6379/tcp ALLOW Anywhere` | (sem comentário) | **BUG** — Redis bind é `127.0.0.1:6379`; regra inútil e enganosa; ver [AUDIT-BUG-007](AUDIT-2026-04-21.md#audit-bug-007) |
| 6 | `8000/tcp ALLOW Anywhere # NetAgent Python agent` | (anotado pelo operador) | **BUG** — Agent deveria estar só em localhost; ver [AUDIT-BUG-003](AUDIT-2026-04-21.md#audit-bug-003) |
| 7 | `2121/tcp ALLOW Anywhere` | FTP MikroTik | OK (ver caveat plaintext acima) |
| 8 | `40000:40500/tcp ALLOW Anywhere` | FTP passive mode | OK |
| 9 | `51820/tcp ALLOW Anywhere` | WireGuard (TCP desnecessário — protocolo é UDP) | Cosmético — remover |
| 10 | `51820/udp ALLOW Anywhere` | WireGuard | OK |
| 11 | `Anywhere on wg0 ALLOW Anywhere` | Tráfego interno WG | OK |
| 12 | `51820:51870/udp ALLOW Anywhere` | Range extra WG | OK |

### Regras IPv6 (13–25)

Espelho das IPv4, com uma **duplicação**: `2121 (v6)` + `2121/tcp (v6)` — ver [AUDIT-BUG-018](AUDIT-2026-04-21.md#audit-bug-018).

### Discrepâncias entre scripts e realidade

- `server-setup.sh:108–118` libera apenas SSH+80+443. 
- `installer/scripts/install.sh:91–105` libera SSH+80+443+2121+40000:40500+51820/udp.
- **Servidor real** tem tudo isso + 4000, 6379, 8000, 51820/tcp, 51820:51870/udp → essas regras foram adicionadas manualmente em algum momento, sem registro nos scripts.

## Logs

| Componente | Caminho | Rotação |
|---|---|---|
| PM2 `netagent-api` combinado | `/var/www/agente_forum_telecom/logs/api.log` | Nenhuma configurada (logrotate não configurado) |
| PM2 `netagent-api` stdout | `/root/.pm2/logs/netagent-api-out.log` | PM2 default (sem truncamento) |
| PM2 `netagent-api` stderr | `/root/.pm2/logs/netagent-api-error.log` | PM2 default |
| PM2 `netagent-agent` combinado | `/var/www/agente_forum_telecom/logs/agent.log` | Nenhuma |
| PM2 `netagent-agent` stdout | `/root/.pm2/logs/netagent-agent-out.log` | PM2 default |
| PM2 `netagent-agent` stderr | `/root/.pm2/logs/netagent-agent-error.log` | PM2 default |
| Docker `traefik` | `docker logs traefik` | json-file driver default |
| Docker `netagent-postgres` | `docker logs netagent-postgres` | json-file |
| Docker `netagent-redis` | `docker logs netagent-redis` | json-file |
| Docker `netagent-frontend` (nginx) | `docker logs netagent-frontend` | json-file |
| Docker `evolution-api` | `docker logs evolution-api` | json-file |
| Docker `mcp-mikrotik` / `mcp-linux` | `docker logs …` | json-file |
| vsftpd | `/var/log/vsftpd.log` (via `xferlog_enable=YES`) | Via `logrotate` de pacote vsftpd |
| Deploy frontend | `/var/www/agente_forum_telecom/logs/frontend.log` | Nenhuma |

**Ponto de atenção:** o plugin `pm2-logrotate` NÃO está instalado (`pm2 list` não mostra). Com Agent rodando há 6 dias e API há 39h, os arquivos `.pm2/logs/*.log` crescem indefinidamente. Risco de encher `/` a longo prazo.

## Health checks operacionais

| Endpoint | Porta | Esperado | Estado observado |
|---|---|---|---|
| `http://localhost:4000/health` | 4000 (host, PM2) | `200 {"status":"ok"}` | OK |
| `http://localhost:8000/` | 8000 (host, PM2) | `200 {"status":"ok","service":"netagent-agent"}` | OK — Agent usa `/` em vez de `/health`; ver [AUDIT-BUG-017](AUDIT-2026-04-21.md#audit-bug-017) |
| `http://localhost:8000/health` | 8000 | Deveria ser 200 | **404 Not Found** — rota não existe |
| `http://localhost:8001/health` | 8001 (mcp-mikrotik) | `200 {"status":"ok","driver":"mcp-mikrotik"}` | OK |
| `http://localhost:8002/health` | 8002 (mcp-linux) | `200 {"status":"ok","driver":"mcp-linux"}` | OK |
| `https://agente.forumtelecom.com.br/api/health` | 443 (Traefik) | 200 JSON | OK (via proxy) |
| `https://agente.forumtelecom.com.br/agent/` | 443 (Traefik) | 200 JSON | OK |

### Health checks do próprio compose

- Traefik: `docker inspect traefik --format '{{.State.Health.Status}}'` não retorna (sem healthcheck definido no compose).
- Postgres: `docker exec netagent-postgres pg_isready -U netagent` — `server-setup.sh:393` usa esse check no verify, mas não está declarado como `healthcheck:` no compose final.
- Redis: idem — `redis-cli -a ${REDIS_PASSWORD} ping` só é usado no verify do server-setup.sh.

Nenhum container tem `restart: unless-stopped` **com healthcheck** — se um serviço virar zumbi (processo vivo, mas não responde), Docker não reinicia.

## Procedimento de rollback

**Não há procedimento automatizado.** O `deploy.sh` não faz snapshot nem tag.

Rollback manual:
1. `cd /var/www/agente_forum_telecom && git log --oneline` — identificar commit anterior estável.
2. `git checkout <SHA>` (cuidado com migrations irreversíveis).
3. `./deploy.sh` — vai rebuildar tudo com o código do SHA anterior.
4. Se houve migração de schema destrutiva: restaurar dump Postgres (não existe backup automático configurado — o vsftpd é só para MikroTik; ver DATABASE.md).
5. `pm2 restart netagent-api netagent-agent`.

**Riscos do rollback atual:**
- `deploy.sh` reaplica `api/src/db/init.sql` — se o init.sql mais recente tiver mudanças incompatíveis, voltar um commit não desfaz o schema aplicado.
- Rollback do frontend: `deploy-frontend.sh` não versiona `dist/` — só o build atual fica em disco.
- Não há backup automatizado do `.env` (contém segredos gerados uma única vez).

## Pontos de atenção

- [AUDIT-BUG-001 — cron daemon ausente](AUDIT-2026-04-21.md#audit-bug-001) **crítico**
- [AUDIT-BUG-002 — API 4000 aberta via UFW](AUDIT-2026-04-21.md#audit-bug-002) **crítico**
- [AUDIT-BUG-003 — Agent 8000 aberta via UFW](AUDIT-2026-04-21.md#audit-bug-003) **crítico**
- [AUDIT-BUG-005 — ACME renewal em risco](AUDIT-2026-04-21.md#audit-bug-005)
- [AUDIT-BUG-007 — UFW 6379 inconsistente](AUDIT-2026-04-21.md#audit-bug-007)
- [AUDIT-BUG-017 — Agent sem `/health`](AUDIT-2026-04-21.md#audit-bug-017)
- [AUDIT-BUG-018 — UFW duplicada 2121 ipv6](AUDIT-2026-04-21.md#audit-bug-018)
- [AUDIT-BUG-021 — express-rate-limit não aplicado](AUDIT-2026-04-21.md#audit-bug-021)

### Pontos operacionais adicionais (sem bug formal ainda)

- **Sem log rotation no PM2** (acúmulo em `~/.pm2/logs/` e `logs/`). Instalar `pm2-logrotate`: `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 14`.
- **Sem ecosystem file do PM2** — flags/env embutidos no shell script de deploy. Sugestão: criar `ecosystem.config.js` no root do repo versionado.
- **Processos PM2 rodam como `root`** — eleva impacto de um RCE. Criar usuário `netagent` dedicado.
- **Três scripts de setup divergentes** — consolidar em um único com flags (`--with-vsftpd`, `--with-wireguard`, `--project-dir=...`).
- **`deploy.sh` não faz backup do DB antes de reaplicar `init.sql`.** Se `init.sql` tiver `DROP TABLE IF EXISTS` em dev, deploy perde dados. Adicionar `pg_dump` antes.
- **FTP em plaintext exposto publicamente na 2121.** Mínimo: restringir UFW a faixas de IP dos MikroTiks dos clientes, OU habilitar `ssl_enable=YES` com cert real (não o snakeoil atual) e forçar FTPS explícito.
