// Sane length caps for anything the user types (or an external site sends
// during auto-fill) — without this, a megabyte-long "title" isn't an error,
// it's just a silently bloating DB.
const LIMITS = {
  QUERY: 2000, // the "URL or title" field in the add form
  TITLE: 500,
  TEXT: 20000, // description, note
  URL: 2000, // source / cover link
  GENRE: 50, // a single genre
  GENRES_COUNT: 30, // genres per title
  USERNAME: 50,
  PASSWORD: 200,
  LIST_NAME: 50,
  LISTS_COUNT: 128, // lists per account
};

function truncate(str, max) {
  return typeof str === 'string' && str.length > max ? str.slice(0, max) : str;
}

module.exports = { LIMITS, truncate };
