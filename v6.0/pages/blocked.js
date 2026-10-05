// blocked.js — where a closed site sends you (YouTube, or any other site
// that's switched on). Two faces:
//   daytime: what's left before it opens, with sticky notes around it
//   bedtime: when it opens again, with sleepier notes
// The page's hash is the address you were headed to, so finishing
// your list takes you straight back there.

(() => {
  const card = $('#card');
  const raw = location.hash.slice(1);
  let D = null, face = null, leaving = null;

  // Where you were headed, if it's one of the sites Not Yet closes.
  function backTo() {
    try {
      const u = new URL(raw);
      const site = /^https?:$/.test(u.protocol) && nySiteFor(u.hostname, D.cfg);
      if (site) return { url: u.href, site };
    } catch {}
    const site = nySitesOn(D.cfg)[0] || NY_SITES[0];
    return { url: 'https://' + (site.id === 'youtube' ? 'www.youtube.com' : site.domains[0]) + '/', site };
  }

  const NOTE_COLORS = ['#fbeaa5', '#f9cfe1', '#c9edda', '#cbe3fa', '#ddd1fb', '#ffd9c4'];
  const BED_COLORS = ['#ddd1fb', '#cbe3fa', '#fbeaa5', '#f9cfe1'];

  // The logo on the card goes to the planner, like everywhere else.
  const homeLink = () => h('a', { class: 'home', href: 'planner.html', title: 'Open the planner', 'aria-label': 'Not yet. Open the planner' }, logoSvg(34));

  function headline(before, marked, after = '.') {
    return h('h1', { class: 'headline display' }, before, h('span', { class: 'swipe', text: marked }), after);
  }

  // ── Daytime: what's left ──────────────────────────────────────────────────
  function lockedFace(g) {
    const now = new Date();
    const habits = habitsOn(D.store.tasks, now).map(hb => ({
      title: hb.name, done: habitDoneOn(D.store.weeks, hb.name, now), min: hb.duration,
      timer: D.store.activeTimers[hb.name] ? { habit: hb.name } : null, color: 'mint',
    }));
    const tasks = hwGatingTasks(D.hw, now).map(t => ({
      title: t.title, done: t.done, min: t.estMin, course: t.course,
      timer: D.timers[t.id] && D.timers[t.id].taskDate === hwTodayStr(now) ? { task: t.id } : null,
    }));
    const all = [...habits, ...tasks].sort((a, b) => a.done - b.done);
    const shown = all.slice(0, 6);
    const left = g.counts.left, total = g.counts.total;

    const items = h('ul', { class: 'items' }, ...shown.map(it => {
      const li = h('li', { class: it.done ? 'done' : '' },
        h('span', { class: 'box', 'aria-hidden': 'true' }, it.done ? icon('check', 13) : null),
        it.course !== undefined ? setVars(h('span', { class: 'dot' }), subjectVars(it.course)) : null,
        h('span', { class: 't' }, h('span', { class: it.done ? 'swipe' : '', text: it.title })));
      if (it.done) li.querySelector('.swipe').style.setProperty('--hl', it.course !== undefined ? subjectVars(it.course)['--hl'] : 'var(--hl-mint)');
      if (it.timer) li.append(h('span', { class: 'm live', ...(it.timer.task ? { 'data-task': it.timer.task } : { 'data-habit': it.timer.habit }) }));
      else if (it.min && !it.done) li.append(h('span', { class: 'm', text: fmtMin(it.min) }));
      li.prepend(h('span', { class: 'sr-only', text: it.done ? 'Done: ' : 'Not done: ' }));
      return li;
    }));
    if (all.length > shown.length) items.append(h('li', { class: 'more', text: `and ${all.length - shown.length} more` }));

    const pct = total ? Math.round((total - left) / total * 100) : 0;
    card.className = 'card';
    card.replaceChildren(
      homeLink(),
      headline('Not ', 'yet.', ''),
      h('p', { class: 'sub' }, left === 1 ? `One thing left before ${nySitesLabel(D.cfg)}.`
        : h('span', {}, h('b', { text: String(left) }), ` things left before ${nySitesLabel(D.cfg)}.`)),
      h('div', { class: 'meter-row' },
        h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Done today', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
          h('i', { style: { width: pct + '%' } })),
        h('span', { class: 'num', text: `${total - left} of ${total}` })),
      items,
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-primary btn-lg', href: 'planner.html' }, icon('calendar', 18), 'Open the planner')));
    document.title = `Not yet. ${left} left`;
  }

  // ── All done ──────────────────────────────────────────────────────────────
  function openFace(g) {
    if (leaving) return;
    const back = backTo();
    if (g.why === 'break' || document.hidden) { location.replace(back.url); return; }   // nobody's watching a countdown
    let n = 3;
    const count = h('span', { class: 'count-back', text: String(n) });
    card.className = 'card yay';
    card.replaceChildren(
      homeLink(),
      headline('Go on, ', 'then.', ''),
      h('p', { class: 'sub' }, `Everything’s done. Back to ${back.site.name} in `, count, '.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary btn-lg', href: back.url }, icon('unlock', 18), 'Go now')));
    document.title = 'All done.';
    leaving = setInterval(() => {
      n -= 1; count.textContent = String(Math.max(0, n));
      if (n <= 0) { clearInterval(leaving); location.replace(back.url); }
    }, 1000);
  }

  // ── Bedtime ───────────────────────────────────────────────────────────────
  function bedFace(g) {
    document.body.classList.add('bed');
    const clock = h('p', { class: 'clock num', 'aria-hidden': 'true', text: nyClock(Date.now()) });
    card.className = 'card';
    card.replaceChildren(
      h('div', { class: 'moon', 'aria-hidden': 'true' }, icon('moon', 30)),
      h('h1', { class: 'headline display', text: 'Bedtime.' }),
      clock,
      h('p', { class: 'sub' }, nySitesOn(D.cfg).length === 1 ? `${nySitesLabel(D.cfg)}’s back at ` : 'Everything opens again at ',
        h('b', { text: nyClock(g.openTs) }), '.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: 'planner.html#tomorrow' }, icon('calendar', 17), 'Plan tomorrow')));
    document.title = 'Bedtime.';
  }

  // ── Sticky notes around the card ──────────────────────────────────────────
  function pick(arr, k) {
    const copy = [...arr], out = [];
    while (copy.length && out.length < k) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  function drawNotes() {
    document.querySelectorAll('.note').forEach(n => n.remove());
    if (innerWidth < 980) return;
    let items;
    if (face === 'bed') {
      items = pick(D.cfg.bedNotes, 6).map((text, i) => ({ text, color: BED_COLORS[i % BED_COLORS.length] }));
    } else {
      const own = (D.notes || []).filter(n => n.content && n.content.trim()).slice(0, 3)
        .map(n => ({ text: n.content.trim(), color: NOTE_COLORS[NOTE_HEX.indexOf(n.color)] || n.color || NOTE_COLORS[0] }));
      items = [...own, ...pick(D.cfg.lockNotes, Math.max(3, 6 - own.length))
        .map((text, i) => ({ text, color: NOTE_COLORS[(i + own.length) % NOTE_COLORS.length] }))];
    }
    const W = innerWidth, H = innerHeight, nW = 230, nH = 190, pad = 24, gap = 28;
    const c = card.getBoundingClientRect();
    const zones = [
      [pad, c.left - nW - gap, pad, H - nH - pad],
      [c.right + gap, W - nW - pad, pad, H - nH - pad],
    ].filter(([x1, x2, y1, y2]) => x2 >= x1 && y2 >= y1);
    if (!zones.length) return;
    // Each side is cut into rows a note tall; notes take random rows, jittered
    // inside them, so they scatter without ever landing on each other.
    const per = Math.max(1, Math.floor((H - pad * 2) / (nH + 26)));
    const slots = zones.flatMap(z => Array.from({ length: per }, (_, r) => ({ z, r })));
    const chosen = pick(slots, items.length);
    items.slice(0, chosen.length).forEach((it, i) => {
      const { z, r } = chosen[i];
      const band = (z[3] - z[2] + nH) / per;
      const x = z[0] + Math.random() * Math.max(0, z[1] - z[0]);
      const y = z[2] + band * r + Math.random() * Math.max(0, band - nH - 16);
      document.body.append(h('div', { class: 'note', 'aria-hidden': 'true', text: it.text,
        style: { left: x + 'px', top: y + 'px', background: it.color, transform: `rotate(${(Math.random() - .5) * 8}deg)` } }));
    });
  }
  // Colours v5 saved notes with, mapped onto today's palette.
  const NOTE_HEX = ['#fef9c3', '#fce7f3', '#dcfce7', '#dbeafe', '#ede9fe'];

  // ── Live parts ────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!D) return;
    const clock = card.querySelector('.clock');
    if (clock) clock.textContent = nyClock(Date.now());
    for (const el of card.querySelectorAll('[data-task]')) {
      const t = D.timers[el.dataset.task];
      if (t) el.textContent = nyFmtMs(hwTimerMs(t));
    }
    for (const el of card.querySelectorAll('[data-habit]')) {
      const t = D.store.activeTimers[el.dataset.habit];
      if (t) el.textContent = nyFmtMs(habitLeftMs(t));
    }
  }, 500);

  async function render() {
    D = await nyLoadAll();
    const g = nyGate(D.store, D.hw);
    const next = g.why === 'bed' ? 'bed' : g.open ? 'open' : 'locked';
    if (face === 'bed' && next !== 'bed') { location.reload(); return; }   // morning: start fresh
    const first = face === null || (face !== next && next === 'bed');
    face = next;
    if (next === 'bed') bedFace(g);
    else if (next === 'open') openFace(g);
    else lockedFace(g);
    if (first) drawNotes();
  }

  onStorage(render);
  setInterval(render, 30000);                  // bedtime and morning arrive on the clock, not in storage
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawNotes, 200); });
  hwRollForward().then(render);
})();
