// ui.js — small DOM helpers every page shares: building elements, dates in
// words, menus, dialogs and toasts.

// h('button', { class: 'btn', onclick }, 'Save') → <button class="btn">Save</button>
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);

// 30 → "30m", 75 → "1h 15m", 120 → "2h"
function fmtMin(min) {
  min = Math.round(min);
  if (min < 60) return `${min}m`;
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

const dayDiff = (a, b) => Math.round((nyParseDs(hwTodayStr(b)) - nyParseDs(hwTodayStr(a))) / 86400000);

// "Today", "Tomorrow", "In 3 days", "Yesterday", "4 days ago"
function relDay(date, now = new Date()) {
  const n = dayDiff(now, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

const fmtWeekday = d => d.toLocaleDateString(undefined, { weekday: 'long' });
const fmtShortDay = d => d.toLocaleDateString(undefined, { weekday: 'short' });
const fmtMonthDay = d => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
const fmtMonth = d => d.toLocaleDateString(undefined, { month: 'long' });

// First day of the week for this person's locale: 1 = Monday, 7 = Sunday.
function weekStartsOn() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
    if (info && info.firstDay) return info.firstDay;
  } catch {}
  return 1;
}

// Colour variables for a subject: --hl (fill) and --c (dot).
function subjectVars(id) {
  const c = nyColorCss(nySubject(id).color);
  return { '--hl': c.hl, '--c': c.dot };
}
function setVars(el, vars) { for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v); return el; }

// ── Menu ────────────────────────────────────────────────────────────────────
// items: [{ label, icon, onClick, danger, dot }] or 'sep'
let openMenuEl = null;
function closeMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove(); openMenuEl = null;
  document.removeEventListener('mousedown', onMenuOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
}
// A press outside closes it. Pressing the button that opened it closes it too,
// and the click that follows mustn't open it again.
function onMenuOutside(e) {
  if (!openMenuEl || openMenuEl.contains(e.target)) return;
  const a = openMenuEl._anchor;
  closeMenu();
  if (!a || !a.contains(e.target)) return;
  const swallow = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
  a.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => a.removeEventListener('click', swallow, { capture: true }), 700);   // a press with no click
}
function onMenuKey(e) {
  if (!openMenuEl) return;
  if (e.key === 'Escape') { e.preventDefault(); const back = openMenuEl._anchor; closeMenu(); back && back.focus(); return; }
  if (!openMenuEl.matches('.menu')) {                // a popover: Tab stays inside, its own keys do the rest
    if (e.key !== 'Tab') return;
    const f = [...openMenuEl.querySelectorAll('button:not([tabindex="-1"])')];
    e.preventDefault();
    f[(f.indexOf(document.activeElement) + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    return;
  }
  const items = [...openMenuEl.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Tab') closeMenu();
}
// Shows a floating panel by its anchor: below it, or above when there's no
// room. A click elsewhere or Escape takes it down again, as does closeMenu().
// Below the anchor, lined up with its right edge, or its left edge with { start: true } (chips at the left of a form)
function openPop(anchor, el, { start = false } = {}) {
  closeMenu();
  el._anchor = anchor;
  document.body.append(el);
  const r = anchor.getBoundingClientRect(), m = el.getBoundingClientRect();
  let x = start ? Math.min(r.left, innerWidth - 8 - m.width) : r.right - m.width, y = r.bottom + 6;
  if (x < 8) x = 8;
  if (y + m.height > innerHeight - 8) y = Math.max(8, r.top - m.height - 6);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  openMenuEl = el;
  setTimeout(() => {
    document.addEventListener('mousedown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
  });
}
// One of the app's own pickers: a list to click, with a field to type into
// when `parse` is given (text → a value, or null). options: [[value, label]].
// Arrow keys move through the list; Enter in the field takes what's typed.
function nyListPop(anchor, { options, current, onPick, label, placeholder = '', parse = null, start = false, matchWidth = false }) {
  const list = h('div', { class: 'tp-list', role: 'listbox', 'aria-label': label });
  const pick = v => { closeMenu(); onPick(v); };
  const isCur = v => String(v) === String(current);
  for (const [v, text] of options) list.append(h('button', { type: 'button', role: 'option', class: 'tp-opt' + (isCur(v) ? ' sel' : ''),
    tabindex: '-1', 'aria-selected': String(isCur(v)), onclick: () => pick(v) }, h('span', { text })));
  const input = parse ? h('input', { class: 'input input-sm', type: 'text', placeholder, 'aria-label': placeholder || label, autocomplete: 'off' }) : null;
  const pop = h('div', { class: 'time-pop' + (parse ? '' : ' no-type'), role: 'dialog', 'aria-label': label }, ...(input ? [input] : []), list);
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = parse(input.value); if (v != null) pick(v); else input.classList.add('bad'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); (list.querySelector('.sel') || list.firstChild)?.focus(); }
    });
    input.addEventListener('input', () => input.classList.remove('bad'));
  }
  list.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const opts = [...list.children], i = opts.indexOf(document.activeElement);
    if (i === 0 && e.key === 'ArrowUp' && input) { input.focus(); return; }
    opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  if (matchWidth) pop.style.width = Math.max(210, anchor.offsetWidth) + 'px';   // a dropdown is as wide as its button
  openPop(anchor, pop, { start });
  const sel = list.querySelector('.sel');
  if (sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
  (input || sel || list.firstChild)?.focus();
}

// A few choices as chips in a grid, with a field to type into when `parse`
// is given. options: [[value, label, wide?]]. Arrow keys move around the grid.
function nyChipPop(anchor, { options, current, onPick, label, placeholder = '', parse = null, cols = 3, start = false, typed = '' }) {
  const pick = v => { closeMenu(); onPick(v); };
  const isCur = v => String(v) === String(current);
  const grid = setVars(h('div', { class: 'chip-grid', role: 'listbox', 'aria-label': label },
    ...options.map(([v, text, wide]) => h('button', { type: 'button', role: 'option', class: 'cg-opt' + (isCur(v) ? ' sel' : '') + (wide ? ' wide' : ''),
      'aria-selected': String(isCur(v)), onclick: () => pick(v) }, text))), { '--cols': cols });
  const input = parse ? nyTypeField(placeholder || label, parse, pick, grid) : null;
  nyGridKeys(grid, cols);
  openPop(anchor, h('div', { class: 'time-pop chip-pop', role: 'dialog', 'aria-label': label }, ...(input ? [input] : []), grid), { start });
  if (input && typed) { input.value = typed; input.select(); }
  (input || grid.querySelector('.sel') || grid.firstChild)?.focus();
}

// The typing field at the top of a picker: Enter takes what's typed, ↓ goes to the choices.
function nyTypeField(placeholder, parse, pick, choices) {
  const input = h('input', { class: 'input input-sm', type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const v = parse(input.value); if (v != null) pick(v); else input.classList.add('bad'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); (choices.querySelector('.sel') || choices.querySelector('button:not([disabled])'))?.focus(); }
  });
  input.addEventListener('input', () => input.classList.remove('bad'));
  return input;
}

