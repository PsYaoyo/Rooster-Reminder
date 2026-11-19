'use strict';
// Recurrence engine. All computations in server local time (Asia/Shanghai).

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseLocal(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function atTime(ms, timeStr) {
  const d = new Date(ms);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
}

// Smallest occurrence of r strictly after afterMs, never before start_date.
function nextOccurrence(r, afterMs) {
  const start = parseLocal(r.start_date, r.time_str);
  switch (r.freq_type) {
    case 'once':
      return start;
    case 'daily': {
      let t = atTime(afterMs, r.time_str);
      if (t <= afterMs) t += DAY;
      return Math.max(t, start);
    }
    case 'weekly': {
      let t = atTime(afterMs, r.time_str);
      for (let i = 0; i < 8; i++) {
        const d = new Date(t);
        if (d.getDay() === r.weekly_day && t > afterMs && t >= start) return t;
        t += DAY;
      }
      return Math.max(t, start);
    }
    case 'interval': {
      const step = Math.max(1, r.interval_value) * (r.interval_unit === 'hour' ? HOUR : DAY);
      if (start > afterMs) return start;
      const k = Math.floor((afterMs - start) / step) + 1;
      return start + k * step;
    }
    case 'monthly': {
      const d = new Date(afterMs);
      let y = d.getFullYear();
      let m = d.getMonth();
      for (let i = 0; i < 24; i++) {
        const day = Math.min(r.monthly_day, daysInMonth(y, m));
        const t = new Date(y, m, day, ...r.time_str.split(':').map(Number), 0, 0).getTime();
        if (t > afterMs && t >= start) return t;
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
      return start;
    }
    default:
      return start;
  }
}

function fireAt(occurrenceAt, leadMin) {
  return occurrenceAt - (leadMin || 0) * 60 * 1000;
}

// First occurrence when creating: once must be in the future; repeats roll forward.
function firstOccurrence(r, nowMs) {
  if (r.freq_type === 'once') return parseLocal(r.start_date, r.time_str);
  return nextOccurrence(r, nowMs);
}

// Next occurrence after the user completes/ignores the current one.
function advance(r, nowMs) {
  return nextOccurrence(r, Math.max(nowMs, r.occurrence_at));
}

const FREQ_LABEL = {
  once: '单次',
  daily: '每天',
  weekly: '每周',
  interval: '自定义间隔',
  monthly: '每月'
};

function freqLabel(r) {
  switch (r.freq_type) {
    case 'weekly': return `每周${'日一二三四五六'[r.weekly_day]}`;
    case 'interval': return `每${r.interval_value}${r.interval_unit === 'hour' ? '小时' : '天'}`;
    case 'monthly': return `每月${r.monthly_day}日`;
    default: return FREQ_LABEL[r.freq_type] || r.freq_type;
  }
}

module.exports = {
  HOUR, DAY, pad2, parseLocal, fmtDate, fmtTime, daysInMonth,
  nextOccurrence, fireAt, firstOccurrence, advance, freqLabel
};