const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { fetchMetadata } = require('../providers');
const { downloadCover } = require('../providers/cover');
const { assertPublicHttpUrl } = require('../providers/ssrf-guard');
const { LIMITS, truncate } = require('../limits');
const { CONFIG } = require('../config');
const { logAction } = require('../action-log');

const router = express.Router();

const STATUSES = ['planned', 'watching', 'watched', 'dropped'];
const NO_ADD_MODAL = { open: false };
const MAX_COVER_SIZE = CONFIG.MAX_COVER_UPLOAD_MB * 1024 * 1024;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_SIZE },
  fileFilter: (req, file, cb) => {
    // Some browsers/OSes report a generic mimetype like application/octet-stream
    // for certain formats — fall back to the file extension in that case.
    const looksLikeImage = file.mimetype.startsWith('image/') || IMAGE_EXT_RE.test(file.originalname || '');
    if (!looksLikeImage) return cb(new Error('NOT_IMAGE'));
    cb(null, true);
  },
});

// Detects whether the entered text looks like a URL, so the user doesn't
// have to pick between separate "URL" and "title" fields.
function parseAsUrl(text) {
  if (text.length > LIMITS.URL) return null;
  try {
    const u = new URL(text);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    /* doesn't look like a URL with a protocol — try prepending https:// below */
  }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text) && !text.includes(' ')) {
    try {
      const u = new URL('https://' + text);
      return u.toString();
    } catch {
      /* still not a URL */
    }
  }
  return null;
}

// Hands back to the OS the space freed by replacing/removing a cover (see
// the auto_vacuum comment in db.js). Cheap to call even with no real
// changes — if there's nothing to reclaim, it's nearly a no-op.
function reclaimSpace() {
  try {
    db.pragma('incremental_vacuum');
  } catch {
    /* not critical — space will be reclaimed on the next successful call */
  }
}

// Downloads a cover from a URL to store it ourselves instead of depending on
// a third-party site (hotlink protection, dead links). If the site is
// unreachable or doesn't return an image, we keep the external URL as-is —
// better that than no cover at all. But if the URL is blocked outright by
// the SSRF guard (private/local address, not http(s)) — that's not "the site
// didn't respond", it's a direct attempt to smuggle in an internal address;
// in that case `rejected: true`, and the caller must neither save that URL
// as cover_url (it would later end up in an `<img src>` on the page) nor
// use it to wipe out an already-working cover.
async function resolveCoverFields(coverUrl) {
  if (!coverUrl) return { coverUrl: null, coverBlob: null, coverMime: null };
  try {
    await assertPublicHttpUrl(coverUrl);
  } catch {
    return { coverUrl: null, coverBlob: null, coverMime: null, rejected: true };
  }
  const downloaded = await downloadCover(coverUrl);
  if (downloaded) return { coverUrl: null, coverBlob: downloaded.buffer, coverMime: downloaded.mimetype };
  return { coverUrl, coverBlob: null, coverMime: null };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
router.use(requireAuth);

// Default sort (before JS runs) is by date added, newest first; client-side
// JS applies the user's saved preference on top of this. The list (list_id,
// see db.js) is a sub-collection within the account; every query below is
// also scoped to it so lists never bleed into each other.
function listEntries(userId, listId, status) {
  return status
    ? db
        .prepare('SELECT * FROM entries WHERE user_id = ? AND list_id = ? AND status = ? ORDER BY created_at DESC')
        .all(userId, listId, status)
    : db.prepare('SELECT * FROM entries WHERE user_id = ? AND list_id = ? ORDER BY created_at DESC').all(userId, listId);
}

function countsByStatus(userId, listId) {
  return db
    .prepare('SELECT status, COUNT(*) AS n FROM entries WHERE user_id = ? AND list_id = ? GROUP BY status')
    .all(userId, listId)
    .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});
}

