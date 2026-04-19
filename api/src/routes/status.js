const express = require('express');
const prisma = require('../db/prisma');

const router = express.Router();

// GET /status — device statuses from Redis cache (written by Python monitor)
router.get('/', async (req, res, next) => {
    try {
        const schema = req.tenantSchema;

        // Get all devices
        const devices = await prisma.$queryRawUnsafe(
            `SELECT id, name, type, host, last_seen_at FROM "${schema}".devices WHERE active = true`
        );

        // Try to get cached metrics from Redis
        let redisClient;
        try {
            const { createClient } = require('redis');
            redisClient = createClient({ url: process.env.REDIS_URL });
            await redisClient.connect();

            const statusList = await Promise.all(
                devices.map(async (d) => {
                    const cached = await redisClient.get(`status:${schema}:${d.id}`);
                    const metrics = cached ? JSON.parse(cached) : null;
                    return { ...d, metrics };
                })
            );

            await redisClient.disconnect();
            res.json(statusList);
        } catch {
            // Redis unavailable — return devices without metrics
            res.json(devices.map(d => ({ ...d, metrics: null })));
        }
    } catch (err) { next(err); }
});

module.exports = router;
