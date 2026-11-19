'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { login, authMiddleware } = require('./auth');
const { seed } = require('./seed');
const reminders = require('./routes/reminders');
const me = require('./routes/me');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.disable('x-powered-by');

  // Browser preview harness (design/QA twin of the mini program), same-origin with the API.
  app.use('/preview', express.static(path.join(__dirname, '..', '..', 'preview')));
  app.use('/assets', express.static(path.join(__dirname, '..', '..', 'miniprogram', 'assets')));

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'rooster-reminder', dev: config.devMode, now: Date.now() }));

  app.post('/api/login', async (req, res, next) => {
    try {
      const result = await login(req.body && req.body.code);
      if (config.devMode && config.seedDemo) seed(result.openid);
      res.json(result);
    } catch (e) { next(e); }
  });

  app.use('/api/reminders', reminders);
  app.use('/api/me', me);

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'server error' });
  });
  return app;
}

module.exports = { createApp };