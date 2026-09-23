/* ==========================================================================
   Menu page — filter, search and add to basket.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { el } = WB;
  const grid = WB.qs('#menu-grid');
  const empty = WB.qs('#menu-empty');
  const countLabel = WB.qs('#menu-count');
  const search = WB.qs('#menu-search');
  const filterBar = WB.qs('#filters');

  let products = [];
  let category = 'all';
  let query = '';

  /* -------------------------------------------------------------- rendering */

  function visible() {
    const needle = query.trim().toLowerCase();
    return products.filter((p) => {
      const inCategory = category === 'all' || p.category === category;
      if (!inCategory) return false;
      if (!needle) return true;
      return [p.name, p.gloss, p.short, p.rwandanInputs, p.badge].join(' ').toLowerCase().includes(needle);
    });
  }

  function render() {
    const list = visible();
    grid.replaceChildren(...list.map(WB.ui.productCard));
    grid.removeAttribute('aria-busy');
    empty.hidden = list.length > 0;
    countLabel.textContent =
      list.length === products.length
        ? `${products.length} products, all available to order today`
        : `${list.length} of ${products.length} products`;
  }

  /* ---------------------------------------------------------------- filters */

  function buildFilters(categories) {
    const buttons = [
      el('button', {
        class: 'filter',
        type: 'button',
        'data-category': 'all',
        'aria-pressed': 'true',
        text: 'Everything'
      })
    ];
    for (const cat of categories) {
      buttons.push(
        el('button', {
          class: 'filter',
          type: 'button',
          'data-category': cat.id,
          'aria-pressed': 'false',
          text: cat.label
        })
      );
    }
    filterBar.replaceChildren(...buttons);

    filterBar.addEventListener('click', (event) => {
      const button = event.target.closest('.filter');
      if (!button) return;
      category = button.dataset.category;
      WB.qsa('.filter', filterBar).forEach((b) =>
        b.setAttribute('aria-pressed', String(b === button))
      );
      render();
    });
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  /* -------------------------------------------------------------- load data */

  try {
    products = await WB.products(true);
    buildFilters(WB.ui.config.categories || (await WB.config()).categories);
    render();
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'form-note error', text: err.message }));
    countLabel.textContent = '';
  }

  WB.qs('#open-basket-menu')?.addEventListener('click', () => WB.ui.openCart());

  // A product can be added from a link like /menu?add=<id>, useful from a message.
  const addId = new URLSearchParams(location.search).get('add');
  if (addId && products.some((p) => p.id === addId)) {
    const product = products.find((p) => p.id === addId);
    WB.cart.add({ productId: product.id, variantId: product.variants[0].id }, 1);
    WB.toast(`${product.name} added to your basket.`, 'ok');
  }
});
