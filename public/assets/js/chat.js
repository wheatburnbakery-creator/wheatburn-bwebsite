(function () {
  if (window.__wbChat) return;
  window.__wbChat = true;

  var css = [
    '.wbc-btn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;height:48px;padding:0 18px;border:0;border-radius:999px;background:#a9501e;color:#fff;font-family:inherit;font-weight:600;font-size:14px;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}',
    '.wbc-win{position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));max-width:380px;height:min(70vh,480px);display:none;flex-direction:column;background:#fffdf9;color:#1f1813;border:1px solid rgba(31,24,19,.15);border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.25);z-index:60;overflow:hidden}',
    '.wbc-win.open{display:flex}',
    '.wbc-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#1f1813;color:#fff;font-weight:600;font-size:14px}',
    '.wbc-x{background:none;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer}',
    '.wbc-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}',
    '.wbc-msg{max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}',
    '.wbc-bot{background:#f3ece2;align-self:flex-start}',
    '.wbc-me{background:#a9501e;color:#fff;align-self:flex-end}',
    '.wbc-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(31,24,19,.12)}',
    '.wbc-in{flex:1;min-width:0;padding:10px 12px;border:1px solid rgba(31,24,19,.2);border-radius:999px;font-size:16px;font-family:inherit}',
    '.wbc-send,.wbc-link{padding:10px 16px;border:0;border-radius:999px;background:#a9501e;color:#fff;font-family:inherit;font-weight:600;font-size:14px;text-decoration:none;text-align:center;cursor:pointer}',
    '.wbc-link{flex:1}',
    '.wbc-link.alt{background:#1f1813}'
  ].join('');
  var st = document.createElement('link'); st.rel = 'stylesheet'; st.href = '/assets/css/chat.css';
  document.head.appendChild(st);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var state = { history: [], busy: false };
  var btn = el('button', 'wbc-btn', '\uD83D\uDCAC Chat');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Chat with the Wheatburn assistant');
  var win = el('div', 'wbc-win');
  win.setAttribute('role', 'dialog');
  var head = el('div', 'wbc-head');
  head.appendChild(el('span', null, 'Wheatburn assistant'));
  var x = el('button', 'wbc-x', '\u00D7');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close chat');
  head.appendChild(x);
  var log = el('div', 'wbc-log');
  log.setAttribute('aria-live', 'polite');
  var foot = el('div', 'wbc-foot');
  win.appendChild(head);
  win.appendChild(log);
  win.appendChild(foot);
  document.body.appendChild(win);
  document.body.appendChild(btn);

  function add(text, me) {
    var m = el('div', 'wbc-msg ' + (me ? 'wbc-me' : 'wbc-bot'), text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function showFallback(fb) {
    foot.textContent = '';
    var phone = (fb && fb.phone) || '';
    var wa = (fb && fb.whatsapp) || '';
    if (phone) {
      var c = el('a', 'wbc-link', 'Call us');
      c.href = 'tel:' + phone.replace(/[^+\d]/g, '');
      foot.appendChild(c);
    }
    if (wa) {
      var w = el('a', 'wbc-link alt', 'WhatsApp');
      w.href = 'https://wa.me/' + wa.replace(/\D/g, '');
      w.target = '_blank';
      w.rel = 'noopener';
      foot.appendChild(w);
    }
  }

  function showInput() {
    foot.textContent = '';
    var input = el('input', 'wbc-in');
    input.type = 'text';
    input.placeholder = 'Ask about the menu, delivery\u2026';
    input.maxLength = 500;
    input.setAttribute('aria-label', 'Your message');
    var send = el('button', 'wbc-send', 'Send');
    send.type = 'button';
    foot.appendChild(input);
    foot.appendChild(send);

    function go() {
      var text = input.value.trim();
      if (!text || state.busy) return;
      input.value = '';
      add(text, true);
      state.history.push({ role: 'user', content: text });
      state.busy = true;
      var wait = add('\u2026', false);
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation: state.history })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.reply) {
            wait.textContent = d.reply;
            state.history.push({ role: 'assistant', content: d.reply });
          } else {
            wait.textContent = (d && d.error) || 'Sorry, I could not answer just now. Please call or WhatsApp us.';
          }
        })
        .catch(function () {
          wait.textContent = 'Could not reach the shop. Check your connection and try again.';
        })
        .then(function () {
          state.busy = false;
          log.scrollTop = log.scrollHeight;
        });
    }
    send.onclick = go;
    input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    fetch('/api/chat/status')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        add(s.greeting || 'Murakaza neza! Ask us about the menu, delivery or payment.', false);
        if (s.enabled) {
          showInput();
        } else {
          add('The assistant is resting right now. Call or message us on WhatsApp and we will help.', false);
          showFallback(s.fallback);
        }
      })
      .catch(function () {
        loaded = false;
        add('Could not reach the shop. Please try again.', false);
      });
  }

  btn.onclick = function () {
    win.classList.toggle('open');
    if (win.classList.contains('open')) load();
  };
  x.onclick = function () { win.classList.remove('open'); };
})();
