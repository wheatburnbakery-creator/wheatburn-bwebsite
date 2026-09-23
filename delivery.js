'use strict';
/**
 * Delivery zones, fees and the dispatch clock.
 *
 * The bakery bakes overnight, Monday to Saturday, and wholesale goes out before
 * 06:30. Retail rounds follow a 16:00 cutoff: order before it and the order
 * rides the same day; order later and it joins the next dawn bake.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { HttpError } = require('./http');

const DATA = JSON.parse(fs.readFileSync(path.join(config.DATA_DIR, 'delivery.json'), 'utf8'));

function zones() {
  return DATA.zones.map((z) => ({ ...z, feeLabel: feeLabel(z.fee) }));
}

function feeLabel(fee) {
  return fee === 0 ? 'Free' : `${DATA.currency} ${Number(fee).toLocaleString('en-US')}`;
}

function pickup() {
  return { ...DATA.pickup, feeLabel: 'Free' };
}

function zoneById(id) {
  if (id === DATA.pickup.id) return pickup();
  return DATA.zones.find((z) => z.id === id);
}

function requirements() {
  return {
    status: DATA.status,
    notice: DATA.notice,
    cutoffHour: DATA.cutoffHour,
    cutoffNotice: DATA.cutoffNotice,
    deliveryDays: DATA.deliveryDays,
    closedNotice: DATA.closedNotice,
    outsideZone: DATA.outsideZone
  };
}

/**
 * Resolves the delivery fee for a zone and basket total.
 * Pickup is always free; delivery is free above the configured basket value.
 */
function resolve(zoneId, subtotal, { channel = 'retail' } = {}) {
  const zone = zoneById(zoneId);
  if (!zone) {
    throw new HttpError(400, 'Choose a delivery area from the list.', 'unknown_zone');
  }
  const isPickup = zone.id === DATA.pickup.id;
  const threshold = config.order.freeDeliveryFromRwf;
  const qualifiesForFree = !isPickup && threshold > 0 && subtotal >= threshold;
  const fee = isPickup || qualifiesForFree ? 0 : zone.fee;

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    isPickup,
    baseFee: zone.fee,
    fee,
    feeLabel: feeLabel(fee),
    freeApplied: qualifiesForFree && !isPickup,
    note: zone.note || '',
    confirmed: zone.confirmed !== false,
    etaHours: zone.etaHours,
    etaText: isPickup ? DATA.pickup.etaText : zone.etaText
  };
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/**
 * Works out when an order will be baked and sent out.
 * Returns the estimated window for the customer and a reason string the
 * confirmation screen can show honestly ("cuts off at 16:00").
 */
function estimateDispatch(now = new Date(), { isPickup = false, leadTimeHours = 0 } = {}) {
  const cutoff = DATA.cutoffHour ?? config.order.sameDayCutoffHour;
  const closedDays = ['Sunday'];
  const dispatch = new Date(now.getTime());

  if (isPickup) {
    const ready = new Date(dispatch.getTime() + 60 * 60 * 1000);
    return {
      mode: 'pickup',
      sameDay: true,
      from: ready.toISOString(),
      to: ready.toISOString(),
      text: DATA.pickup.etaText,
      reason: 'Collection at the counter, KG 11 Ave.'
    };
  }

  const sameDay = now.getHours() < cutoff && !closedDays.includes(DAY_NAMES[now.getDay()]);
  if (!sameDay) {
    // Move to the next trading morning and deliver on the dawn bake.
    let next = new Date(dispatch.getTime());
    do {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } while (closedDays.includes(DAY_NAMES[next.getDay()]));
    return {
      mode: 'next-bake',
      sameDay: false,
      from: next.toISOString(),
      to: new Date(next.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      text: `Next trading day (${DAY_NAMES[next.getDay()]}), morning round`,
      reason: `Placed after the ${cutoff}:00 cutoff — it joins the next dawn bake.`
    };
  }

  const from = new Date(now.getTime() + Math.max(leadTimeHours, 1) * 60 * 60 * 1000);
  const to = new Date(from.getTime() + 3 * 60 * 60 * 1000);
  return {
    mode: 'same-day',
    sameDay: true,
    from: from.toISOString(),
    to: to.toISOString(),
    text: 'Today, from the afternoon round',
    reason: `Placed before the ${cutoff}:00 cutoff, so it rides today's round.`
  };
}

module.exports = {
  currency: DATA.currency,
  zones,
  pickup,
  zoneById,
  requirements,
  resolve,
  estimateDispatch,
  feeLabel,
  dayNames: DAY_NAMES
};
