// ═══════════════════════════════════════════════════════════
//  server.js  –  UNITE AWARE Backend
//  Express + PostgreSQL (Neon) + JWT
//  Preparado para deploy en Render.com
// ═══════════════════════════════════════════════════════════
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const { dbReady } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────
// El frontend se sirve desde el MISMO dominio de Render que el backend
// (servimos /public estáticamente), así que CORS '*' es seguro acá.
// Si en el futuro separás frontend y backend en dominios distintos,
// reemplazá '*' por la URL real de tu frontend.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsers ──────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Rate limiting ─────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de login. Espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Demasiadas solicitudes. Intente más tarde.' },
});

// ── Rutas ─────────────────────────────────────────────────
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));

// ── Health check (útil para verificar que Render lo levantó bien) ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Frontend estático ─────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(FRONTEND_DIR));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── Error handler global ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor.'
      : err.message
  });
});

// ── Arrancar servidor DESPUÉS de que Postgres esté listo ──
// IMPORTANTE: en Render hay que escuchar en '0.0.0.0', no en
// 'localhost' — si no, Render no puede enrutar el tráfico externo.
dbReady
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`╔══════════════════════════════════════════╗`);
      console.log(`║   UNITE AWARE Backend — Online          ║`);
      console.log(`║   Puerto: ${String(PORT).padEnd(31)}║`);
      console.log(`║   Entorno: ${(process.env.NODE_ENV || 'development').padEnd(28)}║`);
      console.log(`╚══════════════════════════════════════════╝\n`);
    });
  })
  .catch((err) => {
    console.error('[FATAL] No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
