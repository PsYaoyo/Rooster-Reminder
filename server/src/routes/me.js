'use strict';
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { db, getUser } = require('../db');
const { authMiddleware } = require('../auth');
const sched = require('../schedule');

const router = express.Router();
router.use(authMiddleware);

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

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

// A grant is bound to a single-use, short-lived server-issued nonce.
// The client cannot claim an arbitrary count; WeChat itself enforces the real
// one-time subscription when the message is actually sent (errcode 43101).
router.get('/subscribe-challenge', (req, res) => {
  const now = Date.now();
  db.prepare('DELETE FROM subscribe_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL').run(now);
  const outstanding = db.prepare(
    'SELECT COUNT(*) c FROM subscribe_challenges WHERE openid = ? AND expires_at > ?'
  ).get(req.openid, now).c;
  if (outstanding >= config.maxSubscribeChallenges) throw bad('授权请求过于频繁，请稍后再试');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + config.subscribeChallengeTtlMs;
  db.prepare('INSERT INTO subscribe_challenges (nonce, openid, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(nonce, req.openid, now, expiresAt);
  res.json({ nonce, expires_at: expiresAt });
});

router.post('/subscribe', (req, res) => {
  const nonce = req.body && req.body.nonce;
  if (!nonce || typeof nonce !== 'string') throw bad('nonce required');
  const now = Date.now();
  const challenge = db.prepare(
    'SELECT * FROM subscribe_challenges WHERE nonce = ? AND openid = ? AND consumed_at IS NULL AND expires_at > ?'
  ).get(nonce, req.openid, now);
  if (!challenge) throw bad('授权已过期或无效');
  const used = db.prepare('UPDATE subscribe_challenges SET consumed_at = ? WHERE nonce = ? AND consumed_at IS NULL')
    .run(now, nonce);
  if (used.changes !== 1) throw bad('授权已使用');
  db.prepare('UPDATE users SET sub_quota = MIN(?, sub_quota + 1) WHERE openid = ?')
    .run(config.maxSubQuota, req.openid);
  res.json({ sub_quota: getUser(req.openid).sub_quota, granted: 1 });
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