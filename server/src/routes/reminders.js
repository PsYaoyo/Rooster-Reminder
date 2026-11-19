'use strict';
const express = require('express');
const config = require('../config');
const { db, publicReminder } = require('../db');
const { authMiddleware } = require('../auth');
const sched = require('../schedule');

const router = express.Router();
router.use(authMiddleware);

const FREQS = ['once', 'daily', 'weekly', 'interval', 'monthly'];
const LEADS = [0, 5, 15, 30, 60];

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function validate(body, existing) {
  const r = { ...existing, ...body };
  if (!r.title || !String(r.title).trim()) throw bad('标题不能为空');
  r.title = String(r.title).trim().slice(0, 40);
  r.note = String(r.note || '').slice(0, 200);
  r.urgency = Number(r.urgency);
  if (![1, 2, 3, 4].includes(r.urgency)) throw bad('紧急程度无效');
  if (!FREQS.includes(r.freq_type)) throw bad('提醒频率无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start_date || '')) throw bad('日期格式无效');
  if (!/^\d{2}:\d{2}$/.test(r.time_str || '')) throw bad('时间格式无效');
  r.lead_min = Number(r.lead_min || 0);
  if (!LEADS.includes(r.lead_min)) throw bad('提前量无效');
  r.interval_value = Math.min(99, Math.max(1, Number(r.interval_value || 1)));
  r.interval_unit = r.interval_unit === 'hour' ? 'hour' : 'day';
  r.weekly_day = Number(r.weekly_day);
  if (r.freq_type === 'weekly' && !(r.weekly_day >= 0 && r.weekly_day <= 6)) throw bad('星期无效');
  r.monthly_day = Number(r.monthly_day);
  if (r.freq_type === 'monthly' && !(r.monthly_day >= 1 && r.monthly_day <= 31)) throw bad('每月日期无效');
  return r;
}

function owned(req, id) {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ? AND openid = ?').get(id, req.openid);
  if (!row || row.deleted_at) {
    const e = new Error('提醒不存在');
    e.status = 404;
    throw e;
  }
  return row;
}

router.get('/', (req, res) => {
  const { q = '', filter = 'all', sort = 'time' } = req.query;
  let rows = db.prepare('SELECT * FROM reminders WHERE openid = ? AND deleted_at IS NULL').all(req.openid);
  const now = Date.now();
  if (filter === 'today') {
    const today = sched.fmtDate(now);
    rows = rows.filter((r) => sched.fmtDate(r.occurrence_at) === today && r.status === 'active');
  } else if (filter === 'overdue') {
    rows = rows.filter((r) => r.status === 'active' && r.occurrence_at <= now);
  } else if (filter === 'urgent') {
    rows = rows.filter((r) => r.urgency >= 3 && r.status === 'active');
  } else if (filter === 'done') {
    rows = rows.filter((r) => r.status !== 'active');
  } else {
    rows = rows.filter((r) => r.status === 'active');
  }
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) => r.title.toLowerCase().includes(needle) || r.note.toLowerCase().includes(needle));
  }
  const weight = { 4: 0, 3: 1, 2: 2, 1: 3 };
  rows.sort((a, b) => {
    const ao = a.status === 'active' && a.occurrence_at <= now ? 0 : 1;
    const bo = b.status === 'active' && b.occurrence_at <= now ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (sort === 'urgency') return weight[a.urgency] - weight[b.urgency] || a.next_fire_at - b.next_fire_at;
    if (sort === 'created') return b.created_at - a.created_at;
    return a.next_fire_at - b.next_fire_at;
  });
  res.json({ reminders: rows.map(publicReminder), now });
});

