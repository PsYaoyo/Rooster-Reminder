'use strict';
const https = require('https');
const config = require('./config');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function code2session(code) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wxAppId}&secret=${config.wxSecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const data = await getJson(url);
  if (!data.openid) {
    const err = new Error(`weixin code2session failed: ${data.errcode} ${data.errmsg}`);
    err.status = 400;
    throw err;
  }
  return data;
}

let tokenCache = { token: '', expiresAt: 0 };
async function accessToken() {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.wxAppId}&secret=${config.wxSecret}`;
  const data = await getJson(url);
  if (!data.access_token) throw new Error(`weixin token failed: ${data.errcode} ${data.errmsg}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function sendSubscribe(openid, { templateId, page, data }) {
  const token = await accessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`;
  return postJson(url, {
    touser: openid,
    template_id: templateId,
    page: page || 'pages/index/index',
    data,
    miniprogram_state: config.wxMiniProgramState,
    lang: 'zh_CN'
  });
}

module.exports = { code2session, accessToken, sendSubscribe };