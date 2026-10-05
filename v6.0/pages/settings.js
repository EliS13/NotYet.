// settings.js — every setting saves the moment it changes.

(async () => {
  let D = await nyLoadAll();
  let cfg = D.cfg;
  const saved = (msg = 'Saved') => toast(msg);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const COLOR_NAMES = { lilac: 'Lilac', mint: 'Mint', peach: 'Peach', butter: 'Butter', sky: 'Sky', pink: 'Pink', sage: 'Sage', stone: 'Stone' };

  $('#brand').append(logoSvg(26), h('span', { text: 'Not yet.' }));
  $('#to-planner').append(icon('calendar', 16), 'Planner');

  // ── Section nav ───────────────────────────────────────────────────────────
  const NAV = [['bedtime', 'moon', 'Bedtime'], ['sites', 'lock', 'Sites'], ['calendar', 'calendar', 'Calendar'],
    ['tags', 'tag', 'Tags'], ['subjects', 'palette', 'Subjects'], ['notes', 'note', 'Notes'], ['timers', 'timer', 'Timers'],
    ['appearance', 'sun', 'Appearance'], ['backup', 'download', 'Backup'], ['about', 'info', 'About']];
  const navLinks = NAV.map(([id, ic, label]) => h('a', { href: '#' + id, 'data-id': id }, icon(ic, 17), label));
  $('#nav').append(...navLinks);
  const setCurrent = id => navLinks.forEach(a => a.setAttribute('aria-current', String(a.dataset.id === id)));
  setCurrent(location.hash.slice(1) || 'bedtime');
  const io = new IntersectionObserver(entries => {
    const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (vis[0]) setCurrent(vis[0].target.id);
  }, { rootMargin: '-10% 0px -70% 0px' });
  document.querySelectorAll('.sec').forEach(s => io.observe(s));

  // ── Bedtime ───────────────────────────────────────────────────────────────
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn() % 7 + i) % 7);
  const dayName = n => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'long' });
  const dayLetter = n => new Date(2024, 0, 7 + n).toLocaleDateString(undefined, { weekday: 'narrow' });

  function fillTimes(sel, from, to) {
    for (let m = from; m <= to; m += 15) sel.append(h('option', { value: String(m) }, cap(nyClockMin(m))));
  }
  fillTimes($('#bed-school'), NY_BED_MIN, NY_BED_MAX);
  fillTimes($('#bed-other'), NY_BED_MIN, NY_BED_MAX);
  fillTimes($('#bed-wake'), NY_WAKE_MIN, NY_WAKE_MAX);

  const shownBed = () => cfg.bedNext ? cfg.bedNext.bed : cfg.bed;

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
  $('#bed-warn').onchange = async e => { cfg = await nySaveConfig({ warn: +e.target.value }); saved(); };
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
          h('small', { text: leaving ? `Opens up ${fmtWeekday(nyParseDs(leaving))}` : site.domains.join(', ') })),
        leaving ? h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: () => toggleSite(site, true) }, 'Undo') : null,
        custom && !on ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${site.name}`, onclick: () => removeSite(site) }, icon('trash', 15)) : null,
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
    cfg = await nySaveConfig({ sitesOn: plan.cfg.sitesOn, sitesOffFrom: plan.cfg.sitesOffFrom });
    siteMsg('');
    renderSites();
    saved(on ? `${site.name} now waits for your list` : `${site.name} opens up ${fmtWeekday(nyParseDs(plan.when))}`);
  }

  async function removeSite(site) {
    cfg = await nySaveConfig({ customSites: cfg.customSites.filter(s => s.id !== site.id) });
    chrome.permissions.remove({ origins: site.domains.map(d => `https://*.${d}/*`) }).catch(() => {});
    renderSites();
  }

  $('#site-add').onsubmit = async e => {
    e.preventDefault();
    const d = nyCleanDomain($('#site-in').value);
    if (!d) return siteMsg('That doesn’t look like a website. Try something like discord.com.', true);
    if (nySiteFor(d, cfg)) return siteMsg('That one’s already on the list.', true);
    const ok = await chrome.permissions.request({ origins: [`https://*.${d}/*`] });
    if (!ok) return siteMsg(`To close ${d}, Chrome needs you to choose Allow. Add it again to try once more.`, true);
    const site = { id: nyId('site'), name: d, domains: [d] };
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

  // ── Calendar ──────────────────────────────────────────────────────────────
  const ics = $('#ics');
  ics.value = D.hw.hwSettings.icsUrl || '';

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    return hwTodayStr(new Date(ts)) === hwTodayStr() ? 'at ' + nyClock(ts) : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderSync(state) {
    const line = $('#sync-line');
    const url = D.hw.hwSettings.icsUrl;
    const same = !!url && ics.value.trim() === url;
    $('#ics-save').replaceChildren(...(same ? [icon('check', 16), 'Connected'] : ['Connect']));
    $('#ics-save').className = same ? 'btn is-connected' : 'btn btn-primary';
    $('#ics-save').disabled = same;
    if (state === 'syncing') { line.replaceChildren(h('span', { text: 'Syncing…' })); return; }
    if (!url) { line.replaceChildren(h('span', { text: 'Not connected. Tasks you add by hand still work.' })); return; }
    const parts = [];
    if (D.syncError) parts.push(h('span', { class: 'err', text: D.syncError }));
    else if (D.lastSync) parts.push(h('span', { class: 'ok', text: `Synced ${ago(D.lastSync)}` }));
    parts.push(h('button', { type: 'button', class: 'btn btn-quiet', onclick: syncNow }, icon('sync', 15), 'Sync now'));
    parts.push(h('button', { type: 'button', class: 'btn btn-quiet', onclick: disconnect }, 'Disconnect'));
    line.replaceChildren(...parts);
  }

  async function syncNow() {
    renderSync('syncing');
    try {
      const added = await hwSyncFromCalendar({ force: true });
      await chrome.storage.local.set({ hwLastSyncError: '' });
      D = await nyLoadAll();
      renderSync();
      toast(added ? `Found ${added} new task${added === 1 ? '' : 's'} for today` : 'Up to date');
    } catch (e) {
      await chrome.storage.local.set({ hwLastSyncError: String(e.message || e) });
      D = await nyLoadAll();
      renderSync();
    }
  }

  async function saveUrl(url) {
    const s = { ...D.hw.hwSettings, icsUrl: url };
    await chrome.storage.local.set({ hwSettings: s, hwLastSyncError: '' });
    D = await nyLoadAll();
  }

  async function connect() {
    const url = nyFeedUrl(ics.value);
    const line = $('#sync-line');
    const fail = msg => line.replaceChildren(h('span', { class: 'err', text: msg }));
    if (!url) return disconnect();
    let origin;
    try { origin = new URL(url).origin; } catch { return fail('That doesn’t look like a link.'); }
    if (!/^https:/.test(url)) return fail('Calendar links start with https:// or webcal://');
    const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!ok) return fail('To read your calendar, Chrome needs you to choose Allow. Press Connect to try again.');
    await saveUrl(url);
    await syncNow();
  }

  async function disconnect() {
    await saveUrl('');
    ics.value = '';
    renderSync();
    saved('Calendar disconnected');
  }

  $('#ics-save').onclick = connect;
  ics.addEventListener('input', () => renderSync());
  ics.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  renderSync();

  const classMark = $('#class-mark'), blocks = $('#blocks');
  classMark.value = cfg.classMark || '';
  blocks.value = cfg.blocks || '';
  classMark.onchange = async () => { cfg = await nySaveConfig({ classMark: classMark.value.trim() }); saved(); if (D.hw.hwSettings.icsUrl) syncNow(); };
  blocks.onchange = async () => { cfg = await nySaveConfig({ blocks: blocks.value.trim() }); saved(); if (D.hw.hwSettings.icsUrl) syncNow(); };
  $('#cal-reset').onclick = async () => {
    cfg = await nySaveConfig({ classMark: NY_DEFAULTS.classMark, blocks: NY_DEFAULTS.blocks });
    classMark.value = cfg.classMark; blocks.value = cfg.blocks;
    saved('Calendar options reset. Your calendar stays connected');
    if (D.hw.hwSettings.icsUrl) syncNow();
  };

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tryIn = $('#try-in');

  function renderTry() {
    const out = $('#try-out');
    const r = nyParseTitle(tryIn.value, cfg);
    if (!r) { out.replaceChildren(h('span', { class: 'no', text: 'Stays on the calendar. It doesn’t start with a tag.' })); return; }
    const sub = nySubject(nyGuessSubject(r.title, r.courseHint, cfg), cfg);
    out.replaceChildren(
      h('span', { class: 'muted', text: 'Becomes' }),
      h('span', { class: 't', text: r.title }),
      h('span', { class: 'chip' }, setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${sub.color})` }), sub.name),
      h('span', { class: 'chip', text: fmtMin(r.estMin) }),
      h('span', { class: 'chip', text: r.type === 'Q' ? 'Stopwatch' : 'Countdown' }));
  }
  tryIn.addEventListener('input', renderTry);

  async function saveTags() { cfg = await nySaveConfig({ tags: cfg.tags }); renderTry(); }

  function subjectSelect(value, onChange, label) {
    const sel = h('select', { class: 'select', 'aria-label': label },
      h('option', { value: '' }, 'From the title'),
      ...cfg.subjects.map(s => h('option', { value: s.id }, s.name || 'Untitled')));
    sel.value = cfg.subjects.some(s => s.id === value) ? value : '';
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  function renderTags() {
    $('#tag-rows').replaceChildren(...cfg.tags.map((t, i) => {
      const name = t.name || t.mark || 'this tag';
      const mark = h('input', { class: 'input mark-in', value: t.mark, maxlength: '12', 'aria-label': 'Starts with', placeholder: '📝' });
      mark.onchange = () => { t.mark = mark.value.trim(); saveTags(); };
      const nm = h('input', { class: 'input', value: t.name, maxlength: '40', 'aria-label': 'Name', placeholder: 'Homework' });
      nm.onchange = () => { t.name = nm.value.trim(); saveTags(); };
      const min = h('input', { class: 'input num', type: 'number', min: '1', max: '480', value: t.min, 'aria-label': 'Minutes' });
      min.onchange = () => { t.min = Math.max(1, Math.min(480, Math.round(+min.value) || 30)); min.value = t.min; saveTags(); };
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Timer' },
        ...[['down', 'Countdown'], ['up', 'Stopwatch']].map(([k, l]) => h('button', {
          type: 'button', 'aria-pressed': String((t.kind === 'up' ? 'up' : 'down') === k),
          onclick: () => { t.kind = k; saveTags(); renderTags(); } }, l)));
      const subj = subjectSelect(t.subject, v => { t.subject = v; saveTags(); }, 'Subject');
      const del = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${name}`,
        onclick: () => { cfg.tags.splice(i, 1); saveTags(); renderTags(); } }, icon('trash', 16));
      return h('div', { class: 'tr', role: 'row' }, mark, nm, min, seg, subj, del);
    }));
  }
  $('#tag-add').append(icon('plus', 16), 'Add a tag');
  $('#tag-add').onclick = () => {
    cfg.tags.push({ mark: '', name: '', min: 30, kind: 'down', subject: '' });
    renderTags();
    $('#tag-rows').lastChild.querySelector('input').focus();
  };
  $('#tags-reset').onclick = async () => {
    if (!(await confirmBox({ title: 'Go back to the starter tags?', body: 'Your own tags will be replaced.', yes: 'Reset' }))) return;
    cfg.tags = nyClone(NY_DEFAULT_TAGS); await saveTags(); renderTags(); saved('Tags reset');
  };

  // ── Subjects ──────────────────────────────────────────────────────────────
  async function saveSubjects() { cfg = await nySaveConfig({ subjects: cfg.subjects }); renderTry(); }

  function renderSubjects() {
    $('#subject-rows').replaceChildren(...cfg.subjects.map((s, i) => {
      const sw = setVars(h('button', { type: 'button', class: 'swatch', 'aria-label': `Colour: ${COLOR_NAMES[s.color] || s.color}. Change` }),
        { '--hl': `var(--hl-${s.color})`, '--c': `var(--dot-${s.color})` });
      sw.onclick = () => openMenu(sw, NY_COLORS.map(c => ({ label: COLOR_NAMES[c], dot: `var(--dot-${c})`,
        onClick: () => { s.color = c; saveSubjects(); renderSubjects(); } })));
      const nm = h('input', { class: 'input', value: s.name, maxlength: '30', 'aria-label': 'Subject name', placeholder: 'Subject' });
      nm.onchange = () => { s.name = nm.value.trim() || 'Untitled'; saveSubjects(); renderTags(); };
      const words = h('input', { class: 'input', value: s.words, 'aria-label': `Words that mean ${s.name}`, placeholder: 'math, algebra' });
      words.onchange = () => { s.words = words.value; saveSubjects(); };
      const del = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${s.name}`,
        onclick: async () => {
          if (!(await confirmBox({ title: `Remove ${s.name || 'this subject'}?`, body: 'Tasks in it move to Other.', yes: 'Remove', danger: true }))) return;
          cfg.subjects.splice(i, 1); await saveSubjects(); renderSubjects(); renderTags();
        } }, icon('trash', 16));
      return h('div', { class: 'tr', role: 'row' }, sw, nm, words, del);
    }));
  }
  $('#subject-add').append(icon('plus', 16), 'Add a subject');
  $('#subject-add').onclick = () => {
    const used = new Set(cfg.subjects.map(s => s.color));
    cfg.subjects.push({ id: nyId('s'), name: '', color: NY_COLORS.find(c => !used.has(c)) || 'lilac', words: '' });
    renderSubjects();
    $('#subject-rows').lastChild.querySelectorAll('input')[0].focus();
  };
  $('#subjects-reset').onclick = async () => {
    if (!(await confirmBox({ title: 'Go back to the starter subjects?', body: 'Your own subjects will be replaced.', yes: 'Reset' }))) return;
    cfg.subjects = nyClone(NY_DEFAULT_SUBJECTS); await saveSubjects(); renderSubjects(); renderTags(); saved('Subjects reset');
  };

  // ── Notes ─────────────────────────────────────────────────────────────────
  // A list you can add to, edit (click a note) and delete from. Reset brings
  // the starter notes back.
  function noteList(key, defaults, listEl, formEl, resetBtn) {
    const save = async () => { cfg = await nySaveConfig({ [key]: cfg[key] }); };
    function draw() {
      listEl.replaceChildren(...cfg[key].map((text, i) => h('li', { class: 'nl-row' },
        h('button', { type: 'button', class: 'nl-text', title: 'Edit this note', text, onclick: e => editNote(i, e.currentTarget) }),
        h('button', { type: 'button', class: 'icon-btn sm nl-del', 'aria-label': `Delete: ${text}`, onclick: async () => {
          const [gone] = cfg[key].splice(i, 1);
          await save(); draw();
          toast('Note deleted', { label: 'Undo', onClick: async () => { cfg[key].splice(i, 0, gone); await save(); draw(); } });
        } }, icon('x', 15)))));
      if (!cfg[key].length) listEl.append(h('li', { class: 'nl-empty', text: 'No notes. It’s going to be very quiet.' }));
    }
    function editNote(i, btn) {
      const input = h('input', { class: 'input input-sm', value: cfg[key][i], maxlength: '140', 'aria-label': 'Edit note' });
      btn.replaceWith(input); input.focus(); input.select();
      let done = false;
      const finish = async keep => {
        if (done) return; done = true;
        const v = input.value.trim();
        if (keep && v && v !== cfg[key][i]) { cfg[key][i] = v; await save(); }
        draw();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    }
    formEl.onsubmit = async e => {
      e.preventDefault();
      const input = formEl.querySelector('input'), v = input.value.trim();
      if (!v) return input.focus();
      cfg[key].push(v); await save();
      input.value = ''; draw();
      listEl.lastElementChild.scrollIntoView({ block: 'nearest' });
    };
    resetBtn.onclick = async () => {
      if (!(await confirmBox({ title: 'Bring back the starter notes?', body: 'Notes you added are removed, and deleted ones come back.', yes: 'Reset' }))) return;
      cfg[key] = nyClone(defaults); await save(); draw(); saved('Notes reset');
    };
    draw();
  }
  noteList('lockNotes', NY_LOCK_NOTES, $('#lock-list'), $('#lock-add'), $('#lock-reset'));
  noteList('bedNotes', NY_BED_NOTES, $('#bed-list'), $('#bed-add'), $('#bednotes-reset'));

  // ── Timers ────────────────────────────────────────────────────────────────
  const phase = $('#phase');
  const mode = D.hw.hwSettings.phaseMode || 'target';
  phase.value = mode;
  phase.onchange = async () => {
    const hw = await getHwState();
    await chrome.storage.local.set({ hwSettings: { ...hw.hwSettings, phaseMode: phase.value,
      installDate: phase.value === 'auto' ? hwTodayStr() : hw.hwSettings.installDate } });
    saved();
  };

  const median = arr => {
    const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function renderHistory() {
    const log = D.hw.hwLog || [];
    const box = $('#history');
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
      h('div', { class: 'hist-actions' }, h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: async () => {
        if (!(await confirmBox({ title: 'Clear your timing history?', body: 'This can’t be undone.', yes: 'Clear', danger: true }))) return;
        await chrome.storage.local.set({ hwLog: [] }); D = await nyLoadAll(); renderHistory();
      } }, 'Clear history')));
  }
  renderHistory();

  // ── Appearance ────────────────────────────────────────────────────────────
  const THEMES = [['system', 'Match computer'], ['light', 'Light'], ['dark', 'Dark']];
  function renderLook() {
    $('#theme').replaceChildren(...THEMES.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(cfg.theme === v), onclick: () => setLook({ theme: v }) }, label)));
    $('#accent').replaceChildren(...NY_ACCENTS.map(a => setVars(h('button', {
      type: 'button', class: 'accent-dot', 'aria-pressed': String(cfg.accent === a), 'aria-label': COLOR_NAMES[a], title: COLOR_NAMES[a],
      onclick: () => setLook({ accent: a }) }, icon('check', 14)), { '--hl': `var(--hl-${a})`, '--c': `var(--dot-${a})` })));
  }
  async function setLook(patch) { cfg = await nySaveConfig(patch); nyApplyAppearance(cfg); renderLook(); }
  $('#look-reset').onclick = () => setLook({ theme: NY_DEFAULTS.theme, accent: NY_DEFAULTS.accent });

  // ── Backup ────────────────────────────────────────────────────────────────
  $('#export').append(icon('download', 16), 'Download backup');
  $('#export').onclick = async () => {
    const data = await chrome.storage.local.get(null);
    delete data.ytGate;
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
  $('#version').textContent = `Not yet. Version ${chrome.runtime.getManifest().version}`;
  $('#replay').onclick = async () => { cfg = await nySaveConfig({ toured: false }); location.href = 'planner.html'; };   // it plays there, or in the popup, whichever opens first

  renderTags(); renderSubjects(); renderTry(); renderLook();

  // Changes made elsewhere (the popup, the midnight switch-over) show up here.
  onStorage(async changes => {
    D = await nyLoadAll();
    if (changes.config) { cfg = D.cfg; renderBed(); renderSites(); renderLook(); }
    if (changes.hwLastSync || changes.hwLastSyncError || changes.hwSettings) renderSync();
    if (changes.hwLog) renderHistory();
  });

  topButton();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
