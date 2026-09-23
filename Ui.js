/* ==========================================================================
   Wheatburn shop — shared page shell and components

   The header, footer, basket drawer and WhatsApp button are rendered from one
   place so that "easy navigation" stays true on every page: add a nav item
   here and all nine pages get it.
   ========================================================================== */

window.WB = window.WB || {};

WB.ui = (function () {
  'use strict';

  const { el, esc, money, qs, qsa, icons } = WB;
  let cfg = null;

  const NAV = [
    { key: 'home', label: 'Home', href: '/' },
    { key: 'menu', label: 'Menu', href: '/menu' },
    { key: 'order', label: 'Order', href: '/order' },
    { key: 'contact', label: 'Contact', href: '/contact' }
  ];

  /* --------------------------------------------------------------- header */

  function renderHeader() {
    const host = qs('#site-header');
    if (!host) return;
    const page = document.body.dataset.page || '';

    const wordmark = el('a', { class: 'wordmark', href: '/' }, [
      el('span', { class: 'mark', text: cfg.brand.name }),
      el('span', { class: 'sub', text: cfg.brand.sub })
    ]);

    const toggle = el('button', {
      class: 'nav-toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'site-nav',
      text: 'Menu'
    });

    const navList = el(
      'ul',
      null,
      NAV.map((item) =>
        el('li', null, [
          el('a', {
            href: item.href,
            text: item.label,
            class: item.key === page ? 'active' : null,
            'aria-current': item.key === page ? 'page' : null,
            'data-nav': item.key
          })
        ])
      )
    );

    const nav = el('nav', { class: 'site-nav', id: 'site-nav', 'aria-label': 'Main' }, [navList]);

    const accountLink = el('a', {
      class: 'icon-btn',
      id: 'account-link',
      href: '/login',
      'data-role': 'account-link'
    }, [el('span', { class: 'label', text: 'Sign in' })]);

    const cartButton = el(
      'button',
      {
        class: 'icon-btn',
        id: 'cart-open',
        type: 'button',
        'aria-controls': 'cart-drawer',
        'aria-expanded': 'false'
      },
      [
        el('span', { class: 'cart-label', text: 'Basket' }),
        el('span', { class: 'count', id: 'cart-count', hidden: true, text: '0' })
      ]
    );

    host.className = 'site-header';
    host.append(
      el('div', { class: 'wrap' }, [
        wordmark,
        toggle,
        nav,
        el('div', { class: 'header-actions' }, [accountLink, cartButton])
      ])
    );

    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    cartButton.addEventListener('click', () => openCart());
  }

  /* --------------------------------------------------------------- footer */

  function renderFooter() {
    const host = qs('#site-footer');
    if (!host) return;
    const b = cfg.brand;

    const column = (title, items) =>
      el('div', null, [
        el('h4', { text: title }),
        el('ul', null, items.map((item) => el('li', null, [item])))
      ]);

    host.className = 'site-footer';
    host.append(
      el('div', { class: 'wrap' }, [
        el('div', { class: 'footer-grid' }, [
          el('div', null, [
            el('a', { class: 'wordmark', href: '/' }, [
              el('span', { class: 'mark', text: b.name }),
              el('span', { class: 'sub', text: b.sub })
            ]),
            el('p', { class: 'mt-2', text: 'A Rwandan bakery baking the local harvest every morning, and naming it in Kinyarwanda.' }),
            el('div', { class: 'social-row' }, [
              el('a', { href: b.social.instagram, 'aria-label': 'Instagram', rel: 'noopener', text: 'IG' }),
              el('a', { href: b.social.facebook, 'aria-label': 'Facebook', rel: 'noopener', text: 'FB' }),
              el('a', { href: b.social.tiktok, 'aria-label': 'TikTok', rel: 'noopener', text: 'TT' })
            ])
          ]),
          column('Shop', [
            el('a', { href: '/menu', text: 'Full menu & prices' }),
            el('a', { href: '/order', text: 'Order & basket' }),
            el('a', { href: '/order?track=1', text: 'Track an order' }),
            el('a', { href: '/account', text: 'My orders' })
          ]),
          column('Visit', [
            b.address,
            el('span', { text: `Counter: ${b.hours}` }),
            el('span', { text: `Closed ${b.closedDays}` }),
            el('a', { href: `tel:${b.phone.replace(/\s/g, '')}`, text: b.phone }),
            el('a', { href: `mailto:${b.email}`, text: b.email })
          ]),
          column('Delivery & payment', [
            'Rounds across Kicukiro, Gikondo, Nyarugenge, Gisozi and Kabuga',
            el('span', { text: `Order before ${cfg.order.sameDayCutoffHour}:00 for the same day` }),
            el('span', { text: `Free delivery from ${money(cfg.order.freeDeliveryFromRwf)}` }),
            'Cash on delivery · MoMo · Airtel Money · Bank transfer'
          ])
        ]),
        el('div', { class: 'footer-note' }, [
          el('p', { text: `© ${new Date().getFullYear()} ${b.name}. Prices in Rwandan francs; VAT-inclusive on retail prices, VAT-exclusive for trade.` }),
          el('p', { text: 'Address, phone number, email and delivery zones are placeholders pending confirmation — see SITE-TODO.md.' })
        ])
      ])
    );
  }

  /* ---------------------------------------------------------- whatsapp button */

  function whatsappLink(text) {
    const number = String(cfg.brand.whatsapp).replace(/\D/g, '');
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }

  function renderWhatsApp() {
    if (qs('#wa-float')) return;
    const link = el(
      'a',
      {
        id: 'wa-float',
        class: 'wa-float',
        href: whatsappLink(`Hello ${cfg.brand.name}! I would like to ask about an order.`),
        target: '_blank',
        rel: 'noopener',
        'aria-label': 'Chat with us on WhatsApp'
      },
      [
        // WhatsApp glyph, inline so no external request is needed.
        el('span', {
          html:
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.16L2 22l4.96-1.6A9.9 9.9 0 1 0 12.04 2Zm5.8 14.02c-.25.7-1.45 1.34-2 1.4-.55.06-1.06.25-3.42-.78-2.36-1.03-3.8-3.5-3.92-3.66-.12-.16-.94-1.3-.9-2.45.04-1.15.66-1.7.9-1.94.23-.24.5-.29.68-.29h.48c.16 0 .37-.02.56.45.2.5.68 1.75.74 1.88.06.12.1.27.01.43-.09.16-.14.27-.28.42-.14.15-.3.34-.42.46-.13.13-.27.27-.12.53.15.26.66 1.09 1.42 1.77.97.87 1.6 1.13 1.86 1.26.26.13.41.11.56-.05.15-.16.65-.75.83-1.01.18-.26.36-.21.6-.12.24.09 1.5.71 1.76.84.26.13.43.19.5.3.06.1.06.62-.19 1.32Z"/></svg>'
        }),
        el('span', { class: 'hide-sm', text: 'WhatsApp' })
      ]
    );
    document.body.append(link);
  }

  /* ------------------------------------------------------------- basket drawer */

  function renderDrawer() {
    if (qs('#cart-drawer')) return;
    const drawer = el('div', { class: 'drawer', id: 'cart-drawer', hidden: true }, [
      el('div', { class: 'drawer-backdrop', 'data-close': 'true' }),
      el('aside', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cart-title' }, [
        el('header', { class: 'drawer-head' }, [
          el('h2', { id: 'cart-title', text: 'Your basket' }),
          el('button', { class: 'close-btn', type: 'button', 'data-close': 'true', 'aria-label': 'Close basket', text: '×' })
        ]),
        el('div', { class: 'drawer-body', id: 'cart-body' }),
        el('div', { class: 'drawer-foot', id: 'cart-foot' })
      ])
    ]);

    drawer.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeCart();
    });

    document.body.append(drawer);
  }

  function openCart() {
    const drawer = qs('#cart-drawer');
    if (!drawer) return;
    drawer.hidden = false;
    const button = qs('#cart-open');
    if (button) button.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onEscape);
    renderDrawerContents();
  }

  function closeCart() {
    const drawer = qs('#cart-drawer');
    if (!drawer) return;
    drawer.hidden = true;
    const button = qs('#cart-open');
    if (button) button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onEscape);
  }

  function onEscape(event) {
    if (event.key === 'Escape') closeCart();
  }

  async function renderDrawerContents() {
    const body = qs('#cart-body');
    const foot = qs('#cart-foot');
    if (!body || !foot) return;

    const lines = WB.cart.read();
    if (!lines.length) {
      body.replaceChildren(
        el('div', { class: 'empty-state' }, [
          el('div', { class: 'big', html: icons.loaf }),
          el('p', { text: 'Your basket is empty.' }),
          el('a', { class: 'btn btn-primary btn-sm', href: '/menu', text: 'See the menu' })
        ])
      );
      foot.replaceChildren();
      return;
    }

    let products = [];
    try {
      products = await WB.products();
    } catch {
      /* Fall through with whatever we can show. */
    }

    const rows = [];
    let subtotal = 0;
    const unknown = [];

    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) {
        unknown.push(line);
        continue;
      }
      const variant = product.variants.find((v) => v.id === line.variantId) || product.variants[0];
      subtotal += variant.price * line.qty;

      rows.push(
        el('div', { class: 'cart-line' }, [
          el('img', { src: product.image, alt: '', loading: 'lazy' }),
          el('div', null, [
            el('h4', { text: product.name }),
            el('div', { class: 'variant', text: `${variant.label} · ${variant.priceLabel}` }),
            el('div', { class: 'mt-1' }, [
              el('span', { class: 'qty-stepper' }, [
                el('button', {
                  type: 'button',
                  'aria-label': `One fewer ${product.name}`,
                  text: '−',
                  on: { click: () => WB.cart.decrease(line.productId, line.variantId) }
                }),
                el('span', { class: 'qty', text: String(line.qty) }),
                el('button', {
                  type: 'button',
                  'aria-label': `One more ${product.name}`,
                  text: '+',
                  on: { click: () => WB.cart.increase(line.productId, line.variantId) }
                })
              ]),
              ' ',
              el('button', {
                type: 'button',
                class: 'btn btn-sm btn-ghost',
                text: 'Remove',
                on: { click: () => WB.cart.remove(line.productId, line.variantId) }
              })
            ])
          ]),
          el('div', { class: 'line-price', text: money(variant.price * line.qty) })
        ])
      );
    }

    if (unknown.length) {
      // A product left the menu while it sat in a basket — tell the customer.
      rows.push(
        el('div', { class: 'form-note warn mt-2' }, [
          el('p', { text: `${unknown.length} item(s) in your basket are no longer on the menu and will be removed.` }),
          el('button', {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            text: 'Remove them',
            on: { click: () => WB.cart.replace(lines.filter((l) => !unknown.includes(l))) }
          })
        ])
      );
    }

    body.replaceChildren(...rows);

    const minimum = cfg.order.minOrderRwf;
    const shortfall = Math.max(0, minimum - subtotal);
    const freeFrom = cfg.order.freeDeliveryFromRwf;
    const toFreeDelivery = Math.max(0, freeFrom - subtotal);

    foot.replaceChildren(
      el('div', { class: 'summary-row' }, [
        el('span', { text: 'Subtotal' }),
        el('strong', { text: money(subtotal) })
      ]),
      el('div', { class: 'summary-row' }, [
        el('span', { class: 'small', text: 'Delivery added at checkout' }),
        el('span', { class: 'small', text: subtotal >= freeFrom ? 'Free' : `from ${money(1000)}` })
      ]),
      shortfall > 0
        ? el('div', { class: 'form-note warn mt-2', text: `Add ${money(shortfall)} more to reach the ${money(minimum)} minimum order.` })
        : toFreeDelivery > 0
          ? el('div', { class: 'form-note mt-2', text: `${money(toFreeDelivery)} more and delivery is free.` })
          : el('div', { class: 'form-note ok mt-2', text: 'Delivery is free on this basket.' }),
      el('a', { class: 'btn btn-primary btn-block mt-2', href: '/order', text: 'Go to checkout' })
    );
  }

  function updateCartBadge() {
    const badge = qs('#cart-count');
    if (!badge) return;
    const count = WB.cart.count();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  /* -------------------------------------------------------- account link state */

  async function updateAccountLink() {
    const link = qs('[data-role="account-link"]');
    if (!link) return;
    const user = await WB.session();
    if (user) {
      link.setAttribute('href', '/account');
      link.replaceChildren(el('span', { class: 'label', text: 'My orders' }));
    } else {
      link.setAttribute('href', '/login');
      link.replaceChildren(el('span', { class: 'label', text: 'Sign in' }));
    }
  }

  /* ------------------------------------------------------------ product card */

  /**
   * One product card. Shows the photo, the Kinyarwanda name, the plain-English
   * gloss, a short description, the local inputs and the price — always visible,
   * never hidden behind a click.
   */
  function productCard(product) {
    const multi = product.variants.length > 1;

    const media = el('div', { class: 'product-media' }, [
      el('img', { src: product.image, alt: `${product.name} — ${product.gloss}`, loading: 'lazy' }),
      product.badge
        ? el('span', { class: `product-badge ${product.orderable ? '' : 'out'}`.trim(), text: product.orderable ? product.badge : 'Off the menu' })
        : null
    ]);

    const priceRow = el('div', { class: 'price-row' }, [
      el('span', { class: 'price-tag', text: product.variants[0].priceLabel }),
      el('span', { class: 'price-meta', text: `/ ${product.unit}` })
    ]);

    const stepper = el('span', { class: 'qty-stepper' }, []);

    const select = multi
      ? el('select', { 'aria-label': `Choose a size or pack for ${product.name}` }, [])
      : null;

    const refresh = () => {
      const variant = multi
        ? product.variants.find((v) => v.id === select.value) || product.variants[0]
        : product.variants[0];
      priceRow.replaceChildren(
        el('span', { class: 'price-tag', text: variant.priceLabel }),
        el('span', { class: 'price-meta', text: `/ ${variant.label}` })
      );
    };

    if (multi) {
      for (const variant of product.variants) {
        select.append(
          el('option', {
            value: variant.id,
            text: `${variant.label} — ${variant.priceLabel}`,
            selected: variant.id === product.variants[0].id
          })
        );
      }
      select.addEventListener('change', refresh);
    }

    const qtyLabel = el('span', { class: 'qty', text: '1' });
    stepper.append(
      el('button', {
        type: 'button',
        'aria-label': `One fewer ${product.name}`,
        text: '−',
        on: {
          click: () => {
            const next = Math.max(1, Number(qtyLabel.textContent) - 1);
            qtyLabel.textContent = String(next);
          }
        }
      }),
      qtyLabel,
      el('button', {
        type: 'button',
        'aria-label': `One more ${product.name}`,
        text: '+',
        on: {
          click: () => {
            const next = Math.min(99, Number(qtyLabel.textContent) + 1);
            qtyLabel.textContent = String(next);
          }
        }
      })
    );

    const addButton = el('button', {
      class: 'btn btn-primary btn-sm btn-block',
      type: 'button',
      disabled: !product.orderable,
      text: product.orderable ? 'Add to basket' : 'Not available now',
      on: {
        click: () => {
          const variant = multi
            ? product.variants.find((v) => v.id === select.value) || product.variants[0]
            : product.variants[0];
          WB.cart.add({ productId: product.id, variantId: variant.id }, Number(qtyLabel.textContent));
          WB.toast(`${qtyLabel.textContent} × ${product.name} added to your basket.`, 'ok');
          qtyLabel.textContent = '1';
        }
      }
    });

    const body = el('div', { class: 'product-body' }, [
      el('h3', { text: product.name }),
      el('p', { class: 'gloss', text: product.gloss }),
      el('p', { class: 'desc', text: product.short }),
      el('p', { class: 'inputs' }, [
        el('strong', { text: 'Rwandan inputs: ' }),
        document.createTextNode(product.rwandanInputs)
      ]),
      product.orderableNote ? el('p', { class: 'small', text: product.orderableNote }) : null,
      priceRow,
      multi ? el('div', { class: 'variant-picker' }, [el('label', { text: 'Size / pack' }), select]) : null,
      el('div', { class: 'product-actions' }, [stepper, addButton])
    ]);

    return el('article', { class: `product ${product.orderable ? '' : 'is-out'}`.trim(), dataset: { id: product.id } }, [media, body]);
  }

  /* ------------------------------------------------------------------- boot */

  function wireBasketListeners() {
    const sync = () => {
      updateCartBadge();
      const drawer = qs('#cart-drawer');
      if (drawer && !drawer.hidden) renderDrawerContents();
    };
    WB.cart.onChange(sync);
    window.addEventListener('storage', (event) => {
      if (event.key === WB.cart.KEY) sync();
    });
    sync();
  }

  async function init() {
    cfg = await WB.config();
    renderHeader();
    renderFooter();
    renderDrawer();
    renderWhatsApp();
    wireBasketListeners();
    await updateAccountLink();
  }

  return {
    NAV,
    init,
    openCart,
    closeCart,
    productCard,
    whatsappLink,
    updateCartBadge,
    updateAccountLink,
    get config() {
      return cfg;
    }
  };
})();
