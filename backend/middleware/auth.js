// ═══════════════════════════════════════════════════════════
//  middleware/auth.js  –  JWT verification middleware
// ═══════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;   // { id, username, role }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Por favor vuelva a iniciar sesión.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};
