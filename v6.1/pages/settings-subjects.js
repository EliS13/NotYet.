// settings-subjects.js — Settings → Tags and Subjects, as cards. A tag's sheet
// sets what it starts with, its name, length, timer and subject; a subject's
// sheet its name, colour (any hue) and the words that mean it. `ctx.cfg` is
// read fresh on every change: Settings swaps it for a new copy whenever
// storage changes, so nothing here holds on to a tag or subject object.

// ── The hue picker ───────────────────────────────────────────────────────────
// The eight colours as quick picks, a spectrum strip (a slider), and a task
// chip in that colour on light and on dark.
const NY_COLOR_WORDS = { lilac: 'Lilac', mint: 'Mint', peach: 'Peach', butter: 'Butter', sky: 'Sky', pink: 'Pink', sage: 'Sage', stone: 'Stone' };
const NY_NAMED_HUES = { lilac: 255, mint: 150, peach: 20, butter: 46, sky: 210, pink: 335, sage: 95, stone: 250 };
function nyHueName(hue) {
  const names = [[15, 'Red'], [40, 'Orange'], [65, 'Yellow'], [90, 'Lime'], [150, 'Green'], [185, 'Teal'], [215, 'Sky blue'],
    [250, 'Blue'], [285, 'Purple'], [330, 'Pink'], [360, 'Red']];
  return names.find(([top]) => hue < top)[1];
}
const nyColorWord = c => NY_COLOR_WORDS[c] || (nyHueOf(c) != null ? nyHueName(nyHueOf(c)) : 'Stone');

function nyHuePicker({ value, onPick, sample = 'Algebra worksheet' }) {
  let cur = value, dragging = false;
  const hueOf = v => nyHueOf(v) ?? NY_NAMED_HUES[v] ?? 250;
  const presets = h('div', { class: 'hue-presets', role: 'group', 'aria-label': 'Colours' },
    ...NY_COLORS.map(n => setVars(h('button', { type: 'button', class: 'hue-swatch', 'data-c': n, 'aria-label': NY_COLOR_WORDS[n], title: NY_COLOR_WORDS[n],
      onclick: () => set(n, true) }, icon('check', 13)), { '--c': `var(--dot-${n})` })));
  const knob = h('span', { class: 'hue-knob' });
  const strip = h('div', { class: 'hue-strip', role: 'slider', tabindex: '0', 'aria-label': 'Any colour',
    'aria-valuemin': '0', 'aria-valuemax': '359', 'aria-orientation': 'horizontal' }, knob);
  const chips = ['light', 'dark'].map(mode => h('div', { class: 'hue-prev-' + mode }, h('span', { class: 'hue-chip' }, h('span', { class: 'dot' }), sample)));

  function show() {
    const c = nyColorCss(cur), hue = hueOf(cur), own = nyHueOf(cur) != null;
    for (const b of presets.children) b.setAttribute('aria-pressed', String(b.dataset.c === cur));
    strip.setAttribute('aria-valuenow', String(hue));
    strip.setAttribute('aria-valuetext', own ? `${nyHueName(hue)}, hue ${hue}` : nyColorWord(cur));
    knob.style.left = (hue / 359 * 100) + '%';
    knob.classList.toggle('is-named', !own);
    setVars(knob, { '--c': c.dot });
    for (const chip of chips) setVars(chip.firstChild, { '--hl': c.hl, '--c': c.dot });
  }
  const set = (v, save) => { cur = v; show(); if (save) onPick(v); };
  const fromX = x => { const r = strip.getBoundingClientRect(); return 'h' + Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * 359); };
  strip.addEventListener('pointerdown', e => { e.preventDefault(); strip.focus(); strip.setPointerCapture(e.pointerId); dragging = true; set(fromX(e.clientX), false); });
  strip.addEventListener('pointermove', e => { if (dragging) set(fromX(e.clientX), false); });
  strip.addEventListener('pointerup', e => { if (!dragging) return; dragging = false; set(fromX(e.clientX), true); });
  strip.addEventListener('pointercancel', () => { if (dragging) { dragging = false; onPick(cur); } });
  strip.addEventListener('keydown', e => {
    const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
    const hue = hueOf(cur);
    const next = step != null ? Math.min(359, Math.max(0, hue + step * (e.shiftKey ? 6 : 1))) : e.key === 'Home' ? 0 : e.key === 'End' ? 359 : null;
    if (next == null) return;
    e.preventDefault();
    set('h' + next, true);
  });
  show();
  return h('div', { class: 'hue' }, presets, strip, h('div', { class: 'hue-prev', 'aria-hidden': 'true' }, ...chips));
}

