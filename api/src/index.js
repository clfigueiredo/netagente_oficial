require('dotenv').config();
const app = require('./app');
const { createServer } = require('http');
const { initSocket } = require('./socket');

const PORT = process.env.PORT || 4000;

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
    console.log(`[api] NetAgent API rodando na porta ${PORT}`);
    console.log(`[api] Ambiente: ${process.env.NODE_ENV}`);
});

process.on('unhandledRejection', (err) => {
    console.error('[api] Unhandled rejection:', err);
});
