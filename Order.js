/* ==========================================================================
   Order page — basket, checkout, confirmation and order tracking.

   There is no login wall anywhere in this file. A first-time visitor can go
   from an empty basket to a confirmed order without an account; signing in
   only fills in what we already know.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { el, money, qs, qsa } = WB;
  const cfg = WB.ui.config;
  const LAST_ORDER_KEY = 'wheatburn.lastOrder';

  const views = {
    checkout: qs('#checkout-view'),
    confirmation: qs('#confirmation-view'),
    track: qs('#track-view')
  };

  const state = {
    products: [],
    zones: [],
    pickup: null,
    methods: [],
    user: null,
    dashboard: null,
    zoneId: null,
    methodId: 'cod',
    quote: null,
    placing: false,
    placed: null
  };

  /* ------------------------------------------------------------- utilities */

  function showView(name) {
    for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setStep(activeStep) {
    const order = ['basket', 'details', 'delivery', 'payment', 'done'];
    const index = order.indexOf(activeStep);
    order.forEach((name, i) => {
      const node = qs(`#step-${name}`);
      if (!node) return;
      node.classList.toggle('active', i === index);
      node.classList.toggle('done', i < index);
    });
  }

  function showCheckoutNote(message, kind) {
    WB.showNote(qs('#checkout-note'), message, kind);
  }

  /* -------------------------------------------------------------- basket UI */

  function renderBasket() {
    const host = qs('#basket-lines');
    const empty = qs('#basket-empty');
    const lines = WB.cart.read();

    if (!lines.length) {
      host.replaceChildren();
      empty.hidden = false;
      qs('#details-panel').hidden = true;
      qs('#delivery-panel').hidden = true;
      qs('#payment-panel').hidden = true;
      setStep('basket');
      return;
    }
    empty.hidden = true;
    qs('#details-panel').hidden = false;
    qs('#delivery-panel').hidden = false;
    qs('#payment-panel').hidden = false;

    host.replaceChildren(
      ...lines.map((line) => {
        const product = state.products.find((p) => p.id === line.productId);
        if (!product) {
          return el('div', { class: 'cart-line' }, [
            el('div', null, [
              el('h4', { text: 'Item no longer on the menu' }),
              el('button', {
                class: 'btn btn-sm btn-ghost',
                type: 'button',
                text: 'Remove',
                on: { click: () => WB.cart.remove(line.productId, line.variantId) }
              })
            ])
          ]);
        }
        const variant =
          product.variants.find((v) => v.id === line.variantId) || product.variants[0];

        return el('div', { class: 'cart-line' }, [
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
                class: 'btn btn-sm btn-ghost',
                type: 'button',
                text: 'Remove',
                on: { click: () => WB.cart.remove(line.productId, line.variantId) }
              })
            ])
          ]),
          el('div', { class: 'line-price', text: money(variant.price * line.qty) })
        ]);
      })
    );
  }

  /* ----------------------------------------------------------- zone choices */

  function renderZones() {
    const host = qs('#zone-choices');
    const choices = [];

    const card = (zone, isPickup) =>
      el('label', { class: 'choice' }, [
        el('input', {
          type: 'radio',
          name: 'zone',
          value: zone.id,
          checked: state.zoneId === zone.id,
          on: {
            change: () => {
              state.zoneId = zone.id;
              renderZones();
              refreshQuote();
            }
          }
        }),
        el('span', { class: 'choice-main' }, [
          el('span', { class: 'choice-title' }, [
            el('span', { text: zone.name }),
            el('span', { class: 'fee', text: isPickup ? 'Free' : zone.feeLabel })
          ]),
          el('span', { class: 'choice-detail', text: zone.etaText }),
          !isPickup && zone.confirmed === false
            ? el('span', { class: 'choice-detail', text: 'We will call to confirm this area before dispatch.' })
            : null
        ])
      ]);

    choices.push(card(state.pickup, true));
    for (const zone of state.zones) choices.push(card(zone, false));

    host.replaceChildren(...choices);

    const addressFields = qs('#address-fields');
    const isPickup = state.zoneId === state.pickup.id;
    addressFields.hidden = isPickup || !state.zoneId;
    qs('#dispatch-note').hidden = true;
  }

  /* -------------------------------------------------------- payment choices */

  function renderPayments() {
    const host = qs('#payment-choices');

    host.replaceChildren(
      ...state.methods.map((method) =>
        el('label', { class: 'choice' }, [
          el('input', {
            type: 'radio',
            name: 'payment',
            value: method.id,
            checked: state.methodId === method.id,
            on: {
              change: () => {
                state.methodId = method.id;
                renderPayments();
              }
            }
          }),
          el('span', { class: 'choice-main' }, [
            el('span', { class: 'choice-title' }, [
              el('span', { text: method.label }),
              method.optional ? el('span', { class: 'small', text: 'optional' }) : null
            ]),
            el('span', { class: 'choice-detail', text: method.detail })
          ])
        ])
      )
    );

    const method = state.methods.find((m) => m.id === state.methodId);
    const referenceFields = qs('#reference-fields');
    referenceFields.hidden = !method || !method.requiresReference;
    if (method && method.referenceLabel) qs('#reference-label').textContent = method.referenceLabel;

    const note = qs('#payment-note');
    if (!method) {
      note.hidden = true;
    } else if (method.id === 'cod') {
      note.hidden = false;
      note.className = 'form-note mt-2 ok';
      note.textContent = 'Nothing to pay now. Have the cash ready and the rider confirms at the door.';
    } else if (method.payTo) {
      note.hidden = false;
      note.className = 'form-note mt-2';
      note.textContent = `Send the payment to ${method.payTo}, then reply with the reference so we can match it.`;
    } else {
      note.hidden = false;
      note.className = 'form-note mt-2 warn';
      note.textContent =
        'We will send our payment details by SMS with the order confirmation. Reply with the reference and we dispatch.';
    }
  }

  /* ---------------------------------------------------------------- summary */

  function renderSummary() {
    const rows = qs('#summary-rows');
    const foot = qs('#summary-foot');
    const quote = state.quote;

    if (!quote || !quote.lines.length) {
      rows.replaceChildren(el('p', { class: 'small', text: 'Your basket is empty.' }));
      foot.replaceChildren();
      return;
    }

    rows.replaceChildren(
      ...quote.lines.map((line) =>
        el('div', { class: 'summary-row' }, [
          el('span', { text: `${line.qty} × ${line.name} (${line.variantLabel})` }),
          el('span', { text: line.lineTotalLabel })
        ])
      ),
      el('div', { class: 'summary-row' }, [
        el('span', { text: 'Subtotal' }),
        el('span', { text: quote.subtotalLabel })
      ]),
      el('div', { class: 'summary-row' }, [
        el('span', { text: quote.delivery ? `Delivery — ${quote.delivery.zoneName}` : 'Delivery' }),
        el(
          'span',
          { class: quote.delivery && quote.delivery.fee === 0 ? 'free' : null },
          [quote.delivery ? quote.delivery.feeLabel : 'Choose an area below']
        )
      ]),
      el('div', { class: 'summary-row total' }, [
        el('span', { text: 'Total' }),
        el('span', { text: quote.totalLabel })
      ])
    );

    const blocks = [];

    if (quote.problems.length) {
      blocks.push(
        el('div', { class: 'form-note error mt-2' }, [
          el('p', { text: 'Some items need attention:' }),
          el('ul', null, quote.problems.map((p) => el('li', { text: `${p.name || 'An item'}: ${p.reason}` }))),
          el('button', {
            class: 'btn btn-sm btn-ghost mt-1',
            type: 'button',
            text: 'Remove unavailable items',
            on: {
              click: () => {
                const bad = new Set(quote.problems.map((p) => p.productId));
                WB.cart.replace(WB.cart.read().filter((l) => !bad.has(l.productId)));
              }
            }
          })
        ])
      );
    } else if (!quote.meetsMinimum) {
      blocks.push(
        el('div', { class: 'form-note warn mt-2', text: `The minimum order is ${money(quote.minOrderRwf)}. Add ${money(quote.minOrderRwf - quote.subtotal)} more to check out.` })
      );
    }

    if (quote.delivery && quote.delivery.freeApplied) {
      blocks.push(el('p', { class: 'small mt-2', text: `Delivery is free on baskets over ${money(quote.freeDeliveryFromRwf)}.` }));
    }

    const disabled = quote.problems.length > 0 || !quote.meetsMinimum || !state.zoneId || state.placing;

    blocks.push(
      el('button', {
        class: 'btn btn-primary btn-block mt-2',
        type: 'button',
        id: 'place-order',
        disabled,
        text: state.placing ? 'Placing your order…' : 'Place order',
        on: { click: placeOrder }
      }),
      el('p', { class: 'small mt-1', text: 'No payment is taken on this website. You pay on delivery or by mobile money.' })
    );

    foot.replaceChildren(...blocks.filter(Boolean));
  }

  async function refreshQuote() {
    try {
      state.quote = await WB.api.post('/cart/quote', {
        items: WB.cart.payload(),
        deliveryZoneId: state.zoneId
      });
      showCheckoutNote('');

      const note = qs('#dispatch-note');
      if (state.quote.delivery && state.quote.dispatchPreview) {
        note.hidden = false;
        note.className = 'form-note mt-2';
        note.textContent = `${state.quote.delivery.etaText}. ${state.quote.dispatchPreview.reason}`;
      } else {
        note.hidden = true;
      }
    } catch (err) {
      state.quote = null;
      showCheckoutNote(err.message, 'error');
    }
    renderSummary();
    updateStepFromProgress();
  }

  function updateStepFromProgress() {
    if (!state.quote || !state.quote.lines.length) return setStep('basket');
    if (!qs('#f-name').value.trim() || !qs('#f-phone').value.trim()) return setStep('details');
    if (!state.zoneId) return setStep('delivery');
    return setStep('payment');
  }

  /* ------------------------------------------------------------------ submit */

  async function placeOrder() {
    if (state.placing) return;
    const nameInput = qs('#f-name');
    const phoneInput = qs('#f-phone');
    const addressInput = qs('#f-address');
    const referenceInput = qs('#f-reference');
    const isPickup = state.zoneId === state.pickup.id;
    let ok = true;

    WB.clearFieldErrors(qs('#checkout-view'));

    if (nameInput.value.trim().length < 2) {
      WB.setFieldError(nameInput, 'We need a name for the order.');
      ok = false;
    }
    if (!WB.isValidPhone(phoneInput.value)) {
      WB.setFieldError(phoneInput, WB.PHONE_HINT);
      ok = false;
    }
    if (!state.zoneId) {
      showCheckoutNote('Choose a delivery area, or collect at the counter.', 'error');
      ok = false;
    }
    if (!isPickup && addressInput.value.trim().length < 6) {
      WB.setFieldError(addressInput, 'Add an address or a clear landmark so the rider can find you.');
      ok = false;
    }
    if (!ok) {
      WB.focusFirstInvalid(qs('#checkout-view'));
      return;
    }

    state.placing = true;
    renderSummary();
    showCheckoutNote('Placing your order…');

    try {
      const payload = {
        items: WB.cart.payload(),
        customer: {
          name: nameInput.value.trim(),
          phone: phoneInput.value.trim(),
          whatsappOptIn: qs('#f-whatsapp').checked,
          address: isPickup ? null : addressInput.value.trim(),
          landmark: qs('#f-landmark').value.trim() || null,
          email: state.user ? state.user.email : null,
          notes: qs('#f-notes').value.trim() || null
        },
        deliveryZoneId: state.zoneId,
        payment: {
          methodId: state.methodId,
          reference: referenceInput.value.trim() || null
        }
      };

      const result = await WB.api.post('/orders', payload);
      state.placed = result.order;
      try {
        sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(result.order));
      } catch {
        /* Not fatal: the confirmation is on screen either way. */
      }
      WB.cart.clear();
      renderConfirmation(result.order);
      showView('confirmation');
      setStep('done');
      history.replaceState(null, '', `/order?order=${encodeURIComponent(result.order.number)}`);
    } catch (err) {
      if (err.code === 'basket_changed') {
        showCheckoutNote(err.message, 'error');
        await refreshQuote();
      } else {
        showCheckoutNote(err.message, 'error');
      }
      WB.toast(err.message, 'error');
    } finally {
      state.placing = false;
      renderSummary();
    }
  }

  /* ---------------------------------------------------------- confirmation UI */

  function statusTimeline(order) {
    const done = new Set(order.timeline.map((t) => t.status));
    const steps = [
      { id: 'confirmed', label: 'Confirmed', note: 'Order received and added to the bake list.' },
      { id: 'baking', label: 'In the oven', note: 'Baked in the overnight run.' },
      order.delivery.isPickup
        ? { id: 'ready_for_collection', label: 'Ready to collect', note: `Waiting at the counter, ${cfg.brand.address}` }
        : { id: 'out_for_delivery', label: 'On its way', note: 'The rider is on the way to you.' },
      { id: 'delivered', label: order.delivery.isPickup ? 'Collected' : 'Delivered', note: 'Payment is settled at handover.' }
    ];

    return steps.map((step) => {
      const reached = done.has(step.id) || (step.id === 'confirmed' && done.has('pending_payment'));
      return el('li', { class: reached ? 'current' : null }, [
        el('div', { class: 'what', text: step.label }),
        el('div', { class: 'why', text: step.note }),
        reached ? el('div', { class: 'when', text: 'In progress' }) : null
      ]);
    });
  }

  function renderConfirmation(order) {
    qs('#confirm-message').textContent = `Thank you, ${order.customer.name.split(' ')[0]} — your order is with us.`;
    qs('#confirm-number').textContent = order.number;

    const smsLine = order.payment.status === 'awaiting_reference'
      ? `We sent the order to ${order.customer.phone}. We will also send our payment details so you can send the money.`
      : `We sent a confirmation to ${order.customer.phone}. Keep the order number handy.`;
    qs('#confirm-sms').textContent = smsLine;

    const actions = [
      el('a', {
        class: 'btn btn-primary',
        href: order.whatsappUrl,
        target: '_blank',
        rel: 'noopener',
        text: 'Send it on WhatsApp'
      }),
      el('a', {
        class: 'btn btn-ghost',
        href: `/order?track=${encodeURIComponent(order.number)}&code=${encodeURIComponent(order.trackingCode)}`,
        text: 'Track this order'
      }),
      el('a', { class: 'btn btn-ghost', href: '/menu', text: 'Order something else' })
    ];
    qs('#confirm-actions').replaceChildren(...actions);

    qs('#confirm-timeline').replaceChildren(...statusTimeline(order));

    qs('#confirm-lines').replaceChildren(
      ...order.lines.map((line) =>
        el('tr', null, [
          el('td', null, [el('strong', { text: line.name }), el('div', { class: 'small', text: line.variantLabel })]),
          el('td', { class: 'num', text: String(line.qty) }),
          el('td', { class: 'num', text: line.lineTotalLabel })
        ])
      ),
      el('tr', null, [
        el('td', { colspan: '2' }, [el('strong', { text: 'Subtotal' })]),
        el('td', { class: 'num', text: order.subtotalLabel })
      ]),
      el('tr', null, [
        el('td', { colspan: '2' }, [el('strong', { text: 'Delivery' })]),
        el('td', { class: 'num', text: order.deliveryFeeLabel })
      ]),
      el('tr', null, [
        el('td', { colspan: '2' }, [el('strong', { text: 'Total to pay' })]),
        el('td', { class: 'num' }, [el('strong', { text: order.totalLabel })])
      ])
    );
    qs('#confirm-total').textContent =
      'Retail prices include 18% VAT. Nothing has been charged on this website.';

    qs('#confirm-delivery').replaceChildren(
      el('div', { class: 'summary-row' }, [el('span', { text: order.delivery.isPickup ? 'Collection' : 'Area' }), el('strong', { text: order.delivery.zoneName })]),
      order.delivery.address ? el('p', { class: 'small mt-1', text: order.delivery.address }) : null,
      el('div', { class: 'summary-row' }, [el('span', { text: 'Estimated' }), el('span', { text: order.delivery.etaText })]),
      el('p', { class: 'small mt-1', text: `${order.dispatch.text} — ${order.dispatch.reason}` }),
      order.delivery.needsConfirmation
        ? el('div', { class: 'form-note warn mt-2', text: 'This area is not on our regular round yet. We will call to confirm before dispatch.' })
        : null
    );

    qs('#confirm-payment').replaceChildren(
      el('div', { class: 'summary-row' }, [el('span', { text: 'Method' }), el('strong', { text: order.payment.label })]),
      el('div', { class: 'summary-row' }, [el('span', { text: 'Amount' }), el('strong', { text: order.totalLabel })]),
      el('p', { class: 'small mt-2', text: order.payment.instructions }),
      order.payment.payTo ? el('p', { class: 'small', text: `Payment details: ${order.payment.payTo}` }) : null,
      order.payment.reference ? el('p', { class: 'small', text: `Your reference: ${order.payment.reference}` }) : null
    );

    const accountPanel = qs('#confirm-account-panel');
    if (order.guest) {
      accountPanel.hidden = false;
      const params = new URLSearchParams({
        phone: order.customer.phone,
        name: order.customer.name,
        next: '/account'
      });
      if (order.delivery.address) params.set('address', order.delivery.address);
      qs('#confirm-account-actions').replaceChildren(
        el('a', { class: 'btn btn-primary btn-sm', href: `/register?${params.toString()}`, text: 'Create my account' }),
        el('a', { class: 'btn btn-ghost btn-sm', href: '/login', text: 'I already have one' })
      );
    } else {
      accountPanel.hidden = true;
    }
  }

  /* ----------------------------------------------------------------- tr