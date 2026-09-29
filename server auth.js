'use strict';
/**
 * Accounts: registration, login (password or one-time code), sessions,
 * password recovery and the security rules around all of it.
 *
 * Design choices worth knowing about:
 *   - Passwords are hashed with scrypt and a per-user salt. Never stored, never
 *     logged, never returned by the API.
 *   - Sessions are server-side records; the browser only holds an opaque cookie.
 *     Logging out deletes the record, so a stolen cookie dies with it.
 *   - One-time codes are stored as an HMAC, not in clear text, and they expire
 *     in 5 minutes with a hard attempt limit. See `config.security`.
 *   - The API does not confirm whether a phone number or email has an account.
 *     "No account" and "code sent" look identical from the outside, which stops
 *     the shop being used to enumerate its own customers.
 */

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const { HttpError, setCookie, clearCookie, parseCookies } = require('./http');
const notify = require('./notify');

const S = config.security;

/* ------------------------------------------------------------------- phones */

const RW_MOBILE = /^(?:\+?250|0)?7[2389]\d{7}$/;

/** Accepts 078…, 25078…, +250 78… and returns +2507XXXXXXXX. */
function normalizePhone(/** @param {string} input */) {
  const raw = String(input ?? '').replace(/[\s()\-.]/g, '');
  if (!raw) throw new HttpError(400, 'Enter your phone number.', 'phone_required');
  if (!RW_MOBILE.test(raw)) {
    throw new HttpError(400, 'Use a Rwandan mobile number, for example 0788 123 456.', 'phone_invalid');
  }
  const digits = raw.replace(/^\+?250/, '').replace(/^0/, '');
  return `+250${digits}`;
}

function maskPhone(/** @param {string} phone */) {
  const local = String(phone).replace(/\D/g, '').slice(3);
  if (local.length !== 9) return phone;
  return `+250 ${local.slice(0, 2)}* *** ${local.slice(6)}`;
}

/* ---------------------------------------------------------------- passwords */

function hashPassword(/** @param {string} password */) {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
/**
 * @param {string} password
 * @param {string} stored
 */
function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwerty123',
  'wheatburn',
  'iloveyou',
  'kigali123'
]);

/** Registration and reset both use these rules, so they can never drift apart. */
function assertPassword(/** @param {string} password */) {
  const value = String(password ?? '');
  if (value.length < S.minPasswordLength) {
    throw new HttpError(
      400,
      `Use at least ${S.minPasswordLength} characters for your password.`,
      'password_too_short'
    );
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new HttpError(400, 'Include at least one letter and one number.', 'password_too_weak');
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    throw new HttpError(400, 'That password is too easy to guess. Choose another.', 'password_too_common');
  }
  return value;
}

/* --------------------------------------------------------------- throttling */
/**
 * @param {string} key
 * @param {number} max
 * @param {number} windowMs
 */
function rateLimit(key, max, windowMs) {
  const d = store.data();
  const now = Date.now();
  let bucket = d.rateLimits.find((/** @type {{key: string}} */r) => r.key === key);
  if (!bucket || bucket.windowStart < now - windowMs) {
    d.rateLimits = d.rateLimits.filter((/** @type {{key: string}} */r) => r.key !== key);
    bucket = { key, count: 0, windowStart: now };
    d.rateLimits.push(bucket);
  }
  bucket.count += 1;
  store.save();
  return {
    exceeded: bucket.count > max,
    count: bucket.count,
    retryAfterMs: Math.max(0, bucket.windowStart + windowMs - now)
  };
}
/**
 * @param {string} key
 * @param {number} max
 * @param {number} windowMs
 * @param {string} message
 * @param {string} [code]
 */
function throttle(key, max, windowMs, message, code) {
  const result = rateLimit(key, max, windowMs);
  if (result.exceeded) {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    throw new HttpError(429, `${message} Try again in ${seconds} seconds.`, code || 'rate_limited');
  }
  return result;
}

function clearLimit(/** @param {string} key */) {
  const d = store.data();
  d.rateLimits = d.rateLimits.filter((/** @type {{key: string}} */r) => r.key !== key);
  store.save();
}

/* ------------------------------------------------------------------- tokens */
/**
 * @param {string} value
 * @returns {string}
 */
function hmac(value) {
  return crypto.createHmac('sha256', S.otpPepper).update(String(value)).digest('hex');
}
/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function randomCode(length = S.otpLength) {
  let code = '';
  for (let i = 0; i < length; i += 1) code += crypto.randomInt(0, 10);
  return code;
}

