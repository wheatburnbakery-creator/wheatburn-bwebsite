/* ==========================================================================
   Wheatburn shop — API client and shared helpers
   Exposes a single global, `WB`, used by every page script.
   ========================================================================== */

window.WB = (function () {
  'use strict';

  /* ------------------------------------------------------------------ fetch */

  const cache = { config: null, products: null, session: undefined };

  async function request(method,path,body) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`/api${path}`, options);
    } catch {
      const offline = new Error('We could not reach the shop. Check your connection and try again.');
      offline.code = 'offline';
      throw offline;
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload && payload.code;
      error.details = payload && payload.details;
      throw error;
    }
    return payload;
  }

  const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body)
  };

  /* ------------------------------------------------------------- small utils */

  const esc = (value) =>
    String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /** Builds an element. Children may be nodes or strings. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      }
    }
    if (children) {
      for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  /** Rwandan francs are whole numbers, so formatting is simply thousands. */
  const money = (amount) => `RWF ${Number(amount || 0).toLocaleString('en-US')}`;

  const rwf = money;

  const qs = (selector, root) => (root || document).querySelector(selector);
  const qsa = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /** Shows a short status message at the bottom of the screen. */
  function toast(message, kind) {
    let stack = qs('.toast-stack');
    if (!stack) {
      stack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
      document.body.append(stack);
    }
    const node = el('div', { class: `toast ${kind || ''}`.trim(), text: message });
    stack.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 5200 : 3200);
  }

  /** Marks a field invalid and shows the message underneath it. */
  function setFieldError(input, message) {
    const field = input.closest('.field');
    if (!field) return;
    const target = field.querySelector('.field-error');
    if (message) {
      field.classList.add('invalid');
      if (target) target.textContent = message;
    } else {
      field.classList.remove('invalid');
      if (target) target.textContent = '';
    }
  }

  function clearFieldErrors(form) {
    qsa('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
    qsa('.field-error', form).forEach((f) => (f.textContent = ''));
  }

  /** Shows a note box (error, ok or plain) above or below a form. */
  function showNote(node, message, kind) {
    if (!node) return;
    node.hidden = !message;
    node.className = `form-note ${kind || ''}`.trim();
    node.innerHTML = message || '';
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || 'Working…';
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  /** Scrolls the first invalid field into view and focuses it. */
  function focusFirstInvalid(form) {
    const first = qs('.field.invalid .input, .field.invalid select, .field.invalid textarea', form);
    if (first) {
      first.focus();
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** Rwandan mobile numbers: 078…, 25078… and +250 78… all mean the same person. */
  const PHONE_HINT = 'Use a Rwandan mobile number, for example 0788 123 456.';
  const isValidPhone = (value) => /^(?:\+?250|0)?7[2389]\d{7}$/.test(String(value).replace(/[\s()\-.]/g, ''));

  /* ------------------------------------------------------------ cached loads */

  async function config() {
    if (!cache.config) cache.config = await api.get('/config');
    return cache.config;
  }

  async function products(force) {
    if (!cache.products || force) {
      const data = await api.get('/products');
      cache.products = data.products;
    }
    return cache.products;
  }

  function productById(id) {
    return (cache.products || []).find((p) => p.id === id) || null;
  }

  async function session(force) {
    if (cache.session === undefined || force) {
      try {
        const data = await api.get('/auth/session');
        cache.session = data.user;
      } catch {
        cache.session = null;
      }
    }
    return cache.session;
  }

  function setSession(user) {
    cache.session = user;
  }

  /** Prefills checkout fields from the account, when there is one. */
  async function dashboard() {
    return api.get('/account');
  }

  return {
    api,
    get: api.get,
    post: api.post,
    patch: api.patch,
    el,
    esc,
    money,
    rwf,
    qs,
    qsa,
    onReady,
    toast,
    setFieldError,
    clearFieldErrors,
    showNote,
    setBusy,
    focusFirstInvalid,
    isValidPhone,
    PHONE_HINT,
    // Inline line-art icons, so empty states look the same everywhere. Emoji
    // glyphs differ per platform and vanish on devices without an emoji font.
    icons: {
      loaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.6c0-2.3 3.1-4.1 7-4.1s7 1.8 7 4.1v6.2c0 1.7-3.1 3-7 3s-7-1.3-7-3V9.6Z"/><path d="M9 8.3 10.6 12.1"/><path d="M12.5 7.7 14.1 11.5"/></svg>'
    },
    config,
    products,
    productById,
    session,
    setSession,
    dashboard
  };
})();
