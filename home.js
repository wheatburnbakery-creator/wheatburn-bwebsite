/* ==========================================================================
   Home page — featured products, delivery table, payment methods.
   Everything comes from the API so the shop window can never disagree with
   what the checkout will charge.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { el, money } = WB;

  /* ------------------------------------------------------- featured products */

  const grid = WB.qs('#featured-grid');
  try {
    const products = await WB.products();
    // Takes the first six featured products in menu order. `featured` in
    // data/products.json is a pool, so the seventh is available to the menu
    // page and to future promotion slots without a code change.
    const featured = products.filter((p) => p.featured).slice(0, 6);
    grid.replaceChildren(...featured.map(WB.ui.productCard));
    grid.removeAttribute('aria-busy');
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'form-note error', text: err.message }));
  }

  /* ------------------------------------------------------------- delivery table */

  try {
    const info = await WB.api.get('/delivery');
    const rows = WB.qs('#delivery-rows');

    const row = (name, eta, fee, note) =>
      el('tr', null, [
        el('td', null, [
          el('strong', { text: name }),
          note ? el('div', { class: 'small', text: note }) : null
        ]),
        el('td', { text: eta }),
        el('td', { class: 'num', text: fee })
      ]);

    const tableRows = info.zones.map((zone) => row(zone.name, zone.etaText, zone.feeLabel, zone.note));
    tableRows.push(
      row(
        info.pickup.name,
        info.pickup.etaText,
        'Free',
        info.pickup.note
      )
    );
    rows.replaceChildren(...tableRows);

    WB.qs('#cutoff-notice').textContent = `${info.cutoffNotice} ${info.closedNotice}`;

    const note = WB.qs('#delivery-note');
    note.replaceChildren(
      el('h4', { text: 'Outside our rounds?' }),
      el('p', { class: 'mb-0', text: info.outsideZone.message }),
      el('p', { class: 'small mt-1', text: info.notice })
    );
  } catch (err) {
    WB.qs('#delivery-rows').replaceChildren(
      el('tr', null, [el('td', { colspan: '3', class: 'form-note error', text: err.message })])
    );
  }

  /* ------------------------------------------------------------ payment methods */

  try {
    const info = await WB.api.get('/payments');
    WB.qs('#payment-grid').replaceChildren(
      ...info.methods.map((method) =>
        el('div', { class: 'card' }, [
          el('h3', { text: method.short }),
          el('p', { class: 'mb-0', text: method.detail }),
          method.optional ? el('p', { class: 'small mt-1', text: 'Optional — for trade accounts.' }) : null
        ])
      )
    );
  } catch (err) {
    WB.qs('#payment-grid').replaceChildren(el('p', { class: 'form-note error', text: err.message }));
  }

  /* ------------------------------------------------------------------- extras */

  WB.qs('#open-basket-hero')?.addEventListener('click', () => WB.ui.openCart());

  const wa = WB.qs('[data-wa-link]');
  if (wa) {
    wa.setAttribute('href', WB.ui.whatsappLink('Hello Wheatburn! Please send me the wholesale price book.'));
    wa.setAttribute('target', '_blank');
    wa.setAttribute('rel', 'noopener');
  }

  // Keep the small print honest: the free-delivery threshold comes from config.
  const threshold = WB.qs('#free-delivery-note');
  if (threshold) threshold.textContent = `Free delivery on orders over ${money(WB.ui.config.order.freeDeliveryFromRwf)}.`;
});
