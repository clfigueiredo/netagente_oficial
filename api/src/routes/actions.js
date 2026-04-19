const express = require('express');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');
const { emitToTenant } = require('../socket');
const { decryptPassword } = require('../services/encryptionService');
const { Client } = require('ssh2');

const router = express.Router();

// ── SSH execution helper ──────────────────────────────────────────────────────
async function runSSHCommands(device, commands) {
    const password = decryptPassword(device.password_encrypted);
    const results = [];

    for (const cmd of commands) {
        const output = await new Promise((resolve) => {
            const conn = new Client();
            let out = '';
            let err = '';

            conn.on('ready', () => {
                conn.exec(cmd, (e, stream) => {
                    if (e) { resolve(`Erro: ${e.message}`); conn.end(); return; }
                    stream.on('data', d => { out += d; });
                    stream.stderr.on('data', d => { err += d; });
                    stream.on('close', () => { conn.end(); resolve((out || err || '(sem saída)').trim()); });
                });
            });

            conn.on('error', (e) => resolve(`Erro SSH: ${e.message}`));

            conn.connect({
                host: device.host,
                port: device.port,
                username: device.username,
                password,
                readyTimeout: 15000,
            });
        });
        results.push({ command: cmd, output });
    }

    return results;
}

// GET /actions — list pending actions for tenant
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { status = 'pending', limit = 20 } = req.query;

        const rows = await prisma.$queryRawUnsafe(
            `SELECT pa.*, d.name as device_name, d.type as device_type
             FROM "${schema}".pending_actions pa
             LEFT JOIN "${schema}".devices d ON pa.device_id = d.id
             WHERE pa.status = $1
             ORDER BY pa.created_at DESC
             LIMIT $2`,
            status, Number(limit)
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /actions/:id/approve — approve and execute
router.post('/:id/approve', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { id } = req.params;

        // Get the pending action
        const rows = await prisma.$queryRawUnsafe(
            `SELECT pa.*, d.host, d.port, d.username, d.password_encrypted, d.name as device_name
             FROM "${schema}".pending_actions pa
             LEFT JOIN "${schema}".devices d ON pa.device_id = d.id
             WHERE pa.id = $1::uuid AND pa.status = 'pending'`,
            id
        );

        if (!rows.length) {
            return next(createError(404, 'Ação não encontrada ou já processada'));
        }

        const action = rows[0];

        // Mark as approved + executing
        await prisma.$executeRawUnsafe(
            `UPDATE "${schema}".pending_actions
             SET status = 'executing', resolved_by = $2
             WHERE id = $1::uuid`,
            id, String(req.user.userId)
        );

        emitToTenant(schema, 'action:executing', { id, action_type: action.action_type });

        // Execute SSH commands
        let result;
        try {
            const commands = Array.isArray(action.commands)
                ? action.commands
                : JSON.parse(action.commands || '[]');

            const outputs = await runSSHCommands(action, commands);

            await prisma.$executeRawUnsafe(
                `UPDATE "${schema}".pending_actions
                 SET status = 'executed', impact_analysis = $2, resolved_at = NOW()
                 WHERE id = $1::uuid`,
                id, JSON.stringify({ outputs })
            );

            result = { success: true, outputs };
            emitToTenant(schema, 'action:executed', { id, result });
        } catch (execErr) {
            await prisma.$executeRawUnsafe(
                `UPDATE "${schema}".pending_actions
                 SET status = 'failed', impact_analysis = $2
                 WHERE id = $1::uuid`,
                id, JSON.stringify({ error: execErr.message })
            );
            result = { success: false, error: execErr.message };
            emitToTenant(schema, 'action:failed', { id, error: execErr.message });
        }

        res.json({ id, ...result });
    } catch (err) { next(err); }
});

// POST /actions/:id/reject
router.post('/:id/reject', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { id } = req.params;

        const updated = await prisma.$queryRawUnsafe(
            `UPDATE "${schema}".pending_actions
             SET status = 'rejected', resolved_by = $2, resolved_at = NOW()
             WHERE id = $1::uuid AND status = 'pending'
             RETURNING id`,
            id, String(req.user.userId)
        );

        if (!updated.length) {
            return next(createError(404, 'Ação não encontrada ou já processada'));
        }

        emitToTenant(schema, 'action:rejected', { id });
        res.json({ id, status: 'rejected' });
    } catch (err) { next(err); }
});

module.exports = router;
