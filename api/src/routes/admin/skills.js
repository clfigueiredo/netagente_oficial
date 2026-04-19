const express = require('express');
const { requireSuperAdmin } = require('../../middleware/auth');
const prisma = require('../../db/prisma');

const router = express.Router();
router.use(requireSuperAdmin);

// GET /admin/skills
router.get('/', async (req, res, next) => {
    try {
        const skills = await prisma.$queryRaw`
            SELECT s.*,
                   CAST((SELECT COUNT(*) FROM public.skill_tenant_overrides sto WHERE sto.skill_id = s.id AND sto.active = false) AS int) AS disabled_count
            FROM public.skills s
            ORDER BY s.category, s.display_name
        `;
        // Convert any remaining BigInt fields
        const safe = JSON.parse(JSON.stringify(skills, (_, v) => typeof v === 'bigint' ? Number(v) : v));
        res.json(safe);
    } catch (err) { next(err); }
});

// POST /admin/skills — create global skill
router.post('/', async (req, res, next) => {
    try {
        // Accept both camelCase and snake_case from frontend
        const name = req.body.name;
        const displayName = req.body.display_name || req.body.displayName;
        const description = req.body.description;
        const category = req.body.category;
        const deviceType = req.body.device_type ?? req.body.deviceType ?? null;
        const promptTemplate = req.body.prompt_template ?? req.body.promptTemplate ?? null;
        const steps = req.body.steps ?? [];
        const examples = req.body.examples ?? [];

        if (!name || !displayName || !description) {
            return res.status(400).json({ error: 'name, display_name e description são obrigatórios' });
        }

        const skill = await prisma.$queryRaw`
            INSERT INTO public.skills (name, display_name, description, category, device_type, prompt_template, steps, examples)
            VALUES (${name}, ${displayName}, ${description}, ${category}, ${deviceType ?? null},
                    ${promptTemplate ?? null}, ${JSON.stringify(steps ?? [])}::jsonb, ${JSON.stringify(examples ?? [])}::jsonb)
            RETURNING *
        `;
        res.status(201).json(skill[0]);
    } catch (err) { next(err); }
});

// PATCH /admin/skills/:id — update global skill
router.patch('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { displayName, description, promptTemplate, steps, examples, active, version } = req.body;
        const updates = [];
        const values = [];
        let i = 1;

        if (displayName !== undefined) { updates.push(`display_name = $${i++}`); values.push(displayName); }
        if (description !== undefined) { updates.push(`description = $${i++}`); values.push(description); }
        if (promptTemplate !== undefined) { updates.push(`prompt_template = $${i++}`); values.push(promptTemplate); }
        if (steps !== undefined) { updates.push(`steps = $${i++}::jsonb`); values.push(JSON.stringify(steps)); }
        if (examples !== undefined) { updates.push(`examples = $${i++}::jsonb`); values.push(JSON.stringify(examples)); }
        if (active !== undefined) { updates.push(`active = $${i++}`); values.push(active); }
        if (version !== undefined) { updates.push(`version = $${i++}`); values.push(version); }

        if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

        values.push(id);
        const rows = await prisma.$queryRawUnsafe(
            `UPDATE public.skills SET ${updates.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            ...values
        );
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// DELETE /admin/skills/:id
router.delete('/:id', async (req, res, next) => {
    try {
        await prisma.$executeRaw`DELETE FROM public.skills WHERE id = ${req.params.id}::uuid`;
        res.json({ deleted: true });
    } catch (err) { next(err); }
});

module.exports = router;
