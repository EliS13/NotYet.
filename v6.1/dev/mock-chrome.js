// mock-chrome.js — a pretend `chrome` API so the extension pages can be opened
// in an ordinary browser tab for design work and screenshots. Not shipped.
//
// URL options:
//   ?seed=busy|fresh|done|bed|empty   start from a sample state (resets storage)
//   ?t=23:30                          pretend it's this time today
//   ?d=2026-09-28                     pretend it's this date
//   ?tour=1                           show the first-run tour

(() => {
  const params = new URLSearchParams(location.search);

  // ── Fake clock ────────────────────────────────────────────────────────────
  if (params.get('t') || params.get('d')) {
    const real = new Date();
    const target = new Date(real);
    if (params.get('d')) { const [y, m, d] = params.get('d').split('-').map(Number); target.setFullYear(y, m - 1, d); }
    if (params.get('t')) { const [hh, mm] = params.get('t').split(':').map(Number); target.setHours(hh, mm, 0, 0); }
    const offset = target - real;
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
      static now() { return RealDate.now() + offset; }
    }
    window.Date = FakeDate;
  }

  const KEY = 'ny-mock-storage';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const listeners = [];
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

  function area(name) {
    return {
      async get(q) {
        const s = load();
        if (q == null) return clone(s);
        if (typeof q === 'string') return q in s ? { [q]: clone(s[q]) } : {};
        if (Array.isArray(q)) return Object.fromEntries(q.filter(k => k in s).map(k => [k, clone(s[k])]));
        return Object.fromEntries(Object.entries(q).map(([k, d]) => [k, k in s ? clone(s[k]) : clone(d)]));
      },
      async set(obj) {
        const s = load(), changes = {};
        for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: s[k], newValue: clone(v) }; s[k] = clone(v); }
        save(s);
        setTimeout(() => listeners.forEach(fn => fn(changes, name)));
      },
      async remove(keys) { const s = load(); [].concat(keys).forEach(k => delete s[k]); save(s); },
      async clear() { save({}); },
      setAccessLevel: async () => {},
    };
  }

  const alarms = {};
  window.chrome = {
    storage: { local: area('local'), session: area('session'), onChanged: { addListener: fn => listeners.push(fn), removeListener: () => {} } },
    alarms: {
      create: async (n, o) => { alarms[n] = { name: n, scheduledTime: o.when || Date.now() + (o.delayInMinutes || 0) * 60000 }; },
      clear: async n => delete alarms[n], get: async n => alarms[n], getAll: async () => Object.values(alarms),
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      id: 'mock', getURL: p => location.origin + '/' + p.replace(/^\//, ''),
      sendMessage: async msg => (msg && msg.type === 'sync-now' ? { ok: true, added: 0 } : undefined),
      onMessage: { addListener: () => {} }, getManifest: () => ({ version: '6.1', name: 'Not yet.' }),
    },
    tabs: {
      create: ({ url }) => { location.href = url; }, update: async () => {}, remove: async () => {},
      getCurrent: async () => ({ id: 1 }), query: async () => [],
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {}, setTitle: async () => {} },
    permissions: { request: async () => true, contains: async () => true },
    identity: {
      getRedirectURL: () => 'https://mock.chromiumapp.org/',
      // The pretend Google window: says yes straight away, as the account it was
      // given, or else the next pretend account not signed in yet. A quiet renewal
      // can't with ?google=expired, or for the school account with ?google=2-expired.
      launchWebAuthFlow: async ({ url, interactive }) => {
        const u = new URL(url), hint = u.searchParams.get('login_hint') || '', mode = params.get('google') || '';
        if (!interactive && (mode === 'expired' || (mode === '2-expired' && hint === 'sam.lee@school.edu'))) throw new Error('Interaction required');
        let who = hint;
        if (!who) {
          const { gcalAccounts = [] } = await window.chrome.storage.local.get({ gcalAccounts: [] });
          who = G_PEOPLE.find(e => !gcalAccounts.some(a => a.email === e)) || G_PEOPLE[0];
        }
        return `https://mock.chromiumapp.org/#access_token=mock-${encodeURIComponent(who)}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(u.searchParams.get('scope'))}&state=${u.searchParams.get('state')}`;
      },
    },
    declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
    scripting: { executeScript: async () => {}, insertCSS: async () => {} },
  };
  window.close = () => {};
  window.NY_GCAL_CLIENT_ID = 'mock-client-id';

  // ── Pretend Google Calendar and Google Tasks ──────────────────────────────
  // Three pretend accounts. Home has four calendars with a week of life in them,
  // relative to today; school shares the School calendar (and can edit it) and
  // has Clubs. Handles the calls lib/gcal.js and lib/apps/google-tasks.js make;
  // calendar changes are remembered in localStorage.
  const G_PEOPLE = ['sam@example.com', 'sam.lee@school.edu', 'sam.games@example.com'];
  const gWho = opts => { const t = String((opts.headers || {}).Authorization || '').replace(/^Bearer /, ''); return t.startsWith('mock-') ? t.slice(5) : G_PEOPLE[0]; };
  const G_KEY = 'ny-mock-google';
  const dsOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const onDay = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const nextDow = dow => { const d = new Date(); return (dow - d.getDay() + 7) % 7; };
  function googleSample() {
    const cal = (id, summary, accessRole, backgroundColor, selected, extra = {}) => ({ id, summary, accessRole, backgroundColor, selected, ...extra });
    return {
      calendars: {
        'sam@example.com': [
          cal('sam@example.com', 'sam@example.com', 'owner', '#7986cb', true, { primary: true }),
          cal('school@group.calendar.google.com', 'School', 'reader', '#0b8043', true),
          cal('team@group.calendar.google.com', 'Soccer team', 'writer', '#f6bf26', true),
          cal('en.canadian#holiday@group.v.calendar.google.com', 'Holidays in Canada', 'reader', '#d50000', false),
        ],
        'sam.lee@school.edu': [
          cal('sam.lee@school.edu', 'sam.lee@school.edu', 'owner', '#039be5', true, { primary: true }),
          cal('school@group.calendar.google.com', 'School', 'writer', '#0b8043', true),
          cal('clubs@group.calendar.google.com', 'Clubs', 'reader', '#e67c73', true),
        ],
        'sam.games@example.com': [cal('sam.games@example.com', 'sam.games@example.com', 'owner', '#33b679', true, { primary: true })],
      },
      events: {
        'sam.lee@school.edu': [
          { id: 'advisory', summary: 'Advisory meeting', start: { dateTime: onDay(nextDow(2) || 7, 13) }, end: { dateTime: onDay(nextDow(2) || 7, 13, 30) } },
        ],
        'clubs@group.calendar.google.com': [
          { id: 'robotics', summary: 'Robotics club', location: 'Room 12', start: { dateTime: onDay(-30, 15, 30) }, end: { dateTime: onDay(-30, 16, 30) }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'] },
        ],
        'sam@example.com': [
          { id: 'dentist', summary: 'Dentist', location: 'Bright Smiles, 4th Ave', start: { dateTime: onDay(nextDow(3) || 7, 16, 30) }, end: { dateTime: onDay(nextDow(3) || 7, 17) } },
          { id: 'bday', summary: 'Mia’s birthday', start: { date: dsOf(new Date(Date.now() + nextDow(6) * 864e5)) }, end: { date: dsOf(new Date(Date.now() + (nextDow(6) + 1) * 864e5)) } },
          { id: 'piano', summary: 'Piano lesson', start: { dateTime: onDay(-14, 17) }, end: { dateTime: onDay(-14, 17, 45) }, recurrence: ['RRULE:FREQ=WEEKLY'] },
        ],
        'school@group.calendar.google.com': [
          { id: 'math', summary: 'Math 10', location: 'Room 204', start: { dateTime: onDay(-30, 8, 45) }, end: { dateTime: onDay(-30, 10) }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] },
          { id: 'bio', summary: 'Biology', location: 'Lab 2', start: { dateTime: onDay(-30, 10, 15) }, end: { dateTime: onDay(-30, 11, 30) }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] },
          { id: 'eng', summary: 'English', start: { dateTime: onDay(-30, 12, 30) }, end: { dateTime: onDay(-30, 13, 45) }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] },
        ],
        'team@group.calendar.google.com': [
          { id: 'practice', summary: 'Soccer practice', location: 'Field 3', start: { dateTime: onDay(-30, 16) }, end: { dateTime: onDay(-30, 17, 30) }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU,TH'] },
          { id: 'game', summary: 'Game vs Eagles', location: 'Riverside Park', start: { dateTime: onDay(nextDow(6) || 7, 10) }, end: { dateTime: onDay(nextDow(6) || 7, 11, 30) } },
        ],
        'en.canadian#holiday@group.v.calendar.google.com': [
          { id: 'thanks', summary: 'Thanksgiving', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
        ],
      },
    };
  }
  const dueIn = n => { const d = new Date(); d.setDate(d.getDate() + n); return dsOf(d) + 'T00:00:00.000Z'; };
  const G_TASKS = {
    'sam@example.com': [{ id: 'L1', title: 'My Tasks', tasks: [{ id: 'g1', title: 'Return library books', due: dueIn(1) }, { id: 'g2', title: 'Sign field trip form', due: dueIn(3) }] }],
    'sam.lee@school.edu': [
      { id: 'H1', title: 'Homework', tasks: [{ id: 'h1', title: 'Spanish vocab quiz prep [20m]', due: dueIn(0) }, { id: 'h2', title: 'History reading ch 7', due: dueIn(2) }] },
      { id: 'H2', title: 'Clubs', tasks: [{ id: 'c1', title: 'Robotics parts list', due: dueIn(4) }] }],
  };
  const gLoad = () => { try { return JSON.parse(localStorage.getItem(G_KEY)) || googleSample(); } catch { return googleSample(); } };
  const gSave = g => localStorage.setItem(G_KEY, JSON.stringify(g));
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  // Each time an event happens in [from, to), as Google sends them with singleEvents=true.
  function gExpand(ev, from, to) {
    const allDay = !!ev.start.date;
    const s0 = allDay ? new Date(ev.start.date + 'T00:00:00') : new Date(ev.start.dateTime);
    const len = (allDay ? new Date(ev.end.date + 'T00:00:00') : new Date(ev.end.dateTime)) - s0;
    const rule = (ev.recurrence || []).find(r => r.startsWith('RRULE:'));
    if (!rule) return s0 < to && s0.getTime() + len > from ? [ev] : [];
    const p = Object.fromEntries(rule.slice(6).split(';').map(kv => kv.split('=')));
    const out = [];
    for (const d = new Date(Math.max(from, s0)); d < to; d.setDate(d.getDate() + 1)) {
      const day = new Date(d); day.setHours(s0.getHours(), s0.getMinutes(), 0, 0);
      if (day < s0) continue;
      const ok = p.FREQ === 'DAILY' || (p.FREQ === 'WEEKLY' && (p.BYDAY ? p.BYDAY.split(',').includes(DAYS[day.getDay()]) : day.getDay() === s0.getDay()))
        || (p.FREQ === 'MONTHLY' && day.getDate() === s0.getDate()) || (p.FREQ === 'YEARLY' && day.getDate() === s0.getDate() && day.getMonth() === s0.getMonth());
      const key = dsOf(day).replace(/-/g, '');
      if (!ok || (ev.skip || []).includes(key)) continue;
      const one = { ...ev, ...(ev.overrides || {})[key], id: `${ev.id}_${key}`, recurringEventId: ev.id, recurrence: undefined };
      if (!(ev.overrides || {})[key] || !(ev.overrides[key].start)) {
        one.start = allDay ? { date: dsOf(day) } : { dateTime: day.toISOString() };
        one.end = allDay ? { date: dsOf(new Date(day.getTime() + len)) } : { dateTime: new Date(day.getTime() + len).toISOString() };
      }
      out.push(one);
    }
    return out;
  }
  const realFetch = window.fetch.bind(window);
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, opts = {}) => {
    const url = new URL(String(input), location.href);
    if (url.hostname === 'oauth2.googleapis.com') return json(200, {});
    if (url.hostname === 'api.todoist.com') {
      await new Promise(r => setTimeout(r, 200));
      if (url.pathname.endsWith('/close') || url.pathname.endsWith('/reopen')) return json(204, null);
      if (url.pathname.includes('/tasks/completed/')) return json(200, { items: [], next_cursor: null });
      if (url.pathname.endsWith('/projects')) return json(200, { results: [{ id: 'p1', name: 'Science' }, { id: 'p2', name: 'English' }], next_cursor: null });
      const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      return json(200, { results: [
        { id: '501', content: 'Chem worksheet', due: { date: day(0) }, duration: { amount: 25, unit: 'minute' }, project_id: 'p1' },
        { id: '502', content: 'Poem annotation', due: { date: day(2) }, project_id: 'p2' },
        { id: '503', content: 'Lab safety quiz', due: { date: day(-1) }, project_id: 'p1' }], next_cursor: null });
    }
    if (url.hostname === 'tasks.googleapis.com') {
      await new Promise(r => setTimeout(r, 200));
      if ((opts.method || 'GET').toUpperCase() === 'PATCH') return json(200, {});
      const lists = G_TASKS[gWho(opts)] || [], path = url.pathname.replace('/tasks/v1/', '');
      if (path === 'users/@me/lists') return json(200, { items: lists.map(l => ({ id: l.id, title: l.title })) });
      const m = /^lists\/([^/]+)\/tasks$/.exec(path), list = m && lists.find(l => l.id === decodeURIComponent(m[1]));
      return json(200, { items: list && url.searchParams.get('showCompleted') !== 'true' ? list.tasks : [] });
    }
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, opts);
    await new Promise(r => setTimeout(r, 250));                   // Google takes a moment
    const g = gLoad(), method = (opts.method || 'GET').toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    const path = decodeURIComponent(url.pathname.replace('/calendar/v3/', ''));
    if (path === 'users/me/calendarList') return json(200, { items: g.calendars[gWho(opts)] || [] });
    const m = /^calendars\/(.+?)\/events(?:\/(.+))?$/.exec(path);
    if (!m) return json(404, {});
    const [, calId, evId] = m, list = g.events[calId] || (g.events[calId] = []);
    if (!evId && method === 'GET') {
      const from = new Date(url.searchParams.get('timeMin')), to = new Date(url.searchParams.get('timeMax'));
      return json(200, { items: list.flatMap(ev => gExpand(ev, from, to)) });
    }
    if (!evId && method === 'POST') { const ev = { id: 'm' + Date.now().toString(36), ...body }; list.push(ev); gSave(g); return json(200, ev); }
    const [base, key] = evId.split('_'), master = list.find(e => e.id === base);
    if (!master) return json(410, {});
    if (method === 'GET') return json(200, master);
    if (method === 'DELETE') {
      if (key) master.skip = [...(master.skip || []), key]; else list.splice(list.indexOf(master), 1);
      gSave(g); return json(204, null);
    }
    if (method === 'PATCH') {
      if (key) master.overrides = { ...(master.overrides || {}), [key]: { ...((master.overrides || {})[key] || {}), ...body } };
      else Object.assign(master, body, body.recurrence ? {} : { recurrence: master.recurrence });
      gSave(g); return json(200, master);
    }
    return json(400, {});
  };

  // ── Sample data ───────────────────────────────────────────────────────────
  const seed = params.get('seed');
  if (!seed) return;
  const ds = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const weekKey = date => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
    const wn = 1 + Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 4)) / 604800000);
    return `${d.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
  };
  const s = {};
  const toured = params.get('tour') !== '1';
  s.config = { onboarded: seed !== 'fresh', toured: seed === 'fresh' ? true : toured,
    ...(params.get('theme') ? { theme: params.get('theme') } : {}), ...(params.get('accent') ? { accent: params.get('accent') } : {}),
    ...(params.get('sites') ? { sitesOn: params.get('sites').split(',') } : {}) };
  try { localStorage.setItem('ny-theme', params.get('theme') || 'system'); localStorage.setItem('ny-accent', params.get('accent') || 'lilac'); } catch {}
  if (seed === 'fresh' || seed === 'empty') { save(s); return; }

  s.hwSettings = { icsUrl: '', phaseMode: 'target', installDate: ds(-20) };
  s.hwLastSync = Date.now() - 4 * 60000;
  s.tasks = [
    { name: 'Piano practice', duration: 20, days: [true, true, true, true, true, true, false] },
    { name: 'Read before bed', duration: null, days: Array(7).fill(true) },
    { name: 'Make my bed', duration: null, days: Array(7).fill(true) },
    { name: 'Stretch', duration: null, days: [true, false, true, false, true, false, false] },
  ];
  // Check marks: the past two weeks mostly done
  s.weeks = {};
  for (let i = 14; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const wk = weekKey(d), col = (d.getDay() + 6) % 7;
    s.weeks[wk] = s.weeks[wk] || {};
    for (const hb of s.tasks) {
      s.weeks[wk][hb.name] = s.weeks[wk][hb.name] || Array(7).fill(false);
      if (i > 0 && (i % 5 !== 3 || hb.name === 'Make my bed')) s.weeks[wk][hb.name][col] = true;
    }
  }
  const today = new Date(), wk = weekKey(today), col = (today.getDay() + 6) % 7;
  s.weeks[wk]['Make my bed'][col] = true;
  s.activeTimers = {};

  s.hwTasksByDay = {
    [ds(0)]: [
      { id: 'cal-a', title: 'Worksheet 3.2: quadratics', course: 'math', estMin: 30, type: 'M', done: true, actualMin: 27 },
      { id: 'cal-b', title: 'Osmosis lab write-up', course: 'science', estMin: 45, type: 'Q', done: false },
      { id: 'cal-c', title: 'Chapter 5 notes', course: 'history', estMin: 25, type: 'M', done: false, carriedFrom: ds(-1) },
    ],
    [ds(1)]: [
      { id: 'cal-d', title: 'Essay outline', course: 'english', estMin: 40, type: 'Q', done: false },
      { id: 'cal-e', title: 'Vocab quiz review', course: 'languages', estMin: 20, type: 'M', done: false },
    ],
    [ds(2)]: [{ id: 'cal-f', title: 'Worksheet 3.3', course: 'math', estMin: 30, type: 'M', done: false }],
    [ds(4)]: [
      { id: 'cal-g', title: 'Unit test study', course: 'science', estMin: 60, type: 'M', done: false },
      { id: 'cal-h', title: 'Hand in lab', course: 'science', estMin: 10, type: 'M', done: false },
    ],
    [ds(-2)]: [{ id: 'cal-i', title: 'Poem annotation', course: 'english', estMin: 30, type: 'Q', done: true, actualMin: 35 }],
    [ds(-3)]: [{ id: 'cal-j', title: 'Worksheet 3.1', course: 'math', estMin: 30, type: 'M', done: true, actualMin: 30 }],
  };
  s.hwActiveTimers = {};
  // Calendars: pretend Google accounts, or else a secret link with a school
  // timetable and one event saved in Not yet. ?google=1: home, with Google Tasks.
  // ?google=expired: home, needing to sign in again. ?google=2: home and school
  // (sharing the School calendar). ?google=2-off: school's Tasks are off.
  // ?google=2-expired: school needs to sign in again.
  localStorage.removeItem(G_KEY);
  const google = params.get('google');
  if (google) {
    const cal = (id, account, name, access, color, on, primary = false) => ({ id, account, name, access, writable: access === 'owner' || access === 'writer', primary, color, on });
    s.gcalAccounts = [{ email: 'sam@example.com', connectedAt: Date.now() - 3 * 86400000, needsSignIn: google === 'expired', tasks: true }];
    s.gcalCalendars = [
      cal('sam@example.com', 'sam@example.com', 'sam@example.com', 'owner', 'sky', true, true),
      cal('team@group.calendar.google.com', 'sam@example.com', 'Soccer team', 'writer', 'butter', true),
      cal('en.canadian#holiday@group.v.calendar.google.com', 'sam@example.com', 'Holidays in Canada', 'reader', 'peach', false),
      cal('school@group.calendar.google.com', 'sam@example.com', 'School', 'reader', 'mint', true),
    ];
    if (google.startsWith('2')) {
      s.gcalAccounts.push({ email: 'sam.lee@school.edu', connectedAt: Date.now() - 86400000, needsSignIn: google === '2-expired', tasks: google !== '2-off' });
      s.gcalCalendars.push(
        cal('sam.lee@school.edu', 'sam.lee@school.edu', 'sam.lee@school.edu', 'owner', 'lilac', true, true),
        cal('school@group.calendar.google.com', 'sam.lee@school.edu', 'School', 'writer', 'mint', true),
        cal('clubs@group.calendar.google.com', 'sam.lee@school.edu', 'Clubs', 'reader', 'pink', true));
    }
    s.connections = { ...(s.connections || {}), gtasks: { on: true } };
    s.gcalDefault = 'sam@example.com';
    s.gcalCache = {};
    if (google === 'expired') {
      const at = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.getTime(); };
      const ym = ds(0).slice(0, 7);
      s.gcalCache['sam@example.com'] = { [ym]: { at: Date.now() - 7200000, items: [
        { id: 'dentist', seriesId: 'dentist', recurring: false, title: 'Dentist', allDay: false, start: at(0, 16, 30), end: at(0, 17), place: 'Bright Smiles, 4th Ave', notes: '', link: '' },
      ] } };
    } else s.gcalTokens = Object.fromEntries(s.gcalAccounts.filter(a => !a.needsSignIn)
      .map(a => [a.email, { token: 'mock-' + a.email, expires: Date.now() + 3600000 }]));
    s.calFeeds = [];
  } else {
    const items = [];
    for (let i = -7; i <= 60; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
      const dow = d.getDay(), day = ds(i), push = (t, s0, e0, place = '') =>
        items.push({ id: `feed-1:${t}:${day}`, seriesId: t, title: t, place, notes: '', allDay: false, start: d.getTime() + s0 * 60000, end: d.getTime() + e0 * 60000 });
      if (dow === 6) { push('Soccer game', 600, 690, 'Riverside Park'); continue; }
      if (dow === 0) continue;
      push('Math 10', 525, 600, 'Room 204'); push('Biology', 615, 690, 'Lab 2'); push('English', 750, 825);
      if (dow === 2 || dow === 4) push('Soccer practice', 960, 1050, 'Field 3');
      if (dow === 3) push('Dentist', 990, 1020, 'Bright Smiles, 4th Ave');
    }
    s.calFeeds = [{ id: 'feed-1', url: 'https://calendar.google.com/calendar/ical/school%40example.com/private-x/basic.ics', name: 'School', color: 'sky', on: true }];
    s.feedCache = { 'feed-1': { at: Date.now(), url: s.calFeeds[0].url, items, error: '' } };
    const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7)); fri.setHours(19, 0, 0, 0);
    const test = new Date(); test.setDate(test.getDate() + 3); test.setHours(9, 0, 0, 0);
    s.localEvents = [{ id: 'l-movie', title: 'Movie night', allDay: false, start: fri.getTime(), end: fri.getTime() + 2 * 3600000,
      place: 'Cineplex', notes: '', repeat: null, skip: [] },
      { id: 'l-test', title: 'Math unit test', allDay: false, start: test.getTime(), end: test.getTime() + 3600000,
        place: 'Room 204', notes: '', repeat: null, skip: [] }];
  }
  if (params.get('apps') === '1') {                  // a pretend Todoist, synced as soon as a page opens
    s.connections = { ...(s.connections || {}), todoist: { on: true, token: 'pretend', error: '', lastSync: Date.now() - 4 * 60000 } };
    s.hwLastSync = 0;
  }
  s.stickyNotes = [
    { id: '1', content: 'Ask Ms. Park about the lab rubric', color: '#fef9c3', x: 0, y: 0 },
    { id: '2', content: 'Science fair sign-up closes Friday!', color: '#fce7f3', x: 0, y: 0 },
  ];
  s.hwLog = [
    { date: ds(-3), hourStarted: 16, title: 'Worksheet 3.1', course: 'math', type: 'M', estMin: 30, actualMin: 30 },
    { date: ds(-2), hourStarted: 19, title: 'Poem annotation', course: 'english', type: 'Q', estMin: 30, actualMin: 35 },
    { date: ds(-5), hourStarted: 17, title: 'Lab prep', course: 'science', type: 'Q', estMin: 40, actualMin: 52 },
    { date: ds(-6), hourStarted: 20, title: 'Worksheet 2.9', course: 'math', type: 'M', estMin: 30, actualMin: 24 },
    { date: ds(0), hourStarted: 16, title: 'Worksheet 3.2: quadratics', course: 'math', type: 'M', estMin: 30, actualMin: 27 },
  ];
  s.nyDoneDays = Object.fromEntries([-5, -4, -3, -2, -1].map(n => [ds(n), { at: 1, total: 4 + (n % 2) }]));   // five days in a row

  // Eight weeks of timed work and finished days, for the stats page
  if (seed === 'stats') {
    let x = 7;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const subs = [['math', 30, 1.3], ['science', 40, 1.15], ['english', 45, .95], ['history', 30, 1.05], ['languages', 20, 1]];
    s.hwLog = []; s.nyDoneDays = {};
    for (let n = -55; n <= 0; n++) {
      const weekend = [0, 6].includes(new Date(ds(n) + 'T12:00').getDay());
      const k = weekend ? (rnd() < .5 ? 1 : 0) : 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const [course, est, pace] = subs[Math.floor(rnd() * (rnd() < .45 ? 2 : subs.length))];
        s.hwLog.push({ date: ds(n), hourStarted: [15, 16, 16, 17, 17, 17, 18, 19, 20, 21][Math.floor(rnd() * 10)], title: 'Work', course, type: 'M',
          estMin: est, actualMin: Math.max(5, Math.round(est * pace * (.8 + rnd() * .45))) });
      }
      if (n < 0 && n > -12 && n !== -7) s.nyDoneDays[ds(n)] = { at: 1, total: k || 0 };
      if (n < 0 && n > -30 && k) s.hwTasksByDay[ds(n)] = Array.from({ length: k }, (_, i) => ({ id: `h${n}-${i}`, title: 'Work', course: 'math', estMin: 30, type: 'M', done: true }));
    }
  }
  if (seed === 'done') {
    for (const t of s.hwTasksByDay[ds(0)]) { t.done = true; t.actualMin = t.estMin; }
    for (const hb of s.tasks) s.weeks[wk][hb.name][col] = true;
  }
  if (seed === 'timer') {
    s.hwActiveTimers = { 'cal-b': { startedAt: Date.now() - 12 * 60000 - 14000, mode: 'up', estMin: 45, taskDate: ds(0), totalMs: 0, breakOffsets: [], pausedMs: 0 } };
    s.activeTimers = { 'Piano practice': { startedAt: Date.now() - 7 * 60000, durationMs: 20 * 60000, pausedMs: 0 } };
  }
  save(s);
})();
