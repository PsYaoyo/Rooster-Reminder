'use strict';
const config = require('./config');
const { db } = require('./db');
const { fmtDate, fmtTime } = require('./schedule');

const URGENCY_TONE = {
  1: '雄鸡轻声提醒，从容处理即可',
  2: '到点啦，记得处理这件事',
  3: '重要提醒，请尽快处理',
  4: '紧急！雄鸡全力打鸣，请立即处理'
};

function pushBody(r) {
  const when = `${fmtDate(r.occurrence_at)} ${fmtTime(r.occurrence_at)}`;
  return `${URGENCY_TONE[r.urgency] || URGENCY_TONE[2]} · ${when}`;
}

// Fires one reminder: consumes one subscribe quota when a push channel is available.
async function fire(r, user) {
  const title = r.title;
  const body = pushBody(r);
  let channel = 'inapp';
  let detail = '订阅额度不足，仅站内提醒';
  let charged = false;

  if (user.sub_quota > 0) {
    if (!config.devMode && config.wxTemplateId) {
      try {
        const wx = require('./wx');
        const res = await wx.sendSubscribe(r.openid, {
          templateId: config.wxTemplateId,
          data: {
            thing1: { value: title.slice(0, 20) },
            time2: { value: `${fmtDate(r.occurrence_at)} ${fmtTime(r.occurrence_at)}` },
            thing3: { value: (URGENCY_TONE[r.urgency] || '').slice(0, 20) }
          }
        });
        if (res.errcode === 0) {
          channel = 'wechat';
          detail = '微信订阅消息已下发';
          charged = true;
        } else {
          detail = `微信下发失败(${res.errcode})，额度未消耗，转站内提醒`;
        }
      } catch (e) {
        detail = '微信接口异常，额度未消耗，转站内提醒';
      }
    } else if (config.devMode) {
      channel = 'mock';
      detail = '开发模式模拟推送';
      charged = true;
    } else {
      detail = '未配置订阅模板，仅站内提醒';
    }
    if (charged) {
      db.prepare('UPDATE users SET sub_quota = sub_quota - 1 WHERE openid = ? AND sub_quota > 0').run(r.openid);
    }
  }

  db.prepare(
    'INSERT INTO notifications (openid, reminder_id, title, body, channel, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(r.openid, r.id, title, `${body}（${detail}）`, channel, Date.now());

  return { channel, detail };
}

module.exports = { fire, pushBody, URGENCY_TONE };