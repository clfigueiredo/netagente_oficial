-- =============================================================================
-- NetAgent Platform — Database Initialization
-- PostgreSQL 16 + pgvector
-- Schema: public (global) + {tenant_slug} (per tenant, created dynamically)
-- =============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- SCHEMA PUBLIC — Global data
-- =============================================================================

-- SaaS Plans
CREATE TABLE IF NOT EXISTS public.plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  max_devices     INTEGER NOT NULL DEFAULT 10,
  max_users       INTEGER NOT NULL DEFAULT 5,
  max_whatsapp_numbers INTEGER NOT NULL DEFAULT 3,
  price_monthly   DECIMAL(10,2),
  features        JSONB NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenants (SaaS customers)
CREATE TABLE IF NOT EXISTS public.tenants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) UNIQUE NOT NULL,
  plan_id               UUID REFERENCES public.plans(id),

  -- WhatsApp (Evolution API)
  evolution_instance    VARCHAR(100),
  evolution_key         VARCHAR(255),

  -- LLM: tenant-owned key or platform shared key
  openai_key_encrypted  VARCHAR(500),
  gpt_model             VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',

  admin_email           VARCHAR(255) NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  trial_ends_at         TIMESTAMPTZ,
  wg_subnet             VARCHAR(20),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Skills (global, versioned)
CREATE TABLE IF NOT EXISTS public.skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) UNIQUE NOT NULL,
  display_name    VARCHAR(200) NOT NULL,
  description     TEXT NOT NULL,
  category        VARCHAR(50) NOT NULL CHECK (category IN ('mikrotik','linux','docker','network','general')),
  device_type     VARCHAR(50),
  prompt_template TEXT,
  tools           JSONB NOT NULL DEFAULT '[]',
  examples        JSONB NOT NULL DEFAULT '[]',
  version         INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RAG Knowledge Base (global)
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(500) NOT NULL,
  content       TEXT NOT NULL,
  embedding     VECTOR(1536),
  category      VARCHAR(100),
  device_type   VARCHAR(50),
  source        VARCHAR(100) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','learned','documentation')),
  tenant_id     UUID REFERENCES public.tenants(id),
  quality_score FLOAT NOT NULL DEFAULT 0.5,
  use_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_base_embedding_idx
  ON public.knowledge_base USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS knowledge_base_category_idx ON public.knowledge_base(category);
CREATE INDEX IF NOT EXISTS knowledge_base_device_type_idx ON public.knowledge_base(device_type);

-- Platform super-admins
CREATE TABLE IF NOT EXISTS public.platform_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default plans
INSERT INTO public.plans (name, max_devices, max_users, max_whatsapp_numbers, price_monthly, features) VALUES
  ('Starter',       5,   2,  1,   97.00, '{"monitoring":true,"whatsapp":true,"rag":false}'),
  ('Professional', 25,  10,  3,  297.00, '{"monitoring":true,"whatsapp":true,"rag":true,"custom_skills":false}'),
  ('Enterprise',   99, 999, 10, 997.00,  '{"monitoring":true,"whatsapp":true,"rag":true,"custom_skills":true,"sla":true}')
ON CONFLICT DO NOTHING;

-- Default skills (MikroTik)
INSERT INTO public.skills (name, display_name, description, category, device_type) VALUES
  ('device_status',       'Status do Dispositivo',    'Verifica CPU, RAM, uptime e versão do sistema do dispositivo',            'mikrotik', 'mikrotik'),
  ('interface_analysis',  'Análise de Interfaces',    'Lista interfaces, tráfego, erros e estado de cada porta de rede',         'mikrotik', 'mikrotik'),
  ('bgp_analysis',        'Análise BGP',              'Verifica peers BGP, prefixos, uptime de sessão e detecta drops',          'mikrotik', 'mikrotik'),
  ('load_balance_pcc',    'Load Balance PCC',         'Cria ou edita balanceamento de carga PCC entre múltiplos links',          'mikrotik', 'mikrotik'),
  ('failover_netwatch',   'Failover Netwatch',        'Configura failover automático com Netwatch e rotas de contingência',      'mikrotik', 'mikrotik'),
  ('firewall_management', 'Gerenciar Firewall',       'Lista, cria e edita regras de firewall (filter, mangle)',                 'mikrotik', 'mikrotik'),
  ('nat_management',      'Gerenciar NAT',            'Port forward, masquerade, dst-nat e src-nat',                            'mikrotik', 'mikrotik'),
  ('vpn_wireguard',       'VPN WireGuard',            'Cria e gerencia túneis WireGuard no RouterOS',                           'mikrotik', 'mikrotik'),
  ('dhcp_management',     'DHCP e Pools',             'Gerencia leases DHCP, pools de endereços e reservas estáticas',          'mikrotik', 'mikrotik'),
  ('queue_qos',           'Filas e QoS',              'Filas simples, queue tree e PCQ para controle de banda',                 'mikrotik', 'mikrotik'),
  ('log_analysis',        'Análise de Logs',          'Lê e interpreta logs do RouterOS para identificar problemas',            'mikrotik', 'mikrotik'),
  ('config_audit',        'Auditoria de Config',      'Auditoria completa da configuração completa do dispositivo',             'mikrotik', 'mikrotik')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- FUNCTION: create_tenant_schema(tenant_slug TEXT)
