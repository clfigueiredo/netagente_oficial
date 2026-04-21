#!/usr/bin/env bash
# =============================================================================
# NetAgent Platform — Instalador SEM Evolution API (fresh server)
# Alvo: Debian 12 (Bookworm) · Raiz do projeto: repositório onde este script vive
#
# Orquestra (subset do compose — Evolution API omitida):
#   Docker: Traefik 3, Postgres 16 + pgvector, Redis 7,
#           MCP MikroTik, MCP Linux, WireGuard concentrator, nginx (frontend)
#   Host  : API Node 20 (PM2) + Agent Python 3.11 (PM2)
#   DB    : schema público + função create_tenant_schema() + seeds (plans+skills)
#
# Chaves: Postgres/Redis/JWT/Encryption/InternalAPI são geradas.
# Somente OPENAI_KEY é solicitada ao operador. NÃO há EVOLUTION_GLOBAL_KEY.
# Obs: WhatsApp/Evolution fica inoperante — fluxos de WhatsApp do Agent falham.
# =============================================================================
set -Eeuo pipefail

# ── Cores ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✔]${NC} $*"; }
info()  { echo -e "${BLUE}[→]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✘]${NC} $*" >&2; exit 1; }
sep()   { echo -e "${CYAN}──────────────────────────────────────────────${NC}"; }
step()  { sep; echo -e "${BOLD}${CYAN}▶ $*${NC}"; sep; }

trap 'error "Falha na linha $LINENO (comando: ${BASH_COMMAND})"' ERR

# ── Configuração ─────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="20"
PYTHON_BIN="python3.11"

# Defaults (operador pode sobrescrever no prompt)
DEFAULT_DOMAIN_PLATFORM="agente.forumtelecom.com.br"
DEFAULT_EMAIL_SSL="admin@forumtelecom.com.br"
DEFAULT_ADMIN_EMAIL="admin@forumtelecom.com.br"

# Hard-coded originals no docker-compose.yml (usados pelos seds)
ORIG_DOMAIN_PLATFORM="agente.forumtelecom.com.br"
ORIG_EMAIL_SSL="admin@forumtelecom.com.br"

# Serviços do compose que vamos subir (tudo EXCETO evolution)
COMPOSE_SERVICES=(traefik frontend postgres redis mcp-mikrotik mcp-linux wireguard)

gen_secret() { openssl rand -hex 32; }

sanitize_domain() {
  local d="$1"
  d="${d#http://}"; d="${d#https://}"
  d="${d%/}"
  d="$(echo -n "$d" | tr -d '[:space:]')"
  if [[ ! "$d" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]]; then
    echo "__INVALID__"
    return
  fi
  printf '%s' "$d"
}

read_domain() {
  local prompt="$1" default="$2" val sanitized
  while true; do
    read -rp "${prompt} [${default}]: " val
    val="${val:-$default}"
    sanitized=$(sanitize_domain "$val")
    if [[ "${sanitized}" == "__INVALID__" ]]; then
      warn "Domínio inválido: '${val}'. Exemplo: agente.meucliente.com.br"
      continue
    fi
    printf '%s' "${sanitized}"
    return
  done
}

# ── 0. Pré-checks ────────────────────────────────────────────────────────────
require_root() {
  [[ $EUID -eq 0 ]] || error "Execute como root: sudo bash install.sh"
}

check_debian() {
  [[ -f /etc/os-release ]] || error "OS não suportado (sem /etc/os-release)."
  . /etc/os-release
  if [[ "$ID" != "debian" || "${VERSION_ID%%.*}" != "12" ]]; then
    warn "Este script é testado em Debian 12 (detectado: $PRETTY_NAME). Continuando mesmo assim."
  else
    log "Debian 12 detectado."
  fi
}

