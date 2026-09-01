const dns = require('dns').promises;
const net = require('net');
const { fetchWithTimeout } = require('./http');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// The app makes server-side HTTP requests to URLs the user enters (og-tag
// parsing, cover downloads). Unchecked, that's classic SSRF: it could be
// tricked into reaching the internal network — localhost, private ranges,
// the cloud metadata endpoint (169.254.169.254), etc. Only http/https to
// public addresses is allowed.
function isPrivateIPv4(parts) {
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64.0.0/10
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true; // link-local, ULA
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1].split('.').map(Number));
  return false;
}

function isPrivateIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isPrivateIPv4(ip.split('.').map(Number));
  if (type === 6) return isPrivateIPv6(ip);
  return true; // unrecognized format — treat as unsafe to be safe
}

// Throws if the URL isn't http(s) or resolves to a private/local address
// (including after DNS lookup — the hostname itself can look harmless).
// Doesn't defend against DNS rebinding (the address could change between
// the check and the actual request) — a deliberate tradeoff for a
// self-hosted personal tracker; full protection would need control at the
// TCP connection level.
async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Links to local addresses are not supported');
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map((r) => r.address);
    } catch {
      throw new Error('Could not resolve an address for this URL');
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error('This URL points to an internal address — such links are not supported');
  }

  return parsed;
}

// fetch() with redirect:'follow' would only check SSRF for the original URL,
// then silently follow the redirect anywhere, including the internal
// network — a site under an attacker's control could return a 302 to
// localhost. So redirects here aren't trusted to the built-in fetch; they're
// checked and followed manually instead.
async function safeFetch(url, options = {}, timeoutMs) {
  let currentUrl = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHttpUrl(currentUrl);
    const res = await fetchWithTimeout(currentUrl, { ...options, redirect: 'manual' }, timeoutMs);
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) return res;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

module.exports = { assertPublicHttpUrl, safeFetch };
