'use strict';
/**
 * The JSON API. Every handler is thin: validate, call a module, return JSON.
 *
 * Route table at the bottom. `:name` segments become `params.name`.
 */

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const catalog = require('./catalog');
const delivery = require('./delivery');
const payments = require('./payments');
const orders = require('./orders');
const auth = require('./auth');
const notify = require('./notify');
const httpUtil = require('./http');
const { HttpError, json } = httpUtil;

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || (config.isProduction ? 'https' : 'http');
  const host = req.headers.host || `localhost:${config.PORT}`;
  return `${proto}://${host}`;
}

function requireStaff(req) {
  const token = req.headers['x-staff-token'] || '';
  if (!config.order.staffToken || token !== config.order.staffToken) {
    throw new HttpError(401, 'Staff token required.', 'staff_token_invalid');
  }
}

/* ---------------------------------------------------------------- storefront */

const health = () => ({ ok: true, service: 'wheatburn-shop', env: config.NODE_ENV, time: new Date().toISOString() });

const storefront = () => ({
  ...httpUtil.publicConfig(),
  categories: catalog.categories(),
  delivery: delivery.requirements(),
  paymentMethods: payments.list(),
  productCount: catalog.count,
  priceNote: catalog.priceNote
});

function listProducts(req, res, url, params, input) {
  const channel = url.searchParams.get('channel') === 'wholesale' ? 'wholesale' : 'retail';
  return {
    channel,
    categories: catalog.categories(),
    products: catalog.list({
      category: url.searchParams.get('category') || 'all',
      q: url.searchParams.get('q') || '',
      featured: url.searchParams.get('featured') === 'true',
      channel
    })
  };
}

function getProduct(req, res, url, params, input) {
  const channel = url.searchParams.get('channel') === 'wholesale' ? 'wholesale' : 'retail';
  const product = catalog.getOrThrow(params.id);
  return { product: catalog.serialize(product, { channel }) };
}

const deliveryInfo = () => ({
  zones: delivery.zones(),
  pickup: delivery.pickup(),
  ...delivery.requirements(),
  freeDeliveryFromRwf: config.order.freeDeliveryFromRwf,
  estimate: delivery.estimateDispatch(new Date())
});

const paymentInfo = () => ({ methods: payments.list() });

/** Live basket pricing — used by the order page on every change. */
function quoteCart(req, res, url, params, input) {
  const channel = input.channel === 'wholesale' ? 'wholesale' : 'retail';
  const items = Array.isArray(input.items) ? input.items : [];

  // An empty basket is a normal state on the order page, not an error.
  if (items.length === 0) {
    return {
      currency: catalog.CURRENCY,
      channel,
      lines: [],
      problems: [],
      itemCount: 0,
      subtotal: 0,
      subtotalLabel: catalog.formatRwf(0),
      minOrderRwf: config.order.minOrderRwf,
      meetsMinimum: false,
      delivery: null,
      total: 0,
      totalLabel: catalog.formatRwf(0),
      freeDeliveryFromRwf: config.order.freeDeliveryFromRwf,
      dispatchPreview: null
    };
  }

  const quote = catalog.quote(items, { channel });
  let shipping = null;
  if (input.deliveryZoneId) {
    shipping = delivery.resolve(input.deliveryZoneId, quote.subtotal, { channel });
  }
  const total = quote.subtotal + (shipping ? shipping.fee : 0);
  return {
    ...quote,
    delivery: shipping,
    total,
    totalLabel: catalog.formatRwf(total),
    freeDeliveryFromRwf: config.order.freeDeliveryFromRwf,
    dispatchPreview: shipping
      ? delivery.estimateDispatch(new Date(), {
          isPickup: shipping.isPickup,
          leadTimeHours: quote.maxLeadTimeHours
        })
      : null
  };
}

/* -------------------------------------------------------------------- account */

async function register(req, res, url, params, input) {
  const user = auth.createUser({
    name: input.name,
    phone: input.phone,
    password: input.password,
    email: input.email,
    whatsappOptIn: input.whatsappOptIn
  });
  auth.startSession(res, user.id, { ip: httpUtil.clientIp(req), userAgent: req.headers['user-agent'] });
  if (input.savedAddress) auth.updateProfile(user, { savedAddress: input.savedAddress });
  return { user: auth.publicUser(user), message: `Welcome to Wheatburn, ${user.name.split(' ')[0]}.` };
}

