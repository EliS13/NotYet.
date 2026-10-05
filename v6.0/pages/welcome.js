// welcome.js — first-run setup: what Not Yet does, then habits, sites, bedtime
// and the calendar, then pinning. Every step can be skipped.

(async () => {
  let D = await nyLoadAll();
  let cfg = D.cfg;
  const panel = $('#panel'), stepsEl = $('#steps');
  const STEPS = [hello, habits, sites, bedtime, calendar, finish];
  let at = 0;

  function go(n) {
    at = n;
    stepsEl.replaceChildren(...STEPS.slice(1).map((_, i) =>
      h('li', { class: i + 1 === at ? 'now' : i + 1 < at ? 'past' : '', 'aria-current': i + 1 === at ? 'step' : null },
        h('span', { class: 'sr-only', text: `Step ${i + 1} of ${STEPS.length - 1}` }))));
    stepsEl.style.visibility = at === 0 ? 'hidden' : 'visible';
    panel.replaceChildren(...STEPS[at]());
    scrollTo(0, 0);
  }

  const actions = (...btns) => h('div', { class: 'w-actions' }, ...btns);
  const backBtn = () => h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => go(at - 1) }, icon('left', 16), 'Back');
  const nextBtn = (label, fn) => h('button', { type: 'button', class: 'btn btn-primary btn-lg grow', onclick: fn }, label);

  // ── 0. What this is ───────────────────────────────────────────────────────
  function pill(state, ic, text) {
    return h('div', { class: 'status', 'data-state': state }, icon(ic, 15), h('span', { text }));
  }
  function hello() {
    return [
      logoSvg(44),
      h('h1', { class: 'w-title display' }, 'Not ', h('span', { class: 'swipe', text: 'yet.' })),
      h('p', { class: 'w-sub', text: 'Keeps you on task and helps you develop good habits throughout the week. YouTube and other social media stay blocked until the day’s worth of work is done.' }),
      h('ol', { class: 'loop', 'aria-label': 'How a day goes' },
        h('li', {}, h('div', { class: 'loop-top' }, pill('tasks', 'lock', '3 left'), h('span', { class: 'dots' })), h('p', { text: 'Do the list.' })),
        h('li', {}, h('div', { class: 'loop-top' }, pill('done', 'unlock', 'All done'), h('span', { class: 'dots' })), h('p', { text: 'Watch whatever you want.' })),
        h('li', {}, h('div', { class: 'loop-top' }, pill('bed', 'moon', 'Bedtime')), h('p', { text: 'Then sleep. Seriously.' }))),
      actions(
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: finishNow }, 'Skip setup'),
        nextBtn('Set it up', () => go(1))),
      h('p', { class: 'w-fine' }, icon('lock', 14), 'Everything you add stays in this browser. ',
        h('a', { href: 'privacy.html', text: 'Privacy policy' })),
    ];
  }

  // ── 1. Habits ─────────────────────────────────────────────────────────────
  const IDEAS = [['Read', 20], ['Practice music', 20], ['Exercise', 30], ['Stretch', null],
    ['Journal', 10], ['Make my bed', null], ['Tidy my room', 10]];
  const picked = new Map();
  const have = new Set(D.store.tasks.map(t => t.name));   // already set up; setup never deletes
  for (const hb of D.store.tasks) picked.set(hb.name, hb.duration || null);

  function habits() {
    const box = h('div', { class: 'picks', role: 'group', 'aria-label': 'Habits' });
    const draw = () => {
      const names = new Set([...IDEAS.map(i => i[0]), ...picked.keys()]);
      box.replaceChildren(...[...names].map(name => {
        const min = picked.has(name) ? picked.get(name) : (IDEAS.find(i => i[0] === name) || [])[1];
        const on = picked.has(name);
        return h('button', { type: 'button', class: 'pick', 'aria-pressed': String(on), disabled: have.has(name),
          onclick: () => { on ? picked.delete(name) : picked.set(name, min ?? null); draw(); } },
          icon(on ? 'check' : 'plus', 16), name, min ? h('span', { class: 'chip', text: fmtMin(min) }) : null);
      }));
    };
    draw();
    const own = h('input', { class: 'input', placeholder: 'Something else, like “Walk the dog 15m”', maxlength: '60', 'aria-label': 'Add your own habit' });
    const addOwn = () => {
      const m = own.value.match(/^(.*?)\s+(\d{1,3})\s*m(in)?$/i);
      const name = (m ? m[1] : own.value).trim();
      if (!name) return;
      picked.set(name, m ? +m[2] : null); own.value = ''; draw(); own.focus();
    };
    own.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } });
    return [
      h('h2', { class: 'w-h', text: 'What do you do every day?' }),
      h('p', { class: 'w-sub', text: 'These have to be ticked off before YouTube opens. The ones with minutes get a timer.' }),
      box,
      h('div', { class: 'own' }, own, h('button', { type: 'button', class: 'btn', onclick: addOwn }, 'Add')),
      actions(backBtn(), nextBtn('Next', async () => {
        for (const [name, min] of picked) if (!have.has(name)) await addHabit({ name, duration: min });
        D = await nyLoadAll();
        go(2);
      })),
    ];
  }

  // ── 2. Sites ──────────────────────────────────────────────────────────────
  function sites() {
    const box = h('div', { class: 'picks', role: 'group', 'aria-label': 'Sites' });
    const msg = h('p', { class: 'cal-msg', role: 'status' });
    const draw = () => box.replaceChildren(...NY_SITES.map(site => {
      const on = cfg.sitesOn.includes(site.id) && !cfg.sitesOffFrom[site.id];
      return h('button', { type: 'button', class: 'pick', 'aria-pressed': String(on), onclick: async () => {
        if (!on && site.id !== 'youtube') {
          const ok = await chrome.permissions.request({ origins: site.domains.map(d => `https://*.${d}/*`) });
          if (!ok) { msg.className = 'cal-msg err'; msg.textContent = `To close ${site.name}, Chrome needs you to choose Allow. Tap it again to try once more.`; return; }
        }
        msg.textContent = '';
        if (!cfg.onboarded) {
          const sitesOn = on ? cfg.sitesOn.filter(x => x !== site.id) : [...cfg.sitesOn, site.id];
          cfg = await nySaveConfig({ sitesOn });
        } else {
          const plan = nyPlanSite(cfg, site.id, !on);
          cfg = await nySaveConfig({ sitesOn: plan.cfg.sitesOn, sitesOffFrom: plan.cfg.sitesOffFrom });
        }
        draw();
      } }, icon(on ? 'check' : 'plus', 16), site.name);
    }));
    draw();
    return [
      h('h2', { class: 'w-h', text: 'What should wait?' }),
      h('p', { class: 'w-sub', text: 'These stay closed until your list is done, and close again at bedtime. You can add any other site in Settings.' }),
      box, msg,
      actions(backBtn(), nextBtn('Next', () => go(3))),
    ];
  }

  // ── 3. Bedtime ────────────────────────────────────────────────────────────
  function bedtime() {
    const b = cfg.bedNext ? cfg.bedNext.bed : cfg.bed;
    const pickTime = (id, from, to, value) => {
      const sel = h('select', { class: 'select', id });
      for (let m = from; m <= to; m += 15) sel.append(h('option', { value: String(m) }, nyClockMin(m).replace(/^./, c => c.toUpperCase())));
      sel.value = String(value);
      return sel;
    };
    const school = pickTime('w-school', NY_BED_MIN, NY_BED_MAX, b.school);
    const other = pickTime('w-other', NY_BED_MIN, NY_BED_MAX, b.other);
    const wake = pickTime('w-wake', NY_WAKE_MIN, NY_WAKE_MAX, b.wake);
    let days = [...b.days];
    const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn() % 7 + i) % 7);
    const chips = h('div', { class: 'days', role: 'group', 'aria-label': 'School days' });
    const drawDays = () => chips.replaceChildren(...order.map(n => h('button', {
      type: 'button', class: 'day', 'aria-pressed': String(days.includes(n)),
      'aria-label': new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'long' }),
      onclick: () => { days = days.includes(n) ? days.filter(x => x !== n) : [...days, n]; drawDays(); },
    }, new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'narrow' }))));
    drawDays();
    return [
      h('h2', { class: 'w-h', text: 'When’s bedtime?' }),
      h('p', { class: 'w-sub', text: 'Everything closes at bedtime, even halfway through a video, and opens again in the morning.' }),
      h('div', { class: 'bed-grid' },
        h('label', { for: 'w-school' }, 'School nights', school),
        h('label', { for: 'w-other' }, 'Other nights', other),
        h('label', { for: 'w-wake' }, 'Opens again at', wake)),
      h('div', { class: 'bed-days' }, h('span', { text: 'School days' }), chips),
      h('p', { class: 'aside', text: 'Earlier bedtimes start right away. Later ones always wait until tomorrow, so you can’t push tonight’s bedtime back.' }),
      actions(backBtn(), nextBtn('Next', async () => {
        const next = { ...b, days, school: +school.value, other: +other.value, wake: +wake.value };
        if (!cfg.onboarded) cfg = await nySaveConfig({ bed: nyCleanBed(next), bedNext: null });
        else { const plan = nyPlanBed(cfg, next); cfg = await nySaveConfig({ bed: plan.cfg.bed, bedNext: plan.cfg.bedNext }); }
        go(4);
      })),
    ];
  }

  // ── 4. Calendar ───────────────────────────────────────────────────────────
  function calendar() {
    const tag = (cfg.tags.find(t => t.mark) || { mark: '📝' }).mark;
    const input = h('input', { class: 'input', type: 'url', placeholder: 'Paste your calendar’s secret iCal address', value: D.hw.hwSettings.icsUrl || '',
      'aria-label': 'Secret calendar address', spellcheck: 'false' });
    const msg = h('p', { class: 'cal-msg', role: 'status' });
    const say = (text, cls = '') => { msg.className = 'cal-msg ' + cls; msg.textContent = text; };
    const connect = async () => {
      const url = nyFeedUrl(input.value);
      if (!url) return say('Paste the address first.', 'err');
      let origin;
      try { origin = new URL(url).origin; } catch { return say('That doesn’t look like a link.', 'err'); }
      if (!(await chrome.permissions.request({ origins: [origin + '/*'] }))) return say('To read your calendar, Chrome needs you to choose Allow. Press Connect to try again.', 'err');
      await chrome.storage.local.set({ hwSettings: { ...D.hw.hwSettings, icsUrl: url } });
      say('Connecting…');
      try {
        const added = await hwSyncFromCalendar({ force: true });
        D = await nyLoadAll();
        say(added ? `Connected. Found ${added} task${added === 1 ? '' : 's'} for today.` : 'Connected. Nothing tagged for today yet.', 'ok');
      } catch (e) { say(String(e.message || e), 'err'); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
    return [
      h('h2', { class: 'w-h', text: 'Homework in Google Calendar?' }),
      h('p', { class: 'w-sub' }, 'Start an event with ', h('span', { class: 'tag-chip', text: tag }), ' and it turns into a task here. Add ',
        h('span', { class: 'tag-chip', text: '[45m]' }), ' to say how long it takes.'),
      h('div', { class: 'demo', 'aria-hidden': 'true' },
        h('div', { class: 'demo-ev' }, `${tag} Algebra worksheet [45m]`, h('small', { text: 'Tue, 4:00 PM' })),
        h('span', { class: 'demo-arrow' }, icon('right', 22)),
        h('div', { class: 'demo-task' }, h('span', { class: 'box' }), setVars(h('span', { class: 'dot' }), subjectVars('math')),
          h('span', { class: 't', text: 'Algebra worksheet' }), h('span', { class: 'm', text: '45m' }))),
      h('div', { class: 'connect' }, input, h('button', { type: 'button', class: 'btn', onclick: connect }, 'Connect')),
      msg,
      h('details', { class: 'how' }, h('summary', { text: 'Where do I find that?' }),
        h('ol', {},
          h('li', {}, 'Open Google Calendar on a computer, click the gear, then ', h('b', { text: 'Settings' }), '.'),
          h('li', {}, 'Under ', h('b', { text: 'Settings for my calendars' }), ', pick your calendar.'),
          h('li', {}, 'Copy ', h('b', { text: 'Secret address in iCal format' }), '.'))),
      actions(backBtn(), h('button', { type: 'button', class: 'btn btn-quiet grow', onclick: () => go(5) }, 'Skip'),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => go(5) }, 'Next')),
    ];
  }

  // ── 5. Pin it ─────────────────────────────────────────────────────────────
  function finish() {
    return [
      h('h2', { class: 'w-h', text: 'You’re set.' }),
      h('p', { class: 'w-sub', text: 'One last thing: pin it to your toolbar so your list is one click away.' }),
      h('div', { class: 'pin' },
        h('figure', { class: 'pin-step' },
          h('div', { class: 'pin-bar', 'aria-hidden': 'true' },
            h('span', { class: 'omni' }), h('span', { class: 'ic hot' }, icon('puzzle', 18)), h('span', { class: 'ic' }, icon('more', 18))),
          h('figcaption', {}, 'Click the puzzle piece, top right of Chrome.')),
        h('figure', { class: 'pin-step' },
          h('div', { class: 'pin-menu', 'aria-hidden': 'true' },
            logoSvg(22), h('span', { class: 'pin-name', text: 'Not yet.' }), h('span', { class: 'ic hot' }, icon('pin', 17))),
          h('figcaption', {}, 'Then the pin next to Not yet.'))),
      actions(backBtn(), nextBtn('Open the planner', finishNow)),
    ];
  }

  async function finishNow() {
    await nySaveConfig({ onboarded: true });
    location.href = 'planner.html';
  }

  go(0);
})();
