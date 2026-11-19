'use strict';
const config = require('./config');
const { db, getUser } = require('./db');
const push = require('./push');

let running = false;

async function tick(now = Date.now()) {
  if (running) return { fired: 0 };
  running = true;
  let fired = 0;
  try {
    const due = db.prepare(`
      SELECT * FROM reminders
      WHERE deleted_at IS NULL AND status = 'active'
        AND next_fire_at <= ?
        AND (last_fired_at IS NULL OR last_fired_at < next_fire_at)
      ORDER BY next_fire_at ASC
    `).all(now);
    for (const r of due) {
      const user = getUser(r.openid);
      if (!user) continue;
      await push.fire(r, user);
      db.prepare('UPDATE reminders SET last_fired_at = ?, updated_at = ? WHERE id = ?').run(now, now, r.id);
      fired++;
    }
  } finally {
    running = false;
  }
  return { fired };
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => console.error('[scheduler]', e.message));
  }, config.schedulerIntervalMs);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { tick, start, stop };