router.post('/', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) c FROM reminders WHERE openid = ? AND deleted_at IS NULL').get(req.openid).c;
  if (count >= config.maxRemindersPerUser) throw bad(`最多创建 ${config.maxRemindersPerUser} 条提醒`);
  const now = Date.now();
  const r = validate(req.body || {});
  const occ = sched.firstOccurrence(r, now);
  if (r.freq_type === 'once' && occ <= now) throw bad('单次提醒的时间必须晚于现在');
  const fire = sched.fireAt(occ, r.lead_min);
  const info = db.prepare(`
    INSERT INTO reminders (openid, title, note, urgency, freq_type, interval_value, interval_unit,
      weekly_day, monthly_day, time_str, start_date, lead_min, occurrence_at, next_fire_at,
      status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(req.openid, r.title, r.note, r.urgency, r.freq_type, r.interval_value, r.interval_unit,
    r.weekly_day ?? null, r.monthly_day ?? null, r.time_str, r.start_date, r.lead_min, occ, fire, now, now);
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ reminder: publicReminder(row) });
});

router.put('/:id', (req, res) => {
  const row = owned(req, req.params.id);
  const now = Date.now();
  const r = validate(req.body || {}, row);
  const occ = sched.firstOccurrence(r, now);
  if (r.freq_type === 'once' && occ <= now && row.status === 'active') throw bad('单次提醒的时间必须晚于现在');
  const fire = sched.fireAt(occ, r.lead_min);
  db.prepare(`
    UPDATE reminders SET title=?, note=?, urgency=?, freq_type=?, interval_value=?, interval_unit=?,
      weekly_day=?, monthly_day=?, time_str=?, start_date=?, lead_min=?, occurrence_at=?, next_fire_at=?,
      last_fired_at=NULL, updated_at=? WHERE id=?
  `).run(r.title, r.note, r.urgency, r.freq_type, r.interval_value, r.interval_unit,
    r.weekly_day ?? null, r.monthly_day ?? null, r.time_str, r.start_date, r.lead_min, occ, fire, now, row.id);
  res.json({ reminder: publicReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(row.id)) });
});

router.delete('/:id', (req, res) => {
  const row = owned(req, req.params.id);
  const now = Date.now();
  db.prepare('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  res.json({ ok: true, id: row.id });
});

router.post('/:id/restore', (req, res) => {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ? AND openid = ?').get(req.params.id, req.openid);
  if (!row || !row.deleted_at) throw bad('没有可恢复的提醒');
  const now = Date.now();
  let occ = row.occurrence_at;
  let fire = row.next_fire_at;
  let status = row.status;
  if (status === 'active' && occ <= now) {
    if (row.freq_type === 'once') {
      occ = now + 10 * 60000;
      fire = occ;
    } else {
      occ = sched.advance(row, now);
      fire = sched.fireAt(occ, row.lead_min);
    }
  }
  db.prepare('UPDATE reminders SET deleted_at = NULL, occurrence_at = ?, next_fire_at = ?, last_fired_at = NULL, status = ?, updated_at = ? WHERE id = ?')
    .run(occ, fire, status, now, row.id);
  res.json({ reminder: publicReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(row.id)) });
});

router.post('/:id/complete', (req, res) => {
  const row = owned(req, req.params.id);
  const now = Date.now();
  if (row.status !== 'active') throw bad('该提醒已结束');
  if (row.freq_type === 'once') {
    db.prepare("UPDATE reminders SET status = 'done', done_count = done_count + 1, last_done_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
  } else {
    const occ = sched.advance(row, now);
    db.prepare('UPDATE reminders SET occurrence_at = ?, next_fire_at = ?, last_fired_at = NULL, snooze_count = 0, done_count = done_count + 1, last_done_at = ?, updated_at = ? WHERE id = ?')
      .run(occ, sched.fireAt(occ, row.lead_min), now, now, row.id);
  }
  res.json({ reminder: publicReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(row.id)) });
});

router.post('/:id/snooze', (req, res) => {
  const row = owned(req, req.params.id);
  const minutes = Number(req.body && req.body.minutes);
  if (![5, 10, 30, 60].includes(minutes)) throw bad('贪睡时长无效');
  const now = Date.now();
  if (row.status !== 'active') throw bad('该提醒已结束');
  db.prepare('UPDATE reminders SET next_fire_at = ?, last_fired_at = NULL, snooze_count = snooze_count + 1, updated_at = ? WHERE id = ?')
    .run(now + minutes * 60000, now, row.id);
  res.json({ reminder: publicReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(row.id)) });
});

router.post('/:id/ignore', (req, res) => {
  const row = owned(req, req.params.id);
  const now = Date.now();
  if (row.status !== 'active') throw bad('该提醒已结束');
  if (row.freq_type === 'once') {
    db.prepare("UPDATE reminders SET status = 'ignored', updated_at = ? WHERE id = ?").run(now, row.id);
  } else {
    const occ = sched.advance(row, now);
    db.prepare('UPDATE reminders SET occurrence_at = ?, next_fire_at = ?, last_fired_at = NULL, snooze_count = 0, updated_at = ? WHERE id = ?')
      .run(occ, sched.fireAt(occ, row.lead_min), now, row.id);
  }
  res.json({ reminder: publicReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(row.id)) });
});

module.exports = router;