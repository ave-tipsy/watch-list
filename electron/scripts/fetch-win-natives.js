'use strict';

// electron-builder's automatic "npmRebuild" step (@electron/rebuild) always
// compiles native addons from source for the HOST platform — it has no
// cross-compile mode. Building the Windows target from Linux/WSL would
// therefore silently bundle a Linux .node file inside the .exe (it "builds"
// without error, but crashes on real Windows). Instead we disable
// npmRebuild (see package.json → build.npmRebuild) and fetch the official
// prebuilt Windows binary for the native deps ourselves via prebuild-install,
// which just downloads a matching binary from the module's GitHub releases —
// no compiler needed for the target platform.

const path = require('path');
const { spawnSync } = require('child_process');

const electronVersion = require('electron/package.json').version;

// Only better-sqlite3 ships native code among this project's dependencies.
// If a future dependency adds another native module, add its name here too.
const NATIVE_MODULES = ['better-sqlite3'];

for (const moduleName of NATIVE_MODULES) {
  const moduleDir = path.join(__dirname, '..', 'node_modules', moduleName);
  const prebuildInstall = path.join(__dirname, '..', 'node_modules', '.bin', 'prebuild-install');

  console.log(`Downloading win32-x64 prebuild for ${moduleName} (electron ${electronVersion})...`);
  const result = spawnSync(
    prebuildInstall,
    ['--runtime=electron', `--target=${electronVersion}`, '--platform=win32', '--arch=x64'],
    { cwd: moduleDir, stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.error(`Failed to fetch win32-x64 prebuild for ${moduleName}.`);
    process.exit(result.status || 1);
  }
}
