'use strict';
// Scripted deployment: SFTP-upload server/ + deploy/, then run deploy/setup.sh remotely.
// Credentials come from env only (SSH_HOST/SSH_PORT/SSH_USER/SSH_PASS); never stored in repo.
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const ROOT = path.join(__dirname, '..');
const HOST = process.env.SSH_HOST || '8.148.93.37';
const PORT = parseInt(process.env.SSH_PORT || '22', 10);
const USER = process.env.SSH_USER || 'root';
const PASS = process.env.SSH_PASS;
const REMOTE = '/root/rooster-src';
if (!PASS) { console.error('SSH_PASS env required'); process.exit(1); }

const EXCLUDE = new Set(['node_modules', 'data', '.qa-backup', '.git']);

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    const st = fs.statSync(full);
    if (st.isDirectory()) { out.dirs.push(rel); walk(full, base, out); }
    else out.files.push([full, rel]);
  }
  return out;
}

const conn = new Client();
conn.on('ready', async () => {
  console.log(`[ssh] connected ${USER}@${HOST}:${PORT}`);
  conn.sftp(async (err, sftp) => {
    if (err) throw err;
    const mkdir = (p) => new Promise((res, rej) => sftp.mkdir(p, (e) => (e && e.code !== 4 && e.code !== 11 ? rej(e) : res())));
    const put = (l, r) => new Promise((res, rej) => sftp.fastPut(l, r, (e) => (e ? rej(e) : res())));
    await mkdir(REMOTE).catch(() => {});
    for (const sub of ['server', 'deploy']) {
      const base = path.join(ROOT, sub);
      const { dirs, files } = walk(base, base, { dirs: [], files: [] });
      await mkdir(`${REMOTE}/${sub}`).catch(() => {});
      for (const d of dirs) await mkdir(`${REMOTE}/${sub}/${d}`).catch(() => {});
      for (const [l, r] of files) await put(l, `${REMOTE}/${sub}/${r}`);
      console.log(`[sftp] ${sub}: ${files.length} files, ${dirs.length} dirs`);
    }
    sftp.end();
    console.log('[ssh] running deploy/setup.sh (apt/node/pm2/nginx/ufw/cron)...');
    conn.exec(`bash ${REMOTE}/deploy/setup.sh 2>&1`, (e, stream) => {
      if (e) throw e;
      let code = null;
      stream.on('close', (c) => { code = c; });
      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.stderr.on('data', (d) => process.stdout.write(d.toString()));
      stream.on('close', () => {
        console.log(`\n[ssh] setup.sh exit=${code}`);
        conn.exec('curl -fsS http://127.0.0.1:3000/api/health; echo; curl -fsS -o /dev/null -w "nginx:%{http_code}\\n" http://127.0.0.1/api/health; pm2 ls', (e2, s2) => {
          if (e2) { conn.end(); process.exit(code || 1); }
          s2.on('data', (d) => process.stdout.write(d.toString()));
          s2.stderr.on('data', (d) => process.stdout.write(d.toString()));
          s2.on('close', () => { conn.end(); process.exit(code || 0); });
        });
      });
    });
  });
}).on('error', (e) => { console.error('[ssh] error', e.message); process.exit(1); })
  .connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 20000, keepaliveInterval: 15000 });