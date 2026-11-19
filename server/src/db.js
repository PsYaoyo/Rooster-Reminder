'use strict';
require('./bootstrap');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  openid TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  muted INTEGER NOT NULL DEFAULT 0,
  sub_quota INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  urgency INTEGER NOT NULL DEFAULT 2,
  freq_type TEXT NOT NULL DEFAULT 'once',
  interval_value INTEGER NOT NULL DEFAULT 1,
  interval_unit TEXT NOT NULL DEFAULT 'day',
  weekly_day INTEGER,
  monthly_day INTEGER,
  time_str TEXT NOT NULL,
  start_date TEXT NOT NULL,
  lead_min INTEGER NOT NULL DEFAULT 0,
  occurrence_at INTEGER NOT NULL,
  next_fire_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_fired_at INTEGER,
  done_count INTEGER NOT NULL DEFAULT 0,
  last_done_at INTEGER,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(openid, deleted_at, next_fire_at);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT NOT NULL,
  reminder_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(openid, sent_at);
`);

function getUser(openid) {
  return db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
}

function ensureUser(openid) {
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO users (openid, created_at) VALUES (?, ?)').run(openid, now);
  return getUser(openid);
}

function publicReminder(r) {
  if (!r) return null;
  const now = Date.now();
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    urgency: r.urgency,
    freq_type: r.freq_type,
    interval_value: r.interval_value,
    interval_unit: r.interval_unit,
    weekly_day: r.weekly_day,
    monthly_day: r.monthly_day,
    time_str: r.time_str,
    start_date: r.start_date,
    lead_min: r.lead_min,
    occurrence_at: r.occurrence_at,
    next_fire_at: r.next_fire_at,
    status: r.status,
    last_fired_at: r.last_fired_at,
    done_count: r.done_count,
    snooze_count: r.snooze_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
    overdue: r.status === 'active' && r.occurrence_at <= now,
    deleted: !!r.deleted_at
  };
}

module.exports = { db, getUser, ensureUser, publicReminder };