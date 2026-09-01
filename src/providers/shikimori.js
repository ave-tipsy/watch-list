// Shikimori — a free open API with no keys, but it asks for a meaningful
// User-Agent instead of the default one. shikimori.one currently redirects
// to shikimori.io — we go straight there to avoid losing the request on the redirect.
const { fetchWithTimeout } = require('./http');

const SHIKIMORI_HOSTS = new Set(['shikimori.one', 'shikimori.me', 'shikimori.io']);
const BASE = 'https://shikimori.io';
const HEADERS = { 'User-Agent': 'watch-list-selfhosted' };

// Shikimori descriptions use BBCode tags ([i]italic[/i], [b]bold[/b], etc.),
// not HTML — just strip the tags, keeping the text.
function stripBBCode(s) {
  return s ? s.replace(/\[\/?[a-z][^\]]*\]/gi, '').replace(/\s+\n/g, '\n').trim() : '';
}

function mapAnime(data) {
  if (!data) return null;
  const posterPath = data.image?.original;
  const genres = (data.genres || []).map((g) => g.russian || g.name).join(', ');
  return {
    title: data.russian || data.name,
    description: stripBBCode(data.description),
    coverUrl: posterPath && !posterPath.includes('missing_') ? `${BASE}${posterPath}` : null,
    genres,
  };
}

async function fetchById(id) {
  const res = await fetchWithTimeout(`${BASE}/api/animes/${id}`, { headers: HEADERS });
  if (!res.ok) return null;
  return mapAnime(await res.json());
}

// Title page: https://shikimori.io/animes/[z]<id>-<slug>
async function fetchByUrl(url) {
  const match = new URL(url).pathname.match(/\/animes\/[a-z]?(\d+)/i);
  if (!match) return null;
  return fetchById(match[1]);
}

module.exports = { fetchByUrl, SHIKIMORI_HOSTS };
