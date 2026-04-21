#!/usr/bin/env bash
# =============================================================================
# Evolution API — Instalador STANDALONE (servidor dedicado)
# Alvo: Debian 12 (Bookworm)
#
# Sobe somente Evolution API v2.3.4 + Postgres 16 + Traefik (SSL automático).
# Sem dependência da plataforma NetAgent — é um servidor autônomo.
#
# Requisitos:
#   - DNS A/AAAA do domínio informado DEVE apontar pra este servidor ANTES de rodar
#     (senão Let's Encrypt não emite certificado).
# =============================================================================
set -Eeuo pipefail

# ── Cores / helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✔]${NC} $*"; }
info()  { echo -e "${BLUE}[→]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✘]${NC} $*" >&2; exit 1; }
sep()   { echo -e "${CYAN}──────────────────────────────────────────────${NC}"; }
step()  { sep; echo -e "${BOLD}${CYAN}▶ $*${NC}"; sep; }

trap 'error "Falha na linha $LINENO (comando: ${BASH_COMMAND})"' ERR

# ── Configuração ────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/evolution-api"
EVOLUTION_VERSION="v2.3.4"
POSTGRES_IMAGE="postgres:16-alpine"
TRAEFIK_VERSION="v3.6.1"

gen_secret() { openssl rand -hex 32; }

# ── 0. Pré-checks ───────────────────────────────────────────────────────────
require_root() {
  [[ $EUID -eq 0 ]] || error "Execute como root: sudo bash install-evolution-only.sh"
}

check_debian() {
  [[ -f /etc/os-release ]] || error "OS não suportado."
  . /etc/os-release
  if [[ "$ID" != "debian" || "${VERSION_ID%%.*}" != "12" ]]; then
    warn "Script testado em Debian 12 (detectado: $PRETTY_NAME). Seguindo mesmo assim."
  else
    log "Debian 12 detectado."
  fi
}

prompt_config() {
  step "Configuração"
  while true; do
    read -rp "Domínio público da Evolution API (ex: evolution.meudominio.com.br): " DOMAIN_EVOLUTION
    [[ -n "${DOMAIN_EVOLUTION}" ]] && break
    warn "Domínio obrigatório."
  done

  read -rp "E-mail para Let's Encrypt [admin@${DOMAIN_EVOLUTION#*.}]: " EMAIL_SSL
  EMAIL_SSL="${EMAIL_SSL:-admin@${DOMAIN_EVOLUTION#*.}}"

  read -rp "Diretório do projeto [${PROJECT_DIR}]: " _pd
  PROJECT_DIR="${_pd:-$PROJECT_DIR}"

  echo
  warn "Resumo:"
  echo "  Projeto     : ${PROJECT_DIR}"
  echo "  Evolution   : https://${DOMAIN_EVOLUTION}"
  echo "  E-mail SSL  : ${EMAIL_SSL}"
  echo "  Imagem Evo  : evoapicloud/evolution-api:${EVOLUTION_VERSION}"
  echo "  Postgres    : ${POSTGRES_IMAGE}"
  echo "  Traefik     : traefik:${TRAEFIK_VERSION}"
  echo
  warn "Antes de continuar, confirme que o DNS de '${DOMAIN_EVOLUTION}' já aponta pro IP deste servidor."
  read -rp "Confirmar e iniciar? [s/N] " confirm
  [[ "${confirm,,}" == "s" ]] || { echo "Cancelado."; exit 0; }
}

# ── 1. Pacotes base ─────────────────────────────────────────────────────────
setup_system() {
  step "Pacotes do sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    curl wget git unzip jq \
    ca-certificates gnupg lsb-release openssl \
    ufw
  log "Pacotes base instalados."
}

# ── 2. Docker CE ────────────────────────────────────────────────────────────
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

