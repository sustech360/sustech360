/* marks-ui.js — the formatting controls, in one place.
 *
 * Authors write in the portal, editors correct in the studio, and both need the
 * same buttons producing the same marks. Two implementations of that would
 * drift within a month — one of them would gain subscript and the other would
 * not — so there is one, and both load it.
 *
 * It attaches to any <textarea data-field="…"> it is pointed at, and tells the
 * caller when something changed so the surrounding screen can save however it
 * saves: the portal queues a changeset, the studio saves on a button.
 */
(function (global) {
  'use strict';

  var BUTTONS = [
    { mark: '**', label: 'B',   title: 'Bold — Ctrl+B',            css: 'is-bold' },
    { mark: '*',  label: 'I',   title: 'Italic — Ctrl+I',          css: 'is-italic' },
    { mark: '==', label: 'HL',  title: 'Highlight' },
    { mark: '^',  label: 'X²',  title: 'Superscript — Na^+^' },
    { mark: '~',  label: 'X₂',  title: 'Subscript — CO~2~' },
    { mark: '`',  label: '{ }', title: 'Code or a formula' }
  ];

  // Named rather than picked. A colour picker in an article editor produces a
  // publication where every writer has their own red.
  var TONES = [
    { name: 'accent', label: 'Accent', title: 'The house colour — a term being introduced' },
    { name: 'warn',   label: 'Caution', title: 'Amber — a caveat' },
    { name: 'muted',  label: 'Aside',  title: 'Grey — an aside' },
    { name: 'lead',   label: 'Larger', title: 'One step larger — an opening line' },
    { name: 'note',   label: 'Smaller', title: 'One step smaller — a note' }
  ];

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  function wrap(box, open, close) {
    close = close || open;
    var from = box.selectionStart, to = box.selectionEnd;
    var chosen = box.value.slice(from, to);
    box.value = box.value.slice(0, from) + open + chosen + close + box.value.slice(to);
    box.focus();
    if (chosen) box.setSelectionRange(from, to + open.length + close.length);
    else box.setSelectionRange(from + open.length, from + open.length);
  }

  /**
   * @param {Element} scope      where to look for textareas
   * @param {Object}  opts
   * @param {Function} opts.onChange  called with (field, value) after any edit
   * @param {Boolean}  opts.expand    offer a fill-the-screen button
   */
  function attach(scope, opts) {
    opts = opts || {};
    var changed = opts.onChange || function () {};

    scope.querySelectorAll('textarea[data-field]').forEach(function (box) {
      if (box.disabled || box.dataset.marked === '1') return;
      box.dataset.marked = '1';
      var field = box.getAttribute('data-field');
      var announce = function () { changed(field, box.value); };

      var bar = el('div', { class: 'marks' });

      BUTTONS.forEach(function (b) {
        var button = el('button', {
          type: 'button', class: 'marks__btn ' + (b.css || ''), title: b.title
        }, b.label);
        button.addEventListener('click', function () { wrap(box, b.mark); announce(); });
        bar.appendChild(button);
      });

      var tone = el('select', { class: 'marks__tone', title: 'Colour and size, from the house set' });
      tone.appendChild(el('option', { value: '' }, 'Style…'));
      TONES.forEach(function (t) { tone.appendChild(el('option', { value: t.name, title: t.title }, t.label)); });
      tone.addEventListener('change', function () {
        if (!tone.value) return;
        wrap(box, '{' + tone.value + ':', '}');
        tone.value = '';
        announce();
      });
      bar.appendChild(tone);

      var link = el('button', { type: 'button', class: 'marks__btn', title: 'Link' }, 'Link');
      link.addEventListener('click', function () {
        var chosen = box.value.slice(box.selectionStart, box.selectionEnd) || 'these words';
        var url = global.prompt('Link to (an https address):', 'https://');
        if (!url) return;
        if (!global.Marks || !Marks.safeHref(url)) {
          global.alert('Links must be https, or a page on this site.');
          return;
        }
        var from = box.selectionStart, to = box.selectionEnd;
        box.value = box.value.slice(0, from) + '[' + chosen + '](' + url + ')' + box.value.slice(to);
        announce();
      });
      bar.appendChild(link);

      bar.appendChild(el('span', { class: 'marks__gap' }));

      var preview = el('button', { type: 'button', class: 'marks__btn', title: 'See how it will read' }, 'Preview');
      var shown = el('div', { class: 'preview', hidden: 'hidden' });
      preview.addEventListener('click', function () {
        if (!shown.hasAttribute('hidden')) { shown.setAttribute('hidden', 'hidden'); return; }
        shown.removeAttribute('hidden');
        if (global.Marks) Marks.into(shown, box.value.split(/\n{2,}/)[0] || '');
      });
      bar.appendChild(preview);

      if (opts.expand !== false) {
        var full = el('button', { type: 'button', class: 'marks__btn', title: 'Fill the screen — Esc to come back' }, 'Expand');
        full.addEventListener('click', function () {
          var on = box.classList.toggle('is-full');
          document.body.classList.toggle('writing-full', on);
          if (on) box.focus();
        });
        bar.appendChild(full);
      }

      box.parentNode.insertBefore(bar, box);
      box.parentNode.insertBefore(shown, box.nextSibling);

      box.addEventListener('input', announce);
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && box.classList.contains('is-full')) {
          box.classList.remove('is-full');
          document.body.classList.remove('writing-full');
          return;
        }
        if (!(e.ctrlKey || e.metaKey)) return;
        var key = String(e.key).toLowerCase();
        var mark = key === 'b' ? '**' : (key === 'i' ? '*' : null);
        if (!mark) return;
        e.preventDefault();
        wrap(box, mark);
        announce();
      });
    });
  }

  global.MarksUI = { attach: attach, TONES: TONES, BUTTONS: BUTTONS };
})(typeof window !== 'undefined' ? window : globalThis);
