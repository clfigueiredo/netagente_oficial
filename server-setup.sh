#!/bin/bash
# =============================================================================
# NetAgent Platform — Server Setup
# Debian 12 (Bookworm) · Docker + Traefik · Node.js + Python no host
#
# Arquitetura:
#   Docker:  Traefik (SSL auto) · PostgreSQL 16 · Redis 7 · Evolution API
#   Host:    Node.js 20 (API)  · Python 3.12 (Agent) · frontend (build estático)
#
# Domínios:
#   agente.forumtelecom.com.br    → plataforma
#   agenteevo.forumtelecom.com.br → Evolution API
# =============================================================================
set -euo pipefail

# ─── Cores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()   { echo -e "${GREEN}[✔]${NC} $1"; }
info()  { echo -e "${BLUE}[→]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✘]${NC} $1" >&2; exit 1; }
sep()   { echo -e "${CYAN}──────────────────────────────────────────────${NC}"; }

# ─── Configurações ────────────────────────────────────────────────────────────
DOMAIN_PLATFORM="agente.forumtelecom.com.br"
DOMAIN_EVOLUTION="agenteevo.forumtelecom.com.br"
EMAIL_SSL="admin@forumtelecom.com.br"
PROJECT_DIR="/opt/netagent"
NODE_VERSION="20"
PYTHON_VERSION="3.11"

# ─── Funções utilitárias ──────────────────────────────────────────────────────
require_root() {
  [[ $EUID -eq 0 ]] || error "Execute como root: sudo bash server-setup.sh"
}

check_debian12() {
  [[ -f /etc/os-release ]] || error "OS não suportado."
  . /etc/os-release
  [[ "$ID" == "debian" && "$VERSION_ID" == "12" ]] || \
    error "Este script requer Debian 12. Detectado: $PRETTY_NAME"
  log "Debian 12 detectado."
}

gen_secret() { openssl rand -hex 32; }

# ─── 1. Sistema base ──────────────────────────────────────────────────────────
setup_system() {
  sep; info "Atualizando sistema Debian 12..."
  apt-get update -qq
  apt-get upgrade -y -qq
  apt-get install -y -qq \
    curl wget git unzip ca-certificates gnupg lsb-release \
    openssl ufw fail2ban htop jq build-essential \
    software-properties-common apt-transport-https
  log "Sistema pronto."
}

# ─── 2. Docker ────────────────────────────────────────────────────────────────
install_docker() {
  sep
  if command -v docker &>/dev/null; then
    log "Docker já instalado: $(docker --version)"; return
  fi
  info "Instalando Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  log "Docker instalado: $(docker --version)"
}

# ─── 3. Node.js 20 ───────────────────────────────────────────────────────────
install_nodejs() {
  sep
  if command -v node &>/dev/null; then
    log "Node.js já instalado: $(node --version)"; return
  fi
  info "Instalando Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
  npm install -g pm2
  log "Node.js $(node --version) + PM2 instalados."
}

# ─── 4. Python 3.11 (padrão Debian 12) ──────────────────────────────────────
install_python() {
  sep
  if python3.11 --version &>/dev/null 2>&1; then
    log "Python já instalado: $(python3.11 --version)"; return
  fi
  info "Instalando Python 3.11 (padrão Debian 12)..."
  apt-get install -y -qq python3.11 python3.11-venv python3.11-dev python3-pip
  # Garante pip para 3.11
  python3.11 -m ensurepip --upgrade 2>/dev/null || true
  log "Python $(python3.11 --version) instalado."
}

# ─── 5. Firewall ─────────────────────────────────────────────────────────────
setup_firewall() {
  sep; info "Configurando UFW..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp comment 'HTTP (Traefik)'
  ufw allow 443/tcp comment 'HTTPS (Traefik)'
  ufw --force enable
  log "Firewall ativo: SSH + 80 + 443 liberados."
}

# ─── 6. Estrutura de diretórios ───────────────────────────────────────────────
setup_dirs() {
  sep; info "Criando diretórios..."
  mkdir -p \
    "${PROJECT_DIR}" \
    "${PROJECT_DIR}/traefik/certs" \
    "${PROJECT_DIR}/traefik/config" \
    "${PROJECT_DIR}/postgres/data" \
    "${PROJECT_DIR}/redis/data" \
    "${PROJECT_DIR}/evolution/store" \
    "${PROJECT_DIR}/logs"
  touch "${PROJECT_DIR}/traefik/certs/acme.json"
  chmod 600 "${PROJECT_DIR}/traefik/certs/acme.json"
  log "Diretórios criados em ${PROJECT_DIR}/"
}

