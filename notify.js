'use strict';
/**
 * Outbound SMS, WhatsApp and email.
 *
 * One adapter, two modes:
 *   - with SMS_PROVIDER_URL + SMS_PROVIDER_TOKEN set, messages are POSTed to the
 *     provider (works with most Rwandan gateways: they all accept a JSON POST
 *     with a bearer token, and the field names are configurable below).
 *   - without credentials, messages are written to data/outbox.log and the
 *     console, which is what you want while developing: you can read the OTP
 *     instead of waiting for an SMS that will never arrive.
 *
 * Nothing here is allowed to break an order. Every send is wrapped so a dead
 * gateway degrades to a log line rather than a 500 to the customer.
 */

const fs = require('node:fs');
const config = require('./config');

/** Provider field names — adjust to match your gateway's payload. */
const PAYLOAD_KEYS = { to: 'to', message: 'message', sender: 'sender', channel: 'channel' };

function outbox(channel, to, message, meta = {}) {
  const line = [
    new Date().toISOString(),
    channel.toUpperCase().padEnd(8),
    String(to).padEnd(18),
    JSON.stringify(message),
    Object.keys(meta).length ? JSON.stringify(meta) : ''
  ]
    .filter(Boolean)
    .join(' | ');

  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.appendFileSync(config.OUTBOX_FILE, `${line}\n`, 'utf8');
  } catch (err) {
    console.error('[notify] could not write outbox:', err.message);
  }

  if (!config.isProduction) {
    console.log(`\n[notify:${channel}] → ${to}\n${message}\n`);
  }
}

async function send(channel, to, message, meta = {}) {
  if (!to) return { sent: false, reason: 'no recipient' };

  if (!config.notify.providerUrl) {
    outbox(channel, to, message, meta);
    return { sent: true, simulated: true };
  }

  try {
    const response = await fetch(config.notify.providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.notify.providerToken}`
      },
      body: JSON.stringify({
        [PAYLOAD_KEYS.to]: to,
        [PAYLOAD_KEYS.message]: message,
        [PAYLOAD_KEYS.sender]: config.notify.senderId,
        [PAYLOAD_KEYS.channel]: channel
      })
    });
    if (!response.ok) {
      outbox(channel, to, message, { ...meta, providerStatus: response.status, fallback: true });
      return { sent: false, status: response.status };
    }
    return { sent: true };
  } catch (err) {
    outbox(channel, to, message, { ...meta, providerError: err.message, fallback: true });
    return { sent: false, error: err.message };
  }
}

const sendSms = (to, message, meta) => send('sms', to, message, meta);
const sendWhatsApp = (to, message, meta) => send('whatsapp', to, message, meta);
const sendEmail = (to, message, meta) => send('email', to, message, meta);

/** Deep link that opens WhatsApp with the message already typed. */
function whatsappLink(text, to = config.brand.whatsapp) {
  return `https://wa.me/${String(to).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

const money = (n) => `RWF ${Number(n).toLocaleString('en-US')}`;

/* ------------------------------------------------------------------ messages */

function otpMessage(code, purpose, minutes) {
  const what = purpose === 'reset' ? 'reset your Wheatburn password' : 'sign in to Wheatburn';
  return `Wheatburn: ${code} is your code to ${what}. It expires in ${minutes} minutes. Never share this code.`;
}

function resetLinkMessage(link, minutes) {
  return `Wheatburn: use this link within ${minutes} minutes to set a new password. ${link}\nIf you did not ask for this, ignore this message.`;
}

function orderConfirmationMessage(order) {
  const lines = [
    `Wheatburn: order ${order.number} confirmed.`,
    `${order.itemCount} item${order.itemCount === 1 ? '' : 's'} — ${money(order.total)}`,
    order.delivery.isPickup
      ? `Collection: ${order.delivery.zoneName}`
      : `Delivery: ${order.delivery.zoneName}, ${order.dispatch.text}`,
    `Payment: ${order.payment.label}`,
    `Track it any time: ${order.trackingUrl}`
  ];
  return lines.join('\n');
}

function statusMessage(order, status) {
  return `Wheatburn: order ${order.number} is now ${status.label}. ${status.customerNote || ''}`.trim();
}

function staffNewOrderMessage(order) {
  return [
    `NEW ORDER ${order.number}`,
    `${order.customer.name} · ${order.customer.phone}`,
    `${order.itemCount} items · ${money(order.total)}`,
    order.delivery.isPickup ? 'COLLECT at counter' : `${order.delivery.zoneName} — ${order.customer.address}`,
    `Payment: ${order.payment.label}`,
    ...order.lines.map((l) => `  ${l.qty}× ${l.name} (${l.variantLabel})`)
  ].join('\n');
}

async function sendOtp(phone, code, purpose) {
  const minutes = Math.round(config.security.otpTtlMs / 60000);
  return sendSms(phone, otpMessage(code, purpose, minutes), { purpose });
}

async function sendOrderConfirmation(order) {
  const message = orderConfirmationMessage(order);
  const sms = await sendSms(order.customer.phone, message, { order: order.number });
  if (order.customer.whatsappOptIn) {
    await sendWhatsApp(order.customer.phone, message, { order: order.number });
  }
  await sendSms(config.brand.phone, staffNewOrderMessage(order), { order: order.number, staff: true });
  return sms;
}

async function sendStatusUpdate(order, status) {
  return sendSms(order.customer.phone, statusMessage(order, status), {
    order: order.number,
    status: status.id
  });
}

module.exports = {
  send,
  sendSms,
  sendWhatsApp,
  sendEmail,
  sendOtp,
  sendOrderConfirmation,
  sendStatusUpdate,
  whatsappLink,
  otpMessage,
  resetLinkMessage,
  orderConfirmationMessage,
  staffNewOrderMessage,
  money
};
