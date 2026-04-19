const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function migrateWireGuard() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Obter todos os tenants existentes
        const res = await client.query('SELECT slug FROM public.tenants');
        const tenants = res.rows;

        console.log(`Encontrados ${tenants.length} tenants para migrar.`);

        for (const tenant of tenants) {
            const v_schema = `"${tenant.slug}"`;
            console.log(`Migrando tenant: ${tenant.slug}`);

            // WireGuard Interfaces
            await client.query(`
        CREATE TABLE IF NOT EXISTS ${v_schema}.wireguard_interfaces (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          device_id    UUID NOT NULL REFERENCES ${v_schema}.devices(id) ON DELETE CASCADE,
          name         VARCHAR(100) NOT NULL,
          listen_port  INTEGER NOT NULL,
          private_key  TEXT NOT NULL,
          public_key   TEXT NOT NULL,
          comment      TEXT,
          active       BOOLEAN NOT NULL DEFAULT true,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(device_id, name)
        )
      `);

            // WireGuard IP Pools
            await client.query(`
        CREATE TABLE IF NOT EXISTS ${v_schema}.wireguard_pools (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          interface_id UUID NOT NULL REFERENCES ${v_schema}.wireguard_interfaces(id) ON DELETE CASCADE,
          name         VARCHAR(100) NOT NULL,
          start_ip     VARCHAR(50) NOT NULL,
          end_ip       VARCHAR(50) NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

            // WireGuard Peers
            await client.query(`
        CREATE TABLE IF NOT EXISTS ${v_schema}.wireguard_peers (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          interface_id       UUID NOT NULL REFERENCES ${v_schema}.wireguard_interfaces(id) ON DELETE CASCADE,
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
        )
      `);

            console.log(`  -> Tabelas do WireGuard criadas com sucesso.`);
        }

        await client.query('COMMIT');
        console.log('Migração concluída com sucesso!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Erro durante a migração:', e);
    } finally {
        client.release();
        pool.end();
    }
}

migrateWireGuard();
