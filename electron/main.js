'use strict';

// The desktop build must produce no logs at all — neither to disk nor the
// console. require('./app/server.js') below is a plain require in this same
// process, not a separate child process, so any console.log from the code
// shared with Docker (src/server.js, routes/auth.js — a deliberate choice
// there: login events, SESSION_SECRET auto-generation) would run right here
// and be visible if the app is launched from a terminal instead of by
// double-click. We silence console entirely, as early as possible — before
// any other require — rather than stripping those console.log calls from
// the shared code, which must keep working as-is for the Docker deployment,
// where those logs are actually wanted.
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { app, BrowserWindow, shell } = require('electron');

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Theme, list view (grid/table), etc. are stored client-side via
// localStorage, which in Chromium is scoped to the origin — port included.
// If we picked a random free port every time, the origin would change on
// each launch and all those settings would appear "lost" (really they'd
// just sit under the old, now-unreachable origin). So we first try one
// fixed port, and only fall back to a random one if it's ever taken by
// something else (settings genuinely reset once in that case, but the app
// still starts).
const PREFERRED_PORT = 47823;

async function pickPort() {
  if (await isPortFree(PREFERRED_PORT)) return PREFERRED_PORT;
  return getFreePort();
}

// Put data/ next to the actual running .exe, not in %APPDATA%.
// - A built zip (win-unpacked style, no self-extraction) runs right from
//   wherever it was unzipped — app.getPath('exe') points there, which is
//   exactly the folder we want.
// - PORTABLE_EXECUTABLE_DIR is a hedge in case we go back to a portable
//   target (electron-builder timing): there the .exe runs from a temp
//   extraction folder, and this variable points to the folder with the
//   real .exe.
// - In dev mode (npm start, unpackaged), neither variable is set — we use
//   the electron/ folder.
function getBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return __dirname;
}

// SESSION_SECRET in the original project is a hand-written string in
// docker-compose. Here the app is local with no outside network exposure, so
// we generate the secret once on first run and keep it next to the DB, so
// sessions survive an app restart.
function ensureSessionSecret(dataDir) {
  const secretPath = path.join(dataDir, 'session-secret.txt');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

// After window.confirm() (a native dialog, e.g. when deleting a title) plus
// the navigation that follows, webContents sometimes drifts into blur on its
// own while win.isFocused() still reports true per Electron — the window
// never actually lost native focus at that point, so the 'focus' and
// did-finish-load handlers below don't catch this case. Found and confirmed
// by analyzing a diagnostic log from a real Windows machine (a plain
// webContents.focus() doesn't help here — by that point the real Windows OS
// focus is already off this window). minimize()+restore()+focus() forces
// Windows to recompute focus from scratch — crude (the window visibly
// flickers), but it's the working fix for this specific "stuck" focus.
// Debounced so the window doesn't flicker on every message in a row if the
// desync happens to persist longer than usual.
function setupFocusFix(win) {
  let lastForceRefocusAt = 0;
  function forceRefocus() {
    const now = Date.now();
    if (now - lastForceRefocusAt < 800) return;
    lastForceRefocusAt = now;
    win.minimize();
    win.restore();
    win.focus();
    win.webContents.focus();
  }

  // Opening an external link (see setWindowOpenHandler below) hands OS
  // focus to the system browser. When the user clicks back on the app
  // window, the window itself does regain native focus, but Chromium
  // sometimes fails to sync the renderer/DOM focus along with it — from the
  // outside this looks like "the input field doesn't respond to the
  // keyboard, only paste from clipboard works" (Ctrl+V goes through the menu
  // accelerator rather than DOM focus). We force the sync explicitly every
  // time the window regains focus.
  win.on('focus', () => win.webContents.focus());

  // A single window 'focus' isn't enough: if returning to the app is
  // followed by a full page reload (e.g. a normal form POST redirect)
  // without the window's native focus changing again (it was already
  // focused), the freshly loaded document's renderer focus can end up
  // out of sync — the window's 'focus' event doesn't fire again at that
  // point. We re-sync here too, but only if the window is actually active
  // at that moment — don't steal focus while it's in the background.
  win.webContents.on('did-finish-load', () => {
    if (win.isFocused()) win.webContents.focus();
  });

  win.webContents.on('blur', () => {
    if (win.isFocused()) forceRefocus();
  });
}

let mainWindow;

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupFocusFix(mainWindow);

  // Source links (target="_blank" in views/*.ejs) and window.open() for
  // Google Images cover search would otherwise open in a separate Electron
  // window instead of the system browser — intercept and hand off to shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Safety net: if anything tries to navigate the app window itself away
  // from the local server (plain navigation, not window.open) — send that
  // out to the browser too, rather than inside the Electron window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/entries`);
}

app.whenReady().then(async () => {
  const dataDir = path.join(getBaseDir(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Override what src/server.js reads from env — the server code itself
  // isn't specially adapted for this fork, it already supports HOST
  // independently of Electron (just unused anywhere but this wrapper).
  process.env.DB_PATH = path.join(dataDir, 'watchlist.db');
  process.env.SESSION_SECRET = ensureSessionSecret(dataDir);
  process.env.PORT = String(await pickPort());
  // Loopback only — otherwise the server listens on all interfaces
  // (0.0.0.0), and Windows Firewall treats it as a network service that
  // needs permission. On 127.0.0.1 the port is unreachable from outside the
  // machine in principle, so there's nothing to prompt for.
  process.env.HOST = '127.0.0.1';
  delete process.env.ALLOW_REGISTRATIONS; // single-user mode (default false)
  delete process.env.HTTPS; // local loopback — no TLS needed here

  // app/ is a copy of src/ made by scripts/sync-src.js. server.js starts
  // itself via the side effect at the end of the file (start()).
  require('./app/server.js');

  await createWindow(process.env.PORT);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(process.env.PORT);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
