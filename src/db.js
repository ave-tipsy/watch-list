const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'watchlist.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Covers are the heaviest thing stored in the DB, and they get replaced
// periodically (the user tries different links/files). SQLite doesn't shrink
// the file on its own after a row is overwritten with a smaller/different
// BLOB — the freed pages just go to the free list. Incremental auto_vacuum
// lets us hand that space back to the OS on explicit request (see
// `incremental_vacuum` in routes/entries.js) without a blocking full VACUUM.
if (db.pragma('auto_vacuum', { simple: true }) !== 2) {
  db.pragma('auto_vacuum = INCREMENTAL');
  // Takes effect immediately on a fresh empty DB; on an existing one, only
  // after VACUUM, which also shrinks the file if there's already slack in it.
  db.exec('VACUUM');
}

// Lists are separate named collections of titles within one account. Exactly
// one list per account is the "default" one (is_default=1): it can't be
// deleted or renamed (guaranteeing there's always somewhere to add to and
// look at), and its name isn't its own — it comes from the localization
// (src/locales); the DB stores an empty string for it, and the displayed
// name always resolves via t('list.defaultName'). Regular lists have a
// plain user-supplied name, as before.
const LEGACY_DEFAULT_LIST_NAME = 'Основной'; // only for migrating older versions, see below

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    cover_blob BLOB,
    cover_mime TEXT,
    genres TEXT,
    source_url TEXT NOT NULL,
    source_domain TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','watching','watched','dropped')),
    rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 10)),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
`);

// Soft migrations for DBs created before these columns existed.
for (const ddl of [
  'ALTER TABLE entries ADD COLUMN genres TEXT',
  'ALTER TABLE entries ADD COLUMN cover_blob BLOB',
  'ALTER TABLE entries ADD COLUMN cover_mime TEXT',
  // list_name was a transitional field from version 0.0.6, before the lists
  // table existed. We leave the column alone on old DBs (only used below, to
  // populate lists/list_id); new DBs never create it at all.
  `ALTER TABLE entries ADD COLUMN list_name TEXT NOT NULL DEFAULT '${LEGACY_DEFAULT_LIST_NAME}'`,
  'ALTER TABLE entries ADD COLUMN list_id INTEGER REFERENCES lists(id)',
  'ALTER TABLE lists ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0',
]) {
  try {
    db.exec(ddl);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

// If the DB still has list_name values with no matching list_id (upgrading
// from 0.0.6, where the list was just a text field) — create a lists row for
// each (user_id, name) pair found and wire up the references.
const hasListName = db.prepare("SELECT 1 FROM pragma_table_info('entries') WHERE name = 'list_name'").get();
if (hasListName) {
  const pairs = db
    .prepare('SELECT DISTINCT user_id, list_name FROM entries WHERE list_id IS NULL AND list_name IS NOT NULL')
    .all();
  const insertList = db.prepare('INSERT OR IGNORE INTO lists (user_id, name) VALUES (?, ?)');
  for (const p of pairs) insertList.run(p.user_id, p.list_name);
  db.exec(`
    UPDATE entries SET list_id = (
      SELECT id FROM lists WHERE lists.user_id = entries.user_id AND lists.name = entries.list_name
    ) WHERE list_id IS NULL
  `);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_entries_user_list ON entries(user_id, list_id)');

// For every account that doesn't yet have a designated default list (all
// versions before this migration, including ones just created above) —
// mark its earliest list as the default and clear its name (from now on it
// always comes from the localization; storing it in the DB is pointless and
// would only cause trouble when the UI language changes).
const usersWithoutDefault = db
  .prepare(
    `SELECT DISTINCT user_id FROM lists WHERE user_id NOT IN (SELECT user_id FROM lists WHERE is_default = 1)`
  )
  .all();
const pickEarliest = db.prepare('SELECT id FROM lists WHERE user_id = ? ORDER BY id LIMIT 1');
const markDefault = db.prepare("UPDATE lists SET is_default = 1, name = '' WHERE id = ?");
for (const { user_id } of usersWithoutDefault) {
  const earliest = pickEarliest.get(user_id);
  if (earliest) markDefault.run(earliest.id);
}

const ALLOW_REGISTRATIONS = String(process.env.ALLOW_REGISTRATIONS || '').toLowerCase() === 'true';

// Single-user mode has no login or registration — every entry belongs to
// one auto-created service user.
let LOCAL_USER_ID = null;
if (!ALLOW_REGISTRATIONS) {
  const existing = db.prepare("SELECT id FROM users WHERE username = 'local'").get();
  if (existing) {
    LOCAL_USER_ID = existing.id;
  } else {
    const info = db
      .prepare("INSERT INTO users (username, password_hash) VALUES ('local', '')")
      .run();
    LOCAL_USER_ID = info.lastInsertRowid;
  }
}

module.exports = { db, ALLOW_REGISTRATIONS, LOCAL_USER_ID, DB_PATH };