# ── 3. Firewall ─────────────────────────────────────────────────────────────
setup_firewall() {
  step "UFW (SSH/HTTP/HTTPS)"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow ssh >/dev/null
  ufw allow 80/tcp  comment 'HTTP (Traefik)'  >/dev/null
  ufw allow 443/tcp comment 'HTTPS (Traefik)' >/dev/null
  ufw --force enable >/dev/null
  log "UFW ativo (22/80/443)."
}

# ── 4. Diretórios ───────────────────────────────────────────────────────────
setup_dirs() {
  step "Estrutura de diretórios em ${PROJECT_DIR}"
  mkdir -p \
    "${PROJECT_DIR}/data/postgres" \
    "${PROJECT_DIR}/data/evolution" \
    "${PROJECT_DIR}/traefik/certs"
  touch "${PROJECT_DIR}/traefik/certs/acme.json"
  chmod 600 "${PROJECT_DIR}/traefik/certs/acme.json"
  log "Diretórios prontos."
}

# ── 5. .env ─────────────────────────────────────────────────────────────────
generate_env() {
  step ".env e segredos"
  POSTGRES_PASSWORD=$(gen_secret)
  EVOLUTION_GLOBAL_KEY=$(gen_secret)

  cat > "${PROJECT_DIR}/.env" <<EOF
# === Postgres interno (dedicado à Evolution)
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# === Evolution API
EVOLUTION_GLOBAL_KEY=${EVOLUTION_GLOBAL_KEY}
DOMAIN_EVOLUTION=${DOMAIN_EVOLUTION}
EMAIL_SSL=${EMAIL_SSL}
EOF
  chmod 600 "${PROJECT_DIR}/.env"
  log ".env gerado (chaves novas)."
}