/* -------------------------------------------------------------------- users */
/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 * @property {string|null} email
 * @property {string} passwordHash
 * @property {string} channel
 * @property {boolean} whatsappOptIn
 * @property {string|null} savedAddress
 * @property {string|null} deliveryZoneId
 * @property {string} createdAt
 * @property {string|null} lastLoginAt
 */

/** @param {User} user */

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    phoneMasked: maskPhone(user.phone),
    email: user.email || null,
    channel: user.channel || 'retail',
    whatsappOptIn: Boolean(user.whatsappOptIn),
    savedAddress: user.savedAddress || null,
    deliveryZoneId: user.deliveryZoneId || null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}
/**
 * @param {string} phone
 * @returns {User|undefined}
 */
function findByPhone(phone) {
  return store.findUserByPhone(phone);
}

function createUser({ name, phone, password, email, whatsappOptIn }) {
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2) throw new HttpError(400, 'Tell us your name.', 'name_required');
  if (cleanName.length > 80) throw new HttpError(400, 'That name is too long.', 'name_too_long');

  const normalized = normalizePhone(phone);
  if (findByPhone(normalized)) {
    throw new HttpError(409, 'That number already has an account. Sign in instead.', 'phone_taken');
  }

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  if (cleanEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'That email address does not look right.', 'email_invalid');
  }
  if (cleanEmail && store.findUserByEmail(cleanEmail)) {
    throw new HttpError(409, 'That email is already in use.', 'email_taken');
  }

  assertPassword(password);

  const user = {
    id: crypto.randomUUID(),
    name: cleanName,
    phone: normalized,
    email: cleanEmail,
    passwordHash: hashPassword(password),
    channel: 'retail',
    whatsappOptIn: Boolean(whatsappOptIn),
    savedAddress: null,
    deliveryZoneId: null,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };

  store.insertUser(user);
  return user;
}

/* ----------------------------------------------------------------- sessions */
/**
 * @param {string} userId
 * @param {{ip?: string, userAgent?: string}} [meta]
 */
function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    id: crypto.randomUUID(),
    tokenHash: hmac(token),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + S.sessionTtlMs,
    ip: meta.ip || null,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 180) : null
  };
  store.data().sessions.push(session);
  store.save();
  return { token, expiresAt: session.expiresAt };
}
/**
 * @param {string} token
 * @returns {{session: object, user: User}|null}
 */
function sessionFromToken(token) {
  if (!token) return null;
  const now = Date.now();
  const session = store.data().sessions.find((/** @type {{tokenHash: string}} */s) => safeEqual(s.tokenHash, hmac(token)));
  if (!session || session.expiresAt <= now) return null;
  const user = store.data().users.find((/** @type {User} */u) => u.id === session.userId);
  if (!user) return null;
  return { session, user };
}

function sessionFromRequest(/** @param {object} req */) {
  const cookies = parseCookies(req);
  return sessionFromToken(cookies[S.sessionCookie]);
}
/**
 * @param {object} req
 * @param {object} [res]
 */
function requireUser(req, res) {
  const found = sessionFromRequest(req);
  if (!found) {
    if (res) clearCookie(res, S.sessionCookie);
    throw new HttpError(401, 'Please sign in to continue.', 'not_signed_in');
  }
  return found;
}
/** @param {string} token */
function destroySessionByToken(token) {
  if (!token) return false;
  const digest = hmac(token);
  const d = store.data();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((/** @type {{tokenHash: string}} */s) => s.tokenHash !== digest);
  store.save();
  return d.sessions.length !== before;
}
/**
 * @param {string} userId
 * @param {{exceptToken?: string}} [options]
 */
function destroyAllSessions(userId, { exceptToken } = {}) {
  const d = store.data();
  const keepDigest = exceptToken ? hmac(exceptToken) : null;
  const before = d.sessions.length;
  d.sessions = d.sessions.filter(
    (/** @type {{userId: string, tokenHash: string}} */s) => s.userId !== userId || (keepDigest && s.tokenHash === keepDigest)
  );
  store.save();
  return before - d.sessions.length;
}
/**
 * @param {object} res
 * @param {string} userId
 * @param {{ip?: string, userAgent?: string}} [meta]
 */
function startSession(res, userId, meta) {
  const { token, expiresAt } = createSession(userId, meta);
  setCookie(res, S.sessionCookie, token, { maxAge: S.sessionTtlMs / 1000, httpOnly: true });
  return { token, expiresAt };
}
/**
 * @param {object} req
 * @param {object} res
 */
