'use strict';

// Copies the server code from the root src/ into electron/app/ before
// start/build. It's a flat copy, not a symlink or submodule — on Windows,
// symlinks require admin rights, and a submodule would complicate a normal
// fork git flow. After any change to the root src/, rerun this script
// (npm run sync), or electron/app/ stays a stale copy.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const DEST = path.join(__dirname, '..', 'app');

if (!fs.existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

console.log(`Synced: ${SRC} -> ${DEST}`);
