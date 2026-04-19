-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Stored function to create tenant schema
CREATE OR REPLACE FUNCTION public.create_tenant_schema(tenant_slug TEXT)
RETURNS VOID AS $fn$
BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(255),
        role VARCHAR(20) DEFAULT ''operator'',
        active BOOLEAN DEFAULT true,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.devices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port INTEGER DEFAULT 22,
        username VARCHAR(100) NOT NULL,
        password_encrypted TEXT,
        description TEXT,
        location VARCHAR(255),
        tags JSONB DEFAULT ''[]''::JSONB,
        active BOOLEAN DEFAULT true,
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.conversations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel VARCHAR(20) DEFAULT ''web'',
        whatsapp_number VARCHAR(20),
        web_user_id UUID,
        title VARCHAR(255),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        last_activity_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        device_id UUID,
        tool_calls JSONB DEFAULT ''[]''::JSONB,
        reasoning JSONB DEFAULT ''[]''::JSONB,
        audio_url TEXT,
        tokens_used INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.pending_actions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID,
        device_id UUID,
        description TEXT NOT NULL,
        impact_analysis TEXT,
        commands JSONB DEFAULT ''[]''::JSONB,
        status VARCHAR(20) DEFAULT ''pending'',
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.whatsapp_users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        number VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255),
        role VARCHAR(20) DEFAULT ''operator'',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);

    EXECUTE format('INSERT INTO %I.settings (key, value) VALUES
        (''alert_cpu_threshold'', ''80''),
        (''alert_check_interval'', ''300''),
        (''daily_report_hour'', ''8''),
        (''daily_report_enabled'', ''true''),
        (''require_approval_for'', ''destructive''),
        (''language'', ''pt-BR'')
    ON CONFLICT (key) DO NOTHING', tenant_slug);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.mcp_drivers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) UNIQUE NOT NULL,
        url VARCHAR(500) NOT NULL,
        device_type VARCHAR(50) NOT NULL,
        scopes JSONB DEFAULT ''[]''::JSONB,
        transport VARCHAR(20) DEFAULT ''streamable-http'',
        health_endpoint VARCHAR(100) DEFAULT ''/health'',
        mcp_endpoint VARCHAR(100) DEFAULT ''/mcp'',
        status VARCHAR(20) DEFAULT ''offline'',
        circuit_config JSONB DEFAULT ''{"failure_threshold": 3, "recovery_timeout_s": 30, "call_timeout_s": 15}''::JSONB,
        active BOOLEAN DEFAULT true,
        last_health_check TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.automations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
        target_devices JSONB DEFAULT ''[]''::JSONB,
        cron_expression VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        notification_target VARCHAR(100) DEFAULT ''default'',
        last_run_at TIMESTAMPTZ,
        last_status VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )', tenant_slug);
END;
$fn$ LANGUAGE plpgsql;
