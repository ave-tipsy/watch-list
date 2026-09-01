// MyAnimeList itself has no public API, but there's a stable open mirror,
// Jikan (https://jikan.moe) — no keys, no registration.
const { fetchWithTimeout } = require('./http');

const MAL_HOSTS = new Set(['myanimelist.net']);
const API_BASE = 'https://api.jikan.moe/v4';

function mapAnime(data) {
  if (!data) return null;
  const genres = (data.genres || []).map((g) => g.name).join(', ');
  return {
    title: data.title_russian || data.title_english || data.title,
    description: data.synopsis || '',
    coverUrl: data.images?.jpg?.large_image_url || data.images?.jpg?.image_url || null,
    genres,
  };
}

// Title page: https://myanimelist.net/anime/<id>/<slug>
async function fetchByUrl(url) {
  const match = new URL(url).pathname.match(/\/anime\/(\d+)/);
  if (!match) return null;

  const res = await fetchWithTimeout(`${API_BASE}/anime/${match[1]}`);
  if (!res.ok) return null;
  const { data } = await res.json();
  return mapAnime(data);
}

module.exports = { fetchByUrl, MAL_HOSTS };