// Genres the user has already used in this list — suggested as hints when
// picking genres for other titles in the same list.
function knownGenres(userId, listId) {
  const rows = db
    .prepare("SELECT genres FROM entries WHERE user_id = ? AND list_id = ? AND genres IS NOT NULL AND genres != ''")
    .all(userId, listId);
  const set = new Set();
  for (const row of rows) {
    for (const g of row.genres.split(',')) {
      const t = g.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

// The error/warning modal after a POST isn't rendered directly in the POST
// response — instead we redirect-after-POST: stash the one-shot state in the
// session and immediately redirect to a GET. Otherwise the browser treats the
// page as the result of a POST, and on refresh asks "resubmit form?" —
// resubmitting the same body would reopen the modal with stale data, which
// confuses the user.
function flashAddModal(req, addModal) {
  req.session.addModalFlash = addModal;
}

router.get('/', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const addModal = req.session.addModalFlash || NO_ADD_MODAL;
  const backupResult = req.session.backupFlash || null;
  const listFlash = req.session.listFlash || null;
  delete req.session.addModalFlash;
  delete req.session.backupFlash;
  delete req.session.listFlash;
  res.render('index', {
    entries: listEntries(req.session.userId, res.locals.activeListId, status),
    activeStatus: status,
    counts: countsByStatus(req.session.userId, res.locals.activeListId),
    error: null,
    addModal,
    backupResult,
    listFlash,
    listsLimit: LIMITS.LISTS_COUNT,
  });
});

// Strips punctuation/casing/extra whitespace so titles are compared by
// meaning rather than byte-for-byte.
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[«»"'.,!?:;()[\]{}\-–—]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Looks for already-added titles with the same or a very similar name in
// THIS SAME list — exact match after normalization, or one title fully
// contains the other. Same threshold as the list search (plain substring
// match) — this catches both "Title" vs "Title: Subtitle"/"Title Season 2"
// (different sources tack a subtitle/season onto the same title
// differently) and just a shorter/longer name already entered for it.
// Returns all matches, not just the first. Other lists are deliberately not
// checked — the same title in two different lists isn't a duplicate.
function findTitleDuplicates(userId, listId, title) {
  const norm = normalizeTitle(title || '');
  if (!norm) return [];
  const rows = db.prepare('SELECT id, title, status, rating FROM entries WHERE user_id = ? AND list_id = ?').all(userId, listId);
  const matches = [];
  for (const row of rows) {
    const rowNorm = normalizeTitle(row.title);
    if (!rowNorm) continue;
    const [shorter, longer] = rowNorm.length <= norm.length ? [rowNorm, norm] : [norm, rowNorm];
    if (rowNorm === norm || (shorter.length >= 4 && longer.includes(shorter))) {
      matches.push(row);
    }
  }
  return matches;
}

function insertManual(req, userId, listId, title, sourceUrl = '', sourceDomain = '') {
  const safeTitle = truncate(title, LIMITS.TITLE);
  const info = db
    .prepare(
      `INSERT INTO entries (user_id, list_id, title, description, cover_url, genres, source_url, source_domain, status)
     VALUES (?, ?, ?, '', NULL, NULL, ?, ?, 'planned')`
    )
    .run(userId, listId, safeTitle, truncate(sourceUrl, LIMITS.URL), sourceDomain);
  logAction('entries', 'add', req, ` id=${info.lastInsertRowid} title=${JSON.stringify(safeTitle)}`);
}

router.post('/', async (req, res) => {
  const query = truncate((req.body.query || '').trim(), LIMITS.QUERY);
  // A URL that failed to auto-fetch data on the previous step (captcha/
  // anti-bot/not found). If a URL is submitted again now, we retry it (see
  // the branch below, which isn't tied to carriedUrl); if plain text is
  // submitted, it's a manual title, and carriedUrl is used as the entry's
  // source_url so the link isn't lost just because the site didn't return
  // data for it.
  const carriedUrl = truncate((req.body.url || '').trim(), LIMITS.URL);
  const confirmDuplicate = req.body.confirm_duplicate === '1';
  const listId = res.locals.activeListId;

  if (!query) {
    if (carriedUrl) {
      flashAddModal(req, {
        open: true,
        needsManual: true,
        url: carriedUrl,
        message: res.locals.t('add.errNeedTitleManual'),
      });
    } else {
      flashAddModal(req, { open: true, message: res.locals.t('add.errEmpty') });
    }
    return res.redirect('/entries');
  }

  const url = parseAsUrl(query);

  // Looks like plain text rather than a URL — treat it as a title. If there
  // was already a failed URL attempt (carriedUrl), attach it to the entry as
  // the source instead of losing the link entirely.
  if (!url) {
    if (!confirmDuplicate) {
      const titleDuplicates = findTitleDuplicates(req.session.userId, listId, query);
      if (titleDuplicates.length) {
        flashAddModal(req, { open: true, needsManual: !!carriedUrl, url: carriedUrl, query, titleDuplicates });
        return res.redirect('/entries');
      }
    }
    let sourceDomain = '';
    if (carriedUrl) {
      try {
        sourceDomain = new URL(carriedUrl).hostname.replace(/^www\./, '');
      } catch {
        /* carriedUrl was already validated on the first failed attempt */
      }
    }
    insertManual(req, req.session.userId, listId, query, carriedUrl, sourceDomain);
    return res.redirect('/entries');
  }

  // Looks like a URL — whether this is the first attempt or a retry after a
  // failure on a different URL (the old carriedUrl no longer matters here,
  // we try this one).

  const existing = db
    .prepare('SELECT * FROM entries WHERE user_id = ? AND list_id = ? AND source_url = ?')
    .get(req.session.userId, listId, url);
  if (existing) {
    flashAddModal(req, { open: true, query, duplicate: existing });
    return res.redirect('/entries');
  }

  let meta;
  try {
    meta = await fetchMetadata(url);
  } catch (e) {
    meta = { ok: false };
    void e;
  }

  if (!meta.ok) {
    flashAddModal(req, {
      open: true,
      url,
      needsManual: true,
      message: res.locals.t('add.errFetchFailed'),
    });
    return res.redirect('/entries');
  }

  if (!confirmDuplicate) {
    const titleDuplicates = findTitleDuplicates(req.session.userId, listId, meta.title);
    if (titleDuplicates.length) {
      flashAddModal(req, { open: true, query, titleDuplicates, resolvedTitle: meta.title });
      return res.redirect('/entries');
    }
  }

  const cover = await resolveCoverFields(meta.coverUrl);
  const safeTitle = truncate(meta.title, LIMITS.TITLE);

  const info = db
    .prepare(
      `INSERT INTO entries (user_id, list_id, title, description, cover_url, cover_blob, cover_mime, genres, source_url, source_domain, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')`
    )
    .run(
      req.session.userId,
      listId,
      safeTitle,
      truncate(meta.description, LIMITS.TEXT),
      cover.coverUrl,
      cover.coverBlob,
      cover.coverMime,
      truncate(meta.genres || null, LIMITS.TEXT),
      url,
      meta.sourceDomain
    );
  logAction('entries', 'add', req, ` id=${info.lastInsertRowid} title=${JSON.stringify(safeTitle)}`);

  res.redirect('/entries');
});

// Access to an entry is always checked by both owner and active list — a
// title from another of your own lists can't be opened by id, only by
// switching to that list via the dropdown (see header.ejs / POST /settings/list).
function getOwnedEntry(req, res) {
  return db
    .prepare('SELECT * FROM entries WHERE id = ? AND user_id = ? AND list_id = ?')
    .get(req.params.id, req.session.userId, res.locals.activeListId);
}

router.get('/:id', (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).render('not-found');
  res.render('entry', {
    entry,
    statuses: STATUSES,
    editMode: false,
    uploadError: null,
    knownGenres: knownGenres(req.session.userId, res.locals.activeListId),
    maxCoverMb: MAX_COVER_SIZE / 1024 / 1024,
  });
});

router.get('/:id/edit', (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).render('not-found');
  res.render('entry', {
    entry,
    statuses: STATUSES,
    editMode: true,
    uploadError: null,
    refetchError: null,
    knownGenres: knownGenres(req.session.userId, res.locals.activeListId),
    maxCoverMb: MAX_COVER_SIZE / 1024 / 1024,
  });
});

// Serves a locally uploaded cover straight from the DB. Templates always
// append ?v=<updated_at> to the URL — when the cover changes, the address
// changes with it, so it's safe to cache aggressively: the old version at
// the old URL won't confuse anyone, and the new one is fetched fresh at its
// new URL.
router.get('/:id/cover', (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry || !entry.cover_blob) return res.status(404).end();
  res.set('Content-Type', entry.cover_mime || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(entry.cover_blob);
});

// Full edit — title/description/cover (plus status/rating/note along the way).
// The cover is either a URL or a file uploaded from disk (stored in the DB itself).
router.post(
  '/:id',
  (req, res, next) => {
    upload.single('cover_file')(req, res, (err) => {
      if (!err) return next();

      const entry = getOwnedEntry(req, res);
      if (!entry) return res.status(404).render('not-found');
      const message =
        err.message === 'NOT_IMAGE'
          ? res.locals.t('cover.errNotImage')
          : res.locals.t('cover.errTooBig', { max: MAX_COVER_SIZE / 1024 / 1024 });
      res.status(400).render('entry', {
        entry,
        statuses: STATUSES,
        editMode: true,
        uploadError: message,
        refetchError: null,
        knownGenres: knownGenres(req.session.userId, res.locals.activeListId),
        maxCoverMb: MAX_COVER_SIZE / 1024 / 1024,
      });
    });
  },
  async (req, res) => {
    const entry = getOwnedEntry(req, res);
    if (!entry) return res.status(404).render('not-found');

    const { title, description, cover_url, remove_cover, source_url, status, rating, note } = req.body;
    const safeStatus = STATUSES.includes(status) ? status : entry.status;
    const safeRating =
      rating && String(rating).trim() !== '' ? Math.min(10, Math.max(1, parseInt(rating, 10))) : null;

    let coverUrl = entry.cover_url;
    let coverBlob = entry.cover_blob;
    let coverMime = entry.cover_mime;
    if (req.file) {
      // An uploaded file takes priority over a pasted URL — store it as-is locally.
      coverBlob = req.file.buffer;
      coverMime = req.file.mimetype;
      coverUrl = null;
    } else if (remove_cover) {
      coverUrl = null;
      coverBlob = null;
      coverMime = null;
    } else if (cover_url && cover_url.trim()) {
      // This field is deliberately blank while an uploaded image is active
      // (see the template) — an empty value on its own must not clear
      // anything, otherwise any form save (e.g. editing just the title)
      // would silently wipe an already-uploaded cover.
      const trimmedCoverUrl = cover_url.trim();
      if (trimmedCoverUrl.length <= LIMITS.URL) {
        const resolved = await resolveCoverFields(trimmedCoverUrl);
        // rejected (private/local address) — leave the current cover as-is
        // (see resolveCoverFields) instead of replacing it with null.
        if (!resolved.rejected) {
          coverUrl = resolved.coverUrl;
          coverBlob = resolved.coverBlob;
          coverMime = resolved.coverMime;
        }
      }
    }

    let sourceUrl = entry.source_url;
    let sourceDomain = entry.source_domain;
    if (source_url !== undefined) {
      sourceUrl = truncate(source_url.trim(), LIMITS.URL);
      try {
        sourceDomain = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, '') : '';
      } catch {
        sourceDomain = '';
      }
    }

    const safeTitle = truncate(title?.trim(), LIMITS.TITLE) || entry.title;
    db.prepare(
      `UPDATE entries SET
         title = ?, description = ?, cover_url = ?, cover_blob = ?, cover_mime = ?,
         source_url = ?, source_domain = ?,
         status = ?, rating = ?, note = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND list_id = ?`
    ).run(
      safeTitle,
      description !== undefined ? truncate(description, LIMITS.TEXT) : entry.description,
      coverUrl,
      coverBlob,
      coverMime,
      sourceUrl,
      sourceDomain,
      safeStatus,
      safeRating,
      note !== undefined ? truncate(note, LIMITS.TEXT) : entry.note,
      entry.id,
      req.session.userId,
      res.locals.activeListId
    );
    reclaimSpace();
    logAction('entries', 'update', req, ` id=${entry.id} title=${JSON.stringify(safeTitle)}`);

    res.redirect(`/entries/${entry.id}`);
  }
);

