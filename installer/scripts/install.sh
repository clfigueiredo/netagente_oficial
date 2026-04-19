#!/bin/bash
# =============================================================================
# NetAgent Platform — Instalador Universal (Debian/Ubuntu)
# Suporte a Docker (Wireguard, Traefik, Evolution, Postgres, Redis, MCPs)
# Suporte Host (API Node, Agent Python via PM2, e vsftpd para Backup)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()   { echo -e "${GREEN}[✔]${NC} $1"; }
info()  { echo -e "${BLUE}[→]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✘]${NC} $1" >&2; exit 1; }
sep()   { echo -e "${CYAN}──────────────────────────────────────────────${NC}"; }

PROJECT_DIR="/opt/netagent"
NODE_VERSION="20"

require_root() {
  [[ $EUID -eq 0 ]] || error "Execute como root: sudo bash install.sh"
}

gen_secret() { openssl rand -hex 32; }

prompt_config() {
  sep
  echo -e "${BOLD}Configuração da Plataforma NetAgent${NC}"
  read -p "Domínio da Plataforma (ex: agente.forumtelecom.com.br): " DOMAIN_PLATFORM
  read -p "Domínio Evolution API (ex: agenteevo.forumtelecom.com.br): " DOMAIN_EVOLUTION
  read -p "E-mail para o SSL Let's Encrypt: " EMAIL_SSL
  read -p "Chave de API do OpenAI: " OPENAI_KEY
  echo ""
}

install_system_deps() {
  info "Instalando dependências de sistema (vsftpd, ufw, build-essential)..."
  apt-get update -qq
  apt-get install -y -qq curl wget git unzip ca-certificates gnupg lsb-release ufw vsftpd build-essential
}

install_docker() {
  if ! command -v docker &>/dev/null; then
    info "Instalando Docker..."
    curl -fsSL https://get.docker.com | bash
  fi
  systemctl enable --now docker
  log "Docker OK."
}

install_nodejs() {
  if ! command -v node &>/dev/null; then
    info "Instalando Node.js ${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y -qq nodejs
  fi
  npm install -g pm2
  log "Node.js e PM2 OK."
}

install_python() {
  if ! python3 --version &>/dev/null; then
    info "Instalando Python 3..."
    apt-get install -y -qq python3 python3-venv python3-pip python3-dev
  fi
  log "Python OK."
}

setup_vsftpd() {
  info "Configurando Servidor FTP (Backups)..."
  sed -i 's/^listen=.*/listen=YES/' /etc/vsftpd.conf 2>/dev/null || echo "listen=YES" >> /etc/vsftpd.conf
  sed -i 's/^listen_ipv6=.*/#listen_ipv6=YES/' /etc/vsftpd.conf 2>/dev/null || true
  sed -i 's/^anonymous_enable=.*/anonymous_enable=NO/' /etc/vsftpd.conf 2>/dev/null || echo "anonymous_enable=NO" >> /etc/vsftpd.conf
  sed -i 's/^local_enable=.*/local_enable=YES/' /etc/vsftpd.conf 2>/dev/null || echo "local_enable=YES" >> /etc/vsftpd.conf
  sed -i 's/^write_enable=.*/write_enable=YES/' /etc/vsftpd.conf 2>/dev/null || echo "write_enable=YES" >> /etc/vsftpd.conf
  
  # Adicionando parâmetros de porta
  sed -i '/^listen_port=/d' /etc/vsftpd.conf
  sed -i '/^pasv_min_port=/d' /etc/vsftpd.conf
  sed -i '/^pasv_max_port=/d' /etc/vsftpd.conf
  echo "listen_port=2121" >> /etc/vsftpd.conf
  echo "pasv_min_port=40000" >> /etc/vsftpd.conf
  echo "pasv_max_port=40500" >> /etc/vsftpd.conf
  
  systemctl restart vsftpd
  systemctl enable vsftpd
  log "VSFTPD Configurado."
}

setup_firewall() {
  info "Configurando UFW..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 2121/tcp
  ufw allow 40000:40500/tcp
  # Wireguard default port
  ufw allow 51820/udp
  ufw --force enable
  log "Firewall Ativo e Configurado."
}

