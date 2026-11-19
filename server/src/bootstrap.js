'use strict';
// On Node 22.5–22.12 node:sqlite sits behind --experimental-sqlite.
// Re-exec ourselves with the flag so `npm start` / `npm test` work on any Node >= 22.5.
try {
  require('node:sqlite');
} catch (e) {
  if (e && e.code === 'ERR_UNKNOWN_BUILTIN_MODULE') {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: process.env
    });
    process.exit(r.status === null ? 1 : r.status);
  }
  throw e;
}
module.exports = {};