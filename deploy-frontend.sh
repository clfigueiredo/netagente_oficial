#!/bin/bash
# deploy-frontend.sh — Build e deploy do frontend
# O nginx (netagent-frontend) monta ./frontend/dist via Docker volume,
# então basta fazer o build — não é necessário copiar arquivos.
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "🧹 Limpando dist anterior..."
rm -rf "$FRONTEND_DIR/dist"

echo "🔨 Build do frontend..."
cd "$FRONTEND_DIR"
npm run build

echo "🔄 Reiniciando nginx..."
docker restart netagent-frontend

echo "✅ Frontend deployado! $(date '+%d/%m/%Y %H:%M:%S')"