check_repo_layout() {
  local required=(
    "docker-compose.yml"
    "api/package.json"
    "api/src/db/init.sql"
    "agent/requirements.txt"
    "agent/main.py"
    "frontend/package.json"
    "mcp-mikrotik/Dockerfile"
    "mcp-linux/Dockerfile"
    "docker/wireguard/Dockerfile"
    "traefik/nginx-frontend.conf"
  )
  local f
  for f in "${required[@]}"; do
    [[ -e "${PROJECT_DIR}/${f}" ]] || error "Arquivo obrigatório ausente: ${f}. Execute este script a partir da raiz do repositório clonado."
  done
  log "Layout do repositório OK em ${PROJECT_DIR}"
}

prompt_config() {
  step "Configuração (sem Evolution API)"
  DOMAIN_PLATFORM=$(read_domain "Domínio da Plataforma" "${DEFAULT_DOMAIN_PLATFORM}")

  read -rp "E-mail para Let's Encrypt [${DEFAULT_EMAIL_SSL}]: " EMAIL_SSL
  EMAIL_SSL="$(echo -n "${EMAIL_SSL:-$DEFAULT_EMAIL_SSL}" | tr -d '[:space:]')"

  read -rp "E-mail do superadmin inicial [${DEFAULT_ADMIN_EMAIL}]: " ADMIN_EMAIL
  ADMIN_EMAIL="$(echo -n "${ADMIN_EMAIL:-$DEFAULT_ADMIN_EMAIL}" | tr -d '[:space:]')"

  local default_slug
  default_slug=$(echo -n "${DOMAIN_PLATFORM%%.*}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')
  [[ -z "$default_slug" ]] && default_slug="main"
  while true; do
    read -rp "Nome do tenant inicial (só letras/números/underscore) [${default_slug}]: " TENANT_SLUG
    TENANT_SLUG="${TENANT_SLUG:-$default_slug}"
    TENANT_SLUG=$(echo -n "$TENANT_SLUG" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')
    if [[ -z "$TENANT_SLUG" ]]; then
      warn "Slug vazio."
    elif [[ ! "$TENANT_SLUG" =~ ^[a-z] ]]; then
      warn "Slug precisa começar com letra: ${TENANT_SLUG}"
    else
      break
    fi
  done
  read -rp "Nome amigável do tenant (ex.: 'Forum Telecom') [${TENANT_SLUG}]: " TENANT_NAME
  TENANT_NAME="${TENANT_NAME:-$TENANT_SLUG}"

  while true; do
    read -rsp "Chave OpenAI (sk-...): " OPENAI_KEY
    echo
    if [[ "${OPENAI_KEY}" =~ ^sk- ]]; then break; fi
    warn "Formato inválido. Deve iniciar com 'sk-'."
  done

  echo
  warn "Resumo:"
  echo "  Projeto       : ${PROJECT_DIR}"
  echo "  Plataforma    : https://${DOMAIN_PLATFORM}"
  echo "  Evolution API : (DESATIVADA nesta instalação)"
  echo "  E-mail SSL    : ${EMAIL_SSL}"
  echo "  Superadmin    : ${ADMIN_EMAIL}"
  echo "  Tenant        : ${TENANT_NAME} (slug=${TENANT_SLUG})"
  echo "  OpenAI        : sk-****$(echo -n "${OPENAI_KEY}" | tail -c 4)"
  echo
  read -rp "Confirmar e iniciar? [s/N] " confirm
  [[ "${confirm,,}" == "s" ]] || { echo "Cancelado."; exit 0; }
}

# ── 1. Pacotes do sistema ────────────────────────────────────────────────────
setup_system() {
  step "Pacotes do sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    curl wget git unzip jq htop \
    ca-certificates gnupg lsb-release openssl \
    ufw fail2ban cron \
    build-essential \
    postgresql-client-15 \
    software-properties-common apt-transport-https
  systemctl enable --now cron >/dev/null 2>&1 || true
  log "Pacotes base instalados (inclui cron + fail2ban)."
}

# ── 2. Docker CE ─────────────────────────────────────────────────────────────
install_docker() {
  step "Docker CE + Compose plugin"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker já instalado: $(docker --version)"
    return
  fi
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  log "Docker instalado: $(docker --version)"
}

# ── 3. Node.js 20 + PM2 ─────────────────────────────────────────────────────
install_nodejs() {
  step "Node.js ${NODE_VERSION} + PM2"
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_VERSION}* ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y -qq nodejs
  fi
  npm install -g --silent pm2 >/dev/null
  # pm2-logrotate evita que /root/.pm2/logs encha o disco
  pm2 install pm2-logrotate >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:retain 14 >/dev/null 2>&1 || true
  pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true
  log "Node $(node -v) · npm $(npm -v) · PM2 $(pm2 -v)"
}

# ── 4. Python 3.11 ──────────────────────────────────────────────────────────
install_python() {
  step "Python 3.11 + venv"
  apt-get install -y -qq python3.11 python3.11-venv python3.11-dev python3-pip
  log "Python $(${PYTHON_BIN} --version | awk '{print $2}') instalado."
}

# ── 5. Firewall ─────────────────────────────────────────────────────────────
setup_firewall() {
  step "UFW (apenas SSH/HTTP/HTTPS/WireGuard + docker bridge)"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow ssh >/dev/null
  ufw allow 80/tcp  comment 'HTTP (Traefik)'  >/dev/null
  ufw allow 443/tcp comment 'HTTPS (Traefik)' >/dev/null
  ufw allow 51820/udp comment 'WireGuard'     >/dev/null
  # Sem essas duas regras a UFW bloqueia tráfego da bridge docker0 → host,
  # e o nginx-frontend retorna 504 ao proxy-passar /api e /socket.io.
  ufw allow in on docker0 to any         comment 'docker bridge -> host' >/dev/null
  ufw allow from 172.16.0.0/12           comment 'docker networks'       >/dev/null
  ufw --force enable >/dev/null
  log "UFW ativo. API(4000)/Agent(8000)/Redis(6379) em loopback; docker0 liberado."
}

# ── 6. Diretórios de dados + acme.json ───────────────────────────────────────
setup_dirs() {
  step "Estrutura de diretórios"
  mkdir -p \
    "${PROJECT_DIR}/data/postgres" \
    "${PROJECT_DIR}/data/redis" \
    "${PROJECT_DIR}/data/evolution" \
    "${PROJECT_DIR}/data/wireguard" \
    "${PROJECT_DIR}/traefik/certs" \
    "${PROJECT_DIR}/traefik/config" \
    "${PROJECT_DIR}/logs"
  touch "${PROJECT_DIR}/traefik/certs/acme.json"
  chmod 600 "${PROJECT_DIR}/traefik/certs/acme.json"
  # Remove file-provider legado (host-services.yml) — Traefik só precisa das
  # labels do compose; o routing /api é feito pelo nginx-frontend.conf.
  rm -f "${PROJECT_DIR}/traefik/config/host-services.yml"
  log "Diretórios prontos."
}

# ── 7. .env (com chaves novas, OpenAI fornecido) ─────────────────────────────
generate_env() {
  step ".env e segredos (sem Evolution)"

  POSTGRES_PASSWORD=$(gen_secret)
  REDIS_PASSWORD=$(gen_secret)
  JWT_SECRET=$(gen_secret)
  ENCRYPTION_KEY=$(gen_secret)
  INTERNAL_API_SECRET=$(gen_secret)
  # Gera placeholder p/ EVOLUTION_GLOBAL_KEY (variável é referenciada no compose
  # via ${EVOLUTION_GLOBAL_KEY}; mesmo com o serviço desativado, preserva o
  # parse do YAML e deixa a plataforma pronta p/ reativar o Evolution depois).
  EVOLUTION_GLOBAL_KEY=$(gen_secret)

  cat > "${PROJECT_DIR}/.env" <<EOF
# === Banco
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://netagent:${POSTGRES_PASSWORD}@localhost:5432/netagent

# === Redis
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379

# === Segurança
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}

# === OpenAI (fornecido pelo operador)
OPENAI_KEY=${OPENAI_KEY}

# === Evolution API (serviço DESATIVADO — placeholder para reativação futura)
EVOLUTION_GLOBAL_KEY=${EVOLUTION_GLOBAL_KEY}
EVOLUTION_BASE_URL=

# === URLs públicas
PUBLIC_URL=https://${DOMAIN_PLATFORM}
VITE_API_URL=https://${DOMAIN_PLATFORM}/api
VITE_WS_URL=https://${DOMAIN_PLATFORM}

# === App
NODE_ENV=production
PORT=4000
AGENT_PORT=8000
LOG_LEVEL=info
EOF
  chmod 600 "${PROJECT_DIR}/.env"

  # API e Agent esperam o .env em suas respectivas pastas
  cp "${PROJECT_DIR}/.env" "${PROJECT_DIR}/api/.env"
  cp "${PROJECT_DIR}/.env" "${PROJECT_DIR}/agent/.env"
  chmod 600 "${PROJECT_DIR}/api/.env" "${PROJECT_DIR}/agent/.env"
  log ".env gerado (Evolution desativada, EVOLUTION_BASE_URL vazio)."
}

