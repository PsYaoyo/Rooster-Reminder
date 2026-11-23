'use strict';
require('../src/bootstrap');
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rooster-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.AUTH_SECRET = 'test-secret';
process.env.SEED_DEMO = '0';
delete process.env.WX_APPID;
delete process.env.WX_SECRET;

const { createApp } = require('../src/app');
const scheduler = require('../src/scheduler');
const { db } = require('../src/db');
const config = require('../src/config');
const wx = require('../src/wx');

const app = createApp();
let server;
let base;
let token;

test('boot server', async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, true);
});

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function grantQuota(times) {
  for (let i = 0; i < times; i++) {
    const challenge = await api('GET', '/api/me/subscribe-challenge');
    assert.equal(challenge.status, 200);
    assert.ok(challenge.data.nonce);
    const granted = await api('POST', '/api/me/subscribe', { nonce: challenge.data.nonce });
    assert.equal(granted.status, 200);
  }
}

test('login dev fallback issues token and creates user', async () => {
  const { status, data } = await api('POST', '/api/login', { code: 'dev_test_user_1' });
  assert.equal(status, 200);
  assert.ok(data.token);
  assert.ok(data.openid.startsWith('dev_'));
  assert.equal(data.dev, true);
  token = data.token;
});

test('unauthorized without token', async () => {
  const saved = token; token = '';
  const { status } = await api('GET', '/api/reminders');
  assert.equal(status, 401);
  token = saved;
});

let onceId, dailyId, urgentId;

