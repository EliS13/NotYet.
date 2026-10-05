// settings-kit.js — what every Settings section is made of: cards that show a
// thing and its current value, and the sheet a card opens to change it.

// A card's tile: an icon, a word or emoji, a letter on a colour, or an app's mark.
function nyTile(kind, value, { size = 40, dot = null, hl = null } = {}) {
  const tile = setVars(h('span', { class: 'sc-tile', 'aria-hidden': 'true' }), { '--s': size + 'px' });
  if (kind === 'icon') { tile.classList.add('is-icon'); tile.append(icon(value, Math.round(size * .46))); }
  else if (kind === 'text') {
    tile.classList.add(/^\p{Extended_Pictographic}/u.test(value) ? 'is-emoji' : 'is-word');
    tile.append(value || '＋');
  } else if (kind === 'color') {                   // a subject: just its colour
    tile.classList.add('is-color');
    setVars(tile, { '--c': dot, '--hl': hl });
  } else if (kind === 'app') {                      // a connected app: its drawn mark in its colour
    setVars(tile, { '--c': value.color });
    tile.classList.add('is-app');
    if (value.mark === 'google') { tile.classList.add('light'); tile.append(googleMark()); }
    else if (value.mark.length > 1) tile.append(icon(value.mark, Math.round(size * .5)));
    else tile.append(value.mark);
  }
  return tile;
}

// A card. `status` is [key, text] (on, warn, go, soon, wait); without `onOpen` it's not a button.
function nyCard({ tile, name, status = null, sub = '', onOpen = null, cls = '', label = null, id = null }) {
  const [key, text] = status || [];
  return h(onOpen ? 'button' : 'div', { type: onOpen ? 'button' : null, 'aria-label': label, 'data-card': id || name,
    class: 'sc-card' + (key ? ' is-' + key : '') + (cls ? ' ' + cls : ''), onclick: onOpen },
    tile, h('b', { class: 'sc-name', text: name }),
    text ? h('span', { class: 'sc-status is-' + key, text }) : null,
    sub ? h('span', { class: 'sc-sub', text: sub }) : null);
}

// The quiet dashed card that adds one more
function nyAddCard(label, onAdd) {
  return h('button', { type: 'button', class: 'sc-card sc-add', onclick: onAdd },
    h('span', { class: 'sc-tile is-add', 'aria-hidden': 'true' }, icon('plus', 18)), h('b', { class: 'sc-name', text: label }));
}

// True while someone is typing in `el`, so a redraw doesn't take their field away
function nyTyping(el) {
  const a = document.activeElement;
  return !!a && !!el && el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

// Sheets that are open, so a change made elsewhere can redraw them. Never
// mid-click (the button would be swapped between press and release) and never
// losing the keyboard's place: focus goes back to the same control.
const NY_SHEETS = new Set();
let nyPressing = false, nyRefreshLater = false;
addEventListener('pointerdown', () => { nyPressing = true; }, true);
addEventListener('pointerup', () => {
  nyPressing = false;
  if (nyRefreshLater) { nyRefreshLater = false; setTimeout(nyRefreshSheets, 0); }   // after the click lands
}, true);
async function nyRefreshSheets() {
  if (nyPressing) { nyRefreshLater = true; return; }
  for (const s of NY_SHEETS) {
    if (!s.refresh || nyTyping(s.box)) continue;
    const a = document.activeElement, key = a && s.box.contains(a) ? a.getAttribute('aria-label') || a.textContent : null;
    await s.refresh();
    if (key) [...s.box.querySelectorAll('button, input, [tabindex]')].find(x => (x.getAttribute('aria-label') || x.textContent) === key)?.focus();
  }
}

// A card's sheet: its tile and name, whatever the owner puts in `body`, a
// message line and Done. Set `refresh` to redraw it when storage changes.
function nySheet({ tile, name, status = null, wide = false }) {
  if (tile.isConnected) tile = tile.cloneNode(true);           // a card's own tile stays on the card
  setVars(tile, { '--s': '48px' });
  const opener = document.activeElement, openerId = opener && opener.dataset ? opener.dataset.card : null;
  const dlg = evDialog({ label: name, cls: 'sc-sheet' + (wide ? ' wide' : '') });
  const title = h('h2', { text: name, tabindex: '-1' }), st = h('span', { class: 'sc-status' });
  const body = h('div', { class: 'sc-sheet-body' }), msg = h('p', { class: 'sc-msg', role: 'status' });
  let head = tile;
  dlg.box.append(h('div', { class: 'sc-sheet-head' }, head, h('div', { class: 'sc-sheet-title' }, title, st)), body, msg,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => dlg.close() }, 'Done')));
  const sheet = {
    box: dlg.box, body, refresh: null, onClose: null,
    close: () => dlg.close(),
    say(text, bad = true) { msg.textContent = text; msg.classList.toggle('bad', bad); },
    setStatus(s) { st.hidden = !s; if (s) { st.className = 'sc-status is-' + s[0]; st.textContent = s[1]; } },
    setName(n) { title.textContent = n; },
    setTile(t) { head.replaceWith(t); head = t; },
  };
  sheet.setStatus(status);
  NY_SHEETS.add(sheet);
  dlg.onClose = () => {
    NY_SHEETS.delete(sheet);
    if (sheet.onClose) sheet.onClose();
    // Back to the card that opened it; an edit may have redrawn the grid, so find its twin
    if (opener && !opener.isConnected && openerId) document.querySelector(`[data-card="${CSS.escape(openerId)}"]`)?.focus();
  };
  requestAnimationFrame(() => {                   // the keyboard starts in the sheet (unless a picker it opened has it)
    if (!dlg.box.contains(document.activeElement) && !openMenuEl) title.focus({ preventScroll: true });
  });
  return sheet;
}

// A sheet that borrows a section's controls from their hidden holder and gives
// them back when it closes, so every control keeps its wiring.
function nyBorrow(id, { tile, name, status = null, wide = false }) {
  const el = document.getElementById(id), home = el.parentNode;
  const sheet = nySheet({ tile, name, status, wide });
  sheet.body.append(el);
  sheet.onClose = () => home.append(el);
  return sheet;
}

// A labelled line in a sheet: what it is (and a hint) on the left, the control on the right
function nySheetRow(label, control, hint = '') {
  return h('div', { class: 'sc-row' }, h('div', { class: 'sc-row-k' }, h('span', { text: label }), hint ? h('small', { text: hint }) : null), control);
}

// A switch, the way every Settings switch looks
function nySwitch(on, label, onFlip) {
  return h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: onFlip });
}