# ─── 7. Gerar .env ────────────────────────────────────────────────────────────
generate_env() {
  sep; info "Gerando segredos e .env..."

  POSTGRES_PASSWORD=$(gen_secret)
  REDIS_PASSWORD=$(gen_secret)
  JWT_SECRET=$(gen_secret)
  ENCRYPTION_KEY=$(gen_secret)
  EVOLUTION_KEY=$(gen_secret)

  cat > "${PROJECT_DIR}/.env" << EOF
# ── Banco de Dados
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://netagent:${POSTGRES_PASSWORD}@localhost:5432/netagent

# ── Redis
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379

# ── Segurança
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── OpenAI
OPENAI_KEY=sk-ADICIONE_SUA_CHAVE_AQUI

# ── Evolution API
EVOLUTION_GLOBAL_KEY=${EVOLUTION_KEY}
EVOLUTION_BASE_URL=https://${DOMAIN_EVOLUTION}

# ── URLs
PUBLIC_URL=https://${DOMAIN_PLATFORM}
VITE_API_URL=https://${DOMAIN_PLATFORM}/api
VITE_WS_URL=https://${DOMAIN_PLATFORM}

# ── App
NODE_ENV=production
PORT=4000
AGENT_PORT=8000
LOG_LEVEL=info
EOF

  chmod 600 "${PROJECT_DIR}/.env"
  log ".env gerado com todos os segredos."

  # Exporta para uso no restante do script
  export POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET ENCRYPTION_KEY EVOLUTION_KEY
}

# ─── 8. Traefik file provider (rotas para host) ───────────────────────────────
setup_traefik_file_config() {
  info "Criando config do Traefik para serviços no host..."

  # Traefik precisa do host IP na rede Docker
  # host-gateway é resolvido automaticamente pelo Docker

  cat > "${PROJECT_DIR}/traefik/config/host-services.yml" << 'TRAEFIK_FILE'
http:
  routers:
    # ── API Node.js
    api:
      rule: "Host(`DOMAIN_PLATFORM_VAR`) && PathPrefix(`/api`)"
      entryPoints: [websecure]
      service: api-service
      tls:
        certResolver: letsencrypt
      middlewares: [strip-api-prefix]

    # ── WebSocket (Socket.io)
    socketio:
      rule: "Host(`DOMAIN_PLATFORM_VAR`) && PathPrefix(`/socket.io`)"
      entryPoints: [websecure]
      service: api-service
      tls:
        certResolver: letsencrypt

    # ── Python Agent
    agent:
      rule: "Host(`DOMAIN_PLATFORM_VAR`) && PathPrefix(`/agent`)"
      entryPoints: [websecure]
      service: agent-service
      tls:
        certResolver: letsencrypt
      middlewares: [strip-agent-prefix]

    # ── Frontend React (build estático servido via serve na 3000)
    frontend:
      rule: "Host(`DOMAIN_PLATFORM_VAR`)"
      entryPoints: [websecure]
      service: frontend-service
      tls:
        certResolver: letsencrypt

    # ── HTTP → HTTPS redirect
    platform-http:
      rule: "Host(`DOMAIN_PLATFORM_VAR`)"
      entryPoints: [web]
      middlewares: [https-redirect]
      service: frontend-service

  middlewares:
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true
    strip-api-prefix:
      stripPrefix:
        prefixes: ["/api"]
    strip-agent-prefix:
      stripPrefix:
        prefixes: ["/agent"]

  services:
    api-service:
      loadBalancer:
        servers:
          - url: "http://host-gateway:4000"
    agent-service:
      loadBalancer:
        servers:
          - url: "http://host-gateway:8000"
    frontend-service:
      loadBalancer:
        servers:
          - url: "http://host-gateway:3000"
TRAEFIK_FILE

  sed -i "s/DOMAIN_PLATFORM_VAR/${DOMAIN_PLATFORM}/g" \
    "${PROJECT_DIR}/traefik/config/host-services.yml"

  log "Config Traefik para host criada."
}

