'use strict';
// Believable first-run data for dev mode so the list opens populated, not empty.
const { db } = require('./db');
const sched = require('./schedule');

function seed(openid) {
  const existing = db.prepare('SELECT COUNT(*) c FROM reminders WHERE openid = ?').get(openid).c;
  if (existing > 0) return 0;
  const now = Date.now();
  const today = sched.fmtDate(now);
  const d = new Date(now);
  const weekday = d.getDay();

  const items = [
    {
      title: '晨间喝水 300ml', note: '温水，加一片柠檬更好', urgency: 1,
      freq_type: 'daily', time_str: '08:00', start_date: today, lead_min: 0
    },
    {
      title: '吃降压药（缬沙坦）', note: '饭后半小时，勿漏服', urgency: 4,
      freq_type: 'interval', interval_value: 8, interval_unit: 'hour', time_str: '08:30', start_date: today, lead_min: 5
    },
    {
      title: '团队周会 · 同步进度', note: '会议室 3F-梧桐 / 腾讯会议 882-114-006', urgency: 3,
      freq_type: 'weekly', weekly_day: (weekday + 2) % 7, time_str: '10:00', start_date: today, lead_min: 15
    },
    {
      title: '信用卡还款（招行 6621）', note: '本期应还 ¥2,438.50', urgency: 3,
      freq_type: 'monthly', monthly_day: 25, time_str: '12:00', start_date: today, lead_min: 60
    },
    {
      title: '取快递 · 菜鸟驿站 3 号柜', note: '取件码 8-2-1146，今天 21:00 前', urgency: 2,
      freq_type: 'once', time_str: sched.fmtTime(now - 40 * 60000), start_date: today, lead_min: 0,
      past: true
    },
    {
      title: '给妈妈打电话', note: '聊聊周末回家吃饭的事', urgency: 2,
      freq_type: 'weekly', weekly_day: 0, time_str: '19:30', start_date: today, lead_min: 0
    }
  ];

  let n = 0;
  for (const it of items) {
    let occ;
    if (it.past) {
      occ = sched.parseLocal(it.start_date, it.time_str);
    } else {
      occ = sched.firstOccurrence(it, now);
    }
    const fire = it.past ? occ : sched.fireAt(occ, it.lead_min);
    db.prepare(`
      INSERT INTO reminders (openid, title, note, urgency, freq_type, interval_value, interval_unit,
        weekly_day, monthly_day, time_str, start_date, lead_min, occurrence_at, next_fire_at,
        status, last_fired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(openid, it.title, it.note, it.urgency, it.freq_type, it.interval_value || 1,
      it.interval_unit || 'day', it.weekly_day ?? null, it.monthly_day ?? null,
      it.time_str, it.start_date, it.lead_min, occ, fire, null, now, now);
    n++;
  }
  db.prepare('UPDATE users SET sub_quota = 6 WHERE openid = ?').run(openid);
  return n;
}

module.exports = { seed };