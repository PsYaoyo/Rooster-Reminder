const config = require('../config');

function raw(method, path, data, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.API_BASE + path,
      method,
      data,
      timeout: 12000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      success: (res) => resolve({ status: res.statusCode, data: res.data }),
      fail: (err) => reject(new Error(err.errMsg || '网络请求失败'))
    });
  });
}

function deviceId() {
  let id = wx.getStorageSync('rr_device');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    wx.setStorageSync('rr_device', id);
  }
  return id;
}

function wxCode() {
  return new Promise((resolve) => {
    wx.login({
      success: (r) => resolve(r.code || deviceId()),
      fail: () => resolve(deviceId())
    });
  });
}

async function login() {
  const code = await wxCode();
  const res = await raw('POST', '/api/login', { code });
  if (res.status !== 200) throw new Error(res.data.error || '登录失败');
  wx.setStorageSync('rr_token', res.data.token);
  return res.data;
}

async function request(method, path, data, retried) {
  const app = getApp();
  if (app && app.ready) {
    try { await app.ready; } catch (e) { /* login retry below */ }
  }
  let token = wx.getStorageSync('rr_token');
  if (!token) {
    const l = await login();
    if (app) app.applyLogin(l);
    token = wx.getStorageSync('rr_token');
  }
  const res = await raw(method, path, data, token);
  if (res.status === 401 && !retried) {
    const l = await login();
    if (app) app.applyLogin(l);
    return request(method, path, data, true);
  }
  if (res.status >= 400) throw new Error((res.data && res.data.error) || '请求失败(' + res.status + ')');
  return res.data;
}

// One server-issued nonce equals at most one granted push. The client can no
// longer claim an arbitrary count; WeChat enforces real delivery at send time.
async function grantSubscribe(accepted) {
  if (!accepted) return 0;
  let challenge;
  try {
    challenge = await request('GET', '/api/me/subscribe-challenge');
  } catch (e) {
    return 0;
  }
  if (!challenge || !challenge.nonce) return 0;
  try {
    await request('POST', '/api/me/subscribe', { nonce: challenge.nonce });
    return 1;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  login,
  request,
  grantSubscribe,
  get: (p) => request('GET', p),
  post: (p, d) => request('POST', p, d),
  put: (p, d) => request('PUT', p, d),
  del: (p) => request('DELETE', p)
};