# ── 8. Substituir domínio da plataforma + GID docker no compose ─────────────
patch_compose() {
  step "Patch docker-compose.yml (domínio + GID docker)"
  local compose="${PROJECT_DIR}/docker-compose.yml"
  # 8a) Domínio da plataforma e e-mail ACME (domínio Evolution fica como estava
  # — o serviço não será iniciado)
  sed -i \
    -e "s|${ORIG_DOMAIN_PLATFORM}|${DOMAIN_PLATFORM}|g" \
    -e "s|${ORIG_EMAIL_SSL}|${EMAIL_SSL}|g" \
    "${compose}"

  # 8b) GID do grupo docker (Traefik precisa para ler /run/docker.sock)
  local docker_gid
  docker_gid=$(getent group docker | cut -d: -f3)
  [[ -n "${docker_gid}" ]] || error "Grupo 'docker' não encontrado após instalar Docker."
  python3 - "$compose" "$docker_gid" <<'PY'
import sys, re
path, gid = sys.argv[1], sys.argv[2]
src = open(path).read()
def repl(m):
    return m.group(1) + f'- "{gid}"'
src = re.sub(r'(group_add:\s*\n\s*)-\s*"\d+"', repl, src)
open(path, "w").write(src)
PY
  log "docker-compose.yml patcheado (domínio + docker GID=${docker_gid})."
}