test('create once reminder in future', async () => {
  const future = new Date(Date.now() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}`;
  const time = `${p(future.getHours())}:${p(future.getMinutes())}`;
  const { status, data } = await api('POST', '/api/reminders', {
    title: '测试单次提醒', note: '备注', urgency: 2, freq_type: 'once',
    start_date: date, time_str: time, lead_min: 5
  });
  assert.equal(status, 201);
  onceId = data.reminder.id;
  assert.equal(data.reminder.next_fire_at, data.reminder.occurrence_at - 5 * 60000);
});

test('reject past once reminder', async () => {
  const { status } = await api('POST', '/api/reminders', {
    title: '过去', freq_type: 'once', start_date: '2020-01-01', time_str: '08:00', urgency: 1
  });
  assert.equal(status, 400);
});

test('reject invalid urgency and freq', async () => {
  const r1 = await api('POST', '/api/reminders', { title: 'x', urgency: 9, freq_type: 'once', start_date: '2030-01-01', time_str: '08:00' });
  assert.equal(r1.status, 400);
  const r2 = await api('POST', '/api/reminders', { title: 'x', urgency: 1, freq_type: 'hourly', start_date: '2030-01-01', time_str: '08:00' });
  assert.equal(r2.status, 400);
});

test('create daily + urgent interval reminders', async () => {
  const d = await api('POST', '/api/reminders', { title: '每日喝水', urgency: 1, freq_type: 'daily', start_date: '2026-01-01', time_str: '08:00', lead_min: 0 });
  assert.equal(d.status, 201);
  dailyId = d.data.reminder.id;
  const u = await api('POST', '/api/reminders', { title: '紧急吃药', urgency: 4, freq_type: 'interval', interval_value: 8, interval_unit: 'hour', start_date: '2026-01-01', time_str: '08:30', lead_min: 5 });
  assert.equal(u.status, 201);
  urgentId = u.data.reminder.id;
});

test('list filters and search', async () => {
  const all = await api('GET', '/api/reminders');
  assert.equal(all.data.reminders.length, 3);
  const urgent = await api('GET', '/api/reminders?filter=urgent');
  assert.equal(urgent.data.reminders.length, 1);
  assert.equal(urgent.data.reminders[0].id, urgentId);
  const q = await api('GET', '/api/reminders?q=' + encodeURIComponent('喝水'));
  assert.equal(q.data.reminders.length, 1);
  assert.equal(q.data.reminders[0].id, dailyId);
});

test('edit reminder recomputes schedule', async () => {
  const { status, data } = await api('PUT', `/api/reminders/${dailyId}`, { title: '每日喝水 500ml', urgency: 2, lead_min: 15 });
  assert.equal(status, 200);
  assert.equal(data.reminder.title, '每日喝水 500ml');
  assert.equal(data.reminder.next_fire_at, data.reminder.occurrence_at - 15 * 60000);
});

test('snooze pushes fire time and increments count', async () => {
  const before = Date.now();
  const { status, data } = await api('POST', `/api/reminders/${onceId}/snooze`, { minutes: 10 });
  assert.equal(status, 200);
  assert.ok(data.reminder.next_fire_at >= before + 10 * 60000 - 50);
  assert.equal(data.reminder.snooze_count, 1);
  const badSnooze = await api('POST', `/api/reminders/${onceId}/snooze`, { minutes: 7 });
  assert.equal(badSnooze.status, 400);
});

test('complete once marks done; complete daily rolls forward', async () => {
  const c1 = await api('POST', `/api/reminders/${onceId}/complete`);
  assert.equal(c1.data.reminder.status, 'done');
  assert.equal(c1.data.reminder.done_count, 1);
  const before = (await api('GET', '/api/reminders')).data.reminders.find((r) => r.id === dailyId);
  const c2 = await api('POST', `/api/reminders/${dailyId}/complete`);
  assert.equal(c2.data.reminder.status, 'active');
  assert.ok(c2.data.reminder.occurrence_at > before.occurrence_at);
  assert.equal(c2.data.reminder.done_count, 1);
  const again = await api('POST', `/api/reminders/${onceId}/complete`);
  assert.equal(again.status, 400);
});

test('ignore repeat advances without done count', async () => {
  const before = (await api('GET', '/api/reminders?filter=all')).data.reminders.find((r) => r.id === urgentId)
    || db.prepare('SELECT * FROM reminders WHERE id = ?').get(urgentId);
  const { data } = await api('POST', `/api/reminders/${urgentId}/ignore`);
  assert.ok(data.reminder.occurrence_at >= before.occurrence_at);
  assert.equal(data.reminder.done_count, 0);
});

test('delete is soft and restore brings it back', async () => {
  const del = await api('DELETE', `/api/reminders/${onceId}`);
  assert.equal(del.status, 200);
  const list = await api('GET', '/api/reminders?filter=done');
  assert.ok(!list.data.reminders.some((r) => r.id === onceId));
  const res = await api('POST', `/api/reminders/${onceId}/restore`);
  assert.equal(res.status, 200);
  assert.equal(res.data.reminder.deleted, false);
});

test('subscribe grants one quota per nonce and me reflects it', async () => {
  await grantQuota(3);
  const me = await api('GET', '/api/me');
  assert.equal(me.data.user.sub_quota, 3);
  const upd = await api('PUT', '/api/me', { nickname: '打鸣人', muted: true });
  assert.equal(upd.data.user.nickname, '打鸣人');
  assert.equal(upd.data.user.muted, true);
});

test('scheduler fires due reminder, consumes quota, logs mock push', async () => {
  const past = Date.now() - 60000;
  db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL WHERE id = ?').run(past, urgentId);
  const { fired } = await scheduler.tick();
  assert.ok(fired >= 1);
  const me = await api('GET', '/api/me');
  assert.equal(me.data.user.sub_quota, 2);
  const n = await api('GET', '/api/me/notifications');
  assert.ok(n.data.notifications.some((x) => x.reminder_id === urgentId && x.channel === 'mock'));
  const again = await scheduler.tick();
  const row = db.prepare('SELECT last_fired_at FROM reminders WHERE id = ?').get(urgentId);
  assert.ok(row.last_fired_at);
  assert.equal(again.fired, 0);
});

test('scheduler skips when quota exhausted but still marks fired', async () => {
  db.prepare('UPDATE users SET sub_quota = 0 WHERE openid = ?').run(db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid);
  db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL WHERE id = ?').run(Date.now() - 1000, urgentId);
  await scheduler.tick();
  const n = await api('GET', '/api/me/notifications');
  assert.ok(n.data.notifications.some((x) => x.reminder_id === urgentId && x.channel === 'inapp'));
});

test('clear-done removes finished reminders', async () => {
  const { data } = await api('POST', '/api/me/clear-done');
  assert.ok(data.cleared >= 1);
});

test('production login does not accept dev_ codes', async () => {
  const savedToken = token;
  const savedAppId = config.wxAppId;
  const savedSecret = config.wxSecret;
  const savedCode2Session = wx.code2session;
  config.wxAppId = 'wx_test_appid';
  config.wxSecret = 'test_secret';
  wx.code2session = async () => ({ openid: 'real_openid_1' });
  try {
    const { status, data } = await api('POST', '/api/login', { code: 'dev_forged_code' });
    assert.equal(status, 200);
    assert.equal(data.openid, 'real_openid_1');
    assert.equal(data.dev, false);
  } finally {
    config.wxAppId = savedAppId;
    config.wxSecret = savedSecret;
    wx.code2session = savedCode2Session;
    token = savedToken;
  }
});

test('failed WeChat push keeps quota and logs inapp fallback', async () => {
  const savedAppId = config.wxAppId;
  const savedSecret = config.wxSecret;
  const savedTemplateId = config.wxTemplateId;
  const savedSend = wx.sendSubscribe;
  config.wxAppId = 'wx_test_appid';
  config.wxSecret = 'test_secret';
  config.wxTemplateId = 'template_test';
  wx.sendSubscribe = async () => ({ errcode: 43101, errmsg: 'user refuse' });
  try {
    const openid = db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid;
    db.prepare('UPDATE users SET sub_quota = 1 WHERE openid = ?').run(openid);
    db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL WHERE id = ?').run(Date.now() - 1000, urgentId);
    await scheduler.tick();
    const me = await api('GET', '/api/me');
    assert.equal(me.data.user.sub_quota, 1);
    const n = await api('GET', '/api/me/notifications?limit=5');
    const log = n.data.notifications.find((x) => x.reminder_id === urgentId);
    assert.equal(log.channel, 'inapp');
    assert.match(log.body, /43101/);
  } finally {
    config.wxAppId = savedAppId;
    config.wxSecret = savedSecret;
    config.wxTemplateId = savedTemplateId;
    wx.sendSubscribe = savedSend;
  }
});

test('successful WeChat push consumes one quota', async () => {
  const savedAppId = config.wxAppId;
  const savedSecret = config.wxSecret;
  const savedTemplateId = config.wxTemplateId;
  const savedSend = wx.sendSubscribe;
  config.wxAppId = 'wx_test_appid';
  config.wxSecret = 'test_secret';
  config.wxTemplateId = 'template_test';
  wx.sendSubscribe = async () => ({ errcode: 0 });
  try {
    const openid = db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid;
    db.prepare('UPDATE users SET sub_quota = 2 WHERE openid = ?').run(openid);
    db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL WHERE id = ?').run(Date.now() - 1000, urgentId);
    await scheduler.tick();
    const me = await api('GET', '/api/me');
    assert.equal(me.data.user.sub_quota, 1);
    const n = await api('GET', '/api/me/notifications?limit=5');
    const log = n.data.notifications.find((x) => x.reminder_id === urgentId);
    assert.equal(log.channel, 'wechat');
  } finally {
    config.wxAppId = savedAppId;
    config.wxSecret = savedSecret;
    config.wxTemplateId = savedTemplateId;
    wx.sendSubscribe = savedSend;
  }
});

test('subscribe ignores client count and rejects replay, bogus and missing nonce', async () => {
  const openid = db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid;
  db.prepare('UPDATE users SET sub_quota = 0 WHERE openid = ?').run(openid);
  const challenge = await api('GET', '/api/me/subscribe-challenge');
  assert.equal(challenge.status, 200);
  const nonce = challenge.data.nonce;
  const forgedCount = await api('POST', '/api/me/subscribe', { nonce, count: 10 });
  assert.equal(forgedCount.status, 200);
  assert.equal(forgedCount.data.sub_quota, 1);
  assert.equal(forgedCount.data.granted, 1);
  assert.equal((await api('POST', '/api/me/subscribe', { nonce })).status, 400);
  assert.equal((await api('POST', '/api/me/subscribe', { count: 9 })).status, 400);
  assert.equal((await api('POST', '/api/me/subscribe', { nonce: 'not-a-real-nonce' })).status, 400);
  assert.equal((await api('GET', '/api/me')).data.user.sub_quota, 1);
});

test('expired challenge cannot grant quota', async () => {
  const openid = db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid;
  db.prepare('UPDATE users SET sub_quota = 0 WHERE openid = ?').run(openid);
  const challenge = await api('GET', '/api/me/subscribe-challenge');
  db.prepare('UPDATE subscribe_challenges SET expires_at = ? WHERE nonce = ?')
    .run(Date.now() - 1, challenge.data.nonce);
  const res = await api('POST', '/api/me/subscribe', { nonce: challenge.data.nonce });
  assert.equal(res.status, 400);
  assert.equal((await api('GET', '/api/me')).data.user.sub_quota, 0);
});

test('challenge is bound to the user who requested it', async () => {
  const savedToken = token;
  const challenge = await api('GET', '/api/me/subscribe-challenge');
  try {
    const other = await api('POST', '/api/login', { code: 'dev_other_user_2' });
    assert.equal(other.status, 200);
    token = other.data.token;
    const res = await api('POST', '/api/me/subscribe', { nonce: challenge.data.nonce });
    assert.equal(res.status, 400);
  } finally {
    token = savedToken;
  }
});

test('production push is not gated by local quota', async () => {
  const savedAppId = config.wxAppId;
  const savedSecret = config.wxSecret;
  const savedTemplateId = config.wxTemplateId;
  const savedSend = wx.sendSubscribe;
  config.wxAppId = 'wx_test_appid';
  config.wxSecret = 'test_secret';
  config.wxTemplateId = 'template_test';
  wx.sendSubscribe = async () => ({ errcode: 0 });
  try {
    const openid = db.prepare('SELECT openid FROM reminders WHERE id = ?').get(urgentId).openid;
    db.prepare('UPDATE users SET sub_quota = 0 WHERE openid = ?').run(openid);
    db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL WHERE id = ?')
      .run(Date.now() - 1000, urgentId);
    await scheduler.tick();
    const n = await api('GET', '/api/me/notifications?limit=5');
    const log = n.data.notifications.find((x) => x.reminder_id === urgentId);
    assert.equal(log.channel, 'wechat');
    const me = await api('GET', '/api/me');
    assert.equal(me.data.user.sub_quota, 0);
  } finally {
    config.wxAppId = savedAppId;
    config.wxSecret = savedSecret;
    config.wxTemplateId = savedTemplateId;
    wx.sendSubscribe = savedSend;
  }
});

test('filter=all returns finished reminders while done returns only finished', async () => {
  const future = new Date(Date.now() + 4 * 864e5);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}`;
  const created = await api('POST', '/api/reminders', {
    title: '待完成的筛选测试', freq_type: 'once', start_date: date, time_str: '09:00', urgency: 2
  });
  const id = created.data.reminder.id;
  await api('POST', `/api/reminders/${id}/complete`);
  const all = await api('GET', '/api/reminders?filter=all');
  assert.ok(all.data.reminders.some((r) => r.id === id && r.status === 'done'));
  const done = await api('GET', '/api/reminders?filter=done');
  assert.ok(done.data.reminders.every((r) => r.status !== 'active'));
  assert.ok(done.data.reminders.some((r) => r.id === id));
});

