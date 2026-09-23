'use strict';
/**
 * Orders: pricing, confirmation, status, history and reorder.
 *
 * The flow is deliberately short — basket, who you are, where it goes, how you
 * pay, done — because most Wheatburn customers order on a phone, often on a
 * slow connection, and abandon anything that feels like paperwork.
 *
 * A guest order is a first-class order. Signing in only adds memory: history,
 * saved address, reorder.
 */

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const catalog = require('./catalog');
const delivery = require('./delivery');
const payments = require('./payments');
const notify = require('./notify');
const auth = require('./auth');
const { HttpError } = require('./http');

/** Order statuses, in the order the customer sees them. */
const STATUSES = [
  {
    id: 'pending_payment',
    label: 'Awaiting payment',
    icon: '⏳',
    note: 'We are waiting to match your payment to the order.'
  },
  {
    id: 'confirmed',
    label: 'Confirmed',
    icon: '✅',
    note: 'Confirmed — your order is on the bake list.'
  },
  {
    id: 'baking',
    label: 'In the oven',
    icon: '🔥',
    note: 'Your order is in the overnight bake.'
  },
  {
    id: 'out_for_delivery',
    label: 'On its way',
    icon: '🛵',
    note: 'The rider is on the way. Have your payment ready.'
  },
  {
    id: 'ready_for_collection',
    label: 'Ready to collect',
    icon: '🏠',
    note: 'Your order is waiting at the counter, KG 11 Ave.'
  },
  {
    id: 'delivered',
    label: 'Delivered',
    icon: '🎉',
    note: 'Delivered. Tap reorder any time — it takes ten seconds.',
    terminal: true
  },
  {
    id: 'cancelled',
    label: 'Cancelled',
    icon: '✖',
    note: 'This order was cancelled.',
    terminal: true
  }
];

/** Which moves are allowed. Anything else is rejected, so status cannot jump backwards. */
const TRANSITIONS = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'out_for_delivery', 'ready_for_collection', 'cancelled'],
  baking: ['out_for_delivery', 'ready_for_collection', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  ready_for_collection: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
};

function statusMeta(id) {
  return STATUSES.find((s) => s.id === id) || STATUSES[0];
}

function orderNumber(now = new Date()) {
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const seq = String(store.nextSequence(`order:${stamp}`)).padStart(4, '0');
  return `${config.order.prefix}-${stamp}-${seq}`;
}

/* ----------------------------------------------------------------- creation */

/**
 * Creates an order from a client basket.
 *
 * @param {object} input
 * @param {Array}  input.items          [{ productId, variantId, qty }]
 * @param {object} input.customer       { name, phone, whatsappOptIn, notes }
 * @param {string} input.deliveryZoneId zone id, or 'pickup'
 * @param {object} input.payment        { methodId, reference }
 * @param {object} [input.user]         signed-in user, when there is one
 * @param {string} input.baseUrl        used to build the tracking link
 * @param {string} input.ip
 */