async function loginPassword(req, res, url, params, input) {
  const result = await auth.loginWithPassword({
    phone: input.phone,
    password: input.password,
    ip: httpUtil.clientIp(req),
    userAgent: req.headers['user-agent'],
    res
  });
  return { user: result.user, message: `Welcome back, ${result.user.name.split(' ')[0]}.` };
}

async function startOtp(req, res, url, params, input) {
  const purpose = input.purpose === 'reset' ? 'reset' : 'login';
  const result = await auth.startOtp({
    phone: input.phone,
    purpose,
    ip: httpUtil.clientIp(req),
    res
  });
  return {
    ...result,
    // Deliberately identical whether or not the number has an account.
    message: `If ${result.phoneMasked} has an account, a ${config.security.otpLength}-digit code is on its way. It lasts ${Math.round(config.security.otpTtlMs / 60000)} minutes.`
  };
}

async function verifyOtpLogin(req, res, url, params, input) {
  const result = await auth.loginWithOtp({
    challengeId: input.challengeId,
    code: input.code,
    ip: httpUtil.clientIp(req),
    userAgent: req.headers['user-agent'],
    res
  });
  return { user: result.user, message: `Signed in as ${result.user.name.split(' ')[0]}.` };
}

async function session(req) {
  const found = auth.sessionFromRequest(req);
  if (!found) return { user: null };
  return { user: auth.publicUser(found.user) };
}

async function logout(req, res) {
  auth.endSession(req, res);
  return { ok: true, message: 'You are signed out on this device.' };
}

/** Full dashboard payload: profile, counters, orders, saved details. */
async function dashboard(req, res) {
  const { user } = auth.requireUser(req, res);
  const current = auth.sessionFromRequest(req);
  return {
    user: auth.publicUser(user),
    stats: orders.statsForUser(user.id),
    orders: orders.listForUser(user.id),
    deliveryZoneId: user.deliveryZoneId || null,
    savedAddress: user.savedAddress || null,
    sessionExpiresAt: current ? current.session.expiresAt : null
  };
}

async function patchAccount(req, res, url, params, input) {
  const { user } = auth.requireUser(req, res);
  return { user: auth.updateProfile(user, input), message: 'Your details are saved.' };
}

async function changePassword(req, res, url, params, input) {
  const { user, session } = auth.requireUser(req, res);
  const cookies = httpUtil.parseCookies(req);
  const result = auth.changePassword(user, input.currentPassword, input.newPassword, {
    keepToken: cookies[config.security.sessionCookie]
  });
  return {
    ok: true,
    killedSessions: result.killedSessions,
    message: 'Password changed. Other devices have been signed out.'
  };
}

/* --------------------------------------------------------------------- orders */

async function createOrder(req, res, url, params, input) {
  const found = auth.sessionFromRequest(req);
  const order = await orders.createOrder({
    items: input.items,
    customer: input.customer,
    deliveryZoneId: input.deliveryZoneId,
    payment: input.payment,
    user: found ? found.user : null,
    baseUrl: baseUrl(req),
    ip: httpUtil.clientIp(req)
  });
  return {
    order,
    message: `Order ${order.number} received. We sent a confirmation to ${order.customer.phone}.`
  };
}

async function myOrders(req, res) {
  const { user } = auth.requireUser(req, res);
  return { orders: orders.listForUser(user.id) };
}

/** A signed-in owner, or a guest with the matching order number and phone. */
async function getOrder(req, res, url, params) {
  const found = auth.sessionFromRequest(req);
  const number = params.number;

  if (found) {
    try {
      return { order: orders.serialize(orders.findOwned(number, found.user)) };
    } catch (err) {
      if (err.code !== 'order_forbidden' && err.code !== 'order_not_found') throw err;
      // Fall through to the guest path so visitors can still track a guest order.
    }
  }
  const phone = url.searchParams.get('phone') || '';
  return { order: orders.findByNumberAndPhone(number, phone) };
}

async function trackOrder(req, res, url, params, input) {
  return { order: orders.findByNumberAndPhone(input.number, input.phone) };
}

async function reorder(req, res, url, params) {
  const { user } = auth.requireUser(req, res);
  return orders.reorderPayload(params.id, user);
}

/* ---------------------------------------------------------------------- staff */

async function staffOrders(req, res, url) {
  requireStaff(req);
  const status = url.searchParams.get('status');
  const list = store
    .data()
    .orders.slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((o) => !status || o.status === status)
    .slice(0, Number(url.searchParams.get('limit') || 40))
    .map(orders.serialize);
  return { orders: list, statuses: orders.STATUSES };
}

