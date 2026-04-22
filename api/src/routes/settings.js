const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');

const router = express.Router();

const requireTenantAdmin = (req, res, next) => {
    if (req.user?.isSuperAdmin || req.user?.role === 'admin') return next();
    next(createError(403, 'Acesso restrito a administradores'));
};

const userSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().optional(),
    role: z.enum(['admin', 'operator', 'readonly']).default('operator')
});

const whatsappUserSchema = z.object({
    number: z.string().min(10).max(20),
    name: z.string().optional(),
    role: z.enum(['admin', 'operator', 'readonly']).default('operator')
});

// ── Tenant Users ─────────────────────────────────────────────────────────────

// GET /settings/users
router.get('/users', async (req, res, next) => {
    try {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, email, name, role, active, last_login_at, created_at FROM "${req.tenantSchema}".users ORDER BY created_at`
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /settings/users
router.post('/users', async (req, res, next) => {
    try {
        const { email, password, name, role } = userSchema.parse(req.body);
        const hash = await bcrypt.hash(password, 12);
        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${req.tenantSchema}".users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at`,
            email, hash, name ?? null, role
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

// ── WhatsApp Users ────────────────────────────────────────────────────────────

// GET /settings/whatsapp-users
router.get('/whatsapp-users', async (req, res, next) => {
    try {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, number, name, role, active, created_at FROM "${req.tenantSchema}".whatsapp_users ORDER BY created_at`
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /settings/whatsapp-users
router.post('/whatsapp-users', async (req, res, next) => {
    try {
        const { number, name, role } = whatsappUserSchema.parse(req.body);
        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${req.tenantSchema}".whatsapp_users (number, name, role)
       VALUES ($1, $2, $3) RETURNING id, number, name, role, created_at`,
            number, name ?? null, role
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

// DELETE /settings/whatsapp-users/:id
router.delete('/whatsapp-users/:id', async (req, res, next) => {
    try {
        await prisma.$executeRawUnsafe(
            `UPDATE "${req.tenantSchema}".whatsapp_users SET active = false WHERE id = $1::uuid`,
            req.params.id
        );
        res.status(204).send();
    } catch (err) { next(err); }
});

// ── Tenant Settings ───────────────────────────────────────────────────────────

// GET /settings
router.get('/', async (req, res, next) => {
    try {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT key, value FROM "${req.tenantSchema}".settings WHERE encrypted = false ORDER BY key`
        );
        res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
    } catch (err) { next(err); }
});

// PATCH /settings
router.patch('/', async (req, res, next) => {
    try {
        const allowed = [
            'alert_cpu_threshold', 'alert_check_interval', 'daily_report_hour',
            'daily_report_enabled', 'require_approval_for', 'language',
            'agent_mode', 'llm_provider', 'llm_model',
        ];
        for (const [key, value] of Object.entries(req.body)) {
            if (!allowed.includes(key)) continue;
            await prisma.$executeRawUnsafe(
                `INSERT INTO "${req.tenantSchema}".settings (key, value, encrypted)
         VALUES ($1, $2, false)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                key, String(value)
            );
        }
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// ── LLM API Key (encrypted) ───────────────────────────────────────────────────

// POST /settings/llm-key  { apiKey: "sk-..." }
router.post('/llm-key', async (req, res, next) => {
    try {
        const { encryptPassword } = require('../services/encryptionService');
        const { apiKey } = req.body;
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
            return res.status(400).json({ error: 'apiKey inválida' });
        }
        const encrypted = encryptPassword(apiKey.trim());
        await prisma.$executeRawUnsafe(
            `INSERT INTO "${req.tenantSchema}".settings (key, value, encrypted)
             VALUES ('llm_api_key', $1, true)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            encrypted
        );
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// DELETE /settings/llm-key — remove custom key, fallback to .env
router.delete('/llm-key', async (req, res, next) => {
    try {
        await prisma.$executeRawUnsafe(
            `UPDATE "${req.tenantSchema}".settings SET value = '', updated_at = NOW()
             WHERE key = 'llm_api_key'`
        );
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// ── WhatsApp Evolution Config (encrypted key) ─────────────────────────────────

// POST /settings/whatsapp-config  { instance: "...", apiKey: "..." }
router.post('/whatsapp-config', async (req, res, next) => {
    try {
        const { encryptPassword } = require('../services/encryptionService');
        const { instance, apiKey } = req.body;
        if (!instance || !apiKey) {
            return res.status(400).json({ error: 'instance e apiKey são obrigatórios' });
        }
        const encryptedKey = encryptPassword(apiKey.trim());
        await prisma.$executeRawUnsafe(
            `INSERT INTO "${req.tenantSchema}".settings (key, value, encrypted)
             VALUES ('evolution_instance', $1, false)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            instance.trim()
        );
        await prisma.$executeRawUnsafe(
            `INSERT INTO "${req.tenantSchema}".settings (key, value, encrypted)
             VALUES ('evolution_key', $1, true)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            encryptedKey
        );
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// GET /settings/whatsapp-status — ping Evolution API for connection state
router.get('/whatsapp-status', async (req, res, next) => {
    try {
        const axios = require('axios');
        const rows = await prisma.$queryRawUnsafe(
            `SELECT key, value FROM "${req.tenantSchema}".settings WHERE key IN ('evolution_instance', 'evolution_key')`
        );
        const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
        const instance = byKey.evolution_instance || '';
        const encKey = byKey.evolution_key || '';

        if (!instance || !encKey) return res.json({ state: 'not_configured' });

        const { decryptPassword } = require('../services/encryptionService');
        let apiKey;
        try { apiKey = decryptPassword(encKey); } catch { return res.json({ state: 'not_configured' }); }

        const baseUrl = process.env.EVOLUTION_BASE_URL || 'https://agenteevo.forumtelecom.com.br';
        try {
            const resp = await axios.get(
                `${baseUrl}/instance/connectionState/${instance}`,
                { headers: { apikey: apiKey }, timeout: 8000 }
            );
            res.json({ state: resp.data?.instance?.state || resp.data?.state || 'unknown', instance });
        } catch {
            res.json({ state: 'offline', instance });
        }
    } catch (err) { next(err); }
});

// ── MCP Postgres (acesso externo ao DB) ───────────────────────────────────────

// GET /settings/mcp-db — URL + token pro Claude Code remoto. Admin-only.
router.get('/mcp-db', requireTenantAdmin, (req, res) => {
    const url = process.env.MCP_DB_URL || '';
    const token = process.env.MCP_DB_TOKEN || '';
    const tenantSchema = process.env.MCP_DB_TENANT_SCHEMA || req.tenantSchema || '';
    res.json({
        configured: Boolean(url && token),
        url,
        token,
        tenantSchema,
    });
});

module.exports = router;

