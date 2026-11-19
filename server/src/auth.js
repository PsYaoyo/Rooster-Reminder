'use strict';
const crypto = require('crypto');
const config = require('./config');
const { ensureUser, getUser } = require('./db');

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', config.secret).update(payload).digest('base64url');
}

function issueToken(openid) {
  const exp = Date.now() + config.tokenTtlMs;
  const payload = `${b64url(openid)}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [oid, exp, sig] = parts;
  const payload = `${oid}.${exp}`;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  try {
    return Buffer.from(oid, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function devOpenid(code) {
  return 'dev_' + crypto.createHash('sha1').update(String(code)).digest('hex').slice(0, 16);
}

async function login(code) {
  if (!code || typeof code !== 'string') {
    const err = new Error('code required');
    err.status = 400;
    throw err;
  }
  let openid;
  if (config.devMode || code.startsWith('dev_')) {
    openid = devOpenid(code);
  } else {
    const wx = require('./wx');
    const session = await wx.code2session(code);
    openid = session.openid;
  }
  const user = ensureUser(openid);
  return { token: issueToken(openid), openid, user, dev: config.devMode };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const openid = verifyToken(token);
  if (!openid || !getUser(openid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.openid = openid;
  next();
}

module.exports = { login, issueToken, verifyToken, authMiddleware, devOpenid };