async function staffSetStatus(req, res, url, params, input) {
  requireStaff(req);
  return {
    order: orders.advanceStatus({
      orderId: input.orderId,
      status: input.status,
      note: input.note,
      by: input.by || 'staff',
      notifyCustomer: input.notifyCustomer !== false
    })
  };
}

/* -------------------------------------------------------------------- contact */

async function contact(req, res, url, params, input) {
  const name = String(input.name || '').trim();
  const message = String(input.message || '').trim();
  if (name.length < 2) throw new HttpError(400, 'Tell us your name.', 'name_required');
  if (message.length < 5) throw new HttpError(400, 'Add a short message.', 'message_required');
  const phone = input.phone ? auth.normalizePhone(input.phone) : null;

  auth.throttle(
    `contact:${httpUtil.clientIp(req)}`,
    5,
    config.security.otpWindowMs,
    'You have sent a few messages already.'
  );

  const record = {
    id: crypto.randomUUID(),
    name,
    phone,
    email: input.email ? String(input.email).trim().slice(0, 120) : null,
    topic: input.topic ? String(input.topic).slice(0, 40) : 'general',
    message: message.slice(0, 2000),
    createdAt: new Date().toISOString(),
    ip: httpUtil.clientIp(req)
  };
  store.data().contactMessages.push(record);
  store.save();

  await notify.sendSms(
    config.brand.phone,
    `Wheatburn website message (${record.topic}) from ${name}${phone ? ` · ${phone}` : ''}:\n${record.message}`,
    { contact: record.id }
  );

  return { ok: true, message: 'Thank you — we will reply on WhatsApp or by phone during counter hours.' };
}

/* ---------------------------------------------------------------------- table */

const ROUTES = [
  ['GET', 'health', health],
  ['GET', 'config', storefront],
  ['GET', 'products', listProducts],
  ['GET', 'products/:id', getProduct],
  ['GET', 'delivery', deliveryInfo],
  ['GET', 'payments', paymentInfo],
  ['POST', 'cart/quote', quoteCart],

  ['POST', 'auth/register', register],
  ['POST', 'auth/login', loginPassword],
  ['POST', 'auth/otp/start', startOtp],
  ['POST', 'auth/otp/verify', verifyOtpLogin],
  ['POST', 'auth/reset/start', async (req, res, url, params, input) => ({
    ...(await auth.startPasswordReset({
      identifier: input.identifier,
      channel: input.channel === 'email' ? 'email' : 'sms',
      ip: httpUtil.clientIp(req),
      baseUrl: baseUrl(req),
      res
    }))
  })],
  ['POST', 'auth/reset/confirm', async (req, res, url, params, input) => ({
    ok: true,
    ...auth.confirmPasswordReset({
      channel: input.channel === 'email' ? 'email' : 'sms',
      identifier: input.identifier,
      challengeId: input.challengeId,
      code: input.code,
      resetId: input.resetId,
      token: input.token,
      newPassword: input.newPassword
    }),
    message: 'Your password is set. Sign in with your phone number and the new password.'
  })],
  ['GET', 'auth/session', session],
  ['POST', 'auth/logout', logout],

  ['GET', 'account', dashboard],
  ['PATCH', 'account', patchAccount],
  ['POST', 'account/password', changePassword],

  ['POST', 'orders', createOrder],
  ['GET', 'orders', myOrders],
  ['GET', 'orders/:number', getOrder],
  ['POST', 'orders/:id/reorder', reorder],
  ['POST', 'orders/track', trackOrder],

  ['GET', 'staff/orders', staffOrders],
  ['POST', 'staff/orders/status', staffSetStatus],

  ['POST', 'contact', contact]
];

function matchRoute(method, segments) {
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const parts = pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].startsWith(':')) {
        params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
      } else if (parts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, params };
  }
  return null;
}

async function handleApi(req, res, url) {
  store.prune();

  const method = req.method.toUpperCase();
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (segments.length === 0) {
    json(res, 200, {
      service: 'Wheatburn shop API',
      endpoints: ROUTES.map(([m, p]) => `${m} /api/${p}`)
    });
    return;
  }

  const matched = matchRoute(method, segments);
  if (!matched) {
    throw new HttpError(404, `No API route for ${method} ${url.pathname}.`, 'route_not_found');
  }

  const input = method === 'GET' || method === 'HEAD' ? {} : await httpUtil.readInput(req);
  const payload = await matched.handler(req, res, url, matched.params, input);
  json(res, 200, payload);
}

module.exports = { handleApi, ROUTES, baseUrl };