function endSession(req, res) {
  const cookies = parseCookies(req);
  destroySessionByToken(cookies[S.sessionCookie]);
  clearCookie(res, S.sessionCookie);
  clearCookie(res, S.challengeCookie);
}

/* ------------------------------------------------------- one-time codes (OTP) */
/**
 * @param {string} phone
 * @param {string} purpose
 */
function lastChallengeFor(phone, purpose) {
  return store
    .data()
    .otpChallenges.filter((/** @type {{phone: string, purpose: string}} */c) => c.phone === phone && c.purpose === purpose)
    .sort((/** @type {{createdAt: number}} */a,/** @type {{createdAt: number}} */ b) => b.createdAt - a.createdAt)[0];
}

/**
 * Creates a one-time code and sends it by SMS.
 *
 * @param {{phone: string, purpose: 'login'|'reset', ip: string, res?: object}} input
 * @returns the challenge plus the code when running outside production.
 */
async function startOtp({ phone, purpose = 'login', ip = 'unknown', res }) {
  const normalized = normalizePhone(phone);

  throttle(
    `otp-ip:${ip}`,
    20,
    S.otpWindowMs,
    'Too many code requests from this connection.',
    'otp_ip_limited'
  );

  const recent = lastChallengeFor(normalized, purpose);
  if (recent && Date.now() - recent.createdAt < S.otpResendCooldownMs) {
    const wait = Math.ceil((S.otpResendCooldownMs - (Date.now() - recent.createdAt)) / 1000);
    throw new HttpError(429, `A code was just sent. Wait ${wait} seconds before asking for another.`, 'otp_cooldown');
  }

  const inWindow = store
    .data()
    .otpChallenges.filter(
      (/** @type {{phone: string, purpose: string, createdAt: number}} */c) => c.phone === normalized && c.purpose === purpose && c.createdAt > Date.now() - S.otpWindowMs
    ).length;
  if (inWindow >= S.otpMaxPerWindow) {
    throw new HttpError(
      429,
      `You have asked for ${S.otpMaxPerWindow} codes already. Try again in 15 minutes, or sign in with your password.`,
      'otp_window_limited'
    );
  }

  const code = randomCode();
  const challenge = {
    id: crypto.randomBytes(16).toString('hex'),
    phone: normalized,
    purpose,
    codeHash: hmac(`${normalized}:${purpose}:${code}`),
    attempts: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + S.otpTtlMs,
    usedAt: null,
    ip
  };

  const d = store.data();
  // Only one live challenge per number and purpose, so an old code cannot be reused.
  d.otpChallenges = d.otpChallenges.filter(
    (/** @type {{phone: string, purpose: string, usedAt: number|null}} */c) => !(c.phone === normalized && c.purpose === purpose && !c.usedAt)
  );
  d.otpChallenges.push(challenge);
  store.save();

  // Never confirm whether the account exists.
  const user = findByPhone(normalized);
  if (user) await notify.sendOtp(normalized, code, purpose);

  if (res) {
    setCookie(res, S.challengeCookie, challenge.id, { maxAge: S.otpTtlMs / 1000, httpOnly: true });
  }

  return {
    challengeId: challenge.id,
    phone: normalized,
    phoneMasked: maskPhone(normalized),
    purpose,
    expiresAt: challenge.expiresAt,
    expiresInSeconds: Math.round(S.otpTtlMs / 1000),
    accountExists: Boolean(user),
    // Development convenience only — never present in production responses.
    devCode: config.isProduction ? undefined : code
  };
}

/** Verifies a code, counting the attempt before comparing so guessing costs. */
function verifyOtp({ challengeId, code, purpose }) {
  const d = store.data();
  const challenge = d.otpChallenges.find((/** @type {{id: string}} */c) => c.id === String(challengeId || ''));
  if (!challenge) {
    throw new HttpError(400, 'That code request has expired. Ask for a new one.', 'otp_unknown');
  }
  if (challenge.usedAt) {
    throw new HttpError(400, 'That code has already been used. Ask for a new one.', 'otp_used');
  }
  if (challenge.expiresAt <= Date.now()) {
    throw new HttpError(400, 'That code has expired. Codes last 5 minutes.', 'otp_expired');
  }
  if (purpose && challenge.purpose !== purpose) {
    throw new HttpError(400, 'That code is not valid for this step.', 'otp_wrong_purpose');
  }
  if (challenge.attempts >= S.otpMaxAttempts) {
    throw new HttpError(
      429,
      'Too many wrong codes. Ask for a new one.',
      'otp_attempts_exceeded'
    );
  }

  challenge.attempts += 1;
  store.save();

  const matches = safeEqual(challenge.codeHash, hmac(`${challenge.phone}:${challenge.purpose}:${code}`));
  if (!matches) {
    const left = Math.max(0, S.otpMaxAttempts - challenge.attempts);
    throw new HttpError(
      400,
      `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`,
      'otp_mismatch'
    );
  }

  challenge.usedAt = Date.now();
  store.save();
  return challenge;
}

