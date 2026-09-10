// The AniLibria project has changed domains several times in recent years
// due to blocking in Russia; the current live site and API are at
// aniliberty.top (the old anilibria.tv now serves an anti-DDoS placeholder
// and can't be scraped). Open v1 API, no keys: https://aniliberty.top/api/v1/
const { fetchWithTimeout } = require('./http');
const { fetchGeneric } = require('./generic');

const ANILIBERTY_HOSTS = new Set(['aniliberty.top', 'anilibria.top']);
const API_BASE = 'https://aniliberty.top/api/v1';

// title/description/cover come from the page's own OG tags (aniliberty.top
// renders those correctly per-release, season-specific) instead of the
// search API, which can't be queried by exact alias and used to occasionally
// return the wrong season. The API is still used, but only to resolve the
// release id and fetch its genres — OG tags don't carry those. As a bonus,
// this also degrades better if AniLibria's API is ever down: the title
// still comes through from the page itself, just without genres.

async function fetchGenres(id) {
  const res = await fetchWithTimeout(`${API_BASE}/anime/releases/${id}`);
  if (!res.ok) return '';
  const data = await res.json();
  return (data.genres || []).map((g) => g.name).join(', ');
}

// The title page is usually https://aniliberty.top/anime/releases/release/<id>[-slug],
// but there are also links without a numeric id, like .../release/<slug>/episodes —
// in that case, resolve the id by searching for the slug's alias.
async function resolveId(url) {
  const { pathname } = new URL(url);
  const match = pathname.match(/\/anime\/releases\/release\/([^/]+)/);
  if (!match) return null;

  const idMatch = match[1].match(/^(\d+)/);
  if (idMatch) return idMatch[1];

  const res = await fetchWithTimeout(`${API_BASE}/app/search/releases?query=${encodeURIComponent(match[1].replace(/-/g, ' '))}`);
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list) || list.length === 0) return null;
  // Different seasons/spin-offs of the same title (e.g. "-2nd-season",
  // "-ryoushu-no-youjo") often share most keywords, so the fuzzy text search
  // can rank the wrong season first. Prefer a result whose alias exactly
  // matches the URL's slug — that's the actual release the link points to.
  const exact = list.find((r) => r.alias === match[1]);
  return (exact || list[0]).id;
}

async function fetchByUrl(url) {
  // The id resolution (and genres below) go through AniLibria's API — if
  // that's unreachable, we still want the OG-based title/description/cover
  // to come through, just without genres.
  const [page, id] = await Promise.all([fetchGeneric(url), resolveId(url).catch(() => null)]);
  if (!page || page.blocked || !page.title) return null;

  const genres = id ? await fetchGenres(id).catch(() => '') : '';
  return {
    title: page.title,
    description: page.description || '',
    coverUrl: page.coverUrl,
    genres,
  };
}

module.exports = { fetchByUrl, ANILIBERTY_HOSTS };
