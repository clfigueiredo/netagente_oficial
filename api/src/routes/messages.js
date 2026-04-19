const express = require('express');
const axios = require('axios');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');
const { emitToTenant } = require('../socket');

const router = express.Router();

// POST /messages — send message via web chat (routes to agent)
router.post('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { conversationId, content, deviceId } = req.body;

        if (!conversationId || !content) {
            return next(createError(400, 'conversationId e content são obrigatórios'));
        }

        // Save user message
        const msgs = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".messages (conversation_id, role, content, device_id)
       VALUES ($1::uuid, 'user', $2, $3::uuid)
       RETURNING id, role, content, created_at`,
            conversationId, content, deviceId ?? null
        );

        await prisma.$executeRawUnsafe(
            `UPDATE "${schema}".conversations SET last_activity_at = NOW() WHERE id = $1::uuid`,
            conversationId
        );

        const tenant = await prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: { slug: true, evolutionInstance: true, gptModel: true }
        });

        emitToTenant(tenant.slug, 'agent:thinking', { conversationId });

        const agentResponse = await axios.post(
            `${process.env.AGENT_URL || 'http://localhost:8000'}/chat`,
            {
                tenant_slug: tenant.slug,
                tenant_schema: schema,          // ← DB schema = socket room key
                conversation_id: conversationId,
                message: content,
                device_id: deviceId,
                channel: 'web',
                user_id: req.user.userId
            },
            { timeout: 120_000 }
        );

        const assistantContent = agentResponse.data.response;
        const toolCalls = agentResponse.data.tool_calls ?? [];
        const reasoning = agentResponse.data.reasoning ?? [];
        const tokensUsed = agentResponse.data.tokens_used ?? 0;
        const pendingActionData = agentResponse.data.pending_action ?? null;
        // device resolved by the agent (e.g. via fuzzy name match in the message)
        const resolvedDeviceId = agentResponse.data.resolved_device_id ?? deviceId ?? null;

        // ── Persist resolved device_id back to the user message ──────────────
        // This ensures subsequent messages in the same conversation can recover it
        if (resolvedDeviceId && !deviceId) {
            await prisma.$executeRawUnsafe(
                `UPDATE "${schema}".messages SET device_id = $1::uuid WHERE id = $2::uuid`,
                resolvedDeviceId, msgs[0].id
            ).catch(() => { }); // non-critical, ignore failures
        }


        // ── Save pending_action to DB if agent proposed one ──────────────
        let pendingActionId = null;
        if (pendingActionData) {
            // Build impact_analysis from available data (action_type + risk_level don't exist as columns)
            const impactAnalysis = [
                pendingActionData.action_type ? `Tipo: ${pendingActionData.action_type}` : null,
                pendingActionData.risk_level ? `Risco: ${pendingActionData.risk_level}` : null,
            ].filter(Boolean).join(' | ') || null;

            const pa = await prisma.$queryRawUnsafe(
                `INSERT INTO "${schema}".pending_actions
                 (conversation_id, device_id, description, impact_analysis, commands, status)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, 'pending')
                 RETURNING id`,
                conversationId,
                resolvedDeviceId ?? null,
                pendingActionData.description,
                impactAnalysis,
                JSON.stringify(pendingActionData.commands ?? []),
            );
            pendingActionId = pa[0]?.id ?? null;

            emitToTenant(schema, 'agent:pending_action', {
                conversationId,
                pendingAction: { ...pendingActionData, id: pendingActionId }
            });
        }

        if (toolCalls.length > 0) {
            emitToTenant(schema, 'agent:tool_calls', { conversationId, toolCalls, reasoning });
        }

        // Save assistant message (with pending_action_id column)
        const assistantMsgs = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".messages
             (conversation_id, role, content, device_id, tool_calls, reasoning, tokens_used, pending_action_id)
             VALUES ($1::uuid, 'assistant', $2, $3::uuid, $4::jsonb, $5::jsonb, $6, $7::uuid)
             RETURNING id, role, content, tool_calls, reasoning, tokens_used, pending_action_id, created_at`,
            conversationId, assistantContent, resolvedDeviceId ?? null,
            JSON.stringify(toolCalls), JSON.stringify(reasoning), tokensUsed,
            pendingActionId
        );

        emitToTenant(schema, 'agent:response', {
            conversationId,
            message: assistantMsgs[0]
        });

        res.json({
            userMessage: msgs[0],
            assistantMessage: {
                ...assistantMsgs[0],
                pending_action: pendingActionData ? { ...pendingActionData, id: pendingActionId } : null,
            }
        });
    } catch (err) {
        const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
            (err.message || '').toLowerCase().includes('timeout');
        const errorMsg = err.code === 'ECONNREFUSED'
            ? 'Agente Python indisponível'
            : isTimeout
                ? 'Tempo limite atingido — verifique a conectividade com o dispositivo'
                : err.response?.data?.detail || 'Erro interno no agente';

        if (req.tenantSchema) {
            emitToTenant(req.tenantSchema, 'agent:error', {
                conversationId: req.body?.conversationId,
                error: errorMsg
            });
        }
        if (err.code === 'ECONNREFUSED') {
            return next(createError(503, 'Agente Python indisponível'));
        }
        next(err);
    }
});

// GET /messages/:conversationId — paginated messages
router.get('/:conversationId', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { limit = 50, before } = req.query;

        // Build parameterized query — never interpolate `before` directly
        const params = [req.params.conversationId, Number(limit)];
        let beforeFilter = '';
        if (before) {
            params.push(before);
            beforeFilter = `AND m.created_at < $${params.length}::timestamptz`;
        }

        const rows = await prisma.$queryRawUnsafe(
            `SELECT
               m.id, m.role, m.content, m.device_id, m.tool_calls, m.reasoning, m.audio_url,
               m.tokens_used, m.pending_action_id, m.created_at,
               CASE WHEN pa.id IS NOT NULL THEN json_build_object(
                   'id',           pa.id,
                   'description',  pa.description,
                   'commands',     pa.commands,
                   'status',       pa.status,
                   'action_type',  (pa.impact_analysis::text),
                   'risk_level',   'medium'
               ) ELSE NULL END AS pending_action
             FROM "${schema}".messages m
             LEFT JOIN "${schema}".pending_actions pa ON pa.id = m.pending_action_id
             WHERE m.conversation_id = $1::uuid ${beforeFilter}
             ORDER BY m.created_at DESC
             LIMIT $2`,
            ...params
        );


        res.json(rows.reverse());
    } catch (err) { next(err); }
});

// DELETE /messages/:conversationId — clear history for a conversation
router.delete('/:conversationId', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const convId = req.params.conversationId;

        await prisma.$executeRawUnsafe(
            `DELETE FROM "${schema}".messages WHERE conversation_id = $1::uuid`,
            convId
        );
        res.json({ success: true, message: 'Histórico apagado' });
    } catch (err) { next(err); }
});

module.exports = router;
