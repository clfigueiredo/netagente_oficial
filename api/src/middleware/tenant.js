const prisma = require('../db/prisma');
const { createError } = require('../lib/errors');

/**
 * Resolves the tenant schema from the JWT payload and validates
 * that the tenant exists and is active. Attaches req.tenantSchema.
 * Skips for superadmin routes that don't need a tenant context.
 */
const tenantMiddleware = async (req, res, next) => {
    try {
        // Superadmin: resolve tenant from header or auto-select first active
        if (req.user?.isSuperAdmin) {
            const slugHeader = req.headers['x-tenant-slug'];
            let tenant;

            if (slugHeader) {
                tenant = await prisma.tenant.findUnique({
                    where: { slug: slugHeader },
                    select: { id: true, slug: true, active: true }
                });
            }

            if (!tenant) {
                tenant = await prisma.tenant.findFirst({
                    where: { active: true },
                    select: { id: true, slug: true, active: true },
                    orderBy: { createdAt: 'asc' }
                });
            }

            if (tenant) {
                req.tenantSchema = tenant.slug;
                req.tenantId = tenant.id;
            }
            return next();
        }

        const { tenantId } = req.user;
        if (!tenantId) return next(createError(401, 'Tenant não identificado'));

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, slug: true, active: true }
        });

        if (!tenant || !tenant.active) {
            return next(createError(403, 'Tenant inativo ou não encontrado'));
        }

        req.tenantSchema = tenant.slug;
        req.tenantId = tenant.id;
        next();
    } catch (err) {
        next(err);
    }
};

module.exports = { tenantMiddleware };
