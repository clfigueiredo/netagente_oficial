const express = require('express');
const { requireSuperAdmin } = require('../../middleware/auth');
const prisma = require('../../db/prisma');

const router = express.Router();
router.use(requireSuperAdmin);

// GET /admin/knowledge
router.get('/', async (req, res, next) => {
    try {
        const { category, source, limit = 50, offset = 0 } = req.query;
        const where = {};
        if (category) where.category = category;
        if (source) where.source = source;

        const items = await prisma.$queryRawUnsafe(
            `SELECT id, title, category, device_type, source, quality_score, use_count, created_at
       FROM public.knowledge_base
       WHERE ($1::text IS NULL OR category = $1)
         AND ($2::text IS NULL OR source = $2)
       ORDER BY quality_score DESC, use_count DESC
       LIMIT $3 OFFSET $4`,
            category ?? null, source ?? null, Number(limit), Number(offset)
        );
        res.json(items);
    } catch (err) { next(err); }
});

// DELETE /admin/knowledge/:id
router.delete('/:id', async (req, res, next) => {
    try {
        await prisma.$executeRawUnsafe(
            `DELETE FROM public.knowledge_base WHERE id = $1`, req.params.id
        );
        res.status(204).send();
    } catch (err) { next(err); }
});

// PATCH /admin/knowledge/:id — adjust quality score
router.patch('/:id', async (req, res, next) => {
    try {
        const { qualityScore } = req.body;
        const rows = await prisma.$queryRawUnsafe(
            `UPDATE public.knowledge_base SET quality_score = $1 WHERE id = $2 RETURNING id, title, quality_score`,
            Number(qualityScore), req.params.id
        );
        res.json(rows[0]);
    } catch (err) { next(err); }
});

module.exports = router;
