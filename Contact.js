/* ==========================================================================
   Contact page — contact details from config, message form, WhatsApp button.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { qs } = WB;
  const brand = WB.ui.config.brand;

  /* ------------------------------------------------------- contact details */

  qs('#wa-contact').setAttribute(
    'href',
    WB.ui.whatsappLink(`Hello ${brand.name}! I have a question.`)
  );

  qs('#phone-display').textContent = brand.phone;
  const phoneLink = qs('#phone-link');
  phoneLink.setAttribute('href', `tel:${brand.phone.replace(/\s/g, '')}`);
  phoneLink.textContent = brand.phone;

  qs('#email-display').textContent = brand.email;
  const emailLink = qs('#email-link');
  emailLink.setAttribute('href', `mailto:${brand.email}?subject=${encodeURIComponent('Wheatburn enquiry')}`);
  emailLink.textContent = brand.email;

  qs('#address-display').textContent = brand.address;
  qs('#hours-display').textContent = `Mon–Sat, 07:00–18:00 · closed ${brand.closedDays}`;
  qs('#map-link').setAttribute(
    'href',
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brand.address)}`
  );
  qs('#hours-note').textContent =
    `The counter is open ${brand.hours}. The overnight bake runs Monday to Saturday and wholesale leaves before 06:30. We are closed on ${brand.closedDays}.`;

  /* ---------------------------------------------------------- message form */

  const form = qs('#contact-form');
  const errorBox = qs('#contact-error');
  const successBox = qs('#contact-success');

  // If the visitor is signed in, save them the typing.
  const user = await WB.session();
  if (user) {
    qs('#c-name').value = user.name || '';
    qs('#c-phone').value = user.phone || '';
    if (user.email) qs('#c-email').value = user.email;
  }

  const preselectedTopic = new URLSearchParams(location.search).get('topic');
  if (preselectedTopic) {
    const select = qs('#c-topic');
    if ([...select.options].some((option) => option.value === preselectedTopic)) {
      select.value = preselectedTopic;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    WB.clearFieldErrors(form);
    WB.showNote(errorBox, '');
    WB.showNote(successBox, '');

    const name = qs('#c-name');
    const phone = qs('#c-phone');
    const email = qs('#c-email');
    const message = qs('#c-message');
    let ok = true;

    if (name.value.trim().length < 2) {
      WB.setFieldError(name, 'Tell us your name.');
      ok = false;
    }
    if (phone.value.trim() && !WB.isValidPhone(phone.value)) {
      WB.setFieldError(phone, WB.PHONE_HINT);
      ok = false;
    }
    if (email.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) {
      WB.setFieldError(email, 'That email address does not look right.');
      ok = false;
    }
    if (message.value.trim().length < 5) {
      WB.setFieldError(message, 'Add a short message so we can help.');
      ok = false;
    }
    if (!ok) {
      WB.focusFirstInvalid(form);
      return;
    }

    const button = qs('#contact-submit');
    WB.setBusy(button, true, 'Sending…');
    try {
      const result = await WB.api.post('/contact', {
        name: name.value.trim(),
        phone: phone.value.trim() || null,
        email: email.value.trim() || null,
        topic: qs('#c-topic').value,
        message: message.value.trim()
      });
      WB.showNote(successBox, result.message, 'ok');
      form.reset();
      if (user) {
        qs('#c-name').value = user.name || '';
        qs('#c-phone').value = user.phone || '';
      }
      WB.toast('Message sent.', 'ok');
    } catch (err) {
      WB.showNote(errorBox, err.message, 'error');
    } finally {
      WB.setBusy(button, false);
    }
  });
});
