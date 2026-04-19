const express = require('express');
const { z } = require('zod');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');

const router = express.Router();

// GET /conversations  — list tenant conversations
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { channel, limit = 50, offset = 0 } = req.query;

        const channelFilter = channel ? `AND channel = '${channel}'` : '';

        const rows = await prisma.$queryRawUnsafe(
            `SELECT 
                c.id, c.channel, c.whatsapp_number, c.web_user_id, c.title, c.started_at, c.last_activity_at,
                (
                    SELECT m.content 
                    FROM "${schema}".messages m 
                    WHERE m.conversation_id = c.id AND m.content IS NOT NULL AND m.content != ''
                    ORDER BY m.created_at DESC 
                    LIMIT 1
                ) as preview
             FROM "${schema}".conversations c
             WHERE 1=1 ${channelFilter}
             ORDER BY c.last_activity_at DESC
             LIMIT $1 OFFSET $2`,
            Number(limit), Number(offset)
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /conversations/:id — with messages
router.get('/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;

        const convs = await prisma.$queryRawUnsafe(
            `SELECT id, channel, whatsapp_number, web_user_id, title, started_at, last_activity_at
       FROM "${schema}".conversations WHERE id = $1::uuid`,
            req.params.id
        );
        if (!convs[0]) return next(createError(404, 'Conversa não encontrada'));

        const messages = await prisma.$queryRawUnsafe(
            `SELECT id, role, content, device_id, tool_calls, reasoning, audio_url, tokens_used, created_at
       FROM "${schema}".messages
       WHERE conversation_id = $1::uuid
       ORDER BY created_at`,
            req.params.id
        );

        res.json({ ...convs[0], messages });
    } catch (err) { next(err); }
});

// POST /conversations — create new web chat conversation
router.post('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".conversations (channel, web_user_id)
       VALUES ('web', $1::uuid)
       RETURNING id, channel, web_user_id, started_at, last_activity_at`,
            req.user.userId
        );
        res.status(201).json(rows[0]);
    } catch (err) { next(err); }
});

// DELETE /conversations/:id — remove conversation and its messages
router.delete('/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        // The foreign key constraint ON DELETE CASCADE should handle the messages
        // But to be safe, we can manually delete the messages first or just delete the conversation
        // Assuming there is a ON DELETE CASCADE on the messages table referencing conversation_id
        await prisma.$queryRawUnsafe(
            `DELETE FROM "${schema}".conversations WHERE id = $1::uuid`,
            req.params.id
        );
        res.status(204).end();
    } catch (err) { next(err); }
});

module.exports = router;
