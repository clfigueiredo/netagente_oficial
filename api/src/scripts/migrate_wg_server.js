require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('Adding wg_subnet to public.tenants...');
        await client.query(`
            ALTER TABLE public.tenants 
            ADD COLUMN IF NOT EXISTS wg_subnet VARCHAR(20)
        `);

        const res = await client.query(`SELECT slug FROM public.tenants`);
        const tenants = res.rows.map(r => r.slug);

        console.log(`Found ${tenants.length} tenants. Adding wireguard_server_peers...`);

        for (const tenant of tenants) {
            const schema = tenant;

            await client.query(`
                CREATE TABLE IF NOT EXISTS "${schema}".wireguard_server_peers (
                  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  device_id          UUID REFERENCES "${schema}".devices(id) ON DELETE CASCADE,
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
                )
            `);
            console.log(`✅ wireguard_server_peers added to schema "${schema}"`);
        }

        await client.query('COMMIT');
        console.log('Migration completed successfully!');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
