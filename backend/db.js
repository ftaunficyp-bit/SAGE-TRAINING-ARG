// ═══════════════════════════════════════════════════════════
//  db.js  –  Database setup & seed
//  MIGRADO: PostgreSQL (Neon) usando la librería 'pg'
//  Reemplaza tanto a better-sqlite3 como a sqlite3.
// ═══════════════════════════════════════════════════════════
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');

// ── Conexión a Neon ────────────────────────────────────────
// DATABASE_URL viene del .env — es el connection string que
// copiás del dashboard de Neon. Tiene esta forma:
// postgresql://usuario:password@host.neon.tech/dbname?sslmode=require
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // Neon requiere SSL
  max: 10,                              // máx conexiones simultáneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en el pool de Postgres:', err.message);
});

// ── Helpers compatibles con el estilo usado en las rutas ──
// Mantenemos nombres similares (runAsync/getAsync/allAsync)
// para que el resto del código cambie lo mínimo posible.
// Postgres usa $1, $2... en vez de ? — los helpers no convierten
// el placeholder automáticamente, así que las queries en las
// rutas usan $1, $2, etc. directamente (ver routes/*.js).

const db = {
  // INSERT / UPDATE / DELETE → devuelve { rowCount, rows }
  runAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return { rowCount: result.rowCount, rows: result.rows };
  },

  // SELECT que devuelve UNA fila (o undefined si no hay)
  getAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
  },

  // SELECT que devuelve MUCHAS filas
  allAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
  },

  // Ejecutar SQL "crudo" (para CREATE TABLE, etc.)
  execAsync: async (sql) => {
    await pool.query(sql);
  },

  pool, // por si se necesita acceso directo (transacciones, etc.)
};

// ── Usuarios predefinidos (seed) ──────────────────────────
const SEED_USERS = [
  { username: 'OP-3-S1-UNFICYP@TRAINING.ARG',        password: 'S1-ALFA-3',        role: 'operator' },
  { username: 'OP-8-S1-UNFICYP@TRAINING.ARG',        password: 'S1-ALFA-8',        role: 'operator' },
  { username: 'OP-18-S1-UNFICYP@TRAINING.ARG',       password: 'S1-BRAVO-18',      role: 'operator' },
  { username: 'OP-32-S1-UNFICYP@TRAINING.ARG',       password: 'S1-BRAVO-32',      role: 'operator' },
  { username: 'OP-38-S1-UNFICYP@TRAINING.ARG',       password: 'S1-CHARLIE-38',    role: 'operator' },
  { username: 'EP-1-S1-UNFICYP@TRAINING.ARG',        password: 'EP-FOXTROT-01',    role: 'operator' },
  { username: 'EP-2-S1-UNFICYP@TRAINING.ARG',        password: 'EP-FOXTROT-02',    role: 'operator' },
  { username: 'EP-3-S1-UNFICYP@TRAINING.ARG',        password: 'EP-FOXTROT-03',    role: 'operator' },
  { username: 'MOLOS-GROUP-S1-UNFICYP@TRAINING.ARG', password: 'MOLOS-COMMAND-00', role: 'molos'    },
];

// ── Inicialización: crear tablas + seed ───────────────────
// dbReady es una Promise — server.js espera a que se resuelva
// antes de poner el servidor a escuchar peticiones.
const dbReady = (async () => {
  console.log('[DB] Conectando a PostgreSQL (Neon)...');

  // Verificar conexión
  await pool.query('SELECT 1');
  console.log('[DB] ✓ Conexión establecida.');

  // Crear tablas — sintaxis Postgres (SERIAL en vez de AUTOINCREMENT,
  // TIMESTAMP en vez de TEXT con datetime('now'))
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'operator',
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reports (
      id             SERIAL PRIMARY KEY,
      report_code    TEXT NOT NULL,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username       TEXT NOT NULL,
      event_date     TEXT,
      categories     TEXT,
      title          TEXT,
      what           TEXT,
      who_field      TEXT,
      where_field    TEXT,
      sector_base    TEXT,
      submit_date    TEXT,
      status         TEXT NOT NULL DEFAULT 'OPEN',
      lat_lon        TEXT,
      file_url       TEXT DEFAULT 'No attachment',
      author_display TEXT,
      description    TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_reports_user   ON reports(user_id);`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);`);

  // Seed de usuarios
  console.log('[DB] Verificando usuarios seed...');
  for (const u of SEED_USERS) {
    const existing = await db.getAsync(
      'SELECT id FROM users WHERE username = $1', [u.username]
    );
    if (!existing) {
      const hash = bcrypt.hashSync(u.password, 12);
      await db.runAsync(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        [u.username, hash, u.role]
      );
      console.log(`  ✓ Usuario creado: ${u.username}`);
    }
  }
  console.log('[DB] Base de datos lista.\n');
})();

module.exports = { db, dbReady };
