// The AniLibria project has changed domains several times in recent years
// due to blocking in Russia; the current live site and API are at
// aniliberty.top (the old anilibria.tv now serves an anti-DDoS placeholder
// and can't be scraped). Open v1 API, no keys: https://aniliberty.top/api/v1/
const { fetchWithTimeout } = require('./http');

const ANILIBERTY_HOSTS = new Set(['aniliberty.top', 'anilibria.top']);
const API_BASE = 'https://aniliberty.top/api/v1';

function mapRelease(data) {
  if (!data || !data.id) return null;
  const posterPath = data.poster?.optimized?.src || data.poster?.src || null;
  const genres = (data.genres || []).map((g) => g.name).join(', ');
  return {
    title: data.name?.main || data.name?.english || data.alias,
    description: data.description || '',
    coverUrl: posterPath ? `https://cdn.anilibria.top${posterPath}` : null,
    genres,
  };
}

async function fetchById(id) {
  const res = await fetchWithTimeout(`${API_BASE}/anime/releases/${id}`);
  if (!res.ok) return null;
  return mapRelease(await res.json());
}

async function search(query) {
  const res = await fetchWithTimeout(`${API_BASE}/app/search/releases?query=${encodeURIComponent(query)}`);
  if (!res.ok) return null;
  const list = await res.json();
  const top = Array.isArray(list) ? list[0] : null;
  if (!top) return null;
  // The search results list has no genres — fetch them via a full lookup by id.
  return fetchById(top.id);
}

// The title page is usually https://aniliberty.top/anime/releases/release/<id>[-slug],
// but there are also links without a numeric id, like .../release/<slug>/episodes —
// in that case, look up the release by its alias via search.
async function fetchByUrl(url) {
  const { pathname } = new URL(url);
  const match = pathname.match(/\/anime\/releases\/release\/([^/]+)/);
  if (!match) return null;

  const idMatch = match[1].match(/^(\d+)/);
  if (idMatch) return fetchById(idMatch[1]);

  return search(match[1].replace(/-/g, ' '));
}

module.exports = { fetchByUrl, ANILIBERTY_HOSTS };
