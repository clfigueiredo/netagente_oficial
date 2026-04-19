const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { createError } = require('../../lib/errors');
const { requireSuperAdmin } = require('../../middleware/auth');
const prisma = require('../../db/prisma');
const tenantService = require('../../services/tenantService');

const router = express.Router();
router.use(requireSuperAdmin);

const tenantSchema = z.object({
    name: z.string().min(2),
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(8),
    planId: z.string().uuid().optional()
});

// GET /admin/tenants
router.get('/', async (req, res, next) => {
    try {
        const tenants = await prisma.tenant.findMany({
            include: { plan: { select: { name: true } } },
            orderBy: { createdAt: 'asc' }
        });
        res.json(tenants);
    } catch (err) { next(err); }
});

// POST /admin/tenants — create tenant + schema + first admin user
router.post('/', async (req, res, next) => {
    try {
        const data = tenantSchema.parse(req.body);
        const tenant = await tenantService.createTenant(data);
        res.status(201).json(tenant);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

// PATCH /admin/tenants/:id
router.patch('/:id', async (req, res, next) => {
    try {
        const allowed = ['name', 'active', 'planId', 'evolutionInstance', 'evolutionKey', 'gptModel'];
        const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
        const tenant = await prisma.tenant.update({ where: { id: req.params.id }, data });
        res.json(tenant);
    } catch (err) { next(err); }
});

module.exports = router;