# ── 9. Build do frontend ANTES de subir o nginx ─────────────────────────────
build_frontend() {
  step "Build do Frontend (Vite)"
  pushd "${PROJECT_DIR}/frontend" >/dev/null
  npm install --silent --no-audit --no-fund
  VITE_API_URL="https://${DOMAIN_PLATFORM}/api" \
  VITE_WS_URL="https://${DOMAIN_PLATFORM}" \
    npm run build
  popd >/dev/null
  [[ -f "${PROJECT_DIR}/frontend/dist/index.html" ]] \
    || error "Frontend build falhou: dist/index.html ausente."
  log "Frontend buildado em frontend/dist/"
}

# ── 10. Dependências da API Node ────────────────────────────────────────────
install_api_deps() {
  step "Dependências da API (Node)"
  pushd "${PROJECT_DIR}/api" >/dev/null
  npm install --omit=dev --silent --no-audit --no-fund
  # prisma generate é opcional — só roda se o schema existir
  if [[ -f "prisma/schema.prisma" ]]; then
    npx --yes prisma generate >/dev/null 2>&1 || warn "prisma generate falhou (seguindo)."
  fi
  popd >/dev/null
  log "API: npm install OK."
}

# ── 11. Dependências do Agent Python ────────────────────────────────────────
install_agent_deps() {
  step "Dependências do Agent (Python)"
  pushd "${PROJECT_DIR}/agent" >/dev/null
  if [[ ! -d venv ]]; then
    ${PYTHON_BIN} -m venv venv
  fi
  ./venv/bin/pip install --upgrade --quiet pip wheel
  ./venv/bin/pip install --quiet -r requirements.txt
  popd >/dev/null
  log "Agent: venv + requirements OK."
}

