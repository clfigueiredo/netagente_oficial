const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const whatsappUserRoutes = require('./routes/whatsappUsers');
const settingsRoutes = require('./routes/settings');
const statusRoutes = require('./routes/status');
const pendingActionsRoutes = require('./routes/pendingActions');
const actionsRoutes = require('./routes/actions');
const skillsRoutes = require('./routes/skills');
const automationsRoutes = require('./routes/automations');
const backupsRoutes = require('./routes/backups');
const wireguardRoutes = require('./routes/wireguard');
const wgServerRoutes = require('./routes/wg_server');

const adminTenantsRoutes = require('./routes/admin/tenants');
const adminSkillsRoutes = require('./routes/admin/skills');
const adminKnowledgeRoutes = require('./routes/admin/knowledge');

const { authMiddleware } = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.PUBLIC_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/auth', authRoutes);

// Internal endpoint: Python agent emits real-time skill step events here → relayed to socket
app.post('/internal/emit', (req, res) => {
    const { emitToTenant } = require('./socket');

    // Validate internal secret instead of IP (supports Docker/PM2 better)
    const secret = req.headers['x-internal-secret'];
    if (process.env.INTERNAL_API_SECRET && secret !== process.env.INTERNAL_API_SECRET) {
        return res.status(403).json({ error: 'Forbidden: invalid internal secret' });
    }

    const { tenant, event, data } = req.body || {};
    if (!tenant || !event) return res.status(400).json({ error: 'tenant and event required' });
    emitToTenant(tenant, event, data || {});
    res.json({ ok: true });
});

// Protected tenant routes
app.use(authMiddleware);
app.use(tenantMiddleware);

app.use('/devices', deviceRoutes);
app.use('/conversations', conversationRoutes);
app.use('/messages', messageRoutes);
app.use('/whatsapp-users', whatsappUserRoutes);
app.use('/settings', settingsRoutes);
app.use('/status', statusRoutes);
app.use('/pending-actions', pendingActionsRoutes);
app.use('/actions', actionsRoutes);
app.use('/skills', skillsRoutes);
app.use('/automations', automationsRoutes);
app.use('/backups', backupsRoutes);
app.use('/wireguard', wireguardRoutes);
app.use('/wg_server', wgServerRoutes);

// Super-admin routes
app.use('/admin/tenants', adminTenantsRoutes);
app.use('/admin/skills', adminSkillsRoutes);
app.use('/admin/knowledge', adminKnowledgeRoutes);

// Global error handler
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || 'Internal server error';

    if (status >= 500) {
        console.error('[api] Error:', err);
    }

    res.status(status).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

module.exports = app;
