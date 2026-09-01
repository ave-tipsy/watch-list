const express = require('express');
const multer = require('multer');
const zlib = require('zlib');
const { db } = require('../db');
const { CONFIG } = require('../config');
const { logAction } = require('../action-log');

const router = express.Router();

const BACKUP_VERSION = 1;
const MAX_BACKUP_SIZE = CONFIG.MAX_BACKUP_MB * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BACKUP_SIZE } });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
router.use(requireAuth);

// One gzip-compressed JSON file — covers travel as base64 inside it, so the
// whole collection round-trips as a single downloadable/uploadable file
// without needing an archive library. Scoped to the active list only (see
// db.js) — exporting is meant for handing off one specific collection, not
// everything in the account at once.
router.get('/export', (req, res) => {
  const listName = res.locals.activeList;
  const rows = db
    .prepare('SELECT * FROM entries WHERE user_id = ? AND list_id = ? ORDER BY id')
    .all(req.session.userId, res.locals.activeListId);
  const payload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    listName,
    entries: rows.map((r) => ({
      title: r.title,
      description: r.description,
      cover_url: r.cover_url,
      cover_blob: r.cover_blob ? r.cover_blob.toString('base64') : null,
      cover_mime: r.cover_mime,
      genres: r.genres,
      source_url: r.source_url,
      source_domain: r.source_domain,
      status: r.status,
      rating: r.rating,
      note: r.note,
      created_at: r.created_at,
    })),
  };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const date = new Date().toISOString().slice(0, 10);
  const rawName = `watch-list-${listName}-${date}.json.gz`;
  // Not all clients understand filename* — keep both: ASCII fallback and a
  // properly encoded UTF-8 name (Cyrillic in a list name is common).
  const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, '_');
  res.set('Content-Type', 'application/gzip');
  res.set(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
  );
  res.send(gz);
});

function readBackupJson(buffer) {
  try {
    return JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  } catch {
    // Accept a plain (non-gzipped) .json export too, for convenience.
    return JSON.parse(buffer.toString('utf8'));
  }
}

const STATUSES = ['planned', 'watching', 'watched', 'dropped'];

// Merge, never replace: skips an entry that already matches one in the SAME
// active list (by source_url for link-based entries, by exact title for
// manual ones — they have no URL to key on), so restoring an old backup
// can't wipe out anything added since, and re-importing the same file twice
// is a no-op instead of piling up duplicates. Always lands in whichever list
// is active right now — the banner after import says which one explicitly,
// since silently guessing here would be exactly the kind of cross-list mixup
// this feature needs to avoid.
router.post('/import', (req, res, next) => {
  upload.single('backup_file')(req, res, (err) => {
    if (err) {
      // Kept separate from "couldn't read the file" — the size limit is
      // known upfront (multer's limit), no reason to confuse the user with
      // the same message used for a corrupt/foreign file.
      req.session.backupFlash =
        err.code === 'LIMIT_FILE_SIZE'
          ? { error: true, tooBig: true, maxMb: CONFIG.MAX_BACKUP_MB }
          : { error: true };
      return res.redirect('/entries');
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.redirect('/entries');

  let data;
  try {
    data = readBackupJson(req.file.buffer);
    if (!Array.isArray(data.entries)) throw new Error('bad shape');
  } catch {
    req.session.backupFlash = { error: true };
    return res.redirect('/entries');
  }

  const userId = req.session.userId;
  const listName = res.locals.activeList;
  const listId = res.locals.activeListId;
  const existsBySourceUrl = db.prepare(
    "SELECT id FROM entries WHERE user_id = ? AND list_id = ? AND source_url = ? AND source_url != ''"
  );
  const existsByTitleNoUrl = db.prepare(
    "SELECT id FROM entries WHERE user_id = ? AND list_id = ? AND source_url = '' AND title = ?"
  );
  const insert = db.prepare(
    `INSERT INTO entries (user_id, list_id, title, description, cover_url, cover_blob, cover_mime, genres, source_url, source_domain, status, rating, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );

  let added = 0;
  let skipped = 0;
  const importMany = db.transaction((entries) => {
    for (const e of entries) {
      const title = String(e.title || '').trim();
      if (!title) continue;
      const sourceUrl = String(e.source_url || '');
      const isDuplicate = sourceUrl
        ? existsBySourceUrl.get(userId, listId, sourceUrl)
        : existsByTitleNoUrl.get(userId, listId, title);
      if (isDuplicate) {
        skipped += 1;
        continue;
      }
      insert.run(
        userId,
        listId,
        title,
        e.description || '',
        e.cover_url || null,
        e.cover_blob ? Buffer.from(e.cover_blob, 'base64') : null,
        e.cover_mime || null,
        e.genres || null,
        sourceUrl,
        e.source_domain || '',
        STATUSES.includes(e.status) ? e.status : 'planned',
        Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 10 ? e.rating : null,
        e.note || null,
        typeof e.created_at === 'string' ? e.created_at : null
      );
      added += 1;
    }
  });
  importMany(data.entries);
  logAction('backup', 'import', req, ` list=${JSON.stringify(listName)} added=${added} skipped=${skipped}`);

  req.session.backupFlash = { added, skipped, listName };
  res.redirect('/entries');
});

module.exports = router;
