'use strict';
/**
 * The catalogue and the single source of pricing truth.
 *
 * Money is handled as whole Rwandan francs in integers. RWF has no practical
 * subunit in daily trade, so integers remove floating-point rounding bugs from
 * the checkout entirely.
 *
 * The client is never trusted with a price: whatever the browser sends, the
 * server re-reads the product here and recalculates every line.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { HttpError } = require('./http');

const DATA = JSON.parse(fs.readFileSync(path.join(config.DATA_DIR, 'products.json'), 'utf8'));

const CURRENCY = DATA.currency || 'RWF';
const VAT_INCLUDED = DATA.vatIncluded !== false;
const MAX_QTY_PER_LINE = 99;

const byId = new Map(DATA.products.map((p) => [p.id, p]));

function categories() {
  return DATA.categories.slice();
}

/**
 * Seasonal products are only orderable inside their months. Everything else is
 * orderable whenever `available` is true.
 */
function orderable(product, now = new Date()) {
  if (product.available === false) {
    return { ok: false, reason: 'This line is off the shelf right now.' };
  }
  const season = product.availability;
  if (season && season.type === 'seasonal' && Array.isArray(season.months)) {
    const month = now.getMonth() + 1;
    if (!season.months.includes(month)) {
      return { ok: false, reason: season.note || 'Only available in season.' };
    }
  }
  return { ok: true };
}

function priceFor(product, variant, channel) {
  if (channel === 'wholesale') {
    return Number(variant.wholesale ?? variant.retail);
  }
  return Number(variant.retail);
}

function formatRwf(amount) {
  return `${CURRENCY} ${Number(amount).toLocaleString('en-US')}`;
}

/** Shape sent to the browser. Both prices are always visible. */
function serialize(product, { channel = 'retail', now = new Date() } = {}) {
  const status = orderable(product, now);
  const retail = Math.min(...product.variants.map((v) => v.retail));
  const wholesale = Math.min(...product.variants.map((v) => Number(v.wholesale ?? v.retail)));
  return {
    id: product.id,
    name: product.name,
    gloss: product.gloss,
    category: product.category,
    unit: product.unit,
    image: product.image,
    short: product.short,
    long: product.long,
    rwandanInputs: product.rwandanInputs,
    badge: product.badge,
    featured: Boolean(product.featured),
    leadTimeHours: product.leadTimeHours || 0,
    confirmNote: product.confirmNote || null,
    orderable: status.ok,
    orderableNote: status.ok ? null : status.reason,
    fromPrice: channel === 'wholesale' ? wholesale : retail,
    fromPriceLabel: formatRwf(channel === 'wholesale' ? wholesale : retail),
    retailFromLabel: formatRwf(retail),
    wholesaleFromLabel: formatRwf(wholesale),
    variants: product.variants.map((v) => ({
      id: v.id,
      label: v.label,
      retail: v.retail,
      wholesale: Number(v.wholesale ?? v.retail),
      price: priceFor(product, v, channel),
      priceLabel: formatRwf(priceFor(product, v, channel))
    }))
  };
}

function list({ category, featured, q, channel = 'retail', now = new Date() } = {}) {
  let items = DATA.products;
  if (category && category !== 'all') items = items.filter((p) => p.category === category);
  if (featured) items = items.filter((p) => p.featured);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter((p) =>
      [p.name, p.gloss, p.short, p.rwandanInputs].join(' ').toLowerCase().includes(needle)
    );
  }
  return items.map((p) => serialize(p, { channel, now }));
}

function get(id) {
  return byId.get(String(id));
}

function getOrThrow(id) {
  const product = byId.get(String(id));
  if (!product) throw new HttpError(404, 'That product is not on our menu.', 'unknown_product');
  return product;
}

/**
 * Re-prices a client basket from server data.
 * Returns priced lines plus any problems found, so the API can tell the
 * customer exactly which line changed rather than failing the whole order.
 */
function quote(items, { channel = 'retail', now = new Date() } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Your basket is empty.', 'empty_cart');
  }
  if (items.length > 60) {
    throw new HttpError(400, 'That is more than 60 different lines — please split the order.', 'cart_too_long');
  }

  const lines = [];
  const problems = [];

  for (const raw of items) {
    const productId = String(raw?.productId ?? raw?.id ?? '');
    const qty = Math.floor(Number(raw?.qty ?? raw?.quantity ?? 0));
    const product = byId.get(productId);

    if (!product) {
      problems.push({ productId, name: null, reason: 'This product is no longer on our menu.' });
      continue;
    }
    const variant =
      product.variants.find((v) => v.id === String(raw?.variantId)) || product.variants[0];

    if (!Number.isFinite(qty) || qty < 1) {
      problems.push({ productId, name: product.name, reason: 'Quantity must be at least 1.' });
      continue;
    }
    if (qty > MAX_QTY_PER_LINE) {
      problems.push({
        productId,
        name: product.name,
        reason: `Maximum ${MAX_QTY_PER_LINE} per line — message us for larger orders.`
      });
      continue;
    }

    const status = orderable(product, now);
    if (!status.ok) {
      problems.push({ productId, name: product.name, reason: status.reason });
      continue;
    }

    const unitPrice = priceFor(product, variant, channel);
    lines.push({
      productId: product.id,
      name: product.name,
      gloss: product.gloss,
      image: product.image,
      variantId: variant.id,
      variantLabel: variant.label,
      qty,
      unitPrice,
      unitPriceLabel: formatRwf(unitPrice),
      lineTotal: unitPrice * qty,
      lineTotalLabel: formatRwf(unitPrice * qty)
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  return {
    currency: CURRENCY,
    vatIncluded: VAT_INCLUDED,
    channel,
    lines,
    problems,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    subtotal,
    subtotalLabel: formatRwf(subtotal),
    minOrderRwf: config.order.minOrderRwf,
    meetsMinimum: subtotal >= config.order.minOrderRwf,
    maxLeadTimeHours: lines.reduce((max, line) => {
      const product = byId.get(line.productId);
      return Math.max(max, product?.leadTimeHours || 0);
    }, 0)
  };
}

module.exports = {
  CURRENCY,
  VAT_INCLUDED,
  MAX_QTY_PER_LINE,
  priceNote: DATA.priceNote,
  sourceNote: DATA.sourceNote,
  categories,
  list,
  get,
  getOrThrow,
  orderable,
  priceFor,
  formatRwf,
  serialize,
  quote,
  count: DATA.products.length
};
