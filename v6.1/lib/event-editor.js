// event-editor.js — the event window and the small dialogs around it and
// around signing in with Google. Shared by the popup, the full planner,
// Settings and first-time setup.

// A dialog in the app's style. Escape and a click outside close it; while a
// menu inside is open, or another dialog sits on top, they leave it be. Tab
// stays inside.
function evDialog({ label, cls = '' }) {
  const before = document.activeElement;
  const box = h('div', { class: 'dialog ev-dialog ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const scrim = h('div', { class: 'dialog-scrim', onmousedown: e => { if (e.target === scrim) close(); } }, box);
  const onTop = () => { const all = document.querySelectorAll('.dialog-scrim'); return all[all.length - 1] === scrim; };
  const key = e => {
    if (openMenuEl || !onTop()) return;
    if (e.key === 'Escape') {
      if (e.target && e.target.closest && e.target.closest('[data-escape="local"]')) return;   // a field that uses Escape itself
      e.preventDefault(); close(); return;
    }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not(:disabled), input, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (!box.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  const dlg = { box, onClose: null, close };
  function close(result) {
    if (!scrim.isConnected) return;
    scrim.remove();
    document.removeEventListener('keydown', key, true);
    if (before && before.focus) before.focus();
    if (dlg.onClose) dlg.onClose(result);
  }
  document.addEventListener('keydown', key, true);
  document.body.append(scrim);
  return dlg;
}

// A message with one button.
function evNotice(title, text) {
  return new Promise(resolve => {
    const dlg = evDialog({ label: title, cls: 'ev-small' });
    dlg.onClose = () => resolve();
    dlg.box.append(h('h2', { text: title }), h('p', { text }),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'OK')));
    dlg.box.querySelector('.btn').focus();
  });
}

// ── Google ──────────────────────────────────────────────────────────────────
// Google's "G", and a Sign in with Google button that follows Google's
// branding rules (neutral button, the G, those exact words).
const GOOGLE_G = '<svg class="g-mark" viewBox="0 0 48 48" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
  '</svg>';
function googleMark() { const t = document.createElement('template'); t.innerHTML = GOOGLE_G; return t.content.firstChild; }
function nyGoogleButton({ label = 'Sign in with Google', small = false, onclick, aria = null }) {
  return h('button', { type: 'button', class: 'g-btn' + (small ? ' sm' : ''), onclick, 'aria-label': aria }, googleMark(), h('span', { text: label }));
}

// The whole sign-in: Google's window, then choosing calendars (for an account
// just added), then the offer to move events saved only here. `email` signs in
// again to that account. Resolves what gcalSignIn did. A closed window says
// nothing; the caller shows its quiet line.
async function nyGoogleSignIn({ email = '' } = {}) {
  // The toolbar popup closes the moment Google's window takes focus, dropping the answer; Settings is a tab and stays
  if (location.pathname.endsWith('/popup.html')) { openPage('pages/settings.html?signin=1#connections'); window.close(); return { error: 'closed' }; }
  const r = await gcalSignIn({ email });
  if (r.error) {
    if (r.error !== 'closed') await evNotice('Google Calendar isn’t connected', GCAL_MESSAGES[r.error] || GCAL_MESSAGES.failed);
    return r;
  }
  if (r.added) await nyChooseCalendars(r.email);
  const raw = await calLoadRaw();
  if (raw.localEvents.length) await nyOfferMoveToGoogle(raw);
  calRefreshSources({ force: true }).catch(() => {});
  return r;
}

// "Choose your calendars": every calendar the account brings with a switch (one
// shared with an account already here shows there). Closing it any way keeps
// what's switched.
async function nyChooseCalendars(email) {
  const cals = gcalShown(await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [] })).filter(c => c.account === email);
  const on = Object.fromEntries(cals.map(c => [c.id, c.on]));
  return new Promise(resolve => {
    const dlg = evDialog({ label: 'Choose your calendars', cls: 'ev-choose' });
    dlg.onClose = async () => {
      for (const c of cals) if (on[c.id] !== c.on) await gcalSetCalendar(c.id, { on: on[c.id] });
      resolve();
    };
    dlg.box.append(
      h('h2', { text: 'Choose your calendars' }),
      h('p', { text: `From ${email}. Pick what shows in Not yet. You can change this any time in Settings.` }),
      h('div', { class: 'ev-cal-list' }, ...cals.map(c => {
        const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on[c.id]), 'aria-label': `Show ${c.name}`,
          onclick: () => { on[c.id] = !on[c.id]; sw.setAttribute('aria-checked', String(on[c.id])); } });
        return h('div', { class: 'ev-cal-row' }, setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${c.color})` }),
          h('span', { class: 'ev-cal-name' }, h('span', { text: c.name }), c.writable ? null : h('small', { text: 'view only' })), sw);
      })),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')));
    dlg.box.querySelector('.btn-primary').focus();
  });
}

// Events saved only in Not yet., offered a move to the calendar new events go to
// (the first account's main one when that's "Not yet. only").
async function nyOfferMoveToGoogle(raw) {
  const target = gcalShown(raw).find(c => c.writable && c.id === calDefaultCalendar(raw)) || gcalShown(raw).find(c => c.primary && c.writable);
  const n = raw.localEvents.length;
  if (!target || !n) return;
  const where = target.primary ? 'your Google Calendar' : target.name;
  const yes = await confirmBox({ title: `${n} event${n === 1 ? '' : 's'} saved only in Not yet.`,
    body: `Add ${n === 1 ? 'it' : 'them'} to ${where}, so ${n === 1 ? 'it’s' : 'they’re'} on your phone too?`, yes: n === 1 ? 'Add it' : 'Add them', no: 'Not now' });
  if (!yes) return;
  const { moved, failed } = await calMoveLocalToGoogle(target.id);
  toast(failed ? `Moved ${moved}. ${failed} couldn’t go to Google, so ${failed === 1 ? 'it stays' : 'they stay'} here.`
    : `Moved ${moved} event${moved === 1 ? '' : 's'} to Google Calendar`);
}

// ── Pieces of the event window ───────────────────────────────────────────────
// A start or end time: the app's clock picker (hours, then :00 :15 :30 :45, or
// type one). `after`: only times later than this (an end), with the length it makes.
function evTimePop(anchor, current, { after = null, onPick }) {
  const ok = m => after == null || m > after;
  const from = after == null ? 0 : Math.floor(after / 60);           // an end starts at the start's hour
  nyClockPop(anchor, current, { hours: Array.from({ length: 24 - from }, (_, i) => (from + i) * 60), onPick, start: true,
    label: after == null ? 'Start time' : 'End time', allowed: ok,
    parse: text => { const m = nyParseTime(text); return m != null && ok(m) ? m : null; },
    note: after == null ? null : m => `${fmtMin(m - after)} long` });
}

// "Just this one, or all of them?" Resolves 'one', 'all' or null (cancelled).
function evAskScope(verb) {
  return new Promise(resolve => {
    const dlg = evDialog({ label: `${verb} a repeating event`, cls: 'ev-small' });
    dlg.onClose = r => resolve(r || null);
    const del = verb === 'Delete';
    dlg.box.append(h('h2', { text: `${verb} a repeating event` }),
      h('p', { text: del ? 'Delete just this one, or every time it happens?' : 'Change just this one, or every time it happens?' }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => dlg.close(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close('one') }, 'Just this one'),
        h('button', { type: 'button', class: 'btn ' + (del ? 'btn-danger' : 'btn-primary'), onclick: () => dlg.close('all') }, 'All of them')));
    dlg.box.querySelectorAll('.btn')[1].focus();
  });
}

const evLine = (ic, ...kids) => h('div', { class: 'ev-line' }, h('span', { class: 'ev-ic', 'aria-hidden': 'true' }, icon(ic, 17)), ...kids);

// An event that can't be changed here: a secret link, or a view-only calendar.
function evDetails(ev) {
  const dlg = evDialog({ label: ev.title, cls: 'ev-read' });
  dlg.box.append(...[
    setVars(h('div', { class: 'ev-read-head' }, h('span', { class: 'ev-bar' }), h('h2', { text: ev.title })), { '--c': `var(--dot-${ev.color})` }),
    evLine('clock', h('span', { class: 'ev-text', text: calWhenLabel(ev) })),
    ev.place ? evLine('place', h('span', { class: 'ev-text', text: ev.place })) : null,
    ev.notes ? evLine('note', h('p', { class: 'ev-text ev-notes-read', text: ev.notes })) : null,
    evLine('calendar', h('span', { class: 'ev-text' }, `From ${ev.calendarName} · `, h('span', { class: 'ev-muted', text: 'view only' }))),
    h('div', { class: 'ev-foot' },
      ev.link ? h('a', { class: 'btn btn-quiet', href: ev.link, target: '_blank', rel: 'noopener' }, 'Open in Google Calendar') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Close')),
  ].filter(Boolean));                                   // no place or notes, no line
  dlg.box.querySelector('.btn-primary').focus();
}

// ── The event window ─────────────────────────────────────────────────────────
// ev: an event from calCollect to change, or null for a new one; draft: a new
// event's starting values ({ title, allDay, start, end, place, notes, repeat,
// calendarId }). raw: calendars (nyLoadAll().cal). pickDate(anchor, date,
// onPick): the planner's date popover. months: the months on screen, fetched
// again after saving. onSaved(): after a save or a delete.
function nyEventEditor({ ev = null, draft = null, raw, pickDate, months = [], onSaved = null }) {
  if (ev && !ev.editable) return evDetails(ev);
  let cals = calWritable(raw), signedIn = gcalSignedIn(raw);
  let d = ev
    ? { title: ev.title, allDay: ev.allDay, start: ev.start, end: ev.end, place: ev.place || '', notes: ev.notes || '', repeat: ev.repeat, calendarId: ev.calendarId }
    : { title: '', place: '', notes: '', repeat: null, ...draft, calendarId: (draft && draft.calendarId) || calDefaultCalendar(raw) };
  const googleSeries = !!ev && ev.source === 'google' && ev.recurring;
  let repeatKnown = !googleSeries, origRepeat = d.repeat || null;

  const dlg = evDialog({ label: ev ? 'Edit event' : 'New event' });
  const title = h('input', { class: 'ev-title', type: 'text', maxlength: '200', placeholder: 'Add a title', 'aria-label': 'Title' });
  title.value = d.title;
  const when = h('div', { class: 'ev-when' });
  const allDay = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-labelledby': 'ev-allday' });
  const repeatBtn = h('button', { type: 'button', class: 'ev-chip ev-repeat', 'aria-haspopup': 'menu' });
  const calBtn = h('button', { type: 'button', class: 'ev-chip ev-cal', 'aria-haspopup': 'menu' });
  const syncNote = h('div', { class: 'ev-note', hidden: true });
  const place = h('input', { class: 'ev-input', type: 'text', maxlength: '200', placeholder: 'Add a place', 'aria-label': 'Place' });
  place.value = d.place;
  const notes = h('textarea', { class: 'ev-input ev-notes', rows: '2', maxlength: '2000', placeholder: 'Add notes', 'aria-label': 'Notes' });
  notes.value = d.notes;
  const err = h('div', { class: 'ev-err', role: 'alert', hidden: true });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save() }, 'Save');
  const delBtn = ev ? h('button', { type: 'button', class: 'btn btn-danger', onclick: () => remove() }, 'Delete') : null;

  dlg.box.append(title,
    evLine('clock', when, h('span', { class: 'ev-allday' }, h('span', { id: 'ev-allday', text: 'All day' }), allDay)),
    evLine('repeat', repeatBtn),
    evLine('calendar', h('div', { class: 'ev-col' }, calBtn, syncNote)),
    evLine('place', place),
    evLine('note', notes),
    err,
    h('div', { class: 'ev-foot' }, delBtn, h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => dlg.close() }, 'Cancel'), saveBtn));

  const fmtDay = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const minsOf = t => { const x = new Date(t); return x.getHours() * 60 + x.getMinutes(); };
  const atMins = (t, m) => { const x = new Date(t); x.setHours(0, m, 0, 0); return x.getTime(); };
  const chip = (text, label, onclick) => h('button', { type: 'button', class: 'ev-chip', 'aria-label': label, onclick }, text);

  function drawWhen() {
    allDay.setAttribute('aria-checked', String(d.allDay));
    if (d.allDay) {
      const days = Math.max(1, Math.round((calDayMs(d.end) - calDayMs(d.start)) / 864e5)), last = calNextDs(d.end, -1);
      when.replaceChildren(
        chip(fmtDay(calDayMs(d.start)), `Starts ${fmtDay(calDayMs(d.start))}. Change`, e => pickDate(e.currentTarget, nyParseDs(d.start), dt => {
          d.start = hwTodayStr(dt); d.end = calNextDs(d.start, days); drawWhen(); drawRepeat(); })),
        h('span', { class: 'ev-to', text: 'to' }),
        chip(fmtDay(calDayMs(last)), `Ends ${fmtDay(calDayMs(last))}. Change`, e => pickDate(e.currentTarget, nyParseDs(last), dt => {
          const picked = hwTodayStr(dt); d.end = calNextDs(picked < d.start ? d.start : picked); drawWhen(); })));
      return;
    }
    const len = d.end - d.start;
    when.replaceChildren(
      chip(fmtDay(d.start), `On ${fmtDay(d.start)}. Change`, e => pickDate(e.currentTarget, new Date(d.start), dt => {
        const t = new Date(d.start), n = new Date(dt); n.setHours(t.getHours(), t.getMinutes(), 0, 0);
        d.start = n.getTime(); d.end = d.start + len; drawWhen(); drawRepeat(); })),
      chip(nyClock(d.start), `Starts at ${nyClock(d.start)}. Change`, e => evTimePop(e.currentTarget, minsOf(d.start), {
        onPick: m => { d.start = atMins(d.start, m); d.end = d.start + len; drawWhen(); } })),
      h('span', { class: 'ev-to', text: '–' }),
      chip(nyClock(d.end), `Ends at ${nyClock(d.end)}. Change`, e => evTimePop(e.currentTarget, minsOf(d.end), {
        after: minsOf(d.start), onPick: m => { d.end = atMins(d.start, m); drawWhen(); } })));
  }
  allDay.onclick = () => {
    if (d.allDay) {                                  // timed: the next whole hour today, else 9 AM; an hour long
      const day = nyParseDs(d.start), now = new Date();
      day.setHours(0, hwTodayStr(day) === hwTodayStr(now) ? Math.min(22 * 60, (now.getHours() + 1) * 60) : 9 * 60, 0, 0);
      d = { ...d, allDay: false, start: day.getTime(), end: day.getTime() + 3600000 };
    } else {
      const day = calFirstDs(d);
      d = { ...d, allDay: true, start: day, end: calNextDs(day) };
    }
    drawWhen();
  };

  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  function repeatLabel(r) {
    const first = nyParseDs(calFirstDs(d));
    return { daily: 'Every day', weekdays: 'Every weekday', weekly: `Every week on ${fmtWeekday(first)}`,
      monthly: `Every month on the ${ordinal(first.getDate())}`, yearly: `Every year on ${fmtMonthDay(first)}`,
      custom: 'Custom repeat (change it in Google Calendar)' }[r] || 'Doesn’t repeat';
  }
  function drawRepeat() {
    if (!repeatKnown) { repeatBtn.disabled = true; repeatBtn.replaceChildren(h('span', { class: 'ev-muted', text: 'Checking how it repeats…' })); return; }
    repeatBtn.disabled = d.repeat === 'custom';
    repeatBtn.replaceChildren(h('span', { text: repeatLabel(d.repeat) }), d.repeat === 'custom' ? '' : icon('down', 14));
  }
  // A Google series can switch between these, but stopping it is done in Google Calendar.
  repeatBtn.onclick = () => openMenu(repeatBtn, [null, ...CAL_REPEATS].filter(r => !(googleSeries && r === null)).map(r => ({
    label: repeatLabel(r), icon: (d.repeat || null) === r ? 'check' : 'repeat', onClick: () => { d.repeat = r; drawRepeat(); } })), { start: true });
  if (googleSeries) gcalGet(ev.calendarId, ev.seriesId)
    .then(m => { d.repeat = gcalRepeatOf(m.recurrence, m.start.date ? nyParseDs(m.start.date) : new Date(m.start.dateTime)) || 'custom'; })
    .catch(() => { d.repeat = 'custom'; })
    .finally(() => { origRepeat = d.repeat; repeatKnown = true; drawRepeat(); });

  function drawCal() {
    const c = cals.find(x => x.id === d.calendarId) || cals[cals.length - 1];
    d.calendarId = c.id;
    const fixed = !!(ev && ev.recurring);                // a repeating event stays in its calendar
    calBtn.disabled = fixed;
    calBtn.title = fixed ? 'A repeating event stays in its calendar' : '';
    calBtn.replaceChildren(setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${c.color})` }), h('span', { text: c.name }), fixed ? '' : icon('down', 14));
    syncNote.hidden = !(c.id === CAL_LOCAL && !signedIn);
    if (!syncNote.hidden) syncNote.replaceChildren(...[
      h('span', { text: 'Saved in this browser only. Sign in with Google to have it on your phone and in Google Calendar.' }),
      gcalReady() ? nyGoogleButton({ small: true, onclick: signInHere }) : null].filter(Boolean));
  }
  calBtn.onclick = () => openMenu(calBtn, calGrouped(cals).map(c => c === 'sep' || c.heading ? c
    : { label: c.name, aria: c.aria, dot: `var(--dot-${c.color})`, onClick: () => { d.calendarId = c.id; drawCal(); } }), { start: true });
  async function signInHere() {
    const r = await nyGoogleSignIn();
    if (!r.ok) return;
    raw = await calLoadRaw(); cals = calWritable(raw); signedIn = true;
    d.calendarId = calDefaultCalendar(raw);
    drawCal();
  }

  const busy = on => { saveBtn.disabled = on; saveBtn.textContent = on ? 'Saving…' : 'Save'; if (delBtn) delBtn.disabled = on; };
  function showErr(e) {
    err.hidden = false;
    const ask = e && e.kind === 'signin' ? calSignInAsk(raw, e.account) : null;   // names the account when there are several
    err.replaceChildren(...[h('span', { text: ask ? ask.text : (e && e.message) || 'Couldn’t save that. Try again.' }),
      e && e.kind === 'signin' ? nyGoogleButton({ label: 'Sign in again', small: true, onclick: async () => { if ((await nyGoogleSignIn({ email: e.account })).ok) err.hidden = true; } }) : null].filter(Boolean));
  }
  // One save or delete at a time: a second Enter while Google is answering would add the event twice
  let working = false;
  const once = fn => async () => { if (working) return; working = true; try { await fn(); } finally { working = false; } };
  const save = once(async () => {
    d.title = title.value.trim(); d.place = place.value.trim(); d.notes = notes.value.trim();
    if (!d.title) { title.classList.add('bad'); title.focus(); return; }
    let scope = 'one';
    if (ev && ev.recurring) {
      if ((d.repeat || null) !== origRepeat) scope = 'all';        // a new repeat is always for the series
      else if (!(scope = await evAskScope('Change'))) return;
    }
    busy(true); err.hidden = true;
    try {
      await calSave(ev, d, scope, { months });
      dlg.close(true);
      toast(ev ? 'Saved' : `Added “${d.title}”`);
      if (onSaved) onSaved();
    } catch (e) { busy(false); showErr(e); }
  });
  const remove = once(async () => {
    let scope = 'one';
    if (ev.recurring) { if (!(scope = await evAskScope('Delete'))) return; }
    else if (!(await confirmBox({ title: `Delete “${ev.title}”?`, yes: 'Delete', danger: true,
      body: ev.source === 'google' ? 'It’s deleted from Google Calendar too.' : 'There’s no undo.' }))) return;
    busy(true); err.hidden = true;
    try { await calDelete(ev, scope, { months }); dlg.close(true); toast('Deleted'); if (onSaved) onSaved(); }
    catch (e) { busy(false); showErr(e); }
  });
  title.addEventListener('input', () => title.classList.remove('bad'));
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  dlg.box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  drawWhen(); drawRepeat(); drawCal();
  title.focus();
  title.setSelectionRange(title.value.length, title.value.length);
}
