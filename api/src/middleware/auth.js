const jwt = require('jsonwebtoken');
const { createError } = require('../lib/errors');

/**
 * Verifies JWT and attaches user + tenant metadata to req.
 * Payload: { userId, role, tenantId, tenantSlug, isSuperAdmin }
 */
const authMiddleware = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return next(createError(401, 'Token ausente'));
    }

    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        next(createError(401, 'Token inválido ou expirado'));
    }
};

/**
 * Restricts access to superadmin-only routes.
 */
const requireSuperAdmin = (req, res, next) => {
    if (!req.user?.isSuperAdmin) {
        return next(createError(403, 'Acesso restrito a super administradores'));
    }
    next();
};

/**
 * Restricts access to tenant admin only.
 */
const requireAdmin = (req, res, next) => {
    if (!['admin'].includes(req.user?.role)) {
        return next(createError(403, 'Permissão insuficiente'));
    }
    next();
};

module.exports = { authMiddleware, requireSuperAdmin, requireAdmin };
