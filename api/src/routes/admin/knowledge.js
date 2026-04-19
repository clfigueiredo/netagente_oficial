const express = require('express');
const { requireSuperAdmin } = require('../../middleware/auth');
const prisma = require('../../db/prisma');

const router = express.Router();
router.use(requireSuperAdmin);

// GET /admin/knowledge — list all entries
router.get('/', async (req, res, next) => {
    try {
        const { category, source, device_type, search, limit = 100, offset = 0 } = req.query;
        const items = await prisma.$queryRawUnsafe(
            `SELECT id, title, content, category, device_type, source, quality_score, use_count,
                    (embedding IS NOT NULL) as has_embedding, created_at
             FROM public.knowledge_base
             WHERE ($1::text IS NULL OR category = $1)
               AND ($2::text IS NULL OR source = $2)
               AND ($3::text IS NULL OR device_type = $3)
               AND ($4::text IS NULL OR title ILIKE '%' || $4 || '%' OR content ILIKE '%' || $4 || '%')
             ORDER BY created_at DESC
             LIMIT $5 OFFSET $6`,
            category ?? null, source ?? null, device_type ?? null, search ?? null,
            Number(limit), Number(offset)
        );
        const countResult = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int as total FROM public.knowledge_base
             WHERE ($1::text IS NULL OR category = $1)
               AND ($2::text IS NULL OR source = $2)
               AND ($3::text IS NULL OR device_type = $3)
               AND ($4::text IS NULL OR title ILIKE '%' || $4 || '%' OR content ILIKE '%' || $4 || '%')`,
            category ?? null, source ?? null, device_type ?? null, search ?? null
        );
        res.json({ items, total: countResult[0]?.total || 0 });
    } catch (err) { next(err); }
});

// GET /admin/knowledge/:id — get single entry
router.get('/:id', async (req, res, next) => {
    try {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, title, content, category, device_type, source, quality_score, use_count,
                    (embedding IS NOT NULL) as has_embedding, created_at
             FROM public.knowledge_base WHERE id = $1::uuid`,
            req.params.id
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// POST /admin/knowledge — create new entry
router.post('/', async (req, res, next) => {
    try {
        const { title, content, category, device_type, source } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO public.knowledge_base (title, content, category, device_type, source)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, title, content, category, device_type, source, quality_score, use_count, created_at`,
            title, content, category || null, device_type || null, source || 'manual'
        );
        res.status(201).json(rows[0]);
    } catch (err) { next(err); }
});

// PUT /admin/knowledge/:id — update entry (clears embedding to be re-generated)
router.put('/:id', async (req, res, next) => {
    try {
        const { title, content, category, device_type, source, quality_score } = req.body;
        if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

        const rows = await prisma.$queryRawUnsafe(
            `UPDATE public.knowledge_base
             SET title = $1, content = $2, category = $3, device_type = $4,
                 source = $5, quality_score = $6, embedding = NULL
             WHERE id = $7::uuid
             RETURNING id, title, content, category, device_type, source, quality_score, use_count, created_at`,
            title, content, category || null, device_type || null,
            source || 'manual', Number(quality_score ?? 0.5), req.params.id
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// PATCH /admin/knowledge/:id — adjust quality score only
router.patch('/:id', async (req, res, next) => {
    try {
        const { qualityScore } = req.body;
        const rows = await prisma.$queryRawUnsafe(
            `UPDATE public.knowledge_base SET quality_score = $1 WHERE id = $2::uuid
             RETURNING id, title, quality_score`,
            Number(qualityScore), req.params.id
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// DELETE /admin/knowledge/:id
router.delete('/:id', async (req, res, next) => {
    try {
        await prisma.$executeRawUnsafe(
            `DELETE FROM public.knowledge_base WHERE id = $1::uuid`, req.params.id
        );
        res.status(204).send();
    } catch (err) { next(err); }
});

// POST /admin/knowledge/generate-embeddings — trigger embedding generation for entries missing them
router.post('/generate-embeddings', async (req, res, next) => {
    try {
        // Call the Python agent to generate embeddings
        const fetch = (await import('node-fetch')).default;
        const agentUrl = process.env.AGENT_URL || 'http://localhost:8000';
        const resp = await fetch(`${agentUrl}/admin/generate-embeddings`, { method: 'POST' });
        const data = await resp.json();
        res.json(data);
    } catch (err) { next(err); }
});

module.exports = router;
