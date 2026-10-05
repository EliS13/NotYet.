// stats.js — Your stats: the numbers, time per subject, your guesses, when you
// focus, and each week. Everything comes from what's already stored.

(async () => {
  let D = await nyLoadAll();
  $('#brand').append(logoSvg(26), h('span', { text: 'Not yet.' }));
  $('#to-planner').append(icon('calendar', 16), 'Planner');

  // ?week=<Sunday> shows that week (from the Sunday review); otherwise this week, or the last four
  const params = new URLSearchParams(location.search);
  const sunday = /^\d{4}-\d{2}-\d{2}$/.test(params.get('week') || '') ? params.get('week') : null;
  let range = params.get('range') === 'month' ? 'month' : 'week';
  const short = ds => nyParseDs(ds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hourName = hr => new Date(2000, 0, 1, hr % 24).toLocaleTimeString([], { hour: 'numeric' });

  function span() {
    const today = hwTodayStr();
    if (range === 'month') return { from: nyDsAdd(today, -27), to: today, label: `${short(nyDsAdd(today, -27))} to today` };
    if (sunday) { const w = nyWeekRange(sunday); return { ...w, label: `${short(w.from)} to ${short(w.to)}` }; }
    const monday = nyDsAdd(today, -((nyParseDs(today).getDay() + 6) % 7));
    return { from: monday, to: today, label: monday === today ? 'Today' : `${short(monday)} to today` };
  }

  function render() {
    const r = span(), s = nyStats(D.hw.hwTasksByDay, D.hw.hwLog, D.doneDays, r), streak = nyStreak(D.doneDays, hwTodayStr());
    $('#st-range').replaceChildren(...[['week', sunday ? 'That week' : 'This week'], ['month', 'Last 4 weeks']].map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(range === k), onclick: () => { range = k; render(); } }, label)));
    $('#st-when').textContent = r.label;

    const num = (value, label, note) => h('div', { class: 'st-num' }, h('b', { text: value }), h('span', { text: label }), note ? h('small', { text: note }) : null);
    $('#st-nums').replaceChildren(
      num(s.minutes ? fmtMin(s.minutes) : '0m', 'Time focused', 'with a timer running'),
      num(String(s.done), s.done === 1 ? 'Task done' : 'Tasks done'),
      num(`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`, 'Streak', streak.best > streak.current ? `best ${streak.best}` : 'finished before bedtime'));

    const empty = text => h('p', { class: 'st-empty', text });

    // Time per subject, longest first
    const top = Math.max(1, ...s.bySubject.map(x => x.minutes));
    $('#st-subjects').replaceChildren(...(s.bySubject.length ? s.bySubject.map(x => {
      const sub = nySubject(x.id), c = nyColorCss(sub.color);
      return setVars(h('div', { class: 'st-subject' },
        h('span', { class: 'dot', 'aria-hidden': 'true' }), h('b', { text: sub.name }),
        h('span', { class: 'st-bar', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(3, x.minutes / top * 100) + '%' } })),
        h('span', { class: 'st-v', text: `${fmtMin(x.minutes)} · ${x.count} ${x.count === 1 ? 'task' : 'tasks'}` })), { '--c': c.dot, '--hl': c.hl });
    }) : [empty('Finish a task with its timer running and it shows up here.')]));

    // Guesses against real time, the biggest gap first. They need three timed tasks
    // a subject, so a single week borrows the last four weeks (and says so).
    const wide = range === 'week' && !sunday ? nyStats(D.hw.hwTasksByDay, D.hw.hwLog, D.doneDays, { from: nyDsAdd(hwTodayStr(), -27), to: hwTodayStr() }) : s;
    $('#st-guess-note').textContent = wide === s ? '' : 'From your last 4 weeks';
    $('#st-guesses').replaceChildren(...(wide.guesses.length ? wide.guesses.map(g => {
      const sub = nySubject(g.id), c = nyColorCss(sub.color), off = Math.abs(g.ratio - 1);
      const verdict = off < .1 ? 'Spot on' : g.ratio > 1 ? `Takes you ${g.ratio.toFixed(1)}× your guess` : `Done in ${Math.round(g.ratio * 100)}% of your guess`;
      const tip = off >= .2 ? ` Try guessing ${fmtMin(Math.round(g.act / 5) * 5)}.` : '';
      return setVars(h('div', { class: 'st-guess' + (off < .1 ? ' ok' : g.ratio > 1 ? ' over' : ' under') },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('div', {}, h('b', { text: sub.name }), h('small', { text: `You guess ${fmtMin(g.est)}, it takes ${fmtMin(Math.round(g.act))}.${tip}` })),
        h('span', { class: 'st-verdict', text: verdict })), { '--c': c.dot, '--hl': c.hl });
    }) : [empty('After three timed tasks in a subject, you’ll see how your guesses compare.')]));

    // Hours, 6 AM to midnight, shaded by how many timed tasks started in each
    const hrs = Array.from({ length: 18 }, (_, i) => i + 6), most = Math.max(0, ...hrs.map(x => s.hours[x]));
    if (!most) $('#st-hours').replaceChildren(empty('Your timed tasks show here by the hour you started them.'));
    else {
      let best = 6;
      for (const x of hrs.slice(0, -1)) if (s.hours[x] + s.hours[x + 1] > s.hours[best] + s.hours[best + 1]) best = x;
      $('#st-hours').replaceChildren(
        h('p', { class: 'st-line' }, 'Most of your work starts ', h('b', { text: `${hourName(best)} to ${hourName(best + 2)}` }), '.'),
        h('div', { class: 'st-strip', role: 'img', 'aria-label': hrs.filter(x => s.hours[x]).map(x => `${hourName(x)}: ${s.hours[x]}`).join(', ') },
          ...hrs.map(x => setVars(h('i', { title: `${hourName(x)}: ${s.hours[x]} timed` }), { '--a': s.hours[x] / most }))),
        h('div', { class: 'st-strip-k', 'aria-hidden': 'true' }, ...[6, 12, 18, 23].map(x => h('span', { text: hourName(x) }))));
    }

    // The last eight weeks of timed minutes; the week being shown stands out
    const wmax = Math.max(1, ...s.weeks.map(w => w.minutes));
    $('#st-weeks').replaceChildren(s.weeks.some(w => w.minutes)
      ? h('div', { class: 'st-weeks', role: 'img', 'aria-label': s.weeks.map(w => `Week of ${short(w.from)}: ${fmtMin(w.minutes)}`).join(', ') },
        ...s.weeks.map((w, i) => h('div', { class: 'st-week' + (i === s.weeks.length - 1 ? ' now' : '') },
          h('span', { class: 'st-wv', text: w.minutes ? fmtMin(w.minutes) : '' }),
          h('span', { class: 'st-col' }, h('i', { style: { height: Math.max(w.minutes ? 4 : 0, w.minutes / wmax * 100) + '%' } })),
          h('span', { class: 'st-wk', text: short(w.from) }))))
      : empty('Each week’s timed work shows up here.'));
  }

  render();
  onStorage(async () => { D = await nyLoadAll(); render(); });
})();
