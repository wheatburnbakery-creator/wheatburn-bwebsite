'use strict';
/**
 * Wheatburn shop — entry point.
 *
 *   node server.js
 *
 * Serves the storefront from /public and the JSON API from /api.
 * No dependencies, no build step.
 */

const http = require('node:http');
const config = require('./src/config');
const store = require('./src/store');
const httpUtil = require('./src/http');
const routes = require('./src/routes');

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — Wheatburn</title>
<link rel="stylesheet" href="/assets/css/shop.css"></head>
<body><main class="wrap section center" style="max-width:46ch;margin:12vh auto">
<p class="eyebrow">404</p>
<h1>That page has sold out</h1>
<p class="lede">The link you followed does not exist. Everything we bake is one tap away.</p>
<p><a class="btn btn-primary" href="/">Back to the shop</a></p>
</main></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.req = req;

  try {
    httpUtil.applySecurityHeaders(res);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await routes.handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      httpUtil.json(res, 405, { error: 'Use GET for pages.', code: 'method_not_allowed' });
      return;
    }

    if (httpUtil.serveStatic(req, res, url)) return;

    httpUtil.send(res, 404, NOT_FOUND_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
  } catch (err) {
    const status = err instanceof httpUtil.HttpError ? err.status : 500;
    const code = err instanceof httpUtil.HttpError ? err.code : 'internal_error';
    const message =
      err instanceof httpUtil.HttpError ? err.message : 'Something went wrong on our side.';
    if (status >= 500) console.error('[server]', req.method, url.pathname, err);
    if (res.headersSent) {
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const payload = { error: message, code };
      if (err instanceof httpUtil.HttpError && err.details) payload.details = err.details;
      httpUtil.json(res, status, payload);
    } else {
      httpUtil.send(res, status, `<!DOCTYPE html><meta charset="utf-8"><p>${message}</p>`, {
        'Content-Type': 'text/html; charset=utf-8'
      });
    }
  }
});

function shutdown(signal) {
  console.log(`\n[server] ${signal} received — saving data and closing.`);
  try {
    store.saveNow();
  } catch (err) {
    console.error('[server] save on shutdown failed:', err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  server.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log(`  Wheatburn shop running  →  http://localhost:${config.PORT}`);
    console.log(`  Environment            →  ${config.NODE_ENV}`);
    console.log(`  Data file              →  ${config.DB_FILE}`);
    if (!config.notify.providerUrl) {
      console.log('  SMS / WhatsApp         →  console + data/outbox.log (no provider configured)');
    }
    console.log('');
  });
}

module.exports = server;
