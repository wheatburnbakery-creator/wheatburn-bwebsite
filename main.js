/* Wheatburn Bakery — small progressive enhancements.
   The site works fully without JavaScript. */

(function () {
  'use strict';

  /* --- mobile navigation ------------------------------------------------ */
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');

  if (header && toggle) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // close the menu after tapping a link
    header.querySelectorAll('.site-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        header.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('nav-open')) {
        header.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* --- product range filter (products page) ----------------------------- */
  var filters = document.querySelectorAll('.filter');

  if (filters.length) {
    var items = document.querySelectorAll('[data-category]');

    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        var want = button.getAttribute('data-filter');

        filters.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        button.setAttribute('aria-pressed', 'true');

        items.forEach(function (item) {
          var show = want === 'all' || item.getAttribute('data-category') === want;
          item.hidden = !show;
        });
      });
    });
  }

  /* --- enquiry forms ----------------------------------------------------
     There is no backend yet. By default each form falls back to a mailto:
     link so enquiries still reach the bakery inbox. Set data-endpoint on the
     <form> (see README) once a form service or backend is connected.        */
  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.getAttribute('data-endpoint')) return; // let the backend handle it

      e.preventDefault();

      var to = form.getAttribute('data-mailto') || 'mailto@example.com';
      var lines = [];
      var fields = form.querySelectorAll('input, select, textarea');

      fields.forEach(function (field) {
        if (field.type === 'submit' || !field.name) return;
        if (field.type === 'checkbox') {
          if (field.checked) lines.push(field.name + ': yes');
          return;
        }
        if (!field.value) return;
        lines.push(field.name + ': ' + field.value);
      });

      var subject = encodeURIComponent('Wheatburn enquiry — ' + (form.getAttribute('data-subject') || 'website'));
      var body = encodeURIComponent(lines.join('\n'));
      window.location.href = to + '?subject=' + subject + '&body=' + body;
    });
  });

  /* --- footer year ------------------------------------------------------ */
  document.querySelectorAll('[data-year]').forEach(function (node) {
    node.textContent = new Date().getFullYear();
  });
})();
