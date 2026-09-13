const anilibria = require('./anilibria');
const mal = require('./mal');
const shikimori = require('./shikimori');
const anilist = require('./anilist');
const { fetchGeneric } = require('./generic');

const SPECIFIC_PROVIDERS = new Map();
for (const h of anilibria.ANILIBERTY_HOSTS) SPECIFIC_PROVIDERS.set(h, anilibria);
for (const h of mal.MAL_HOSTS) SPECIFIC_PROVIDERS.set(h, mal);
for (const h of shikimori.SHIKIMORI_HOSTS) SPECIFIC_PROVIDERS.set(h, shikimori);
for (const h of anilist.ANILIST_HOSTS) SPECIFIC_PROVIDERS.set(h, anilist);

// We only query a specific provider (AniLibria/MAL/Shikimori/AniList) when
// the URL points directly at it. For every other site, we only use what's on
// the page itself (og tags) — searching a title in a provider it doesn't
// belong to used to occasionally match a completely different title that
// happened to share one word.

// Many Russian-language streaming sites append a marketing suffix to the
// title, like "смотреть [anime/movie] [online] [free] (on) <Site>",
// sometimes with "| SecondBrand" tacked on at the end too. Across every
// example seen, the word "смотреть" ("watch") never appears in a real
// title — so we just truncate the string at its first occurrence.
const WATCH_PHRASE_RE = /\s+смотреть(?=[\s.,:!?]|$).*$/i;

function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

// Some sites (world-art.ru) prepend a one-word category label to the title
// with a dash: "Anime - Maiden Blood". We strip only such a one-word PREFIX.
// A one-word suffix is deliberately left alone — that's usually not the
// site's brand but part of the title itself ("Violet Evergarden — The
// Movie", "Cowboy Bebop — Movie", etc.), and "watch on <Site>" is already
// stripped separately by the regex above. If there are more than two
// segments, or the first segment is also multi-word, it's most likely a
// dash within the title itself (like "Otome game world is tough for
// mobs..."), and we leave it alone.
function cleanTitle(title) {
  const withoutWatchPhrase = title.trim().replace(WATCH_PHRASE_RE, '').trim();

  const parts = withoutWatchPhrase
    .split(/\s[-|–—]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return withoutWatchPhrase;

  const [a, b] = parts;
  if (wordCount(a) === 1 && wordCount(b) > 1) return b;
  return withoutWatchPhrase;
}

// A result is usable for auto-save only if it has a title AND at least some
// content alongside it. A lone title with no description/cover is a common
// sign of an anti-bot page (captcha, "Just a moment...", a placeholder), and
// such results shouldn't silently become the entry's title.
function isUsable(meta) {
  return Boolean(meta && !meta.blocked && meta.title && (meta.description || meta.coverUrl));
}

// Every failure path below used to swallow its error silently, so a real
// network/SSRF/DNS problem and a plain "nothing there" looked identical from
// the outside — `docker logs` had nothing to go on. This logs just the
// exception cases (an actual throw, not a normal "no data" result), with
// enough detail to tell them apart without being noisy on ordinary misses.
function logFetchError(stage, url, err) {
  console.error(`[${new Date().toISOString()}] [providers] ${stage} error url=${JSON.stringify(url)} message=${JSON.stringify(err && err.message)}`);
}

function toResult(primary, hostname) {
  return {
    ok: true,
    sourceDomain: hostname,
    title: cleanTitle(primary.title),
    description: primary.description || '',
    coverUrl: primary.coverUrl || null,
    genres: primary.genres || '',
  };
}

// Returns { ok: true, title, description, coverUrl, genres, sourceDomain }
// or { ok: false, sourceDomain } — in the latter case the caller should ask
// the user to fill in the card manually rather than fall back to the URL.
async function fetchMetadata(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    throw new Error('Invalid URL');
  }

  const provider = SPECIFIC_PROVIDERS.get(hostname);

  let specific = null;
  if (provider) {
    try {
      specific = await provider.fetchByUrl(url);
    } catch (e) {
      logFetchError(`${hostname} provider`, url, e);
      specific = null;
    }
  }

  if (isUsable(specific)) {
    // A specialized provider's API sometimes has no poster (e.g. very
    // recent titles on Shikimori) even though the page itself already has
    // one — fetch just the cover from the page, leave everything else alone.
    if (!specific.coverUrl) {
      try {
        const page = await fetchGeneric(url);
        if (page?.coverUrl) specific = { ...specific, coverUrl: page.coverUrl };
      } catch {
        /* not critical — the cover can be added manually */
      }
    }
    return toResult(specific, hostname);
  }

  // Either the site isn't one of the known providers, or the specific
  // provider didn't recognize the URL/found nothing — use whatever's on the
  // page itself (og tags). Nothing further is tried — if this comes up
  // empty, the user fills in the card manually.
  let generic = null;
  try {
    generic = await fetchGeneric(url);
  } catch (e) {
    logFetchError('generic og-scrape', url, e);
    generic = null;
  }

  if (!isUsable(generic)) {
    // Not necessarily an error — could just be a page with no usable og
    // tags — but logging what actually came back (or didn't) is exactly
    // what's missing when the user only sees "couldn't fetch data".
    console.log(
      `[${new Date().toISOString()}] [providers] no usable metadata url=${JSON.stringify(url)} ` +
        `specific=${specific ? JSON.stringify({ title: specific.title, blocked: specific.blocked }) : 'null'} ` +
        `generic=${generic ? JSON.stringify({ title: generic.title, blocked: generic.blocked }) : 'null'}`
    );
    return { ok: false, sourceDomain: hostname };
  }
  return toResult(generic, hostname);
}

module.exports = { fetchMetadata };
