const express = require('express');
const prisma = require('../db/prisma');

const router = express.Router();

/**
 * GET /skills
 * List all global active skills, annotated with whether this tenant has disabled them.
 */
router.get('/', async (req, res, next) => {
    try {
        const tenantSlug = req.tenantSlug;

        // All global active skills
        const skills = await prisma.$queryRaw`
            SELECT s.*,
                   COALESCE(sto.active, true) AS enabled
            FROM public.skills s
            LEFT JOIN public.skill_tenant_overrides sto
              ON sto.skill_id = s.id AND sto.tenant_id = ${tenantSlug}
            WHERE s.active = true
            ORDER BY s.category, s.display_name
        `;

        res.json(skills);
    } catch (err) { next(err); }
});

/**
 * POST /skills/:id/toggle
 * Enable or disable a skill for this tenant.
 * Body: { enabled: boolean }
 */
router.post('/:id/toggle', async (req, res, next) => {
    try {
        const tenantSlug = req.tenantSlug;
        const { id } = req.params;
        const { enabled } = req.body; // true = tenant wants it ON

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }

        if (enabled) {
            // Remove override → skill goes back to global default (active)
            await prisma.$executeRaw`
                DELETE FROM public.skill_tenant_overrides
                WHERE skill_id = ${id}::uuid AND tenant_id = ${tenantSlug}
            `;
        } else {
            // Upsert override with active=false
            await prisma.$executeRaw`
                INSERT INTO public.skill_tenant_overrides (skill_id, tenant_id, active)
                VALUES (${id}::uuid, ${tenantSlug}, false)
                ON CONFLICT (skill_id, tenant_id)
                DO UPDATE SET active = false
            `;
        }

        res.json({ id, enabled });
    } catch (err) { next(err); }
});

module.exports = router;
