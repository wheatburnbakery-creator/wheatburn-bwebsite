'use strict';
/**
 * HTTP plumbing: responses, cookies, body parsing, static files.
 * No framework — this is roughly 150 lines that Express would otherwise do.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  // Chrome rejects a manifest served as application/octet-stream.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.pdf': 'application/pdf'
};

/** An error a route may throw to produce a clean JSON error response. */
class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'error';
    this.details = details || null;
  }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined || body === null ? '' : body;
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  if (res.req && res.req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

function json(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
}

/** Reads the raw request body with a hard size cap so a large POST cannot exhaust memory. */
function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'That request is too large.', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Accepts JSON or classic form posts, so the API works from fetch and from plain HTML. */
async function readInput(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'The request body is not valid JSON.', 'bad_json');
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) bits.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure || config.isProduction) bits.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookie = bits.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Serves a file from /public, mapping extension-less URLs to .html files so
 * the shop can use /menu instead of /menu.html.
 * Returns true when a file was sent.
 */
function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/') pathname = '/index.html';

  const resolved = path.resolve(config.PUBLIC_DIR, '.' + pathname);
  if (!resolved.startsWith(config.PUBLIC_DIR)) return false; // path traversal guard

  const candidates = [resolved];
  if (!path.extname(resolved)) candidates.push(`${resolved}.html`);

  for (const candidate of candidates) {
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const ext = path.extname(candidate).toLowerCase();
    const isHtml = ext === '.html';
    const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return true;
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      ETag: etag,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(candidate).pipe(res);
    return true;
  }
  return false;
}

/** JSON endpoints used by the client to bootstrap (brand facts, config). */
function publicConfig() {
  return {
    brand: config.brand,
    order: {
      minOrderRwf: config.order.minOrderRwf,
      freeDeliveryFromRwf: config.order.freeDeliveryFromRwf,
      sameDayCutoffHour: config.order.sameDayCutoffHour
    },
    security: {
      otpLength: config.security.otpLength,
      otpTtlMinutes: Math.round(config.security.otpTtlMs / 60000),
      otpResendCooldownSeconds: Math.round(config.security.otpResendCooldownMs / 1000),
      minPasswordLength: config.security.minPasswordLength
    },
    env: config.NODE_ENV
  };
}

module.exports = {
  MIME,
  HttpError,
  send,
  json,
  readBody,
  readInput,
  parseCookies,
  setCookie,
  clearCookie,
  clientIp,
  serveStatic,
  applySecurityHeaders,
  publicConfig
};