async function createOrder({ items, customer, deliveryZoneId, payment, user, baseUrl = '', ip }) {
  const channel = user?.channel === 'wholesale' ? 'wholesale' : 'retail';

  // 1. Price the basket from server data. The browser's numbers are ignored.
  const quote = catalog.quote(items, { channel });
  if (quote.problems.length) {
    throw new HttpError(
      409,
      'Some items changed while you were shopping. Please review your basket.',
      'basket_changed',
      // @ts-ignore — extra detail travels with the error
      quote.problems
    );
  }
  if (!quote.meetsMinimum) {
    throw new HttpError(
      400,
      `The minimum order is ${catalog.formatRwf(config.order.minOrderRwf)}. Add something small — a bag of mandazi covers it.`,
      'below_minimum'
    );
  }

  // 2. Customer details. A guest still needs a name and a reachable number.
  const name = String(customer?.name ?? '').trim();
  if (name.length < 2) throw new HttpError(400, 'We need a name for the order.', 'name_required');
  const phone = auth.normalizePhone(customer?.phone);

  // 3. Delivery.
  const zone = delivery.resolve(deliveryZoneId, quote.subtotal, { channel });
  const address = String(customer?.address ?? '').trim();
  if (!zone.isPickup && address.length < 6) {
    throw new HttpError(
      400,
      'Add a delivery address — a house number, a landmark or the name of the building.',
      'address_required'
    );
  }

  // 4. Payment.
  const method = payments.getOrThrow(payment?.methodId || 'cod');
  const reference = payment?.reference ? String(payment.reference).trim().slice(0, 60) : null;
  if (method.requiresReference && reference && reference.length < 4) {
    throw new HttpError(400, 'That reference looks too short. Check it and try again.', 'reference_invalid');
  }
  const paymentState = payments.initialState(method, reference);

  const total = quote.subtotal + zone.fee;
  const dispatch = delivery.estimateDispatch(new Date(), {
    isPickup: zone.isPickup,
    leadTimeHours: quote.maxLeadTimeHours
  });

  const unconfirmedZone = !zone.confirmed && !zone.isPickup;

  const order = {
    id: crypto.randomUUID(),
    number: orderNumber(),
    userId: user?.id || null,
    guest: !user,
    channel,
    status: method.instantConfirm && !method.requiresReference ? 'confirmed' : 'pending_payment',
    lines: quote.lines,
    itemCount: quote.itemCount,
    subtotal: quote.subtotal,
    deliveryFee: zone.fee,
    total,
    currency: catalog.CURRENCY,
    vatIncluded: catalog.VAT_INCLUDED,
    customer: {
      name,
      phone,
      email: user?.email || customer?.email || null,
      whatsappOptIn: customer?.whatsappOptIn !== false,
      address: zone.isPickup ? null : address,
      district: customer?.district ? String(customer.district).slice(0, 60) : null,
      landmark: customer?.landmark ? String(customer.landmark).slice(0, 120) : null,
      notes: customer?.notes ? String(customer.notes).slice(0, 400) : null
    },
    delivery: { ...zone, address: zone.isPickup ? null : address },
    payment: {
      methodId: method.id,
      label: method.label,
      status: paymentState.status,
      paid: paymentState.paid,
      reference,
      payTo: method.payTo || null,
      instructions: payments.instructionsFor(method, catalog.formatRwf(total))
    },
    dispatch,
    timeline: [
      {
        status: method.instantConfirm && !method.requiresReference ? 'confirmed' : 'pending_payment',
        at: new Date().toISOString(),
        by: 'customer',
        note: 'Order placed on the website.'
      }
    ],
    trackingCode: crypto.randomBytes(5).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    zoneNeedsConfirmation: unconfirmedZone
  };

  order.trackingUrl = `${baseUrl}/order?track=${order.number}&code=${order.trackingCode}`;

  const d = store.data();
  d.orders.push(order);
  store.save();

  // 5. Tell the customer and the counter. Failure here never fails the order.
  try {
    await notify.sendOrderConfirmation(order);
  } catch (err) {
    console.error('[orders] confirmation message failed:', err.message);
  }

  return serialize(order);
}

/* --------------------------------------------------------------- serialising */

function serialize(order) {
  const status = statusMeta(order.status);
  const isPickup = Boolean(order.delivery?.isPickup);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    statusLabel: status.label,
    statusIcon: status.icon,
    statusNote: status.note,
    timeline: order.timeline,
    channel: order.channel,
    itemCount: order.itemCount,
    lines: order.lines.map((line) => ({
      ...line,
      lineTotalLabel: catalog.formatRwf(line.lineTotal),
      unitPriceLabel: catalog.formatRwf(line.unitPrice)
    })),
    subtotal: order.subtotal,
    subtotalLabel: catalog.formatRwf(order.subtotal),
    deliveryFee: order.deliveryFee,
    deliveryFeeLabel: order.deliveryFee === 0 ? 'Free' : catalog.formatRwf(order.deliveryFee),
    total: order.total,
    totalLabel: catalog.formatRwf(order.total),
    customer: {
      name: order.customer.name,
      phone: order.customer.phone,
      phoneMasked: auth.maskPhone(order.customer.phone),
      address: order.customer.address,
      notes: order.customer.notes
    },
    delivery: {
      zoneId: order.delivery.zoneId,
      zoneName: order.delivery.zoneName,
      isPickup,
      fee: order.delivery.fee,
      feeLabel: order.delivery.feeLabel,
      etaText: order.delivery.etaText,
      address: order.delivery.address,
      confirmed: order.delivery.confirmed !== false,
      needsConfirmation: Boolean(order.zoneNeedsConfirmation)
    },
    payment: {
      methodId: order.payment.methodId,
      label: order.payment.label,
      status: order.payment.status,
      paid: order.payment.paid,
      reference: order.payment.reference,
      payTo: order.payment.payTo,
      instructions: order.payment.instructions
    },
    dispatch: {
      mode: order.dispatch.mode,
      sameDay: order.dispatch.sameDay,
      text: order.dispatch.text,
      reason: order.dispatch.reason,
      from: order.dispatch.from,
      to: order.dispatch.to
    },
    trackingCode: order.trackingCode,
    trackingUrl: order.trackingUrl,
    whatsappUrl: notify.whatsappLink(
      `Hello Wheatburn! I have just ordered ${order.number} — ${order.itemCount} item(s), ${catalog.formatRwf(order.total)}.`
    ),
    guest: order.guest,
    createdAt: order.createdAt,
    createdAtLabel: new Date(order.createdAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }),
    reorderItems: order.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      qty: l.qty
    }))
  };
}