// Arrow keys around a grid of buttons, `cols` wide.
function nyGridKeys(grid, cols) {
  grid.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (!step) return;
    const opts = [...grid.querySelectorAll('button:not([disabled])')], i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    opts[Math.max(0, Math.min(opts.length - 1, i + step))].focus();
  });
}

// A length in minutes: the common ones as chips, or type one ("1h 20m"). A
// length that isn't a chip waits in the field, selected, so the grid stays 3 × 3.
// `none` adds a first, full-width choice that clears it (a habit's timer).
const NY_LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
function nyLengthPop(anchor, current, { onPick, label = 'Length', none = null, start = false }) {
  nyChipPop(anchor, { options: [...(none ? [[null, none, true]] : []), ...NY_LENGTHS.map(m => [m, fmtMin(m)])], current,
    onPick, label, placeholder: 'Type a length', parse: nyParseLength, start,
    typed: current && !NY_LENGTHS.includes(current) ? fmtMin(current) : '' });
}

// What a calendar event starts with to become a task: an emoji from the grid,
// or type a word ("HW").
const NY_MARKS = ['📝', '📚', '📖', '✍️', '🧪', '🔬', '🧮', '📐', '💻', '🎹', '🎨', '🗣️', '🌍', '🏃', '🧠', '📊', '✏️', '⭐'];
function nyMarkPop(anchor, current, { onPick, start = true }) {
  nyChipPop(anchor, { options: NY_MARKS.map(m => [m, m]), current, onPick, label: 'Starts with', placeholder: 'Or type a word, like HW',
    parse: t => { t = t.trim(); return t && t.length <= 12 ? t : null; }, cols: 6, start,
    typed: current && !NY_MARKS.includes(current) ? current : '' });
  document.querySelector('.chip-pop')?.classList.add('mark-pop');
}

