const WEEK = '日一二三四五六';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function fmtClock(ms) {
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtNext(ms, now) {
  const d = new Date(ms);
  const time = fmtClock(ms);
  if (sameDay(ms, now)) return '今天 ' + time;
  if (sameDay(ms, now + 86400000)) return '明天 ' + time;
  const diffDays = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())) / 86400000);
  if (diffDays > 1 && diffDays < 7) return '周' + WEEK[d.getDay()] + ' ' + time;
  if (d.getFullYear() === new Date(now).getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + time;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + time;
}

function fmtAgo(ms, now) {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚到期';
  if (min < 60) return '已过期 ' + min + ' 分钟';
  const h = Math.floor(min / 60);
  if (h < 24) return '已过期 ' + h + ' 小时';
  return '已过期 ' + Math.floor(h / 24) + ' 天';
}

function fmtSent(ms) {
  const d = new Date(ms);
  return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + fmtClock(ms);
}

function freqLabel(r) {
  switch (r.freq_type) {
    case 'daily': return '每天';
    case 'weekly': return '每周' + WEEK[r.weekly_day];
    case 'interval': return '每' + r.interval_value + (r.interval_unit === 'hour' ? '小时' : '天');
    case 'monthly': return '每月' + r.monthly_day + '日';
    default: return '单次';
  }
}

const URGENCY = {
  1: { label: '低', color: '#2E9E6B', soft: '#E4F5EC' },
  2: { label: '中', color: '#F59E0B', soft: '#FDF0D5' },
  3: { label: '高', color: '#FF5A36', soft: '#FFE7E0' },
  4: { label: '紧急', color: '#D92D20', soft: '#FBDFDB' }
};

function greeting(now) {
  const h = new Date(now).getHours();
  if (h < 5) return '夜深了';
  if (h < 9) return '早安';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function dateLabel(now) {
  const d = new Date(now);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + WEEK[d.getDay()];
}

module.exports = { pad2, fmtClock, fmtNext, fmtAgo, fmtSent, freqLabel, URGENCY, greeting, dateLabel, WEEK };