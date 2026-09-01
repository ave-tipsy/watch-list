// AniList — public GraphQL API, no keys needed.
const { fetchWithTimeout } = require('./http');

const ANILIST_HOSTS = new Set(['anilist.co']);
const API_URL = 'https://graphql.anilist.co';

const FIELDS = `
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large }
  genres
`;
const QUERY_BY_ID = `query($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`;

function stripHtml(s) {
  return s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function mapMedia(media) {
  if (!media) return null;
  return {
    title: media.title?.romaji || media.title?.english || media.title?.native,
    description: stripHtml(media.description),
    coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || null,
    genres: (media.genres || []).join(', '),
  };
}

async function query(gql, variables) {
  const res = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return mapMedia(json?.data?.Media);
}

// Title page: https://anilist.co/anime/<id>/<slug>
async function fetchByUrl(url) {
  const match = new URL(url).pathname.match(/\/anime\/(\d+)/);
  if (!match) return null;
  return query(QUERY_BY_ID, { id: parseInt(match[1], 10) });
}

module.exports = { fetchByUrl, ANILIST_HOSTS };
