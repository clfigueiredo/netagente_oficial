const express = require('express');
const { z } = require('zod');
const { createError } = require('../lib/errors');
const prisma = require('../db/prisma');
const { decryptPassword } = require('../services/encryptionService');
const { Client } = require('ssh2');

const router = express.Router();

// ── SSH Execution Helper ──────────────────────────────────────────────────────
async function runSSHCommand(device, command) {
    const password = decryptPassword(device.password_encrypted);
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let out = '';
        let err = '';

        conn.on('ready', () => {
            conn.exec(command, (e, stream) => {
                if (e) {
                    conn.end();
                    return reject(e);
                }
                stream.on('data', d => { out += d.toString(); });
                stream.stderr.on('data', d => { err += d.toString(); });
                stream.on('close', () => {
                    conn.end();
                    const result = (out || err).trim();
                    if (result.includes('failure') || result.includes('bad command') || result.includes('syntax error')) {
                        reject(new Error(result));
                    } else {
                        resolve(result);
                    }
                });
            });
        });

        conn.on('error', (e) => reject(new Error(`SSH Error: ${e.message}`)));

        conn.connect({
            host: device.host,
            port: device.port,
            username: device.username,
            password,
            readyTimeout: 15000,
        });
    });
}

// ── Interfaces ──────────────────────────────────────────────────────────────────

const interfaceSchema = z.object({
    deviceId: z.string().uuid(),
    name: z.string().min(1),
    listenPort: z.number().int().min(1).max(65535),
    privateKey: z.string().min(1),
    publicKey: z.string().min(1),
    comment: z.string().optional()
});