/* ------------------------------------------------------------------- reading */

function listForUser(userId, { limit = 50 } = {}) {
  return store
    .data()
    .orders.filter((o) => o.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(serialize);
}

/** A guest can look up an order with the order number plus the phone on it. */
function findByNumberAndPhone(number, phone) {
  const wanted = String(number || '').trim().toUpperCase();
  const order = store.data().orders.find((o) => o.number === wanted);
  if (!order) throw new HttpError(404, 'We could not find that order number.', 'order_not_found');

  const given = String(phone || '').replace(/\D/g, '').slice(-9);
  const onFile = order.customer.phone.replace(/\D/g, '').slice(-9);
  if (given.length !== 9 || given !== onFile) {
    throw new HttpError(403, 'That order number and phone number do not match.', 'order_mismatch');
  }
  return serialize(order);
}

function findOwned(orderId, user) {
  const order = store.data().orders.find((o) => o.id === orderId || o.number === orderId);
  if (!order) throw new HttpError(404, 'We could not find that order.', 'order_not_found');
  if (order.userId !== user.id) {
    throw new HttpError(403, 'That order belongs to another account.', 'order_forbidden');
  }
  return order;
}

/* ------------------------------------------------------------- status changes */

function advanceStatus({ orderId, status, note, by = 'staff', notifyCustomer = true }) {
  const order = store.data().orders.find((o) => o.id === orderId || o.number === orderId);
  if (!order) throw new HttpError(404, 'We could not find that order.', 'order_not_found');

  const target = statusMeta(status);
  if (!STATUSES.some((s) => s.id === status)) {
    throw new HttpError(400, `Unknown status "${status}".`, 'unknown_status');
  }
  const allowed = TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    throw new HttpError(
      409,
      `An order that is "${statusMeta(order.status).label}" cannot move to "${target.label}".`,
      'status_transition_invalid'
    );
  }

  order.status = status;
  order.timeline.push({ status, at: new Date().toISOString(), by, note: note || null });
  if (status === 'delivered') order.payment.paid = order.payment.methodId === 'cod' ? true : order.payment.paid;
  if (status === 'confirmed' && order.payment.status === 'awaiting_verification') {
    order.payment.status = 'verified';
  }
  store.save();

  if (notifyCustomer) {
    try {
      notify.sendStatusUpdate(serialize(order), { ...target, customerNote: target.note });
    } catch (err) {
      console.error('[orders] status message failed:', err.message);
    }
  }
  return serialize(order);
}

/** Reorder hands the basket straight back — the customer only confirms. */
function reorderPayload(orderId, user) {
  const order = findOwned(orderId, user);
  const now = new Date();
  const items = [];
  const unavailable = [];

  for (const line of order.lines) {
    const product = catalog.get(line.productId);
    const status = product ? catalog.orderable(product, now) : { ok: false, reason: 'Off the menu.' };
    if (!product || !status.ok) {
      unavailable.push({ productId: line.productId, name: line.name, reason: status.reason });
      continue;
    }
    items.push({ productId: line.productId, variantId: line.variantId, qty: line.qty });
  }

  return {
    orderNumber: order.number,
    items,
    unavailable,
    deliveryZoneId: order.delivery.zoneId,
    paymentMethodId: order.payment.methodId,
    address: order.customer.address
  };
}

/** Dashboard summary counters. */
function statsForUser(userId) {
  const orders = store.data().orders.filter((o) => o.userId === userId);
  const spend = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.total, 0);
  const favourite = {};
  for (const order of orders) {
    for (const line of order.lines) {
      favourite[line.name] = (favourite[line.name] || 0) + line.qty;
    }
  }
  const top = Object.entries(favourite).sort((a, b) => b[1] - a[1])[0];
  return {
    orderCount: orders.length,
    activeCount: orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
    lifetimeSpend: spend,
    lifetimeSpendLabel: catalog.formatRwf(spend),
    favouriteItem: top ? { name: top[0], qty: top[1] } : null
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  statusMeta,
  createOrder,
  serialize,
  listForUser,
  findByNumberAndPhone,
  findOwned,
  advanceStatus,
  reorderPayload,
  statsForUser,
  orderNumber
};
