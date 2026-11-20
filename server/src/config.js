'use strict';
// Rooster Reminder backend configuration. All times are Asia/Shanghai.
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

const path = require('path');

function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'rooster.db'),
  secret: process.env.AUTH_SECRET || 'rooster-dev-secret-change-me',
  wxAppId: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',
  wxTemplateId: process.env.WX_TEMPLATE_ID || '',
  wxMiniProgramState: process.env.WX_MINIPROGRAM_STATE || 'formal',
  // Dev mode: no real WeChat credentials -> deterministic dev openid + mock push + demo seed.
  get devMode() {
    return !this.wxAppId || !this.wxSecret;
  },
  seedDemo: bool(process.env.SEED_DEMO, true),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '15000', 10),
  maxRemindersPerUser: parseInt(process.env.MAX_REMINDERS || '200', 10),
  maxSubQuota: parseInt(process.env.MAX_SUB_QUOTA || '50', 10),
  maxSubscribeChallenges: parseInt(process.env.MAX_SUB_CHALLENGES || '5', 10),
  subscribeChallengeTtlMs: parseInt(process.env.SUB_CHALLENGE_TTL_MS || '300000', 10),
  tokenTtlMs: 30 * 24 * 3600 * 1000
};

module.exports = config;