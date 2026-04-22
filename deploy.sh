#!/bin/bash
# =============================================================================
# NetAgent Platform — Deploy Script (in-place)
# Funciona dentro de /var/www/agente_forum_telecom/
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✔]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

cd "${PROJECT_DIR}"

# ── Carregar .env ─────────────────────────────────────────────────────────────
[[ -f ".env" ]] || { echo "Crie o .env primeiro (copie de .env.example)"; exit 1; }
set -a; source .env; set +a

# ── Migração: MCP_DB_* ausente (instalações anteriores ao feat do MCP Postgres)
if ! grep -q "^MCP_DB_TOKEN=" .env; then
  info "Migração: adicionando variáveis do MCP Postgres ao .env..."
  NEW_MCP_TOKEN=$(openssl rand -hex 32)

  # Tenant schema: primeiro tenant ativo no banco; fallback pro subdomínio da plataforma.
  NEW_MCP_TENANT=$(PGPASSWORD="${POSTGRES_PASSWORD}" docker exec netagent-postgres \
    psql -U netagent -d netagent -tAc \
    "SELECT slug FROM public.tenants ORDER BY created_at LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ -z "${NEW_MCP_TENANT}" ]]; then
    NEW_MCP_TENANT=$(echo "${PUBLIC_URL:-https://main.local}" | sed -E 's|https?://||; s|\..*||' | tr -cd 'a-z0-9_')
    [[ -z "${NEW_MCP_TENANT}" ]] && NEW_MCP_TENANT="main"
  fi

  NEW_MCP_URL="${PUBLIC_URL:-https://agente.forumtelecom.com.br}/mcp"

  cat >> .env <<EOF

# === MCP Postgres (migração automática via deploy.sh)
MCP_DB_TOKEN=${NEW_MCP_TOKEN}
MCP_DB_TENANT_SCHEMA=${NEW_MCP_TENANT}
MCP_DB_URL=${NEW_MCP_URL}
EOF
  set -a; source .env; set +a
  log "MCP_DB_* adicionado (tenant=${NEW_MCP_TENANT}, url=${NEW_MCP_URL})."
fi

# ── 1. Criar diretórios de dados ──────────────────────────────────────────────
info "Criando diretórios..."
mkdir -p data/postgres data/redis data/evolution \
         traefik/certs traefik/config logs
touch traefik/certs/acme.json
chmod 600 traefik/certs/acme.json
log "Diretórios prontos."

# ── 2. Traefik: config para serviços no host ──────────────────────────────────
info "Configurando Traefik..."
cat > traefik/config/host-services.yml << 'EOF'
http:
  routers:
    api:
      rule: "Host(`agente.forumtelecom.com.br`) && PathPrefix(`/api`)"
      entryPoints: [websecure]
      service: api-service
      tls: { certResolver: letsencrypt }
      middlewares: [strip-api]

    socketio:
      rule: "Host(`agente.forumtelecom.com.br`) && PathPrefix(`/socket.io`)"
      entryPoints: [websecure]
      service: api-service
      tls: { certResolver: letsencrypt }

    agent:
      rule: "Host(`agente.forumtelecom.com.br`) && PathPrefix(`/agent`)"
      entryPoints: [websecure]
      service: agent-service
      tls: { certResolver: letsencrypt }
      middlewares: [strip-agent]

    frontend:
      rule: "Host(`agente.forumtelecom.com.br`)"
      entryPoints: [websecure]
      service: frontend-service
      tls: { certResolver: letsencrypt }

    platform-http:
      rule: "Host(`agente.forumtelecom.com.br`)"
      entryPoints: [web]
      service: frontend-service
      middlewares: [https-redirect]

  middlewares:
    https-redirect:
      redirectScheme: { scheme: https, permanent: true }
    strip-api:
      stripPrefix: { prefixes: ["/api"] }
    strip-agent:
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
EOF
log "Traefik configurado."

# ── 3. Subir / atualizar containers de infraestrutura ─────────────────────────
info "Subindo containers (Traefik, PostgreSQL, Redis, Evolution)..."
docker compose up -d --remove-orphans
sleep 8
docker compose ps
log "Containers prontos."

# ── 4. Aplicar schema no PostgreSQL ──────────────────────────────────────────
info "Aplicando init.sql no PostgreSQL..."
PGPASSWORD="${POSTGRES_PASSWORD}" docker exec -i netagent-postgres \
  psql -U netagent -d netagent < api/src/db/init.sql
log "Schema aplicado."

# ── 4b. Seed MCP drivers se existir ──────────────────────────────────────────
if [[ -f api/scripts/add_mcp_drivers.sql ]]; then
  info "Aplicando MCP drivers..."
  PGPASSWORD="${POSTGRES_PASSWORD}" docker exec -i netagent-postgres \
    psql -U netagent -d netagent < api/scripts/add_mcp_drivers.sql 2>/dev/null || true
  log "MCP drivers aplicados."
fi

# ── 5. API Node.js ────────────────────────────────────────────────────────────
info "Instalando dependências da API..."
cp .env api/.env
cd api && npm install --production && npx prisma generate 2>/dev/null || true && cd "${PROJECT_DIR}"
log "npm install OK."

# ── 6. Agent Python ───────────────────────────────────────────────────────────
info "Instalando dependências do Agent..."
cp .env agent/.env
cd agent
[[ -d venv ]] || python3.11 -m venv venv
./venv/bin/pip install --quiet -r requirements.txt
cd "${PROJECT_DIR}"
log "pip install OK."

# ── 6b. Frontend Build ────────────────────────────────────────────────────────
info "Build do frontend..."
cd frontend && npm install && npm run build && cd "${PROJECT_DIR}"
log "Frontend build OK."

# ── 7. Superadmin (apenas na primeira execução) ───────────────────────────────
ADMIN_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD}" docker exec netagent-postgres \
  psql -U netagent -d netagent -tAc "SELECT count(*) FROM public.platform_users" 2>/dev/null || echo "0")

