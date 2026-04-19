const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const prisma = new PrismaClient();
const WG_DATA_DIR = '/var/www/agente_forum_telecom/data/wireguard';
const WG_PORT_BASE = 51821; // 51820 reserved, tenants start at 51821

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function generateKeys() {
    const { stdout: privateKey } = await execPromise('docker exec netagent-wireguard wg genkey');
    const priv = privateKey.trim();
    const { stdout: publicKey } = await execPromise(`docker exec netagent-wireguard bash -c "echo '${priv}' | wg pubkey"`);
    return { privateKey: priv, publicKey: publicKey.trim() };
}

function getInterfaceName(tenantSlug) {
    // Sanitize: only alphanumeric, max 15 chars (Linux ifname limit)
    const clean = tenantSlug.replace(/[^a-z0-9]/gi, '').substring(0, 10);
    return `wg_${clean}`;
}

function getConfPath(tenantSlug) {
    const ifName = getInterfaceName(tenantSlug);
    return path.join(WG_DATA_DIR, `${ifName}.conf`);
}

function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Tenant VPN Initialization ─────────────────────────────────────────────────

async function ensureTenantVPN(tenantSlug) {
    // Check if tenant already has VPN configured
    const tenantRows = await prisma.$queryRawUnsafe(
        `SELECT wg_subnet, wg_port, wg_private_key, wg_public_key FROM public.tenants WHERE slug = $1`,
        tenantSlug
    );

    if (!tenantRows.length) throw new Error('Tenant not found');
    const tenant = tenantRows[0];

    if (tenant.wg_port && tenant.wg_private_key && tenant.wg_public_key) {
        return {
            subnet: tenant.wg_subnet,
            port: tenant.wg_port,
            privateKey: tenant.wg_private_key,
            publicKey: tenant.wg_public_key,
            interfaceName: getInterfaceName(tenantSlug),
        };
    }

    // ── First-time init: allocate port, subnet, generate keys ──
    const countRes = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(MAX(wg_port), ${WG_PORT_BASE - 1}) AS max_port FROM public.tenants WHERE wg_port IS NOT NULL`
    );
    const nextPort = parseInt(countRes[0].max_port, 10) + 1;

    const subnetRes = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM public.tenants WHERE wg_subnet IS NOT NULL`
    );
    const subnetIndex = subnetRes[0].c + 1; // 1-based: 10.100.1.0/24, 10.100.2.0/24...
    const subnet = `10.100.${subnetIndex}`;

    const serverKeys = await generateKeys();
    const ifName = getInterfaceName(tenantSlug);

    // Write wg conf file
    const confContent = [
        '[Interface]',
        `Address = ${subnet}.1/24`,
        `ListenPort = ${nextPort}`,
        `PrivateKey = ${serverKeys.privateKey}`,
        `PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth+ -j MASQUERADE`,
        `PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth+ -j MASQUERADE`,
        '',
    ].join('\n');

    const confPath = path.join(WG_DATA_DIR, `${ifName}.conf`);
    await fs.writeFile(confPath, confContent, { mode: 0o600 });

    // Bring up the interface in the container
    try {
        await execPromise(`docker exec netagent-wireguard wg-quick up ${ifName}`);
    } catch (err) {
        console.error(`Failed to bring up ${ifName}:`, err.stderr || err.message);
    }

    // Save to DB
    await prisma.$queryRawUnsafe(
        `UPDATE public.tenants SET wg_subnet = $1, wg_port = $2, wg_private_key = $3, wg_public_key = $4 WHERE slug = $5`,
        subnet, nextPort, serverKeys.privateKey, serverKeys.publicKey, tenantSlug
    );

    return {
        subnet,
        port: nextPort,
        privateKey: serverKeys.privateKey,
        publicKey: serverKeys.publicKey,
        interfaceName: ifName,
    };
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// GET /wg_server/status — Server VPN status + live peer data
router.get('/status', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const vpn = await ensureTenantVPN(schema);

        // Get live status from wg show
        let liveData = {};
        try {
            const { stdout } = await execPromise(`docker exec netagent-wireguard wg show ${vpn.interfaceName} dump`);
            const lines = stdout.trim().split('\n');
            // First line is interface info, rest are peers
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                // public_key, preshared_key, endpoint, allowed_ips, latest_handshake, transfer_rx, transfer_tx, persistent_keepalive
                if (parts.length >= 7) {
                    liveData[parts[0]] = {
                        endpoint: parts[2] === '(none)' ? null : parts[2],
                        latestHandshake: parts[4] === '0' ? null : new Date(parseInt(parts[4], 10) * 1000).toISOString(),
                        transferRx: parseInt(parts[5], 10) || 0,
                        transferTx: parseInt(parts[6], 10) || 0,
                    };
                }
            }
        } catch {
            // Interface might not be up yet
        }

        // Get DB peers
        const peers = await prisma.$queryRawUnsafe(`
            SELECT p.id, p.name, p.ip_address, p.public_key, p.os_type, p.created_at, p.active, d.name as device_name
            FROM "${schema}".wireguard_server_peers p
            LEFT JOIN "${schema}".devices d ON d.id = p.device_id
            ORDER BY p.created_at DESC
        `);

        // Merge live data
        const enrichedPeers = peers.map(p => ({
            ...p,
            live: liveData[p.public_key] || null,
            connected: !!(liveData[p.public_key]?.latestHandshake),
        }));

        const endpoint = process.env.PUBLIC_URL
            ? process.env.PUBLIC_URL.replace('https://', '').replace('/api', '') + ':' + vpn.port
            : `agente.forumtelecom.com.br:${vpn.port}`;

        res.json({
            interfaceName: vpn.interfaceName,
            subnet: `${vpn.subnet}.0/24`,
            serverIp: `${vpn.subnet}.1`,
            port: vpn.port,
            serverPublicKey: vpn.publicKey,
            endpoint,
            peers: enrichedPeers,
        });
    } catch (err) {
        next(err);
    }
});

