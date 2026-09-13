const cheerio = require('cheerio');
const { safeFetch } = require('./ssrf-guard');

// Signs of anti-bot/captcha pages that sites return instead of real content
// (these can themselves have a valid og:title/og:description — e.g.
// Yandex's /showcaptcha — so og tags alone aren't enough).
const BLOCKED_URL_PATTERNS = [/captcha/i, /challenge/i, /\/sorry\//i, /cdn-cgi\/challenge/i, /access[-_]denied/i];
const BLOCKED_TITLE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /are you a (human|robot)/i,
  /проверка браузера/i,
  /подтвердите,? что (вы|запрос)/i,
  /^яндекс$/i,
];

function looksBlocked(finalUrl, title) {
  if (BLOCKED_URL_PATTERNS.some((re) => re.test(finalUrl))) return true;
  if (title && BLOCKED_TITLE_PATTERNS.some((re) => re.test(title))) return true;
  return false;
}

// Many older sites (mostly Russian) still serve HTML not in UTF-8 but in
// windows-1251 etc. — fetch().text() always decodes as UTF-8, which gives
// "�" instead of Cyrillic. We check Content-Type, and if that says nothing,
// fall back to the <meta charset> tag near the top of the document (that
// part of the HTML is always ASCII-compatible).
function detectCharset(buffer, contentType) {
  const fromHeader = /charset=([^;]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].trim().toLowerCase();

  const head = buffer.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i.exec(head);
  if (fromMeta) return fromMeta[1].toLowerCase();

  return 'utf-8';
}

function decodeBody(buffer, contentType) {
  const charset = detectCharset(buffer, contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf-8');
  }
}

// Generic Open Graph / meta tag parsing for a page. Works for most sites
// (imdb.com, myanimelist.net, etc.). Kinopoisk and similar sites with
// strict anti-bot protection may return a captcha placeholder — the result
// is then marked blocked: true, and the caller must not use it as title data.
async function fetchGeneric(url) {
  const res = await safeFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ru,en;q=0.9',
    },
  });
  if (!res.ok) {
    // Not an exception (the request completed), so it never hit the error
    // logging in providers/index.js — but a non-2xx here is exactly the
    // kind of "why did this fail" detail that was previously invisible.
    console.log(
      `[${new Date().toISOString()}] [providers] og-scrape non-ok response url=${JSON.stringify(url)} status=${res.status} finalUrl=${JSON.stringify(res.url || url)}`
    );
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const html = decodeBody(buffer, res.headers.get('content-type'));
  const $ = cheerio.load(html);
  const meta = (name) =>
    $(`meta[property="${name}"]`).attr('content') || $(`meta[name="${name}"]`).attr('content') || null;

  const title = meta('og:title') || $('title').first().text().trim() || null;
  const description = meta('og:description') || meta('description') || null;
  let coverUrl = meta('og:image') || meta('twitter:image') || null;
  if (coverUrl) {
    try {
      coverUrl = new URL(coverUrl, url).toString();
    } catch {
      coverUrl = null;
    }
  }

  const blocked = looksBlocked(res.url || url, title);
  if (blocked) {
    console.log(
      `[${new Date().toISOString()}] [providers] og-scrape looks blocked url=${JSON.stringify(url)} finalUrl=${JSON.stringify(res.url || url)} title=${JSON.stringify(title)}`
    );
  }
  return { title, description, coverUrl, blocked };
}

module.exports = { fetchGeneric };
