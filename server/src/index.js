'use strict';
require('./bootstrap');
const config = require('./config');
const { createApp } = require('./app');
const scheduler = require('./scheduler');

if (!config.devMode && config.usingDefaultSecret) {
  console.error('[rooster] AUTH_SECRET must be set in production (refusing to start with the public dev secret)');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`[rooster] listening on http://${config.host}:${config.port} (dev=${config.devMode}, tz=${process.env.TZ})`);
  scheduler.start();
});

function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);