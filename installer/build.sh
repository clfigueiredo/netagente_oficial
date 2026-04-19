#!/bin/bash
set -euo pipefail

# Script Mestre de Geração de Pacote - NetAgent
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${PROJECT_DIR}/netagent-release"
PACKAGE="netagent-installer.tar.gz"

echo "================================================="
echo " Gerando Pacote de Instalação Completo (NetAgent)"
echo "================================================="

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# 1. Frontend
echo "[1/7] Buildando Frontend..."
cd "${PROJECT_DIR}/frontend"
npm install --quiet
npm run build --quiet
mkdir -p "${DIST_DIR}/frontend"
cp -r dist "${DIST_DIR}/frontend/"

# 2. API (Node)
echo "[2/7] Copiando API Backend..."
cd "${PROJECT_DIR}"
cp -r api "${DIST_DIR}/api"
rm -rf "${DIST_DIR}/api/node_modules"

# 3. Agent (Python)
echo "[3/7] Copiando Agent Inteligente..."
cp -r agent "${DIST_DIR}/agent"
rm -rf "${DIST_DIR}/agent/venv"
rm -rf "${DIST_DIR}/agent/__pycache__"

# 4. MCPs, Wireguard e Traefik
echo "[4/7] Copiando Infra (MCPs, VPN, Traefik)..."
cp -r mcp-mikrotik "${DIST_DIR}/mcp-mikrotik"
cp -r mcp-linux "${DIST_DIR}/mcp-linux"
cp -r docker "${DIST_DIR}/docker"
cp -r traefik "${DIST_DIR}/traefik"
mkdir -p "${DIST_DIR}/data" # Apenas criar pasta base

# 5. Configurações e Compose
echo "[5/7] Copiando configurações..."
cp docker-compose.yml "${DIST_DIR}/docker-compose.yml"

# 6. Adicionar script instalador
echo "[6/7] Adicionando Instalador Universal..."
cp installer/scripts/install.sh "${DIST_DIR}/install.sh"
chmod +x "${DIST_DIR}/install.sh"

# 7. Empacotar
echo "[7/7] Gerando tar.gz..."
cd "${DIST_DIR}"
tar -czf "../${PACKAGE}" ./*

echo "================================================="
echo " Sucesso! Pacote gerado com todos os módulos:"
echo " -> ${PROJECT_DIR}/${PACKAGE}"
echo "================================================="