# ─── 9. docker-compose.yml ────────────────────────────────────────────────────
create_docker_compose() {
  sep; info "Criando docker-compose.yml..."

  cat > "${PROJECT_DIR}/docker-compose.yml" << COMPOSE
services:

  # ── Traefik: proxy reverso + SSL automático
  traefik:
    image: traefik:v3.2
    container_name: traefik
    restart: unless-stopped
    command:
      - --api.dashboard=true
      - --api.insecure=false
      - --log.level=INFO
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=netagent-net
      - --providers.file.directory=/etc/traefik/config
      - --providers.file.watch=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=${EMAIL_SSL}
      - --certificatesresolvers.letsencrypt.acme.storage=/certs/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host-gateway:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ${PROJECT_DIR}/traefik/certs:/certs
      - ${PROJECT_DIR}/traefik/config:/etc/traefik/config:ro
    networks:
      - netagent-net

  # ── PostgreSQL 16 + pgvector
  postgres:
    image: pgvector/pgvector:pg16
    container_name: netagent-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: netagent
      POSTGRES_USER: netagent
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - ${PROJECT_DIR}/postgres/data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    networks:
      - netagent-net

  # ── Redis 7
  redis:
    image: redis:7-alpine
    container_name: netagent-redis
    restart: unless-stopped
    command: redis-server --requirepass \${REDIS_PASSWORD}
    volumes:
      - ${PROJECT_DIR}/redis/data:/data
    ports:
      - "127.0.0.1:6379:6379"
    networks:
      - netagent-net

  # ── Evolution API v1
  evolution:
    image: atendai/evolution-api:v1.8.2
    container_name: evolution-api
    restart: unless-stopped
    environment:
      AUTHENTICATION_TYPE: "apikey"
      AUTHENTICATION_API_KEY: \${EVOLUTION_GLOBAL_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      DEL_INSTANCE: "false"
      DATABASE_ENABLED: "false"
      REDIS_ENABLED: "false"
      LOG_LEVEL: "ERROR"
      PRODUCTION: "true"
    volumes:
      - ${PROJECT_DIR}/evolution/store:/evolution/store
    networks:
      - netagent-net
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
  netagent-net:
    name: netagent-net
COMPOSE

  log "docker-compose.yml criado."
}

# ─── 10. Subir containers ─────────────────────────────────────────────────────
start_containers() {
  sep; info "Subindo containers (Traefik + PostgreSQL + Redis + Evolution API)..."
  cd "${PROJECT_DIR}"
  set -a; source .env; set +a
  docker compose up -d
  info "Aguardando inicialização..."
  sleep 10
  docker compose ps
  log "Containers iniciados."
}

# ─── 11. Verificação ──────────────────────────────────────────────────────────
verify() {
  sep; info "Verificando serviços..."

  local ok=0

  # PostgreSQL
  if docker exec netagent-postgres pg_isready -U netagent -q 2>/dev/null; then
    log "PostgreSQL: online ✅"; else warn "PostgreSQL: aguardando..."; ok=1; fi

  # Redis
  if docker exec netagent-redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
    log "Redis: online ✅"; else warn "Redis: aguardando..."; ok=1; fi

  # Evolution API
  if curl -sf http://localhost:8080/ 2>/dev/null | grep -q "Evolution"; then
    log "Evolution API: online ✅"
  else
    # Pode estar acessível só via Traefik
    warn "Evolution API: aguardando roteamento Traefik..."
  fi

  # Traefik
  if docker inspect traefik --format "{{.State.Status}}" 2>/dev/null | grep -q running; then
    log "Traefik: online ✅"; else warn "Traefik: problema detectado"; ok=1; fi

  return $ok
}

# ─── 12. Resumo final ─────────────────────────────────────────────────────────
print_summary() {
  sep
  echo -e "${BOLD}${GREEN}"
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║   ✅  SERVIDOR PRONTO — NetAgent Platform            ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  echo -e "${BOLD}Infraestrutura (Docker):${NC}"
  echo "  Traefik:       SSL automático (Let's Encrypt)"
  echo "  PostgreSQL 16: localhost:5432"
  echo "  Redis 7:       localhost:6379"
  echo "  Evolution API: https://${DOMAIN_EVOLUTION}"

  echo ""
  echo -e "${BOLD}Host (a iniciar com o projeto):${NC}"
  echo "  Node.js:  $(node --version 2>/dev/null || echo 'não instalado')"
  echo "  Python:   $(python3.11 --version 2>/dev/null || python3 --version 2>/dev/null || echo 'não instalado')"
  echo "  PM2:      $(pm2 --version 2>/dev/null || echo 'não instalado')"

  echo ""
  echo -e "${BOLD}Arquivos:${NC}"
  echo "  Projeto:         ${PROJECT_DIR}/"
  echo "  .env:            ${PROJECT_DIR}/.env"
  echo "  docker-compose:  ${PROJECT_DIR}/docker-compose.yml"
  echo "  Traefik config:  ${PROJECT_DIR}/traefik/config/"

  echo ""
  echo -e "${BOLD}URLs:${NC}"
  echo "  Plataforma: https://${DOMAIN_PLATFORM}"
  echo "  Evolution:  https://${DOMAIN_EVOLUTION}"

  echo ""
  echo -e "${YELLOW}⚠️  Próximo passo:${NC}"
  echo "  Edite o .env e adicione sua chave OpenAI:"
  echo "  nano ${PROJECT_DIR}/.env"
  sep

  echo ""
  echo -e "${BOLD}Evolution API Key (já salva no .env):${NC}"
  grep EVOLUTION_GLOBAL_KEY "${PROJECT_DIR}/.env"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}"
  echo "╔════════════════════════════════════════════════════╗"
  echo "║  NetAgent Platform — Setup · Debian 12 + Traefik  ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  require_root
  check_debian12

  warn "Instalará: Docker, Node.js 20, Python 3.12, PM2, UFW"
  warn "Containers: Traefik, PostgreSQL 16, Redis 7, Evolution API"
  warn "DNS de '${DOMAIN_PLATFORM}' e '${DOMAIN_EVOLUTION}' deve apontar para este IP."
  echo ""
  read -rp "$(echo -e "${YELLOW}Continuar? [s/N] ${NC}")" confirm
  [[ "$confirm" =~ ^[Ss]$ ]] || { echo "Cancelado."; exit 0; }

  setup_system
  install_docker
  install_nodejs
  install_python
  setup_firewall
  setup_dirs
  generate_env
  setup_traefik_file_config
  create_docker_compose
  start_containers
  verify
  print_summary
}

main "$@"