setup_env() {
  info "Preparando ambiente e segredos..."
  mkdir -p "${PROJECT_DIR}"
  cp -a $(dirname "$0")/* "${PROJECT_DIR}/"
  cd "${PROJECT_DIR}"

  POSTGRES_PASSWORD=$(gen_secret)
  REDIS_PASSWORD=$(gen_secret)
  JWT_SECRET=$(gen_secret)
  ENCRYPTION_KEY=$(gen_secret)
  EVOLUTION_KEY=$(gen_secret)

  cat > ".env" << EOF
DOMAIN_PLATFORM=${DOMAIN_PLATFORM}
DOMAIN_EVOLUTION=${DOMAIN_EVOLUTION}
EMAIL_SSL=${EMAIL_SSL}

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://netagent:${POSTGRES_PASSWORD}@localhost:5432/netagent

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379

JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

OPENAI_KEY=${OPENAI_KEY}
EVOLUTION_GLOBAL_KEY=${EVOLUTION_KEY}
EVOLUTION_BASE_URL=https://${DOMAIN_EVOLUTION}

PUBLIC_URL=https://${DOMAIN_PLATFORM}
VITE_API_URL=https://${DOMAIN_PLATFORM}/api
VITE_WS_URL=https://${DOMAIN_PLATFORM}

NODE_ENV=production
PORT=4000
AGENT_PORT=8000
LOG_LEVEL=info
EOF
  chmod 600 .env
  
  # Distribui o env para API e Agent
  cp .env api/
  cp .env agent/
  log ".env gerado."
}

prepare_host_routing() {
  info "Configurando Rotas de Host do Traefik..."
  # Precisamos reescrever o host-services.yml para o Traefik achar o PM2 no host
  cat > "${PROJECT_DIR}/traefik/config/host-services.yml" << TRAEFIK_FILE
http:
  routers:
    api:
      rule: "Host(\`${DOMAIN_PLATFORM}\`) && PathPrefix(\`/api\`)"
      entryPoints: [websecure]
      service: api-service
      tls: { certResolver: letsencrypt }
      middlewares: [strip-api-prefix]

    socketio:
      rule: "Host(\`${DOMAIN_PLATFORM}\`) && PathPrefix(\`/socket.io\`)"
      entryPoints: [websecure]
      service: api-service
      tls: { certResolver: letsencrypt }

    agent:
      rule: "Host(\`${DOMAIN_PLATFORM}\`) && PathPrefix(\`/agent\`)"
      entryPoints: [websecure]
      service: agent-service
      tls: { certResolver: letsencrypt }
      middlewares: [strip-agent-prefix]

    frontend:
      rule: "Host(\`${DOMAIN_PLATFORM}\`)"
      entryPoints: [websecure]
      service: frontend-service
      tls: { certResolver: letsencrypt }

    platform-http:
      rule: "Host(\`${DOMAIN_PLATFORM}\`)"
      entryPoints: [web]
      middlewares: [https-redirect]
      service: frontend-service

  middlewares:
    https-redirect:
      redirectScheme: { scheme: https, permanent: true }
    strip-api-prefix:
      stripPrefix: { prefixes: ["/api"] }
    strip-agent-prefix:
      stripPrefix: { prefixes: ["/agent"] }

  services:
    api-service:
      loadBalancer:
        servers: [{ url: "http://host-gateway:4000" }]
    agent-service:
      loadBalancer:
        servers: [{ url: "http://host-gateway:8000" }]
    frontend-service:
      loadBalancer:
        servers: [{ url: "http://host-gateway:3000" }]
TRAEFIK_FILE

  # Nginx config param
  sed -i "s/agente.forumtelecom.com.br/${DOMAIN_PLATFORM}/g" "${PROJECT_DIR}/traefik/nginx-frontend.conf" || true
}

deploy_docker() {
  info "Subindo Containers Docker (DB, Redis, Evo, Wireguard, Traefik, MCPs)..."
  mkdir -p data/postgres data/redis data/evolution traefik/certs traefik/config data/wireguard logs
  touch traefik/certs/acme.json
  chmod 600 traefik/certs/acme.json

  # Utiliza as vars do env
  set -a; source .env; set +a
  docker compose up -d --build
  log "Aguardando Banco de Dados (15s)..."
  sleep 15
}

deploy_host_pm2() {
  info "Instalando dependencias API e DB migrations..."
  cd "${PROJECT_DIR}/api"
  npm install --production
  
  # Aplica init.sql no postgresql. A interface do PG vectorize pede que rode direto:
  PGPASSWORD="${POSTGRES_PASSWORD}" docker exec -i netagent-postgres psql -U netagent -d netagent < src/db/init.sql || true
  
  info "Instalando dependencias do Agent Python..."
  cd "${PROJECT_DIR}/agent"
  python3 -m venv venv
  ./venv/bin/pip install -r requirements.txt

  info "Iniciando serviços PM2..."
  cd "${PROJECT_DIR}"
  pm2 delete netagent-api 2>/dev/null || true
  pm2 delete netagent-agent 2>/dev/null || true

  pm2 start "${PROJECT_DIR}/api/src/index.js" --name netagent-api --log "${PROJECT_DIR}/logs/api.log" --cwd "${PROJECT_DIR}/api"
  cd "${PROJECT_DIR}/agent"
  pm2 start "./venv/bin/uvicorn" --name netagent-agent --interpreter none --log "${PROJECT_DIR}/logs/agent.log" -- main:app --host 0.0.0.0 --port 8000
  pm2 save
  cd "${PROJECT_DIR}"
  
  # Cria o Server de Frontend com servir tbm? Não, o Nginx no Docker faz isso.
  log "PM2 Configurado."
}

create_superadmin() {
  # Verifica e cria se nao existir
  set -a; source .env; set +a
  ADMIN_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD}" docker exec netagent-postgres psql -U netagent -d netagent -tAc "SELECT count(*) FROM public.platform_users" 2>/dev/null || echo "0")
  if [[ "${ADMIN_COUNT}" == "0" ]]; then
    warn "Criando Superadmin..."
    ADMIN_PASS=$(openssl rand -base64 12)
    HASH=$(node -e "const b=require('bcrypt');b.hash('${ADMIN_PASS}',12).then(console.log)")
    PGPASSWORD="${POSTGRES_PASSWORD}" docker exec -i netagent-postgres psql -U netagent -d netagent -c "INSERT INTO public.platform_users (email, password_hash, role) VALUES ('admin@forumtelecom.com.br', '${HASH}', 'superadmin');" >/dev/null
    echo -e "${YELLOW}>> SUPERADMIN: admin@forumtelecom.com.br | SENHA: ${ADMIN_PASS} ${NC}"
  fi
}

main() {
  require_root
  prompt_config
  install_system_deps
  install_docker
  install_nodejs
  install_python
  setup_vsftpd
  setup_env
  prepare_host_routing
  deploy_docker
  setup_firewall
  deploy_host_pm2
  create_superadmin
  
  sep
  echo -e "${BOLD}${GREEN}Instalação Finalizada com Sucesso!${NC}"
  echo "- Plataforma: https://${DOMAIN_PLATFORM}"
  echo "- Evolution API: https://${DOMAIN_EVOLUTION}"
  sep
}

main "$@"
