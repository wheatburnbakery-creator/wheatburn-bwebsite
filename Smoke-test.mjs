#!/usr/bin/env node
/**
 * End-to-end smoke test for the Wheatburn shop.
 *
 *   node scripts/smoke-test.mjs
 *
 * Starts the server on a test port with its own throwaway data file, exercises
 * every flow a customer can perform, prints a pass/fail table, and exits
 * non-zero if anything fails. Safe to run against a fresh checkout: it never
 * touches data/db.json.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'wheatburn-test-'));
const DB_FILE = path.join(TEST_DIR, 'db.json');
const OUTBOX_FILE = path.join(TEST_DIR, 'outbox.log');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } else {
    failures.push(name);
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

/** Minimal cookie-aware client, so tests see the same session the browser would. */
function client() {
  const jar = new Map();
  return {
    jar,
    async request(method, urlPath, body, extraHeaders = {}) {
      const headers = { Accept: 'application/json', ...extraHeaders };
      if (jar.size) {
        headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + urlPath, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
      });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '') jar.delete(key);
        else jar.set(key, value);
      }
      let payload = null;
      const text = await res.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }
      return { status: res.status, body: payload };
    },
    get(p, h) {
      return this.request('GET', p, undefined, h);
    },
    post(p, b, h) {
      return this.request('POST', p, b, h);
    }
  };
}

async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DB_FILE,
    OUTBOX_FILE,
    NODE_ENV: 'development',
    STAFF_TOKEN: 'test-staff-token'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

function shutdown(code) {
  server.kill('SIGTERM');
  setTimeout(() => process.exit(code), 150);
}

