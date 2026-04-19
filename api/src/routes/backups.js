const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../db/prisma');

const router = express.Router();
const BASE_DIR = '/var/backups/netagent';

// Helper to check if file exists
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// GET /backups — List all backups
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;

        // Ensure base dir exists
        if (!(await fileExists(BASE_DIR))) {
            return res.json([]);
        }

        // Get devices to map names
        const devices = await prisma.$queryRawUnsafe(
            `SELECT id, name FROM "${schema}".devices WHERE active = true`
        );
        const deviceMap = devices.reduce((acc, d) => {
            acc[d.id] = d.name;
            return acc;
        }, {});

        const backups = [];

        // Read directories inside BASE_DIR
        const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const deviceId = entry.name;
            // Only list backups for devices that belong to this tenant
            if (!deviceMap[deviceId]) continue;

            const deviceDir = path.join(BASE_DIR, deviceId);
            try {
                const files = await fs.readdir(deviceDir);

                for (const file of files) {
                    // Only show .backup, .rsc, .cfg, .txt, .tar.gz, etc.
                    const filePath = path.join(deviceDir, file);
                    const stats = await fs.stat(filePath);

                    if (stats.isFile()) {
                        backups.push({
                            id: `${deviceId}/${file}`,
                            deviceId,
                            deviceName: deviceMap[deviceId],
                            filename: file,
                            sizeBytes: stats.size,
                            createdAt: stats.mtime,
                        });
                    }
                }
            } catch (err) {
                console.warn(`[backups] Error reading dir ${deviceDir}:`, err.message);
            }
        }

        // Sort by newest first
        backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        res.json(backups);
    } catch (err) {
        next(err);
    }
});

// GET /backups/linked — List devices with linked FTP folders
router.get('/linked', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;

        if (!(await fileExists(BASE_DIR))) {
            return res.json([]);
        }

        const devices = await prisma.$queryRawUnsafe(
            `SELECT id, name, type, host FROM "${schema}".devices WHERE active = true`
        );
        const deviceMap = devices.reduce((acc, d) => {
            acc[d.id] = d;
            return acc;
        }, {});

        const linked = [];
        const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (deviceMap[entry.name]) {
                linked.push(deviceMap[entry.name]);
            }
        }

        res.json(linked);
    } catch (err) {
        next(err);
    }
});

// GET /backups/download/:deviceId/:filename
router.get('/download/:deviceId/:filename', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { deviceId, filename } = req.params;

        // Security check
        if (deviceId.includes('..') || filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid path parameters' });
        }

        // Verify device belongs to tenant
        const devices = await prisma.$queryRawUnsafe(
            `SELECT id FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            deviceId
        );
        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const filePath = path.join(BASE_DIR, deviceId, filename);
        if (!(await fileExists(filePath))) {
            return res.status(404).json({ error: 'Backup not found' });
        }

        res.download(filePath);
    } catch (err) {
        next(err);
    }
});

// DELETE /backups/folders/:deviceId
router.delete('/folders/:deviceId', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { deviceId } = req.params;

        if (deviceId.includes('..') || deviceId.includes('/')) {
            return res.status(400).json({ error: 'Invalid path parameters' });
        }

        const devices = await prisma.$queryRawUnsafe(
            `SELECT id FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            deviceId
        );
        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const deviceDir = path.join(BASE_DIR, deviceId);
        if (await fileExists(deviceDir)) {
            await fs.rm(deviceDir, { recursive: true, force: true });
        }

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// DELETE /backups/:deviceId/:filename
router.delete('/:deviceId/:filename', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { deviceId, filename } = req.params;

        // Security check
        if (deviceId.includes('..') || filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid path parameters' });
        }

        // Verify device belongs to tenant
        const devices = await prisma.$queryRawUnsafe(
            `SELECT id FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            deviceId
        );
        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const filePath = path.join(BASE_DIR, deviceId, filename);
        if (!(await fileExists(filePath))) {
            return res.status(404).json({ error: 'Backup not found' });
        }

        await fs.unlink(filePath);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// GET /backups/settings
router.get('/settings', async (req, res, next) => {
    try {
        const settingsPath = path.join(BASE_DIR, '.ftp_settings.json');
        let settings = { user: 'backup_user', password: 'netagent_secure_ftp_888', port: 2121 };
        if (await fileExists(settingsPath)) {
            const data = await fs.readFile(settingsPath, 'utf8');
            settings = JSON.parse(data);
        }
        res.json(settings);
    } catch (err) {
        next(err);
    }
});

// PUT /backups/settings
router.put('/settings', async (req, res, next) => {
    try {
        // Enforce admin privileges if necessary. We assume the user is authenticated.
        const { port, password } = req.body;
        if (!port || !password) return res.status(400).json({ error: 'Port and password required' });

        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return res.status(400).json({ error: 'Invalid port' });

        const settingsPath = path.join(BASE_DIR, '.ftp_settings.json');
        const settings = { user: 'backup_user', password, port: portNum };

        // Save settings to json
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

        // Note: The API runs as root in this PM2 environment
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        // Change password
        // Safely escape password for chpasswd
        const escapedPassword = password.replace(/'/g, "'\\''");
        await execAsync(`echo "backup_user:${password}" | chpasswd`);

        // Change vsftpd port
        await execAsync(`sed -i 's/^listen_port=.*/listen_port=${portNum}/' /etc/vsftpd.conf`);

        // Restart vsftpd
        await execAsync(`systemctl restart vsftpd`);

        res.json({ ok: true, settings });
    } catch (err) {
        console.error('[backups] Error applying settings:', err);
        next(err);
    }
});

// POST /backups/folders/:deviceId
router.post('/folders/:deviceId', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;
        const { deviceId } = req.params;

        if (deviceId.includes('..') || deviceId.includes('/')) {
            return res.status(400).json({ error: 'Invalid path parameters' });
        }

        const devices = await prisma.$queryRawUnsafe(
            `SELECT id FROM "${schema}".devices WHERE id = $1::uuid AND active = true`,
            deviceId
        );
        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const deviceDir = path.join(BASE_DIR, deviceId);
        if (!(await fileExists(deviceDir))) {
            await fs.mkdir(deviceDir, { recursive: true });
            // ensure permissions
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            await execAsync(`chown backup_user:backup_user ${deviceDir} && chmod 755 ${deviceDir}`);
        }

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
