/* ==========================================================================
   Account dashboard — order history, status, saved details, reorder, sign out.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { el, qs, icons } = WB;

  const guard = qs('#account-guard');
  const content = qs('#account-content');

  let data;
  try {
    data = await WB.dashboard();
  } catch {
    guard.hidden = false;
    return;
  }

  content.hidden = false;
  const user = data.user;

  /* ------------------------------------------------------------------ header */

  qs('#greeting').textContent = `Welcome back, ${user.name.split(' ')[0]}.`;
  qs('#account-meta').textContent =
    `${user.phoneMasked}${user.email ? ` · ${user.email}` : ''} · member since ${new Date(user.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;

  const wa = qs('#wa-account');
  wa.setAttribute('href', WB.ui.whatsappLink(`Hello Wheatburn! This is ${user.name} (${user.phoneMasked}).`));

  /* -------------------------------------------------------------------- stats */

  const stats = data.stats;
  qs('#stats').replaceChildren(
    el('div', { class: 'stat' }, [
      el('span', { class: 'value', text: String(stats.orderCount) }),
      el('span', { class: 'key', text: stats.orderCount === 1 ? 'Order placed' : 'Orders placed' })
    ]),
    el('div', { class: 'stat' }, [
      el('span', { class: 'value', text: String(stats.activeCount) }),
      el('span', { class: 'key', text: 'In progress right now' })
    ]),
    el('div', { class: 'stat' }, [
      el('span', { class: 'value', text: stats.lifetimeSpendLabel.replace('RWF ', '') }),
      el('span', { class: 'key', text: 'RWF spent in total' })
    ]),
    stats.favouriteItem
      ? el('div', { class: 'stat' }, [
          el('span', { class: 'value', text: stats.favouriteItem.name }),
          el('span', { class: 'key', text: `Your usual — ${stats.favouriteItem.qty} ordered` })
        ])
      : null
  );

  /* ------------------------------------------------------------------- orders */

  const ordersHost = qs('#orders');
/**
*@param {Array} orders
*/
  function renderOrders(orders) {
    if (!orders.length) {
      ordersHost.replaceChildren(
        el('div', { class: 'empty-state' }, [
          el('div', { class: 'big', html: icons.loaf }),
          el('p', { text: 'No orders on this account yet.' }),
          el('a', { class: 'btn btn-primary', href: '/menu', text: 'See the menu' })
        ])
      );
      return;
    }

    ordersHost.replaceChildren(
      ...orders.map((order) => {
        const summary = order.lines
          .map((line /** @type {object} */ line) => `${line.qty} × ${line.name}`)
          .join(' · ');

        const reorderButton = el('button', {
          class: 'btn btn-sm btn-primary',
          type: 'button',
          text: 'Reorder',
          on: {
            click: async (event) => {
              const button = event.currentTarget;
              WB.setBusy(button, true, 'Adding…');
              try {
                const result = await WB.api.post(`/orders/${order.id}/reorder`, {});
                if (!result.items.length) {
                  WB.toast('Nothing on that order is available today.', 'error');
                  WB.setBusy(button, false);
                  return;
                }
                WB.cart.replace(result.items);
                if (result.unavailable.length) {
                  WB.toast(
                    `Basket refilled. ${result.unavailable.length} item(s) are off the menu today.`,
                    'error'
                  );
                } else {
                  WB.toast('Basket refilled — check it over and confirm.', 'ok');
                }
                location.assign('/order');
              } catch (err) {
                WB.toast(err.message, 'error');
                WB.setBusy(button, false);
              }
            }
          }
        });

        return el('article', { class: 'order-card' }, [
          el('div', { class: 'order-card-head' }, [
            el('div', null, [
              el('span', { class: 'num', text: order.number }),
              el('div', { class: 'small', text: order.createdAtLabel })
            ]),
            el('span', { class: `status-badge ${order.status}`, text: `${order.statusIcon} ${order.statusLabel}` })
          ]),
          el('p', { class: 'small mb-0', text: order.statusNote }),
          el('div', { class: 'order-lines mt-1', text: summary }),
          el('div', { class: 'summary-row' }, [
            el('span', {
              text: order.delivery.isPickup
                ? `Collection · ${order.delivery.zoneName}`
                : `${order.delivery.zoneName} · ${order.delivery.etaText}`
            }),
            el('strong', { text: order.totalLabel })
          ]),
          el('div', { class: 'summary-row' }, [
            el('span', { text: 'Payment' }),
            el('span', { text: `${order.payment.label} · ${order.payment.status.replace(/_/g, ' ')}` })
          ]),
          el('div', { class: 'order-foot' }, [
            el('div', { class: 'small', text: `Track with ${order.number}` }),
            el('div', { class: 'btn-row mt-0' }, [
              reorderButton,
              el('a', {
                class: 'btn btn-sm btn-ghost',
                href: `/order?track=${encodeURIComponent(order.number)}`,
                text: 'View status'
              })
            ])
          ])
        ]);
      })
    );
  }

  renderOrders(data.orders);

  /* ---------------------------------------------------------- saved details */

  qs('#a-name').value = user.name || '';
  qs('#a-phone').value = user.phoneMasked || user.phone;
  qs('#a-email').value = user.email || '';
  qs('#a-address').value = data.savedAddress || '';
  qs('#a-whatsapp').checked = user.whatsappOptIn !== false;

  try {
    const delivery = await WB.api.get('/delivery');
    const zoneSelect = qs('#a-zone');
    zoneSelect.replaceChildren(
      el('option', { value: '', text: 'No usual area' }),
      el('option', { value: delivery.pickup.id, text: `${delivery.pickup.name} (always free)` }),
      ...delivery.zones.map((zone) => el('option', { value: zone.id, text: `${zone.name} — ${zone.feeLabel}` }))
    );
    zoneSelect.value = data.deliveryZoneId || '';
  } catch {
    qs('#a-zone').hidden = true;
  }

  qs('#details-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = qs('#details-form');
    const name = qs('#a-name');
    const email = qs('#a-email');
    WB.clearFieldErrors(form);
    WB.showNote(qs('#account-error'), '');
    WB.showNote(qs('#account-info'), '');

    if (name.value.trim().length < 2) {
      WB.setFieldError(name, 'Tell us your name.');
      return WB.focusFirstInvalid(form);
    }
    if (email.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) {
      WB.setFieldError(email, 'That email address does not look right.');
      return WB.focusFirstInvalid(form);
    }

    const button = qs('#details-submit');
    WB.setBusy(button, true, 'Saving…');
    try {
      const result = await WB.api.patch('/account', {
        name: name.value.trim(),
        email: email.value.trim() || null,
        savedAddress: qs('#a-address').value.trim() || null,
        deliveryZoneId: qs('#a-zone').value || null,
        whatsappOptIn: qs('#a-whatsapp').checked
      });
      WB.setSession(result.user);
      WB.showNote(qs('#account-info'), result.message, 'ok');
      WB.toast('Details saved.', 'ok');
    } catch (err) {
      WB.showNote(qs('#account-error'), err.message, 'error');
    } finally {
      WB.setBusy(button, false);
    }
  });

  /* ------------------------------------------------------------ change password */

  qs('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = qs('#password-form');
    const current = qs('#a-current');
    const next = qs('#a-new');
    WB.clearFieldErrors(form);
    WB.showNote(qs('#account-error'), '');
    WB.showNote(qs('#account-info'), '');

    const minLength = (WB.ui.config.security && WB.ui.config.security.minPasswordLength) || 8;
    if (!current.value) {
      WB.setFieldError(current, 'Enter your current password.');
      return WB.focusFirstInvalid(form);
    }
    if (next.value.length < minLength) {
      WB.setFieldError(next, `Use at least ${minLength} characters.`);
      return WB.focusFirstInvalid(form);
    }
    if (!/[A-Za-z]/.test(next.value) || !/\d/.test(next.value)) {
      WB.setFieldError(next, 'Include at least one letter and one number.');
      return WB.focusFirstInvalid(form);
    }

    const button = qs('#password-submit');
    WB.setBusy(button, true, 'Saving…');
    try {
      const result = await WB.api.post('/account/password', {
        currentPassword: current.value,
        newPassword: next.value
      });
      WB.showNote(qs('#account-info'), result.message, 'ok');
      form.reset();
    } catch (err) {
      WB.showNote(qs('#account-error'), err.message, 'error');
    } finally {
      WB.setBusy(button, false);
    }
  });

  /* -------------------------------------------------------------------- logout */

  qs('#logout').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    WB.setBusy(button, true, 'Signing out…');
    try {
      await WB.api.post('/auth/logout', {});
    } catch {
      /* Signing out should never fail from the customer's point of view. */
    }
    WB.setSession(null);
    location.assign('/');
  });
});
