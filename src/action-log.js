// Shared event-log format for all modules (same pattern as logAuthEvent in
// routes/auth.js) — one stdout line per actual data change, no in-process
// buffering and no file writes: storage/rotation is fully delegated to the
// Docker logger (`docker logs`, journald, etc). Single-user mode has no
// login, so "who" is just the IP; multi-user mode also adds the session's
// username.
function logAction(category, event, req, extra = '') {
  const who = req.session && req.session.username ? ` user=${JSON.stringify(req.session.username)}` : '';
  console.log(`[${new Date().toISOString()}] [${category}] ${event} ip=${req.ip}${who}${extra}`);
}

module.exports = { logAction };
