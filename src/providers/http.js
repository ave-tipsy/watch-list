const { CONFIG } = require('../config');

const DEFAULT_TIMEOUT_MS = CONFIG.FETCH_TIMEOUT_MS;
const RETRY_DELAY_MS = 400;

async function attempt(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A fetch wrapper with a timeout — when trying several external providers in
// a row, one hung source shouldn't block adding a title entirely. Retries
// once after a short pause on a network-level failure (timeout, connection
// reset/refused, DNS blip) — sources like AniLibria sit behind anti-DDoS
// protection that occasionally hiccups, and a single retry is usually enough
// to get through rather than failing the whole add outright. An HTTP error
// response (404, 403, ...) is a definite answer, not a transient failure, and
// isn't retried — it resolves normally here, same as before.
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    return await attempt(url, options, timeoutMs);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return attempt(url, options, timeoutMs);
  }
}

module.exports = { fetchWithTimeout };