// ── Tags ─────────────────────────────────────────────────────────────────────
function nySettingsTags(ctx) {
  const grid = $('#tag-cards'), tryIn = $('#try-in'), classMark = $('#class-mark'), blocks = $('#blocks');
  const isEmoji = m => /^\p{Extended_Pictographic}/u.test(m || '');
  const tagName = t => t.name || (t.mark ? `Starts with ${t.mark}` : 'New tag');

  function renderTry() {
    const cfg = ctx.cfg, out = $('#try-out'), r = nyParseTitle(tryIn.value, cfg);
    if (!r) { out.replaceChildren(h('span', { class: 'no', text: 'Stays on the calendar. It doesn’t start with a tag.' })); return; }
    const sub = nySubject(nyGuessSubject(r.title, r.courseHint, cfg), cfg);
    out.replaceChildren(
      h('span', { class: 'muted', text: 'Becomes' }),
      h('span', { class: 't', text: r.title }),
      h('span', { class: 'chip' }, setVars(h('span', { class: 'dot' }), { '--c': nyColorCss(sub.color).dot }), sub.name),
      h('span', { class: 'chip', text: fmtMin(r.estMin) }),
      h('span', { class: 'chip', text: r.type === 'Q' ? 'Stopwatch' : 'Countdown' }));
  }
  tryIn.addEventListener('input', renderTry);

  async function save() { ctx.cfg = await nySaveConfig({ tags: ctx.cfg.tags }); renderTry(); render(); }

  function subjectChoice(value, onChange) {
    const btn = nyChoice(h('button'), { label: 'Subject', options: () => [['', 'From the title'], ...ctx.cfg.subjects.map(s => [s.id, s.name || 'Untitled'])] });
    btn.value = ctx.cfg.subjects.some(s => s.id === value) ? value : '';
    btn.onchange = () => onChange(btn.value);
    return btn;
  }
  function tagSub(t) {
    const s = t.subject && ctx.cfg.subjects.find(x => x.id === t.subject);
    return `${fmtMin(t.min)} · ${t.kind === 'up' ? 'stopwatch' : 'countdown'} · ${s ? s.name : 'subject from the title'}`;
  }

  function render() {
    const cfg = ctx.cfg;
    grid.replaceChildren(
      ...cfg.tags.map((t, i) => nyCard({ tile: nyTile('text', t.mark), name: tagName(t), sub: tagSub(t), id: 'tag:' + i, onOpen: () => open(i) })),
      nyAddCard('Add a tag', add),
      nyCard({ tile: nyTile('icon', 'help'), name: 'How titles are read', sub: 'Try a title, and which calendar events count', onOpen: openRules }));
  }

  // A tag's sheet. Edits go to ctx.cfg.tags[i]; a new tag left empty is dropped on close.
  function open(i, { pickMark = false } = {}) {
    const t0 = ctx.cfg.tags[i];
    const sheet = nySheet({ tile: nyTile('text', t0.mark), name: tagName(t0) });
    const now = () => ctx.cfg.tags[i];
    const edit = (patch, redraw = true) => {
      const t = now();
      if (!t) { sheet.close(); return; }
      Object.assign(t, patch);
      sheet.setTile(nyTile('text', t.mark)); sheet.setName(tagName(t));
      save();
      if (redraw) draw();
    };
    function draw() {
      const t = now();
      if (!t) { sheet.close(); return; }
      const mark = h('button', { type: 'button', class: 'mark-btn' + (isEmoji(t.mark) ? '' : ' word'), 'aria-label': `Starts with ${t.mark || 'nothing yet'}. Change`,
        onclick: e => nyMarkPop(e.currentTarget, now()?.mark, { onPick: m => edit({ mark: m }) }) }, t.mark || '＋');
      const nm = h('input', { class: 'input', value: t.name, maxlength: '40', 'aria-label': 'Name', placeholder: 'Homework', autocomplete: 'off' });
      nm.addEventListener('change', () => edit({ name: nm.value.trim() }, false));
      nm.addEventListener('keydown', e => { if (e.key === 'Enter') nm.blur(); });
      const min = nyChoice(h('button', { class: 'num' }), { label: 'How long', length: true, options: [] });
      min.value = t.min;
      min.onchange = () => edit({ min: +min.value }, false);
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Timer' },
        ...[['down', 'Countdown'], ['up', 'Stopwatch']].map(([k, l]) => h('button', {
          type: 'button', 'aria-pressed': String((t.kind === 'up' ? 'up' : 'down') === k), onclick: () => edit({ kind: k }) }, l)));
      sheet.body.replaceChildren(
        nySheetRow('Starts with', mark, 'An emoji, or a short word like HW'),
        nySheetRow('Name', nm),
        nySheetRow('How long', min),
        nySheetRow('Timer', seg),
        nySheetRow('Subject', subjectChoice(t.subject, v => edit({ subject: v }, false))),
        h('div', { class: 'sc-actions' }, h('button', { type: 'button', class: 'btn btn-sm btn-quiet sc-danger', onclick: remove }, icon('trash', 15), 'Remove this tag')));
    }
    async function remove() {
      if (!now()) return sheet.close();
      ctx.cfg.tags.splice(i, 1);
      sheet.close();
      await save();
      ctx.saved('Tag removed');
    }
    sheet.onClose = () => {
      const t = now();
      if (t && !t.mark && !t.name) { ctx.cfg.tags.splice(i, 1); save(); }        // added, then left empty
    };
    draw();
    if (pickMark) sheet.body.querySelector('.mark-btn').click();          // start with what it starts with
    return sheet;
  }
  function add() {
    ctx.cfg.tags.push({ mark: '', name: '', min: 30, kind: 'down', subject: '' });
    render();
    open(ctx.cfg.tags.length - 1, { pickMark: true });
  }

  // Trying a title, and the two rules for calendar events, in one sheet
  function openRules() {
    nyBorrow('tag-try', { tile: nyTile('icon', 'help'), name: 'How titles are read' });
    tryIn.focus(); tryIn.select();
  }
  classMark.value = ctx.cfg.classMark || '';
  blocks.value = ctx.cfg.blocks || '';
  const resync = () => hwSyncFromCalendar({ force: true }).catch(() => {});
  classMark.onchange = async () => { ctx.cfg = await nySaveConfig({ classMark: classMark.value.trim() }); ctx.saved(); resync(); };
  blocks.onchange = async () => { ctx.cfg = await nySaveConfig({ blocks: blocks.value.trim() }); ctx.saved(); resync(); };
  $('#rules-reset').onclick = async () => {
    ctx.cfg = await nySaveConfig({ classMark: NY_DEFAULTS.classMark, blocks: NY_DEFAULTS.blocks });
    classMark.value = ctx.cfg.classMark; blocks.value = ctx.cfg.blocks;
    ctx.saved('Back to the starting rules'); resync();
  };

  $('#tags-reset').onclick = async () => {
    if (!(await confirmBox({ title: 'Go back to the starter tags?', body: 'Your own tags will be replaced.', yes: 'Reset' }))) return;
    ctx.cfg.tags = nyClone(NY_DEFAULT_TAGS); await save(); ctx.saved('Tags reset');
  };

  render(); renderTry();
  return { render, renderTry, refreshRules() { if (!nyTyping($('#tag-try'))) { classMark.value = ctx.cfg.classMark || ''; blocks.value = ctx.cfg.blocks || ''; } } };
}

