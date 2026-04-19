/**
 * Migration: WireGuard VPN v2 — Per-tenant interface columns
 * Adds wg_port, wg_private_key, wg_public_key to public.tenants
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

async function migrate() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const client = await pool.connect();
    try {
        console.log('🔧 WireGuard V2 Migration: Adding per-tenant columns...');

        await client.query(`
            ALTER TABLE public.tenants
            ADD COLUMN IF NOT EXISTS wg_port INTEGER,
            ADD COLUMN IF NOT EXISTS wg_private_key TEXT,
            ADD COLUMN IF NOT EXISTS wg_public_key TEXT
        `);

        console.log('✅ Columns wg_port, wg_private_key, wg_public_key added to public.tenants');

        // Ensure wireguard_server_peers table exists in all tenant schemas
        const { rows: tenants } = await client.query(`SELECT slug FROM public.tenants`);
        for (const t of tenants) {
            const schema = t.slug;
            await client.query(`
                CREATE TABLE IF NOT EXISTS "${schema}".wireguard_server_peers (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    device_id UUID REFERENCES "${schema}".devices(id) ON DELETE SET NULL,
                    name VARCHAR(100) NOT NULL,
                    public_key TEXT NOT NULL,
                    private_key TEXT,
                    preshared_key TEXT,
                    ip_address VARCHAR(50) NOT NULL,
                    os_type VARCHAR(20) DEFAULT 'mikrotik',
                    active BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(name),
                    UNIQUE(public_key)
                )
            `);
            console.log(`  ✅ Schema "${schema}": wireguard_server_peers OK`);
        }

        console.log('🚀 Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration error:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(() => process.exit(1));
