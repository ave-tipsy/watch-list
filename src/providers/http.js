const { CONFIG } = require('../config');

const DEFAULT_TIMEOUT_MS = CONFIG.FETCH_TIMEOUT_MS;

// A fetch wrapper with a timeout — when trying several external providers in
// a row, one hung source shouldn't block adding a title entirely.
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout };
