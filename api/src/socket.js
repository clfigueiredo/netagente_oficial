const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.PUBLIC_URL,
            methods: ['GET', 'POST'],
            credentials: true
        },
        path: '/socket.io'
    });

    // JWT auth for WebSocket connections
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Token ausente'));

        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = payload;
            next();
        } catch {
            next(new Error('Token inválido'));
        }
    });

    io.on('connection', (socket) => {
        const { tenantSlug, userId } = socket.user;

        // Each user joins their tenant room
        socket.join(`tenant:${tenantSlug}`);
        socket.join(`user:${userId}`);

        // Allow clients to join/leave conversation-specific rooms (for reconnection)
        socket.on('join_conversation', (conversationId) => {
            if (conversationId && typeof conversationId === 'string') {
                socket.join(`conversation:${conversationId}`);
            }
        });

        socket.on('leave_conversation', (conversationId) => {
            if (conversationId && typeof conversationId === 'string') {
                socket.leave(`conversation:${conversationId}`);
            }
        });

        socket.on('disconnect', () => {
            // cleanup handled by Socket.io automatically
        });
    });

    return io;
};

/**
 * Emit to all connections of a specific tenant.
 * @param {string} tenantSlug
 * @param {string} event
 * @param {any} data
 */
const emitToTenant = (tenantSlug, event, data) => {
    io?.to(`tenant:${tenantSlug}`).emit(event, data);
};

/**
 * Emit to a specific user only.
 */
const emitToUser = (userId, event, data) => {
    io?.to(`user:${userId}`).emit(event, data);
};

module.exports = { initSocket, emitToTenant, emitToUser };
