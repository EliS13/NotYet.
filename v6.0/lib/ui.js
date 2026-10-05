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
  const c = nySubject(id).color || 'stone';
  return { '--hl': `var(--hl-${c})`, '--c': `var(--dot-${c})` };
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
function onMenuOutside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
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
function openPop(anchor, el) {
  closeMenu();
  el._anchor = anchor;
  document.body.append(el);
  const r = anchor.getBoundingClientRect(), m = el.getBoundingClientRect();
  let x = r.right - m.width, y = r.bottom + 6;
  if (x < 8) x = 8;
  if (y + m.height > innerHeight - 8) y = Math.max(8, r.top - m.height - 6);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  openMenuEl = el;
  setTimeout(() => {
    document.addEventListener('mousedown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
  });
}
function openMenu(anchor, items) {
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { menu.append(h('hr')); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '' },
      it.dot ? setVars(h('span', { class: 'dot' }), { '--c': it.dot }) : it.icon ? icon(it.icon, 17) : null,
      h('span', { text: it.label }));
    b.addEventListener('click', () => { closeMenu(); it.onClick(); });
    menu.append(b);
  }
  openPop(anchor, menu);
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

// ── Back to the top ─────────────────────────────────────────────────────────
// A round arrow that shows once you've scrolled down and glides back up.
// For the whole page it's fixed in the corner; inside a scrolling box it rides
// along the box's bottom edge (the box re-adds it with `.attach()` after it
// redraws its children).
function topButton(scroller = window) {
  const page = scroller === window;
  const btn = h('button', { type: 'button', class: 'to-top', 'aria-label': 'Back to the top', title: 'Back to the top', hidden: true }, icon('up', 18));
  const holder = page ? btn : h('div', { class: 'to-top-rail' }, btn);
  const y = () => page ? scrollY : scroller.scrollTop;
  const room = () => page ? innerHeight : scroller.clientHeight;
  const update = () => { btn.hidden = y() < Math.min(300, room() * 0.35); };
  btn.addEventListener('click', () => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  });
  scroller.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  const attach = () => { (page ? document.body : scroller).append(holder); update(); };
  attach();
  return { attach, update };
}

// ── Everything a page needs to draw ─────────────────────────────────────────
async function nyLoadAll() {
  await nyLoadConfig();
  nyApplyAppearance();
  const store = await getStorage();
  const hw = await getHwState();
  const extra = await chrome.storage.local.get({
    hwActiveTimers: {}, calAgenda: {}, stickyNotes: [], hwLastSync: 0, hwLastSyncError: '',
  });
  return { cfg: NY_CFG, store, hw, timers: extra.hwActiveTimers, agenda: extra.calAgenda,
    notes: extra.stickyNotes, lastSync: extra.hwLastSync, syncError: extra.hwLastSyncError };
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

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}