// A time: a row of hours, then :00 :15 :30 :45, or type one. Picking an hour
// keeps the minutes and stays open; picking the minutes closes it. `hours` are
// minute values (past 1440 is after midnight); `allowed(m)` rules times out;
// `note(m)` is a line under it (an event's length).
function nyClockPop(anchor, current, { hours, onPick, label, parse, allowed = () => true, note = null, start = false }) {
  let value = current;
  const hourOf = v => hours.find(x => v >= x && v < x + 60) ?? hours[0];
  const hourText = m => new Date(2000, 0, 1, 0, m).toLocaleTimeString([], { hour: 'numeric' });
  const hourGrid = h('div', { class: 'chip-grid', role: 'listbox', 'aria-label': 'Hour' });
  const minRow = h('div', { class: 'chip-grid mins', role: 'listbox', 'aria-label': 'Minutes' });
  const noteEl = note ? h('p', { class: 'cg-note' }) : null;
  const cols = hours.length > 12 ? 6 : 5;
  setVars(hourGrid, { '--cols': cols }); setVars(minRow, { '--cols': 4 });
  const firstAllowed = x => [0, 15, 30, 45].map(mm => x + mm).find(allowed);
  const draw = () => {
    const hr = hourOf(value), mm = value - hr;
    hourGrid.replaceChildren(...hours.map(x => {
      const ok = firstAllowed(x) != null, sel = x === hr;
      return h('button', { type: 'button', role: 'option', class: 'cg-opt' + (sel ? ' sel' : ''), 'aria-selected': String(sel), disabled: !ok,
        onclick: () => {                              // the hour is set; the minutes are next
          value = allowed(x + mm) ? x + mm : firstAllowed(x); onPick(value); draw();
          minRow.classList.remove('next'); void minRow.offsetWidth; minRow.classList.add('next');
          (minRow.querySelector('.sel:not([disabled])') || minRow.querySelector('button:not([disabled])'))?.focus();
        } },
        hourText(x));
    }));
    minRow.replaceChildren(...[0, 15, 30, 45].map(m => {
      const v = hr + m, sel = m === mm;
      return h('button', { type: 'button', role: 'option', class: 'cg-opt' + (sel ? ' sel' : ''), 'aria-selected': String(sel), disabled: !allowed(v),
        onclick: () => { closeMenu(); onPick(v); } }, ':' + String(m).padStart(2, '0'));
    }));
    if (noteEl) noteEl.textContent = note(value);
  };
  const input = nyTypeField('Type a time', parse, v => { closeMenu(); onPick(v); }, hourGrid);
  nyGridKeys(hourGrid, cols); nyGridKeys(minRow, 4);
  draw();
  openPop(anchor, h('div', { class: 'time-pop chip-pop clock-pop', role: 'dialog', 'aria-label': label }, input, hourGrid, minRow, ...(noteEl ? [noteEl] : [])), { start });
  input.focus();
}

// Times from `from` to `to` minutes (past 1440 is after midnight), every 15.
const nyCapFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const nyTimeOptions = (from, to, step = 15) => Array.from({ length: Math.floor((to - from) / step) + 1 },
  (_, i) => [from + i * step, nyCapFirst(nyClockMin(from + i * step))]);
const nyHours = (from, to) => Array.from({ length: Math.floor(to / 60) - Math.floor(from / 60) + 1 }, (_, i) => (Math.floor(from / 60) + i) * 60);
const nyTimeParse = (from, to) => text => {
  let m = nyParseTime(text);
  if (m == null) return null;
  if (m < from) m += 1440;                            // "1am" for a bedtime is after midnight
  return m >= from && m <= to ? m : null;
};

// Turns a button into a picker that behaves like a <select>: .value, and a
// change event when something is picked. `parse` adds the typing field.
function nyChoice(btn, { options, label, placeholder = '', parse = null, start = true, clock = null, length = false }) {
  let value = '';
  const opts = () => typeof options === 'function' ? options() : options;
  const draw = () => {
    const o = length ? null : opts().find(([v]) => String(v) === value), text = length ? fmtMin(+value) : o ? o[1] : value;
    btn.replaceChildren(h('span', { text }), icon('down', 14));
    btn.setAttribute('aria-label', `${label}: ${text}. Change`);
  };
  Object.defineProperty(btn, 'value', { configurable: true, get: () => value, set: v => { value = String(v); draw(); } });
  btn.type = 'button';
  btn.classList.add('pick-btn');
  btn.setAttribute('aria-haspopup', 'dialog');
  const set = v => { value = String(v); draw(); btn.dispatchEvent(new Event('change', { bubbles: true })); };
  btn.addEventListener('click', () => length ? nyLengthPop(btn, +value, { label, onPick: set, start }) : clock
    ? nyClockPop(btn, +value, { hours: nyHours(clock.from, clock.to), label, parse: nyTimeParse(clock.from, clock.to),
        allowed: m => m >= clock.from && m <= clock.to, onPick: set, start })
    : nyListPop(btn, { options: opts(), current: value, label, placeholder, parse, start, matchWidth: true, onPick: set }));
  draw();
  return btn;
}

