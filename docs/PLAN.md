# NetAgent Platform - Deployment Orchestration Plan

## Objective
Analyze the current system (NetAgent Platform) and create a self-contained installation package designed specifically to deploy the complete environment (frontend, backend, APIs, Docker services, domains, wireguard, etc.) dynamically onto a new server.

## Findings from System Analysis
The current application uses a mix of Docker containers and host-level services managed by PM2:
- **Docker Components**: Traefik (HTTPS reverse proxy), PostgreSQL 16 (w/ pgvector), Redis 7, Evolution API, WireGuard VPN Server, MCP MikroTik Driver, MCP Linux Driver, and Nginx (frontend/dist).
- **Host Components**: Node.js API (port 4000) and Python Agent (port 8000), managed by PM2. 
- **Setup & Deployment Scripts**: 
  - `server-setup.sh` orchestrates initial server prep on Debian 12 (installs Node, Docker, PM2, Python, configures `docker-compose.yml` and Traefik router config).
  - `deploy.sh` handles database migrations, npm installs, python venv setups, PM2 restarts, and Traefik config reloading.

## Phase 2 Implementation Plan (Parallel Agents)

To create a clean "Installation Package", we will orchestrate the following:

### 1. `database-architect` & `security-auditor` (Foundation)
- **`security-auditor`**: Audit the new `install-package.sh` script to ensure it generates safe passwords, secures the PostgreSQL and Redis instances, configuring UFW properly.
- **`database-architect`**: Ensure the PostgreSQL init scripts and pgvector migrations are properly exported and packaged so the new server starts with a clean or predefined database state.

### 2. `backend-specialist` & `frontend-specialist` (Core)
- **`backend-specialist`**: Dockerize the Node.js API and Python Agent entirely if possible to avoid host-level installation of Node.js and PM2, OR create a robust automated installer that packages the source code, `requirements.txt`, and `package.json` into a tarball. Update `docker-compose.yml` appropriately.
- **`frontend-specialist`**: Ensure the frontend build (`dist/`) is properly bundled in the package and configured to serve statically via the Nginx container proxying through Traefik, adjusting `.env` dynamic injects via a setup script.

### 3. `devops-engineer` & `test-engineer` (Polish)
- **`devops-engineer`**: 
  - Create the master `build-package.sh` script that bundles the entire application (SQL, Docker files, frontend build, API code, Agent code, and a Master Installer script) into `netagent-installer.tar.gz`.
  - Create `install-new-server.sh` which extracts the package, prompts for target Domains, Let's Encrypt Email, and API Keys, configures Traefik, and spins everything up on the target Debian 12 host.
- **`test-engineer`**: 
  - Validate the `install-new-server.sh` script logic through dry runs or verification scripts, ensuring Traefik routing, PostgreSQL connections, and frontend/backend integration endpoints are healthy.

## Next Step
Upon your approval, we will proceed to **Phase 2**, executing these agent roles in parallel to develop the final package scripts and config adjustments.
