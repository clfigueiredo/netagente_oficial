const express = require('express');
const { z } = require('zod');
const { encryptPassword, decryptPassword } = require('../services/encryptionService');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');

const router = express.Router();

const deviceSchema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['mikrotik', 'linux', 'docker_host']),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1),
    password: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    tags: z.array(z.string()).default([])
});

// GET /devices
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const devices = await prisma.$queryRawUnsafe(
            `SELECT id, name, type, host, port, username, description, location, tags, active, last_seen_at, created_at
       FROM "${schema}".devices
       WHERE active = true
       ORDER BY name`
        );
        res.json(devices);
    } catch (err) { next(err); }
});

// GET /devices/:id
router.get('/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, name, type, host, port, username, description, location, tags, active, last_seen_at, created_at
       FROM "${schema}".devices WHERE id = $1::uuid`,
            req.params.id
        );
        if (!rows[0]) return next(createError(404, 'Dispositivo não encontrado'));
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// POST /devices
router.post('/', async (req, res, next) => {
    try {
        const data = deviceSchema.parse(req.body);
        const schema = req.tenantSchema;
        const encrypted = encryptPassword(data.password);

        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".devices (name, type, host, port, username, password_encrypted, description, location, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id, name, type, host, port, username, description, location, tags, active, created_at`,
            data.name, data.type, data.host, data.port, data.username,
            encrypted, data.description ?? null, data.location ?? null, JSON.stringify(data.tags)
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

// PATCH /devices/:id
router.patch('/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const allowed = ['name', 'host', 'port', 'username', 'description', 'location', 'tags', 'active'];
        const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

        if (req.body.password) {
            updates.password_encrypted = encryptPassword(req.body.password);
        }

        if (!Object.keys(updates).length) return next(createError(400, 'Nenhum campo válido para atualizar'));

        const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 2}`).join(', ');
        const values = Object.values(updates);

        const rows = await prisma.$queryRawUnsafe(
            `UPDATE "${schema}".devices SET ${fields} WHERE id = $1::uuid
       RETURNING id, name, type, host, port, username, description, location, tags, active`,
            req.params.id, ...values
        );
        if (!rows[0]) return next(createError(404, 'Dispositivo não encontrado'));
        res.json(rows[0]);
    } catch (err) { next(err); }
});

// DELETE /devices/:id  (soft delete)
router.delete('/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        await prisma.$executeRawUnsafe(
            `UPDATE "${schema}".devices SET active = false WHERE id = $1::uuid`,
            req.params.id
        );
        res.status(204).send();
    } catch (err) { next(err); }
});

// POST /devices/:id/test — test SSH connectivity and collect basic metrics
router.post('/:id/test', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, name, type, host, port, username, password_encrypted
             FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            req.params.id
        );
        if (!rows[0]) return next(createError(404, 'Dispositivo não encontrado'));

        const device = rows[0];

        let password;
        try {
            password = decryptPassword(device.password_encrypted);
        } catch (e) {
            return res.json({ ok: false, error: 'Erro ao descriptografar senha do dispositivo' });
        }

        // Prisma raw queries return BigInt for integer columns — convert to Number
        const sshDevice = {
            ...device,
            port: Number(device.port) || 22,
            password,
        };

        console.log(`[test] Connecting to ${sshDevice.host}:${sshDevice.port} type=${sshDevice.type} user=${sshDevice.username}`);

        try {
            const metrics = await testSSHConnection(sshDevice);
            return res.json({ ok: true, metrics });
        } catch (sshErr) {
            console.error(`[test] SSH error (${sshDevice.host}:${sshDevice.port}):`, sshErr.message || sshErr);
            const msg = sshErr.isConnectError
                ? sshErr.message
                : formatSSHError(sshErr);
            return res.json({ ok: false, error: msg });
        }
    } catch (err) {
        next(err);
    }
});



function testSSHConnection(device) {
    return new Promise((resolve, reject) => {
        const { Client } = require('ssh2');
        const conn = new Client();
        const TIMEOUT = 12000;

        const timer = setTimeout(() => {
            conn.end();
            const e = new Error('Timeout: não foi possível conectar em 12s');
            e.isConnectError = true;
            reject(e);
        }, TIMEOUT);

        conn.on('ready', () => {
            const cmds = device.type === 'mikrotik'
                ? buildMikrotikCommands()
                : buildLinuxCommands();

            runCommands(conn, cmds)
                .then(output => {
                    clearTimeout(timer);
                    conn.end();
                    resolve(parseOutput(device.type, output));
                })
                .catch(err => {
                    clearTimeout(timer);
                    conn.end();
                    err.isConnectError = true;
                    reject(err);
                });
        });

        conn.on('error', (err) => {
            clearTimeout(timer);
            const e = new Error(formatSSHError(err));
            e.isConnectError = true;
            reject(e);
        });

        conn.connect({
            host: device.host,
            port: device.port || 22,
            username: device.username,
            password: device.password,
            readyTimeout: TIMEOUT,
            algorithms: {
                kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256',
                    'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
                cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', '3des-cbc'],
            }
        });
    });
}

function runCommands(conn, commands) {
    return new Promise((resolve, reject) => {
        const script = commands.join('\n');
        conn.exec(script, (err, stream) => {
            if (err) return reject(err);
            let stdout = '';
            let stderr = '';
            stream.on('data', d => { stdout += d; });
            stream.stderr.on('data', d => { stderr += d; });
            stream.on('close', () => resolve(stdout));
        });
    });
}

function buildLinuxCommands() {
    return [
        "echo '---UPTIME---'",
        "uptime -p 2>/dev/null || uptime",
        "echo '---CPU---'",
        "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' 2>/dev/null || cat /proc/loadavg | awk '{print $1}'",
        "echo '---MEM---'",
        "free -m | awk 'NR==2{print $2\" \"$3\" \"$4}'",
        "echo '---OS---'",
        "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"' || uname -sr",
        "echo '---HOSTNAME---'",
        "hostname",
        "echo '---DONE---'",
    ];
}

function buildMikrotikCommands() {
    return [
        '/system resource print',
    ];
}

function parseOutput(type, raw) {
    if (type === 'mikrotik') return parseMikrotik(raw);
    return parseLinux(raw);
}

function parseLinux(raw) {
    const section = (name) => {
        const re = new RegExp(`---${name}---\\n([\\s\\S]*?)(?=---[A-Z]|$)`);
        const m = raw.match(re);
        return m ? m[1].trim() : '';
    };

    const memParts = section('MEM').split(/\s+/);
    const totalMB = parseInt(memParts[0]) || 0;
    const usedMB = parseInt(memParts[1]) || 0;
    const freeMB = parseInt(memParts[2]) || 0;

    const cpuRaw = section('CPU');
    const cpuVal = parseFloat(cpuRaw.replace(',', '.')) || 0;

    return {
        uptime: section('UPTIME') || 'N/A',
        cpu: `${cpuVal.toFixed(1)}%`,
        ram_used: `${usedMB} MB`,
        ram_free: `${freeMB} MB`,
        ram_total: `${totalMB} MB`,
        os: section('OS') || 'Linux',
        hostname: section('HOSTNAME') || '',
    };
}

function parseMikrotik(raw) {
    const get = (key) => {
        const re = new RegExp(`${key}:\\s*([^\\n]+)`);
        const m = raw.match(re);
        return m ? m[1].trim() : 'N/A';
    };

    const freeMemBytes = parseInt(get('free-memory').replace(/[^\d]/g, '')) || 0;
    const totalMemBytes = parseInt(get('total-memory').replace(/[^\d]/g, '')) || 0;
    const freeMB = Math.round(freeMemBytes / 1024 / 1024);
    const totalMB = Math.round(totalMemBytes / 1024 / 1024);

    return {
        uptime: get('uptime'),
        cpu: `${get('cpu-load')}%`,
        ram_free: `${freeMB} MB`,
        ram_total: `${totalMB} MB`,
        os: `RouterOS ${get('version')}`,
        hostname: get('board-name'),
        platform: get('platform'),
    };
}

function formatSSHError(err) {
    const msg = err.message || '';
    if (msg.includes('ECONNREFUSED')) return 'Conexão recusada — verifique host/porta SSH';
    if (msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) return 'Timeout — host inacessível';
    if (msg.includes('Authentication')) return 'Falha na autenticação — verifique usuário/senha';
    if (msg.includes('ENOTFOUND')) return 'Host não encontrado — verifique o endereço';
    return msg || 'Erro de conexão SSH';
}

module.exports = router;