# ── 12. docker compose up -d --build (sem evolution) ────────────────────────
start_containers() {
  step "docker compose up -d --build (sem evolution)"
  pushd "${PROJECT_DIR}" >/dev/null
  set -a; # shellcheck disable=SC1091
  source .env
  set +a
  # Sobe somente os serviços listados em COMPOSE_SERVICES (evolution omitido).
  # --remove-orphans derruba qualquer container evolution que porventura esteja
  # rodando de uma instalação anterior.
  docker compose up -d --build --remove-orphans "${COMPOSE_SERVICES[@]}"
  popd >/dev/null
  log "Containers subindo (Evolution NÃO incluído)."
}

wait_postgres() {
  step "Aguardando Postgres"
  local i
  for i in {1..40}; do
    if docker exec netagent-postgres pg_isready -U netagent -q 2>/dev/null; then
      log "Postgres pronto."
      return 0
    fi
    sleep 2
  done
  error "Postgres não respondeu em 80s."
}

# ── 13. Banco: aplica schema netagent (DB evolution NÃO é criado) ───────────
init_databases() {
  step "Inicializando banco netagent"
  # Schema principal (idempotente — usa IF NOT EXISTS em tudo)
  docker exec -i netagent-postgres psql -U netagent -d netagent \
    < "${PROJECT_DIR}/api/src/db/init.sql" >/dev/null
  log "init.sql aplicado (schema público + plans + skills + create_tenant_schema)."

  # Migrations incrementais (silenciosas se já aplicadas)
  if [[ -f "${PROJECT_DIR}/api/scripts/add_mcp_drivers.sql" ]]; then
    docker exec -i netagent-postgres psql -U netagent -d netagent \
      < "${PROJECT_DIR}/api/scripts/add_mcp_drivers.sql" >/dev/null 2>&1 || true
  fi
  if [[ -f "${PROJECT_DIR}/api/scripts/migrations/create_automations.sql" ]]; then
    docker exec -i netagent-postgres psql -U netagent -d netagent \
      < "${PROJECT_DIR}/api/scripts/migrations/create_automations.sql" >/dev/null 2>&1 || true
  fi
  log "Migrations adicionais aplicadas."
}