test('editing a finished reminder reactivates it', async () => {
  const future = new Date(Date.now() + 5 * 864e5);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}`;
  const created = await api('POST', '/api/reminders', {
    title: '完成后再编辑', freq_type: 'once', start_date: date, time_str: '09:00', urgency: 2
  });
  const id = created.data.reminder.id;
  await api('POST', `/api/reminders/${id}/complete`);
  const { status, data } = await api('PUT', `/api/reminders/${id}`, {
    title: '复活的单次', freq_type: 'once', start_date: date, time_str: '09:00'
  });
  assert.equal(status, 200);
  assert.equal(data.reminder.status, 'active');
  const list = await api('GET', '/api/reminders');
  assert.ok(list.data.reminders.some((r) => r.id === id));
});

test('rejects non-string title/note and impossible dates', async () => {
  const base = { freq_type: 'once', start_date: '2030-01-01', time_str: '09:00', urgency: 2 };
  assert.equal((await api('POST', '/api/reminders', { ...base, title: { a: 1 } })).status, 400);
  assert.equal((await api('POST', '/api/reminders', { ...base, title: 'x', note: { a: 1 } })).status, 400);
  assert.equal((await api('POST', '/api/reminders', { ...base, title: 'x', start_date: '2030-02-30' })).status, 400);
  assert.equal((await api('POST', '/api/reminders', { ...base, title: 'x', time_str: '25:00' })).status, 400);
  assert.equal((await api('POST', '/api/reminders', { ...base, title: 'x' })).status, 201);
});

test('production refuses to start with the public default secret', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const indexPath = path2.join(__dirname, '..', 'src', 'index.js');
  const src = fs2.readFileSync(indexPath, 'utf8');
  assert.match(src, /AUTH_SECRET must be set in production/);
});

test('teardown', async () => {
  scheduler.stop();
  await new Promise((r) => server.close(r));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  // Windows keeps the sqlite file locked until GC finalizes native handles; temp dir is disposable.
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {}
});