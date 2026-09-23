/* ==========================================================================
   Sign in, register and password recovery.

   One script for four pages, switching on <body data-page="…">:
     login    — phone + password, or phone + one-time SMS code
     register — name, phone, password
     forgot   — start recovery by SMS code or email link, then set a new password
     reset    — finish recovery (email link, or SMS code)

   Codes are never invented here. In development the API returns the code it
   would have texted so the flow can be tested without an SMS provider; that
   field does not exist in production responses.
   ========================================================================== */

WB.onReady(async () => {
  'use strict';

  await WB.ui.init();

  const { qs } = WB;
  const page = document.body.dataset.page;
  const params = new URLSearchParams(location.search);

  /** Where to go after signing in: an explicit ?next=, else checkout or account. */
  function destination() {
    const next = params.get('next');
    if (next && next.startsWith('/')) return next;
    return WB.cart.count() > 0 ? '/order?welcome=1' : '/account';
  }

  function go(url) {
    location.assign(url);
  }

  /** Shows a development-only code hint, so the flow is testable offline. */
  function showDevCode(node, payload, label) {
    if (!node || !payload || !payload.devCode) return;
    node.hidden = false;
    node.className = 'form-note warn';
    node.innerHTML = `Development only — no SMS provider is configured, so here is the ${label}: <code>${WB.esc(payload.devCode)}</code>`;
  }

  /* =======================================================================
     A signed-in visitor has no business on login or register
     ======================================================================= */

  if (page === 'login' || page === 'register') {
    const existing = await WB.session();
    if (existing) {
      go(destination());
      return;
    }
  }

  /* =======================================================================
     Login
     ======================================================================= */

  if (page === 'login') {
    const errorBox = qs('#login-error');
    const tabPassword = qs('#tab-password');
    const tabOtp = qs('#tab-otp');
    const panelPassword = qs('#panel-password');
    const panelOtp = qs('#panel-otp');
    const phonePrefill = params.get('phone');
    if (phonePrefill) {
      qs('#p-phone').value = phonePrefill;
      qs('#o-phone').value = phonePrefill;
    }

    function selectTab(which) {
      const isPassword = which === 'password';
      tabPassword.setAttribute('aria-selected', String(isPassword));
      tabOtp.setAttribute('aria-selected', String(!isPassword));
      panelPassword.hidden = !isPassword;
      panelOtp.hidden = isPassword;
      WB.showNote(errorBox, '');
    }
    tabPassword.addEventListener('click', () => selectTab('password'));
    tabOtp.addEventListener('click', () => selectTab('otp'));

    if (params.get('mode') === 'otp') selectTab('otp');

    /* ---- password ---- */
    qs('#password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const phone = qs('#p-phone');
      const password = qs('#p-password');
      WB.clearFieldErrors(qs('#password-form'));
      WB.showNote(errorBox, '');
      let ok = true;

      if (!WB.isValidPhone(phone.value)) {
        WB.setFieldError(phone, WB.PHONE_HINT);
        ok = false;
      }
      if (!password.value) {
        WB.setFieldError(password, 'Enter your password.');
        ok = false;
      }
      if (!ok) return WB.focusFirstInvalid(qs('#password-form'));

      const button = qs('#password-submit');
      WB.setBusy(button, true, 'Signing in…');
      try {
        const result = await WB.api.post('/auth/login', {
          phone: phone.value.trim(),
          password: password.value
        });
        WB.setSession(result.user);
        WB.toast(result.message, 'ok');
        go(destination());
      } catch (err) {
        WB.showNote(errorBox, err.message, 'error');
        WB.setBusy(button, false);
      }
    });

    /* ---- one-time code ---- */
    let otpPhase = 'send';
    let challengeId = null;

    qs('#otp-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const phone = qs('#o-phone');
      const code = qs('#o-code');
      const button = qs('#otp-submit');
      WB.showNote(errorBox, '');

      if (otpPhase === 'send') {
        WB.clearFieldErrors(qs('#otp-form'));
        if (!WB.isValidPhone(phone.value)) {
          WB.setFieldError(phone, WB.PHONE_HINT);
          return WB.focusFirstInvalid(qs('#otp-form'));
        }
        WB.setBusy(button, true, 'Sending…');
        try {
          const result = await WB.api.post('/auth/otp/start', {
            phone: phone.value.trim(),
            purpose: 'login'
          });
          challengeId = result.challengeId;
          otpPhase = 'verify';
          qs('#otp-step-code').hidden = false;
          phone.readOnly = true;
          button.textContent = 'Sign in';
          qs('#otp-resend').hidden = false;
          WB.showNote(errorBox, result.message, 'ok');
          showDevCode(qs('#otp-hint'), result, 'code');
          startResendCountdown();
          code.focus();
        } catch (err) {
          WB.showNote(errorBox, err.message, 'error');
        } finally {
          WB.setBusy(button, false);
        }
        return;
      }

      WB.clearFieldErrors(qs('#otp-form'));
      if (!/^\d{6}$/.test(code.value.trim())) {
        WB.setFieldError(code, 'Enter the six-digit code from the SMS.');
        return WB.focusFirstInvalid(qs('#otp-form'));
      }
      WB.setBusy(button, true, 'Checking…');
      try {
        const result = await WB.api.post('/auth/otp/verify', {
          challengeId,
          code: code.value.trim()
        });
        WB.setSession(result.user);
        WB.toast(result.message, 'ok');
        go(destination());
      } catch (err) {
        WB.showNote(errorBox, err.message, 'error');
        WB.setBusy(button, false);
      }
    });

    const resend = qs('#otp-resend');
    function startResendCountdown() {
      const seconds = (WB.ui.config.security && WB.ui.config.security.otpResendCooldownSeconds) || 60;
      let left = seconds;
      resend.disabled = true;
      resend.textContent = `Send a new code in ${left}s`;
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          resend.disabled = false;
          resend.textContent = 'Send a new code';
          return;
        }
        resend.textContent = `Send a new code in ${left}s`;
      }, 1000);
    }

    resend.addEventListener('click', async () => {
      WB.showNote(errorBox, '');
      try {
        const result = await WB.api.post('/auth/otp/start', {
          phone: qs('#o-phone').value.trim(),
          purpose: 'login'
        });
        challengeId = result.challengeId;
        WB.showNote(errorBox, result.message, 'ok');
        showDevCode(qs('#otp-hint'), result, 'code');
        startResendCountdown();
      } catch (err) {
        WB.showNote(errorBox, err.message, 'error');
      }
    });
  }

  /* =======================================================================
     Register
     ======================================================================= */

  if (page === 'register') {
    const errorBox = qs('#register-error');
    const form = qs('#register-form');

    // Carried over from a guest checkout, so nothing is typed twice.
    if (params.get('phone')) qs('#r-phone').value = params.get('phone');
    if (params.get('name')) qs('#r-name').value = params.get('name');
    if (params.get('address')) qs('#r-address').value = params.get('address');
    const minLength = (WB.ui.config.security && WB.ui.config.security.minPasswordLength) || 8;
    const help = qs('#password-help');
    if (help) help.textContent = `At least ${minLength} characters, with one letter and one number.`;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      WB.clearFieldErrors(form);
      WB.showNote(errorBox, '');

      const name = qs('#r-name');
      const phone = qs('#r-phone');
      const password = qs('#r-password');
      const password2 = qs('#r-password2');
      const terms = qs('#r-terms');
      let ok = true;

      if (name.value.trim().length < 2) {
        WB.setFieldError(name, 'Tell us your name.');
        ok = false;
      }
      if (!WB.isValidPhone(phone.value)) {
        WB.setFieldError(phone, WB.PHONE_HINT);
        ok = false;
      }
      if (password.value.length < minLength) {
        WB.setFieldError(password, `Use at least ${minLength} characters.`);
        ok = false;
      } else if (!/[A-Za-z]/.test(password.value) || !/\d/.test(password.value)) {
        WB.setFieldError(password, 'Include at least one letter and one number.');
        ok = false;
      }
      if (password2.value !== password.value) {
        WB.setFieldError(password2, 'The two passwords do not match.');
        ok = false;
      }
      if (!terms.checked) {
        WB.showNote(errorBox, 'Please agree to us storing your details so we can fulfil your orders.', 'error');
        ok = false;
      }
      if (!ok) return WB.focusFirstInvalid(form);

      const button = qs('#register-submit');
      WB.setBusy(button, true, 'Creating your account…');
      try {
        const result = await WB.api.post('/auth/register', {
          name: name.value.trim(),
          phone: phone.value.trim(),
          password: password.value,
          savedAddress: qs('#r-address').value.trim() || null,
          whatsappOptIn: qs('#r-whatsapp').checked
        });
        WB.setSession(result.user);
        WB.toast(result.message, 'ok');
        go(destination());
      } catch (err) {
        if (err.code === 'phone_taken') {
          WB.showNote(
            errorBox,
            `${WB.esc(err.message)} <a href="/login?phone=${encodeURIComponent(phone.value.trim())}">Sign in instead</a> · <a href="/forgot-password">Reset your password</a>`,
            'error'
          );
        } else {
          WB.showNote(errorBox, err.message, 'error');
        }
        WB.setBusy(button, false);
      }
    });
  }

  /* =======================================================================
     Forgot password — start recovery, verify by code, set a new password
     ======================================================================= */

  if (page === 'forgot') {
    const errorBox = qs('#forgot-error');
    const infoBox = qs('#forgot-info');
    const panels = {
      ask: qs('#panel-ask'),
      code: qs('#panel-code'),
      new: qs('#panel-new'),
      done: qs('#panel-done')
    };
    const steps = { ask: qs('#step-ask'), code: qs('#step-code'), new: qs('#step-new') };

    let channel = 'sms';
    let challengeId = null;
    let enteredCode = null;

    function showPanel(name) {
      for (const [key, node] of Object.entries(panels)) node.hidden = key !== name;
      const order = ['ask', 'code', 'new'];
      const index = order.indexOf(name);
      order.forEach((key, i) => {
        steps[key].classList.toggle('active', i === index);
        steps[key].classList.toggle('done', i < index);
      });
      WB.showNote(errorBox, '');
    }

    const tabSms = qs('#tab-sms');
    const tabEmail = qs('#tab-email');
    function selectChannel(which) {
      channel = which;
      tabSms.setAttribute('aria-selected', String(which === 'sms'));
      tabEmail.setAttribute('aria-selected', String(which === 'email'));
      qs('#sms-fields').hidden = which !== 'sms';
      qs('#email-fields').hidden = which === 'sms';
      WB.showNote(errorBox, '');
    }
    tabSms.addEventListener('click', () => selectChannel('sms'));
    tabEmail.addEventListener('click', () => selectChannel('email'));

    if (params.get('channel') === 'email') selectChannel('email');
    if (params.get('phone')) qs('#f-phone').value = params.get('phone');

    qs('#ask-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      WB.clearFieldErrors(qs('#ask-form'));
      WB.showNote(errorBox, '');
      WB.showNote(infoBox, '');

      const identifier = channel === 'sms' ? qs('#f-phone') : qs('#f-email');
      if (channel === 'sms' && !WB.isValidPhone(identifier.value)) {
        WB.setFieldError(identifier, WB.PHONE_HINT);
        return WB.focusFirstInvalid(qs('#ask-form'));
      }
      if (channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier.value.trim())) {
        WB.setFieldError(identifier, 'Enter the email address on your account.');
        return WB.focusFirstInvalid(qs('#ask-form'));
      }

      const button = qs('#ask-submit');
      WB.setBusy(button, true, 'Sending…');
      try {
        const result = await WB.api.post('/auth/reset/start', {
          identifier: identifier.value.trim(),
          channel
        });
        WB.showNote(infoBox, result.message, 'ok');

        if (channel === 'email') {
          // Nothing more to do here: the link in the email opens /reset-password.
          WB.setBusy(button, false);
          return;
        }

        challengeId = result.challengeId;
        showDevCode(qs('#code-hint'), result, 'code');
        showPanel('code');
        qs('#f-code').focus();
      } catch (err) {
        WB.showNote(errorBox, err.message, 'error');
      } finally {
        WB.setBusy(button, false);
      }
    });

    qs('#code-form').addEventListener('submit', (event) => {
      event.preventDefault();
      WB.clearFieldErrors(qs('#code-form'));
      const code = qs('#f-code');
      if (!/^\d{6}$/.test(code.value.trim())) {
        WB.setFieldError(code, 'Enter the six-digit code from the SMS.');
        return WB.focusFirstInvalid(qs('#code-form'));
      }
      enteredCode = code.value.trim();
      showPanel('new');
      qs('#f-new').focus();
    });

    qs('#code-restart').addEventListener('click', () => {
      challengeId = null;
      enteredCode = null;
      qs('#f-code').value = '';
      WB.showNote(infoBox, '');
      showPanel('ask');
    });

    qs('#new-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      WB.clearFieldErrors(qs('#new-form'));
      const password = qs('#f-new');
      const password2 = qs('#f-new2');
      const minLength = (WB.ui.config.security && WB.ui.config.security.minPasswordLength) || 8;
      let ok = true;

      if (password.value.length < minLength) {
        WB.setFieldError(password, `Use at least ${minLength} characters.`);
        ok = false;
      } else if (!/[A-Za-z]/.test(password.value) || !/\d/.test(password.value)) {
        WB.setFieldError(password, 'Include at least one letter and one number.');
        ok = false;
      }
      if (password2.value !== password.value) {
        WB.setFieldError(password2, 'The two passwords do not match.');
        ok = false;
      }
      if (!ok) return WB.focusFirstInvalid(qs('#new-form'));

      const button = qs('#new-submit');
      WB.setBusy(button, true, 'Saving…');
      try {
        await WB.api.post('/auth/reset/confirm', {
          channel: 'sms',
          challengeId,
          code: enteredCode,
          newPassword: password.value
        });
        qs('#to-login').setAttribute('href', `/login?phone=${encodeURIComponent(qs('#f-phone').value.trim())}`);
        showPanel('done');
      } catch (err) {
        WB.setBusy(button, false);
        if (['otp_mismatch', 'otp_expired', 'otp_unknown', 'otp_used', 'otp_attempts_exceeded'].includes(err.code)) {
          WB.showNote(errorBox, `${err.message} Start again to get a fresh code.`, 'error');
          showPanel('code');
          return;
        }
        WB.showNote(errorBox, err.message, 'error');
      }
    });
  }

  /* =======================================================================
     Reset password — the landing page for an emailed link, or an SMS code
     ======================================================================= */

  if (page === 'reset') {
    const errorBox = qs('#reset-error');
    const infoBox = qs('#reset-info');
    const linkForm = qs('#link-form');
    const smsForm = qs('#sms-form');
    const noContext = qs('#no-context');

    const resetId = params.get('id');
    const token = params.get('token');
    const phone = params.get('phone');
    const hasLink = Boolean(resetId && token);

    if (hasLink) {
      linkForm.hidden = false;
    } else if (phone || params.get('challenge')) {
      smsForm.hidden = false;
      if (phone) qs('#n-phone').value = phone;
    } else {
      noContext.hidden = false;
    }

    const minLength = (WB.ui.config.security && WB.ui.config.security.minPasswordLength) || 8;

    /** Shared client-side password checks for both modes. */
    function validatePasswords(password, password2, form) {
      WB.clearFieldErrors(form);
      let ok = true;
      if (password.value.length < minLength) {
        WB.setFieldError(password, `Use at least ${minLength} characters.`);
        ok = false;
      } else if (!/[A-Za-z]/.test(password.value) || !/\d/.test(password.value)) {
        WB.setFieldError(password, 'Include at least one letter and one number.');
        ok = false;
      }
      if (password2.value !== password.value) {
        WB.setFieldError(password2, 'The two passwords do not match.');
        ok = false;
      }
      if (!ok) WB.focusFirstInvalid(form);
      return ok;
    }

    linkForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = qs('#n-password');
      const password2 = qs('#n-password2');
      if (!validatePasswords(password, password2, linkForm)) return;
      WB.showNote(errorBox, '');

      const button = qs('#link-submit');
      WB.setBusy(button, true, 'Saving…');
      try {
        const result = await WB.api.post('/auth/reset/confirm', {
          channel: 'email',
          resetId,
          token,
          newPassword: password.value
        });
        WB.showNote(infoBox, result.message, 'ok');
        linkForm.replaceChildren(
          WB.el('a', { class: 'btn btn-primary btn-block', href: '/login', text: 'Go to sign in' })
        );
      } catch (err) {
        WB.showNote(errorBox, err.message, 'error');
        WB.setBusy(button, false);
      }
    });

    smsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const phoneInput = qs('#n-phone');
      const code = qs('#n-code');
      const password = qs('#n-new');
      WB.showNote(errorBox, '');

      if (!WB.isValidPhone(phoneInput.value)) {
        WB.setFieldError(phoneInput, WB.PHONE_HINT);
        return WB.focusFirstInvalid(smsForm);
      }
      if (!/^\d{6}$/.test(code.value.trim())) {
        WB.setFieldError(code, 'Enter the six-digit code from the SMS.');
        return WB.focusFirstInvalid(smsForm);
      }
      WB.clearFieldErrors(smsForm);

      const minLengthValue = minLength;
      if (password.value.length < minLengthValue) {
        WB.setFieldError(password, `Use at least ${minLengthValue} characters.`);
        return WB.focusFirstInvalid(smsForm);
      }

      const button = qs('#sms-submit');
      WB.setBusy(button, true, 'Saving…');
      try {
        const result = await WB.api.post('/auth/reset/confirm', {
          channel: 'sms',
          identifier: phoneInput.value.trim(),
          challengeId: params.get('challenge') || null,
          code: code.value.trim(),
          newPassword: password.value
        });
        WB.showNote(infoBox, result.message, 'ok');
        smsForm.replaceChildren(
          WB.el('a', {
            class: 'btn btn-primary btn-block',
            href: `/login?phone=${encodeURIComponent(phoneInput.value.trim())}`,
         