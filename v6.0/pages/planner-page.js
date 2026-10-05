// planner-page.js — the planner in a full tab: the same calendar and day as
// the popup, plus this week's habits and your sticky notes.

(async () => {
  const extra = h('aside', { class: 'pl-extra scroll' });
  const weekEl = h('section', { class: 'wk', 'data-tour': 'week' });
  const notesEl = h('section', { class: 'sn', 'data-tour': 'notes' });
  extra.append(weekEl, notesEl);

  const planner = Planner(document.getElementById('app'), {
    mode: 'page',
    onRender: (D, sel) => { renderWeek(D, sel); renderNotes(D); },
  });
  // Wide: the week and notes get their own column. Medium: they tuck under the
  // calendar. Narrow: one column, calendar first, then the day, then these.
  const medium = matchMedia('(max-width: 1180px)'), narrow = matchMedia('(max-width: 760px)');
  const placeExtra = () => (medium.matches && !narrow.matches ? planner.side : planner.body).append(extra);
  medium.addEventListener('change', placeExtra);
  narrow.addEventListener('change', placeExtra);
  placeExtra();
  topButton();                                    // only ever shows when a narrow window makes the page scroll

  // ── This week's habits ────────────────────────────────────────────────────
  function renderWeek(D, sel) {
    const ws = weekStartsOn() % 7;
    const start = new Date(sel); start.setDate(sel.getDate() - ((sel.getDay() - ws + 7) % 7));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const todayKey = hwTodayStr();
    const habits = D.store.tasks.filter(hb => hb.name && hb.name.trim() && days.some(d => isScheduledOn(hb, nyDayIdx(d)) && isTaskActive(hb, d)));
    const range = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} to ${days[6].toLocaleDateString(undefined,
      days[6].getMonth() === days[0].getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;

    const head = h('div', { class: 'side-head' }, icon('repeat', 16),
      h('span', { class: 'label', text: 'Habits this week' }), h('span', { class: 'wk-range', text: range }));
    if (!habits.length) {
      weekEl.replaceChildren(head, h('p', { class: 'up-empty', text: 'No habits yet. Add one with the Habit switch.' }));
      return;
    }
    const table = h('table', { class: 'wk-grid' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Habit' })),
        ...days.map(d => h('th', { scope: 'col', class: hwTodayStr(d) === todayKey ? 'is-today' : '', title: fmtWeekday(d) },
          d.toLocaleDateString(undefined, { weekday: 'narrow' }))),
        h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Done' })))),
      h('tbody', {}, ...habits.map(hb => {
        let due = 0, done = 0;
        const cells = days.map(d => {
          const key = hwTodayStr(d);
          const on = isScheduledOn(hb, nyDayIdx(d)) && isTaskActive(hb, d);
          if (!on) return h('td', { class: 'off' }, h('span', { class: 'dash', 'aria-label': 'Not scheduled', role: 'img' }));
          due++;
          const checked = habitDoneOn(D.store.weeks, hb.name, d);
          if (checked) done++;
          const future = key > todayKey;
          const b = h('button', { type: 'button', class: 'check sm', role: 'checkbox', 'aria-checked': String(checked),
            'aria-label': `${hb.name}, ${fmtWeekday(d)}`, onclick: () => setHabitDone(hb.name, d, !checked) }, icon('check', 12));
          if (future) b.disabled = true;
          return h('td', { class: key === todayKey ? 'is-today' : '' }, b);
        });
        return h('tr', {}, h('th', { scope: 'row', class: 'wk-name', text: hb.name }), ...cells,
          h('td', { class: 'wk-pct num', text: due ? Math.round(done / due * 100) + '%' : '' }));
      })));
    weekEl.replaceChildren(head, table);
  }

  // ── Sticky notes ──────────────────────────────────────────────────────────
  // They also show up around the lock screen.
  const COLORS = [['#fbeaa5', 'Butter'], ['#f9cfe1', 'Pink'], ['#c9edda', 'Mint'], ['#cbe3fa', 'Sky'], ['#ddd1fb', 'Lilac'], ['#ffd9c4', 'Peach']];
  const V5 = { '#fef9c3': '#fbeaa5', '#fce7f3': '#f9cfe1', '#dcfce7': '#c9edda', '#dbeafe': '#cbe3fa', '#ede9fe': '#ddd1fb' };
  let notes = [];
  const saveNotes = () => chrome.storage.local.set({ stickyNotes: notes });

  function renderNotes(D) {
    if (notesEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
    notes = (D.notes || []).map(n => ({ ...n, color: V5[n.color] || n.color || COLORS[0][0] }));
    const add = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'New sticky note', title: 'New sticky note', onclick: addNote }, icon('plus', 17));
    const head = h('div', { class: 'side-head' }, icon('note', 16),
      h('span', { class: 'label', text: 'Sticky notes' }), add);
    const tiles = notes.map(n => noteTile(n));
    notesEl.replaceChildren(head, notes.length ? h('div', { class: 'sn-grid' }, ...tiles)
      : h('button', { type: 'button', class: 'sn-empty', onclick: addNote }, 'Stick a note here. It shows up on the lock screen too.'));
  }

  function noteTile(n) {
    let t;
    const ta = h('textarea', { class: 'sn-text', 'aria-label': 'Sticky note', placeholder: 'Write something…', maxlength: '200' });
    ta.value = n.content || '';
    ta.addEventListener('input', () => { n.content = ta.value; clearTimeout(t); t = setTimeout(saveNotes, 500); });
    ta.addEventListener('blur', () => { clearTimeout(t); saveNotes(); });
    const tools = h('div', { class: 'sn-tools' },
      ...COLORS.map(([c, name]) => h('button', { type: 'button', class: 'sn-color', style: { background: c }, 'aria-label': name,
        'aria-pressed': String(n.color === c), onclick: () => { n.color = c; saveNotes(); } })),
      h('button', { type: 'button', class: 'icon-btn sm sn-del', 'aria-label': 'Delete note', onclick: async () => {
        notes = notes.filter(x => x !== n); await saveNotes();
        toast('Note deleted', { label: 'Undo', onClick: () => { notes.push(n); saveNotes(); } });
      } }, icon('trash', 15)));
    return h('div', { class: 'sn-tile', style: { background: n.color } }, ta, tools);
  }

  async function addNote() {
    const used = new Set(notes.map(n => n.color));
    notes.push({ id: Date.now().toString(36), content: '', color: (COLORS.find(([c]) => !used.has(c)) || COLORS[0])[0] });
    await saveNotes();
    requestAnimationFrame(() => { const all = notesEl.querySelectorAll('.sn-text'); all[all.length - 1]?.focus(); });
  }

  await hwRollForward();
  await planner.refresh();
  if (location.hash === '#tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); planner.select(d); }
  hwSyncFromCalendar().catch(() => {});
  hwWatchForMidnight();

  // Setup ends here, so this is usually where the tour first plays. Seen here
  // or in the popup, it counts as seen in both.
  if (NY_CFG.onboarded && !NY_CFG.toured) startTour(PAGE_TOUR, () => nySaveConfig({ toured: true }));
})();
