// Tiny key-based i18n: flat JSON dicts per locale, {{var}} interpolation.
// No external i18n library — the app only ever needs two locales and plain
// string substitution, so a dependency would be overkill.
const ru = require('./locales/ru.json');
const en = require('./locales/en.json');

const DICTS = { ru, en };
const DEFAULT_LOCALE = 'ru';

function resolveLocale(locale) {
  return DICTS[locale] ? locale : DEFAULT_LOCALE;
}

function translate(locale, key, vars) {
  const dict = DICTS[resolveLocale(locale)];
  let str = dict[key] || DICTS[DEFAULT_LOCALE][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{{${k}}}`, v);
    }
  }
  return str;
}

// The DB stores created_at/updated_at as UTC with no explicit suffix
// (SQLite's `datetime('now')`) — 'YYYY-MM-DD HH:MM:SS'. new Date() on such a
// string with a space instead of 'T' behaves differently across engines
// (some treat it as local time), so we explicitly coerce it to ISO with 'Z'.
// The format is deliberately the same (DD.MM.YYYY) for both UI languages —
// not Intl.DateTimeFormat with a localized month name, which is both longer
// (doesn't fit the narrow table column in Russian) and not a predictably
// short result.
function formatDate(dbDateString) {
  if (!dbDateString) return '';
  const iso = dbDateString.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

module.exports = { translate, resolveLocale, formatDate, DICTS, DEFAULT_LOCALE };
