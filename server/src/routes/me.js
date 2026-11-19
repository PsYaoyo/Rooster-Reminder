'use strict';
const express = require('express');
const config = require('../config');
const { db, getUser } = require('../db');
const { authMiddleware } = require('../auth');
const sched = require('../schedule');

const router = express.Router();
router.use(authMiddleware);

function stats(openid) {
  const now = Date.now();
  const rows = db.prepare('SELECT status, urgency, occurrence_at, done_count, last_done_at FROM reminders WHERE openid = ? AND deleted_at IS NULL').all(openid);
  const today = sched.fmtDate(now);
  return {
    active: rows.filter((r) => r.status === 'active').length,
    overdue: rows.filter((r) => r.status === 'active' && r.occurrence_at <= now).length,
    urgent: rows.filter((r) => r.status === 'active' && r.urgency === 4).length,
    doneTotal: rows.reduce((s, r) => s + r.done_count, 0),
    doneToday: rows.filter((r) => r.last_done_at && sched.fmtDate(r.last_done_at) === today).length
  };
}

router.get('/', (req, res) => {
  const u = getUser(req.openid);
  res.json({
    user: { openid: u.openid, nickname: u.nickname, avatar: u.avatar, muted: !!u.muted, sub_quota: u.sub_quota },
    stats: stats(req.openid),
    dev: config.devMode,
    templateConfigured: !!config.wxTemplateId
  });
});

router.put('/', (req, res) => {
  const b = req.body || {};
  const u = getUser(req.openid);
  const nickname = b.nickname !== undefined ? String(b.nickname).slice(0, 24) : u.nickname;
  const avatar = b.avatar !== undefined ? String(b.avatar).slice(0, 200000) : u.avatar;
  const muted = b.muted !== undefined ? (b.muted ? 1 : 0) : u.muted;
  db.prepare('UPDATE users SET nickname = ?, avatar = ?, muted = ? WHERE openid = ?').run(nickname, avatar, muted, req.openid);
  const n = getUser(req.openid);
  res.json({ user: { openid: n.openid, nickname: n.nickname, avatar: n.avatar, muted: !!n.muted, sub_quota: n.sub_quota } });
});

// wx.requestSubscribeMessage accept grants quota (one per accepted template).
router.post('/subscribe', (req, res) => {
  const count = Math.max(1, Math.min(10, Number(req.body && req.body.count) || 1));
  db.prepare('UPDATE users SET sub_quota = MIN(?, sub_quota + ?) WHERE openid = ?').run(config.maxSubQuota, count, req.openid);
  res.json({ sub_quota: getUser(req.openid).sub_quota });
});

router.get('/notifications', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const rows = db.prepare('SELECT * FROM notifications WHERE openid = ? ORDER BY sent_at DESC LIMIT ?').all(req.openid, limit);
  res.json({ notifications: rows });
});

router.post('/clear-done', (req, res) => {
  const now = Date.now();
  const info = db.prepare("UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE openid = ? AND deleted_at IS NULL AND status != 'active'").run(now, now, req.openid);
  res.json({ cleared: info.changes });
});

module.exports = router;