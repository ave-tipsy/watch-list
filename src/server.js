const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require('express');
const session = require('express-session');

const { version: APP_VERSION } = require('../package.json');
const { db, ALLOW_REGISTRATIONS, LOCAL_USER_ID, DB_PATH } = require('./db'); // initializes the DB schema on startup
const { translate, formatDate, DICTS } = require('./i18n');
const { LIMITS, truncate } = require('./limits');
const { CONFIG } = require('./config');
const { logAction } = require('./action-log');

const entriesRoutes = require('./routes/entries');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3000;
// Unset by default — Node listens on all interfaces, as before (needed for
// Docker, where the server must be reachable from outside the container).
// Only the Electron wrapper sets it (HOST=127.0.0.1) so the port isn't
// exposed externally and Windows doesn't prompt for a firewall exception.
const HOST = process.env.HOST || undefined;

// If SESSION_SECRET isn't set explicitly, generate one once and keep it next
// to the DB (same volume, survives rebuilds/restarts). The old default was a
// static 'change-me-in-production' string — too easy to forget to change,
// while a hand-written real secret is too easy to accidentally commit to
// docker-compose.yml (happened once). electron/main.js uses the same approach.
function ensureSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(path.dirname(DB_PATH), 'session-secret.txt');
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    /* no file yet — generate one below */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  console.log(`[${new Date().toISOString()}] [startup] generated new SESSION_SECRET (${secretPath})`);
  return secret;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Basic security headers — no helmet-style package needed for just this. The
// app never embeds in other pages or pulls in third-party scripts/fonts, so
// the CSP can stay strict.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: http: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  next();
});

app.use(
  session({
    secret: ensureSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: CONFIG.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
      // Lax blocks the cookie on cross-site POSTs (classic CSRF via a third-party
      // <form>) without breaking normal link navigation.
      sameSite: 'lax',
    },
  })
);

app.use((req, res, next) => {
  if (!ALLOW_REGISTRATIONS) {
    // Single-user mode: no login, every request runs as the one service user.
    req.session.userId = LOCAL_USER_ID;
  }
  res.locals.currentUser = ALLOW_REGISTRATIONS ? req.session.username || null : null;
  res.locals.allowRegistrations = ALLOW_REGISTRATIONS;
  next();
});

// UI language, picked from the gear menu and kept in the session (no cookie-parser
// dependency needed just for one preference). Every template gets t()/locale/the
// full dict as-JSON for the client-side strings app.js needs.
app.use((req, res, next) => {
  const locale = req.session.lang === 'en' ? 'en' : 'ru';
  res.locals.locale = locale;
  res.locals.t = (key, vars) => translate(locale, key, vars);
  res.locals.formatDate = formatDate;
  // Real emoji (not plain text glyphs like ★/☰/▦, which already render the
  // same everywhere) use Twemoji images from /public/emoji (see README there
  // for the CC-BY 4.0 license) instead of system emoji, which look different
  // across Windows/Linux/Mac — this keeps them consistent on any OS/browser.
  res.locals.emoji = (name) => `<img class="emoji" src="/emoji/${name}.svg" alt="" />`;
  res.locals.i18nDict = DICTS[locale];
  res.locals.appVersion = APP_VERSION;
  next();
});

function sameOriginRedirect(req) {
  const referer = req.get('Referer');
  if (!referer) return '/entries';
  try {
    const ref = new URL(referer, `${req.protocol}://${req.get('host')}`);
    if (ref.host === req.get('host')) return ref.pathname + ref.search;
  } catch {
    /* fall through to default */
  }
  return '/entries';
}

app.post('/settings/lang', (req, res) => {
  req.session.lang = req.body.lang === 'en' ? 'en' : 'ru';
  res.redirect(sameOriginRedirect(req));
});

