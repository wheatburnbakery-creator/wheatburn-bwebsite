'use strict';
/**
 * Payment methods.
 *
 * Wheatburn takes cash on delivery, MTN MoMo and Airtel Money, with bank
 * transfer as an optional route for trade accounts.
 *
 * Merchant payee codes are NOT hard-coded here on purpose. Until the till codes
 * exist, `payTo` stays null and the checkout tells the customer a member of
 * staff will share the code — better than printing a wrong number on a
 * confirmation SMS. Fill them in once and every screen updates.
 */

const { HttpError } = require('./http');

const METHODS = [
  {
    id: 'cod',
    label: 'Cash on delivery',
    short: 'Cash on delivery',
    detail: 'Pay the rider in cash when the order reaches you. Have the exact amount if you can.',
    instantConfirm: true,
    requiresReference: false,
    payTo: null,
    enabled: true
  },
  {
    id: 'momo',
    label: 'MTN Mobile Money (MoMo)',
    short: 'MTN MoMo',
    detail:
      'We will send a MoMo prompt to your phone, or you can send to our merchant code. Send the payment, then paste the transaction ID we ask for.',
    instantConfirm: false,
    requiresReference: true,
    payTo: process.env.MOMO_PAYEE || null, // e.g. '*182*8*1*123456*25000#'
    referenceLabel: 'MoMo transaction ID',
    enabled: true
  },
  {
    id: 'airtel',
    label: 'Airtel Money',
    short: 'Airtel Money',
    detail:
      'Send to our Airtel Money number, then paste the transaction ID we ask for so we can match the payment to your order.',
    instantConfirm: false,
    requiresReference: true,
    payTo: process.env.AIRTEL_PAYEE || null,
    referenceLabel: 'Airtel Money transaction ID',
    enabled: true
  },
  {
    id: 'bank',
    label: 'Bank transfer (optional)',
    short: 'Bank transfer',
    detail:
      'For trade and wholesale accounts. We will send the account details, and the order is released once the transfer clears.',
    instantConfirm: false,
    requiresReference: true,
    payTo: process.env.BANK_ACCOUNT || null,
    referenceLabel: 'Bank reference or slip number',
    enabled: true,
    optional: true
  }
];

function list({ includeDisabled = false } = {}) {
  return METHODS.filter((m) => includeDisabled || m.enabled).map(publicShape);
}

function publicShape(method) {
  return {
    id: method.id,
    label: method.label,
    short: method.short,
    detail: method.detail,
    instantConfirm: method.instantConfirm,
    requiresReference: method.requiresReference,
    optional: Boolean(method.optional),
    referenceLabel: method.referenceLabel || null,
    payTo: method.payTo
  };
}

function get(id) {
  return METHODS.find((m) => m.id === id);
}

function getOrThrow(id) {
  const method = get(id);
  if (!method || !method.enabled) {
    throw new HttpError(400, 'Choose a payment method from the list.', 'unknown_payment_method');
  }
  return method;
}

/**
 * Decides what the order's payment state should be.
 * Cash on delivery is settled in person; everything else is only "paid" once
 * someone at the bakery has reconciled the reference.
 */
function initialState(method, reference) {
  if (method.requiresReference && !reference) {
    return { status: 'awaiting_reference', paid: false };
  }
  if (method.instantConfirm) {
    return { status: 'due_on_delivery', paid: false };
  }
  return { status: 'awaiting_verification', paid: false };
}

/** Customer-facing instructions attached to the confirmation screen and SMS. */
function instructionsFor(method, total) {
  if (method.id === 'cod') {
    return `Please have ${total} ready in cash. The rider confirms payment at the door.`;
  }
  if (method.id === 'bank') {
    return 'Transfer to the account we send you, then reply with the reference. We will confirm before dispatch.';
  }
  const target = method.payTo ? `Send to ${method.payTo}.` : 'We will send you our payment code by SMS.';
  return `${target} Then reply with the ${method.referenceLabel.toLowerCase()} so we can match it to your order.`;
}

module.exports = { METHODS, list, get, getOrThrow, initialState, instructionsFor, publicShape };
