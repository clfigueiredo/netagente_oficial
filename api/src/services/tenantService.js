const bcrypt = require('bcrypt');
const prisma = require('../db/prisma');

/**
 * Creates a tenant: record in public.tenants, PostgreSQL schema via stored function,
 * and first admin user inside the tenant schema.
 */
const createTenant = async ({ name, slug, adminEmail, adminPassword, planId }) => {
    // 1. Create tenant record
    const tenant = await prisma.tenant.create({
        data: { name, slug, adminEmail, planId: planId ?? null }
    });

    // 2. Create PostgreSQL schema with all tables via stored function
    await prisma.$executeRawUnsafe(
        `SELECT public.create_tenant_schema($1)`, slug
    );

    // 3. Create first admin user in tenant schema
    const hash = await bcrypt.hash(adminPassword, 12);
    await prisma.$executeRawUnsafe(
        `INSERT INTO "${slug}".users (email, password_hash, name, role)
     VALUES ($1, $2, 'Admin', 'admin')`,
        adminEmail, hash
    );

    return tenant;
};

module.exports = { createTenant };