router.get('/interfaces', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(`
            SELECT wi.*, d.name as device_name
            FROM "${schema}".wireguard_interfaces wi
            JOIN "${schema}".devices d ON wi.device_id = d.id
            ORDER BY wi.created_at DESC
        `);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/interfaces', async (req, res, next) => {
    try {
        const data = interfaceSchema.parse(req.body);
        const schema = req.tenantSchema;

        // Verify device
        const devices = await prisma.$queryRawUnsafe(
            `SELECT * FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            data.deviceId
        );
        if (!devices.length) return next(createError(404, 'Dispositivo não encontrado'));
        const device = devices[0];

        // Execute on Mikrotik
        const cmd = `/interface wireguard add name="${data.name}" listen-port=${data.listenPort} private-key="${data.privateKey}" comment="${data.comment || ''}" disabled=no`;
        try {
            await runSSHCommand(device, cmd);
        } catch (sshErr) {
            return next(createError(500, `Erro Mikrotik SSH: ${sshErr.message}`));
        }

        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".wireguard_interfaces (device_id, name, listen_port, private_key, public_key, comment)
             VALUES ($1::uuid, $2, $3, $4, $5, $6)
             RETURNING *`,
            data.deviceId, data.name, data.listenPort, data.privateKey, data.publicKey, data.comment || null
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

router.delete('/interfaces/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        // Verify interface
        const interfaces = await prisma.$queryRawUnsafe(`
             SELECT wi.*, d.host, d.port, d.username, d.password_encrypted
             FROM "${schema}".wireguard_interfaces wi
             JOIN "${schema}".devices d ON wi.device_id = d.id
             WHERE wi.id = $1::uuid
        `, req.params.id);

        if (!interfaces.length) return next(createError(404, 'Interface não encontrada'));
        const inter = interfaces[0];

        // Ensure there are no dependent pools or peers (cascade takes care of DB but we should cleanly delete from Mikrotik)
        try {
            await runSSHCommand(inter, `/interface wireguard remove [find name="${inter.name}"]`);
        } catch (sshErr) {
            console.warn(`Failed to remove interface via SSH from Mikrotik: ${sshErr.message}`);
            // we still drop from DB.
        }

        await prisma.$queryRawUnsafe(`DELETE FROM "${schema}".wireguard_interfaces WHERE id = $1::uuid`, req.params.id);
        res.status(204).send();
    } catch (err) { next(err); }
});

// ── Pools ────────────────────────────────────────────────────────────────────────

const poolSchema = z.object({
    interfaceId: z.string().uuid(),
    name: z.string().min(1),
    startIp: z.string().min(1), // e.g., 10.0.0.2
    endIp: z.string().min(1)    // e.g., 10.0.0.254
});

router.get('/pools', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(`
            SELECT wp.*, wi.name as interface_name, wi.device_id
            FROM "${schema}".wireguard_pools wp
            JOIN "${schema}".wireguard_interfaces wi ON wp.interface_id = wi.id
            ORDER BY wp.created_at DESC
        `);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/pools', async (req, res, next) => {
    try {
        const data = poolSchema.parse(req.body);
        const schema = req.tenantSchema;

        // Verify interface
        const interfaces = await prisma.$queryRawUnsafe(
            `SELECT * FROM "${schema}".wireguard_interfaces WHERE id = $1::uuid`,
            data.interfaceId
        );
        if (!interfaces.length) return next(createError(404, 'Interface não encontrada'));

        const rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".wireguard_pools (interface_id, name, start_ip, end_ip)
             VALUES ($1::uuid, $2, $3, $4)
             RETURNING *`,
            data.interfaceId, data.name, data.startIp, data.endIp
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

router.delete('/pools/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        await prisma.$queryRawUnsafe(`DELETE FROM "${schema}".wireguard_pools WHERE id = $1::uuid`, req.params.id);
        res.status(204).send();
    } catch (err) { next(err); }
});


// ── Peers ────────────────────────────────────────────────────────────────────────

const peerSchema = z.object({
    interfaceId: z.string().uuid(),
    name: z.string().min(1),
    publicKey: z.string().min(1),
    privateKey: z.string().optional(),
    presharedKey: z.string().optional(),
    allowedAddress: z.string().min(1), // Includes CIDR, e.g., 10.0.0.2/32
    persistentKeepalive: z.number().int().optional(),
    endpoint: z.string().optional(),
    downloadBandwidth: z.number().optional(), // mbps
    uploadBandwidth: z.number().optional(), // mbps
    trafficLimit: z.number().optional(), // GB
    expireTime: z.string().optional(), // Date string
    comment: z.string().optional()
});

router.get('/peers', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const rows = await prisma.$queryRawUnsafe(`
            SELECT wp.*, wi.name as interface_name, wi.device_id, d.name as device_name
            FROM "${schema}".wireguard_peers wp
            JOIN "${schema}".wireguard_interfaces wi ON wp.interface_id = wi.id
            JOIN "${schema}".devices d ON wi.device_id = d.id
            ORDER BY wp.created_at DESC
        `);
        res.json(rows);
    } catch (err) { next(err); }
});

router.post('/peers', async (req, res, next) => {
    try {
        const data = peerSchema.parse(req.body);
        const schema = req.tenantSchema;

        // Verify interface and fetch device credentials
        const interfaces = await prisma.$queryRawUnsafe(`
            SELECT wi.*, d.host, d.port, d.username, d.password_encrypted
            FROM "${schema}".wireguard_interfaces wi
            JOIN "${schema}".devices d ON wi.device_id = d.id
            WHERE wi.id = $1::uuid
        `, data.interfaceId);

        if (!interfaces.length) return next(createError(404, 'Interface não encontrada'));
        const inter = interfaces[0];

        // 1. Setup Mikrotik Peer
        let peerCmd = `/interface wireguard peers add interface="${inter.name}" public-key="${data.publicKey}" allowed-address="${data.allowedAddress}" comment="${data.name} - ${data.comment || ''}"`;
        if (data.presharedKey) peerCmd += ` preshared-key="${data.presharedKey}"`;
        if (data.endpoint) peerCmd += ` endpoint-address="${data.endpoint}"`;
        if (data.persistentKeepalive) peerCmd += ` persistent-keepalive=${data.persistentKeepalive}s`;

        try {
            await runSSHCommand(inter, peerCmd);
        } catch (sshErr) {
            return next(createError(500, `Erro Mikrotik SSH ao criar Peer: ${sshErr.message}`));
        }

        // 2. Setup Simple Queue (Bandwidth limit) if provided
        if (data.downloadBandwidth || data.uploadBandwidth) {
            const rx = data.downloadBandwidth ? `${data.downloadBandwidth}M` : 'unlimited';
            const tx = data.uploadBandwidth ? `${data.uploadBandwidth}M` : 'unlimited';
            const queueCmd = `/queue simple add name="wg-${data.name}" target="${data.allowedAddress}" max-limit="${tx}/${rx}" comment="WireGuard Peer ${data.name}"`;
            try {
                await runSSHCommand(inter, queueCmd);
            } catch (sshErr) {
                console.warn(`Failed to create queue via SSH: ${sshErr.message}`);
            }
        }

        // 3. Setup Scheduler (Expiration) if provided
        if (data.expireTime) {
            const expireDate = new Date(data.expireTime);
            // Format to Mikrotik router script style (e.g. MMM/DD/YYYY)
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const mikrotikDateStr = `${months[expireDate.getMonth()]}/${String(expireDate.getDate()).padStart(2, '0')}/${expireDate.getFullYear()}`;
            const mikrotikTimeStr = `${String(expireDate.getHours()).padStart(2, '0')}:${String(expireDate.getMinutes()).padStart(2, '0')}:${String(expireDate.getSeconds()).padStart(2, '0')}`;

            // Generate a script that disables the peer and the queue
            const policyScript = `/interface wireguard peers disable [find public-key="${data.publicKey}"]; /queue simple disable [find name="wg-${data.name}"];`;
            const schedCmd = `/system scheduler add name="expire-wg-${data.name}" start-date=${mikrotikDateStr} start-time=${mikrotikTimeStr} on-event="${policyScript}" comment="Auto-expire WireGuard peer"`;

            try {
                await runSSHCommand(inter, schedCmd);
            } catch (sshErr) {
                console.warn(`Failed to create scheduler via SSH: ${sshErr.message}`);
            }
        }

        // Convert GB to bytes for traffic limit
        const trafficLimitBytes = data.trafficLimit ? data.trafficLimit * 1024 * 1024 * 1024 : null;

        const rows = await prisma.$queryRawUnsafe(`
            INSERT INTO "${schema}".wireguard_peers (
                interface_id, name, public_key, private_key, preshared_key, allowed_address, persistent_keepalive,
                endpoint, download_bandwidth, upload_bandwidth, traffic_limit, expire_time, comment
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `,
            data.interfaceId, data.name, data.publicKey, data.privateKey || null, data.presharedKey || null,
            data.allowedAddress, data.persistentKeepalive || null, data.endpoint || null,
            data.downloadBandwidth || null, data.uploadBandwidth || null, trafficLimitBytes,
            data.expireTime ? new Date(data.expireTime) : null, data.comment || null
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        if (err.name === 'ZodError') return next(createError(400, err.errors[0]?.message));
        next(err);
    }
});

router.delete('/peers/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        // Verify peer
        const peers = await prisma.$queryRawUnsafe(`
             SELECT wp.*, wi.name as interface_name, d.host, d.port, d.username, d.password_encrypted
             FROM "${schema}".wireguard_peers wp
             JOIN "${schema}".wireguard_interfaces wi ON wp.interface_id = wi.id
             JOIN "${schema}".devices d ON wi.device_id = d.id
             WHERE wp.id = $1::uuid
        `, req.params.id);

        if (!peers.length) return next(createError(404, 'Peer não encontrado'));
        const peer = peers[0];

        try {
            // Remove peer
            await runSSHCommand(peer, `/interface wireguard peers remove [find public-key="${peer.public_key}"]`);
            // Try removing queue
            await runSSHCommand(peer, `/queue simple remove [find name="wg-${peer.name}"]`).catch(() => null);
            // Try removing scheduler
            await runSSHCommand(peer, `/system scheduler remove [find name="expire-wg-${peer.name}"]`).catch(() => null);
        } catch (sshErr) {
            console.warn(`Failed to cleanly remove peer assets via SSH from Mikrotik: ${sshErr.message}`);
        }

        await prisma.$queryRawUnsafe(`DELETE FROM "${schema}".wireguard_peers WHERE id = $1::uuid`, req.params.id);
        res.status(204).send();
    } catch (err) { next(err); }
});

module.exports = router;
