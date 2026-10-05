// settings.js — every setting saves the moment it changes.

(async () => {
  let D = await nyLoadAll();
  let cfg = D.cfg;
  const saved = (msg = 'Saved') => toast(msg);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const COLOR_NAMES = NY_COLOR_WORDS;

  $('#brand').append(logoSvg(26), h('span', { text: 'Not yet.' }));
  $('#to-planner').append(icon('calendar', 16), 'Planner');

  // ── Section nav ───────────────────────────────────────────────────────────
  const NAV = [['bedtime', 'moon', 'Bedtime'], ['sites', 'lock', 'Sites'], ['connections', 'plug', 'Connections'],
    ['tags', 'tag', 'Tags'], ['subjects', 'palette', 'Subjects'], ['messages', 'note', 'Messages'], ['timers', 'timer', 'Timers'],
    ['appearance', 'sun', 'Appearance'], ['backup', 'download', 'Backup'], ['about', 'info', 'About']];
  const navLinks = NAV.map(([id, ic, label]) => h('a', { href: '#' + id, 'data-id': id }, icon(ic, 17), label));
  $('#nav').append(...navLinks);
  const setCurrent = id => navLinks.forEach(a => {
    a.setAttribute('aria-current', String(a.dataset.id === id));
    if (a.dataset.id === id && $('#nav').scrollWidth > $('#nav').clientWidth) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // the phone row
  });
  setCurrent(location.hash.slice(1) || 'bedtime');
  // The current section is the last one whose top has passed 160px (or 30% of a short window), or the last one at the very bottom,
  // so short sections at the end (About) still light up
  const secs = [...document.querySelectorAll('.sec')];
  let spyQueued = false;
  const spy = () => {
    spyQueued = false;
    const shown = secs.filter(s => s.offsetHeight);
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    const cur = atEnd ? shown.at(-1) : shown.findLast(s => s.getBoundingClientRect().top <= Math.min(innerHeight * .3, 160)) || shown[0];
    if (cur) setCurrent(cur.id);
  };
  addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });

  // ── Bedtime ───────────────────────────────────────────────────────────────
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn() % 7 + i) % 7);
  const dayName = n => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'long' });
  const dayLetter = n => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'narrow' });

  // The app's own time pickers, not the browser's
  const timeChoice = (el, from, to, label) => nyChoice(el, { options: nyTimeOptions(from, to), label, clock: { from, to } });
  timeChoice($('#bed-school'), NY_BED_MIN, NY_BED_MAX, 'Bedtime on school nights');
  timeChoice($('#bed-other'), NY_BED_MIN, NY_BED_MAX, 'Bedtime on other nights');
  timeChoice($('#bed-wake'), NY_WAKE_MIN, NY_WAKE_MAX, 'Everything opens again at');
  nyChoice($('#bed-warn'), { label: 'Heads-up before bedtime',
    options: [[0, 'Off'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before']] });
  nyChoice($('#phase'), { label: 'How task timers run', options: [['target', 'Each task’s own setting'],
    ['calibration', 'Stopwatch for everything'], ['auto', 'Stopwatch for two weeks, then each task’s own']] });

  const shownBed = () => cfg.bedNext ? cfg.bedNext.bed : cfg.bed;

  const borrow = nyBorrow;             // a card's sheet lends it the section's own controls
  const put = (grid, ...cards) => $(grid).replaceChildren(...cards.filter(Boolean));

  function bedCards() {
    const b = shownBed(), wait = cfg.bedNext ? ['wait', `Starts ${fmtWeekday(nyParseDs(cfg.bedNext.from))}`] : null;
    const days = order.filter(n => b.days.includes(n));
    const daysText = days.length === 5 && [1, 2, 3, 4, 5].every(n => days.includes(n)) ? 'Mon–Fri'
      : days.length ? days.map(n => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'short' })).join(' ') : 'No school days';
    const bed = { tile: nyTile('icon', 'moon'), name: 'Bedtime', status: wait };
    const before = { tile: nyTile('icon', 'bell'), name: 'Before bed' };
    put('#bed-cards',
      nyCard({ ...bed, sub: `School nights ${nyClockMin(b.school)} · other nights ${nyClockMin(b.other)} · opens ${nyClockMin(b.wake)} · ${daysText}`,
        onOpen: () => borrow('bed-main', bed) }),
      nyCard({ ...before, sub: `${cfg.warn ? `Heads-up ${cfg.warn} min before` : 'No heads-up'} · ${b.fit ? 'only videos that end in time' : 'any video until bedtime'}`,
        onOpen: () => borrow('bed-before', before) }));
  }

  function renderBed() {
    const b = shownBed();
    $('#bed-days').replaceChildren(...order.map(n => h('button', {
      type: 'button', class: 'day', 'aria-pressed': String(b.days.includes(n)), 'aria-label': dayName(n),
      onclick: () => changeBed({ days: b.days.includes(n) ? b.days.filter(x => x !== n) : [...b.days, n] }),
    }, dayLetter(n))));
    $('#bed-school').value = String(b.school);
    $('#bed-other').value = String(b.other);
    $('#bed-wake').value = String(b.wake);
    $('#bed-fit').setAttribute('aria-checked', String(b.fit));
    $('#bed-warn').value = String(cfg.warn);
    const p = $('#bed-pending');
    p.hidden = !cfg.bedNext;
    if (cfg.bedNext) p.replaceChildren(
      h('span', { text: `Your new bedtime starts ${fmtWeekday(nyParseDs(cfg.bedNext.from))}. Later bedtimes always wait a day, so tonight’s stays the same.` }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
        cfg = await nySaveConfig({ bedNext: null }); renderBed(); saved('Kept your current bedtime');
      } }, 'Undo'));
    bedCards();
  }

  async function changeBed(patch) {
    const plan = nyPlanBed(cfg, { ...shownBed(), ...patch });
    cfg = await nySaveConfig({ bed: plan.cfg.bed, bedNext: plan.cfg.bedNext });
    renderBed();
    saved(plan.when === 'now' ? 'Saved' : `Saved. It starts ${fmtWeekday(nyParseDs(plan.when))}`);
  }
  $('#bed-school').onchange = e => changeBed({ school: +e.target.value });
  $('#bed-other').onchange = e => changeBed({ other: +e.target.value });
  $('#bed-wake').onchange = e => changeBed({ wake: +e.target.value });
  $('#bed-fit').onclick = () => changeBed({ fit: !shownBed().fit });
  $('#bed-warn').onchange = async e => { cfg = await nySaveConfig({ warn: +e.target.value }); saved(); bedCards(); };
  $('#bed-reset').onclick = async () => {
    cfg = await nySaveConfig({ warn: NY_DEFAULTS.warn });
    await changeBed(nyClone(NY_DEFAULTS.bed));
  };
  renderBed();

  // ── Sites ─────────────────────────────────────────────────────────────────
  // Switching a site on asks Chrome for access to it. Switching one off waits
  // until tomorrow, the same deal as a later bedtime.
  const siteMsg = (text, bad = false) => { const m = $('#site-msg'); m.textContent = text; m.className = 'site-msg' + (bad ? ' err' : ''); };

  function renderSites() {
    $('#site-grid').replaceChildren(...nyAllSites(cfg).map(site => {
      const on = cfg.sitesOn.includes(site.id);
      const leaving = cfg.sitesOffFrom[site.id];
      const custom = cfg.customSites.some(s => s.id === site.id);
      return h('div', { class: 'site' + (on ? ' on' : ''), role: 'listitem' },
        h('span', { class: 'site-tile', 'aria-hidden': 'true', text: site.name.charAt(0).toUpperCase() }),
        h('span', { class: 'site-k' }, h('b', { text: site.name }),
          h('small', { text: leaving ? `${site.removeFrom ? 'Off the list' : 'Opens up'} ${fmtWeekday(nyParseDs(leaving))}` : site.domains.join(', ') })),
        leaving ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => toggleSite(site, true) }, 'Undo') : null,
        custom && !site.removeFrom ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${site.name}`, onclick: () => removeSite(site) }, icon('trash', 15)) : null,
        h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on && !leaving), 'aria-label': `Close ${site.name}`,
          onclick: () => toggleSite(site, !(on && !leaving)) }));
    }));
  }

  async function toggleSite(site, on) {
    if (on && site.id !== 'youtube') {
      const ok = await chrome.permissions.request({ origins: site.domains.map(d => `https://*.${d}/*`) });
      if (!ok) return siteMsg(`To close ${site.name}, Chrome needs you to choose Allow. Switch it on again to try once more.`, true);
    }
    const plan = nyPlanSite(cfg, site.id, on);
    cfg = await nySaveConfig({ sitesOn: plan.cfg.sitesOn, sitesOffFrom: plan.cfg.sitesOffFrom, customSites: plan.cfg.customSites });
    siteMsg('');
    renderSites();
    saved(on ? `${site.name} now waits for your list` : `${site.name} opens up ${fmtWeekday(nyParseDs(plan.when))}`);
  }

  // Added today (or already off): gone now. Closing for longer: gone at midnight, like switching it off.
  async function removeSite(site) {
    const plan = nyRemoveSite(cfg, site.id);
    cfg = await nySaveConfig({ customSites: plan.cfg.customSites, sitesOn: plan.cfg.sitesOn, sitesOffFrom: plan.cfg.sitesOffFrom });
    if (plan.when === 'now') chrome.permissions.remove({ origins: site.domains.map(d => `https://*.${d}/*`) }).catch(() => {});
    renderSites();
    saved(plan.when === 'now' ? `${site.name} removed` : `${site.name} leaves the list ${fmtWeekday(nyParseDs(plan.when))}. Closed until then`);
  }

  $('#site-add').onsubmit = async e => {
    e.preventDefault();
    const d = nyCleanDomain($('#site-in').value);
    if (!d) return siteMsg('That doesn’t look like a website. Try something like discord.com.', true);
    if (nySiteFor(d, cfg)) return siteMsg('That one’s already on the list.', true);
    const ok = await chrome.permissions.request({ origins: [`https://*.${d}/*`] });
    if (!ok) return siteMsg(`To close ${d}, Chrome needs you to choose Allow. Add it again to try once more.`, true);
    const site = { id: nyId('site'), name: d, domains: [d], added: nyDateStr() };
    cfg = await nySaveConfig({ customSites: [...cfg.customSites, site], sitesOn: [...cfg.sitesOn, site.id] });
    $('#site-in').value = '';
    siteMsg('');
    renderSites();
    saved(`${d} now waits for your list`);
  };

  $('#sites-reset').onclick = async () => {
    let next = nyPlanSite(cfg, 'youtube', true).cfg;
    for (const id of next.sitesOn.filter(id => id !== 'youtube')) next = nyPlanSite(next, id, false).cfg;
    cfg = await nySaveConfig({ sitesOn: next.sitesOn, sitesOffFrom: next.sitesOffFrom });
    renderSites();
    saved(Object.keys(cfg.sitesOffFrom).length ? 'Back to just YouTube, from tomorrow' : 'Back to just YouTube');
  };
  renderSites();

  // ── Connections (calendars too) ───────────────────────────────────────────
  const connectionsSection = nySettingsConnections({ saved });

  // ── Tags and Subjects (settings-subjects.js) ──────────────────────────────
  const ctx = { get cfg() { return cfg; }, set cfg(v) { cfg = v; }, saved };
  const tagsSection = nySettingsTags(ctx);
  const subjectsSection = nySettingsSubjects(ctx, { onChange: () => { tagsSection.render(); tagsSection.renderTry(); } });

  // ── Messages (settings-messages.js) ───────────────────────────────────────
  const messagesSection = nySettingsMessages(ctx);

  // ── Timers ────────────────────────────────────────────────────────────────
  const phase = $('#phase');
  const mode = D.hw.hwSettings.phaseMode || 'target';
  phase.value = mode;
  const PHASES = { target: 'Each task’s own setting', calibration: 'Stopwatch for everything', auto: 'Stopwatch for two weeks, then each task’s own' };
  phase.onchange = async () => {
    const hw = await getHwState();
    await chrome.storage.local.set({ hwSettings: { ...hw.hwSettings, phaseMode: phase.value,
      installDate: phase.value === 'auto' ? hwTodayStr() : hw.hwSettings.installDate } });
    saved();
    D = await nyLoadAll(); timerCards();
  };

  // The history card's line: how much was timed, and the subject furthest off its guesses
  function historyLine(log) {
    if (!log.length) return 'Nothing timed yet';
    const by = new Map();
    for (const r of log) { const id = nySubject(r.course).id; (by.get(id) || by.set(id, []).get(id)).push(r); }
    let worst = null;
    for (const [id, rs] of by) {
      if (rs.length < 2) continue;
      const diff = Math.round(median(rs.map(r => r.actualMin)) - median(rs.map(r => r.estMin)));
      if (!worst || Math.abs(diff) > Math.abs(worst.diff)) worst = { id, diff };
    }
    const n = `${log.length} timed`;
    if (!worst || !worst.diff) return worst ? `${n} · spot on so far` : n;
    return `${n} · ${nySubject(worst.id).name} runs ${fmtMin(Math.abs(worst.diff))} ${worst.diff > 0 ? 'over' : 'under'}`;
  }
  function timerCards() {
    const run = { tile: nyTile('icon', 'timer'), name: 'How timers run' };
    const hist = { tile: nyTile('icon', 'hourglass'), name: 'How long things really take' };
    const sound = { tile: nyTile('icon', 'sound'), name: 'Focus sounds' };
    put('#timer-cards',
      nyCard({ ...run, sub: PHASES[(D.hw.hwSettings || {}).phaseMode || 'target'], onOpen: () => borrow('timers-run', run) }),
      nyCard({ ...hist, sub: historyLine(D.hw.hwLog || []), onOpen: () => borrow('history', { ...hist, wide: true }) }),
      nyCard({ ...sound, sub: cfg.focusSound === 'off' ? 'Off · a sound while a timer runs'
        : `${SOUND_NAMES[cfg.focusSound]} · ${Math.round(cfg.focusVolume * 100)}%`, onOpen: () => { renderSound(); borrow('timers-sound', sound); } }));
  }

  // Focus sounds: which one, how loud, and a five-second sample
  const SOUND_NAMES = { off: 'Off', brown: 'Brown noise', rain: 'Rain', waves: 'Waves' };
  const vol = $('#sound-vol');
  function renderSound() {
    $('#sound-choice').replaceChildren(...NY_SOUNDS.map(s => h('button', { type: 'button', 'aria-pressed': String(cfg.focusSound === s),
      onclick: async () => { cfg = await nySaveConfig({ focusSound: s }); renderSound(); timerCards(); } }, SOUND_NAMES[s])));
    showVolume(cfg.focusVolume);
    $('#sound-sample').disabled = cfg.focusSound === 'off';
  }
  function showVolume(v) {
    const pct = Math.round(v * 100);
    vol.setAttribute('aria-valuenow', String(pct)); vol.setAttribute('aria-valuetext', `${pct}%`);
    setVars(vol, { '--v': ((v - .1) / .9 * 100) + '%' });
  }
  const saveVolume = async v => { cfg = await nySaveConfig({ focusVolume: Math.round(v * 100) / 100 }); showVolume(cfg.focusVolume); timerCards(); };
  let sliding = null;
  const volAt = x => { const r = vol.getBoundingClientRect(); return .1 + Math.min(1, Math.max(0, (x - r.left) / r.width)) * .9; };
  vol.addEventListener('pointerdown', e => { e.preventDefault(); vol.focus(); vol.setPointerCapture(e.pointerId); sliding = volAt(e.clientX); showVolume(sliding); });
  vol.addEventListener('pointermove', e => { if (sliding != null) { sliding = volAt(e.clientX); showVolume(sliding); } });
  vol.addEventListener('pointerup', () => { if (sliding != null) { const v = sliding; sliding = null; saveVolume(v); } });
  vol.addEventListener('keydown', e => {
    const step = { ArrowLeft: -.1, ArrowDown: -.1, ArrowRight: .1, ArrowUp: .1 }[e.key];
    const next = step != null ? cfg.focusVolume + step : e.key === 'Home' ? .1 : e.key === 'End' ? 1 : null;
    if (next == null) return;
    e.preventDefault();
    saveVolume(Math.min(1, Math.max(.1, next)));
  });
  $('#sound-sample').append(icon('play', 14), 'Play a sample');
  $('#sound-sample').onclick = () => chrome.runtime.sendMessage({ type: 'sound-sample', sound: cfg.focusSound, volume: cfg.focusVolume }).catch(() => {});

  const median = arr => {
    const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function renderHistory() {
    const log = D.hw.hwLog || [];
    const box = $('#history');
    timerCards();
    const allStats = () => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openPage('pages/stats.html') }, icon('chart', 15), 'See all your stats');
    if (!log.length) {
      box.replaceChildren(h('p', { class: 'hist-empty', text: 'Nothing timed yet. Finish a task with its timer running and it lands here.' }));
      return;
    }
    const groups = new Map();
    for (const r of log) {
      const id = nySubject(r.course).id;
      (groups.get(id) || groups.set(id, []).get(id)).push(r);
    }
    const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, rs]) => {
      const sub = nySubject(id);
      const est = Math.round(median(rs.map(r => r.estMin))), act = Math.round(median(rs.map(r => r.actualMin)));
      const diff = act - est;
      const scale = Math.max(est, act) * 1.15 || 1;
      const bar = setVars(h('div', { class: 'bar', role: 'img', 'aria-label': `Guessed ${fmtMin(est)}, took ${fmtMin(act)}` },
        h('i', { style: { width: (act / scale * 100) + '%' } }), h('b', { style: { left: (est / scale * 100) + '%' } })), subjectVars(id));
      return h('tr', {},
        setVars(h('td', { class: 'subj' }, h('span', { class: 'dot' }), sub.name), subjectVars(id)),
        h('td', { text: String(rs.length) }), h('td', { text: fmtMin(est) }), h('td', { text: fmtMin(act) }),
        h('td', {}, bar),
        h('td', { class: diff > 0 ? 'over' : diff < 0 ? 'under' : '', text: diff === 0 ? 'Spot on' : (diff > 0 ? '+' : '−') + fmtMin(Math.abs(diff)) }));
    });
    box.replaceChildren(
      h('table', { class: 'hist' },
        h('thead', {}, h('tr', {}, ...['Subject', 'Times', 'Guessed', 'Took', '', 'Off by'].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...rows)),
      h('div', { class: 'hist-actions' }, allStats(), h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: async () => {
        if (!(await confirmBox({ title: 'Clear your timing history?', body: 'This can’t be undone.', yes: 'Clear', danger: true }))) return;
        await chrome.storage.local.set({ hwLog: [] }); D = await nyLoadAll(); renderHistory();
      } }, 'Clear history')));
  }
  renderHistory();

  // ── Appearance ────────────────────────────────────────────────────────────
  const THEMES = [['system', 'Match computer'], ['light', 'Light'], ['dark', 'Dark']];
  function renderLook() {
    const look = { tile: nyTile('icon', 'sun'), name: 'Look' };
    put('#look-cards', nyCard({ ...look, sub: `${(THEMES.find(([v]) => v === cfg.theme) || THEMES[0])[1]} · ${COLOR_NAMES[cfg.accent]} accent`,
      onOpen: () => borrow('look-main', look) }));
    $('#theme').replaceChildren(...THEMES.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(cfg.theme === v), onclick: () => setLook({ theme: v }) }, label)));
    $('#accent').replaceChildren(...NY_ACCENTS.map(a => setVars(h('button', {
      type: 'button', class: 'accent-dot', 'aria-pressed': String(cfg.accent === a), 'aria-label': COLOR_NAMES[a], title: COLOR_NAMES[a],
      onclick: () => setLook({ accent: a }) }, icon('check', 14)), { '--hl': `var(--hl-${a})`, '--c': `var(--dot-${a})` })));
  }
  async function setLook(patch) { cfg = await nySaveConfig(patch); nyApplyAppearance(cfg); renderLook(); }
  $('#look-reset').onclick = () => setLook({ theme: NY_DEFAULTS.theme, accent: NY_DEFAULTS.accent });

  // ── Backup ────────────────────────────────────────────────────────────────
  const backup = { tile: nyTile('icon', 'download'), name: 'Backup' };
  const over = { tile: nyTile('icon', 'repeat'), name: 'Start over' };
  put('#backup-cards',
    nyCard({ ...backup, sub: 'Save your data to a file, or load one', onOpen: () => borrow('backup-file', backup) }),
    nyCard({ ...over, sub: 'Reset settings, or delete everything', onOpen: () => borrow('backup-start', over) }));
  $('#export').append(icon('download', 16), 'Download backup');
  $('#export').onclick = async () => {
    const data = await chrome.storage.local.get(null);
    delete data.ytGate;
    delete data.feedCache; delete data.gcalCache;       // they refill on their own
    delete data.connCache;
    if (data.connections) data.connections = Object.fromEntries(Object.entries(data.connections)
      .map(([k, v]) => [k, { ...v, token: undefined }]));                 // tokens never leave the browser
    const blob = new Blob([JSON.stringify({ app: 'not-yet', saved: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `not-yet-backup-${hwTodayStr()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  $('#import-l').prepend(icon('upload', 16), 'Choose file');
  $('#import').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let json;
    try { json = JSON.parse(await file.text()); } catch { toast('That doesn’t look like a backup file'); return; }
    if (!json || json.app !== 'not-yet' || (!json.data && !json.config)) { toast('That doesn’t look like a backup file'); return; }
    if (json.config && !json.data) {
      if (!(await confirmBox({ title: 'Use these settings?', body: 'Your habits and tasks stay. Bedtime, tags, subjects and notes are replaced.', yes: 'Use them' }))) return;
      const { onboarded, toured } = cfg;
      await chrome.storage.local.set({ config: nyNormalize({ ...json.config, onboarded, toured }) });
      location.reload();
      return;
    }
    if (!(await confirmBox({ title: 'Restore this backup?', body: `Everything here is replaced with the backup from ${new Date(json.saved || Date.now()).toLocaleDateString()}.`, yes: 'Restore', danger: true }))) return;
    await chrome.storage.local.clear();
    const data = { ...json.data }; delete data.ytGate;
    await chrome.storage.local.set(data);
    await gcalMigrate();                               // a backup from before several Google accounts keeps its account
    location.reload();
  };

  $('#reset-all').onclick = async () => {
    if (!(await confirmBox({ title: 'Reset all settings?', yes: 'Reset settings',
      body: 'Bedtime, sites, calendar options, tags, subjects, notes and appearance go back to how they started. Your habits, tasks and history stay.' }))) return;
    const d = nyClone(NY_DEFAULTS);
    let next = nyPlanBed(cfg, d.bed).cfg;                         // a later default bedtime still waits a day
    next = nyPlanSite(next, 'youtube', true).cfg;
    for (const id of next.sitesOn.filter(id => id !== 'youtube')) next = nyPlanSite(next, id, false).cfg;   // so does opening sites up
    await nySaveConfig({ ...d, bed: next.bed, bedNext: next.bedNext, sitesOn: next.sitesOn, sitesOffFrom: next.sitesOffFrom,
      customSites: cfg.customSites.filter(s => next.sitesOn.includes(s.id)), onboarded: cfg.onboarded, toured: cfg.toured });
    location.reload();
  };

  $('#wipe').onclick = async () => {
    if (!(await confirmBox({ title: 'Delete everything?', body: 'Every habit, task, note and setting. There’s no undo.', yes: 'Delete everything', danger: true }))) return;
    await chrome.storage.local.clear();
    await nySaveConfig({ onboarded: false, toured: false });
    location.href = 'welcome.html';
  };

  // ── About ─────────────────────────────────────────────────────────────────
  const about = { tile: nyTile('icon', 'info'), name: `Not yet. ${chrome.runtime.getManifest().version}` };
  put('#about-cards', nyCard({ ...about, sub: 'Replay the tour · set up again · privacy', onOpen: () => borrow('about-main', about) }));
  $('#replay').onclick = async () => { cfg = await nySaveConfig({ toured: false }); location.href = 'planner.html'; };   // it plays there, or in the popup, whichever opens first

  renderLook();

  // Changes made elsewhere (the popup, the midnight switch-over) show up here.
  onStorage(async changes => {
    D = await nyLoadAll();
    if (changes.config) { cfg = D.cfg; renderBed(); renderSites(); renderLook(); tagsSection.render(); tagsSection.refreshRules(); subjectsSection.render(); messagesSection.render(); }
    if (['connections', 'connCache', 'calFeeds', 'feedCache', 'gcalAccounts', 'gcalCalendars', 'gcalDefault', 'localEvents', 'hwLastSync'].some(k => k in changes)) connectionsSection.render();
    nyRefreshSheets();
    if (changes.hwLog) renderHistory();
  });

  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