// Saves a cover URL right after the client validates it (see
// initCoverUrlCheck in app.js) instead of waiting for the next "Save" click.
// Without this, a cover already shown in the preview was lost if the user
// did something else on the same page without explicitly saving — e.g.
// "Refetch" on the source URL sends the form to a different route (/refetch)
// that reads the cover from the DB, not from the not-yet-saved form field,
// silently dropping the unsaved choice on page reload.
router.post('/:id/cover-url', express.json(), async (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).end();

  const coverUrl = truncate(String(req.body.cover_url || '').trim(), LIMITS.URL);
  if (!coverUrl) return res.status(400).end();

  const resolved = await resolveCoverFields(coverUrl);
  // rejected (private/local address) — don't touch the already-saved cover
  // at all (see resolveCoverFields), no UPDATE.
  if (!resolved.rejected) {
    db.prepare(
      `UPDATE entries SET cover_url = ?, cover_blob = ?, cover_mime = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND list_id = ?`
    ).run(resolved.coverUrl, resolved.coverBlob, resolved.coverMime, entry.id, req.session.userId, res.locals.activeListId);
    reclaimSpace();
  }
  const downloaded = !!resolved.coverBlob;
  logAction('entries', 'cover', req, ` id=${entry.id} via=url downloaded=${downloaded}${resolved.rejected ? ' rejected=ssrf' : ''}`);

  // Whether the server downloaded it or not, we tell the client explicitly
  // rather than leave it to load the image itself in the browser (see
  // initCoverUrlCheck in app.js): the server isn't subject to mixed-content
  // blocking on an HTTPS page, referrer filters, or other browser reasons why
  // the same URL loads server-side but fails in an `<img>`.
  res.status(200).json({ downloaded });
});

