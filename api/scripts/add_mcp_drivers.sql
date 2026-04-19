-- Migration: Add mcp_drivers table to existing tenant schemas
-- Run once to add MCP driver registry to all existing tenants
-- Usage: psql -U postgres -d agente -f add_mcp_drivers.sql

DO $$
DECLARE
    _schema TEXT;
BEGIN
    FOR _schema IN
        SELECT schema_name FROM information_schema.schemata
        WHERE schema_name NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
    LOOP
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
        )', _schema);

        RAISE NOTICE 'Added mcp_drivers table to schema: %', _schema;
    END LOOP;
END $$;
