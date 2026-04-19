const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../db/prisma');
const { createError } = require('../lib/errors');

const router = express.Router();
const SALT_ROUNDS = 12;

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
});

// POST /auth/login  — auto-discover tenant from email
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        // 1. Try platform_users (superadmin) first
        const platformUser = await prisma.platformUser.findUnique({
            where: { email }
        });

        if (platformUser) {
            const valid = await bcrypt.compare(password, platformUser.passwordHash);
            if (!valid) return next(createError(401, 'Credenciais inválidas'));

            // Find default tenant for superadmin context
            const defaultTenant = await prisma.tenant.findFirst({
                where: { active: true },
                orderBy: { createdAt: 'asc' }
            });

            const token = jwt.sign(
                {
                    userId: platformUser.id,
                    role: platformUser.role,
                    isSuperAdmin: true,
                    tenantId: defaultTenant?.id,
                    tenantSlug: defaultTenant?.slug
                },
                process.env.JWT_SECRET,
                { expiresIn: '8h' }
            );
            return res.json({
                token,
                user: { id: platformUser.id, email: platformUser.email, role: platformUser.role, isSuperAdmin: true },
                tenantSlug: defaultTenant?.slug || null
            });
        }

        // 2. Auto-discover: search ALL active tenants for this email
        const tenants = await prisma.tenant.findMany({
            where: { active: true },
            select: { id: true, slug: true }
        });

        let foundUser = null;
        let foundTenant = null;

        for (const tenant of tenants) {
            try {
                const users = await prisma.$queryRawUnsafe(
                    `SELECT id, email, name, role, password_hash FROM "${tenant.slug}".users WHERE email = $1 AND active = true LIMIT 1`,
                    email
                );
                if (users[0]) {
                    foundUser = users[0];
                    foundTenant = tenant;
                    break;
                }
            } catch {
                // Schema might not exist yet, skip
                continue;
            }
        }

        if (!foundUser) return next(createError(401, 'Credenciais inválidas'));

        const valid = await bcrypt.compare(password, foundUser.password_hash);
        if (!valid) return next(createError(401, 'Credenciais inválidas'));

        // Update last_login
        await prisma.$executeRawUnsafe(
            `UPDATE "${foundTenant.slug}".users SET last_login_at = NOW() WHERE id = $1`,
            foundUser.id
        );

        const token = jwt.sign(
            { userId: foundUser.id, role: foundUser.role, tenantId: foundTenant.id, tenantSlug: foundTenant.slug, isSuperAdmin: false },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: { id: foundUser.id, email: foundUser.email, name: foundUser.name, role: foundUser.role },
            tenantSlug: foundTenant.slug
        });
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

// POST /auth/refresh
router.post('/refresh', (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return next(createError(401, 'Token ausente'));

        // Allow refresh of expiring tokens (ignoring expiry)
        const payload = jwt.verify(req.headers.authorization.slice(7), process.env.JWT_SECRET, {
            ignoreExpiration: false
        });

        const token = jwt.sign(
            { userId: payload.userId, role: payload.role, tenantId: payload.tenantId, tenantSlug: payload.tenantSlug, isSuperAdmin: payload.isSuperAdmin },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );
        res.json({ token });
    } catch {
        next(createError(401, 'Token inválido'));
    }
});

module.exports = router;
