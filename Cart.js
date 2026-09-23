/* ==========================================================================
   Wheatburn shop — the basket

   The basket lives in localStorage so it survives a refresh, a phone call and
   a weak connection. Prices are deliberately NOT stored: the server re-prices
   every line at checkout, so a stale or tampered basket can never set its own
   price.
   ========================================================================== */

window.WB = window.WB || {};

WB.cart = (function () {
  'use strict';

  const KEY = 'wheatburn.basket.v1';
  const listeners = new Set();

  function read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((line) => line && typeof line.productId === 'string')
        .map((line) => ({
          productId: line.productId,
          variantId: line.variantId || null,
          qty: Math.max(1, Math.min(99, Math.floor(Number(line.qty) || 1)))
        }));
    } catch {
      return [];
    }
  }

  function write(lines) {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      /* Private mode or a full disk: the session still works, it just will not persist. */
    }
    emit();
    return lines;
  }

  function emit() {
    const detail = { lines: read(), count: count() };
    for (const listener of listeners) {
      try {
        listener(detail);
      } catch (err) {
        console.error('[basket] listener failed', err);
      }
    }
    window.dispatchEvent(new CustomEvent('wb:basket', { detail }));
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function count() {
    return read().reduce((sum, line) => sum + line.qty, 0);
  }

  /** Adding the same product and variant twice increases the quantity. */
  function add(item, qty) {
    const lines = read();
    const productId = String(item.productId || item.id);
    const variantId = item.variantId || null;
    const amount = Math.max(1, Math.floor(Number(qty) || 1));
    const existing = lines.find((l) => l.productId === productId && l.variantId === variantId);

    if (existing) existing.qty = Math.min(99, existing.qty + amount);
    else lines.push({ productId, variantId, qty: amount });

    return write(lines);
  }

  function setQty(productId, variantId, qty) {
    const amount = Math.floor(Number(qty) || 0);
    let lines = read();
    if (amount <= 0) {
      lines = lines.filter((l) => !(l.productId === productId && l.variantId === variantId));
    } else {
      const line = lines.find((l) => l.productId === productId && l.variantId === variantId);
      if (line) line.qty = Math.min(99, amount);
    }
    return write(lines);
  }

  const increase = (productId, variantId) => {
    const line = read().find((l) => l.productId === productId && l.variantId === variantId);
    return setQty(productId, variantId, (line ? line.qty : 0) + 1);
  };

  const decrease = (productId, variantId) => {
    const line = read().find((l) => l.productId === productId && l.variantId === variantId);
    return setQty(productId, variantId, (line ? line.qty : 0) - 1);
  };

  const remove = (productId, variantId) => setQty(productId, variantId, 0);
  const clear = () => write([]);

  /** Payload shape the API expects. */
  const payload = () =>
    read().map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      qty: line.qty
    }));

  /** Replaces the basket, used by "reorder" and by a shared link. */
  function replace(items) {
    return write(
      (items || []).map((item) => ({
        productId: String(item.productId),
        variantId: item.variantId || null,
        qty: Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)))
      }))
    );
  }

  return { read, count, add, setQty, increase, decrease, remove, clear, payload, replace, onChange, KEY };
})();
