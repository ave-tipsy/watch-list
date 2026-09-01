// Operational settings worth tuning per deployment (slow network, weak NAS,
// different security requirements) — unlike src/limits.js, where the limits
// just guard against DB bloat and shouldn't be touched. Each is read from an
// env var once at startup; a missing or garbage value (typo, not a number,
// zero/negative) silently falls back to the default instead of breaking the
// server.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const CONFIG = {
  MAX_COVER_UPLOAD_MB: envNumber('MAX_COVER_UPLOAD_MB', 10), // cover file uploaded from disk
  MAX_COVER_FETCH_MB: envNumber('MAX_COVER_FETCH_MB', 20), // cover downloaded from a URL
  MAX_BACKUP_MB: envNumber('MAX_BACKUP_MB', 100), // uploaded backup file
  SESSION_MAX_AGE_DAYS: envNumber('SESSION_MAX_AGE_DAYS', 30),
  LOGIN_MAX_ATTEMPTS: envNumber('LOGIN_MAX_ATTEMPTS', 10), // login attempts before rate-limiting (multi-user mode)
  LOGIN_WINDOW_MINUTES: envNumber('LOGIN_WINDOW_MINUTES', 10),
  FETCH_TIMEOUT_MS: envNumber('FETCH_TIMEOUT_MS', 8000), // timeout for requests to external provider sites
};

module.exports = { CONFIG };
