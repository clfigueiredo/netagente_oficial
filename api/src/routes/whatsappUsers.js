// Rotas de WhatsApp users são gerenciadas em /settings/whatsapp-users
// Este módulo existe para manter compatibilidade com o import no app.js
const express = require('express');
const router = express.Router();

// Redireciona GET /whatsapp-users para /settings/whatsapp-users via settings.js
// Mantido vazio intencionalmente — use /settings/whatsapp-users
module.exports = router;