# ── 6. docker-compose.yml ───────────────────────────────────────────────────
write_compose() {
  step "docker-compose.yml (Traefik + Postgres + Evolution)"

  local docker_gid
  docker_gid=$(getent group docker | cut -d: -f3)
  [[ -n "${docker_gid}" ]] || error "Grupo 'docker' não encontrado."

  cat > "${PROJECT_DIR}/docker-compose.yml" <<COMPOSE
services:

  traefik:
    image: traefik:${TRAEFIK_VERSION}
    container_name: traefik
    restart: unless-stopped
    group_add:
      - "${docker_gid}"
    command:
      - --api.dashboard=false
      - --log.level=INFO
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=${EMAIL_SSL}
      - --certificatesresolvers.letsencrypt.acme.storage=/certs/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /run/docker.sock:/var/run/docker.sock
      - ./traefik/certs:/certs
    networks:
      - evo-net

  postgres:
    image: ${POSTGRES_IMAGE}
    container_name: evolution-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    networks:
      - evo-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 10s
      timeout: 5s
      retries: 10

  evolution:
    image: evoapicloud/evolution-api:${EVOLUTION_VERSION}
    container_name: evolution-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SERVER_TYPE: "http"
      SERVER_PORT: "8080"
      SERVER_URL: "https://${DOMAIN_EVOLUTION}"
      AUTHENTICATION_TYPE: "apikey"
      AUTHENTICATION_API_KEY: \${EVOLUTION_GLOBAL_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      LOG_LEVEL: "ERROR"
      LOG_COLOR: "false"
      DEL_INSTANCE: "false"
      DATABASE_PROVIDER: "postgresql"
      DATABASE_CONNECTION_URI: "postgresql://evolution:\${POSTGRES_PASSWORD}@evolution-postgres:5432/evolution"
      DATABASE_CONNECTION_CLIENT_NAME: "evolution_api"
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "true"
      DATABASE_SAVE_DATA_CONTACTS: "true"
      DATABASE_SAVE_DATA_CHATS: "true"
      DATABASE_SAVE_DATA_LABELS: "true"
      DATABASE_SAVE_DATA_HISTORIC: "true"
      CACHE_REDIS_ENABLED: "false"
      QRCODE_LIMIT: "30"
      QRCODE_COLOR: "#198754"
    volumes:
      - ./data/evolution:/evolution/instances
    networks:
      - evo-net
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.evolution-https.rule=Host(\`${DOMAIN_EVOLUTION}\`)"
      - "traefik.http.routers.evolution-https.entrypoints=websecure"
      - "traefik.http.routers.evolution-https.tls.certresolver=letsencrypt"
      - "traefik.http.routers.evolution-http.rule=Host(\`${DOMAIN_EVOLUTION}\`)"
      - "traefik.http.routers.evolution-http.entrypoints=web"
      - "traefik.http.routers.evolution-http.middlewares=https-redirect"
      - "traefik.http.middlewares.https-redirect.redirectscheme.scheme=https"
      - "traefik.http.services.evolution.loadbalancer.server.port=8080"

networks:
  evo-net:
    name: evo-net
COMPOSE
  log "docker-compose.yml escrito (docker GID=${docker_gid})."
}

# ── 7. Sobe containers ──────────────────────────────────────────────────────
start_containers() {
  step "docker compose up -d"
  pushd "${PROJECT_DIR}" >/dev/null
  set -a; source .env; set +a
  docker compose up -d --remove-orphans
  popd >/dev/null
  log "Containers subindo."
}

# ── 8. Espera + verifica ────────────────────────────────────────────────────
wait_and_verify() {
  step "Health checks"
  pushd "${PROJECT_DIR}" >/dev/null
  local i fail=0

  for i in {1..30}; do
    if docker exec evolution-postgres pg_isready -U evolution -d evolution -q 2>/dev/null; then
      log "Postgres: OK"; break
    fi
    [[ $i -eq 30 ]] && { warn "Postgres não respondeu"; fail=1; }
    sleep 2
  done

  for i in {1..45}; do
    if docker exec evolution-api sh -c 'wget -qO- http://localhost:8080 >/dev/null 2>&1 || curl -fsS http://localhost:8080 >/dev/null 2>&1'; then
      log "Evolution API (interno :8080): OK"; break
    fi
    [[ $i -eq 45 ]] && { warn "Evolution não respondeu em 90s"; fail=1; }
    sleep 2
  done

  docker compose ps
  popd >/dev/null
  return $fail
}

# ── 9. Resumo ───────────────────────────────────────────────────────────────
print_summary() {
  sep
  echo -e "${BOLD}${GREEN}"
  echo "╔═══════════════════════════════════════════════════════╗"
  echo "║   ✅  Evolution API instalada (servidor dedicado)     ║"
  echo "╚═══════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo -e "${BOLD}Endpoint:${NC}"
  echo "  URL base : https://${DOMAIN_EVOLUTION}"
  echo "  Manager  : https://${DOMAIN_EVOLUTION}/manager"
  echo
  echo -e "${BOLD}${YELLOW}Chave global (anote — é o header 'apikey' em todas as chamadas):${NC}"
  echo "  EVOLUTION_GLOBAL_KEY = $(grep ^EVOLUTION_GLOBAL_KEY "${PROJECT_DIR}/.env" | cut -d= -f2)"
  echo
  echo -e "${BOLD}Smoke test (quando o cert LE emitir):${NC}"
  echo "  curl -H \"apikey: <KEY>\" https://${DOMAIN_EVOLUTION}/instance/fetchInstances"
  echo
  echo -e "${BOLD}Operação:${NC}"
  echo "  cd ${PROJECT_DIR}"
  echo "  docker compose ps"
  echo "  docker compose logs -f evolution"
  echo "  docker compose logs -f traefik"
  sep
  warn "DNS de ${DOMAIN_EVOLUTION} precisa apontar pra este IP. Cert é emitido no primeiro hit HTTPS."
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  Evolution API — Instalador Standalone              ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

  require_root
  check_debian
  prompt_config

  setup_system
  install_docker
  setup_firewall
  setup_dirs
  generate_env
  write_compose
  start_containers
  wait_and_verify || warn "Alguns checks falharam — inspecione 'docker compose logs' acima."
  print_summary
}

main "$@"
