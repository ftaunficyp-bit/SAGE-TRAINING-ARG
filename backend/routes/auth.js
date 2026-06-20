// ═══════════════════════════════════════════════════════════
//  routes/auth.js  –  POST /api/auth/login  |  GET /api/auth/me
//  MIGRADO a PostgreSQL — placeholders $1, $2 en vez de ?
// ═══════════════════════════════════════════════════════════
const express     = require('express');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const { db }      = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    // Postgres: LOWER() funciona igual, placeholder es $1
    const user = await db.getAsync(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username.trim()]
    );

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });

  } catch (err) {
    console.error('[AUTH] Error en login:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.getAsync(
      'SELECT id, username, role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ user });
  } catch (err) {
    console.error('[AUTH] Error en /me:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