// Same as above but for a file from disk (see initCoverFilePreview in
// app.js) — saved immediately on selection/drop, for the same reason as
// /cover-url above.
router.post(
  '/:id/cover-file',
  (req, res, next) => {
    upload.single('cover_file')(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({
        error: err.message === 'NOT_IMAGE' ? 'NOT_IMAGE' : 'TOO_BIG',
        maxMb: MAX_COVER_SIZE / 1024 / 1024,
      });
    });
  },
  (req, res) => {
    const entry = getOwnedEntry(req, res);
    if (!entry) return res.status(404).end();
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });

    db.prepare(
      `UPDATE entries SET cover_url = NULL, cover_blob = ?, cover_mime = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND list_id = ?`
    ).run(req.file.buffer, req.file.mimetype, entry.id, req.session.userId, res.locals.activeListId);
    reclaimSpace();
    logAction('entries', 'cover', req, ` id=${entry.id} via=file`);

    res.status(204).end();
  }
);

// Re-fetches title/description/genres/cover from the source URL — useful
// when the link was added/changed manually and you want to auto-fill the
// data. Doesn't touch personal fields (status/rating/note). If nothing was
// found, the entry stays unchanged and a warning is shown.
router.post('/:id/refetch', upload.single('cover_file'), async (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).render('not-found');

  const sourceUrl = truncate((req.body.source_url || '').trim(), LIMITS.URL);
  if (!sourceUrl) {
    return res.render('entry', {
      entry,
      statuses: STATUSES,
      editMode: true,
      uploadError: null,
      refetchError: res.locals.t('edit.errNoSourceUrl'),
      knownGenres: knownGenres(req.session.userId, res.locals.activeListId),
      maxCoverMb: MAX_COVER_SIZE / 1024 / 1024,
    });
  }

  let meta;
  try {
    meta = await fetchMetadata(sourceUrl);
  } catch (e) {
    meta = { ok: false };
    void e;
  }

  if (!meta.ok) {
    return res.render('entry', {
      entry: { ...entry, source_url: sourceUrl },
      statuses: STATUSES,
      editMode: true,
      uploadError: null,
      refetchError: res.locals.t('edit.errRefetchFailed'),
      knownGenres: knownGenres(req.session.userId, res.locals.activeListId),
      maxCoverMb: MAX_COVER_SIZE / 1024 / 1024,
    });
  }

  // Only update the cover if the new URL found anything AND the image was
  // actually downloaded. If the source has no og:image, or it does but
  // downloading failed (hotlink protection, dead link, etc.), don't
  // overwrite the already-saved cover with a broken external link.
  let coverUrl = entry.cover_url;
  let coverBlob = entry.cover_blob;
  let coverMime = entry.cover_mime;
  if (meta.coverUrl) {
    const resolved = await resolveCoverFields(meta.coverUrl);
    if (resolved.coverBlob) {
      coverUrl = resolved.coverUrl;
      coverBlob = resolved.coverBlob;
      coverMime = resolved.coverMime;
    }
  }

  const sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '');
  const safeTitle = truncate(meta.title, LIMITS.TITLE);
  db.prepare(
    `UPDATE entries SET title = ?, description = ?, genres = ?, cover_url = ?, cover_blob = ?, cover_mime = ?,
       source_url = ?, source_domain = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND list_id = ?`
  ).run(
    safeTitle,
    truncate(meta.description, LIMITS.TEXT),
    truncate(meta.genres || null, LIMITS.TEXT),
    coverUrl,
    coverBlob,
    coverMime,
    sourceUrl,
    sourceDomain,
    entry.id,
    req.session.userId,
    res.locals.activeListId
  );
  reclaimSpace();
  logAction('entries', 'refetch', req, ` id=${entry.id} title=${JSON.stringify(safeTitle)}`);

  res.redirect(`/entries/${entry.id}/edit`);
});