// POST /wg_server/peers — Add new peer (client device)
router.post('/peers', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { name, deviceId, osType = 'mikrotik' } = req.body;

        if (!name) return res.status(400).json({ error: 'Name is required' });

        const vpn = await ensureTenantVPN(schema);

        // Find next available IP
        const existingPeers = await prisma.$queryRawUnsafe(
            `SELECT ip_address FROM "${schema}".wireguard_server_peers`
        );
        const usedIps = new Set(existingPeers.map(p => p.ip_address));

        let nextOctet = 2; // .1 is the server
        while (usedIps.has(`${vpn.subnet}.${nextOctet}`)) nextOctet++;
        if (nextOctet > 254) return res.status(400).json({ error: 'Subnet full (max 253 peers)' });

        const newIp = `${vpn.subnet}.${nextOctet}`;

        // Generate client keys
        const clientKeys = await generateKeys();

        // Append peer to conf file
        const confPath = getConfPath(schema);
        const peerBlock = `\n[Peer]\nPublicKey = ${clientKeys.publicKey}\nAllowedIPs = ${newIp}/32\n`;
        await fs.appendFile(confPath, peerBlock);

        // Live sync without restart
        try {
            await execPromise(`docker exec netagent-wireguard bash -c "wg syncconf ${vpn.interfaceName} <(wg-quick strip ${vpn.interfaceName})"`);
        } catch (err) {
            console.error('syncconf error:', err.stderr || err.message);
        }

        // Save to DB
        await prisma.$queryRawUnsafe(`
            INSERT INTO "${schema}".wireguard_server_peers (name, device_id, public_key, private_key, ip_address, os_type)
            VALUES ($1, $2::uuid, $3, $4, $5, $6)
        `, name, deviceId || null, clientKeys.publicKey, clientKeys.privateKey, newIp, osType);

        const endpoint = process.env.PUBLIC_URL
            ? process.env.PUBLIC_URL.replace('https://', '').replace('/api', '') + ':' + vpn.port
            : `agente.forumtelecom.com.br:${vpn.port}`;

        res.json({
            ok: true,
            peer: {
                name,
                ip_address: newIp,
                private_key: clientKeys.privateKey,
                public_key: clientKeys.publicKey,
            },
            server: {
                public_key: vpn.publicKey,
                server_ip: `${vpn.subnet}.1`,
                endpoint,
                port: vpn.port,
            },
        });
    } catch (err) {
        console.error('Setup peer error:', err);
        next(err);
    }
});

// DELETE /wg_server/peers/:id — Remove peer
router.delete('/peers/:id', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { id } = req.params;

        const peers = await prisma.$queryRawUnsafe(
            `SELECT public_key FROM "${schema}".wireguard_server_peers WHERE id = $1::uuid`, id
        );

        if (peers.length > 0) {
            const pubKey = peers[0].public_key;
            try {
                let conf = await fs.readFile(getConfPath(schema), 'utf8');
                const escaped = escapeForRegex(pubKey);
                // Match entire [Peer] block including trailing whitespace
                const regex = new RegExp(`\\n?\\[Peer\\]\\nPublicKey = ${escaped}\\nAllowedIPs = [^\\n]+\\n?`, 'g');
                conf = conf.replace(regex, '\n');
                await fs.writeFile(getConfPath(schema), conf);

                const ifName = getInterfaceName(schema);
                await execPromise(`docker exec netagent-wireguard bash -c "wg syncconf ${ifName} <(wg-quick strip ${ifName})"`);
            } catch (err) {
                console.error('Failed to clean conf:', err.message);
            }
        }

        await prisma.$queryRawUnsafe(
            `DELETE FROM "${schema}".wireguard_server_peers WHERE id = $1::uuid`, id
        );

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