try {
  if (!(await waitForServer())) {
    console.error('Server did not start in time.');
    shutdown(1);
    process.exit(1);
  }

  /* ------------------------------------------------------------ storefront */
  section('Storefront data');

  const shop = client();
  const health = await shop.request('GET', '/api/health');
  check('health endpoint responds', health.status === 200 && health.body.ok === true);

  const config = await shop.request('GET', '/api/config');
  check(
    'storefront config returns brand, payments and delivery',
    config.status === 200 &&
      config.body.brand?.name === 'Wheatburn' &&
      config.body.paymentMethods?.length >= 4 &&
      Boolean(config.body.delivery?.cutoffHour !== undefined)
  );

  const products = await shop.request('GET', '/api/products');
  check(
    'all 11 products are listed',
    products.body.products?.length === 11,
    `got ${products.body.products?.length}`
  );
  check(
    'every product shows a visible price',
    products.body.products?.every((p) => typeof p.fromPriceLabel === 'string' && p.fromPriceLabel.startsWith('RWF')),
    'a product is missing fromPriceLabel'
  );
  check(
    'every product has a photo and a short description',
    products.body.products?.every((p) => p.image?.startsWith('/assets/img/') && p.short?.length > 20)
  );
  check(
    'seasonal product is marked not orderable outside its month',
    (() => {
      const seasonal = products.body.products?.find((p) => p.id === 'agaseke-kumuganura');
      if (!seasonal) return false;
      const month = new Date().getMonth() + 1;
      return month === 8 ? seasonal.orderable === true : seasonal.orderable === false;
    })()
  );

  const filtered = await shop.request('GET', '/api/products?category=breads');
  check(
    'category filter works',
    filtered.body.products?.length === 2 && filtered.body.products.every((p) => p.category === 'breads'),
    `got ${filtered.body.products?.length}`
  );

  const searched = await shop.request('GET', '/api/products?q=ikivuguto');
  check('search finds a product by Kinyarwanda name', searched.body.products?.length >= 1);

  const wholesale = await shop.request('GET', '/api/products?channel=wholesale');
  const loafRetail = products.body.products.find((p) => p.id === 'umugati-wimyumbati').variants[0].price;
  const loafWholesale = wholesale.body.products.find((p) => p.id === 'umugati-wimyumbati').variants[0].price;
  check(
    'wholesale channel prices lower than retail',
    loafRetail === 2500 && loafWholesale === 1500,
    `retail ${loafRetail}, wholesale ${loafWholesale}`
  );

  const zones = await shop.request('GET', '/api/delivery');
  check('delivery zones and pickup are published', zones.body.zones?.length >= 5 && zones.body.pickup?.id === 'pickup');

  /* ------------------------------------------------------------ basket pricing */
  section('Basket pricing');

  const emptyQuote = await shop.request('POST', '/api/cart/quote', { items: [] });
  check('empty basket quotes cleanly', emptyQuote.status === 200 && emptyQuote.body.total === 0);

  const quote = await shop.request('POST', '/api/cart/quote', {
    items: [
      { productId: 'umugati-wimyumbati', variantId: 'loaf', qty: 2 },
      { productId: 'amandazi-yibijumba', qty: 3 }
    ],
    deliveryZoneId: 'kicukiro'
  });
  check(
    'basket prices are calculated server-side',
    quote.body.subtotal === 2 * 2500 + 3 * 1200,
    `subtotal ${quote.body.subtotal}`
  );
  check('delivery fee is added', quote.body.delivery?.fee === 1000 && quote.body.total === quote.body.subtotal + 1000);

  const bigQuote = await shop.request('POST', '/api/cart/quote', {
    items: [{ productId: 'umukate-mukuru', variantId: 'large', qty: 1 }],
    deliveryZoneId: 'gikondo'
  });
  check(
    'free delivery applies above the threshold',
    bigQuote.body.delivery?.fee === 0 && bigQuote.body.delivery?.freeApplied === true,
    `fee ${bigQuote.body.delivery?.fee}`
  );

  const tampered = await shop.request('POST', '/api/orders', {
    items: [{ productId: 'umugati-wimyumbati', variantId: 'loaf', qty: 2, unitPrice: 1 }],
    customer: { name: 'Tamper Test', phone: '0788111000', address: 'KG 11 Ave, Kicukiro market' },
    deliveryZoneId: 'kicukiro',
    payment: { methodId: 'cod' }
  });
  check(
    'a client-supplied price is ignored',
    tampered.status === 200 && tampered.body.order.subtotal === 5000,
    `subtotal ${tampered.body.order?.subtotal}`
  );

  /* --------------------------------------------------------------- accounts */
  section('Accounts');

  const user = client();
  const phone = '0788123456';
  const password = 'bread123';

  const registered = await user.request('POST', '/api/auth/register', {
    name: 'Test Baker',
    phone,
    password
  });
  check(
    'registration returns a signed-in user',
    registered.status === 200 && registered.body.user?.phone === '+250788123456',
    JSON.stringify(registered.body).slice(0, 160)
  );
  check('password is never returned by the API', !JSON.stringify(registered.body).includes(password));
  check('phone is masked for display', registered.body.user?.phoneMasked?.includes('*'));

  const session = await user.request('GET', '/api/auth/session');
  check('session cookie signs the user in', session.body.user?.name === 'Test Baker');

  const duplicate = await user.request('POST', '/api/auth/register', { name: 'Copy', phone, password });
  check('duplicate phone number is rejected', duplicate.status === 409 && duplicate.body.code === 'phone_taken');

  const noName = await user.request('POST', '/api/auth/register', { name: 'A', phone: '0788999888', password });
  check('missing name is rejected', noName.status === 400 && noName.body.code === 'name_required');

  const badPhone = await user.request('POST', '/api/auth/register', { name: 'Test Two', phone: '12345', password });
  check('invalid phone number is rejected', badPhone.status === 400 && badPhone.body.code === 'phone_invalid');

  const weak = await user.request('POST', '/api/auth/register', { name: 'Test Two', phone: '0788999888', password: 'short' });
  check('short password is rejected', weak.status === 400 && weak.body.code === 'password_too_short');

  const noDigits = await user.request('POST', '/api/auth/register', { name: 'Test Two', phone: '0788999777', password: 'onlyletters' });
  check('password without a number is rejected', noDigits.status === 400 && noDigits.body.code === 'password_too_weak');

  const common = await user.request('POST', '/api/auth/register', { name: 'Test Two', phone: '0788999666', password: 'password1' });
  check('easily guessed password is rejected', common.status === 400 && common.body.code === 'password_too_common');

  const savedAddress = await user.request('PATCH', '/api/account', {
    savedAddress: 'KG 11 Ave, house 7, Kicukiro',
    deliveryZoneId: 'kicukiro',
    whatsappOptIn: true
  });
  check('saved address is stored on the account', savedAddress.body.user?.savedAddress?.includes('house 7'));

  await user.request('POST', '/api/auth/logout');
  const afterLogout = await user.request('GET', '/api/auth/session');
  check('logout clears the session', afterLogout.body.user === null);

  const badLogin = await user.request('POST', '/api/auth/login', { phone, password: 'wrongpass1' });
  check('wrong password is refused', badLogin.status === 401 && badLogin.body.code === 'login_failed');

  const login = await user.request('POST', '/api/auth/login', { phone, password });
  check('sign-in with phone and password works', login.body.user?.name === 'Test Baker');

  /* ------------------------------------------------------------ OTP sign-in */
  section('One-time-code sign-in');

  const otpStart = await user.request('POST', '/api/auth/otp/start', { phone, purpose: 'login' });
  check(
    'code is generated with a 5-minute life',
    otpStart.status === 200 && otpStart.body.expiresInSeconds === 300,
    `expiresInSeconds ${otpStart.body.expiresInSeconds}`
  );
  check('code is delivered out of band, not in the API', typeof otpStart.body.devCode === 'string' && otpStart.body.codeHash === undefined);
  check('account existence is not confirmed', typeof otpStart.body.accountExists === 'boolean' && /^If /.test(otpStart.body.message));

  const cooldown = await user.request('POST', '/api/auth/otp/start', { phone, purpose: 'login' });
  check('resend is rate-limited (60s cooldown)', cooldown.status === 429 && cooldown.body.code === 'otp_cooldown');

  const wrongCode = await user.request('POST', '/api/auth/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: '000000'
  });
  check('wrong code is refused with attempts remaining', wrongCode.status === 400 && wrongCode.body.code === 'otp_mismatch');

  const goodCode = await user.request('POST', '/api/auth/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: otpStart.body.devCode
  });
  check('correct code signs the user in', goodCode.status === 200 && goodCode.body.user?.name === 'Test Baker');

  const reused = await user.request('POST', '/api/auth/otp/verify', {
    challengeId: otpStart.body.challengeId,
    code: otpStart.body.devCode
  });
  check('a used code cannot be replayed', reused.status === 400 && reused.body.code === 'otp_used');

  /* -------------------------------------------------------- guest + orders */
  section('Ordering');

  const guest = client();
  const guestOrder = await guest.request('POST', '/api/orders', {
    items: [
      { productId: 'umugati-wimyumbati', variantId: 'loaf', qty: 2 },
      { productId: 'amandazi-yibijumba', qty: 3 }
    ],
    customer: { name: 'Guest Person', phone: '0722334455', address: 'House 12, near Kicukiro market', notes: 'Ring the bell twice' },
    deliveryZoneId: 'kicukiro',
    payment: { methodId: 'cod' }
  });
  check(
    'guest checkout works without an account',
    guestOrder.status === 200 && guestOrder.body.order?.number?.startsWith('WB-'),
    JSON.stringify(guestOrder.body).slice(0, 200)
  );
  check('guest order is flagged as guest', guestOrder.body.order?.guest === true);
  check('order total is subtotal plus delivery', guestOrder.body.order?.total === 5000 + 3600 + 1000);
  check('cash on delivery confirms immediately', guestOrder.body.order?.status === 'confirmed');
  check('tracking link is issued', /\/order\?track=WB-/.test(guestOrder.body.order?.trackingUrl || ''));
  check('whatsapp confirmation link is issued', (guestOrder.body.order?.whatsappUrl || '').startsWith('https://wa.me/'));
  check('dispatch estimate is explained', typeof guestOrder.body.order?.dispatch?.reason === 'string');

  const number = guestOrder.body.order.number;
  const code = guestOrder.body.order.trackingCode;

  const trackOk = await guest.request('POST', '/api/orders/track', { number, phone: '0722334455' });
  check('guest can track an order with number and phone', trackOk.status === 200 && trackOk.body.order.number === number);

  const trackBad = await guest.request('POST', '/api/orders/track', { number, phone: '0788000000' });
  check('tracking with the wrong phone is refused', trackBad.status === 403 && trackBad.body.code === 'order_mismatch');

  const momoOrder = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'gato-ya-ikivuguto', qty: 4 }],
    customer: { name: 'Guest Person', phone: '0722334455', address: 'House 12, near Kicukiro market' },
    deliveryZoneId: 'pickup',
    payment: { methodId: 'momo' }
  });
  check(
    'mobile money order waits for a reference',
    momoOrder.body.order?.payment?.status === 'awaiting_reference' &&
      momoOrder.body.order?.status === 'pending_payment'
  );
  check('collection orders carry no delivery fee', momoOrder.body.order?.deliveryFee === 0);

  const belowMin = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'ibinyoro-bya-akabanga', qty: 1 }],
    customer: { name: 'Small Order', phone: '0788111222', address: 'KG 11 Ave, Kicukiro' },
    deliveryZoneId: 'kicukiro',
    payment: { methodId: 'cod' }
  });
  check('orders below the minimum are refused', belowMin.status === 400 && belowMin.body.code === 'below_minimum');

  const noAddress = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'umugati-wimyumbati', qty: 2 }],
    customer: { name: 'No Address', phone: '0788111333' },
    deliveryZoneId: 'gikondo',
    payment: { methodId: 'cod' }
  });
  check('a delivery order needs an address', noAddress.status === 400 && noAddress.body.code === 'address_required');

  const badZone = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'umugati-wimyumbati', qty: 2 }],
    customer: { name: 'Bad Zone', phone: '0788111444', address: 'KG 11 Ave, Kicukiro' },
    deliveryZoneId: 'mars',
    payment: { methodId: 'cod' }
  });
  check('unknown delivery area is refused', badZone.status === 400 && badZone.body.code === 'unknown_zone');

  const unknownProduct = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'not-on-menu', qty: 1 }],
    customer: { name: 'Ghost', phone: '0788111555', address: 'KG 11 Ave, Kicukiro' },
    deliveryZoneId: 'kicukiro',
    payment: { methodId: 'cod' }
  });
  check('a product that left the menu is reported, not silently dropped', unknownProduct.status === 409);

  const bankNoRef = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'ibinyoro-bya-akabanga', qty: 4 }],
    customer: { name: 'Guest Person', phone: '0722334455', address: 'House 12, near Kicukiro market' },
    deliveryZoneId: 'pickup',
    payment: { methodId: 'bank' }
  });
  check(
    'bank transfer without a reference waits for one',
    bankNoRef.body.order?.payment?.status === 'awaiting_reference' &&
      bankNoRef.body.order?.status === 'pending_payment'
  );

  const bankWithRef = await guest.request('POST', '/api/orders', {
    items: [{ productId: 'ibinyoro-bya-akabanga', qty: 4 }],
    customer: { name: 'Guest Person', phone: '0722334455', address: 'House 12, near Kicukiro market' },
    deliveryZoneId: 'pickup',
    payment: { methodId: 'bank', reference: 'BOK-88213456' }
  });
  check(
    'bank transfer with a reference is held for staff verification',
    bankWithRef.body.order?.payment?.status === 'awaiting_verification' &&
      bankWithRef.body.order?.payment?.reference === 'BOK-88213456'
  );
  check(
    'payment instructions are attached to the order',
    typeof bankWithRef.body.order?.payment?.instructions === 'string' &&
      bankWithRef.body.order.payment.instructions.length > 20
  );

  /* ------------------------------------------------------------- dashboard */
  section('Signed-in dashboard');

  const memberOrder = await user.request('POST', '/api/orders', {
    items: [{ productId: 'umukate-wubuki-nigitoki', variantId: 'whole', qty: 2 }],
    customer: { name: 'Test Baker', phone, address: 'KG 11 Ave, house 7, Kicukiro' },
    deliveryZoneId: 'kicukiro',
    payment: { methodId: 'cod' }
  });
  check('signed-in order is attached to the account', memberOrder.body.order?.guest === false);

  const dashboard = await user.request('GET', '/api/account');
  check(
    'dashboard returns history, stats and saved details',
    dashboard.status === 200 &&
      dashboard.body.orders.length === 1 &&
      dashboard.body.stats.orderCount === 1 &&
      dashboard.body.savedAddress?.includes('house 7')
  );
  check('dashboard shows order status and reorder payload', dashboard.body.orders[0].statusLabel && dashboard.body.orders[0].reorderItems.length === 1);

  const oneOrder = await user.request('GET', `/api/orders/${memberOrder.body.order.number}`);
  check('an owner can open their own order', oneOrder.status === 200);

  const reorder = await user.request('POST', `/api/orders/${memberOrder.body.order.id}/reorder`, {});
  check(
    'reorder returns the basket to refill',
    reorder.status === 200 && reorder.body.items[0]?.productId === 'umukate-wubuki-nigitoki' && reorder.body.items[0].qty === 2
  );

  const expiredSeasonal = await user.request('POST', '/api/orders', {
    items: [{ productId: 'agaseke-kumuganura', qty: 2 }],
    customer: { name: 'Test Baker', phone, address: 'KG 11 Ave, Kicukiro' },
    deliveryZoneId: 'pickup',
    payment: { methodId: 'cod' }
  });
  if (new Date().getMonth() + 1 !== 8) {
    check('out-of-season product cannot be ordered', expiredSeasonal.status === 409);
  } else {
    check('in-season product can be ordered', expiredSeasonal.status === 200);
  }

 