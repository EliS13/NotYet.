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
  const top = h('header', { class: 'pl-top' },
    h('button', { type: 'button', class: 'wordmark', title: 'Back to today', 'aria-label': 'Not yet. Back to today',
      onclick: () => { closeMenu(); select(today0()); list.scrollTop = 0; } }, logoSvg(26), h('span', { text: 'Not yet.' })),
    statusEl,
    h('div', { class: 'pl-top-actions' },
      mode === 'popup' ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Open the full planner', title: 'Open the full planner',
        onclick: () => { openPage('pages/planner.html'); window.close(); } }, icon('expand')) : null,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', 'data-tour': 'settings',
        onclick: () => { openPage('pages/settings.html'); if (mode === 'popup') window.close(); } }, icon('settings'))));

  const calTitle = h('button', { type: 'button' });
  const calPrev = h('button', { type: 'button', class: 'icon-btn sm' }, icon('left', 17));
  const calNext = h('button', { type: 'button', class: 'icon-btn sm' }, icon('right', 17));
  const calGrid = h('div', { class: 'cal-grid', role: 'group', 'aria-label': 'Pick a day. Arrow keys move, Page Up and Page Down change month.' });
  const calDow = h('div', { class: 'cal-dow', 'aria-hidden': 'true' });
  const cal = h('section', { class: 'cal', 'data-tour': 'calendar' },
    h('div', { class: 'cal-head' }, h('h2', { class: 'cal-title', 'aria-live': 'polite' }, calTitle), calPrev, calNext),
    calDow, calGrid);

  const tonightEl = h('section', { class: 'side-block tonight' });
  const upcomingEl = h('section', { class: 'side-block upcoming' });
  const side = h('aside', { class: 'pl-side' }, cal, tonightEl, upcomingEl);

  const dayTitle = h('h1', { class: 'day-title display' });
  const dayDate = h('p', { class: 'day-date' });
  const dayMeter = h('div', { class: 'day-meter' });
  // Today's bar is made once and only its width changes, so ticking something
  // off slides it along instead of redrawing it at the new length.
  const meterText = h('span', { class: 'meter-text num' });
  const meterFill = h('i');
  const meterBar = h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Done today', 'aria-valuemin': '0', 'aria-valuemax': '100' }, meterFill);
  const dayHead = h('div', { class: 'day-head' }, h('div', { class: 'day-name' }, dayTitle, dayDate), dayMeter);
  const list = h('div', { class: 'day-list scroll', 'data-tour': 'list' });

  const addInput = h('input', { class: 'add-input', type: 'text', maxlength: '90', autocomplete: 'off', 'aria-label': 'New task' });
  const addMin = h('span', { class: 'chip add-min', hidden: true });
  const addSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'What to add' },
    h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setAddKind('task') }, 'Task'),
    h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setAddKind('habit') }, 'Habit'));
  // Tasks: the chip says which day it's for, and picking another day moves the planner there.
  const addDay = h('button', { type: 'button', class: 'chip add-day', 'aria-haspopup': 'menu', onclick: e => dayMenu(e.currentTarget, select) });
  // Habits: which days of the week it counts on. days[] runs Monday to Sunday.
  // It floats over the list, so showing it doesn't shift anything.
  let addDays = Array(7).fill(true);
  const repeatRow = h('div', { class: 'add-repeat', hidden: true, role: 'group', 'aria-label': 'Repeats on' });
  const addBar = h('form', { class: 'add-bar', 'data-tour': 'add', onsubmit: e => { e.preventDefault(); addFromBar(); } },
    h('div', { class: 'add-row' },
      repeatRow,
      addSeg, h('label', { class: 'add-field' }, icon('plus', 17), addInput, addMin), addDay,
      h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Add')));
  const day = h('main', { class: 'pl-day' }, dayHead, list, addBar);

  const body = h('div', { class: 'pl-body' }, side, day);
  root.append(top, body);
  const toTop = topButton(list);

  // ── Calendar ──────────────────────────────────────────────────────────────
  const sameMonth = (a, b) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

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
  function dayCell(d, m, attrs) {
    const tasks = D.hw.hwTasksByDay[ds(d)] || [];
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
      (tasks.length ? `, ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : '');
    return h('button', { type: 'button', 'aria-label': label, 'aria-current': isToday(d) ? 'date' : null, ...attrs,
      class: 'cal-day' + (d.getMonth() !== m.getMonth() ? ' off' : '') + (isToday(d) ? ' today' : '') + (attrs.class || '') },
      h('span', { class: 'n', text: String(d.getDate()) }),
      h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
        ...tasks.slice(0, 3).map(t => setVars(h('i', { class: t.done ? 'done' : '' }), subjectVars(t.course)))));
  }

  function drawCalDays(focus) {
    calTitle.replaceChildren(...monthTitle(month));
    calDow.replaceChildren(...dowLabels());
    calGrid.replaceChildren(...monthDays(month).map(d => {
      const sel = ds(d) === ds(selected);
      return dayCell(d, month, {
        class: (sel ? ' sel' : '') + ((isPast(d) || isToday(d)) && dayComplete(d) ? ' complete' : ''),
        tabindex: sel ? '0' : '-1', 'aria-pressed': String(sel), onclick: () => select(d),
      });
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

  function renderUpcoming() {
    const items = [], max = mode === 'popup' ? 3 : 6;
    for (let i = 1; i <= 14 && items.length < max; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
      for (const t of D.hw.hwTasksByDay[ds(d)] || []) if (!t.done && items.length < max) items.push({ d, t });
    }
    const head = h('div', { class: 'side-head' }, icon('list', 16), h('span', { class: 'label', text: 'Coming up' }));
    if (!items.length) { upcomingEl.replaceChildren(head, h('p', { class: 'up-empty', text: 'Nothing planned yet.' })); return; }
    upcomingEl.replaceChildren(head, ...items.map(({ d, t }, i) =>
      h('button', { type: 'button', class: 'up-row', onclick: () => select(d), 'aria-label': `${fmtWeekday(d)}: ${t.title}` },
        h('span', { class: 'up-day', text: i && ds(items[i - 1].d) === ds(d) ? '' : fmtShortDay(d) }),
        setVars(h('span', { class: 'dot' }), subjectVars(t.course)),
        h('span', { class: 'up-title', text: t.title }))));
  }

  // ── The day ───────────────────────────────────────────────────────────────
  function renderDay() {
    const d = selected, key = ds(d);
    const habits = habitsOn(D.store.tasks, d);
    const tasks = D.hw.hwTasksByDay[key] || [];
    const agenda = (D.agenda[key] || []).filter(a => !nyParseTitle(a.t));

    const named = isToday(d) || relDay(d) === 'Tomorrow';
    const allDone = isToday(d) && nyTodayCounts(D.store, D.hw).left === 0 && (habits.length || tasks.length);
    // Today always wears the highlighter: the accent colour, or mint once it's all done.
    dayTitle.replaceChildren(isToday(d)
      ? setVars(h('span', { class: 'swipe', text: 'Today.' }), { '--hl': allDone ? 'var(--hl-mint)' : 'var(--accent)' })
      : (named ? 'Tomorrow' : fmtWeekday(d)) + '.');
    dayDate.replaceChildren(named ? `${fmtWeekday(d)}, ${fmtMonthDay(d)}` : fmtMonthDay(d),
      !named ? h('span', { class: 'chip', text: relDay(d) }) : '',
      !isToday(d) ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet day-back', onclick: () => select(today0()) }, 'Back to today') : '');

    renderMeter(d, habits, tasks);
    addInput.placeholder = addKind === 'habit' ? 'Add a habit, like “Read 20m”' : 'Add a task, like “Essay friday 45m”';
    syncAddBar();

    const groups = [];
    if (habits.length || editingHabits) groups.push(habitGroup(d, habits));
    if (tasks.length) groups.push(taskGroup(d, tasks));
    if (agenda.length) groups.push(agendaGroup(agenda));
    if (!groups.length) groups.push(emptyDay(d));
    else if (!D.cfg.onboarded && isToday(d)) groups.unshift(h('div', { class: 'setup-nudge' },
      h('span', { text: 'Bedtime and your calendar aren’t set up yet.' }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { openPage('pages/welcome.html'); if (mode === 'popup') window.close(); } }, 'Set it up')));
    list.replaceChildren(...groups);
    toTop.attach();
    justToggled = null;
    if (onRender) onRender(D, selected);
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
        onclick: () => { if (!timer) startHabitTimer(hb.name, hb.duration); } }, icon(timer ? 'timer' : 'play', 12));
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
    items.push({ label: hb.duration ? 'Change timer' : 'Add a timer', icon: 'timer', onClick: () => inlineEdit(row, {
      value: hb.duration || 20, type: 'number', label: 'Timer minutes', onSave: v => saveHabit(hb.name, { duration: +v > 0 ? Math.round(+v) : null }) }) });
    items.push({ label: 'Change days', icon: 'repeat', onClick: () => { editingHabits = true; renderDay(); } });
    items.push({ label: hb.durationWeeks ? `Change the ${hb.durationWeeks}-week limit` : 'Stop after a few weeks', icon: 'calendar',
      onClick: () => inlineEdit(row, { value: hb.durationWeeks || 4, type: 'number', label: 'Weeks, 0 for no limit',
        onSave: v => saveHabit(hb.name, { durationWeeks: +v > 0 ? Math.round(+v) : null, startDate: hb.startDate || hwTodayStr() }) }) });
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
    const min = h('input', { class: 'input input-sm input-min num', type: 'number', min: '1', max: '480', value: hb.duration || '',
      placeholder: 'min', 'aria-label': `Timer minutes for ${hb.name}` });
    min.addEventListener('change', () => saveHabit(hb.name, { duration: +min.value > 0 ? Math.round(+min.value) : null }));
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
    row.append(checkBox(t.done, t.title, 't:' + t.id, async () => {
      justToggled = 't:' + t.id;
      await hwSetDone(key, t.id, !t.done);
    }));
    const sub = nySubject(t.course);
    const title = h('span', { class: 'row-title' },
      h('span', { class: 'dot', title: sub.name, 'aria-label': sub.name, role: 'img' }),
      h('span', { class: 'txt' + (t.done ? ' swipe' + (justToggled === 't:' + t.id ? ' animate' : '') : ''), text: t.title }));
    const carried = hwCarriedLabel(t);
    if (carried && !t.done) title.append(h('span', { class: 'chip peach', text: carried }));
    row.append(title);

    const right = h('span', { class: 'row-right' });
    if (t.done) {
      right.append(h('span', { class: 'time', text: t.actualMin ? fmtMin(t.actualMin) : '' }));
    } else if (timer) {
      const brk = timer.mode === 'down' && hwOnBreak(timer);
      right.append(
        timer.mode === 'up' ? h('span', { class: 'time-ic', title: 'Stopwatch' }, icon('timer', 14)) : null,
        h('span', { class: 'time num running' + (brk ? ' on-break' : ''), 'data-task': t.id,
          'aria-label': timer.mode === 'up' ? 'Time so far' : 'Time left' }, nyFmtMs(hwTimerMs(timer))),
        h('button', { type: 'button', class: 'icon-btn sm', 'data-fk': 'p:' + t.id, 'aria-label': timer.pausedAt ? 'Resume' : 'Pause',
          onclick: () => hwPauseTimer(t.id, !timer.pausedAt) }, icon(timer.pausedAt ? 'play' : 'pause', 16)));
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
    if (timer) items.push({ label: 'Cancel timer', icon: 'stop', onClick: () => hwStopTimer(t.id) });
    if (items.length) items.push('sep');
    items.push({ label: 'Rename', icon: 'pencil', onClick: () => inlineEdit(row, { value: t.title, label: 'Task name',
      onSave: v => hwEditTask(key, t.id, { title: v }) }) });
    items.push({ label: 'Change time', icon: 'timer', onClick: () => inlineEdit(row, { value: t.estMin, type: 'number', label: 'Minutes',
      onSave: v => +v > 0 && hwEditTask(key, t.id, { estMin: Math.round(+v) }) }) });
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

  function subjectMenu(anchor, key, t) {
    openMenu(anchor, [...D.cfg.subjects, NY_OTHER].map(s => ({
      label: s.name, dot: `var(--dot-${s.color})`, onClick: () => hwEditTask(key, t.id, { course: s.id }),
    })));
  }

  // Inline edits happen in the row itself: the title turns into a field.
  function inlineEdit(row, { value, type = 'text', label, onSave }) {
    const input = h('input', { class: 'input input-sm', type, value, 'aria-label': label, placeholder: label, ...(type === 'number' ? { min: '0', max: '480' } : { maxlength: '90' }) });
    row.querySelector('.row-title').replaceChildren(input);
    input.focus(); input.select();
    let done = false;
    const finish = async save => { if (done) return; done = true; if (save && input.value.trim()) await onSave(input.value.trim()); else renderDay(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  // Calendar events ---------------------------------------------------------
  function agendaGroup(items) {
    const g = h('section', { class: 'grp' });
    g.append(groupHead('Calendar'));
    for (const a of items) {
      const sub = nyGuessSubject(a.t);
      const time = a.s == null ? 'All day' : nyClockMin(a.s);
      g.append(setVars(h('div', { class: 'row row-event' },
        h('span', { class: 'ev-time num', text: time }),
        h('span', { class: 'row-title' }, sub !== 'other' ? h('span', { class: 'dot' }) : h('span', { class: 'dot ghost' }), h('span', { class: 'txt', text: a.t })),
        a.e != null && a.s != null ? h('span', { class: 'row-right time num', text: fmtMin(Math.max(0, a.e - a.s)) }) : null), subjectVars(sub)));
    }
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
    if (addKind === 'task') return nyParseQuick(text);
    const m = text.match(/\s(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours)\s*$/i);
    if (!m) return { title: text.trim(), minutes: null, date: null };
    return { title: text.slice(0, m.index).trim(), minutes: Math.min(480, +m[1] * (/^h/i.test(m[2]) ? 60 : 1)), date: null };
  }

  // Keep the bar in step with what's typed: the length chip, the day the task
  // will land on, and (for a habit) the Repeats row once there's a name.
  function syncAddBar() {
    const p = parseAdd(addInput.value);
    addMin.hidden = !p.minutes;
    if (p.minutes) addMin.textContent = fmtMin(p.minutes);
    const day = p.date || selected;
    addDay.replaceChildren(icon('calendar', 14), h('span', { text: shortDay(day) }));
    addDay.classList.toggle('typed', !!p.date);
    addDay.setAttribute('aria-label', `For ${fmtWeekday(day)}, ${fmtMonthDay(day)}${p.date ? ', from what you typed' : ''}. Change the day`);
    addDay.hidden = addKind === 'habit';
    const showRepeat = addKind === 'habit' && !!addInput.value.trim();
    if (showRepeat && repeatRow.hidden) renderRepeat();
    repeatRow.hidden = !showRepeat;
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
  function dayMenu(anchor, onPick, current = selected) {
    const items = [];
    for (let i = 0; i < 7; i++) {
      const d = today0(); d.setDate(d.getDate() + i);
      items.push({ label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtWeekday(d) + ', ' + fmtMonthDay(d),
        icon: ds(d) === ds(current) ? 'check' : 'calendar', onClick: () => onPick(d) });
    }
    items.push('sep', { label: 'Pick a date…', icon: 'calendar', onClick: () => datePop(anchor, onPick, current) });
    openMenu(anchor, items);
  }

  // Any other day: a month like the sidebar's, in a popover. Arrow keys move,
  // Page Up and Page Down change month, Home is today, Escape closes.
  function datePop(anchor, onPick, current) {
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
      grid.replaceChildren(...monthDays(shown, 6).map(d => {
        const sel = ds(d) === ds(current);
        return dayCell(d, shown, {
          class: sel ? ' sel' : '', tabindex: ds(d) === ds(focused) ? '0' : '-1', 'aria-pressed': String(sel),
          onclick: () => { closeMenu(); onPick(d); },
        });
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
    openPop(anchor, pop);
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
    [...addSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (k === 'task'))));
    syncAddBar();
    addInput.setAttribute('aria-label', k === 'habit' ? 'New habit' : 'New task');
    renderDay();
    addInput.focus();
  }

  async function addFromBar() {
    const p = parseAdd(addInput.value);
    if (!p.title) { addInput.focus(); return; }
    if (addKind === 'habit') {
      if (!addDays.some(Boolean)) { toast('Pick at least one day for it'); return; }
      const ok = await addHabit({ name: p.title, duration: p.minutes, days: [...addDays] });
      if (!ok) { toast('You already have a habit with that name'); return; }
      toast(`Added “${p.title}”, ${describeDays(addDays)}`);
      addDays = Array(7).fill(true); renderRepeat();
    } else {
      const day = p.date || selected;
      await hwAddTask(ds(day), { title: p.title, estMin: p.minutes || 30 });
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
    toTop.update();
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
