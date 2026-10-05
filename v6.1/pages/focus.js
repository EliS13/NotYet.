// focus.js — a full-screen clock for one task. The address says which:
// focus.html#2026-09-28/cal-abc123. The clock itself runs in the background,
// so closing this tab doesn't stop it.

(() => {
  const [key, id] = location.hash.slice(1).split('/').map(decodeURIComponent);
  const root = $('#focus');
  $('#brand').append(logoSvg(26), h('span', { text: 'Not yet.' }));
  let D = null, task = null, timer = null;

  function segments(t) {
    const bars = [];
    let from = 0;
    const offs = t.breakOffsets || [];
    const el = nyElapsed(t);
    const push = (len, brk) => {
      const done = Math.max(0, Math.min(1, (el - from) / len));
      bars.push(h('i', { class: brk ? 'brk' : '' }, h('b', { style: { width: done * 100 + '%' } })));
      from += len;
    };
    for (const off of offs) { push(off - from, false); push(HW_BREAK_MS, true); }
    push(t.totalMs - from, false);
    return h('div', { class: 'segs', 'aria-hidden': 'true' }, ...bars);
  }

  function draw() {
    if (!task) {
      root.replaceChildren(h('p', { class: 'f-done', text: 'That task isn’t here anymore.' }));
      return;
    }
    const sub = nySubject(task.course);
    const chip = h('span', { class: 'chip' }, setVars(h('span', { class: 'dot' }), subjectVars(task.course)), sub.name);
    const title = h('h1', { class: 'f-title', text: task.title });
    document.title = task.title;

    if (task.done) {
      root.className = 'focus';
      root.replaceChildren(chip, title, h('p', { class: 'f-done', text: task.actualMin ? `Done, in ${fmtMin(task.actualMin)}. Nice.` : 'Done. Nice.' }),
        h('div', { class: 'f-actions' }, h('a', { class: 'btn btn-primary btn-lg', href: 'planner.html' }, 'Back to the planner')));
      return;
    }

    if (!timer) {
      const phase = hwPhase(D.hw.hwSettings);
      const up = phase === 'calibration' || task.type === 'Q';
      root.className = 'focus';
      root.replaceChildren(chip, title,
        h('p', { class: 'f-clock num', text: up ? '0:00' : nyFmtMs(task.estMin * 60000) }),
        h('p', { class: 'f-note', text: up ? `Stopwatch. Aim for about ${fmtMin(task.estMin)}.` : `Countdown. It ticks itself off at zero.` }),
        h('div', { class: 'f-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => hwStartTimer(task, phase, key) }, icon('play', 17), 'Start'),
          h('button', { type: 'button', class: 'btn btn-lg', title: 'Five minutes, then decide', onclick: () => hwJustStart(task, key) }, 'Just 5 minutes')));
      return;
    }

    // "Just 5 minutes" is up: the stopwatch carries on, and asks
    if (timer.askKeepGoing) {
      root.className = 'focus';
      root.replaceChildren(chip, title, h('p', { class: 'f-clock num', id: 'clock' }),
        h('p', { class: 'f-note', text: 'Five minutes in. Keep going?' }),
        h('div', { class: 'f-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => hwKeepGoing(id, true) }, icon('play', 17), 'Keep going'),
          h('button', { type: 'button', class: 'btn btn-lg btn-quiet', onclick: () => hwKeepGoing(id, false) }, 'Stop here')));
      $('#clock').textContent = nyFmtMs(hwTimerMs(timer));
      return;
    }

    const brk = timer.mode === 'down' && hwOnBreak(timer);
    const clock = h('p', { class: 'f-clock num' + (timer.pausedAt ? ' paused' : ''), id: 'clock' });
    const note = h('p', { class: 'f-note', id: 'note' });
    root.className = 'focus' + (brk ? ' f-break' : '');
    root.replaceChildren(chip, title, clock, note,
      timer.mode === 'down' && (timer.breakOffsets || []).length ? segments(timer) : '',
      h('div', { class: 'f-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => hwPauseTimer(id, !timer.pausedAt) },
          icon(timer.pausedAt ? 'play' : 'pause', 17), timer.pausedAt ? 'Keep going' : 'Pause'),
        h('button', { type: 'button', class: 'btn btn-lg', onclick: () => hwSetDone(key, id, true) }, icon('check', 17), 'Done'),
        h('button', { type: 'button', class: 'btn btn-lg btn-quiet', onclick: async () => {
          if (await confirmBox({ title: 'Cancel this timer?', body: 'The time so far won’t be saved.', yes: 'Cancel timer', no: 'Keep it', danger: true })) hwStopTimer(id);
        } }, 'Cancel')));
    tick();
  }

  function tick() {
    const clock = $('#clock'), note = $('#note');
    if (!clock || !timer) return;
    clock.textContent = nyFmtMs(hwTimerMs(timer));
    if (timer.pausedAt) { note.textContent = 'Paused.'; return; }
    if (timer.askKeepGoing) return;
    if (timer.justStart) { note.textContent = 'Just five minutes. Then you decide.'; return; }
    if (timer.mode === 'up') {
      const left = task.estMin * 60000 - nyElapsed(timer);
      note.replaceChildren(left > 0 ? h('span', {}, 'So far. About ', h('b', { text: fmtMin(Math.ceil(left / 60000)) }), ' to go.')
        : 'Past your guess. Finish when it’s good.');
    } else if (hwOnBreak(timer)) {
      note.textContent = 'Break. Everything’s open until the next block.';
    } else {
      note.textContent = 'Left. It ticks itself off at zero.';
    }
  }
  setInterval(() => {
    if (timer && timer.mode === 'down' && hwOnBreak(timer) !== root.classList.contains('f-break')) draw();
    else tick();
  }, 250);

  // The focus sound, in the corner: what plays while the timer runs
  const SOUND_NAMES = { off: 'No sound', brown: 'Brown noise', rain: 'Rain', waves: 'Waves' };
  const soundBtn = h('button', { type: 'button', class: 'btn btn-sm btn-quiet f-sound', 'aria-haspopup': 'menu',
    onclick: e => openMenu(e.currentTarget, NY_SOUNDS.map(s => ({ label: SOUND_NAMES[s], icon: s === NY_CFG.focusSound ? 'check' : null,
      onClick: () => nySaveConfig({ focusSound: s }) }))) });
  $('.top').append(soundBtn);
  const drawSound = () => {
    soundBtn.replaceChildren(icon('sound', 15), h('span', { text: NY_CFG.focusSound === 'off' ? 'Sound off' : SOUND_NAMES[NY_CFG.focusSound] }));
    soundBtn.setAttribute('aria-label', `Focus sound: ${SOUND_NAMES[NY_CFG.focusSound]}. Change`);
  };

  async function load() {
    D = await nyLoadAll();
    drawSound();
    task = (D.hw.hwTasksByDay[key] || []).find(t => t.id === id) || null;
    timer = D.timers[id] && D.timers[id].taskDate === key ? D.timers[id] : null;
    draw();
  }
  onStorage(load);
  load();
})();
