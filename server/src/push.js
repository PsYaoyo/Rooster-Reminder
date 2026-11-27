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
// Short label shown in the "紧急度" field of the WeChat subscription message.
const URGENCY_LABEL = { 1: '低', 2: '中', 3: '高', 4: '紧急' };

function pushBody(r) {
  const when = `${fmtDate(r.occurrence_at)} ${fmtTime(r.occurrence_at)}`;
  return `${URGENCY_TONE[r.urgency] || URGENCY_TONE[2]} · ${when}`;
}

// Fires one reminder. In production WeChat is the authority: we always call the
// subscribe API and only charge the local display quota after a successful send.
// The local quota merely simulates that loop in dev mode; it never gates real pushes.
async function fire(r, user) {
  const title = r.title;
  const body = pushBody(r);
  let channel = 'inapp';
  let detail = '仅站内提醒';
  let charged = false;

  if (!config.devMode && config.wxTemplateId) {
    try {
      const wx = require('./wx');
      // Field keys come from the real production template (probe-template.js).
      // Verified against a delivered message: thing2=提醒内容, time3=执行时间,
      // date4=日程时间, thing5=日程标题, thing8=紧急度.
      const occ = r.occurrence_at;
      const stamp = `${fmtDate(occ)} ${fmtTime(occ)}:00`;
      const content = String(r.note || '').slice(0, 20) || URGENCY_TONE[r.urgency] || URGENCY_TONE[2];
      const res = await wx.sendSubscribe(r.openid, {
        templateId: config.wxTemplateId,
        data: {
          thing2: { value: content.slice(0, 20) },                      // 提醒内容（备注优先）
          time3: { value: stamp },                                      // 执行时间
          date4: { value: fmtDate(occ) },                               // 日程时间
          thing5: { value: title.slice(0, 20) },                        // 日程标题
          thing8: { value: URGENCY_LABEL[r.urgency] || URGENCY_LABEL[2] } // 紧急度
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
  } else if (config.devMode && user.sub_quota > 0) {
    channel = 'mock';
    detail = '开发模式模拟推送';
    charged = true;
  } else if (config.devMode) {
    detail = '开发模式订阅额度不足，仅站内提醒';
  } else {
    detail = '未配置订阅模板，仅站内提醒';
  }
  if (charged) {
    db.prepare('UPDATE users SET sub_quota = sub_quota - 1 WHERE openid = ? AND sub_quota > 0').run(r.openid);
  }

  db.prepare(
    'INSERT INTO notifications (openid, reminder_id, title, body, channel, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(r.openid, r.id, title, `${body}（${detail}）`, channel, Date.now());

  return { channel, detail };
}

module.exports = { fire, pushBody, URGENCY_TONE };