-- Creates all tables for a new tenant in its own schema
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_tenant_schema(p_slug TEXT)
RETURNS VOID AS $$
DECLARE
  v_schema TEXT := quote_ident(p_slug);
BEGIN
  -- Create schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %s', v_schema);

  -- Devices
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.devices (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name              VARCHAR(100) NOT NULL,
      type              VARCHAR(20) NOT NULL CHECK (type IN (''mikrotik'',''linux'',''docker_host'')),
      host              VARCHAR(255) NOT NULL,
      port              INTEGER NOT NULL DEFAULT 22,
      username          VARCHAR(100) NOT NULL,
      password_encrypted VARCHAR(500) NOT NULL,
      description       TEXT,
      location          VARCHAR(200),
      tags              JSONB NOT NULL DEFAULT ''[]'',
      active            BOOLEAN NOT NULL DEFAULT true,
      last_seen_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Users
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name          VARCHAR(200),
      role          VARCHAR(20) NOT NULL DEFAULT ''operator'' CHECK (role IN (''admin'',''operator'',''readonly'')),
      active        BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- WhatsApp authorized numbers
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.whatsapp_users (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      number     VARCHAR(20) UNIQUE NOT NULL,
      name       VARCHAR(200),
      role       VARCHAR(20) NOT NULL DEFAULT ''operator'' CHECK (role IN (''admin'',''operator'',''readonly'')),
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Conversations
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.conversations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel          VARCHAR(20) NOT NULL CHECK (channel IN (''whatsapp'',''web'')),
      whatsapp_number  VARCHAR(20),
      web_user_id      UUID,
      title            VARCHAR(500),
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Messages
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.messages (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id   UUID NOT NULL REFERENCES %s.conversations(id) ON DELETE CASCADE,
      role              VARCHAR(20) NOT NULL CHECK (role IN (''user'',''assistant'',''system'')),
      content           TEXT NOT NULL,
      device_id         UUID,
      tool_calls        JSONB NOT NULL DEFAULT ''[]'',
      reasoning         JSONB NOT NULL DEFAULT ''[]'',
      audio_url         VARCHAR(500),
      tokens_used       INTEGER NOT NULL DEFAULT 0,
      pending_action_id UUID,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema, v_schema);

  -- Retro-compat: garante a coluna em schemas de tenants pré-existentes
  EXECUTE format(
    'ALTER TABLE %s.messages ADD COLUMN IF NOT EXISTS pending_action_id UUID',
    v_schema
  );

  -- Pending actions (require approval)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.pending_actions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL,
      device_id       UUID NOT NULL,
      description     TEXT NOT NULL,
      impact_analysis TEXT,
      commands        JSONB NOT NULL,
      status          VARCHAR(20) NOT NULL DEFAULT ''pending'' CHECK (status IN (''pending'',''approved'',''rejected'',''executed'')),
      requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ,
      resolved_by     VARCHAR(100)
    )', v_schema);

  -- Device action history
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.device_history (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id         UUID NOT NULL,
      conversation_id   UUID,
      action_type       VARCHAR(100) NOT NULL,
      summary           TEXT NOT NULL,
      commands_executed JSONB NOT NULL DEFAULT ''[]'',
      result            VARCHAR(20) CHECK (result IN (''success'',''failed'',''partial'')),
      output            TEXT,
      executed_by       VARCHAR(100),
      executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Tenant settings (key-value store)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.settings (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT,
      encrypted  BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Default settings
  EXECUTE format('
    INSERT INTO %s.settings (key, value) VALUES
      (''alert_cpu_threshold'',    ''85''),
      (''alert_check_interval'',   ''60''),
      (''daily_report_hour'',      ''8''),
      (''daily_report_enabled'',   ''true''),
      (''require_approval_for'',   ''["reboot","delete","firewall","vpn"]''),
      (''language'',               ''pt-BR'')
    ON CONFLICT (key) DO NOTHING
  ', v_schema);

  -- Device Snapshots (fingerprint data captured by agent)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.device_snapshots (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id   UUID NOT NULL REFERENCES %s.devices(id) ON DELETE CASCADE,
      os_info     TEXT,
      disk_info   TEXT,
      services    TEXT,
      ports       TEXT,
      cpu_percent FLOAT,
      ram_percent FLOAT,
      disk_percent FLOAT,
      notes       TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema, v_schema);

  -- MCP Drivers (per-tenant registered MCP microservices)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.mcp_drivers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name             VARCHAR(100) UNIQUE NOT NULL,
      url              VARCHAR(500) NOT NULL,
      device_type      VARCHAR(50) NOT NULL,
      scopes           JSONB NOT NULL DEFAULT ''[]'',
      transport        VARCHAR(20) DEFAULT ''streamable-http'',
      health_endpoint  VARCHAR(100) DEFAULT ''/health'',
      mcp_endpoint     VARCHAR(100) DEFAULT ''/mcp'',
      status           VARCHAR(20) DEFAULT ''offline'',
      circuit_config   JSONB DEFAULT ''{
        "failure_threshold": 3,
        "recovery_timeout_s": 30,
        "call_timeout_s": 15
      }''::JSONB,
      active           BOOLEAN NOT NULL DEFAULT true,
      last_health_check TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Automations (cron-based skill execution)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.automations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                VARCHAR(255) NOT NULL,
      skill_id            UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
      target_devices      JSONB NOT NULL DEFAULT ''[]'',
      cron_expression     VARCHAR(50) NOT NULL,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      notification_target VARCHAR(100) DEFAULT ''default'',
      last_run_at         TIMESTAMPTZ,
      last_status         VARCHAR(50),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema);

  -- Tenant RAG Memories (Medium-Term Memory)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.tenant_memories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES %s.conversations(id) ON DELETE SET NULL,
      device_id       UUID REFERENCES %s.devices(id) ON DELETE CASCADE,
      memory_type     VARCHAR(50) NOT NULL CHECK (memory_type IN (''user_preference'',''device_fact'',''network_topology'',''misc'')),
      content         TEXT NOT NULL,
      embedding       VECTOR(1536),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema, v_schema, v_schema);

  -- WireGuard Interfaces
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.wireguard_interfaces (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id    UUID NOT NULL REFERENCES %s.devices(id) ON DELETE CASCADE,
      name         VARCHAR(100) NOT NULL,
      listen_port  INTEGER NOT NULL,
      private_key  TEXT NOT NULL,
      public_key   TEXT NOT NULL,
      comment      TEXT,
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(device_id, name)
    )', v_schema, v_schema);

  -- WireGuard IP Pools
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.wireguard_pools (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interface_id UUID NOT NULL REFERENCES %s.wireguard_interfaces(id) ON DELETE CASCADE,
      name         VARCHAR(100) NOT NULL,
      start_ip     VARCHAR(50) NOT NULL,
      end_ip       VARCHAR(50) NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', v_schema, v_schema);

  -- WireGuard Peers
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.wireguard_peers (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      interface_id       UUID NOT NULL REFERENCES %s.wireguard_interfaces(id) ON DELETE CASCADE,
      name               VARCHAR(100) NOT NULL,
      public_key         TEXT NOT NULL,
      private_key        TEXT,
      preshared_key      TEXT,
      allowed_address    TEXT NOT NULL,
      persistent_keepalive INTEGER,
      endpoint           TEXT,
      download_bandwidth BIGINT,
      upload_bandwidth   BIGINT,
      traffic_limit      BIGINT,
      download_usage     BIGINT NOT NULL DEFAULT 0,
      upload_usage       BIGINT NOT NULL DEFAULT 0,
      expire_time        TIMESTAMPTZ,
      comment            TEXT,
      active             BOOLEAN NOT NULL DEFAULT true,
      is_shared          BOOLEAN NOT NULL DEFAULT false,
      share_expire_time  TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(interface_id, name),
      UNIQUE(interface_id, public_key)
    )', v_schema, v_schema);

  -- WireGuard Server Peers (Concentrator)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %s.wireguard_server_peers (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id          UUID REFERENCES %s.devices(id) ON DELETE CASCADE,
      name               VARCHAR(100) NOT NULL,
      public_key         TEXT NOT NULL,
      private_key        TEXT,
      preshared_key      TEXT,
      ip_address         VARCHAR(50) NOT NULL,
      active             BOOLEAN NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name),
      UNIQUE(public_key),
      UNIQUE(ip_address)
    )', v_schema, v_schema);

  -- indexes
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_messages_conv ON %s.messages(conversation_id)', p_slug, v_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_device_history_device ON %s.device_history(device_id)', p_slug, v_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_pending_actions_status ON %s.pending_actions(status)', p_slug, v_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_conversations_channel ON %s.conversations(channel)', p_slug, v_schema);

  RAISE NOTICE 'Tenant schema "%" created successfully.', p_slug;
END;
$$ LANGUAGE plpgsql;

-- Helpful comment on how to use
COMMENT ON FUNCTION public.create_tenant_schema(TEXT) IS
  'Creates a complete isolated schema for a new tenant. Usage: SELECT public.create_tenant_schema(''tenant-slug'');';

-- =============================================================================
-- Retro-compat migrations — aplicam a schemas de tenants já existentes
-- Rodadas automaticamente a cada reaplicação deste init.sql
-- =============================================================================
DO $mig$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT schema_name FROM information_schema.schemata
    WHERE schema_name NOT IN ('public','pg_catalog','information_schema','pg_toast')
      AND schema_name NOT LIKE 'pg_temp_%'
      AND schema_name NOT LIKE 'pg_toast_temp_%'
  LOOP
    -- messages.pending_action_id (usada por api/src/routes/messages.js e agent/db.py)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = s AND table_name = 'messages'
    ) THEN
      EXECUTE format('ALTER TABLE %I.messages ADD COLUMN IF NOT EXISTS pending_action_id UUID', s);
    END IF;
  END LOOP;
END
$mig$;
