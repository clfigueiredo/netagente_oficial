DO $$ 
DECLARE
    s_name TEXT;
BEGIN
    FOR s_name IN 
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public') AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%'
    LOOP
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.automations (
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
            )', s_name);
        
        RAISE NOTICE 'Table automations created in schema %', s_name;
    END LOOP;
END $$;