function openMenu(anchor, items, opts) {
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { menu.append(h('hr')); continue; }
    if (it.heading) { menu.append(h('div', { class: 'menu-head', role: 'presentation', text: it.heading, title: it.heading })); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', 'aria-label': it.aria },
      it.dot ? setVars(h('span', { class: 'dot' }), { '--c': it.dot }) : it.icon ? icon(it.icon, 17) : null,
      h('span', { text: it.label }));
    b.addEventListener('click', () => { closeMenu(); it.onClick(); });
    menu.append(b);
  }
  openPop(anchor, menu, opts);
  menu.querySelector('button')?.focus();
}

// ── Dialog ──────────────────────────────────────────────────────────────────
function confirmBox({ title, body = '', yes = 'OK', no = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const before = document.activeElement;
    const done = v => { scrim.remove(); document.removeEventListener('keydown', key, true); before && before.focus && before.focus(); resolve(v); };
    const yesBtn = h('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => done(true) }, yes);
    const scrim = h('div', { class: 'dialog-scrim', onmousedown: e => { if (e.target === scrim) done(false); } },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
        h('h2', { id: 'dlg-t', text: title }),
        body ? h('p', { text: body }) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => done(false) }, no), yesBtn)));
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    document.addEventListener('keydown', key, true);
    document.body.append(scrim);
    yesBtn.focus();
  });
}

// ── Toast ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(text, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = h('div', { class: 'toast', role: 'status' }, h('span', { text }));
  if (action) t.append(h('button', { type: 'button', class: 'btn', onclick: () => { t.remove(); action.onClick(); } }, action.label));
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), action ? 6000 : 2600);
}

// ── Appearance ──────────────────────────────────────────────────────────────
function nyApplyAppearance(cfg = NY_CFG) {
  const root = document.documentElement;
  if (cfg.theme === 'system') delete root.dataset.theme; else root.dataset.theme = cfg.theme;
  if (cfg.accent === 'lilac') delete root.dataset.accent; else root.dataset.accent = cfg.accent;
  try { localStorage.setItem('ny-theme', cfg.theme); localStorage.setItem('ny-accent', cfg.accent); } catch {}
}

// ── Everything a page needs to draw ─────────────────────────────────────────
async function nyLoadAll() {
  await nyLoadConfig();
  nyApplyAppearance();
  const store = await getStorage();
  const hw = await getHwState();
  const extra = await chrome.storage.local.get({
    hwActiveTimers: {}, stickyNotes: [], hwLastSync: 0, hwLastSyncError: '', nyDoneDays: {}, testPlans: {},
  });
  const cal = await calLoadRaw();
  return { cfg: NY_CFG, store, hw, timers: extra.hwActiveTimers, cal,
    notes: extra.stickyNotes, lastSync: extra.hwLastSync, syncError: extra.hwLastSyncError, doneDays: extra.nyDoneDays, testPlans: extra.testPlans };
}

// Re-run `fn` whenever storage changes, batching bursts into one call. A
// timeout, not requestAnimationFrame: background tabs (a lock screen you
// aren't looking at) never get animation frames.
function onStorage(fn) {
  let pending = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.length === 1 && keys[0] === 'ytGate') return;
    pending = Object.assign(pending || {}, changes);
    clearTimeout(onStorage.t);
    onStorage.t = setTimeout(() => { const c = pending; pending = null; fn(c); }, 30);
  });
}

// Another page of the extension: in this same tab, so Back works; the toolbar
// popup has no tab of its own, so from there it opens one (the caller closes the popup)
function openPage(path) {
  const url = chrome.runtime.getURL(path);
  if (location.pathname.endsWith('/popup.html')) chrome.tabs.create({ url });
  else location.assign(url);
}