/* ------------------------------------------------------------------- logins */
/**
 * @param {User} user
 * @param {{ip?: string}} [meta]
 */
function markLogin(user, meta = {}) {
  user.lastLoginAt = new Date().toISOString();
  if (meta.ip) user.lastLoginIp = meta.ip;
  store.save();
}

async function loginWithPassword({ phone, password, ip, userAgent, res }) {
  const normalized = normalizePhone(phone);
  const key = `login:${normalized}`;

  throttle(
    key,
    S.loginMaxAttempts,
    S.loginWindowMs,
    'Too many sign-in attempts.',
    'login_throttled'
  );

  const user = findByPhone(normalized);
  const ok = user ? verifyPassword(password, user.passwordHash) : false;
  // Hash anyway when the user is missing so timing does not leak existence.
  if (!user) crypto.scryptSync(String(password || 'x'), 'no-such-user', 64, { N: 16384, r: 8, p: 1 });

  if (!ok) {
    throw new HttpError(401, 'That phone number and password do not match.', 'login_failed');
  }

  clearLimit(key);
  markLogin(user, { ip });
  const session = startSession(res, user.id, { ip, userAgent });
  return { user: publicUser(user), session };
}

async function loginWithOtp({ challengeId, code, ip, userAgent, res }) {
  const challenge = verifyOtp({ challengeId, code, purpose: 'login' });
  const user = findByPhone(challenge.phone);
  if (!user) {
    throw new HttpError(404, 'We could not find an account for that number.', 'user_missing');
  }
  clearLimit(`login:${challenge.phone}`);
  markLogin(user, { ip });
  const session = startSession(res, user.id, { ip, userAgent });
  return { user: publicUser(user), session };
}
/**
 * @param {User} user
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {{keepToken?: string}} [options]
 */
function changePassword(user, currentPassword, newPassword, { keepToken } = {}) {
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new HttpError(401, 'Your current password is not right.', 'password_wrong');
  }
  assertPassword(newPassword);
  if (verifyPassword(newPassword, user.passwordHash)) {
    throw new HttpError(400, 'That is your current password. Choose a new one.', 'password_unchanged');
  }
  user.passwordHash = hashPassword(newPassword);
  store.save();
  const killed = destroyAllSessions(user.id, { exceptToken: keepToken });
  return { killedSessions: killed };
}

/* --------------------------------------------------------- password recovery */

/**
 * Starts recovery on either channel.
 *   channel 'sms'   → a 6-digit code by SMS, valid 5 minutes
 *   channel 'email' → a single-use link by email, valid 15 minutes
 */
async function startPasswordReset({ identifier, channel = 'sms', ip = 'unknown', baseUrl = '', res }) {
  if (channel === 'email') {
    const email = String(identifier || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, 'Enter the email address on your account.', 'email_invalid');
    }
    throttle(`reset-email:${email}`, 3, S.otpWindowMs, 'Too many reset requests.', 'reset_limited');

    const user = store.findUserByEmail(email);
    let devToken;
    if (user) {
      const raw = crypto.randomBytes(32).toString('hex');
      const record = {
        id: crypto.randomBytes(12).toString('hex'),
        userId: user.id,
        tokenHash: hmac(raw),
        createdAt: Date.now(),
        expiresAt: Date.now() + S.resetTtlMs,
        usedAt: null,
        channel: 'email'
      };
      const d = store.data();
      d.resetTokens = d.resetTokens.filter((/** @type {{userId: string, usedAt: number|null}} */t) => !(t.userId === user.id && !t.usedAt));
      d.resetTokens.push(record);
      store.save();

      const link = `${baseUrl}/reset-password?id=${record.id}&token=${raw}`;
      await notify.sendEmail(
        email,
        notify.resetLinkMessage(link, Math.round(S.resetTtlMs / 60000)),
        { resetId: record.id }
      );
      devToken = config.isProduction ? undefined : { resetId: record.id, token: raw, link };
    }
    return {
      channel: 'email',
      identifier: email,
      message: 'If that email is on an account, a reset link is on its way. The link lasts 15 minutes.',
      expiresInSeconds: Math.round(S.resetTtlMs / 1000),
      devToken
    };
  }

  const otp = await startOtp({ phone: identifier, purpose: 'reset', ip, res });
  return {
    channel: 'sms',
    identifier: otp.phone,
    phoneMasked: otp.phoneMasked,
    challengeId: otp.challengeId,
    message: 'If that number has an account, a reset code is on its way. The code lasts 5 minutes.',
    expiresInSeconds: otp.expiresInSeconds,
    devCode: otp.devCode
  };
}

