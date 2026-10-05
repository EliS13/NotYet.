// planner.js — the month calendar and the day it's pointing at. The toolbar
// popup and the full-page planner both draw this; the page adds a week grid
// and sticky notes beside it.

function Planner(root, { mode = 'popup', onRender = null } = {}) {
  let D = null;                                    // everything from nyLoadAll()
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  let selected = today0();
  let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  let editingHabits = false;
  let addKind = 'task';
  let justToggled = null;                          // row that should play the highlighter swipe

  const ds = d => hwTodayStr(d);
  const isToday = d => ds(d) === ds(new Date());
  const isPast = d => ds(d) < ds(new Date());

  // ── Skeleton ──────────────────────────────────────────────────────────────
  const statusEl = h('div', { class: 'status', role: 'status', 'data-tour': 'status' });
  const streakEl = h('span', { class: 'streak', hidden: true });
  const top = h('header', { class: 'pl-top' },
    h('button', { type: 'button', class: 'wordmark', title: 'Back to today', 'aria-label': 'Not yet. Back to today',
      onclick: () => { closeMenu(); select(today0()); list.scrollTop = 0; } }, logoSvg(26), h('span', { text: 'Not yet.' })),
    h('div', { class: 'pl-top-mid' }, statusEl, streakEl),
    h('div', { class: 'pl-top-actions' },
      mode === 'popup' ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Open the full planner', title: 'Open the full planner',
        onclick: () => { openPage('pages/planner.html'); window.close(); } }, icon('expand')) : null,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Your stats', title: 'Your stats',
        onclick: () => { openPage('pages/stats.html'); if (mode === 'popup') window.close(); } }, icon('chart')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', 'data-tour': 'settings',
        onclick: () => { openPage('pages/settings.html'); if (mode === 'popup') window.close(); } }, icon('settings'))));

  const calTitle = h('button', { type: 'button' });
  const calPrev = h('button', { type: 'button', class: 'icon-btn sm' }, icon('left', 17));
  const calNext = h('button', { type: 'button', class: 'icon-btn sm' }, icon('right', 17));
  // Back to today: a dot between the arrows (‹ • ›), lit once you've looked at another day or month
  const calToday = h('button', { type: 'button', class: 'cal-today', title: 'Today', 'aria-label': 'Go to today',
    onclick: () => select(today0(), { focus: true }) }, h('i'));
  const calGrid = h('div', { class: 'cal-grid', role: 'group', 'aria-label': 'Pick a day. Arrow keys move, Page Up and Page Down change month.' });
  const calDow = h('div', { class: 'cal-dow', 'aria-hidden': 'true' });
  const cal = h('section', { class: 'cal', 'data-tour': 'calendar' },
    h('div', { class: 'cal-head' }, h('h2', { class: 'cal-title', 'aria-live': 'polite' }, calTitle), calPrev, calToday, calNext),
    calDow, calGrid);

  const tonightEl = h('section', { class: 'side-block tonight' });
  const upcomingEl = h('section', { class: 'side-block upcoming' });
  const testEl = h('section', { class: 'side-block next-test', 'aria-label': 'Next test', hidden: true });
  let shownTest = null;                           // Coming up leaves out the test the card already shows
  const side = h('aside', { class: 'pl-side' }, cal, tonightEl, testEl, upcomingEl);

  const dayTitle = h('h1', { class: 'day-title display' });
  const dayDate = h('p', { class: 'day-date' });
  const dayNext = h('p', { class: 'day-next', hidden: true });
  const dayMeter = h('div', { class: 'day-meter' });
  // Today's bar is made once and only its width changes, so ticking something
  // off slides it along instead of redrawing it at the new length.
  const meterText = h('span', { class: 'meter-text num' });
  const meterFill = h('i');
  const meterBar = h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Done today', 'aria-valuemin': '0', 'aria-valuemax': '100' }, meterFill);
  const dayHead = h('div', { class: 'day-head' }, h('div', { class: 'day-name' }, dayTitle, dayDate, dayNext), dayMeter);
  const list = h('div', { class: 'day-list scroll', 'data-tour': 'list' });

  const addInput = h('input', { class: 'add-input', type: 'text', maxlength: '90', autocomplete: 'off', 'aria-label': 'New task' });
  const addMin = h('span', { class: 'chip add-min', hidden: true });
  // The subject read from what's typed (or picked here), shown before adding
  let addSubject = null;                                    // picked; null = read from the text
  const addSubj = h('button', { type: 'button', class: 'chip add-subj', hidden: true, 'aria-haspopup': 'menu',
    onclick: e => openMenu(e.currentTarget, [...D.cfg.subjects, { ...NY_OTHER, name: 'No subject' }].map(sub => ({
      label: sub.name, dot: nyColorCss(sub.color).dot, onClick: () => { addSubject = sub.id; syncAddBar(); addInput.focus(); } }))) });
  // The whole hint when it fits, else just the example: the popup's bar is narrow once Task, Habit and Event share it
  const HINTS = { task: ['Add a task, like “Essay friday 45m”', 'Essay fri 45m'], habit: ['Add a habit, like “Read 20m”', 'Read 20m'],
    event: ['Add an event, like “Dentist fri 3pm”', 'Dentist fri 3pm'] };
  const measure = document.createElement('canvas').getContext('2d');
  function fitPlaceholder() {
    const [long, short] = HINTS[addKind], room = addInput.clientWidth;
    measure.font = getComputedStyle(addInput).font;
    addInput.placeholder = room && measure.measureText(long).width > room ? short : long;
  }
  new ResizeObserver(fitPlaceholder).observe(addInput);
  const addSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'What to add' },
    h('button', { type: 'button', 'aria-pressed': 'true', 'data-kind': 'task', onclick: () => setAddKind('task') }, 'Task'),
    h('button', { type: 'button', 'aria-pressed': 'false', 'data-kind': 'habit', onclick: () => setAddKind('habit') }, 'Habit'),
    h('button', { type: 'button', 'aria-pressed': 'false', 'data-kind': 'event', onclick: () => setAddKind('event') }, 'Event'));
  // Task / Habit / Event shows only the chosen one; hovering (or tabbing in)
  // slides the others out over the typing field, so the bar keeps its room.
  // Folded, three small dots say there are three, with the chosen one filled.
  const kindDots = h('span', { class: 'kind-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const kindPlus = h('span', { class: 'kind-plus', 'aria-hidden': 'true' }, icon('plus', 15));   // the bar's +, folded in
  addSeg.append(kindPlus, kindDots);
  const addKindBox = h('div', { class: 'add-kind' }, addSeg);
  addKindBox.addEventListener('mouseleave', () => addKindBox.classList.remove('folded'));
  // The chip's room is measured once it has settled folded, never mid-animation,
  // so the field beside it doesn't jiggle while the options close.
  const fitKind = () => {
    const btns = [...addSeg.querySelectorAll('button')], i = btns.findIndex(b => b.getAttribute('aria-pressed') === 'true');
    [...kindDots.children].forEach((d, n) => d.classList.toggle('on', n === i));
    const open = addKindBox.matches(':hover, :focus-within') && !addKindBox.classList.contains('folded');
    if (i >= 0 && !open) setVars(addKindBox, { '--w': addSeg.offsetWidth + 'px' });   // folded: just + Task •••
  };
  let fitLater = 0;
  const fitSettled = () => { clearTimeout(fitLater); fitLater = setTimeout(fitKind, 260); };   // after the .22s fold
  requestAnimationFrame(fitKind);
  document.fonts?.ready.then(fitKind);
  // Tasks: the chip says which day it's for, and picking another day moves the planner there.
  const addDay = h('button', { type: 'button', class: 'chip add-day', 'aria-haspopup': 'menu', onclick: e => dayMenu(e.currentTarget, select) });
  // Habits: which days of the week it counts on. days[] runs Monday to Sunday.
  // It floats over the list, so showing it doesn't shift anything.
  let addDays = Array(7).fill(true);
  const repeatRow = h('div', { class: 'add-repeat', hidden: true, role: 'group', 'aria-label': 'Repeats on' });
  // Events: what was understood, in a card floating above the bar like the habit one.
  const eventCard = h('div', { class: 'add-repeat add-event', hidden: true, role: 'group', 'aria-label': 'Event details' });
  let addEventCal = null;                                   // picked in the card; null = where new events go
  const addBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Add');
  const addBar = h('form', { class: 'add-bar', 'data-tour': 'add', onsubmit: e => { e.preventDefault(); addFromBar(); } },
    h('div', { class: 'add-row' },
      repeatRow, eventCard,
      addKindBox, h('label', { class: 'add-field' }, addInput, addMin, addSubj), addDay, addBtn));
  const day = h('main', { class: 'pl-day' }, dayHead, list, addBar);

  const body = h('div', { class: 'pl-body' }, side, day);
  root.append(top, body);

  // ── Calendar ──────────────────────────────────────────────────────────────
  const sameMonth = (a, b) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  // Events on the calendars, minus the ones that show as tasks.
  const events = (fromDs, toDs) => calCollect(D.cal, fromDs, toDs).filter(ev => !calIsTask(ev));
  const standouts = calStandouts;                  // routine events stay in the day, not the month or Coming up
  // Google months these dates need, fetched when the set on screen changes;
  // the storage listener redraws when they land.
  let ensured = '';
  function ensureMonths(fromDs, toDs) {
    const months = calMonthsBetween(fromDs, toDs), key = months.join();
    if (key === ensured) return;
    ensured = key;
    calEnsureMonths(months).catch(() => {});          // sign-in trouble shows in the day
  }
  const gridMonths = () => { const days = monthDays(month); return calMonthsBetween(ds(days[0]), ds(days.at(-1))); };
  const signInAsk = () => calSignInAsk(D.cal);       // an account Google wants signed in again
  // The planner's date popover, for the event window.
  const pickDate = (anchor, current, onPick) => datePop(anchor, onPick, current, { start: true });   // the event window's chips
  const openEvent = ev => nyEventEditor({ ev, raw: D.cal, pickDate, months: gridMonths() });

  function select(d, { focus = false } = {}) {
    selected = new Date(d); selected.setHours(0, 0, 0, 0);
    if (!sameMonth(selected, month)) month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    editingHabits = false;
    calNav.showDays();                                // picking a day always means seeing its month
    renderCal(); renderDay();
    if (focus) calGrid.querySelector('[tabindex="0"]')?.focus();
  }

  // Did this day get everything done? Only ever said about days that did.
  function dayComplete(d) {
    const habits = habitsOn(D.store.tasks, d);
    const tasks = D.hw.hwTasksByDay[ds(d)] || [];
    if (!habits.length && !tasks.length) return false;
    return habits.every(x => habitDoneOn(D.store.weeks, x.name, d)) && tasks.every(t => t.done);
  }

  // Pieces the sidebar calendar and the date picker share.
  const monthTitle = m => [fmtMonth(m), ' ', h('span', { text: String(m.getFullYear()) })];

  // The sidebar calendar's title and arrows, and what its grid shows: the days
  // of a month, the twelve months of a year (click the title), or twelve years
  // (click the year), for looking far ahead. Picking a year shows its months;
  // picking a month, its days.
  //   month() / setMonth(m): the month on show.   drawDays(focus): draw its days.
  function calendarNav({ title, prev, next, dow, grid, month: shown, setMonth, drawDays }) {
    let view = 'days', from = 0;                     // from: the first of the twelve years
    const ARROWS = { days: ['Previous month', 'Next month'], months: ['Previous year', 'Next year'], years: ['Earlier years', 'Later years'] };
    const same = { months: sameMonth, years: (a, b) => a.getFullYear() === b.getFullYear() };

    function draw(focus = false) {
      grid.classList.toggle('periods', view !== 'days');
      dow.hidden = view !== 'days';
      title.disabled = view === 'years';
      prev.setAttribute('aria-label', ARROWS[view][0]); next.setAttribute('aria-label', ARROWS[view][1]);
      if (view === 'days') {
        drawDays(focus);
        title.append(icon('down', 14));
        title.setAttribute('aria-label', `${title.textContent.trim()}. Choose another month`);
        if (focus && !grid.contains(document.activeElement)) title.focus();            // no day of this month to land on
        return;
      }
      const m = shown(), now = new Date(), is = same[view];
      const cells = Array.from({ length: 12 }, (_, i) => view === 'months' ? new Date(m.getFullYear(), i, 1) : new Date(from + i, m.getMonth(), 1));
      if (view === 'months') title.replaceChildren(String(m.getFullYear()), icon('down', 14));
      else title.replaceChildren(`${from} to ${from + 11}`);
      title.setAttribute('aria-label', view === 'months' ? `${m.getFullYear()}. Choose another year` : title.textContent);
      grid.replaceChildren(...cells.map(d => h('button', {
        type: 'button', class: 'cal-period' + (is(d, m) ? ' sel' : '') + (is(d, now) ? ' today' : ''),
        tabindex: is(d, m) ? '0' : '-1', 'aria-pressed': String(is(d, m)),
        'aria-label': view === 'months' ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : String(d.getFullYear()),
        onclick: () => { setMonth(d); open(view === 'years' ? 'months' : 'days'); },
      }, h('span', { class: 'n', text: view === 'months' ? d.toLocaleDateString(undefined, { month: 'short' }) : String(d.getFullYear()) }))));
      if (!grid.querySelector('[tabindex="0"]')) grid.firstChild.tabIndex = 0;   // paged away from the year on show
      if (focus) grid.querySelector('[tabindex="0"]').focus();
    }
    function open(v) {
      view = v;
      if (v === 'years') from = shown().getFullYear() - 4;                          // the year on show sits in the second row
      draw(true);
    }
    function step(n) {
      const m = shown();
      if (view === 'days') setMonth(new Date(m.getFullYear(), m.getMonth() + n, 1));
      else if (view === 'months') setMonth(new Date(m.getFullYear() + n, m.getMonth(), 1));
      else from += 12 * n;
      draw();
    }
    title.addEventListener('click', () => open(view === 'days' ? 'months' : 'years'));
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    // Days have their own keys. Months and years: arrows move, Escape goes back a level.
    grid.addEventListener('keydown', e => {
      if (view === 'days') return;
      const cells = [...grid.children], i = cells.indexOf(document.activeElement);
      const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
      if (move && i >= 0) {
        e.preventDefault();
        const to = cells[Math.max(0, Math.min(cells.length - 1, i + move))];
        cells.forEach(c => { c.tabIndex = c === to ? 0 : -1; });
        to.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        open(view === 'years' ? 'months' : 'days');
      }
    });
    return { draw, get view() { return view; }, showDays() { view = 'days'; } };
  }
  const dowLabels = () => Array.from({ length: 7 }, (_, i) => h('span', {
    text: new Date(2024, 0, 7 + ((weekStartsOn() + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }) }));   // Jan 7 2024 was a Sunday
  // The dates a month grid shows, in whole weeks: five rows most months, six
  // when it has to. The date picker always asks for six so it keeps its height.
  function monthDays(m, rows = 0) {
    const lead = (m.getDay() - weekStartsOn() % 7 + 7) % 7;
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    rows ||= Math.ceil((lead + daysIn) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => new Date(m.getFullYear(), m.getMonth(), 1 - lead + i));
  }
  // Up to four marks under a date: up to two event dashes, then task dots.
  function dayCell(d, m, attrs, evs = []) {
    const tasks = D.hw.hwTasksByDay[ds(d)] || [];
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
      (evs.length ? `, ${evs.length} event${evs.length === 1 ? '' : 's'}` : '') +
      (tasks.length ? `, ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : '');
    const dashes = evs.slice(0, 2);
    return h('button', { type: 'button', 'aria-label': label, 'aria-current': isToday(d) ? 'date' : null, ...attrs,
      class: 'cal-day' + (d.getMonth() !== m.getMonth() ? ' off' : '') + (isToday(d) ? ' today' : '') + (attrs.class || '') },
      h('span', { class: 'n', text: String(d.getDate()) }),
      h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
        ...dashes.map(ev => setVars(h('b'), { '--c': `var(--dot-${ev.color})` })),
        ...tasks.slice(0, Math.min(3, 4 - dashes.length)).map(t => setVars(h('i', { class: t.done ? 'done' : '' }), subjectVars(t.course)))));
  }

  function drawCalDays(focus) {
    const days = monthDays(month), first = ds(days[0]), last = ds(days.at(-1));
    const byDay = calByDay(standouts(events(first, last)), first, last);
    ensureMonths(first, last);
    calTitle.replaceChildren(...monthTitle(month));
    calToday.disabled = isToday(selected) && sameMonth(month, new Date());
    calDow.replaceChildren(...dowLabels());
    calGrid.replaceChildren(...days.map(d => {
      const sel = ds(d) === ds(selected);
      return dayCell(d, month, {
        class: (sel ? ' sel' : '') + ((isPast(d) || isToday(d)) && dayComplete(d) ? ' complete' : ''),
        tabindex: sel ? '0' : '-1', 'aria-pressed': String(sel), onclick: () => select(d),
      }, byDay[ds(d)]);
    }));
    if (focus) calGrid.querySelector('[tabindex="0"]')?.focus();
  }
  const calNav = calendarNav({ title: calTitle, prev: calPrev, next: calNext, dow: calDow, grid: calGrid,
    month: () => month, setMonth: m => { month = m; }, drawDays: drawCalDays });
  const renderCal = () => calNav.draw();              // days, months or years: whichever is showing

  calGrid.addEventListener('keydown', e => {
    if (calNav.view !== 'days') return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); const d = new Date(selected); d.setDate(d.getDate() + step); select(d, { focus: true }); }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const d = new Date(selected); d.setMonth(d.getMonth() + (e.key === 'PageUp' ? -1 : 1)); select(d, { focus: true });
    }
    if (e.key === 'Home') { e.preventDefault(); select(today0(), { focus: true }); }
  });

  // ── Status and side blocks ────────────────────────────────────────────────
  function renderStatus() {
    const g = nyGate(D.store, D.hw);
    let ic = 'lock', text = '';
    if (g.why === 'bed') { ic = 'moon'; text = `Bedtime. Back at ${nyClock(g.openTs)}`; }
    else if (g.why === 'break') { ic = 'timer'; text = 'Break: '; }
    else if (g.why === 'done') { ic = 'unlock'; text = g.counts.total ? 'All done. Enjoy.' : 'Nothing due. Enjoy.'; }
    else { text = `${g.counts.left} left before ${nySitesLabel(D.cfg)}`; }
    statusEl.dataset.state = g.why;
    statusEl.replaceChildren(icon(ic, 16), h('span', { text }));
    // Days in a row the list was finished before bedtime; quiet, and only from two
    const st = nyStreak(D.doneDays, hwTodayStr());
    streakEl.hidden = st.current < 2;
    streakEl.textContent = `${st.current} days in a row`;
    streakEl.title = `Days in a row you finished your list before bedtime. Your best: ${st.best}.`;
    if (g.why === 'break') statusEl.lastChild.append(h('span', { class: 'num', 'data-break': '', text: nyFmtMs(g.until - Date.now()) }), ' left');
    return g;
  }

  function renderTonight(g) {
    const ctx = nyNightCtx();
    const n = nyNight(new Date(), ctx);
    const rows = [
      h('div', { class: 'tn-row' }, h('span', { class: 'tn-k', text: 'Bedtime' }), h('span', { class: 'tn-v num', text: nyClock(n.closeTs) })),
      h('div', { class: 'tn-row' }, h('span', { class: 'tn-k', text: 'Opens again' }), h('span', { class: 'tn-v num', text: nyClock(n.openTs) })),
    ];
    if (D.cfg.bedNext) rows.push(h('p', { class: 'tn-note' },
      `New bedtime starts ${fmtShortDay(nyParseDs(D.cfg.bedNext.from))}`));
    tonightEl.replaceChildren(
      h('div', { class: 'side-head' }, icon('moon', 16), h('span', { class: 'label', text: n.school ? 'School night' : 'Tonight' })),
      ...rows);
    tonightEl.classList.toggle('is-bed', g.why === 'bed');
  }

  // The next two weeks: each day's events (by time), then its tasks.
  function renderUpcoming() {
    const items = [], max = mode === 'popup' ? 3 : 6;
    const from = today0(); from.setDate(from.getDate() + 1);
    const to = today0(); to.setDate(to.getDate() + 14);
    const byDay = calByDay(standouts(events(ds(from), ds(to))), ds(from), ds(to));
    for (let i = 1; i <= 14 && items.length < max; i++) {
      const d = today0(); d.setDate(d.getDate() + i);
      for (const ev of byDay[ds(d)] || []) if (items.length < max && calDaysOf(ev)[0] === ds(d)
        && `${ev.title.trim().toLowerCase()}|${ds(d)}` !== shownTest) items.push({ d, ev });
      for (const t of D.hw.hwTasksByDay[ds(d)] || []) if (!t.done && items.length < max) items.push({ d, t });
    }
    const head = h('div', { class: 'side-head' }, icon('list', 16), h('span', { class: 'label', text: 'Coming up' }));
    if (!items.length) { upcomingEl.replaceChildren(head, h('p', { class: 'up-empty', text: 'Nothing planned yet.' })); return; }
    upcomingEl.replaceChildren(head, ...items.map(({ d, t, ev }, i) => {
      const day = h('span', { class: 'up-day', text: i && ds(items[i - 1].d) === ds(d) ? '' : fmtShortDay(d) });
      if (ev) return h('button', { type: 'button', class: 'up-row', onclick: () => select(d),
        'aria-label': `${fmtWeekday(d)}: ${ev.title}${ev.allDay ? '' : ' at ' + nyClock(ev.start)}` },
        day, setVars(h('span', { class: 'up-dash' }), { '--c': `var(--dot-${ev.color})` }),
        h('span', { class: 'up-title', text: ev.title }), ev.allDay ? null : h('span', { class: 'up-time', text: nyClock(ev.start) }));
      return h('button', { type: 'button', class: 'up-row', onclick: () => select(d), 'aria-label': `${fmtWeekday(d)}: ${t.title}` },
        day, setVars(h('span', { class: 'dot' }), subjectVars(t.course)), h('span', { class: 'up-title', text: t.title }));
    }));
  }

  // The next test on the calendar, how long until it, and study spread before it
  function renderNextTest() {
    const today = ds(today0()), last = hwTodayStr(nyAddDays(new Date(), 14)), seen = new Map();
    for (const ev of standouts(events(today, last))) {
      if (!nyIsTest(ev.title)) continue;
      const day = calDaysOf(ev)[0], key = `${ev.title.trim().toLowerCase()}|${day}`;
      if (!seen.has(key)) seen.set(key, { key, title: ev.title.trim(), ds: day, color: ev.color });
    }
    const nt = nyNextTest([...seen.values()], D.testPlans || {}, D.hw.hwTasksByDay, today);
    shownTest = nt ? nt.key : null;
    testEl.hidden = !nt;
    if (!nt) return;
    // Two lines, so Coming up stays in view in the popup: the test and when, then what to do
    const d = nyParseDs(nt.ds);
    const when = nt.daysLeft === 0 ? 'Today' : nt.daysLeft === 1 ? 'Tomorrow' : `${d.toLocaleDateString(undefined, { weekday: 'short' })} · in ${nt.daysLeft} days`;
    const title = h('button', { type: 'button', class: 'nt-title', onclick: () => select(d), 'aria-label': `Next test: ${nt.title}, ${when}` },
      setVars(h('span', { class: 'up-dash' }), { '--c': `var(--dot-${nt.color})` }), h('b', { text: nt.title }), h('span', { class: 'nt-when', text: when }));
    let rest;
    if (nt.daysLeft === 0) rest = h('p', { class: 'nt-note', text: 'It’s today. Good luck.' });
    else if (nt.plan && nt.studyTotal) rest = h('div', { class: 'nt-progress' }, h('span', { text: `Study: ${nt.studyDone} of ${nt.studyTotal} done` }),
      h('span', { class: 'nt-bar', role: 'img', 'aria-label': `${nt.studyDone} of ${nt.studyTotal} study sessions done` },
        h('i', { style: { width: (nt.studyDone / nt.studyTotal * 100) + '%' } })));
    else rest = h('div', { class: 'nt-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', 'aria-haspopup': 'dialog', onclick: e => studyPop(e.currentTarget, nt) }, 'Plan study'),
      h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () =>
        chrome.storage.local.set({ testPlans: { ...(D.testPlans || {}), [nt.key]: 'skip' } }) }, 'No need'));
    // Exam weeks: the next one still to plan, on one quiet line
    const a = nt.after, ad = a && nyParseDs(a.ds);
    const after = a ? h('p', { class: 'nt-then' }, h('span', { text: 'Then: ' }), h('b', { text: a.title }),
      h('span', { text: `, ${a.daysLeft === 1 ? 'tomorrow' : ad.toLocaleDateString(undefined, { weekday: 'short' })} · ` }),
      h('button', { type: 'button', class: 'nt-link', 'aria-haspopup': 'dialog', 'aria-label': `Plan study for ${a.title}`, onclick: e => studyPop(e.currentTarget, a) }, 'Plan study')) : null;
    testEl.replaceChildren(...[title, rest, after].filter(Boolean));
  }

  // Short sessions on the days just before a test: how many, how long, and which days
  function studyPop(anchor, nt) {
    const today = ds(today0()), course = nyGuessSubject(nt.title, '', D.cfg);
    const usual = course && course !== 'other' ? nyUsualLength(D.hw.hwLog, course) : null;
    let n = 3, min = usual || 25;
    const lens = [...new Set([15, 25, 30, 45, min])].sort((a, b) => a - b);
    const nRow = h('div', { class: 'sp-chips', role: 'group', 'aria-label': 'How many sessions' });
    const mRow = h('div', { class: 'sp-chips', role: 'group', 'aria-label': 'How long each' });
    const daysLine = h('p', { class: 'sp-days' });
    const add = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Add to my days');
    // Chips are made once and only flip aria-pressed, so the one just picked keeps the focus
    nRow.append(...[1, 2, 3, 4, 5].map(k => h('button', { type: 'button', 'data-v': k, onclick: () => { n = k; draw(); } }, String(k))));
    mRow.append(...lens.map(k => h('button', { type: 'button', 'data-v': k, onclick: () => { min = k; draw(); } }, fmtMin(k))));
    let pop = null;
    function draw() {
      for (const b of nRow.children) b.setAttribute('aria-pressed', String(+b.dataset.v === n));
      for (const b of mRow.children) b.setAttribute('aria-pressed', String(+b.dataset.v === min));
      const days = nyStudyDays(nt.ds, today, n);
      daysLine.textContent = !days.length ? 'No days left before it.'
        : days.map(x => shortDay(nyParseDs(x))).join(', ') + (days.length < n ? `. Only ${days.length} ${days.length === 1 ? 'day' : 'days'} left before it.` : '');
      add.disabled = !days.length;
      if (pop && pop.isConnected) {                    // grown past the bottom (a longer days line): move it up
        const r = pop.getBoundingClientRect();
        if (r.bottom > innerHeight - 8) pop.style.top = Math.max(8, innerHeight - 8 - r.height) + 'px';
      }
    }
    add.onclick = async () => {
      const days = nyStudyDays(nt.ds, today, n);
      for (const x of days) await hwAddTask(x, { title: `Study: ${nt.title}`, estMin: min, course, studyFor: nt.key });
      await chrome.storage.local.set({ testPlans: { ...(D.testPlans || {}), [nt.key]: { at: Date.now(), n: days.length, min } } });
      closeMenu();
      toast(`${days.length} study session${days.length === 1 ? '' : 's'} added`);
    };
    pop = h('div', { class: 'time-pop study-pop', role: 'dialog', 'aria-label': `Plan study for ${nt.title}` },
      h('p', { class: 'steps-h' }, h('b', { text: 'Plan study' }), h('span', { text: 'Short sessions on the days before it.' })),
      h('div', { class: 'sp-row' }, h('span', { class: 'sp-k', text: 'Sessions' }), nRow),
      h('div', { class: 'sp-row' }, h('span', { class: 'sp-k', text: 'Each' }), mRow),
      daysLine, add);
    draw();                                         // filled first, so it's placed at its real size
    openPop(anchor, pop);
    nRow.querySelector('[aria-pressed="true"]')?.focus();
  }

  // ── The day ───────────────────────────────────────────────────────────────
  function renderDay() {
    const d = selected, key = ds(d);
    const habits = habitsOn(D.store.tasks, d);
    const tasks = D.hw.hwTasksByDay[key] || [];
    const dayEvents = events(key, key);

    const named = isToday(d) || relDay(d) === 'Tomorrow';
    const allDone = isToday(d) && nyTodayCounts(D.store, D.hw).left === 0 && (habits.length || tasks.length);
    // Today always wears the highlighter: the accent colour, or mint once it's all done.
    dayTitle.replaceChildren(isToday(d)
      ? setVars(h('span', { class: 'swipe', text: 'Today.' }), { '--hl': allDone ? 'var(--hl-mint)' : 'var(--accent)' })
      : (named ? 'Tomorrow' : fmtWeekday(d)) + '.');
    const next = isToday(d) && dayEvents.find(ev => !ev.allDay && ev.start > Date.now());
    dayDate.replaceChildren(named ? `${fmtWeekday(d)}, ${fmtMonthDay(d)}` : fmtMonthDay(d),
      !named ? h('span', { class: 'chip', text: relDay(d) }) : '',
      !isToday(d) ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet day-back', onclick: () => select(today0()) }, 'Back to today') : '');
    dayNext.hidden = !next;
    if (next) dayNext.replaceChildren(icon('clock', 14), h('span', {}, 'Next: ', h('b', { text: next.title }), ` at ${nyClock(next.start)}`));

    renderMeter(d, habits, tasks);
    fitPlaceholder();
    syncAddBar();

    const groups = [];
    const review = isToday(d) && reviewCard();
    if (review) groups.push(review);
    if (habits.length || editingHabits) groups.push(habitGroup(d, habits));
    if (tasks.length) groups.push(taskGroup(d, tasks));
    if (dayEvents.length || signInAsk()) groups.push(eventGroup(d, dayEvents));
    if (groups.length === (review ? 1 : 0)) groups.push(emptyDay(d));
    else if (!D.cfg.onboarded && isToday(d)) groups.unshift(h('div', { class: 'setup-nudge' },
      h('span', { text: 'Bedtime and your calendar aren’t set up yet.' }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { openPage('pages/welcome.html'); if (mode === 'popup') window.close(); } }, 'Set it up')));
    list.replaceChildren(...groups);
    justToggled = null;
    if (onRender) onRender(D, selected);
  }

  // Sunday (or Monday, if Sunday was missed): a look back at the week, once
  function reviewCard() {
    const sunday = nyReviewWeek(new Date(), D.cfg.reviewSeen || '', (D.hw.hwSettings || {}).installDate || '');
    if (!sunday) return null;
    const s = nyStats(D.hw.hwTasksByDay, D.hw.hwLog, D.doneDays, nyWeekRange(sunday));
    if (!s.minutes && !s.done) return null;
    const streak = nyStreak(D.doneDays, hwTodayStr()).current;
    const parts = [`${s.done} task${s.done === 1 ? '' : 's'} done`, s.minutes ? `${fmtMin(s.minutes)} focused` : '',
      s.bySubject.length ? `mostly ${nySubject(s.bySubject[0].id).name}` : '', streak >= 2 ? `${streak} days in a row` : ''].filter(Boolean);
    const ahead = () => { const t = new Date(); t.setDate(t.getDate() + 1); select(t); };
    return h('div', { class: 'review', role: 'region', 'aria-label': 'Your week' },
      h('div', { class: 'rv-text' }, h('b', { text: 'Your week' }), h('span', { text: parts.join(' · ') })),
      h('div', { class: 'rv-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { openPage('pages/stats.html?week=' + sunday); if (mode === 'popup') window.close(); } }, 'See your week'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: ahead }, 'Plan ahead'),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Got it, hide this until next Sunday', title: 'Got it',
          onclick: async () => { D.cfg = await nySaveConfig({ reviewSeen: sunday }); renderDay(); } }, icon('x', 15))));
  }

  function renderMeter(d, habits, tasks) {
    if (isToday(d)) {
      const c = nyTodayCounts(D.store, D.hw);
      const pct = c.total ? Math.round(c.done / c.total * 100) : 100;
      meterText.textContent = c.total ? `${c.done} of ${c.total}` : 'Clear';
      meterBar.setAttribute('aria-valuenow', String(pct));
      meterBar.setAttribute('aria-valuetext', `${c.done} of ${c.total} done`);
      meterFill.style.width = pct + '%';
      if (meterBar.parentNode !== dayMeter) dayMeter.replaceChildren(meterText, meterBar);
      return;
    }
    const mins = tasks.filter(t => !t.done).reduce((a, t) => a + (+t.estMin || 0), 0);
    dayMeter.replaceChildren(tasks.length
      ? h('span', { class: 'meter-text', text: `${tasks.length} task${tasks.length === 1 ? '' : 's'}${mins ? ', ' + fmtMin(mins) : ''}` })
      : '');
  }

  function groupHead(title, ...right) {
    return h('div', { class: 'grp-head' }, h('h3', { class: 'label', text: title }), h('span', { class: 'grp-right' }, ...right));
  }

  function emptyDay(d) {
    if (!D.cfg.onboarded && isToday(d)) return h('div', { class: 'empty' },
      h('p', { text: 'Nothing here yet. Two minutes of setup and it’s ready.' }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { openPage('pages/welcome.html'); if (mode === 'popup') window.close(); } }, 'Set it up'));
    const msg = isPast(d) ? 'Nothing happened here. Or nothing was written down.'
      : isToday(d) ? 'Nothing on the list. Add something below, or go watch something.'
      : 'A blank day. Add a task below to plan it.';
    return h('div', { class: 'empty' }, h('p', { text: msg }));
  }

  // Habits ------------------------------------------------------------------
  function habitGroup(d, habits) {
    const g = h('section', { class: 'grp' });
    const editBtn = h('button', { type: 'button', class: 'btn btn-sm btn-quiet', 'aria-pressed': String(editingHabits),
      onclick: () => { editingHabits = !editingHabits; renderDay(); } }, editingHabits ? 'Done' : 'Edit');
    g.append(groupHead('Habits', editBtn));
    if (editingHabits) {
      const all = D.store.tasks.filter(x => x.name && x.name.trim());
      if (!all.length) g.append(h('p', { class: 'grp-empty', text: 'No habits yet. Switch the bar below to Habit to add one.' }));
      for (const hb of all) g.append(habitEditRow(hb));
      return g;
    }
    for (const hb of habits) g.append(habitRow(d, hb));
    return g;
  }

  function habitRow(d, hb) {
    const done = habitDoneOn(D.store.weeks, hb.name, d);
    const timer = isToday(d) ? D.store.activeTimers[hb.name] : null;
    const timed = !!hb.duration && isToday(d);
    const future = !isToday(d) && !isPast(d);
    const row = h('div', { class: 'row' + (done ? ' is-done' : '') });

    if (timed && !done) {
      const p = timer ? 1 - habitLeftMs(timer) / timer.durationMs : 0;
      const ring = h('button', { type: 'button', class: 'ring', 'aria-label': timer ? `${hb.name}: timer running` : `Start ${fmtMin(hb.duration)} timer for ${hb.name}`,
        title: timer ? '' : `Start ${fmtMin(hb.duration)}`, 'data-ring': hb.name, 'data-fk': 'h:' + hb.name,
        onclick: async () => {                      // start, then finish: the same two clicks as a task
          if (!timer) { startHabitTimer(hb.name, hb.duration); return; }
          justToggled = 'h:' + hb.name;
          await setHabitDone(hb.name, d, true);
          await stopHabitTimer(hb.name);
        } }, icon(timer ? 'check' : 'play', 12));
      if (timer) { ring.setAttribute('aria-label', `Finish ${hb.name}`); ring.title = 'Done: stop the timer'; }
      ring.style.setProperty('--p', p.toFixed(3));
      row.append(ring);
    } else if (future) {
      row.append(h('span', { class: 'plan-mark', title: 'Repeats on this day', 'aria-hidden': 'true' }, icon('repeat', 15)));
    } else {
      row.append(checkBox(done, hb.name, 'h:' + hb.name, async () => {
        justToggled = 'h:' + hb.name;
        await setHabitDone(hb.name, d, !done);
        if (done && timer) await stopHabitTimer(hb.name);
      }));
    }
    row.append(h('span', { class: 'row-title' },
      setVars(h('span', { class: 'txt' + (done ? ' swipe' + (justToggled === 'h:' + hb.name ? ' animate' : '') : ''), text: hb.name }),
        { '--hl': 'var(--hl-mint)' })));

    const right = h('span', { class: 'row-right' });
    if (timer && !done) {
      right.append(h('span', { class: 'time num running', 'data-habit': hb.name, text: nyFmtMs(habitLeftMs(timer)) }),
        h('button', { type: 'button', class: 'icon-btn sm', 'data-fk': 'hp:' + hb.name, 'aria-label': timer.pausedAt ? 'Resume' : 'Pause',
          onclick: () => pauseHabitTimer(hb.name, !timer.pausedAt) }, icon(timer.pausedAt ? 'play' : 'pause', 16)),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Stop timer',
          onclick: () => stopHabitTimer(hb.name) }, icon('x', 16)));
    } else if (hb.duration && !done) {
      right.append(h('span', { class: 'time', text: fmtMin(hb.duration) }));
    }
    right.append(h('button', { type: 'button', class: 'icon-btn sm row-more', 'data-fk': 'hm:' + hb.name, 'aria-label': `More for ${hb.name}`,
      onclick: e => habitMenu(e.currentTarget, row, hb, timer) }, icon('more', 17)));
    row.append(right);
    return row;
  }

  function habitMenu(anchor, row, hb, timer) {
    const items = [];
    if (timer) items.push({ label: 'Cancel timer', icon: 'stop', onClick: () => stopHabitTimer(hb.name) }, 'sep');
    items.push({ label: 'Rename', icon: 'pencil', onClick: () => inlineEdit(row, { value: hb.name, label: 'Habit name',
      onSave: v => renameHabit(hb.name, v) }) });
    items.push({ label: hb.duration ? 'Change timer' : 'Add a timer', icon: 'timer', onClick: () => nyLengthPop(anchor, hb.duration || null, {
      label: 'Timer', none: hb.duration ? 'No timer' : null, onPick: m => saveHabit(hb.name, { duration: m }) }) });
    items.push({ label: 'Change days', icon: 'repeat', onClick: () => { editingHabits = true; renderDay(); } });
    items.push({ label: hb.durationWeeks ? `Change the ${hb.durationWeeks}-week limit` : 'Stop after a few weeks', icon: 'calendar',
      onClick: () => openMenu(anchor, [null, 1, 2, 3, 4, 6, 8, 12].map(w => ({
        label: w ? `${w} week${w === 1 ? '' : 's'}` : 'No limit', icon: (hb.durationWeeks || null) === w ? 'check' : 'calendar',
        onClick: () => saveHabit(hb.name, { durationWeeks: w, startDate: hb.startDate || hwTodayStr() }) }))) });
    items.push('sep');
    items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmBox({ title: `Delete “${hb.name}”?`, body: 'Its check marks go with it.', yes: 'Delete', danger: true })) deleteHabit(hb.name);
    } });
    openMenu(anchor, items);
  }

  function habitEditRow(hb) {
    const days = hb.days || Array(7).fill(true);
    const name = h('input', { class: 'input input-sm', value: hb.name, 'aria-label': 'Habit name', maxlength: '60' });
    name.addEventListener('change', async () => { if (!(await renameHabit(hb.name, name.value))) name.value = hb.name; });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
    // days[] runs Monday to Sunday; the chips run in the locale's own week order.
    const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn() % 7 + i) % 7);   // JS weekdays, 0 = Sunday
    const chips = h('div', { class: 'days days-sm', role: 'group', 'aria-label': `Days for ${hb.name}` },
      ...order.map(js => {
        const i = (js + 6) % 7, ref = new Date(2024, 0, 7 + js);
        return h('button', { type: 'button', class: 'day', 'aria-pressed': String(days[i] !== false),
          'aria-label': ref.toLocaleDateString(undefined, { weekday: 'long' }),
          onclick: () => { const next = [...days]; next[i] = !(next[i] !== false); saveHabit(hb.name, { days: next }); } },
          ref.toLocaleDateString(undefined, { weekday: 'narrow' }));
      }));
    const min = h('button', { type: 'button', class: 'pick-btn input-min num', 'aria-haspopup': 'dialog',
      'aria-label': `Timer for ${hb.name}: ${hb.duration ? fmtMin(hb.duration) : 'none'}. Change`,
      onclick: e => nyLengthPop(e.currentTarget, hb.duration || null, { label: 'Timer', none: 'No timer',
        onPick: m => saveHabit(hb.name, { duration: m }) }) },
      h('span', { text: hb.duration ? fmtMin(hb.duration) : 'No timer' }), icon('down', 14));
    const del = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Delete ${hb.name}`,
      onclick: async () => {
        if (await confirmBox({ title: `Delete “${hb.name}”?`, body: 'Its check marks go with it.', yes: 'Delete', danger: true })) deleteHabit(hb.name);
      } }, icon('trash', 16));
    return h('div', { class: 'row row-edit' }, name, chips, min, del);
  }

  // Tasks -------------------------------------------------------------------
  function taskGroup(d, tasks) {
    const key = ds(d);
    const free = isToday(d) && !hwGatesOn(d);
    const g = h('section', { class: 'grp' });
    g.append(groupHead('Tasks', free ? h('span', { class: 'chip butter', title: 'No school tomorrow, so these don’t keep anything closed tonight' }, 'Free night') : null));
    const phase = hwPhase(D.hw.hwSettings);
    for (const t of tasks) g.append(taskRow(d, key, t, phase));
    return g;
  }

  function taskRow(d, key, t, phase) {
    const timer = D.timers[t.id] && D.timers[t.id].taskDate === key ? D.timers[t.id] : null;
    const past = isPast(d);
    const row = setVars(h('div', { class: 'row' + (t.done ? ' is-done' : '') }), subjectVars(t.course));
    // The first click starts the task's timer; the next one finishes it and logs
    // how long it really took. Done tasks untick, and past days just tick.
    const starts = !t.done && !timer && !past;
    const box = checkBox(t.done, t.title, 't:' + t.id, async () => {
      if (starts) { await hwStartTimer(t, phase, key); return; }
      justToggled = 't:' + t.id;
      const r = await hwSetDone(key, t.id, !t.done);
      if (r === 'queued') toast(`Couldn’t tick it in ${connName(t.src)} yet. Trying again soon.`);
    });
    if (timer) { box.classList.add('is-running'); box.setAttribute('aria-label', `Finish ${t.title}`); box.title = 'Done: stop the timer'; }
    else if (starts) { box.setAttribute('aria-label', `Start ${t.title}`); box.title = 'Start the timer'; }
    row.append(box);
    const sub = nySubject(t.course);
    const title = h('span', { class: 'row-title' },
      h('span', { class: 'dot', title: sub.name, 'aria-label': sub.name, role: 'img' }),
      h('span', { class: 'txt' + (t.done ? ' swipe' + (justToggled === 't:' + t.id ? ' animate' : '') : ''), text: t.title }));
    const carried = hwCarriedLabel(t);
    if (carried && !t.done) title.append(h('span', { class: 'chip peach', text: carried }));
    // A second line: "5 minutes in. Keep going?", or the next of its small steps
    const ns = nyNextStep(t.steps), second = [];
    if (timer && timer.askKeepGoing) second.push(h('div', { class: 'row-steps keep-going' },
      h('span', { class: 'step-t', text: 'Five minutes in.' }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => hwKeepGoing(t.id, true) }, 'Keep going'),
      h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => hwKeepGoing(t.id, false) }, 'Stop here')));
    else if (!t.done && ns.total) second.push(h('div', { class: 'row-steps' },
      ns.step ? h('button', { type: 'button', class: 'step-check', 'data-fk': 's:' + t.id, 'aria-label': `Tick the step: ${ns.step.text}`, title: 'Tick this step',
        onclick: () => hwSetSteps(key, t.id, t.steps.map((s, i) => i === ns.index ? { ...s, done: true } : s)) }) : h('span', { class: 'step-all' }, icon('check', 12)),
      h('span', { class: 'step-t', text: ns.step ? ns.step.text : 'All steps done' }),
      h('span', { class: 'step-n', text: `${ns.done} of ${ns.total}` })));
    row.append(second.length ? h('div', { class: 'row-main' }, title, ...second) : title);

    const right = h('span', { class: 'row-right' });
    if (t.done) {
      right.append(h('span', { class: 'time', title: t.actualMin ? `Took ${fmtMin(t.actualMin)}, planned ${fmtMin(t.estMin)}` : '',
        text: t.actualMin ? `${fmtMin(t.actualMin)} of ${fmtMin(t.estMin)}` : '' }));
    } else if (timer) {
      const brk = timer.mode === 'down' && hwOnBreak(timer);
      right.append(...[                      // append() would print a null as "null"
        timer.justStart ? h('span', { class: 'chip lilac', title: 'Just starting: five minutes, then you decide' }, '5 min') : null,
        timer.mode === 'up' ? h('span', { class: 'time-ic', title: 'Stopwatch' }, icon('timer', 14)) : null,
        h('span', { class: 'time num running' + (brk ? ' on-break' : ''), 'data-task': t.id,
          'aria-label': timer.mode === 'up' ? 'Time so far' : 'Time left' }, nyFmtMs(hwTimerMs(timer))),
        h('button', { type: 'button', class: 'icon-btn sm', 'data-fk': 'p:' + t.id, 'aria-label': timer.pausedAt ? 'Resume' : 'Pause',
          onclick: () => hwPauseTimer(t.id, !timer.pausedAt) }, icon(timer.pausedAt ? 'play' : 'pause', 16))].filter(Boolean));
    } else if (!past) {
      const up = phase === 'calibration' || t.type === 'Q';
      right.append(h('button', { type: 'button', class: 'start', 'data-fk': 'p:' + t.id, 'aria-label': `Start ${up ? 'stopwatch' : fmtMin(t.estMin) + ' countdown'} for ${t.title}`,
        title: up ? 'Start the stopwatch' : 'Start the countdown',
        onclick: () => hwStartTimer(t, phase, key) }, icon(up ? 'timer' : 'play', 13), h('span', { class: 'num', text: fmtMin(t.estMin) })));
    }
    right.append(h('button', { type: 'button', class: 'icon-btn sm row-more', 'data-fk': 'm:' + t.id, 'aria-label': `More for ${t.title}`,
      onclick: e => taskMenu(e.currentTarget, row, key, t, timer) }, icon('more', 17)));
    row.append(right);
    return row;
  }

  function taskMenu(anchor, row, key, t, timer) {
    const items = [];
    if (!t.done && !isPast(nyParseDs(key))) items.push({ label: 'Focus mode', icon: 'focus', onClick: () => {
      openPage(`pages/focus.html#${encodeURIComponent(key)}/${encodeURIComponent(t.id)}`); if (mode === 'popup') window.close(); } });
    if (!t.done && !timer && !isPast(nyParseDs(key))) items.push({ label: 'Just 5 minutes', icon: 'play', onClick: () => hwJustStart(t, key) });
    if (!t.done) items.push({ label: t.steps && t.steps.length ? 'Edit steps' : 'Break into steps', icon: 'list', onClick: () => stepsPop(anchor, key, t) });
    if (!t.done) items.push({ label: timer ? 'Mark done' : 'Mark done without timing', icon: 'check', onClick: () => { justToggled = 't:' + t.id; hwSetDone(key, t.id, true); } });
    if (timer) items.push({ label: 'Cancel timer', icon: 'stop', onClick: () => hwStopTimer(t.id) });
    if (timer) {                                    // what plays while it runs
      const names = { off: 'No sound', brown: 'Brown noise', rain: 'Rain', waves: 'Waves' };
      items.push({ label: `Sound: ${names[D.cfg.focusSound] || 'No sound'}`, icon: 'sound', onClick: () => openMenu(anchor,
        NY_SOUNDS.map(s => ({ label: names[s], icon: s === D.cfg.focusSound ? 'check' : null, onClick: () => nySaveConfig({ focusSound: s }) }))) });
    }
    if (items.length) items.push('sep');
    items.push({ label: 'Rename', icon: 'pencil', onClick: () => inlineEdit(row, { value: t.title, label: 'Task name',
      onSave: v => hwEditTask(key, t.id, { title: v }) }) });
    items.push({ label: 'Change time', icon: 'timer', onClick: () => nyLengthPop(anchor, t.estMin, { label: 'How long it takes',
      onPick: m => hwEditTask(key, t.id, { estMin: m }) }) });
    items.push({ label: t.type === 'Q' ? 'Make it a countdown' : 'Make it a stopwatch', icon: 'repeat',
      onClick: () => hwEditTask(key, t.id, { type: t.type === 'Q' ? 'M' : 'Q' }) });
    items.push({ label: 'Subject', icon: 'palette', onClick: () => subjectMenu(anchor, key, t) });
    if (!t.done) items.push({ label: 'Move to another day', icon: 'move', onClick: () => dayMenu(anchor, async to => {
      if (ds(to) === key) return;
      await hwMoveTask(key, t.id, ds(to)); toast(`Moved to ${fmtWeekday(to)}, ${fmtMonthDay(to)}`);
    }, nyParseDs(key)) });
    items.push('sep');
    items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmBox({ title: `Delete “${t.title}”?`, yes: 'Delete', danger: true })) hwRemoveTask(key, t.id);
    } });
    openMenu(anchor, items);
  }

  // A task's small steps: tick, rename in place, remove, and add with Enter.
  // The list only ever shows the next one.
  function stepsPop(anchor, key, t) {
    const steps = (t.steps || []).map(s => ({ ...s }));
    const list = h('ul', { class: 'steps-list' });
    const add = h('input', { class: 'input input-sm steps-add', placeholder: steps.length ? 'Add another step' : 'First step, like “Outline”', 'aria-label': 'Add a step', maxlength: '120', autocomplete: 'off' });
    const save = () => hwSetSteps(key, t.id, steps);
    function draw() {
      list.replaceChildren(...steps.map((s, i) => {
        const text = h('input', { class: 'steps-text', value: s.text, 'aria-label': `Step ${i + 1}`, maxlength: '120', autocomplete: 'off' });
        text.addEventListener('change', () => { const v = text.value.trim(); if (v) s.text = v; else steps.splice(i, 1); save(); draw(); });
        text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
        return h('li', { class: 'steps-row' + (s.done ? ' done' : '') },
          h('button', { type: 'button', class: 'step-check' + (s.done ? ' on' : ''), role: 'checkbox', 'aria-checked': String(s.done), 'aria-label': s.text,
            onclick: () => { s.done = !s.done; save(); draw(); } }, s.done ? icon('check', 11) : null),
          text,
          h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${s.text}`, onclick: () => { steps.splice(i, 1); save(); draw(); add.focus(); } }, icon('x', 14)));
      }));
      list.hidden = !steps.length;
    }
    add.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = add.value.trim();
      if (!v) return;
      steps.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: v, done: false });
      add.value = ''; add.placeholder = 'Add another step';
      save(); draw();
    });
    openPop(anchor, h('div', { class: 'time-pop steps-pop', role: 'dialog', 'aria-label': `Steps for ${t.title}` },
      h('p', { class: 'steps-h' }, h('b', { text: 'Small steps' }), h('span', { text: 'The list shows just the next one.' })), list, add));
    draw();
    add.focus();
  }

  function subjectMenu(anchor, key, t) {
    openMenu(anchor, [...D.cfg.subjects, NY_OTHER].map(s => ({
      label: s.name, dot: nyColorCss(s.color).dot, onClick: () => hwEditTask(key, t.id, { course: s.id }),
    })));
  }

  // Renaming happens in the row itself: the title turns into a field. Enter or
  // clicking away saves; Escape doesn't. Either way the row goes back to normal,
  // with keyboard focus on its ⋯ (the list doesn't redraw under a focused field).
  function inlineEdit(row, { value, label, onSave }) {
    const input = h('input', { class: 'input input-sm', type: 'text', value, 'aria-label': label, placeholder: label, maxlength: '90' });
    row.querySelector('.row-title').replaceChildren(input);
    input.focus(); input.select();
    const fk = row.querySelector('.row-more')?.dataset.fk;
    let done = false;
    const finish = async save => {
      if (done) return;
      done = true;
      const v = input.value.trim(), changed = save && v && v !== String(value);
      if (changed) await onSave(v);
      if (!changed || document.activeElement === input) renderDay();      // a save redraws from storage anyway
      if (fk) list.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  // Calendar events: all-day first, then by time. On today, finished ones
  // fade and the one happening now says so.
  function eventGroup(d, evs) {
    const g = h('section', { class: 'grp' });
    g.append(groupHead('Calendar'));
    const now = Date.now(), dayStart = nyParseDs(ds(d)).getTime(), dayEnd = nyAddDays(nyParseDs(ds(d)), 1).getTime();
    for (const ev of evs) {
      const [s, e] = calSpan(ev), timed = !ev.allDay;
      const time = !timed ? 'All day' : s < dayStart ? (e < dayEnd ? 'Until ' + nyClock(e) : 'All day') : nyClock(s);
      const past = isToday(d) && timed && e <= now, current = isToday(d) && timed && s <= now && now < e;
      const len = timed && s >= dayStart && e <= dayEnd && e > s ? fmtMin(Math.round((e - s) / 60000)) : '';
      g.append(setVars(h('button', { type: 'button', class: 'row row-event' + (past ? ' is-past' : ''), 'data-fk': 'e:' + ev.id,
        'aria-label': `${ev.title}, ${time === 'All day' ? 'all day' : time}${ev.place ? ', ' + ev.place : ''}. ${ev.editable ? 'Edit' : 'Details'}`,
        onclick: () => openEvent(ev) },
        h('span', { class: 'ev-time num', text: time }),
        h('span', { class: 'ev-bar', 'aria-hidden': 'true' }),
        h('span', { class: 'row-title' }, h('span', { class: 'txt', text: ev.title }), ev.place ? h('span', { class: 'ev-place', text: ev.place }) : null),
        current ? h('span', { class: 'chip ev-now', text: 'Now' }) : len ? h('span', { class: 'row-right time num', text: len }) : null),
        { '--c': `var(--dot-${ev.color})` }));
    }
    const ask = signInAsk();
    if (ask) g.append(h('div', { class: 'ev-signin' }, icon('sync', 15), h('span', { text: ask.text }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => nyGoogleSignIn({ email: ask.email }) }, 'Sign in again')));
    return g;
  }

  function checkBox(checked, name, fk, onToggle) {
    const b = h('button', { type: 'button', class: 'check', role: 'checkbox', 'aria-checked': String(checked), 'aria-label': name, 'data-fk': fk },
      icon('check', 14));
    b.addEventListener('click', onToggle);
    return b;
  }

  // ── Adding ────────────────────────────────────────────────────────────────
  // Tasks: "Essay friday 45m" → a 45-minute task on Friday. Habits: "Read 20m"
  // → a habit with a 20-minute timer (days come from the Repeats row).
  function parseAdd(text) {
    if (addKind === 'event') return nyParseEvent(text);
    if (addKind === 'task') return nyParseQuick(text);
    const m = text.match(/\s(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours)\s*$/i);
    if (!m) return { title: text.trim(), minutes: null, date: null };
    return { title: text.slice(0, m.index).trim(), minutes: Math.min(480, +m[1] * (/^h/i.test(m[2]) ? 60 : 1)), date: null };
  }

  // Keep the bar in step with what's typed: the length chip and the day for a
  // task, the Repeats card for a habit, the event card for an event.
  function syncAddBar() {
    const p = parseAdd(addInput.value), typed = !!addInput.value.trim();
    if (!typed) addSubject = null;
    const subj = addKind === 'task' && typed ? addSubject || p.subject : null;
    // A typed length, or how long this subject usually takes you (a suggestion, marked ~)
    const usual = addKind === 'task' && typed && !p.minutes && subj && subj !== 'other' ? nyUsualLength(D.hw.hwLog, subj) : null;
    addMin.hidden = addKind !== 'task' || !(p.minutes || usual);
    addMin.classList.toggle('usual', !p.minutes && !!usual);
    if (!addMin.hidden) addMin.textContent = p.minutes ? fmtMin(p.minutes) : `~${fmtMin(usual)}`;
    if (usual && !p.minutes) addMin.setAttribute('aria-label', `About ${fmtMin(usual)}: how long ${nySubject(subj).name} usually takes you`);
    else addMin.removeAttribute('aria-label');
    addSubj.hidden = !subj || subj === 'other';
    if (!addSubj.hidden) {
      const sub = nySubject(subj);
      setVars(addSubj, { '--c': nyColorCss(sub.color).dot }).replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: sub.name }));
      addSubj.setAttribute('aria-label', `Subject: ${sub.name}${addSubject ? '' : ', from what you typed'}. Change`);
    }
    const day = (addKind === 'task' && p.date) || selected;
    addDay.replaceChildren(icon('calendar', 14), h('span', { text: shortDay(day) }));
    addDay.classList.toggle('typed', addKind === 'task' && !!p.date);
    addDay.setAttribute('aria-label', `For ${fmtWeekday(day)}, ${fmtMonthDay(day)}${p.date ? ', from what you typed' : ''}. Change the day`);
    addDay.hidden = addKind !== 'task';
    const showRepeat = addKind === 'habit' && typed;
    if (showRepeat && repeatRow.hidden) renderRepeat();
    repeatRow.hidden = !showRepeat;
    eventCard.hidden = !(addKind === 'event' && typed);
    if (!eventCard.hidden) renderEventCard(p);
  }

  function renderEventCard(p) {
    const cals = calWritable(D.cal);
    const c = cals.find(x => x.id === (addEventCal || calDefaultCalendar(D.cal))) || cals[cals.length - 1];
    const draft = calDraftFromText(p, selected);
    const firstLocal = c.id === CAL_LOCAL && !gcalSignedIn(D.cal) && !D.cal.calLocalNoteSeen;
    eventCard.replaceChildren(...[
      h('div', { class: 'ae-bits' }, ...[                // these wrap; More stays top right
        h('span', { class: 'ae-when' }, icon('clock', 15), h('span', { text: calWhenLabel(draft) })),
        p.place ? h('span', { class: 'ae-place' }, icon('place', 15), h('span', { text: p.place })) : null,
        h('button', { type: 'button', class: 'preset ae-cal', 'aria-haspopup': 'menu', 'aria-label': `Goes to ${c.name}. Change`,
          onclick: e => openMenu(e.currentTarget, cals.map(x => ({ label: x.name, dot: `var(--dot-${x.color})`,
            onClick: () => { addEventCal = x.id; syncAddBar(); addInput.focus(); } })), { start: true }) },
          setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${c.color})` }), h('span', { text: c.name })),
      ].filter(Boolean)),
      h('button', { type: 'button', class: 'preset ae-more', onclick: () => nyEventEditor({ draft: { ...draft, calendarId: c.id }, raw: D.cal, pickDate,
        months: gridMonths(), onSaved: () => { addInput.value = ''; addEventCal = null; syncAddBar(); } }), 'aria-label': 'More options' }, 'More'),
      firstLocal ? h('p', { class: 'ae-note' }, 'Saved in Not yet. only. ',
        h('a', { href: '#', onclick: e => { e.preventDefault(); nyGoogleSignIn(); } }, 'Sign in with Google'),   // from the popup it carries on in Settings
        ' to sync with your phone.') : null,
    ].filter(Boolean));                                   // no place, no note: nothing in their place
  }
  addInput.addEventListener('input', syncAddBar);

  // "Today", "Tomorrow", "Wed", "Oct 14"
  function shortDay(d) {
    const n = dayDiff(new Date(), d);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n > 1 && n < 7) return fmtShortDay(d);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // A menu of the next week of days, plus any date from the calendar picker.
  // Picking a day is the calendar itself, not a list of days.
  const dayMenu = (anchor, onPick, current = selected) => datePop(anchor, onPick, current);

  // Any other day: a month like the sidebar's, in a popover. Arrow keys move,
  // Page Up and Page Down change month, Home is today, Escape closes.
  function datePop(anchor, onPick, current, popOpts) {
    let shown = new Date(current.getFullYear(), current.getMonth(), 1);
    let focused = new Date(current);                   // the grid's one tab stop
    const title = h('h2', { class: 'cal-title', 'aria-live': 'polite' });
    const grid = h('div', { class: 'cal-grid', role: 'group', 'aria-label': 'Days. Arrow keys move, Page Up and Page Down change month.' });
    const pop = h('div', { class: 'date-pop', role: 'dialog', 'aria-label': 'Pick a date' },
      h('div', { class: 'cal-head' }, title,
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Previous month', onclick: () => page(-1) }, icon('left', 17)),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Next month', onclick: () => page(1) }, icon('right', 17))),
      h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, ...dowLabels()), grid);

    function page(n) {
      shown = new Date(shown.getFullYear(), shown.getMonth() + n, 1);
      focused = sameMonth(current, shown) ? new Date(current) : new Date(shown);
      draw();
    }
    function draw(focus = false) {
      title.replaceChildren(...monthTitle(shown));
      const days = monthDays(shown, 6), first = ds(days[0]), last = ds(days.at(-1));
      const byDay = calByDay(standouts(events(first, last)), first, last);
      grid.replaceChildren(...days.map(d => {
        const sel = ds(d) === ds(current);
        return dayCell(d, shown, {
          class: sel ? ' sel' : '', tabindex: ds(d) === ds(focused) ? '0' : '-1', 'aria-pressed': String(sel),
          onclick: () => { closeMenu(); onPick(d); },
        }, byDay[ds(d)]);
      }));
      if (focus) grid.querySelector('[tabindex="0"]')?.focus();
    }
    grid.addEventListener('keydown', e => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      const d = new Date(focused);
      if (step) d.setDate(d.getDate() + step);
      else if (e.key === 'PageUp' || e.key === 'PageDown') d.setMonth(d.getMonth() + (e.key === 'PageUp' ? -1 : 1));
      else if (e.key === 'Home') d.setTime(today0().getTime());
      else return;
      e.preventDefault();
      focused = d; shown = new Date(d.getFullYear(), d.getMonth(), 1);
      draw(true);
    });

    draw();
    openPop(anchor, pop, popOpts);
    grid.querySelector('[tabindex="0"]')?.focus();
  }

  const DAY_ORDER = Array.from({ length: 7 }, (_, i) => (weekStartsOn() % 7 + i) % 7);   // JS weekdays in locale order
  const PRESETS = [['Every day', [1, 1, 1, 1, 1, 1, 1]], ['Weekdays', [1, 1, 1, 1, 1, 0, 0]], ['Weekends', [0, 0, 0, 0, 0, 1, 1]]];
  function renderRepeat() {
    repeatRow.replaceChildren(
      h('span', { class: 'label', text: 'Repeats' }),
      h('div', { class: 'days days-sm' }, ...DAY_ORDER.map(js => {
        const i = (js + 6) % 7, ref = new Date(2024, 0, 7 + js);
        return h('button', { type: 'button', class: 'day', 'aria-pressed': String(addDays[i]),
          'aria-label': ref.toLocaleDateString(undefined, { weekday: 'long' }),
          onclick: () => { addDays[i] = !addDays[i]; renderRepeat(); } }, ref.toLocaleDateString(undefined, { weekday: 'narrow' }));
      })),
      h('div', { class: 'presets' }, ...PRESETS.map(([label, pattern]) => h('button', {
        type: 'button', class: 'preset', 'aria-pressed': String(pattern.every((v, i) => !!v === addDays[i])),
        onclick: () => { addDays = pattern.map(Boolean); renderRepeat(); } }, label))));
  }

  // "every day", "weekdays", "Mon, Wed and Fri"
  function describeDays(days) {
    const on = DAY_ORDER.map(js => (js + 6) % 7).filter(i => days[i]);
    if (on.length === 7) return 'every day';
    if (on.length === 5 && !days[5] && !days[6]) return 'on weekdays';
    if (on.length === 2 && days[5] && days[6]) return 'on weekends';
    const names = on.map(i => fmtShortDay(new Date(2024, 0, 8 + i)));
    return 'on ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0] || 'no days');
  }

  function setAddKind(k) {
    addKind = k;
    [...addSeg.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
    addKindBox.classList.add('folded');                // picked: it folds back up, even with the mouse still on it
    [...kindDots.children].forEach((dot, n) => dot.classList.toggle('on', ['task', 'habit', 'event'][n] === k));
    fitSettled();
    if (document.activeElement && addSeg.contains(document.activeElement)) document.activeElement.blur();
    syncAddBar();
    addInput.setAttribute('aria-label', { task: 'New task', habit: 'New habit', event: 'New event' }[k]);
    renderDay();
    addInput.focus();
  }

  async function addFromBar() {
    const p = parseAdd(addInput.value);
    if (!p.title) { addInput.focus(); return; }
    if (addKind === 'event') {
      const draft = calDraftFromText(p, selected), calendarId = addEventCal || calDefaultCalendar(D.cal);
      addBtn.disabled = true;
      try { await calCreate(draft, calendarId, { months: gridMonths() }); }
      catch (e) { toast(e.message || 'Couldn’t add that. Try again.', { label: 'Try again', onClick: addFromBar }); return; }
      finally { addBtn.disabled = false; }
      if (calendarId === CAL_LOCAL && !gcalSignedIn(D.cal)) chrome.storage.local.set({ calLocalNoteSeen: true });
      const day = new Date(calSpan(draft)[0]);
      toast(`Added “${p.title}”, ${calWhenLabel(draft)}`, ds(day) !== ds(selected) ? { label: 'Show', onClick: () => select(day) } : undefined);
      addInput.value = ''; addEventCal = null;
      syncAddBar();
      return;
    }
    if (addKind === 'habit') {
      if (!addDays.some(Boolean)) { toast('Pick at least one day for it'); return; }
      const ok = await addHabit({ name: p.title, duration: p.minutes, days: [...addDays] });
      if (!ok) { toast('You already have a habit with that name'); return; }
      toast(`Added “${p.title}”, ${describeDays(addDays)}`);
      addDays = Array(7).fill(true); renderRepeat();
    } else {
      const day = p.date || selected;
      const course = addSubject || p.subject || null;
      const usual = course && course !== 'other' ? nyUsualLength(D.hw.hwLog, course) : null;
      await hwAddTask(ds(day), { title: p.title, estMin: p.minutes || usual || 30, course });
      addSubject = null;
      if (ds(day) !== ds(selected)) toast(`Added for ${fmtWeekday(day)}, ${fmtMonthDay(day)}`, { label: 'Show', onClick: () => select(day) });
    }
    addInput.value = '';
    syncAddBar();
  }

  // ── Live parts ────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!D) return;
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-task]')) {
      const t = D.timers[el.dataset.task];
      if (t) el.textContent = nyFmtMs(hwTimerMs(t, now));
    }
    for (const el of root.querySelectorAll('[data-habit]')) {
      const t = D.store.activeTimers[el.dataset.habit];
      if (t) el.textContent = nyFmtMs(habitLeftMs(t, now));
    }
    for (const el of root.querySelectorAll('[data-ring]')) {
      const t = D.store.activeTimers[el.dataset.ring];
      if (t) el.style.setProperty('--p', (1 - habitLeftMs(t, now) / t.durationMs).toFixed(3));
    }
    const brk = root.querySelector('[data-break]');
    if (brk) brk.textContent = nyFmtMs((D.hw.breakUntil || 0) - now);
  }, 500);

  async function refresh() {
    D = await nyLoadAll();
    const g = renderStatus();
    renderTonight(g);
    renderNextTest();
    renderUpcoming();
    renderCal();
    // Someone typing in the list (a rename, the habit editor) keeps their field;
    // everything else redraws, and keyboard focus lands back on the same control.
    const a = document.activeElement;
    if (a && list.contains(a) && a.tagName === 'INPUT') return;
    const fk = a && list.contains(a) ? a.dataset.fk : null;
    const keep = list.scrollTop;
    renderDay();
    list.scrollTop = keep;                        // a tick or a timer shouldn't jump the list back up
    if (fk) list.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
  }

  // The gate's own flip (ytGate) doesn't change anything drawn here.
  onStorage(refresh);
  setInterval(() => { if (D) { const g = renderStatus(); renderTonight(g); } }, 30000);

  return {
    refresh, select, body, side,
    get data() { return D; },
    focusAdd: () => addInput.focus(),
  };
}
