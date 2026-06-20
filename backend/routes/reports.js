// ═══════════════════════════════════════════════════════════
//  routes/reports.js  –  CRUD de reportes SAGE
//  MIGRADO a PostgreSQL (placeholders $1,$2...)
//  + Sincronización automática con Google Sheets (Apps Script)
// ═══════════════════════════════════════════════════════════
const express     = require('express');
const { db }      = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// ── CONFIG: URL del Web App de Google Apps Script ────────
const GOOGLE_SHEETS_WEBHOOK_URL =
  process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
  "https://script.google.com/macros/s/AKfycbwYD9dYDrpW9aLO4z7FsmJtqGZ2FsZICkZIJJR1ycCxuWuCSr_OI-RPxvprIt_LOX4R/exec";

// ── HELPER: enviar reporte a Google Sheets (no bloqueante) ─
async function syncToGoogleSheets(payload) {
  if (!GOOGLE_SHEETS_WEBHOOK_URL) {
    console.warn('[SHEETS] GOOGLE_SHEETS_WEBHOOK_URL no configurada — se omite sincronización.');
    return;
  }
  try {
    const formBody = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => formBody.append(key, value ?? ''));

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      body: formBody,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`[SHEETS] ✓ Reporte ${payload.id} sincronizado con Google Sheets.`);

  } catch (err) {
    console.error(`[SHEETS] ⚠ No se pudo sincronizar el reporte ${payload.id} con Google Sheets:`, err.message);
  }
}

// ── GET /api/reports ──────────────────────────────────────
// MOLOS ve TODOS. Cualquier otro ve solo los suyos.
router.get('/', async (req, res) => {
  try {
    let reports;

    if (req.user.role === 'molos') {
      reports = await db.allAsync(`
        SELECT r.*, u.username AS submitted_by
        FROM reports r
        JOIN users u ON r.user_id = u.id
        ORDER BY r.id DESC
      `);
    } else {
      reports = await db.allAsync(`
        SELECT r.*, u.username AS submitted_by
        FROM reports r
        JOIN users u ON r.user_id = u.id
        WHERE r.user_id = $1
        ORDER BY r.id DESC
      `, [req.user.id]);
    }

    const mapped = reports.map(r => ({
      id:            r.report_code,
      eventDate:     r.event_date,
      categories:    r.categories,
      title:         r.title,
      what:          r.what,
      who:           r.who_field,
      where:         r.where_field,
      sectorBase:    r.sector_base,
      submitDate:    r.submit_date,
      status:        r.status,
      latLon:        r.lat_lon,
      fileUrl:       r.file_url,
      author:        r.username,
      authorDisplay: r.author_display,
      submittedBy:   r.submitted_by,
      createdAt:     r.created_at,
      dbId:          r.id,
    }));

    res.json(mapped);

  } catch (err) {
    console.error('[REPORTS] Error en GET /:', err.message);
    res.status(500).json({ error: 'Error al obtener reportes.' });
  }
});

// ── POST /api/reports ─────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      report_code, event_date, categories, title,
      what, who, where: whereField, sector_base,
      submit_date, status, lat_lon, file_url,
      author_display, description
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'El campo title es requerido.' });
    }

    // 1) Guardar SIEMPRE en Postgres primero (fuente de verdad)
    //    RETURNING id → para obtener el id generado (equivalente a lastID)
    const result = await db.runAsync(`
      INSERT INTO reports
        (report_code, user_id, username, event_date, categories, title,
         what, who_field, where_field, sector_base, submit_date,
         status, lat_lon, file_url, author_display, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
    `, [
      report_code    || '#?',
      req.user.id,
      req.user.username,
      event_date     || '',
      categories     || '',
      title,
      what           || '',
      who            || '',
      whereField     || '',
      sector_base    || '',
      submit_date    || '',
      status         || 'OPEN',
      lat_lon        || '',
      file_url       || 'No attachment',
      author_display || '',
      description    || '',
    ]);

    const newId = result.rows[0].id;
    const finalReportCode = report_code || '#?';

    // 2) Responder al usuario YA — no esperamos a Google Sheets
    res.status(201).json({
      message:     'Reporte guardado.',
      dbId:        newId,
      report_code: finalReportCode
    });

    // 3) Sincronizar con Google Sheets EN SEGUNDO PLANO
    syncToGoogleSheets({
      id:            finalReportCode,
      eventDate:     event_date  || '',
      categories:    categories  || '',
      title:         title,
      what:          what        || '',
      who:           who         || '',
      where:         whereField  || '',
      author:        req.user.username,
      authorDisplay: author_display || '',
      sectorBase:    sector_base || '',
      submitDate:    submit_date || '',
      status:        status      || 'OPEN',
      latLon:        lat_lon     || '',
      fileUrl:       file_url    || 'No attachment',
    });

  } catch (err) {
    console.error('[REPORTS] Error en POST /:', err.message);
    res.status(500).json({ error: 'Error al guardar el reporte.' });
  }
});

// ── PATCH /api/reports/:dbId  –  Actualizar status ───────
router.patch('/:dbId', async (req, res) => {
  try {
    const { dbId } = req.params;
    const { status } = req.body;

    if (!['OPEN', 'CLOSE'].includes(status)) {
      return res.status(400).json({ error: 'Status debe ser OPEN o CLOSE.' });
    }

    const report = await db.getAsync('SELECT * FROM reports WHERE id = $1', [dbId]);
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado.' });

    if (req.user.role !== 'molos' && report.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin permisos para editar este reporte.' });
    }

    await db.runAsync('UPDATE reports SET status = $1 WHERE id = $2', [status, dbId]);
    res.json({ message: 'Status actualizado.' });

  } catch (err) {
    console.error('[REPORTS] Error en PATCH:', err.message);
    res.status(500).json({ error: 'Error al actualizar el reporte.' });
  }
});

// ── DELETE /api/reports/:dbId ─────────────────────────────
router.delete('/:dbId', async (req, res) => {
  try {
    const { dbId } = req.params;
    const report = await db.getAsync('SELECT * FROM reports WHERE id = $1', [dbId]);
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado.' });

    if (req.user.role !== 'molos' && report.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sin permisos.' });
    }

    await db.runAsync('DELETE FROM reports WHERE id = $1', [dbId]);
    res.json({ message: 'Reporte eliminado.' });

  } catch (err) {
    console.error('[REPORTS] Error en DELETE:', err.message);
    res.status(500).json({ error: 'Error al eliminar el reporte.' });
  }
});

module.exports = router;