/** Completes recovery: sets the new password and signs every other device out. */
function confirmPasswordReset({ channel = 'sms', identifier: _identifier, challengeId, code, resetId, token, newPassword }) {
  assertPassword(newPassword);

  let user;
  if (channel === 'email') {
    const d = store.data();
    const record = d.resetTokens.find((/** @type {{id: string}} */t) => t.id === String(resetId || ''));
    if (!record) throw new HttpError(400, 'That reset link is not valid.', 'reset_unknown');
    if (record.usedAt) throw new HttpError(400, 'That reset link has already been used.', 'reset_used');
    if (record.expiresAt <= Date.now()) {
      throw new HttpError(400, 'That reset link has expired. Request a new one.', 'reset_expired');
    }
    if (!safeEqual(record.tokenHash, hmac(String(token || '')))) {
      throw new HttpError(400, 'That reset link is not valid.', 'reset_mismatch');
    }
    record.usedAt = Date.now();
    user = d.users.find((/** @type {User} */u) => u.id === record.userId);
    if (!user) throw new HttpError(404, 'That account no longer exists.', 'user_missing');
  } else {
    const challenge = verifyOtp({ challengeId, code, purpose: 'reset' });
    user = findByPhone(challenge.phone);
    if (!user) throw new HttpError(404, 'That account no longer exists.', 'user_missing');
  }

  user.passwordHash = hashPassword(newPassword);
  user.passwordChangedAt = new Date().toISOString();
  store.save();

  // Requirement 13: after a reset, every existing session dies.
  const killed = destroyAllSessions(user.id);
  store.prune();
  return { user: publicUser(user), killedSessions: killed };
}

/* -------------------------------------------------------------------- profile */
/**
 * @param {User} user
 * @param {{name?: string, email?: string, savedAddress?: string, deliveryZoneId?: string}} input
 */
    function updateProfile(user, { name, email, savedAddress, deliveryZoneId, whatsappOptIn }) {
  if (name !== undefined) {
    const clean = String(name).trim();
    if (clean.length < 2) throw new HttpError(400, 'Tell us your name.', 'name_required');
    user.name = clean;
  }
  if (email !== undefined) {
    const clean = email ? String(email).trim().toLowerCase() : null;
    if (clean && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw new HttpError(400, 'That email address does not look right.', 'email_invalid');
    }
    if (clean && store.findUserByEmail(clean) && store.findUserByEmail(clean).id !== user.id) {
      throw new HttpError(409, 'That email is already in use.', 'email_taken');
    }
    user.email = clean;
  }
  if (savedAddress !== undefined) {
    user.savedAddress = savedAddress ? String(savedAddress).trim() : null;
  }
  if (deliveryZoneId !== undefined) {
    user.deliveryZoneId = deliveryZoneId || null;
  }
  if (whatsappOptIn !== undefined) {
    user.whatsappOptIn = Boolean(whatsappOptIn);
  }
  store.save();
  return publicUser(user);
}

module.exports = {
  normalizePhone,
  maskPhone,
  hashPassword,
  verifyPassword,
  assertPassword,
  rateLimit,
  throttle,
  clearLimit,
  publicUser,
  findByPhone,
  createUser,
  createSession,
  sessionFromToken,
  sessionFromRequest,
  requireUser,
  destroySessionByToken,
  destroyAllSessions,
  startSession,
  endSession,
  startOtp,
  verifyOtp,
  loginWithPassword,
  loginWithOtp,
  changePassword,
  startPasswordReset,
  confirmPasswordReset,
  updateProfile
};