# ── 14.5. Tenant inicial (necessário p/ o chat funcionar) ───────────────────
create_default_tenant() {
  step "Tenant inicial: ${TENANT_NAME} (${TENANT_SLUG})"
  local count
  count=$(docker exec netagent-postgres psql -U netagent -d netagent -tAc \
          "SELECT count(*) FROM public.tenants" 2>/dev/null || echo "0")
  if [[ "${count}" != "0" ]]; then
    log "Já existem tenants (${count}). Mantendo."
    return
  fi
  if [[ -z "${SUPERADMIN_PASSWORD:-}" ]]; then
    warn "Superadmin preexistente — pulando tenant inicial."
    return
  fi

  local plan_id hash
  plan_id=$(docker exec netagent-postgres psql -U netagent -d netagent -tAc \
            "SELECT id FROM public.plans WHERE name='Starter' LIMIT 1")
  [[ -n "${plan_id}" ]] || { warn "plano Starter ausente — pulando tenant."; return; }

  hash=$(cd "${PROJECT_DIR}/api" && node -e "
    require('bcrypt').hash(process.argv[1],12).then(h=>process.stdout.write(h));
  " "${SUPERADMIN_PASSWORD}")

  docker exec -i \
    -e PSQL_T_NAME="${TENANT_NAME}" \
    -e PSQL_A_EMAIL="${ADMIN_EMAIL}" \
    -e PSQL_A_HASH="${hash}" \
    -e PSQL_P_ID="${plan_id}" \
    netagent-postgres psql -U netagent -d netagent -v ON_ERROR_STOP=1 >/dev/null <<SQL
\set t_name \`printf "%s" "\$PSQL_T_NAME"\`
\set a_email \`printf "%s" "\$PSQL_A_EMAIL"\`
\set a_hash \`printf "%s" "\$PSQL_A_HASH"\`
\set p_id \`printf "%s" "\$PSQL_P_ID"\`

INSERT INTO public.tenants (name, slug, admin_email, plan_id, active)
VALUES (:'t_name', '${TENANT_SLUG}', :'a_email', :'p_id', true)
ON CONFLICT (slug) DO NOTHING;

SELECT public.create_tenant_schema('${TENANT_SLUG}');

INSERT INTO "${TENANT_SLUG}".users (email, password_hash, name, role)
SELECT :'a_email', :'a_hash', 'Admin', 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM "${TENANT_SLUG}".users WHERE email = :'a_email'
);
SQL
  DEFAULT_TENANT_CREATED=1
  log "Tenant '${TENANT_SLUG}' criado (admin=${ADMIN_EMAIL}, mesma senha do superadmin)."
}

# ── 14. Superadmin (apenas na primeira execução) ────────────────────────────
create_superadmin() {
  step "Superadmin"
  local count
  count=$(docker exec netagent-postgres psql -U netagent -d netagent -tAc \
          "SELECT count(*) FROM public.platform_users" 2>/dev/null || echo "0")
  if [[ "${count}" != "0" ]]; then
    log "platform_users já populada (${count} registros). Mantendo."
    SUPERADMIN_PASSWORD=""
    return
  fi

  SUPERADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '=/+' | head -c 16)
  local hash
  hash=$(cd "${PROJECT_DIR}/api" && node -e "
    const b=require('bcrypt');
    b.hash(process.argv[1],12).then(h=>process.stdout.write(h));
  " "${SUPERADMIN_PASSWORD}")

  docker exec -i netagent-postgres psql -U netagent -d netagent -c \
    "INSERT INTO public.platform_users (email, password_hash, role)
     VALUES ('${ADMIN_EMAIL}', '${hash}', 'superadmin');" >/dev/null
  log "Superadmin criado."
}

# ── 15. PM2: API Node + Agent Python ────────────────────────────────────────
start_pm2() {
  step "PM2"
  pm2 delete netagent-api   >/dev/null 2>&1 || true
  pm2 delete netagent-agent >/dev/null 2>&1 || true

  pm2 start "${PROJECT_DIR}/api/src/index.js" \
    --name netagent-api \
    --cwd "${PROJECT_DIR}/api" \
    --log "${PROJECT_DIR}/logs/api.log" \
    --time >/dev/null

  pm2 start "${PROJECT_DIR}/agent/venv/bin/uvicorn" \
    --name netagent-agent \
    --interpreter none \
    --cwd "${PROJECT_DIR}/agent" \
    --log "${PROJECT_DIR}/logs/agent.log" \
    --time \
    -- main:app --host 127.0.0.1 --port 8000 >/dev/null

  pm2 save >/dev/null

  # Autostart no boot (se ainda não configurado)
  if ! systemctl list-unit-files 2>/dev/null | grep -q '^pm2-root'; then
    pm2 startup systemd -u root --hp /root >/dev/null || true
    pm2 save >/dev/null
  fi
  log "PM2 online (netagent-api + netagent-agent)."
}

# ── 16. Verificação final ────────────────────────────────────────────────────
verify() {
  step "Health checks"
  local fail=0
  docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps

  if docker exec netagent-postgres pg_isready -U netagent -q 2>/dev/null; then
    log "Postgres: OK"
  else warn "Postgres: FAIL"; fail=1; fi

  if docker exec netagent-redis redis-cli -a "${REDIS_PASSWORD}" PING 2>/dev/null | grep -q PONG; then
    log "Redis: OK"
  else warn "Redis: FAIL"; fail=1; fi

  local i
  for i in {1..15}; do
    if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
      log "API (:4000/health): OK"; break
    fi
    [[ $i -eq 15 ]] && { warn "API não respondeu em :4000"; fail=1; }
    sleep 2
  done

  for i in {1..15}; do
    if curl -fsS http://127.0.0.1:8000/ >/dev/null 2>&1; then
      log "Agent (:8000): OK"; break
    fi
    [[ $i -eq 15 ]] && { warn "Agent não respondeu em :8000"; fail=1; }
    sleep 2
  done

  if curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1; then
    log "MCP MikroTik (:8001): OK"
  else
    warn "MCP MikroTik: aguardando build"; fail=1
  fi
  if curl -fsS http://127.0.0.1:8002/health >/dev/null 2>&1; then
    log "MCP Linux (:8002): OK"
  else
    warn "MCP Linux: aguardando build"; fail=1
  fi

  return $fail
}

print_summary() {
  sep
  echo -e "${BOLD}${GREEN}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║   ✅  NetAgent Platform instalado (sem Evolution API)        ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "${BOLD}Endpoints públicos:${NC}"
  echo "  Plataforma : https://${DOMAIN_PLATFORM}"
  echo "  API        : https://${DOMAIN_PLATFORM}/api/health"
  echo "  Agent      : https://${DOMAIN_PLATFORM}/agent/"
  echo "  Evolution  : (desativada nesta instalação)"
  echo
  echo -e "${BOLD}${CYAN}Webhook da Evolution API (quando reativar ou em servidor separado):${NC}"
  echo "  URL    : https://${DOMAIN_PLATFORM}/webhook"
  echo "  Eventos: MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED"
  echo
  echo -e "${BOLD}Chaves importantes (${PROJECT_DIR}/.env):${NC}"
  echo "  OPENAI_KEY : sk-****$(grep ^OPENAI_KEY "${PROJECT_DIR}/.env" | cut -d= -f2 | tail -c 5)"
  echo
  if [[ -n "${SUPERADMIN_PASSWORD:-}" ]]; then
    echo -e "${BOLD}${YELLOW}Credenciais iniciais (anote agora — não serão reexibidas):${NC}"
    echo "  Email : ${ADMIN_EMAIL}"
    echo "  Senha : ${SUPERADMIN_PASSWORD}"
    if [[ -n "${DEFAULT_TENANT_CREATED:-}" ]]; then
      echo "  Tenant: ${TENANT_NAME} (slug=${TENANT_SLUG}) — mesma senha do superadmin"
    fi
    echo
  fi
  echo -e "${BOLD}Operação:${NC}"
  echo "  pm2 list                  # estado dos processos host"
  echo "  pm2 logs netagent-api     # logs da API"
  echo "  pm2 logs netagent-agent   # logs do Agent"
  echo "  docker compose ps         # estado dos containers"
  echo "  docker compose logs -f traefik"
  echo
  echo -e "${BOLD}Reativar Evolution futuramente:${NC}"
  echo "  1. Aponte DNS de um subdomínio (ex.: agenteevo.seudominio.com) para este IP"
  echo "  2. Edite EVOLUTION_BASE_URL em .env"
  echo "  3. Crie o DB: docker exec -i netagent-postgres psql -U netagent -d netagent -c 'CREATE DATABASE evolution OWNER netagent'"
  echo "  4. Atualize o Host() do traefik nas labels do container evolution no docker-compose.yml"
  echo "  5. docker compose up -d evolution"
  sep
  warn "Aponte DNS A/AAAA de ${DOMAIN_PLATFORM} para este servidor."
  warn "O certificado Let's Encrypt é emitido na primeira requisição HTTPS válida."
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  NetAgent Platform — Instalador Completo           ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

  require_root
  check_debian
  check_repo_layout
  prompt_config

  setup_system
  install_docker
  install_nodejs
  install_python
  setup_firewall
  setup_dirs
  generate_env
  patch_compose
  build_frontend
  install_api_deps
  install_agent_deps
  start_containers
  wait_postgres
  init_databases
  create_superadmin
  create_default_tenant
  start_pm2
  verify || warn "Alguns checks falharam — inspecione logs acima."
  print_summary
}

main "$@"
