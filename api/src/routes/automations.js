const express = require('express');
const prisma = require('../db/prisma');

const router = express.Router();

// Helper to escape schema name
const escapeId = (id) => `"${id.replace(/"/g, '""')}"`;

// GET /automations - List all
router.get('/', async (req, res, next) => {
    try {
        const schema = escapeId(req.tenantSchema);
        const results = await prisma.$queryRawUnsafe(`
            SELECT a.*, s.display_name as skill_name, s.category as skill_category
            FROM ${schema}.automations a
            JOIN public.skills s ON a.skill_id = s.id
            ORDER BY a.created_at DESC
        `);
        results.forEach(r => {
            if (typeof r.target_devices === 'string') {
                try { r.target_devices = JSON.parse(r.target_devices); } catch (e) { r.target_devices = []; }
            }
        });
        res.json(results);
    } catch (err) { next(err); }
});

// POST /automations - Create
router.post('/', async (req, res, next) => {
    try {
        const schema = escapeId(req.tenantSchema);
        const { name, skill_id, target_devices, cron_expression, notification_target } = req.body;

        if (!name || !skill_id || !cron_expression) {
            return res.status(400).json({ error: 'name, skill_id and cron_expression are required' });
        }

        const result = await prisma.$queryRawUnsafe(`
            INSERT INTO ${schema}.automations 
            (name, skill_id, target_devices, cron_expression, notification_target) 
            VALUES ($1, $2::uuid, $3::jsonb, $4, $5)
            RETURNING *
        `, name, skill_id, JSON.stringify(target_devices || []), cron_expression, notification_target || 'default');

        if (result.length > 0 && typeof result[0].target_devices === 'string') {
            try { result[0].target_devices = JSON.parse(result[0].target_devices); } catch (e) { }
        }
        res.status(201).json(result[0]);
    } catch (err) { next(err); }
});

// PUT /automations/:id - Update
router.put('/:id', async (req, res, next) => {
    try {
        const schema = escapeId(req.tenantSchema);
        const { id } = req.params;
        const { name, target_devices, cron_expression, is_active, notification_target } = req.body;

        const result = await prisma.$queryRawUnsafe(`
            UPDATE ${schema}.automations 
            SET name = COALESCE($1, name),
                target_devices = COALESCE($2::jsonb, target_devices),
                cron_expression = COALESCE($3, cron_expression),
                is_active = COALESCE($4::boolean, is_active),
                notification_target = COALESCE($5, notification_target),
                updated_at = NOW()
            WHERE id = $6::uuid
            RETURNING *
        `, name, target_devices ? JSON.stringify(target_devices) : null, cron_expression, is_active, notification_target, id);

        if (!result.length) return res.status(404).json({ error: 'Automation not found' });
        if (typeof result[0].target_devices === 'string') {
            try { result[0].target_devices = JSON.parse(result[0].target_devices); } catch (e) { }
        }
        res.json(result[0]);
    } catch (err) { next(err); }
});

// DELETE /automations/:id
router.delete('/:id', async (req, res, next) => {
    try {
        const schema = escapeId(req.tenantSchema);
        await prisma.$queryRawUnsafe(`
            DELETE FROM ${schema}.automations WHERE id = $1::uuid
        `, req.params.id);
        res.status(204).end();
    } catch (err) { next(err); }
});

module.exports = router;