// Quick update of status/rating/note from a title's card — doesn't touch
// title/description/cover. Fields absent from the request stay as they
// were (matters because status/rating are each saved separately, right away).
router.post('/:id/status', (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).render('not-found');

  const { status, rating, note } = req.body;
  const safeStatus = status !== undefined && STATUSES.includes(status) ? status : entry.status;
  const safeRating =
    rating !== undefined
      ? String(rating).trim() !== ''
        ? Math.min(10, Math.max(1, parseInt(rating, 10)))
        : null
      : entry.rating;

  db.prepare(
    `UPDATE entries SET status = ?, rating = ?, note = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND list_id = ?`
  ).run(
    safeStatus,
    safeRating,
    note !== undefined ? truncate(note, LIMITS.TEXT) : entry.note,
    entry.id,
    req.session.userId,
    res.locals.activeListId
  );
  const changedFields = ['status', 'rating', 'note'].filter((f) => req.body[f] !== undefined);
  logAction('entries', 'status', req, ` id=${entry.id} fields=${changedFields.join(',')}`);

  res.redirect(`/entries/${entry.id}`);
});

// Genres get their own endpoint for instant saving without a page reload
// (the dropdown widget on the card sends the full updated list here via fetch).
router.post('/:id/genres', express.json(), (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).end();

  const genres = Array.isArray(req.body.genres)
    ? req.body.genres
        .slice(0, LIMITS.GENRES_COUNT)
        .map((g) => truncate(String(g).trim(), LIMITS.GENRE))
        .filter(Boolean)
        .join(', ')
    : truncate(String(req.body.genres || '').trim(), LIMITS.GENRE);

  db.prepare(
    `UPDATE entries SET genres = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND list_id = ?`
  ).run(genres || null, entry.id, req.session.userId, res.locals.activeListId);
  logAction('entries', 'genres', req, ` id=${entry.id}`);

  res.status(204).end();
});

router.post('/:id/delete', (req, res) => {
  const entry = getOwnedEntry(req, res);
  if (!entry) return res.status(404).render('not-found');
  db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ? AND list_id = ?').run(
    entry.id,
    req.session.userId,
    res.locals.activeListId
  );
  reclaimSpace();
  logAction('entries', 'delete', req, ` id=${entry.id} title=${JSON.stringify(entry.title)}`);
  res.redirect('/entries');
});

module.exports = router;
