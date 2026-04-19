const express = require('express');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');
const { emitToTenant } = require('../socket');

const router = express.Router();

// GET /pending-actions
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { status = 'pending' } = req.query;
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, conversation_id, device_id, description, impact_analysis, commands, status, requested_at
       FROM "${schema}".pending_actions
       WHERE status = $1
       ORDER BY requested_at DESC`,
            status
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /pending-actions/:id/approve
router.post('/:id/approve', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const resolver = req.user.userId;

        const rows = await prisma.$queryRawUnsafe(
            `UPDATE "${schema}".pending_actions
       SET status = 'approved', resolved_at = NOW(), resolved_by = $2
       WHERE id = $1::uuid AND status = 'pending'
       RETURNING *`,
            req.params.id, String(resolver)
        );

        if (!rows[0]) return next(createError(404, 'Ação não encontrada ou já resolvida'));

        // Notify agent to execute
        emitToTenant(schema, 'action:approved', { actionId: req.params.id });

        res.json(rows[0]);
    } catch (err) { next(err); }
});

// POST /pending-actions/:id/reject
router.post('/:id/reject', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const resolver = req.user.userId;

        const rows = await prisma.$queryRawUnsafe(
            `UPDATE "${schema}".pending_actions
       SET status = 'rejected', resolved_at = NOW(), resolved_by = $2
       WHERE id = $1::uuid AND status = 'pending'
       RETURNING *`,
            req.params.id, String(resolver)
        );

        if (!rows[0]) return next(createError(404, 'Ação não encontrada ou já resolvida'));

        emitToTenant(schema, 'action:rejected', { actionId: req.params.id });

        res.status(200).json(rows[0]);
    } catch (err) { next(err); }
});

module.exports = router;
