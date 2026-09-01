const { safeFetch } = require('./ssrf-guard');
const { CONFIG } = require('../config');

// A poster is usually tens to hundreds of KB, so we just store the file
// as-is, without re-compressing. The cap only guards against abnormally huge files.
const MAX_SOURCE_SIZE = CONFIG.MAX_COVER_FETCH_MB * 1024 * 1024;

// Downloads a cover from an external URL to store it in our own DB instead
// of depending on a third-party site (hotlink protection, dead links). On
// any failure it returns null — the caller then keeps the external URL as-is.
async function downloadCover(url) {
  try {
    const res = await safeFetch(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
      },
      15000
    );
    if (!res.ok) return null;

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_SIZE) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_SOURCE_SIZE) return null;

    const mimetype = res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
    return { buffer, mimetype };
  } catch {
    return null;
  }
}

module.exports = { downloadCover };