// Lists are named sub-collections of titles within one account, stored in
// their own table (see db.js). Exactly one list per account is is_default —
// it can't be deleted or renamed, and its name always comes from the
// localization (t('list.defaultName')) rather than its own. So switching/
// renaming/deleting operate by id, not by name: two different UI languages
// shouldn't produce two different "names" for the same built-in list.
function knownLists(userId, t) {
  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.is_default AS isDefault, COUNT(e.id) AS n
       FROM lists l LEFT JOIN entries e ON e.list_id = l.id
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY l.is_default DESC, l.name COLLATE NOCASE`
    )
    .all(userId);
  return rows.map((r) => ({ ...r, name: r.isDefault ? t('list.defaultName') : r.name }));
}

// Ensures the account has a default list and returns it — created once on
// first access (the migration in db.js already covers upgrades from older
// versions; this only handles a brand-new account).
function ensureDefaultList(userId) {
  const existing = db.prepare('SELECT id FROM lists WHERE user_id = ? AND is_default = 1').get(userId);
  if (existing) return existing.id;
  const info = db.prepare("INSERT INTO lists (user_id, name, is_default) VALUES (?, '', 1)").run(userId);
  return info.lastInsertRowid;
}

app.use((req, res, next) => {
  if (!req.session.userId) {
    res.locals.activeList = null;
    res.locals.activeListId = null;
    res.locals.knownLists = [];
    return next();
  }
  const userId = req.session.userId;
  let list = req.session.activeListId
    ? db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(req.session.activeListId, userId)
    : null;
  if (!list) {
    const id = ensureDefaultList(userId);
    list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
    req.session.activeListId = list.id;
  }
  res.locals.activeListId = list.id;
  res.locals.activeList = list.is_default ? res.locals.t('list.defaultName') : list.name;
  res.locals.knownLists = knownLists(userId, res.locals.t);
  next();
});

// Switching to an existing list is by id (click on a dropdown item).
// Creating a new one is by name (text input): if a list with that name
// already exists, just switch to it instead of duplicating; the lists-count
// limit is only checked when we actually insert a new row.
app.post('/settings/list', (req, res) => {
  const userId = req.session.userId;
  let switched = false;
  if (userId) {
    if (req.body.list_id !== undefined) {
      const id = parseInt(req.body.list_id, 10);
      const list = db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').get(id, userId);
      if (list) {
        req.session.activeListId = list.id;
        switched = true;
      }
    } else {
      const name = truncate(String(req.body.name || '').trim(), LIMITS.LIST_NAME);
      if (name) {
        // The default list is stored with an empty name — its displayed name
        // only ever comes from the localization below, never from the `name`
        // column — so it wouldn't otherwise be found by the lookup below and
        // a same-named regular list would get created right next to it.
        let list =
          name === res.locals.t('list.defaultName')
            ? db.prepare('SELECT id FROM lists WHERE user_id = ? AND is_default = 1').get(userId)
            : db.prepare('SELECT id FROM lists WHERE user_id = ? AND name = ? AND is_default = 0').get(userId, name);
        if (!list) {
          const count = db.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?').get(userId).n;
          if (count >= LIMITS.LISTS_COUNT) {
            req.session.listFlash = { error: 'tooMany' };
            return res.redirect(sameOriginRedirect(req));
          }
          const info = db.prepare('INSERT INTO lists (user_id, name, is_default) VALUES (?, ?, 0)').run(userId, name);
          list = { id: info.lastInsertRowid };
          logAction('list', 'create', req, ` id=${list.id} name=${JSON.stringify(name)}`);
        }
        req.session.activeListId = list.id;
        switched = true;
      }
    }
  }
  // An actual list switch always redirects to the list overview instead of
  // back to where the request came from — the page the dropdown was opened
  // from (e.g. a specific title's page) almost certainly belongs to the
  // previous list and would 404 after switching. We redirect back to the
  // same page only when the list didn't actually change (limit error,
  // invalid/empty input).
  res.redirect(switched ? '/entries' : sameOriginRedirect(req));
});

app.post('/settings/list/rename', (req, res) => {
  const userId = req.session.userId;
  const id = parseInt(req.body.list_id, 10);
  const newName = truncate(String(req.body.new_name || '').trim(), LIMITS.LIST_NAME);
  if (userId && id && newName) {
    const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(id, userId);
    // The default list can't be renamed — it has no name of its own, it
    // always comes from the localization.
    if (list && !list.is_default) {
      // The default list's name column is empty (see above), so the UNIQUE
      // constraint below never catches a collision with its *displayed*
      // name — check that case explicitly first.
      if (newName === res.locals.t('list.defaultName')) {
        req.session.listFlash = { error: 'duplicate' };
        return res.redirect('/entries');
      }
      try {
        db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(newName, id);
        logAction('list', 'rename', req, ` id=${id} from=${JSON.stringify(list.name)} to=${JSON.stringify(newName)}`);
      } catch (e) {
        if (/UNIQUE/i.test(e.message)) {
          req.session.listFlash = { error: 'duplicate' };
        } else {
          throw e;
        }
      }
    }
  }
  res.redirect('/entries');
});

// Deleting a list deletes all its titles along with the list itself. The
// default list can never be deleted — this rule is what guarantees the
// account always has at least one list to view and add to; regular lists
// can all be deleted down to none.
app.post('/settings/list/delete', (req, res) => {
  const userId = req.session.userId;
  const id = parseInt(req.body.list_id, 10);
  if (userId && id) {
    const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(id, userId);
    if (list && !list.is_default) {
      const deleted = db.prepare('DELETE FROM entries WHERE user_id = ? AND list_id = ?').run(userId, id);
      db.prepare('DELETE FROM lists WHERE id = ?').run(id);
      try {
        db.pragma('incremental_vacuum');
      } catch {
        /* not critical — space will be reclaimed on the next successful call */
      }
      if (req.session.activeListId === id) {
        req.session.activeListId = ensureDefaultList(userId);
      }
      logAction('list', 'delete', req, ` id=${id} name=${JSON.stringify(list.name)} entries=${deleted.changes}`);
    }
  }
  res.redirect('/entries');
});

if (ALLOW_REGISTRATIONS) {
  app.use('/', require('./routes/auth'));
} else {
  // Login/register pages don't exist in single-user mode — if someone hits
  // them anyway (e.g. an old bookmark), just redirect to the entries list.
  app.all(['/login', '/register', '/logout'], (req, res) => res.redirect('/entries'));
}

app.use('/entries', entriesRoutes);
app.use('/backup', backupRoutes);

app.get('/', (req, res) => {
  if (ALLOW_REGISTRATIONS && !req.session.userId) return res.redirect('/login');
  res.redirect('/entries');
});

// HTTPS is opt-in via HTTPS=true + SSL_CERT_PATH/SSL_KEY_PATH (e.g. certs mounted
// from a compose volume). Anything else — plain http, put a reverse proxy in
// front if you need TLS termination there instead.
function start() {
  const mode = ALLOW_REGISTRATIONS ? 'multi-user mode' : 'single-user mode';
  const httpsEnabled = process.env.HTTPS === 'true';
  if (httpsEnabled && process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
    try {
      const cert = fs.readFileSync(process.env.SSL_CERT_PATH);
      const key = fs.readFileSync(process.env.SSL_KEY_PATH);
      listen(https.createServer({ cert, key }, app), () => {
        console.log(`watch-list started on port ${PORT} (https, ${mode})`);
      });
      return;
    } catch (e) {
      console.error(`Failed to load SSL certificate (${e.message}), falling back to http`);
    }
  }
  listen(http.createServer(app), () => {
    console.log(`watch-list started on port ${PORT} (http, ${mode})`);
  });
}

// Wrapper instead of calling server.listen(PORT, HOST, cb) directly — if HOST
// is unset, listen must be called without a second argument at all (passing
// undefined as host isn't guaranteed to behave the same as omitting it).
function listen(server, callback) {
  return HOST ? server.listen(PORT, HOST, callback) : server.listen(PORT, callback);
}

start();