// ── Subjects ─────────────────────────────────────────────────────────────────
function nySettingsSubjects(ctx, { onChange }) {
  const grid = $('#subject-cards');
  const tileOf = s => { const c = nyColorCss(s.color); return nyTile('color', s.name || '?', { dot: c.dot, hl: c.hl }); };
  async function save() { ctx.cfg = await nySaveConfig({ subjects: ctx.cfg.subjects }); render(); onChange(); }

  function render() {
    grid.replaceChildren(
      ...ctx.cfg.subjects.map((s, i) => nyCard({ tile: tileOf(s), name: s.name || 'Untitled', sub: s.words ? s.words : 'No words yet', id: 'subject:' + s.id, onOpen: () => open(i) })),
      nyAddCard('Add a subject', add));
  }

  function open(i, { focusName = false } = {}) {
    const s0 = ctx.cfg.subjects[i];
    const sheet = nySheet({ tile: tileOf(s0), name: s0.name || 'New subject' });
    const now = () => ctx.cfg.subjects[i];
    const edit = patch => {
      const s = now();
      if (!s) { sheet.close(); return; }
      Object.assign(s, patch);
      sheet.setTile(tileOf(s)); sheet.setName(s.name || 'New subject');
      save();
    };
    const s = s0;
    const nm = h('input', { class: 'input', value: s.name, maxlength: '30', 'aria-label': 'Subject name', placeholder: 'Subject', autocomplete: 'off' });
    nm.addEventListener('change', () => edit({ name: nm.value.trim() || 'Untitled' }));
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') nm.blur(); });
    const words = h('input', { class: 'input', value: s.words, 'aria-label': 'Words that mean this subject', placeholder: 'math, algebra', autocomplete: 'off' });
    words.addEventListener('change', () => edit({ words: words.value }));
    words.addEventListener('keydown', e => { if (e.key === 'Enter') words.blur(); });
    sheet.body.append(
      nySheetRow('Name', nm),
      h('div', { class: 'sc-block' }, h('h3', { text: 'Colour' }), nyHuePicker({ value: s.color, sample: s.name || 'Algebra worksheet', onPick: color => edit({ color }) })),
      h('div', { class: 'sc-block' }, h('h3', { text: 'Words that mean it' }), words,
        h('p', { class: 'sc-note hint', text: 'A task with one of these in its title gets this subject. Separate them with commas.' })),
      h('div', { class: 'sc-actions' }, h('button', { type: 'button', class: 'btn btn-sm btn-quiet sc-danger', onclick: async () => {
        const cur = now();
        if (!cur) return sheet.close();
        if (!(await confirmBox({ title: `Remove ${cur.name || 'this subject'}?`, body: 'Tasks in it move to Other.', yes: 'Remove', danger: true }))) return;
        ctx.cfg.subjects.splice(i, 1);
        sheet.close();
        await save();
        ctx.saved('Subject removed');
      } }, icon('trash', 15), 'Remove this subject')));
    sheet.onClose = () => {
      const cur = now();
      if (cur && !cur.name && !cur.words && cur === ctx.cfg.subjects[ctx.cfg.subjects.length - 1]) { ctx.cfg.subjects.pop(); save(); }   // added, then left empty
    };
    if (focusName) nm.focus();
    return sheet;
  }
  async function add() {
    const used = new Set(ctx.cfg.subjects.map(s => s.color));
    ctx.cfg.subjects.push({ id: nyId('s'), name: '', color: NY_COLORS.find(c => !used.has(c)) || 'h' + Math.floor(Math.random() * 360), words: '' });
    await save();
    open(ctx.cfg.subjects.length - 1, { focusName: true });
  }
  $('#subjects-reset').onclick = async () => {
    if (!(await confirmBox({ title: 'Go back to the starter subjects?', body: 'Your own subjects will be replaced.', yes: 'Reset' }))) return;
    ctx.cfg.subjects = nyClone(NY_DEFAULT_SUBJECTS); await save(); ctx.saved('Subjects reset');
  };

  render();
  return { render };
}