if [[ "${ADMIN_COUNT}" == "0" ]]; then
  warn "Criando superadmin inicial..."
  ADMIN_PASS=$(openssl rand -base64 16 | tr -d '=/+' | head -c 16)
  HASH=$(node -e "const b=require('bcrypt');b.hash('${ADMIN_PASS}',12).then(h=>process.stdout.write(h))")
  PGPASSWORD="${POSTGRES_PASSWORD}" docker exec -i netagent-postgres psql -U netagent -d netagent -c \
    "INSERT INTO public.platform_users (email, password_hash, role)
     VALUES ('admin@forumtelecom.com.br', '${HASH}', 'superadmin')" > /dev/null

  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║  SUPERADMIN CRIADO — SALVE ESTES DADOS   ║"
  echo "║  Email: admin@forumtelecom.com.br        ║"
  echo "║  Senha: ${ADMIN_PASS}            ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""
fi

# ── 8. Iniciar com PM2 ────────────────────────────────────────────────────────
info "Iniciando serviços com PM2..."
pm2 delete netagent-api   2>/dev/null || true
pm2 delete netagent-agent 2>/dev/null || true

pm2 start "${PROJECT_DIR}/api/src/index.js" \
  --name netagent-api \
  --log "${PROJECT_DIR}/logs/api.log" \
  --cwd "${PROJECT_DIR}/api"

cd "${PROJECT_DIR}/agent"
pm2 start "./venv/bin/uvicorn" \
  --name netagent-agent \
  --interpreter none \
  --log "${PROJECT_DIR}/logs/agent.log" \
  -- main:app --host 0.0.0.0 --port 8000

pm2 save
cd "${PROJECT_DIR}"
log "PM2 configurado."

# ── 9. Status final ───────────────────────────────────────────────────────────
echo ""
pm2 list
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Deploy concluído! 🚀"
echo "  API:       https://agente.forumtelecom.com.br/api/health"
echo "  Agent:     https://agente.forumtelecom.com.br/agent/"
echo "  Evolution: https://agenteevo.forumtelecom.com.br"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
