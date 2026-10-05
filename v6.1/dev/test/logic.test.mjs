// logic.test.mjs — the rules, tested without a browser: the lib files run in
// a sandbox with a fake chrome.storage and a clock we control.
// Run: node --test dev/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIBS = ['lib/config.js', 'lib/night.js', 'lib/ics.js', 'lib/core.js', 'lib/gcal.js', 'lib/events.js',
  'lib/connections.js', 'lib/apps/todoist.js', 'lib/apps/google-tasks.js', 'lib/apps/ms-todo.js', 'lib/apps/canvas.js', 'lib/stats.js'];

// A sandbox whose Date says it's `iso` (local time). `google: true` sets a
// client ID so Google sign-in is available. Tests can replace c.__route (every
// fetch goes through it) and c.__auth (chrome.identity.launchWebAuthFlow).
function sandbox(iso, { store = {}, fetchText = '', google = false } = {}) {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  let offset = fixed - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  const data = JSON.parse(JSON.stringify(store)), session = {};
  const alarms = {};
  const makeArea = d => ({
    async get(q) {
      if (q == null) return JSON.parse(JSON.stringify(d));
      if (typeof q === 'string') return q in d ? { [q]: structuredClone(d[q]) } : {};
      return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, k in d ? structuredClone(d[k]) : structuredClone(v)]));
    },
    async set(o) { for (const [k, v] of Object.entries(o)) d[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete d[k]; },
  });
  const ctx = {
    Date: FakeDate, Intl, Math, JSON, console, URL, URLSearchParams, crypto: globalThis.crypto,
    setInterval: () => 0, setTimeout, clearTimeout, structuredClone, TextEncoder, btoa, atob,
    NY_GCAL_CLIENT_ID: google ? 'test-client' : '',
    chrome: {
      storage: { local: makeArea(data), session: makeArea(session), onChanged: { addListener() {} } },
      alarms: { create: async (n, o) => { alarms[n] = o; }, clear: async n => { delete alarms[n]; }, get: async n => alarms[n] },
      identity: { getRedirectURL: () => 'https://ext.chromiumapp.org/', launchWebAuthFlow: async o => ctx.__auth(o) },
    },
    fetch: async (url, opts) => ctx.__route(String(url), opts || {}),
  };
  ctx.__route = async () => ({ ok: true, status: 200, text: async () => fetchText });
  ctx.__auth = async () => { throw new Error('The user did not approve access.'); };
  vm.createContext(ctx);
  for (const f of LIBS) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  ctx.__data = data; ctx.__session = session; ctx.__alarms = alarms;
  ctx.__setNow = iso2 => { offset = new RealDate(iso2).getTime() - RealDate.now(); };
  return ctx;
}
// Objects made in the sandbox have its own Object and Array, which strict deep
// equality counts as different, so plain data is copied out. Functions pass
// through, and a promise resolves to a copy (a rejection stays as it was).
const copyOut = v => { if (v === null || typeof v !== 'object') return v; try { return structuredClone(v); } catch { return v; } };
const run = (ctx, code) => {
  const v = vm.runInContext(code, ctx);
  return v && typeof v.then === 'function' ? v.then(copyOut) : copyOut(v);
};

// ── Bedtime ─────────────────────────────────────────────────────────────────

test('school night: open at 10:59 PM, closed at 11:00 PM, open again at 6 AM', () => {
  const c = sandbox('2026-09-28T22:59:00');          // Monday
  const at = iso => run(c, `nyNight(new Date('${iso}'), { cfg: NY_CFG, calDays: {} }).closed`);
  assert.equal(at('2026-09-28T22:59:00'), false);
  assert.equal(at('2026-09-28T23:00:00'), true);
  assert.equal(at('2026-09-29T02:00:00'), true);
  assert.equal(at('2026-09-29T05:59:00'), true);
  assert.equal(at('2026-09-29T06:00:00'), false);
});

test('Friday and Saturday close at midnight; Sunday is a school night', () => {
  const c = sandbox('2026-10-02T23:30:00');          // Friday
  const at = iso => run(c, `nyNight(new Date('${iso}'), { cfg: NY_CFG, calDays: {} }).closed`);
  assert.equal(at('2026-10-02T23:30:00'), false);
  assert.equal(at('2026-10-03T00:00:00'), true);
  assert.equal(at('2026-10-03T23:59:00'), false);     // Saturday night
  assert.equal(at('2026-10-04T23:00:00'), true);      // Sunday night, school tomorrow
});

test('a bedtime after midnight works', () => {
  const c = sandbox('2026-10-03T00:30:00');
  run(c, `NY_CFG = nyNormalize({ bed: { days: [1,2,3,4,5], school: 1380, other: 1500, wake: 360, fit: true } })`);
  const at = iso => run(c, `nyNight(new Date('${iso}'), { cfg: NY_CFG, calDays: {} }).closed`);
  assert.equal(at('2026-10-03T00:30:00'), false);     // Friday night, 1 AM bedtime
  assert.equal(at('2026-10-03T01:00:00'), true);
  assert.equal(at('2026-10-03T06:00:00'), false);
});

test('the calendar overrides weekdays: no class Monday means Sunday is not a school night', () => {
  const c = sandbox('2026-10-11T23:30:00');          // Sunday; Monday Oct 12 is a holiday
  const closed = run(c, `nyNight(new Date(), { cfg: NY_CFG, calDays: { '2026-10-12': false } }).closed`);
  assert.equal(closed, false);
});

test('next edge is the next bedtime, wake or midnight', () => {
  const c = sandbox('2026-09-28T21:00:00');
  const edge = run(c, `new Date(nyNextEdge(new Date(), { cfg: NY_CFG, calDays: {} })).toString()`);
  assert.match(edge, /23:00:00/);
  c.__setNow('2026-09-28T23:10:00');
  assert.match(run(c, `new Date(nyNextEdge(new Date(), { cfg: NY_CFG, calDays: {} })).toString()`), /Tue Sep 29 2026 00:00:00/);
});

test('earlier bedtime applies now; later waits a day', () => {
  const c = sandbox('2026-09-28T22:58:00');
  const earlier = run(c, `nyPlanBed(NY_CFG, { ...NY_CFG.bed, school: 1350 })`);
  assert.equal(earlier.when, 'now');
  assert.equal(earlier.cfg.bed.school, 1350);
  const later = run(c, `nyPlanBed(NY_CFG, { ...NY_CFG.bed, school: 1440 })`);
  assert.equal(later.when, '2026-09-29');
  assert.equal(later.cfg.bed.school, 1380);           // tonight stays 11 PM
  assert.equal(later.cfg.bedNext.bed.school, 1440);
  // Turning off the length check, or dropping a school day, is also later
  assert.equal(run(c, `nyPlanBed(NY_CFG, { ...NY_CFG.bed, fit: false }).when`), '2026-09-29');
  assert.equal(run(c, `nyPlanBed(NY_CFG, { ...NY_CFG.bed, days: [1,2,3,4] }).when`), '2026-09-29');
  assert.equal(run(c, `nyPlanBed(NY_CFG, { ...NY_CFG.bed, wake: 300 }).when`), '2026-09-29');
});

test('a later bedtime set tonight does not reopen YouTube after midnight', () => {
  const c = sandbox('2026-09-28T22:58:00');
  run(c, `NY_CFG = nyPlanBed(NY_CFG, { ...NY_CFG.bed, school: 1500 }).cfg`);   // 1 AM, from tomorrow
  c.__setNow('2026-09-29T00:30:00');
  assert.equal(run(c, `nyNight(new Date(), { cfg: NY_CFG, calDays: {} }).closed`), true);
  c.__setNow('2026-09-29T23:30:00');                  // tomorrow night it counts
  assert.equal(run(c, `nyNight(new Date(), { cfg: NY_CFG, calDays: {} }).closed`), false);
  assert.ok(run(c, `nyPromoteBed(NY_CFG, new Date())`));
});

// ── Tags and subjects ───────────────────────────────────────────────────────

test('emoji and word tags both work, with overrides', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const p = s => run(c, `nyParseTitle(${JSON.stringify(s)})`);
  assert.deepEqual({ ...p('📝 Algebra worksheet [45m]') }, { title: 'Algebra worksheet', estMin: 45, type: 'M', courseHint: '' });
  assert.equal(p('📝️ Worksheet').title, 'Worksheet');                    // with a variation selector
  assert.equal(p('HW: Essay draft [up]').type, 'Q');
  assert.equal(p('hw - essay').title, 'essay');
  assert.equal(p('HWK practice'), null);                                     // HW must be a whole word
  assert.equal(p('Math class'), null);
  assert.equal(p('✍️ Poem').courseHint, 'english');
  assert.equal(p('📚 Review [Q]').type, 'Q');                                // v5 style still works
});

test('subjects match whole words only', () => {
  const c = sandbox('2026-09-28T12:00:00');
  assert.equal(run(c, `nyGuessSubject('Algebra worksheet')`), 'math');
  assert.equal(run(c, `nyGuessSubject('Read the paper')`), 'other');        // "art" isn't in "paper"
  assert.equal(run(c, `nyGuessSubject('Art project')`), 'arts');
  assert.equal(run(c, `nyGuessSubject('Mystery', 'science')`), 'science');  // tag's fallback
});

// ── Calendar feed ───────────────────────────────────────────────────────────

const ICS_TEXT = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'UID:w1', 'SUMMARY:📝 Worksheet [20m]', 'DTSTART:20260921T160000', 'DTEND:20260921T170000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE:20260930T160000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:w1', 'RECURRENCE-ID:20261005T160000', 'SUMMARY:📝 Worksheet moved [20m]',
  'DTSTART:20261006T160000', 'DTEND:20261006T170000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c1', 'SUMMARY:Math 10 (Period 1)', 'DTSTART:20260901T083000', 'DTEND:20260901T093000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'EXDATE:20261012T083000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d1', 'SUMMARY:Dentist', 'DTSTART:20260929T153000', 'DTEND:20260929T160000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b1', 'SUMMARY:Homework block', 'DTSTART:20260928T190000', 'DTEND:20260928T201500', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:x1', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'DTSTART:20260928T100000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:m1', 'SUMMARY:Club', 'DTSTART:20260908T170000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a1', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261001', 'DTEND;VALUE=DATE:20261003', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('repeats, exceptions, moved instances and multi-day events', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const events = run(c, `ICS.parse(${JSON.stringify(ICS_TEXT)})`);
  const days = uid => run(c, `(() => { const ev = ICS.parse(${JSON.stringify(ICS_TEXT)}).find(e => e.uid === '${uid}' && !e.recurrenceId);
    return ICS.days(ev, new Date(2026, 8, 27), new Date(2026, 9, 14)); })()`);
  assert.equal(events.some(e => e.summary === 'Cancelled thing'), false);
  assert.deepEqual([...days('w1')], ['2026-09-28', '2026-10-07', '2026-10-12', '2026-10-14']);   // Sep 30 cut, Oct 5 moved
  assert.deepEqual([...days('m1')], ['2026-10-13']);                                            // second Tuesday
  assert.deepEqual([...days('a1')], ['2026-10-01', '2026-10-02']);                              // all-day, two days
  assert.equal(days('c1').includes('2026-10-12'), false);                                       // holiday
});

test('a feed gives its name, and events their place and notes', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const text = ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Grade 10 Homeroom', 'BEGIN:VEVENT', 'UID:p1', 'SUMMARY:Dentist',
    'LOCATION:12 Main St\\, Suite 3', 'DESCRIPTION:Bring the form\\nand a pen', 'DTSTART:20260929T153000',
    'DTEND:20260929T160000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.equal(run(c, `ICS.name(${JSON.stringify(text)})`), 'Grade 10 Homeroom');
  assert.equal(run(c, `ICS.name(${JSON.stringify(ICS_TEXT)})`), '');
  const ev = run(c, `ICS.parse(${JSON.stringify(text)})[0]`);
  assert.equal(ev.location, '12 Main St, Suite 3');
  assert.equal(ev.description, 'Bring the form and a pen');
});

test('a day can be read off the end of any text', () => {
  const c = sandbox('2026-09-28T16:00:00');                        // a Monday
  const at = t => run(c, `(() => { const r = nyDayAtEnd(${JSON.stringify(t)}, nyParseDs('2026-09-28')); return r && { date: hwTodayStr(r.date), rest: r.rest }; })()`);
  assert.deepEqual(at('Essay friday'), { date: '2026-10-02', rest: 'Essay' });
  assert.deepEqual(at('Poster due oct 12'), { date: '2026-10-12', rest: 'Poster' });
  assert.equal(at('Friday'), null, 'a lone day name is not a day at the end');
  assert.equal(at('Worksheet 3.2'), null);
});

test('sync: tasks for two weeks, events, school days, blocks', async () => {
  const c = sandbox('2026-09-28T12:00:00', {
    fetchText: ICS_TEXT,
    store: { hwSettings: { icsUrl: 'webcal://calendar.example/feed.ics', phaseMode: 'target' },
      config: { classMark: '(Period' } },
  });
  await run(c, `nyLoadConfig().then(() => hwSyncFromCalendar({ force: true }))`);
  const d = c.__data;
  assert.deepEqual(d.hwTasksByDay['2026-09-28'].map(t => t.title).sort(), ['Homework block', 'Worksheet']);
  const block = d.hwTasksByDay['2026-09-28'].find(t => t.title === 'Homework block');
  assert.equal(block.estMin, 75);
  assert.equal(block.block, true);
  assert.ok(d.hwTasksByDay['2026-10-07'], 'a task two weeks out is planned');
  assert.equal(d.hwTasksByDay['2026-09-30'], undefined, 'the cancelled Wednesday has no task');
  const shown = ds => run(c, `calLoadRaw().then(r => calCollect(r, '${ds}', '${ds}').filter(e => !calIsTask(e)).map(e => e.title))`);
  assert.deepEqual(await shown('2026-09-29'), ['Math 10 (Period 1)', 'Dentist']);
  assert.equal((await shown('2026-09-28')).some(t => t.startsWith('📝') || t === 'Homework block'), false, 'tasks are not doubled on the calendar');
  assert.equal(d.hwSchoolDays.days['2026-10-12'], false);
  assert.equal(d.hwSchoolDays.days['2026-10-13'], true);
});

test('sync: an event removed from the calendar leaves future days, never today', async () => {
  const c = sandbox('2026-09-28T12:00:00', { fetchText: ICS_TEXT,
    store: { hwSettings: { icsUrl: 'https://calendar.example/feed.ics' } } });
  await run(c, `hwSyncFromCalendar({ force: true })`);
  const bare = ICS_TEXT.replace(/BEGIN:VEVENT\r\nUID:w1[\s\S]*?END:VEVENT\r\n/, '');
  run(c, `fetch = async () => ({ ok: true, status: 200, text: async () => ${JSON.stringify(bare)} })`);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.ok(c.__data.hwTasksByDay['2026-09-28'].some(t => t.title === 'Worksheet'), 'today keeps it');
  assert.equal(c.__data.hwTasksByDay['2026-10-07'], undefined, 'next week drops it');
});

test('sync: a task removed by hand stays removed', async () => {
  const c = sandbox('2026-09-28T12:00:00', { fetchText: ICS_TEXT,
    store: { hwSettings: { icsUrl: 'https://calendar.example/feed.ics' } } });
  await run(c, `hwSyncFromCalendar({ force: true })`);
  await run(c, `hwRemoveTask('2026-09-28', 'cal-w1')`);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.hwTasksByDay['2026-09-28'].some(t => t.id === 'cal-w1'), false);
});

test('sync: a tick or a new task made while the calendar is loading is kept', async () => {
  const c = sandbox('2026-09-28T12:00:00', { fetchText: ICS_TEXT,
    store: { hwSettings: { icsUrl: 'https://calendar.example/feed.ics' } } });
  await run(c, `hwSyncFromCalendar({ force: true })`);
  let release, reached;
  const gate = new Promise(r => { release = r; }), waiting = new Promise(r => { reached = r; });
  c.__route = async () => { reached(); await gate; return { ok: true, status: 200, text: async () => ICS_TEXT }; };
  const sync = run(c, `hwSyncFromCalendar({ force: true })`);
  await waiting;                                                   // the sync is waiting on the network
  await run(c, `hwSetDone('2026-09-28', 'cal-w1', true)`);
  await run(c, `hwAddTask('2026-09-28', { title: 'Read ch 4' })`);
  release();
  await sync;
  const today = c.__data.hwTasksByDay['2026-09-28'];
  assert.equal(today.find(t => t.id === 'cal-w1').done, true, 'the tick stays');
  assert.ok(today.some(t => t.title === 'Read ch 4'), 'the new task stays');
});

test('the month and Coming up show what stands out: weekly and daily things are routine, birthdays are not', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const t = (m, d, h) => new Date(2026, m - 1, d, h).getTime();
  const g = (id, series, start, extra = {}) => ({ id, source: 'google', calendarId: 'sam', seriesId: series, recurring: true,
    title: series, allDay: false, start, end: start + 3600e3, ...extra });
  const evs = [
    g('p1', 'Piano', t(9, 28, 17)), g('p2', 'Piano', t(10, 5, 17)), g('p3', 'Piano', t(10, 12, 17)),     // weekly
    { ...g('b1', 'Mia’s birthday', 0), allDay: true, start: '2026-10-03', end: '2026-10-04' },           // yearly, once here
    g('o1', 'Orthodontist', t(9, 30, 16)), g('o2', 'Orthodontist', t(10, 30, 16)),                       // monthly
    { id: 'f:trip:1', source: 'feed', calendarId: 'f1', seriesId: 'trip', title: 'Trip', allDay: true, start: '2026-10-08', end: '2026-10-09' },
    { id: 'f:trip:2', source: 'feed', calendarId: 'f1', seriesId: 'trip', title: 'Trip', allDay: true, start: '2026-10-09', end: '2026-10-10' },
    { id: 'f:gym:1', source: 'feed', calendarId: 'f1', seriesId: 'gym', title: 'Gym', allDay: true, start: '2026-10-01', end: '2026-10-02' },
    { id: 'f:gym:2', source: 'feed', calendarId: 'f1', seriesId: 'gym', title: 'Gym', allDay: true, start: '2026-10-08', end: '2026-10-09' },
    g('d1', 'Dentist', t(10, 7, 15), { recurring: false }),
    g('m1', 'Meds', t(9, 29, 8)), g('m2', 'Meds', t(9, 30, 8)), g('m3', 'Meds', t(10, 1, 8)),           // daily
    ...[1, 2, 5, 6].map(d => ({ id: `f:math:${d}`, source: 'feed', calendarId: 'f1', seriesId: 'math', title: 'Math 10',
      allDay: false, start: t(10, d, 9), end: t(10, d, 10) })),                                         // weekday classes
  ];
  assert.deepEqual(run(c, `calStandouts(${JSON.stringify(evs)}).map(e => e.id)`), ['b1', 'o1', 'o2', 'f:trip:1', 'f:trip:2', 'd1']);
});

// ── Carry-over, the gate, timers ────────────────────────────────────────────

test('unfinished tasks carry into today; blocks and finished ones stay', async () => {
  const c = sandbox('2026-09-29T08:00:00', { store: { hwTasksByDay: {
    '2026-09-28': [
      { id: 'a', title: 'Essay', done: false },
      { id: 'b', title: 'Quiz prep', done: true },
      { id: 'c', title: 'Homework block', done: false, block: true },
    ] } } });
  await run(c, `hwRollForward()`);
  const d = c.__data.hwTasksByDay;
  assert.deepEqual(d['2026-09-29'].map(t => [t.id, t.carriedFrom]), [['a', '2026-09-28']]);
  assert.deepEqual(d['2026-09-28'].map(t => t.id).sort(), ['b', 'c']);
});

test('the gate: habits always, tasks only before a school day, breaks, bedtime', () => {
  const store = { tasks: [{ name: 'Read', days: Array(7).fill(true) }], weeks: {}, activeTimers: {} };
  const hw = { hwTasksByDay: { '2026-09-28': [{ id: 't', title: 'Worksheet', done: false }],
    '2026-10-02': [{ id: 'f', title: 'Friday thing', done: false }] }, breakUntil: 0, hwSettings: {} };
  const c = sandbox('2026-09-28T16:00:00');                       // Monday
  const gate = (s, h) => run(c, `nyGate(${JSON.stringify(s)}, ${JSON.stringify(h)})`);
  let g = gate(store, hw);
  assert.equal(g.open, false); assert.equal(g.counts.left, 2);
  const wk = run(c, `getWeekKey(new Date())`);
  const doneStore = { ...store, weeks: { [wk]: { Read: [true, false, false, false, false, false, false] } } };
  assert.equal(gate(doneStore, hw).counts.left, 1);
  assert.equal(gate(doneStore, { ...hw, hwTasksByDay: { '2026-09-28': [{ id: 't', done: true }] } }).open, true);
  assert.equal(gate(store, { ...hw, breakUntil: Date.parse('2026-09-28T16:03:00') }).why, 'break');
  c.__setNow('2026-10-02T16:00:00');                               // Friday: the task doesn't gate
  const fri = gate({ ...store, weeks: {} }, hw);
  assert.equal(fri.counts.tasks, 0);
  c.__setNow('2026-09-28T23:05:00');
  assert.equal(gate(doneStore, { ...hw, hwTasksByDay: {} }).why, 'bed');
});

test('timers pause, resume and log real time', async () => {
  const c = sandbox('2026-09-28T16:00:00', { store: { hwTasksByDay: {
    '2026-09-28': [{ id: 't', title: 'Worksheet', estMin: 60, type: 'M', done: false, course: 'math' }] },
    hwSettings: { phaseMode: 'target' } } });
  await run(c, `hwStartTimer(hwTasksOn({ hwTasksByDay: ${JSON.stringify(c.__data.hwTasksByDay)} }, '2026-09-28')[0], 'target')`);
  const t0 = c.__data.hwActiveTimers.t;
  assert.equal(t0.mode, 'down');
  assert.deepEqual(t0.breakOffsets, [25 * 60000, 55 * 60000]);     // 60 min: 25, break, 25, break, 10
  assert.ok(c.__alarms['hwdone::t'] && c.__alarms['hwbrk::t::0']);
  c.__setNow('2026-09-28T16:10:00');
  await run(c, `hwPauseTimer('t', true)`);
  assert.equal(c.__alarms['hwdone::t'], undefined, 'paused timers have no alarm');
  c.__setNow('2026-09-28T16:40:00');                               // 30 minutes paused
  await run(c, `hwPauseTimer('t', false)`);
  assert.equal(run(c, `Math.round(nyElapsed(${JSON.stringify(c.__data.hwActiveTimers.t)}) / 60000)`), 10);
  assert.ok(Math.abs(c.__alarms['hwdone::t'].when - Date.parse('2026-09-28T17:40:00')) < 1000);   // 16:00 + 30 paused + 70
  c.__setNow('2026-09-28T16:52:00');
  await run(c, `hwSetDone('2026-09-28', 't', true)`);
  const task = c.__data.hwTasksByDay['2026-09-28'][0];
  assert.equal(task.done, true);
  assert.equal(task.actualMin, 22);
  assert.equal(c.__data.hwLog.length, 1);
});

test('the personal settings file reproduces v5.8 behaviour', () => {
  const mine = JSON.parse(readFileSync(join(root, 'dev', 'personal', 'my-settings.json'), 'utf8'));
  const c = sandbox('2026-09-28T12:00:00');
  run(c, `NY_CFG = nyNormalize(${JSON.stringify(mine.config)})`);
  const t = run(c, `nyParseTitle('📋 Science fair: stormwater project [60m] [Q]')`);
  assert.equal(t.estMin, 60); assert.equal(t.type, 'Q');
  assert.equal(run(c, `nyGuessSubject(${JSON.stringify(t.title)}, ${JSON.stringify(t.courseHint)})`), 'fair');
  assert.equal(run(c, `nyGuessSubject('Cell transport pre-lab')`), 'science');
  assert.equal(run(c, `nyGuessSubject('Print the paper')`), 'other');         // v5 filed this under Phys Ed
  assert.equal(run(c, `nyIsClass('AP World History — Mr. Falk (Day 5 P3)')`), true);
  assert.equal(run(c, `nyIsBlock('Competition session: AMC 10')`), true);
});

test('sites: one added today can be removed right away; an older one that’s on goes at midnight, like switching it off', () => {
  const c = sandbox('2026-09-28T20:00:00');
  run(c, `NY_CFG.customSites = [{ id: 'new', name: 'discord.com', domains: ['discord.com'], added: '2026-09-28' },
    { id: 'old', name: 'x.org', domains: ['x.org'], added: '2026-09-20' }, { id: 'off', name: 'y.org', domains: ['y.org'] }];
    NY_CFG.sitesOn = ['youtube', 'new', 'old']`);
  const ids = cfg => cfg.customSites.map(s => s.id);
  const a = run(c, `nyRemoveSite(NY_CFG, 'new')`);
  assert.equal(a.when, 'now', 'added today: nothing to wait for');
  assert.deepEqual(ids(a.cfg), ['old', 'off']);
  assert.equal(a.cfg.sitesOn.includes('new'), false);
  assert.equal(run(c, `nyRemoveSite(NY_CFG, 'off')`).when, 'now', 'already off');
  const b = run(c, `nyRemoveSite(NY_CFG, 'old')`);
  assert.equal(b.when, '2026-09-29');
  assert.ok(b.cfg.sitesOn.includes('old'), 'still closed today');
  assert.equal(b.cfg.customSites.find(s => s.id === 'old').removeFrom, '2026-09-29');
  const back = run(c, `nyPlanSite(${JSON.stringify(b.cfg)}, 'old', true).cfg`);
  assert.equal('removeFrom' in back.customSites.find(s => s.id === 'old'), false, 'switching it back on keeps it');
  const next = run(c, `nyPromoteBed(${JSON.stringify(b.cfg)}, new Date('2026-09-29T00:00:30'))`);
  assert.deepEqual(ids(next), ['new', 'off']);
  assert.equal(next.sitesOn.includes('old'), false);
  assert.equal(run(c, `nyRemoveSite(NY_CFG, 'youtube')`).when, null, 'the built-in sites switch off; they aren’t removed');
});

test('sites: on now, off tomorrow, labels and matching', () => {
  const c = sandbox('2026-09-28T16:00:00');
  run(c, `NY_CFG = nyPlanSite(NY_CFG, 'tiktok', true).cfg`);
  assert.deepEqual([...run(c, `nySitesOn().map(s => s.id)`)], ['youtube', 'tiktok']);
  assert.equal(run(c, `nySitesLabel()`), 'YouTube and TikTok');
  run(c, `NY_CFG = nyPlanSite(NY_CFG, 'reddit', true).cfg`);
  assert.equal(run(c, `nySitesLabel()`), 'YouTube + 2 more');
  const off = run(c, `nyPlanSite(NY_CFG, 'tiktok', false)`);
  assert.equal(off.when, '2026-09-29');
  run(c, `NY_CFG = nyPlanSite(NY_CFG, 'tiktok', false).cfg`);
  assert.ok(run(c, `nySitesOn().some(s => s.id === 'tiktok')`), 'still closed today');
  assert.equal(run(c, `nySitesOn(NY_CFG, '2026-09-29').some(s => s.id === 'tiktok')`), false, 'open tomorrow');
  c.__setNow('2026-09-29T00:00:30');
  const next = run(c, `nyPromoteBed(NY_CFG)`);
  assert.equal(next.sitesOn.includes('tiktok'), false);
  assert.deepEqual({ ...next.sitesOffFrom }, {});
  assert.equal(run(c, `nySiteFor('m.youtube.com').id`), 'youtube');
  assert.equal(run(c, `nySiteFor('old.reddit.com').id`), 'reddit');
  assert.equal(run(c, `nySiteFor('notreddit.com')`), null);
  assert.equal(run(c, `nySiteFor('twitter.com').id`), 'x');
  assert.equal(run(c, `nyCleanDomain('https://www.Discord.com/channels/1')`), 'discord.com');
  assert.equal(run(c, `nyCleanDomain('hello world')`), null);
});

test('normalize keeps settings sane', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const n = run(c, `nyNormalize({ theme: 'neon', accent: 'plaid', sitesOn: ['youtube', 'nope', 'youtube'], sitesOffFrom: { tiktok: '2026-09-29' } })`);
  assert.equal(n.theme, 'system'); assert.equal(n.accent, 'lilac');
  assert.deepEqual([...n.sitesOn], ['youtube']);
  assert.deepEqual({ ...n.sitesOffFrom }, {}, 'a pending switch-off for a site that isn’t on is dropped');
});

test('quick add reads a length and a day off the end', () => {
  const c = sandbox('2026-09-28T16:00:00');                        // a Monday
  const p = t => { const r = run(c, `(() => { const r = nyParseQuick(${JSON.stringify(t)}); return { title: r.title, minutes: r.minutes, date: r.date && hwTodayStr(r.date) }; })()`); return { ...r }; };
  assert.deepEqual(p('Essay friday 45m'), { title: 'Essay', minutes: 45, date: '2026-10-02' });
  assert.deepEqual(p('Essay 45m friday'), { title: 'Essay', minutes: 45, date: '2026-10-02' });
  assert.deepEqual(p('Lab report tomorrow'), { title: 'Lab report', minutes: null, date: '2026-09-29' });
  assert.deepEqual(p('Read ch 5 due 10/3'), { title: 'Read ch 5', minutes: null, date: '2026-10-03' });
  assert.deepEqual(p('Poster by oct 12'), { title: 'Poster', minutes: null, date: '2026-10-12' });
  assert.deepEqual(p('Poster 12th October'), { title: 'Poster', minutes: null, date: '2026-10-12' });
  assert.deepEqual(p('Quiz review in 3 days'), { title: 'Quiz review', minutes: null, date: '2026-10-01' });
  assert.deepEqual(p('Project next mon 2h'), { title: 'Project', minutes: 120, date: '2026-10-05' });
  assert.deepEqual(p('Recital prep 2026-11-20'), { title: 'Recital prep', minutes: null, date: '2026-11-20' });
  assert.deepEqual(p('Winter essay 1/15'), { title: 'Winter essay', minutes: null, date: '2027-01-15' }, 'a date gone by means next year');
  assert.deepEqual(p('Math monday'), { title: 'Math', minutes: null, date: '2026-09-28' }, 'the same weekday means today');
  // Things that are just titles
  assert.equal(p('Look at the sun').date, null);
  assert.equal(p('Stargazing due sun').date, '2026-10-04');
  assert.equal(p('Worksheet 3.2').date, null);
  assert.deepEqual(p('Friday'), { title: 'Friday', minutes: null, date: null }, 'a lone day name stays the title');
  assert.equal(p('Read 13/40 pages').date, null);
});

// The policy people read inside the extension says exactly what the Web Store's copy says.
test('the in-app privacy policy matches store/privacy.md', () => {
  const words = s => s.replace(/<[^>]+>/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.;:])/g, '$1');
  const page = words(readFileSync(join(root, 'pages/privacy.html'), 'utf8'));
  const lines = readFileSync(join(root, 'store/privacy.md'), 'utf8').split('\n')
    .filter(l => l.trim() && !l.startsWith('# '))
    .map(l => words(l.replace(/^#+\s*/, '').replace(/^_|_$/g, '')).trim());
  for (const l of lines) assert.ok(page.includes(l), `pages/privacy.html is missing: ${l}`);
});

// ── Events: one list from every calendar ────────────────────────────────────

test('other apps’ calendar colours land on the nearest pastel', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const near = hex => run(c, `calNearestColor('${hex}')`);
  assert.equal(near('#d50000'), 'peach');     // Google's Tomato
  assert.equal(near('#0b8043'), 'mint');      // Basil
  assert.equal(near('#f6bf26'), 'butter');    // Banana
  assert.equal(near('#039be5'), 'sky');       // Peacock
  assert.equal(near('#8e24aa'), 'lilac');     // Grape
  assert.equal(near('#616161'), 'stone');     // Graphite
  assert.equal(near('nonsense'), 'stone');
  assert.equal(run(c, `calUnusedColor(['lilac', 'mint'])`), 'peach');
});

test('events land on the right days, across midnight and daylight saving', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const days = ev => [...run(c, `calDaysOf(${ev})`)];
  assert.deepEqual(days(`{ allDay: false, start: new Date(2026, 8, 29, 15).getTime(), end: new Date(2026, 8, 29, 16).getTime() }`), ['2026-09-29']);
  assert.deepEqual(days(`{ allDay: false, start: new Date(2026, 8, 29, 23).getTime(), end: new Date(2026, 8, 30, 1).getTime() }`), ['2026-09-29', '2026-09-30']);
  assert.deepEqual(days(`{ allDay: false, start: new Date(2026, 8, 29, 22).getTime(), end: new Date(2026, 8, 30, 0).getTime() }`), ['2026-09-29'], 'ending at midnight stays on one day');
  assert.deepEqual(days(`{ allDay: true, start: '2026-10-01', end: '2026-10-03' }`), ['2026-10-01', '2026-10-02']);
  assert.deepEqual(days(`{ allDay: true, start: '2026-11-01', end: '2026-11-02' }`), ['2026-11-01'], 'the day clocks change');
  assert.deepEqual(days(`{ allDay: true, start: '2026-03-08', end: '2026-03-09' }`), ['2026-03-08']);
  assert.deepEqual([...run(c, `calMonthsBetween('2026-11-28', '2027-02-03')`)], ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('6.0’s one secret link becomes the first calendar', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { hwSettings: { icsUrl: 'webcal://calendar.example/feed.ics', phaseMode: 'target' } } });
  const feeds = await run(c, `calFeedsLoad()`);
  assert.deepEqual(feeds, [{ id: 'feed-1', url: 'https://calendar.example/feed.ics', name: 'calendar.example', color: 'sky', on: true }]);
  assert.equal(c.__data.hwSettings.icsUrl, '');
  assert.equal(c.__data.hwSettings.phaseMode, 'target', 'other settings stay');
  assert.equal((await run(c, `calFeedsLoad()`)).length, 1, 'only moves once');
  assert.equal(run(c, `calFeedName('https://outlook.live.com/owa/calendar/x/reachcalendar.ics')`), 'Outlook');
  assert.equal(run(c, `calFeedName('https://p42-caldav.icloud.com/published/2/abc')`), 'iCloud');
  assert.equal(run(c, `calFeedGoogleId('https://calendar.google.com/calendar/ical/sam%40example.com/private-abc/basic.ics')`), 'sam@example.com');
});

test('secret links: every switched-on link in one list, in order', async () => {
  const c = sandbox('2026-09-28T12:00:00', { fetchText: ICS_TEXT,
    store: { calFeeds: [{ id: 'f1', url: 'https://calendar.example/a.ics', name: 'School', color: 'sky', on: true }] } });
  await run(c, `calRefreshFeeds({ force: true })`);
  const titles = ds => run(c, `calLoadRaw().then(r => calCollect(r, '${ds}', '${ds}').map(e => e.title))`);
  assert.deepEqual(await titles('2026-09-29'), ['Math 10 (Period 1)', 'Dentist']);
  const dentist = await run(c, `calLoadRaw().then(r => calCollect(r, '2026-09-29', '2026-09-29')[1])`);
  assert.equal(dentist.source, 'feed');
  assert.equal(dentist.calendarName, 'School');
  assert.equal(dentist.color, 'sky');
  assert.equal(dentist.editable, false);
  assert.equal(dentist.start, new Date(2026, 8, 29, 15, 30).getTime());
  assert.equal(dentist.end, new Date(2026, 8, 29, 16, 0).getTime());
  assert.deepEqual(await titles('2026-10-01'), ['Trip', 'Math 10 (Period 1)'], 'all-day first');
  await run(c, `calSetFeed('f1', { on: false })`);
  assert.deepEqual(await titles('2026-09-29'), [], 'switched off');
});

test('a link that stops working keeps its events and says why', async () => {
  const c = sandbox('2026-09-28T12:00:00', { fetchText: ICS_TEXT,
    store: { calFeeds: [{ id: 'f1', url: 'https://calendar.example/a.ics', name: 'School', color: 'sky', on: true }] } });
  await run(c, `calRefreshFeeds({ force: true })`);
  c.__route = async () => ({ ok: false, status: 404, text: async () => '' });
  await run(c, `calRefreshFeeds({ force: true })`);
  assert.equal(c.__data.feedCache.f1.error, 'That calendar link doesn’t work anymore.');
  assert.ok(c.__data.feedCache.f1.items.length > 10, 'the last events stay');
});

test('adding a link checks it, names it and refuses repeats', async () => {
  const named = ICS_TEXT.replace('BEGIN:VCALENDAR', 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Soccer');
  const c = sandbox('2026-09-28T12:00:00', { fetchText: named });
  const feed = await run(c, `calAddFeed('webcal://team.example/cal.ics')`);
  assert.equal(feed.name, 'Soccer');
  assert.equal(feed.url, 'https://team.example/cal.ics');
  assert.ok(c.__data.feedCache[feed.id].items.length > 0, 'its events are there straight away');
  await assert.rejects(run(c, `calAddFeed('https://team.example/cal.ics')`), /already here/);
  await assert.rejects(run(c, `calAddFeed('ftp://x')`), /start with https/);
  c.__route = async () => ({ ok: true, status: 200, text: async () => '<html>' });
  await assert.rejects(run(c, `calAddFeed('https://other.example/x')`), /isn’t a calendar feed/);
  await run(c, `calRemoveFeed('${feed.id}')`);
  assert.equal(c.__data.calFeeds.length, 0);
  assert.equal(c.__data.feedCache[feed.id], undefined);
});

test('local events repeat, skip and land on the right days', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const titles = (list, from, to) => [...run(c, `calExpandLocal(${JSON.stringify(list)}, '${from}', '${to}').map(e => e.occurrence)`)];
  const mon4pm = new Date(2026, 8, 28, 16).getTime();
  const weekly = { id: 'l-1', title: 'Piano', allDay: false, start: mon4pm, end: mon4pm + 3600e3, repeat: 'weekly', skip: ['2026-10-05'] };
  assert.deepEqual(titles([weekly], '2026-09-20', '2026-10-19'), ['2026-09-28', '2026-10-12', '2026-10-19']);
  const monthly = { id: 'l-2', title: 'Rent', allDay: true, start: '2026-08-31', end: '2026-09-01', repeat: 'monthly', skip: [] };
  assert.deepEqual(titles([monthly], '2026-08-01', '2026-12-31'), ['2026-08-31', '2026-10-31', '2026-12-31'], 'no 31st, no rent');
  const weekdays = { id: 'l-3', title: 'Bus', allDay: false, start: mon4pm, end: mon4pm + 600e3, repeat: 'weekdays', skip: [] };
  assert.equal(titles([weekdays], '2026-09-28', '2026-10-11').length, 10);
  const late = { id: 'l-4', title: 'Late show', allDay: false, start: new Date(2026, 8, 30, 23).getTime(), end: new Date(2026, 9, 1, 1).getTime(), repeat: null, skip: [] };
  assert.deepEqual(titles([late], '2026-10-01', '2026-10-01'), ['2026-09-30'], 'still shows the morning after');
  const occ = run(c, `calExpandLocal([${JSON.stringify(weekly)}], '2026-10-12', '2026-10-12')[0]`);
  assert.equal(occ.id, 'l-1:2026-10-12');
  assert.equal(occ.seriesId, 'l-1');
  assert.equal(occ.recurring, true);
  assert.equal(occ.start, new Date(2026, 9, 12, 16).getTime());
});

test('local events: add, change one or all, delete one or all', async () => {
  const c = sandbox('2026-09-28T12:00:00');
  const mon4pm = new Date(2026, 8, 28, 16).getTime();
  const ev = await run(c, `calLocalAdd({ title: ' Piano ', allDay: false, start: ${mon4pm}, end: ${mon4pm + 3600e3}, repeat: 'weekly', place: '', notes: '' })`);
  assert.equal(ev.title, 'Piano');
  const occOn = ds => `calExpandLocal(await calLocalLoad(), '${ds}', '${ds}')[0]`;
  // Just this one: that week moves to 5 PM; the series skips it.
  await run(c, `(async () => { const o = ${occOn('2026-10-05')}; await calLocalChange(o, { ...o, title: 'Piano (late)', start: o.start + 3600e3, end: o.end + 3600e3 }, 'one'); })()`);
  let list = c.__data.localEvents;
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].skip, ['2026-10-05']);
  assert.equal(list[1].title, 'Piano (late)');
  assert.equal(list[1].repeat, null);
  // All of them: moved from Monday 4 PM to Tuesday 5 PM, starting the week it began.
  await run(c, `(async () => { const o = ${occOn('2026-10-12')}; const s = new Date(2026, 9, 13, 17).getTime(); await calLocalChange(o, { ...o, start: s, end: s + 3600e3 }, 'all'); })()`);
  list = c.__data.localEvents;
  assert.equal(list[0].start, new Date(2026, 8, 29, 17).getTime());
  assert.equal(list[0].end, new Date(2026, 8, 29, 18).getTime());
  assert.deepEqual(list[0].skip, ['2026-10-05'], 'skips stay while the repeat is the same');
  // Delete one, then all.
  await run(c, `(async () => { await calLocalDelete(${occOn('2026-10-20')}, 'one'); })()`);
  assert.deepEqual(c.__data.localEvents[0].skip, ['2026-10-05', '2026-10-20']);
  await run(c, `(async () => { await calLocalDelete(${occOn('2026-10-27')}, 'all'); })()`);
  assert.deepEqual(c.__data.localEvents.map(e => e.title), ['Piano (late)']);
});

test('local events are in the one list, editable, in their colour', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { calLocalColor: 'pink' } });
  await run(c, `calLocalAdd({ title: 'Movie night', allDay: true, start: '2026-10-02', end: '2026-10-03' })`);
  const ev = await run(c, `calLoadRaw().then(r => calCollect(r, '2026-10-02', '2026-10-02')[0])`);
  assert.equal(ev.source, 'local');
  assert.equal(ev.calendarId, 'local');
  assert.equal(ev.calendarName, 'Not yet. only');
  assert.equal(ev.color, 'pink');
  assert.equal(ev.editable, true);
});

test('typed events: a time, a range, a length, a day and a place, in any order', () => {
  const c = sandbox('2026-09-28T16:00:00');                        // a Monday
  const p = t => run(c, `(() => { const r = nyParseEvent(${JSON.stringify(t)}); return { ...r, date: r.date && hwTodayStr(r.date) }; })()`);
  const pick = (r, ...keys) => Object.fromEntries(keys.map(k => [k, r[k]]));
  const k = ['title', 'date', 'allDay', 'startMin', 'endMin', 'place'];
  assert.deepEqual(pick(p('Dentist fri 3pm'), ...k), { title: 'Dentist', date: '2026-10-02', allDay: false, startMin: 900, endMin: 960, place: '' });
  assert.deepEqual(pick(p('Dentist 3pm fri'), ...k), { title: 'Dentist', date: '2026-10-02', allDay: false, startMin: 900, endMin: 960, place: '' });
  assert.deepEqual(pick(p('Soccer sat 10am-12pm at the park'), ...k), { title: 'Soccer', date: '2026-10-03', allDay: false, startMin: 600, endMin: 720, place: 'the park' });
  assert.deepEqual(pick(p('Study group tomorrow 4-5:30 at the library'), ...k), { title: 'Study group', date: '2026-09-29', allDay: false, startMin: 960, endMin: 1050, place: 'the library' });
  assert.deepEqual(pick(p('Meet Sam at 4'), ...k), { title: 'Meet Sam', date: null, allDay: false, startMin: 960, endMin: 1020, place: '' });
  assert.deepEqual(pick(p('Meet at noon at the library'), ...k), { title: 'Meet', date: null, allDay: false, startMin: 720, endMin: 780, place: 'the library' });
  assert.deepEqual(pick(p('Party at Sam’s fri'), ...k), { title: 'Party', date: '2026-10-02', allDay: true, startMin: null, endMin: null, place: 'Sam’s' });
  assert.equal(p('Lunch 12:30 45m').endMin, 795);
  assert.deepEqual([p('Band 3-4pm').startMin, p('Band 3-4pm').endMin], [900, 960]);
  assert.deepEqual([p('Tutoring 11-1pm').startMin, p('Tutoring 11-1pm').endMin], [660, 780]);
  assert.equal(p('Match 15:30').startMin, 930);
  assert.equal(p('Club 9').allDay, true, 'a bare number is not a time');
  assert.equal(p('Dentist 3pm sat').date, '2026-10-03', 'a bare sat or sun counts when a time is typed');
  assert.equal(p('Watch the sun').date, null, 'but not on its own');
});

test('typed events keep numbers that are part of the title', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const p = t => run(c, `(() => { const r = nyParseEvent(${JSON.stringify(t)}); return { title: r.title, allDay: r.allDay, startMin: r.startMin, place: r.place, date: r.date && hwTodayStr(r.date) }; })()`);
  assert.deepEqual(p('Math 10 test fri'), { title: 'Math 10 test', allDay: true, startMin: null, place: '', date: '2026-10-02' });
  assert.deepEqual(p('Read ch 4-5'), { title: 'Read ch 4-5', allDay: true, startMin: null, place: '', date: null });
  assert.deepEqual(p('Room 204 meeting 3pm'), { title: 'Room 204 meeting', allDay: false, startMin: 900, place: '', date: null });
  assert.deepEqual(p('Look at the sun'), { title: 'Look at the sun', allDay: true, startMin: null, place: '', date: null });
  assert.equal(p('Friday').title, 'Friday');
  // A lone a or p is part of the title unless "at" or a colon says it's a time
  assert.deepEqual(p('Problem set 2a fri'), { title: 'Problem set 2a', allDay: true, startMin: null, place: '', date: '2026-10-02' });
  assert.deepEqual(p('Homework 1a'), { title: 'Homework 1a', allDay: true, startMin: null, place: '', date: null });
  assert.equal(p('Dentist at 3p').startMin, 900);
  assert.equal(p('Dentist 3:30p').startMin, 930);
  // A length with no time is part of the title
  assert.deepEqual(p('Swim 200m fri'), { title: 'Swim 200m', allDay: true, startMin: null, place: '', date: '2026-10-02' });
  assert.deepEqual(p('Run 100m'), { title: 'Run 100m', allDay: true, startMin: null, place: '', date: null });
});

test('quick add also finds the subject and longer lengths', () => {
  const c = sandbox('2026-09-28T16:00:00');                        // a Monday
  const p = t => run(c, `(() => { const r = nyParseQuick(${JSON.stringify(t)}); return { title: r.title, minutes: r.minutes, date: r.date && hwTodayStr(r.date), subject: r.subject }; })()`);
  assert.deepEqual(p('math ws 3.2 fri 30m'), { title: 'Math ws 3.2', minutes: 30, date: '2026-10-02', subject: 'math' });
  assert.deepEqual(p('Essay 1h 30m tomorrow'), { title: 'Essay', minutes: 90, date: '2026-09-29', subject: 'english' });
  assert.deepEqual(p('bio lab report due oct 12'), { title: 'Bio lab report', minutes: null, date: '2026-10-12', subject: 'science' });
  assert.deepEqual(p('Read ch 4 for 45 min'), { title: 'Read ch 4', minutes: 45, date: null, subject: null });
  assert.deepEqual(p('Spanish vocab 20 minutes'), { title: 'Spanish vocab', minutes: 20, date: null, subject: 'languages' });
  assert.deepEqual(p('chem quiz review 1.5h'), { title: 'Chem quiz review', minutes: 90, date: null, subject: 'science' });
  assert.deepEqual(p('calc problems'), { title: 'Calc problems', minutes: null, date: null, subject: 'math' });
  assert.deepEqual(p('Poster'), { title: 'Poster', minutes: null, date: null, subject: null });
  // A length at the start or in the middle comes out of the title too
  assert.deepEqual(p('30m science test'), { title: 'Science test', minutes: 30, date: null, subject: 'science' });
  assert.deepEqual(p('1h essay fri'), { title: 'Essay', minutes: 60, date: '2026-10-02', subject: 'english' });
  assert.deepEqual(p('science 30m test'), { title: 'Science test', minutes: 30, date: null, subject: 'science' });
  assert.equal(p('Read ch 5').title, 'Read ch 5', 'numbers without a unit stay');
  // A subject of your own is found by its name
  run(c, `NY_CFG.subjects.push({ id: 'robo', name: 'Robotics', color: 'sage', words: '' })`);
  assert.equal(p('robotics build fri').subject, 'robo');
});

test('typed lengths: minutes, hours, both, and nothing silly', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const L = s => run(c, `nyParseLength(${JSON.stringify(s)})`);
  assert.equal(L('45'), 45);
  assert.equal(L('45m'), 45);
  assert.equal(L('45 min'), 45);
  assert.equal(L('1h'), 60);
  assert.equal(L('1h 20m'), 80);
  assert.equal(L('1h20'), 80);
  assert.equal(L('1.5h'), 90);
  assert.equal(L('1:30'), 90);
  assert.equal(L('2 hours'), 120);
  assert.equal(L(''), null);
  assert.equal(L('soon'), null);
  assert.equal(L('0'), null, 'no zero-minute tasks');
  assert.equal(L('600'), null, 'eight hours at most');
});

test('typed times on their own', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const t = s => run(c, `nyParseTime(${JSON.stringify(s)})`);
  assert.equal(t('3'), 900);
  assert.equal(t('9'), 540);
  assert.equal(t('12'), 720);
  assert.equal(t('3:45pm'), 945);
  assert.equal(t('12am'), 0);
  assert.equal(t('15:30'), 930);
  assert.equal(t('09:15'), 555);
  assert.equal(t('noon'), 720);
  assert.equal(t('25'), null);
  assert.equal(t('4:75'), null);
});

test('a typed event becomes a draft and reads back nicely', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const d = run(c, `calDraftFromText(nyParseEvent('Dentist fri 3pm'), new Date())`);
  assert.equal(d.start, new Date(2026, 9, 2, 15).getTime());
  assert.equal(d.end, new Date(2026, 9, 2, 16).getTime());
  const all = run(c, `calDraftFromText(nyParseEvent('Trip'), nyParseDs('2026-10-01'))`);
  assert.deepEqual([all.allDay, all.start, all.end], [true, '2026-10-01', '2026-10-02']);
  assert.match(run(c, `calWhenLabel(${JSON.stringify(d)})`), /^Fri, Oct 2 · 3:00\s?PM – 4:00\s?PM$/);
  assert.match(run(c, `calWhenLabel({ allDay: true, start: '2026-10-01', end: '2026-10-03' })`), /^Thu, Oct 1 – Fri, Oct 2 · All day$/);
});

// ── Google ──────────────────────────────────────────────────────────────────

const gres = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const G_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const G_LIST = { items: [
  { id: 'sam@example.com', summary: 'sam@example.com', accessRole: 'owner', primary: true, selected: true, backgroundColor: '#039be5' },
  { id: 'school@group.calendar.google.com', summary: 'School', accessRole: 'reader', selected: true, backgroundColor: '#0b8043' },
  { id: 'en.canadian#holiday@group.v.calendar.google.com', summary: 'Holidays in Canada', accessRole: 'reader', backgroundColor: '#d50000' },
  { id: 'team@group.calendar.google.com', summary: 'Team', summaryOverride: 'Soccer team', accessRole: 'writer', selected: true, backgroundColor: '#f6bf26' },
] };

// A pretend Google sign-in window that answers with a pass for the state it was given.
function googleAuth(c, { scope = G_SCOPES, error = null, token = 'tok-1' } = {}) {
  c.__authCalls = [];
  c.__auth = async ({ url, interactive }) => {
    c.__authCalls.push({ url, interactive });
    const state = new URL(url).searchParams.get('state');
    if (error) return `https://ext.chromiumapp.org/#error=${error}&state=${state}`;
    return `https://ext.chromiumapp.org/#access_token=${token}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(scope)}&state=${state}`;
  };
}
// Every fetch answered by `handler(call)`; calls recorded in c.__calls.
function googleApi(c, handler) {
  c.__calls = [];
  c.__route = async (url, opts) => {
    const call = { url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).Authorization };
    c.__calls.push(call);
    return handler(call);
  };
}
const signedIn = { gcalAccounts: [{ email: 'sam@example.com', connectedAt: 1, needsSignIn: false, tasks: true }] };
// Passes for the session, good for an hour: { email: token }
const passes = (c, map, ms = 3600e3) => { c.__session.gcalTokens = { ...(c.__session.gcalTokens || {}),
  ...Object.fromEntries(Object.entries(map).map(([e, token]) => [e, { token, expires: run(c, 'Date.now()') + ms }])) }; };

test('Google sign-in: the window, the pass and the calendars', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  googleAuth(c);
  googleApi(c, ({ url }) => url.includes('/users/me/calendarList') ? gres(200, G_LIST) : gres(404));
  const r = await run(c, `gcalSignIn()`);
  assert.equal(r.ok, true);
  assert.equal(r.email, 'sam@example.com');
  const u = new URL(c.__authCalls[0].url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'test-client');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://ext.chromiumapp.org/');
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('scope'), G_SCOPES + ' https://www.googleapis.com/auth/tasks', 'calendars and Google Tasks in one window');
  assert.equal(u.searchParams.get('prompt'), 'select_account');
  assert.equal(c.__authCalls[0].interactive, true);
  assert.equal(c.__session.gcalTokens['sam@example.com'].token, 'tok-1');
  assert.equal(c.__calls[0].auth, 'Bearer tok-1');
  assert.deepEqual(c.__data.gcalAccounts, [{ email: 'sam@example.com', connectedAt: c.__data.gcalAccounts[0].connectedAt, needsSignIn: false, tasks: false }]);
  assert.ok(c.__data.gcalCalendars.every(x => x.account === 'sam@example.com'));
  assert.deepEqual(c.__data.gcalCalendars.map(x => [x.name, x.on, x.writable, x.color]), [
    ['sam@example.com', true, true, 'sky'], ['Soccer team', true, true, 'butter'],
    ['Holidays in Canada', false, false, 'peach'], ['School', true, false, 'mint']]);
  assert.equal(c.__data.gcalDefault, 'sam@example.com');
});

test('Google sign-in: closed, refused or half-approved connects nothing', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  googleApi(c, () => gres(200, G_LIST));
  assert.deepEqual(await run(c, `gcalSignIn()`), { error: 'closed' });
  googleAuth(c, { error: 'access_denied' });
  assert.deepEqual(await run(c, `gcalSignIn()`), { error: 'access_denied' });
  googleAuth(c, { scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly' });
  assert.deepEqual(await run(c, `gcalSignIn()`), { error: 'scopes' }, 'one box unticked');
  assert.equal(c.__data.gcalAccounts, undefined);
  assert.equal(c.__session.gcalTokens, undefined);
  assert.match(run(c, `GCAL_MESSAGES.scopes`), /leave both boxes ticked/);
  assert.equal(run(c, `gcalReadRedirect('https://ext.chromiumapp.org/#access_token=x&expires_in=3599&scope=${encodeURIComponent(G_SCOPES)}&state=evil', 'mine').error`), 'failed', 'someone else’s answer');
  const off = sandbox('2026-09-28T12:00:00');
  assert.deepEqual(await run(off, `gcalSignIn()`), { error: 'unavailable' }, 'no client ID, no sign-in');
});

// Two accounts: home (sam@example.com) and school (sam@school.edu). "Class" is in
// both; the school account can edit it, so it shows through school.
const TWO = { gcalAccounts: [
  { email: 'sam@example.com', connectedAt: 1, needsSignIn: false, tasks: true },
  { email: 'sam@school.edu', connectedAt: 2, needsSignIn: false, tasks: true }], gcalCalendars: [
  { id: 'sam@example.com', account: 'sam@example.com', name: 'sam@example.com', access: 'owner', writable: true, primary: true, color: 'sky', on: true },
  { id: 'class', account: 'sam@example.com', name: 'Class', access: 'reader', writable: false, primary: false, color: 'mint', on: true },
  { id: 'sam@school.edu', account: 'sam@school.edu', name: 'sam@school.edu', access: 'owner', writable: true, primary: true, color: 'lilac', on: true },
  { id: 'class', account: 'sam@school.edu', name: 'Class', access: 'writer', writable: true, primary: false, color: 'mint', on: true }] };
const PASSES = { 'sam@example.com': 'tok-home', 'sam@school.edu': 'tok-school' };

test('two Google accounts: each call goes with its own account’s pass', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: TWO });
  passes(c, PASSES);
  googleApi(c, () => gres(200, { items: [] }));
  await run(c, `gcalApi('users/me/calendarList', { account: 'sam@school.edu' })`);
  await run(c, `gcalApi('users/me/calendarList', { account: 'sam@example.com' })`);
  assert.deepEqual(c.__calls.map(x => x.auth), ['Bearer tok-school', 'Bearer tok-home']);
  await run(c, `calEnsureMonths(['2026-09'])`);
  const by = id => c.__calls.filter(x => x.url.includes(`/calendars/${encodeURIComponent(id)}/events`)).map(x => x.auth);
  assert.deepEqual(by('sam@example.com'), ['Bearer tok-home']);
  assert.deepEqual(by('sam@school.edu'), ['Bearer tok-school']);
  assert.deepEqual(by('class'), ['Bearer tok-school'], 'a shared calendar is fetched once, through the account that can edit it');
});

test('two Google accounts renew separately, each with its own email', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: TWO });
  passes(c, PASSES, -1);                                                  // both ran out overnight
  c.__authCalls = [];
  c.__auth = async ({ url, interactive }) => {
    const q = new URL(url).searchParams, who = q.get('login_hint');
    c.__authCalls.push({ who, interactive });
    if (who === 'sam@school.edu' && c.__schoolOut) throw new Error('interaction required');
    return `https://ext.chromiumapp.org/#access_token=new-${who}&expires_in=3599&scope=${encodeURIComponent(G_SCOPES)}&state=${q.get('state')}`;
  };
  googleApi(c, () => gres(200, { items: [] }));
  await Promise.all([run(c, `gcalApi('users/me/calendarList', { account: 'sam@example.com' })`),
    run(c, `gcalApi('users/me/calendarList', { account: 'sam@school.edu' })`),
    run(c, `gcalApi('users/me/calendarList', { account: 'sam@school.edu' })`)]);
  assert.deepEqual(c.__authCalls.map(x => x.who).sort(), ['sam@example.com', 'sam@school.edu'], 'one quiet renewal each');
  assert.ok(c.__authCalls.every(x => x.interactive === false));
  assert.deepEqual(c.__calls.map(x => x.auth).sort(), ['Bearer new-sam@example.com', 'Bearer new-sam@school.edu', 'Bearer new-sam@school.edu']);
  passes(c, PASSES, -1);
  c.__schoolOut = true;
  await assert.rejects(run(c, `gcalApi('users/me/calendarList', { account: 'sam@school.edu' })`), e => e.kind === 'signin' && e.account === 'sam@school.edu');
  assert.deepEqual(c.__data.gcalAccounts.map(a => a.needsSignIn), [false, true], 'only the school account asks');
  await run(c, `gcalApi('users/me/calendarList', { account: 'sam@example.com' })`);
  assert.equal(c.__calls.at(-1).auth, 'Bearer new-sam@example.com', 'home carries on');
});

test('a calendar in two accounts shows once, through the account that can do the most', () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  const shown = raw => run(c, `gcalShown(${JSON.stringify(raw)}).map(x => x.id + '@' + x.account)`);
  assert.deepEqual(shown(TWO), ['sam@example.com@sam@example.com', 'sam@school.edu@sam@school.edu', 'class@sam@school.edu']);
  const out = { ...TWO, gcalAccounts: [TWO.gcalAccounts[0], { ...TWO.gcalAccounts[1], needsSignIn: true }] };
  assert.ok(shown(out).includes('class@sam@example.com'), 'school needs to sign in, so home’s copy shows');
  const tie = { ...TWO, gcalCalendars: TWO.gcalCalendars.map(x => x.id === 'class' ? { ...x, access: 'reader', writable: false } : x) };
  assert.ok(shown(tie).includes('class@sam@example.com'), 'the same access: the account added first');
  const gone = { ...TWO, gcalAccounts: [TWO.gcalAccounts[0]] };
  assert.ok(shown(gone).includes('class@sam@example.com') && !shown(gone).some(x => x.endsWith('@sam@school.edu')), 'an account that isn’t here shows nothing');
  assert.deepEqual(shown({ gcalAccounts: [], gcalCalendars: TWO.gcalCalendars }), []);
});

test('a shared calendar’s switch and colour are the calendar’s: every copy changes', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: TWO });
  await run(c, `gcalSetCalendar('class', { on: false, color: 'pink' })`);
  assert.deepEqual(c.__data.gcalCalendars.filter(x => x.id === 'class').map(x => [x.account, x.on, x.color]),
    [['sam@example.com', false, 'pink'], ['sam@school.edu', false, 'pink']]);
  assert.equal(await run(c, `gcalAccountFor('class')`), 'sam@school.edu');
});

test('writing to a calendar goes through the account that shows it, with its plain ID', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: TWO });
  passes(c, PASSES);
  googleApi(c, ({ method }) => method === 'POST' ? gres(200, { id: 'n1' }) : method === 'DELETE' ? gres(204) : gres(200, { items: [] }));
  const s = new Date(2026, 9, 2, 15).getTime();
  await run(c, `calCreate({ title: 'Study group', allDay: false, start: ${s}, end: ${s + 3600e3}, place: '', notes: '', repeat: null }, 'class')`);
  const post = c.__calls.find(x => x.method === 'POST');
  assert.ok(post.url.endsWith('/calendars/class/events'));
  assert.equal(post.auth, 'Bearer tok-school');
  const ev = { id: 'n1', source: 'google', calendarId: 'sam@example.com', editable: true, recurring: false, seriesId: 'n1',
    title: 'Study group', allDay: false, start: s, end: s + 3600e3, place: '', notes: '' };
  await run(c, `calDelete(${JSON.stringify(ev)})`);
  assert.equal(c.__calls.find(x => x.method === 'DELETE').auth, 'Bearer tok-home');
});

test('signing in again keeps choices; another account is added beside it', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  googleAuth(c);
  googleApi(c, () => gres(200, G_LIST));
  assert.equal((await run(c, `gcalSignIn()`)).added, true);
  await run(c, `gcalSetCalendar('school@group.calendar.google.com', { on: false, color: 'pink' })`);
  c.__data.gcalCache = { 'sam@example.com': { '2026-09': { at: 1, items: [] } } };
  const again = await run(c, `gcalSignIn()`);
  assert.deepEqual([again.ok, again.added], [true, false]);
  assert.equal(c.__data.gcalAccounts.length, 1, 'never twice');
  const school = c.__data.gcalCalendars.find(x => x.name === 'School');
  assert.deepEqual([school.on, school.color], [false, 'pink']);
  googleAuth(c, { token: 'tok-kim' });
  googleApi(c, () => gres(200, { items: [{ ...G_LIST.items[0], id: 'kim@example.com', summary: 'kim@example.com' },
    { id: 'school@group.calendar.google.com', summary: 'School', accessRole: 'reader', selected: true, backgroundColor: '#0b8043' }] }));
  const kim = await run(c, `gcalSignIn()`);
  assert.deepEqual([kim.email, kim.added], ['kim@example.com', true]);
  assert.deepEqual(c.__data.gcalAccounts.map(a => a.email), ['sam@example.com', 'kim@example.com']);
  assert.ok(c.__data.gcalCache['sam@example.com'], 'the first account keeps its months');
  assert.equal(c.__data.gcalDefault, 'sam@example.com', 'new events still go where they went');
  assert.equal(c.__session.gcalTokens['kim@example.com'].token, 'tok-kim');
  const kimSchool = c.__data.gcalCalendars.find(x => x.account === 'kim@example.com' && x.name === 'School');
  assert.deepEqual([kimSchool.on, kimSchool.color], [false, 'pink'], 'a calendar already here keeps its choices in the new account');
});

test('signing in again with a different account adds that one; the first still asks', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { gcalAccounts: [{ ...TWO.gcalAccounts[1], needsSignIn: true }], gcalCalendars: [TWO.gcalCalendars[2]] } });
  googleAuth(c);
  googleApi(c, () => gres(200, G_LIST));                                  // they picked sam@example.com instead
  const r = await run(c, `gcalSignIn({ email: 'sam@school.edu' })`);
  assert.equal(new URL(c.__authCalls[0].url).searchParams.get('login_hint'), 'sam@school.edu');
  assert.deepEqual([r.email, r.added], ['sam@example.com', true]);
  assert.deepEqual(c.__data.gcalAccounts.map(a => [a.email, a.needsSignIn]), [['sam@school.edu', true], ['sam@example.com', false]]);
});

test('"Open in Google Calendar" opens in the event’s account', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, gcalCache: { 'sam@school.edu': { '2026-09': { at: 1, items: [
    { id: 'e1', seriesId: 'e1', recurring: false, title: 'Club', allDay: false, start: new Date(2026, 8, 29, 15).getTime(),
      end: new Date(2026, 8, 29, 16).getTime(), place: '', notes: '', link: 'https://www.google.com/calendar/event?eid=abc' }] } } } } });
  const [ev] = await run(c, `calLoadRaw().then(r => calCollect(r, '2026-09-29', '2026-09-29'))`);
  assert.equal(ev.link, 'https://www.google.com/calendar/event?eid=abc&authuser=sam%40school.edu');
  assert.equal(run(c, `gcalLinkFor('not a link', 'a@b.c')`), 'not a link');
});

test('the one old Google account moves over once', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: {
    gcalAccount: { email: 'sam@example.com', connectedAt: 5, needsSignIn: false },
    gcalCalendars: [{ id: 'sam@example.com', name: 'sam@example.com', access: 'owner', writable: true, primary: true, color: 'sky', on: true }],
    gcalDefault: 'sam@example.com', gcalCache: { 'sam@example.com': { '2026-09': { at: 1, items: [] } } },
    connections: { gtasks: { on: true, lists: {} } },
    connCache: { gtasks: { at: 1, items: [{ rid: 'L1~t1', title: 'Read', due: '2026-09-30', minutes: null, hint: 'School' }] } } } });
  c.__session.gcalToken = { token: 'old', expires: 1 };
  assert.equal(await run(c, `gcalMigrate()`), true);
  assert.deepEqual(c.__data.gcalAccounts, [{ email: 'sam@example.com', connectedAt: 5, needsSignIn: false, tasks: true }]);
  assert.equal(c.__data.gcalCalendars[0].account, 'sam@example.com');
  assert.deepEqual(c.__data.connCache.gtasks.items.map(i => [i.rid, i.account]), [['L1~t1', 'sam@example.com']], 'task IDs don’t change');
  assert.equal(c.__data.gcalAccount, undefined);
  assert.equal(c.__session.gcalToken, undefined);
  assert.equal(c.__data.gcalDefault, 'sam@example.com');
  const before = JSON.stringify(c.__data);
  assert.equal(await run(c, `gcalMigrate()`), false);
  assert.equal(JSON.stringify(c.__data), before, 'again, nothing changes');
  const restored = sandbox('2026-09-28T12:00:00', { google: true, store: { gcalAccount: { email: 'kim@example.com', connectedAt: 9, needsSignIn: false } } });
  assert.equal(await run(restored, `gcalMigrate()`), true, 'a backup from before (no calendars, no tasks, no pass)');
  assert.deepEqual(restored.__data.gcalAccounts.map(a => [a.email, a.tasks]), [['kim@example.com', false]]);
});

test('the pass renews quietly, then asks to sign in again only once', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: signedIn });
  passes(c, { 'sam@example.com': 'old' }, 60e3);    // a minute left
  googleAuth(c, { token: 'fresh' });
  googleApi(c, () => gres(200, G_LIST));
  await run(c, `gcalListCalendars('sam@example.com')`);
  const u = new URL(c.__authCalls[0].url);
  assert.equal(c.__authCalls[0].interactive, false);
  assert.equal(u.searchParams.get('prompt'), 'none');
  assert.equal(u.searchParams.get('login_hint'), 'sam@example.com');
  assert.equal(c.__calls[0].auth, 'Bearer fresh');
  c.__auth = async () => { throw new Error('interaction required'); };
  googleApi(c, () => gres(401));
  await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === 'signin');
  assert.equal(c.__data.gcalAccounts[0].needsSignIn, true);
  const calls = c.__calls.length;
  await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === 'signin');
  assert.equal(c.__calls.length, calls, 'no more calls to Google until they sign in again');
});

test('renewing while offline keeps the account; only Google saying so asks to sign in again', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: signedIn });
  passes(c, { 'sam@example.com': 'old' }, -1);           // run out overnight
  c.__auth = async () => { throw new Error('Authorization page could not be loaded.'); };  // no wifi yet
  googleApi(c, () => gres(200, G_LIST));
  await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === 'offline');
  assert.equal(c.__data.gcalAccounts[0].needsSignIn, false, 'still signed in');
  googleAuth(c, { error: 'login_required' });                                              // signed out of Google
  await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === 'signin');
  assert.equal(c.__data.gcalAccounts[0].needsSignIn, true);
});

test('Google errors become words people can act on', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: signedIn });
  passes(c, { 'sam@example.com': 't' }, 3600e3);
  const cases = [[429, {}, 'limit'], [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'limit'],
    [403, {}, 'denied'], [404, {}, 'gone'], [410, {}, 'gone'], [500, {}, 'failed']];
  for (const [status, body, kind] of cases) {
    googleApi(c, () => gres(status, body));
    await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === kind && !/\d{3}/.test(e.message), `${status} → ${kind}`);
  }
  c.__route = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(run(c, `gcalListCalendars('sam@example.com')`), e => e.kind === 'offline');
});

test('removing one Google account keeps the other', async () => {
  const today = '2026-09-28', ahead = '2026-10-01';
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, gcalDefault: 'sam@school.edu',
    gcalCache: { 'sam@example.com': { '2026-09': { at: 5, items: [] } }, 'sam@school.edu': { '2026-09': { at: 5, items: [] } }, class: { '2026-09': { at: 5, items: [] } } },
    connections: { gtasks: { on: true, accounts: { 'sam@example.com': { error: '' }, 'sam@school.edu': { error: '' } } } },
    connCache: { gtasks: { at: 1, items: [
      { rid: 'L1~t1', title: 'Read', due: ahead, account: 'sam@example.com' },
      { rid: 'H1~h1', title: 'Lab', due: ahead, account: 'sam@school.edu' },
      { rid: 'H1~h2', title: 'Quiz', due: ahead, account: 'sam@school.edu' },
      { rid: 'H1~h3', title: 'Today', due: today, account: 'sam@school.edu' }] } },
    hwTasksByDay: {
      [today]: [{ id: 'x-gtasks-H1~h3', title: 'Today', done: false }],
      [ahead]: [{ id: 'x-gtasks-L1~t1', title: 'Read', done: false }, { id: 'x-gtasks-H1~h1', title: 'Lab', done: false },
        { id: 'x-gtasks-H1~h2', title: 'Quiz', done: true }] } } });
  passes(c, PASSES);
  googleApi(c, () => gres(200));
  await run(c, `gcalRemoveAccount('sam@school.edu')`);
  assert.ok(c.__calls.some(x => x.url === 'https://oauth2.googleapis.com/revoke?token=tok-school'));
  assert.deepEqual(Object.keys(c.__session.gcalTokens), ['sam@example.com']);
  assert.deepEqual(c.__data.gcalAccounts.map(a => a.email), ['sam@example.com']);
  assert.ok(c.__data.gcalCalendars.every(x => x.account === 'sam@example.com'));
  assert.deepEqual(Object.keys(c.__data.gcalCache).sort(), ['class', 'sam@example.com'], 'its own calendar’s months go; a shared one’s stay');
  assert.equal(c.__data.gcalCache.class['2026-09'].at, 0, 'the shared calendar is fetched again, through home');
  assert.equal(c.__data.gcalDefault, 'sam@example.com', 'new events go to the next account’s main calendar');
  assert.deepEqual(c.__data.hwTasksByDay[ahead].map(t => t.id), ['x-gtasks-L1~t1', 'x-gtasks-H1~h2'], 'its untouched tasks ahead go; done ones stay');
  assert.deepEqual(c.__data.hwTasksByDay[today].map(t => t.id), ['x-gtasks-H1~h3'], 'today’s stay');
  assert.deepEqual(c.__data.connCache.gtasks.items.map(i => i.rid), ['L1~t1']);
  assert.equal(c.__data.connections.gtasks.on, true);
  assert.deepEqual(Object.keys(c.__data.connections.gtasks.accounts), ['sam@example.com']);
});

test('ticking a task left from a removed Google account stays here and doesn’t ask Google', async () => {
  const today = '2026-09-28';
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, connections: { gtasks: { on: true } },
    connCache: { gtasks: { at: 1, items: [{ rid: 'H1~h3', title: 'Today', due: today, account: 'sam@school.edu' }] } },
    hwTasksByDay: { [today]: [{ id: 'x-gtasks-H1~h3', title: 'Today', done: false }] } } });
  passes(c, PASSES);
  googleApi(c, () => gres(200));
  await run(c, `gcalRemoveAccount('sam@school.edu')`);
  assert.equal(c.__data.hwTasksByDay[today].length, 1, 'today’s task stays');
  c.__calls.length = 0;
  assert.equal(await run(c, `connTickBack('${today}', 'x-gtasks-H1~h3', true)`), 'ok');
  assert.equal(c.__calls.filter(x => x.method === 'PATCH').length, 0, 'not sent to the other account');
  assert.ok(!('pendingDone' in c.__data.hwTasksByDay[today][0]), 'nothing left to retry');
});

test('removing the last Google account is signing out: Google goes, everything else stays', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...signedIn, gcalCalendars: [{ id: 'a', account: 'sam@example.com' }],
    gcalCache: { a: {} }, gcalDefault: 'a', calFeeds: [], localEvents: [{ id: 'l-1' }], connections: { gtasks: { on: true }, todoist: { on: true, token: 't' } } } });
  passes(c, { 'sam@example.com': 'tok' });
  googleApi(c, () => gres(200));
  await run(c, `gcalRemoveAccount('sam@example.com')`);
  assert.ok(c.__calls.some(x => x.url === 'https://oauth2.googleapis.com/revoke?token=tok' && x.method === 'POST'));
  for (const k of ['gcalAccounts', 'gcalCalendars', 'gcalCache', 'gcalDefault']) assert.equal(c.__data[k], undefined, k);
  assert.deepEqual(c.__session.gcalTokens, {});
  assert.equal(c.__data.connections.gtasks, undefined);
  assert.equal(c.__data.connections.todoist.on, true);
  assert.equal(c.__data.localEvents.length, 1);
  const two = sandbox('2026-09-28T12:00:00', { google: true, store: TWO });
  passes(two, PASSES);
  googleApi(two, () => gres(200));
  await run(two, `gcalSignOut()`);
  assert.equal(two.__data.gcalAccounts, undefined, 'signing out removes every account');
  assert.equal(two.__calls.filter(x => x.url.includes('/revoke')).length, 2);
});

const at = (m, d, h, mi = 0) => new Date(2026, m - 1, d, h, mi).toISOString();
const G_MONTH = { items: [
  { id: 'e1', summary: 'Dentist', location: 'Main St', start: { dateTime: at(9, 29, 15, 30) }, end: { dateTime: at(9, 29, 16) }, htmlLink: 'https://calendar.google.com/e1' },
  { id: 'e2', summary: 'Trip', start: { date: '2026-09-30' }, end: { date: '2026-10-02' } },
  { id: 'p1_20260929', recurringEventId: 'p1', summary: 'Practice', description: 'Bring <b>cleats</b><br>and water', start: { dateTime: at(9, 29, 10) }, end: { dateTime: at(9, 29, 11, 30) } },
  { id: 'gone', status: 'cancelled' },
] };
function googleSandbox(iso, store = {}) {
  const c = sandbox(iso, { google: true, store: { ...signedIn, gcalCalendars: [
    { id: 'sam@example.com', account: 'sam@example.com', name: 'sam@example.com', access: 'owner', writable: true, primary: true, color: 'sky', on: true },
    { id: 'hol', account: 'sam@example.com', name: 'Holidays', access: 'reader', writable: false, primary: false, color: 'peach', on: true },
    { id: 'busy', account: 'sam@example.com', name: 'Kim', access: 'freeBusyReader', writable: false, primary: false, color: 'stone', on: false },
  ], ...store } });
  passes(c, { 'sam@example.com': 'tok' }, 3600e3);
  return c;
}
const onlySam = body => ({ url }) => gres(200, url.includes('sam%40') ? body : { items: [] });

test('Google events in the app’s shape', () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const n = (i, cal = `{ access: 'owner' }`) => run(c, `gcalNormalize(${JSON.stringify(G_MONTH.items[i])}, ${cal})`);
  const dentist = n(0);
  assert.deepEqual([dentist.title, dentist.allDay, dentist.place, dentist.recurring, dentist.link],
    ['Dentist', false, 'Main St', false, 'https://calendar.google.com/e1']);
  assert.equal(dentist.start, new Date(2026, 8, 29, 15, 30).getTime());
  assert.deepEqual([n(1).allDay, n(1).start, n(1).end], [true, '2026-09-30', '2026-10-02']);
  assert.deepEqual([n(2).seriesId, n(2).recurring, n(2).notes], ['p1', true, 'Bring cleats\nand water']);
  assert.equal(n(3), null, 'cancelled');
  assert.deepEqual([n(0, `{ access: 'freeBusyReader' }`).title, n(0, `{ access: 'freeBusyReader' }`).place], ['Busy', '']);
});

test('Google repeats map to the app’s choices, or to custom', () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const r = rules => run(c, `gcalRepeatOf(${JSON.stringify(rules)}, new Date(2026, 8, 28))`);      // a Monday the 28th
  assert.equal(r(undefined), null);
  assert.equal(r(['RRULE:FREQ=DAILY']), 'daily');
  assert.equal(r(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']), 'weekdays');
  assert.equal(r(['RRULE:FREQ=WEEKLY;BYDAY=MO']), 'weekly');
  assert.equal(r(['RRULE:FREQ=WEEKLY', 'EXDATE;TZID=America/Denver:20261005T160000']), 'weekly');
  assert.equal(r(['RRULE:FREQ=MONTHLY;BYMONTHDAY=28']), 'monthly');
  assert.equal(r(['RRULE:FREQ=YEARLY']), 'yearly');
  assert.equal(r(['RRULE:FREQ=WEEKLY;INTERVAL=2']), 'custom');
  assert.equal(r(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']), 'custom');
  assert.equal(r(['RRULE:FREQ=DAILY;COUNT=5']), 'custom');
  assert.equal(r(['RRULE:FREQ=MONTHLY;BYDAY=2TU']), 'custom');
});

test('Google months: fetched once, all their pages, kept fresh', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, ({ url }) => {
    if (!url.includes('/calendars/sam%40example.com/events')) return gres(200, { items: [] });
    return new URL(url).searchParams.get('pageToken') ? gres(200, { items: [G_MONTH.items[2]] })
      : gres(200, { items: G_MONTH.items.slice(0, 2), nextPageToken: 'p2' });
  });
  await run(c, `calEnsureMonths(['2026-09'])`);
  const sam = c.__calls.filter(x => x.url.includes('sam%40example.com'));
  assert.equal(sam.length, 2, 'two pages');
  const q = new URL(sam[0].url).searchParams;
  assert.equal(q.get('singleEvents'), 'true');
  assert.equal(q.get('timeMin'), new Date(2026, 8, 1).toISOString());
  assert.equal(q.get('timeMax'), new Date(2026, 9, 1).toISOString());
  assert.equal(c.__calls.some(x => x.url.includes('/calendars/busy/')), false, 'switched-off calendars aren’t fetched');
  assert.deepEqual(c.__data.gcalCache['sam@example.com']['2026-09'].items.map(e => e.id), ['e1', 'e2', 'p1_20260929']);
  const n = c.__calls.length;
  await run(c, `calEnsureMonths(['2026-09'])`);
  assert.equal(c.__calls.length, n, 'fresh months aren’t fetched again');
  await run(c, `calEnsureMonths(['2026-09'], { maxAge: 0 })`);
  assert.ok(c.__calls.length > n);
  const shown = await run(c, `calLoadRaw().then(r => calCollect(r, '2026-09-29', '2026-09-29').map(e => e.title + ':' + e.calendarName + ':' + e.editable))`);
  assert.deepEqual(shown, ['Practice:sam@example.com:true', 'Dentist:sam@example.com:true']);
});

test('a planner left open past its sign-in shows what it has and stops asking Google', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, onlySam(G_MONTH));
  await run(c, `calEnsureMonths(['2026-09'])`);
  delete c.__session.gcalTokens;
  c.__auth = async () => { throw new Error('interaction required'); };
  googleApi(c, onlySam(G_MONTH));
  await assert.rejects(run(c, `calEnsureMonths(['2026-10'])`), e => e.kind === 'signin');
  assert.equal(c.__data.gcalAccounts[0].needsSignIn, true);
  assert.equal(c.__calls.length, 0, 'no pass, no call');
  await run(c, `calEnsureMonths(['2026-11'])`);
  assert.equal(c.__calls.length, 0, 'quiet from then on');
  assert.equal(await run(c, `calLoadRaw().then(r => calCollect(r, '2026-09-29', '2026-09-29').length)`), 2, 'cached events still show');
});

test('two pages fetching months at once keep each other’s months', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, ({ url }) => {
    const mine = (c.__data.gcalCache || {})['sam@example.com'] || {};      // while this page waits, another saves October
    c.__data.gcalCache = { ...(c.__data.gcalCache || {}), 'sam@example.com': { ...mine, '2026-10': { at: Date.now(), items: [] } } };
    return gres(200, url.includes('sam%40') ? G_MONTH : { items: [] });
  });
  await run(c, `calEnsureMonths(['2026-09'])`);
  assert.ok(c.__data.gcalCache['sam@example.com']['2026-09'], 'this page’s month');
  assert.ok(c.__data.gcalCache['sam@example.com']['2026-10'], 'the other page’s month');
});

test('the Google cache keeps the months around today and the 24 looked at last', () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const months = {};
  for (let i = -6; i < 40; i++) {
    const d = new Date(2026, 8 + i, 1);
    months[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = { at: 1000 + i, items: [] };
  }
  const kept = Object.keys(run(c, `calPruneCache({ cal: ${JSON.stringify(months)} }, new Date(2026, 8, 28).getTime())`).cal).sort();
  assert.equal(kept[0], '2026-07');
  assert.ok(kept.includes('2026-12'));
  assert.equal(kept.length, 30, 'two back to three ahead, plus 24');
});

test('a month looked at long ago is kept like one far ahead', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const may = { id: 'm1', summary: 'Recital', start: { dateTime: at(5, 20, 18) }, end: { dateTime: at(5, 20, 19) } };
  googleApi(c, onlySam({ items: [may] }));
  await run(c, `calEnsureMonths(['2026-05'])`);
  assert.deepEqual(((c.__data.gcalCache || {})['sam@example.com'] || {})['2026-05']?.items.map(e => e.title), ['Recital']);
  const calls = c.__calls.length;
  await run(c, `calEnsureMonths(['2026-05'])`);
  assert.equal(c.__calls.length, calls, 'not fetched again while fresh');
});

test('a change Google accepted counts as saved, even if fetching the month afterwards fails', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, ({ method }) => method === 'GET' ? gres(500) : method === 'DELETE' ? gres(204) : gres(200, { id: 'new1' }));
  const s = new Date(2026, 9, 2, 15).getTime();
  const item = await run(c, `calCreate({ title: 'Dentist', allDay: false, start: ${s}, end: ${s + 3600e3}, place: '', notes: '', repeat: null }, 'sam@example.com', { months: ['2026-10'] })`);
  assert.equal(item.id, 'new1');
  assert.equal(c.__calls.filter(x => x.method === 'POST').length, 1);
  const ev = { id: 'new1', source: 'google', calendarId: 'sam@example.com', editable: true, recurring: false, seriesId: 'new1',
    title: 'Dentist', allDay: false, start: s, end: s + 3600e3, place: '', notes: '' };
  await run(c, `calUpdate(${JSON.stringify(ev)}, { ...${JSON.stringify(ev)}, title: 'Dentist check-up' }, 'one', { months: ['2026-10'] })`);
  await run(c, `calDelete(${JSON.stringify(ev)}, 'one', { months: ['2026-10'] })`);
  assert.equal(c.__calls.filter(x => x.method === 'PATCH').length, 1);
  assert.equal(c.__calls.filter(x => x.method === 'DELETE').length, 1);
});

test('adding to Google sends the event and fetches its month again', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, ({ method }) => method === 'POST' ? gres(200, { id: 'new1' }) : gres(200, { items: [] }));
  const s = new Date(2026, 9, 2, 15).getTime();
  await run(c, `calCreate({ title: 'Dentist', allDay: false, start: ${s}, end: ${s + 3600e3}, place: 'Main St', notes: '', repeat: 'weekly' }, 'sam@example.com', { months: ['2026-09'] })`);
  const post = c.__calls.find(x => x.method === 'POST');
  assert.ok(post.url.endsWith('/calendars/sam%40example.com/events'));
  assert.deepEqual([post.body.summary, post.body.location], ['Dentist', 'Main St']);
  assert.equal(post.body.start.dateTime, new Date(s).toISOString());
  assert.equal(post.body.start.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(post.body.reminders, { useDefault: true });
  assert.deepEqual(post.body.recurrence, ['RRULE:FREQ=WEEKLY']);
  const again = c.__calls.filter(x => x.method === 'GET').map(x => new URL(x.url).searchParams.get('timeMin'));
  assert.ok(again.includes(new Date(2026, 8, 1).toISOString()), 'the month on screen');
  assert.ok(again.includes(new Date(2026, 9, 1).toISOString()), 'the event’s month');
  await run(c, `calCreate({ title: 'Trip', allDay: true, start: '2026-10-09', end: '2026-10-11' }, 'sam@example.com')`);
  const post2 = c.__calls.filter(x => x.method === 'POST')[1];
  assert.deepEqual([post2.body.start, post2.body.end, post2.body.recurrence], [{ date: '2026-10-09' }, { date: '2026-10-11' }, undefined]);
  await run(c, `calCreate({ title: 'Movie', allDay: true, start: '2026-10-09', end: '2026-10-10' }, 'local')`);
  assert.equal(c.__data.localEvents[0].title, 'Movie', '"Not yet. only" stays here');
});

test('changing a Google event sends only what changed; all of a series shifts from its start', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const master = { id: 'p1', start: { dateTime: at(9, 21, 16) }, end: { dateTime: at(9, 21, 17) }, recurrence: ['RRULE:FREQ=WEEKLY'] };
  googleApi(c, ({ method, url }) => method === 'GET' && url.endsWith('/events/p1') ? gres(200, master)
    : method === 'PATCH' ? gres(200, {}) : gres(200, { items: [] }));
  const one = { id: 'e1', source: 'google', calendarId: 'sam@example.com', editable: true, recurring: false, seriesId: 'e1',
    title: 'Dentist', allDay: false, start: new Date(2026, 8, 29, 15, 30).getTime(), end: new Date(2026, 8, 29, 16).getTime(), place: 'Main St', notes: '' };
  const j = JSON.stringify(one);
  await run(c, `calUpdate(${j}, { ...${j}, title: 'Dentist (Dr. Lee)' })`);
  let patch = c.__calls.find(x => x.method === 'PATCH');
  assert.ok(patch.url.endsWith('/events/e1'));
  assert.deepEqual(patch.body, { summary: 'Dentist (Dr. Lee)' });
  googleApi(c, ({ method }) => method === 'PATCH' ? gres(200, {}) : gres(200, { items: [] }));
  await run(c, `calUpdate(${j}, { ...${j}, allDay: true, start: '2026-09-29', end: '2026-09-30' })`);
  patch = c.__calls.find(x => x.method === 'PATCH');
  assert.deepEqual(patch.body.start, { date: '2026-09-29', dateTime: null, timeZone: null });
  googleApi(c, ({ method }) => method === 'PATCH' ? gres(200, {}) : gres(200, { items: [] }));
  await run(c, `calUpdate(${j}, { ...${j}, repeat: 'weekdays' })`);
  assert.deepEqual(c.__calls.find(x => x.method === 'PATCH').body, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] }, 'a one-off event that now repeats');
  const inst = JSON.stringify({ ...one, id: 'p1_20261005', seriesId: 'p1', recurring: true, title: 'Practice', place: '',
    start: new Date(2026, 9, 5, 16).getTime(), end: new Date(2026, 9, 5, 17).getTime() });
  googleApi(c, ({ method, url }) => method === 'GET' && url.endsWith('/events/p1') ? gres(200, master)
    : method === 'PATCH' ? gres(200, {}) : gres(200, { items: [] }));
  await run(c, `calUpdate(${inst}, { ...${inst}, start: ${new Date(2026, 9, 5, 17).getTime()}, end: ${new Date(2026, 9, 5, 18).getTime()}, repeat: 'weekly' }, 'all')`);
  patch = c.__calls.find(x => x.method === 'PATCH');
  assert.ok(patch.url.endsWith('/events/p1'), 'the series');
  assert.equal(patch.body.start.dateTime, at(9, 21, 17));
  assert.equal(patch.body.end.dateTime, at(9, 21, 18));
  assert.equal(patch.body.recurrence, undefined, 'the repeat didn’t change');
});

test('deleting from Google: one time, the series, or something already gone', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  googleApi(c, ({ method, url }) => method === 'DELETE' ? (url.endsWith('/events/gone1') ? gres(410) : gres(204)) : gres(200, { items: [] }));
  const inst = { id: 'p1_20261005', seriesId: 'p1', recurring: true, source: 'google', calendarId: 'sam@example.com', editable: true,
    allDay: false, start: new Date(2026, 9, 5, 16).getTime(), end: new Date(2026, 9, 5, 17).getTime(), title: 'Practice' };
  await run(c, `calDelete(${JSON.stringify(inst)}, 'one')`);
  await run(c, `calDelete(${JSON.stringify(inst)}, 'all')`);
  await run(c, `calDelete(${JSON.stringify({ ...inst, id: 'gone1', recurring: false })}, 'one')`);
  assert.deepEqual(c.__calls.filter(x => x.method === 'DELETE').map(x => x.url.split('/events/')[1]), ['p1_20261005', 'p1', 'gone1']);
  await assert.rejects(run(c, `calDelete(${JSON.stringify({ ...inst, editable: false })})`), e => e.kind === 'denied');
});

test('events saved only here move to Google, skipped times and all', async () => {
  const mon = new Date(2026, 8, 28, 16).getTime();
  const c = googleSandbox('2026-09-28T12:00:00', { localEvents: [
    { id: 'l-1', title: 'Piano', allDay: false, start: mon, end: mon + 3600e3, place: '', notes: '', repeat: 'weekly', skip: ['2026-10-05'] },
    { id: 'l-2', title: 'Trip', allDay: true, start: '2026-10-09', end: '2026-10-11', place: '', notes: '', repeat: null, skip: [] },
  ] });
  let n = 0;
  googleApi(c, ({ method }) => method === 'POST' ? (++n === 2 ? gres(500) : gres(200, { id: 'g' + n })) : gres(200, { items: [] }));
  assert.deepEqual(await run(c, `calMoveLocalToGoogle('sam@example.com')`), { moved: 1, failed: 1 });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.deepEqual(c.__calls.find(x => x.method === 'POST').body.recurrence, ['RRULE:FREQ=WEEKLY', `EXDATE;TZID=${tz}:20261005T160000`]);
  assert.deepEqual(c.__data.localEvents.map(e => e.id), ['l-2'], 'the one Google refused stays here');
});

test('new events go to the chosen calendar while signed in, else here', () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  const raw = { gcalAccounts: signedIn.gcalAccounts, gcalDefault: '', gcalCalendars: [
    { id: 'sam@example.com', account: 'sam@example.com', writable: true, primary: true, on: true, name: 'sam@example.com', color: 'sky' },
    { id: 'team', account: 'sam@example.com', writable: true, primary: false, on: false, name: 'Team', color: 'butter' },
    { id: 'hol', account: 'sam@example.com', writable: false, primary: false, on: true, name: 'Holidays', color: 'peach' }] };
  const def = r => run(c, `calDefaultCalendar(${JSON.stringify(r)})`);
  assert.equal(def(raw), 'sam@example.com');
  assert.equal(def({ ...raw, gcalDefault: 'team' }), 'team');
  assert.equal(def({ ...raw, gcalDefault: 'local' }), 'local');
  assert.equal(def({ gcalAccounts: [] }), 'local');
  assert.deepEqual(run(c, `calWritable(${JSON.stringify(raw)}).map(x => x.id)`), ['sam@example.com', 'local']);
  assert.deepEqual(run(c, `calWritable(${JSON.stringify({ ...raw, gcalDefault: 'team' })}).map(x => x.id)`), ['sam@example.com', 'team', 'local']);
});

test('the calendar choice groups calendars under each account when there’s more than one', () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  const cals = run(c, `calWritable(${JSON.stringify({ ...TWO, gcalDefault: '' })})`);
  const shape = run(c, `calGrouped(${JSON.stringify(cals)}).map(x => x === 'sep' ? '—' : x.heading ? '# ' + x.heading : x.name)`);
  assert.deepEqual(shape, ['# sam@example.com', 'Main calendar', '# sam@school.edu', 'Main calendar', 'Class', '—', 'Not yet. only'],
    'under its own email, an account’s main calendar is just “Main calendar”');
  assert.deepEqual(run(c, `calGrouped(${JSON.stringify(cals)}).filter(x => x.aria).map(x => x.aria)`),
    ['Main calendar, sam@example.com', 'Main calendar, sam@school.edu', 'Class, sam@school.edu'], 'a screen reader hears whose calendar it is');
  const one = run(c, `calWritable(${JSON.stringify({ ...signedIn, gcalCalendars: [TWO.gcalCalendars[0]] })})`);
  assert.deepEqual(run(c, `calGrouped(${JSON.stringify(one)}).map(x => x.name)`), ['sam@example.com', 'Not yet. only'], 'one account: no headings');
});

test('the sign-in strip names the account when there’s more than one', () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  const ask = raw => run(c, `calSignInAsk(${JSON.stringify(raw)})`);
  assert.equal(ask(TWO), null);
  assert.deepEqual(ask({ gcalAccounts: [{ ...signedIn.gcalAccounts[0], needsSignIn: true }] }),
    { email: 'sam@example.com', text: 'Google Calendar needs you to sign in again.' });
  assert.deepEqual(ask({ gcalAccounts: [TWO.gcalAccounts[0], { ...TWO.gcalAccounts[1], needsSignIn: true }] }),
    { email: 'sam@school.edu', text: 'sam@school.edu needs you to sign in again.' });
  assert.equal(ask({ gcalAccounts: [] }), null);
  const about = (raw, email) => run(c, `calSignInAsk(${JSON.stringify(raw)}, '${email}')`);
  assert.deepEqual(about(TWO, 'sam@school.edu'), { email: 'sam@school.edu', text: 'sam@school.edu needs you to sign in again.' },
    'the event window’s error, for the account Google just turned down');
  assert.deepEqual(about(signedIn, 'sam@example.com'), { email: 'sam@example.com', text: 'Google Calendar needs you to sign in again.' });
});

test('refreshing everything: links, then Google’s list and the months around today', async () => {
  const c = googleSandbox('2026-09-28T12:00:00', { calFeeds: [{ id: 'f1', url: 'https://calendar.example/a.ics', name: 'School', color: 'sky', on: true }] });
  googleApi(c, ({ url }) => url.startsWith('https://calendar.example') ? { ok: true, status: 200, text: async () => ICS_TEXT }
    : url.includes('calendarList') ? gres(200, G_LIST) : gres(200, { items: [] }));
  await run(c, `calRefreshSources({ force: true })`);
  assert.ok(c.__data.feedCache.f1.items.length > 0);
  assert.deepEqual(c.__data.gcalCalendars.map(x => x.name), ['sam@example.com', 'Soccer team', 'Holidays in Canada', 'School']);
  const mins = new Set(c.__calls.filter(x => x.url.includes('/events?')).map(x => new URL(x.url).searchParams.get('timeMin')));
  assert.deepEqual([...mins].sort(), [7, 8, 9, 10, 11].map(m => new Date(2026, m, 1).toISOString()).sort(), 'last month to three ahead');
  c.__data.gcalAccounts[0].needsSignIn = true;
  c.__calls.length = 0;
  await run(c, `calRefreshSources({ force: true })`);
  assert.ok(c.__calls.length > 0 && c.__calls.every(x => x.url.startsWith('https://calendar.example')), 'links still refresh; Google is left alone');
});

test('sync: Google events plan tasks too; events saved here never do', async () => {
  const c = googleSandbox('2026-09-28T12:00:00', { localEvents: [{ id: 'l-9', title: '📝 Not homework', allDay: true,
    start: '2026-09-28', end: '2026-09-29', place: '', notes: '', repeat: null, skip: [] }] });
  const essay = { id: 'g-essay', summary: '📝 Essay draft [45m]', start: { dateTime: at(9, 29, 19) }, end: { dateTime: at(9, 29, 20) } };
  googleApi(c, ({ url }) => url.includes('calendarList')
    ? gres(200, { items: [{ id: 'sam@example.com', summary: 'sam@example.com', accessRole: 'owner', primary: true, selected: true }] })
    : gres(200, { items: url.includes('sam%40') && new URL(url).searchParams.get('timeMin') === new Date(2026, 8, 1).toISOString() ? [essay] : [] }));
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.deepEqual((c.__data.hwTasksByDay['2026-09-29'] || []).map(t => [t.id, t.title, t.estMin]), [['cal-g-essay', 'Essay draft', 45]]);
  assert.equal((c.__data.hwTasksByDay['2026-09-28'] || []).length, 0, 'a local event with a tag stays an event');
  assert.deepEqual(await run(c, `calLoadRaw().then(r => calCollect(r, '2026-09-28', '2026-09-28').filter(e => !calIsTask(e)).map(e => e.title))`), ['📝 Not homework']);
  const none = sandbox('2026-09-28T12:00:00');
  assert.equal(await run(none, `hwSyncFromCalendar({ force: true })`), null, 'nothing connected');
});

test('sync: a calendar connected by link and by Google plans its homework once', async () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc123@google.com', 'SUMMARY:📝 Essay draft [45m]',
    'DTSTART:20260929T190000', 'DTEND:20260929T200000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const c = googleSandbox('2026-09-28T12:00:00', { calFeeds: [{ id: 'f1', url: 'https://calendar.google.com/calendar/ical/sam%40example.com/private-x/basic.ics', name: 'Mine', color: 'sky', on: true }] });
  const essay = { id: 'abc123', iCalUID: 'abc123@google.com', summary: '📝 Essay draft [45m]', start: { dateTime: at(9, 29, 19) }, end: { dateTime: at(9, 29, 20) } };
  googleApi(c, ({ url }) => url.startsWith('https://calendar.google.com/calendar/ical') ? { ok: true, status: 200, text: async () => ics }
    : url.includes('calendarList') ? gres(200, { items: [{ id: 'sam@example.com', summary: 'sam@example.com', accessRole: 'owner', primary: true, selected: true }] })
    : gres(200, { items: url.includes('sam%40') && new URL(url).searchParams.get('timeMin') === new Date(2026, 8, 1).toISOString() ? [essay] : [] }));
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.deepEqual((c.__data.hwTasksByDay['2026-09-29'] || []).map(t => [t.id, t.title]), [['cal-abc123@google.com', 'Essay draft']],
    'one task, with the id 6.0 gave it');
});

test('one calendar failing keeps every other month that came back, and at most 6 ask at once', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  let inFlight = 0, most = 0;
  googleApi(c, async ({ url }) => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return url.includes('/calendars/hol/') ? gres(404) : gres(200, { items: [] });
  });
  const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
  await run(c, `calEnsureMonths(${JSON.stringify(months)})`).catch(() => {});
  assert.deepEqual(Object.keys((c.__data.gcalCache || {})['sam@example.com'] || {}).sort(), months, 'sam’s months are kept');
  assert.ok(most <= 6, `at most 6 at once (was ${most})`);
});

test('months for several calendars are fetched at the same time, not one by one', async () => {
  const c = googleSandbox('2026-09-28T12:00:00');
  let inFlight = 0, most = 0;
  googleApi(c, async () => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return gres(200, { items: [] });
  });
  await run(c, `calEnsureMonths(['2026-09', '2026-10', '2026-11'])`);
  assert.equal(c.__calls.length, 6, 'two switched-on calendars, three months');
  assert.equal(most, 6, 'all at once');
});

// ── Connections: other apps' tasks ──────────────────────────────────────────

const fakeApp = (c, id, items, extra = '') => run(c, `connRegister('${id}', { list: async () => (${JSON.stringify(items)}), setDone: async () => {} ${extra} })`);

test('connections: a connected app’s tasks are fetched, cached and collected with their ids', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true, token: 't' } } } });
  fakeApp(c, 'fake', [
    { rid: '1', title: 'Essay', due: '2026-09-30', minutes: 45, hint: 'English' },
    { rid: '2', title: 'Old worksheet', due: '2026-09-20', minutes: null, hint: '' },
    { rid: '3', title: 'Far away', due: '2026-11-30', minutes: null, hint: '' },
  ]);
  await run(c, `connRefresh({ force: true })`);
  assert.equal(c.__data.connections.fake.error, '');
  assert.ok(c.__data.connections.fake.lastSync > 0);
  const got = await run(c, `connCollect().then(r => ({ ids: r.items.map(i => i.id), live: [...r.live] }))`);
  assert.deepEqual(got, { ids: ['x-fake-1', 'x-fake-2'], live: ['fake'] });
});

test('connections: one app failing keeps the others and says what went wrong', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { good: { on: true }, bad: { on: true } } } });
  fakeApp(c, 'good', [{ rid: 'a', title: 'A', due: '2026-09-28', minutes: null, hint: '' }]);
  run(c, `connRegister('bad', { list: async () => { throw new ConnError('token', 'Todoist'); }, setDone: async () => {} })`);
  await run(c, `connRefresh({ force: true })`);
  assert.equal(c.__data.connCache.good.items.length, 1);
  assert.equal(c.__data.connections.bad.error, 'Todoist didn’t accept that token. Paste a new one.');
  assert.deepEqual(await run(c, `connCollect().then(r => [...r.live])`), ['good']);
});

test('connections: a fresh cache isn’t fetched again unless forced', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  c.__n = 0;
  run(c, `connRegister('fake', { list: async () => { __n++; return []; }, setDone: async () => {} })`);
  await run(c, `connRefresh({ force: true })`);
  await run(c, `connRefresh()`);
  assert.equal(c.__n, 1);
  await run(c, `connRefresh({ force: true })`);
  assert.equal(c.__n, 2);
});

test('connections: ids, names and a title’s own length and tag', () => {
  const c = sandbox('2026-09-28T12:00:00');
  assert.deepEqual(run(c, `connIdParts('x-todoist-8a-9')`), { app: 'todoist', rid: '8a-9' });
  assert.equal(run(c, `connIdParts('cal-1')`), null);
  assert.equal(run(c, `connName('mstodo')`), 'Microsoft To Do');
  assert.deepEqual(run(c, `connTemplate({ title: 'Essay [45m]', minutes: null })`), { title: 'Essay', estMin: 45, type: 'M', courseHint: '' });
  assert.deepEqual(run(c, `connTemplate({ title: 'Worksheet', minutes: 20 })`), { title: 'Worksheet', estMin: 20, type: 'M', courseHint: '' });
  assert.equal(run(c, `connTemplate({ title: '📝 Lab report', minutes: null })`).title, 'Lab report');
});

test('connections: disconnecting clears the days ahead but keeps today, done, started and edited tasks', async () => {
  const task = (id, extra = {}) => ({ id, title: id, course: 'other', estMin: 30, type: 'M', done: false, ...extra });
  const c = sandbox('2026-09-28T12:00:00', { store: {
    connections: { todoist: { on: true, token: 't' } }, connCache: { todoist: { at: 1, items: [] } },
    hwTasksByDay: {
      '2026-09-28': [task('x-todoist-1')],
      '2026-09-30': [task('x-todoist-2'), task('x-todoist-3', { done: true }), task('x-todoist-4', { edited: true }), task('man-5')],
      '2026-10-01': [task('x-todoist-6')],
    },
    hwActiveTimers: {},
  } });
  await run(c, `connForget('todoist')`);
  const ids = ds => (c.__data.hwTasksByDay[ds] || []).map(t => t.id);
  assert.deepEqual(ids('2026-09-28'), ['x-todoist-1']);
  assert.deepEqual(ids('2026-09-30'), ['x-todoist-3', 'x-todoist-4', 'man-5']);
  assert.deepEqual(ids('2026-10-01'), []);
  assert.equal(c.__data.connections.todoist, undefined);
  assert.equal(c.__data.connCache.todoist, undefined);
});

test('sync: tasks from connected apps land on their days, overdue ones on today, with subject and length', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  fakeApp(c, 'fake', [
    { rid: '1', title: 'Essay [45m]', due: '2026-09-30', minutes: null, hint: '' },
    { rid: '2', title: 'Worksheet', due: '2026-09-25', minutes: 20, hint: 'Math 10' },
  ]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  const day = ds => (c.__data.hwTasksByDay[ds] || []).map(t => ({ id: t.id, title: t.title, estMin: t.estMin, course: t.course, src: t.src, carriedFrom: t.carriedFrom || null }));
  assert.deepEqual(day('2026-09-30'), [{ id: 'x-fake-1', title: 'Essay', estMin: 45, course: 'english', src: 'fake', carriedFrom: null }]);
  assert.deepEqual(day('2026-09-28'), [{ id: 'x-fake-2', title: 'Worksheet', estMin: 20, course: 'math', src: 'fake', carriedFrom: '2026-09-25' }]);
  assert.equal(run(c, `hwCarriedLabel({ src: 'todoist', carriedFrom: '2026-09-25' })`), 'From Todoist');
});

test('sync: a task finished in its app is ticked here; the days ahead follow the app; a failing app changes nothing', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  c.__items = [
    { rid: '1', title: 'Today thing', due: '2026-09-28', minutes: null, hint: '' },
    { rid: '2', title: 'Later thing', due: '2026-10-01', minutes: null, hint: '' },
  ];
  c.__fail = false;
  run(c, `connRegister('fake', { list: async () => { if (__fail) throw new ConnError('offline'); return __items; }, setDone: async () => {} })`);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  c.__fail = true; c.__items = [];
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.hwTasksByDay['2026-09-28'].find(t => t.id === 'x-fake-1').done, false, 'offline: nothing changes');
  assert.ok(c.__data.hwTasksByDay['2026-10-01'], 'offline: the day ahead keeps it');
  c.__fail = false; c.__items = [{ rid: '1', title: 'Today thing', due: '2026-09-28', minutes: null, hint: '', done: true }];
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.hwTasksByDay['2026-09-28'].find(t => t.id === 'x-fake-1').done, true, 'finished in the app');
  assert.equal(c.__data.hwTasksByDay['2026-10-01'], undefined, 'gone from the app, gone ahead');
});

test('ticking an imported task ticks it in its app; if that fails it retries on the next sync', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  c.__ticks = []; c.__down = true;
  run(c, `connRegister('fake', { list: async () => [{ rid: '7', title: 'Lab', due: '2026-09-28', minutes: null, hint: '' }],
    setDone: async (conn, rid, done) => { if (__down) throw new Error('offline'); __ticks.push([rid, done]); } })`);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(await run(c, `hwSetDone('2026-09-28', 'x-fake-7', true)`), 'queued');
  let t = c.__data.hwTasksByDay['2026-09-28'].find(x => x.id === 'x-fake-7');
  assert.equal(t.done, true);
  assert.equal(t.pendingDone, true);
  c.__down = false;
  await run(c, `hwSyncFromCalendar({ force: true })`);
  t = c.__data.hwTasksByDay['2026-09-28'].find(x => x.id === 'x-fake-7');
  assert.equal('pendingDone' in t, false);
  assert.deepEqual(structuredClone(c.__ticks), [['7', true]]);          // made in the sandbox: copy out to compare
  assert.equal(await run(c, `hwSetDone('2026-09-28', 'man-1', true)`), 'ok', 'tasks of our own have nothing to tick back');
});

test('a restored backup (a connection with no token) shows the token message and breaks nothing', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { todoist: { on: true } } } });
  c.__route = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.connections.todoist.error, 'Todoist didn’t accept that token. Paste a new one.');
});

test('Todoist: tasks due soon or overdue come in with their project, length and ids', async () => {
  const c = sandbox('2026-09-28T12:00:00');
  const calls = [];
  c.__route = async (url, opts) => {
    calls.push({ url, method: opts.method || 'GET', auth: (opts.headers || {}).Authorization });
    if (url.includes('/projects')) return gres(200, { results: [{ id: 'p1', name: 'Math 10' }], next_cursor: null });
    if (url.includes('/tasks/filter')) return gres(200, url.includes('cursor=')
      ? { results: [{ id: '9', content: 'Poster', due: { date: '2026-10-01' }, project_id: 'p2' }], next_cursor: null }
      : { results: [
          { id: '8', content: 'Worksheet 3.2', due: { date: '2026-09-29T16:00:00' }, duration: { amount: 40, unit: 'minute' }, project_id: 'p1' },
          { id: '10', content: 'No date', due: null, project_id: 'p1' }], next_cursor: 'abc' });
    return gres(404);
  };
  const items = await run(c, `connApi('todoist').list({ token: 'tok' })`);
  assert.deepEqual(items, [
    { rid: '8', title: 'Worksheet 3.2', due: '2026-09-29', minutes: 40, hint: 'Math 10' },
    { rid: '9', title: 'Poster', due: '2026-10-01', minutes: null, hint: '' },
  ]);
  assert.ok(calls.every(x => x.auth === 'Bearer tok'));
  assert.equal(new URL(calls.find(x => x.url.includes('/tasks/filter')).url).searchParams.get('query'), 'overdue | next 14 days');
});

test('Todoist: ticking closes, unticking reopens, a bad token says so', async () => {
  const c = sandbox('2026-09-28T12:00:00');
  const calls = [];
  c.__route = async (url, opts) => { calls.push([opts.method, url]); return url.includes('bad') ? gres(401) : gres(204); };
  await run(c, `connApi('todoist').setDone({ token: 'tok' }, '8', true)`);
  await run(c, `connApi('todoist').setDone({ token: 'tok' }, '8', false)`);
  assert.deepEqual(calls, [['POST', 'https://api.todoist.com/api/v1/tasks/8/close'], ['POST', 'https://api.todoist.com/api/v1/tasks/8/reopen']]);
  c.__route = async () => gres(401);
  await assert.rejects(run(c, `connApi('todoist').check({ token: 'bad' })`), e => e.message === 'Todoist didn’t accept that token. Paste a new one.');
});

const T_SCOPE = 'https://www.googleapis.com/auth/tasks';

const DISABLED = { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }],
  message: 'Google Tasks API has not been used in project 1 before or it is disabled.' } };

test('one Google window for calendars and tasks; Tasks can be left unticked', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  googleAuth(c, { scope: G_SCOPES + ' ' + T_SCOPE });
  googleApi(c, ({ url }) => url.includes('calendarList') ? gres(200, G_LIST) : gres(200, { items: [{ id: 'L1', title: 'School' }] }));
  const r = await run(c, `gcalSignIn()`);
  assert.deepEqual([r.ok, r.tasks, r.tasksError], [true, true, '']);
  assert.equal(new URL(c.__authCalls[0].url).searchParams.get('scope'), G_SCOPES + ' ' + T_SCOPE);
  assert.ok(c.__calls.some(x => x.url.startsWith('https://tasks.googleapis.com/tasks/v1/users/@me/lists')), 'it checks the lists can be read');
  assert.equal(c.__data.gcalAccounts[0].tasks, true);
  assert.equal(c.__data.connections.gtasks.on, true);
  const off = sandbox('2026-09-28T12:00:00', { google: true });
  googleAuth(off, { scope: G_SCOPES });
  googleApi(off, () => gres(200, G_LIST));
  const r2 = await run(off, `gcalSignIn()`);
  assert.deepEqual([r2.ok, r2.tasks], [true, false], 'the calendars connect without Tasks');
  assert.equal(off.__data.gcalAccounts[0].tasks, false);
  assert.equal(off.__data.connections, undefined);
  assert.ok(!off.__calls.some(x => x.url.includes('tasks.googleapis.com')));
  assert.equal(run(off, `GCAL_MESSAGES['tasks-off']`), 'Tasks are off for this account.');
});

test('Google Tasks switched off in Google Cloud: it says so, and the calendars still connect', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true });
  googleAuth(c, { scope: G_SCOPES + ' ' + T_SCOPE });
  googleApi(c, ({ url }) => url.includes('calendarList') ? gres(200, G_LIST) : gres(403, DISABLED));
  const r = await run(c, `gcalSignIn()`);
  assert.equal(r.ok, true);
  assert.equal(r.tasksError, 'Google Tasks isn’t switched on for Not yet. yet.');
  assert.equal(c.__data.connections.gtasks.accounts['sam@example.com'].error, r.tasksError);
  assert.ok(c.__data.gcalCalendars.length > 0);
  googleApi(c, () => gres(403, { error: { errors: [{ reason: 'forbidden' }] } }));
  await assert.rejects(run(c, `gcalApi('users/me/calendarList', { account: 'sam@example.com' })`), e => e.kind === 'denied', 'other 403s are still “not allowed”');
});

test('Turn on: the Tasks permission alone, for that account', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { gcalAccounts: TWO.gcalAccounts.map(a => ({ ...a, tasks: false })) } });
  googleAuth(c, { scope: G_SCOPES + ' ' + T_SCOPE, token: 'tok-t' });
  googleApi(c, () => gres(200, { items: [] }));
  assert.deepEqual(await run(c, `gtasksConnect('sam@school.edu')`), { ok: true, tasksError: '' });
  const u = new URL(c.__authCalls[0].url);
  assert.equal(u.searchParams.get('scope'), T_SCOPE);
  assert.equal(u.searchParams.get('login_hint'), 'sam@school.edu');
  assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(c.__session.gcalTokens['sam@school.edu'].token, 'tok-t');
  assert.deepEqual(c.__data.gcalAccounts.map(a => a.tasks), [false, true]);
  assert.equal(c.__data.connections.gtasks.on, true);
  googleAuth(c, { scope: G_SCOPES });
  assert.deepEqual(await run(c, `gtasksConnect('sam@school.edu')`), { error: 'tasks-scope' });
  assert.deepEqual(await run(c, `gtasksConnect('nobody@example.com')`), { error: 'signed-out' });
});

// Two accounts' Google Tasks: home has School (L1) and Chores (off); school has Homework (H1).
function tasksApi(c, { schoolFails = false } = {}) {
  googleApi(c, ({ url, method, auth }) => {
    const school = auth === 'Bearer tok-school';
    if (method === 'PATCH') return gres(200, {});
    if (url.includes('/users/@me/lists')) return school ? (schoolFails ? gres(500) : gres(200, { items: [{ id: 'H1', title: 'Homework' }] }))
      : gres(200, { items: [{ id: 'L1', title: 'School' }, { id: 'off', title: 'Chores' }] });
    if (url.includes('/lists/L1/tasks') && url.includes('showCompleted=false')) return gres(200, { items: [
      { id: 't1', title: 'Read ch 4', due: '2026-09-30T00:00:00.000Z' }, { id: 't2', title: 'Someday' }] });
    if (url.includes('/lists/H1/tasks') && url.includes('showCompleted=false')) return gres(200, { items: [{ id: 'h1', title: 'Lab report', due: '2026-10-01T00:00:00.000Z' }] });
    return gres(200, { items: [] });
  });
}

test('Google Tasks: dated tasks from every account’s lists that are on, and ticks go back through their account', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, connections: { gtasks: { on: true, lists: { off: false } } } } });
  passes(c, PASSES);
  tasksApi(c);
  const items = await run(c, `connApi('gtasks').list({ on: true, lists: { off: false } }, new Date())`);
  assert.deepEqual(items, [
    { rid: 'L1~t1', title: 'Read ch 4', due: '2026-09-30', minutes: null, hint: 'School', account: 'sam@example.com' },
    { rid: 'H1~h1', title: 'Lab report', due: '2026-10-01', minutes: null, hint: 'Homework', account: 'sam@school.edu' }]);
  assert.ok(!c.__calls.some(x => x.url.includes('/lists/off/')), 'a list switched off isn’t read');
  assert.deepEqual(Object.entries(c.__data.connections.gtasks.accounts).map(([e, n]) => [e, n.error, n.lists]),
    [['sam@example.com', '', 1], ['sam@school.edu', '', 1]]);
  await run(c, `connApi('gtasks').setDone({}, 'H1~h1', true, ${JSON.stringify(items[1])})`);
  const patch = c.__calls.find(x => x.method === 'PATCH');
  assert.equal(patch.url, 'https://tasks.googleapis.com/tasks/v1/lists/H1/tasks/h1');
  assert.deepEqual([patch.body, patch.auth], [{ status: 'completed' }, 'Bearer tok-school']);
  const lists = await run(c, `connApi('gtasks').lists({}, 'sam@school.edu')`);
  assert.deepEqual(lists, [{ id: 'H1', name: 'Homework' }]);
});

test('Google Tasks: one account failing keeps its open tasks and doesn’t stop the other', async () => {
  const before = [{ rid: 'H1~old', title: 'Old essay', due: '2026-09-29', minutes: null, hint: 'Homework', account: 'sam@school.edu' },
    { rid: 'H1~fin', title: 'Done one', due: '', minutes: null, hint: 'Homework', account: 'sam@school.edu', done: true }];
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, connections: { gtasks: { on: true } }, connCache: { gtasks: { at: 1, items: before } } } });
  passes(c, PASSES);
  tasksApi(c, { schoolFails: true });
  const items = await run(c, `connApi('gtasks').list({ on: true }, new Date())`);
  assert.deepEqual(items.map(i => i.rid), ['L1~t1', 'H1~old'], 'home’s new tasks, and school’s open ones from last time, without done marks');
  assert.equal(c.__data.connections.gtasks.accounts['sam@school.edu'].error, 'Something went wrong talking to Google Tasks. Try again.');
  googleApi(c, () => gres(500));
  await assert.rejects(run(c, `connApi('gtasks').list({ on: true }, new Date())`), 'every account failing is the app failing');
});

test('Google Tasks: an account removed while its tasks are being read doesn’t come back', async () => {
  const c = sandbox('2026-09-28T12:00:00', { google: true, store: { ...TWO, connections: { gtasks: { on: true } } } });
  passes(c, PASSES);
  tasksApi(c);
  const real = c.__route;
  c.__route = async (url, opts) => {
    if (url.includes('/lists/H1/tasks')) c.__data.gcalAccounts = c.__data.gcalAccounts.filter(a => a.email !== 'sam@school.edu');
    return real(url, opts);
  };
  const items = await run(c, `connApi('gtasks').list({ on: true }, new Date())`);
  assert.deepEqual(items.map(i => i.account), ['sam@example.com']);
});

test('Connections: one Google card for calendars and tasks', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const g = run(c, `CONN_APPS.find(a => a.id === 'gcal')`);
  assert.deepEqual([g.name, run(c, `connKinds(CONN_APPS.find(a => a.id === 'gcal'))`)], ['Google', ['calendar', 'tasks']]);
  assert.equal(g.blurb, 'Calendars and tasks from your Google accounts');
  assert.equal(run(c, `CONN_APPS.some(a => a.id === 'gtasks' || a.name === 'Google Tasks' || a.name === 'Google Calendar')`), false);
  assert.equal(run(c, `connName('gtasks')`), 'Google Tasks', 'tasks still say where they came from');
  assert.equal(run(c, `connName('gcal')`), 'Google');
  assert.deepEqual(run(c, `connKinds(CONN_APPS.find(a => a.id === 'todoist'))`), ['tasks']);
});

test('every page that can sign in to Google loads what Google Tasks needs, in order', () => {
  for (const f of ['popup', 'planner', 'settings', 'welcome']) {
    const html = readFileSync(join(root, 'pages', f + '.html'), 'utf8');
    if (!html.includes('lib/event-editor.js')) continue;
    const at = s => html.indexOf(s);
    assert.ok(at('lib/gcal.js') > 0 && at('lib/connections.js') > 0 && at('lib/apps/google-tasks.js') > 0, f);
    assert.ok(at('lib/connections.js') < at('lib/apps/google-tasks.js'), `${f}: connections.js before google-tasks.js`);
  }
  const bg = readFileSync(join(root, 'background.js'), 'utf8');
  assert.match(bg, /'gcalAccounts'/, 'quiet key');
  assert.doesNotMatch(bg, /'gcalAccount'/);
  assert.match(bg, /gcalMigrate\(\)/, 'the move-over runs at start-up');
  assert.match(readFileSync(join(root, 'pages', 'settings.js'), 'utf8'), /gcalMigrate\(\)/, 'a restored backup from before keeps its account');
});

test('the privacy text names the Google controls that exist: Remove next to the account, one Google window', () => {
  for (const f of [join(root, 'pages', 'privacy.html'), join(root, 'store', 'privacy.md'), join(root, '..', 'Not Yet Web', 'privacy.html')]) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /Signing out of Google|Connections → Google Calendar|same Google sign-in as Google Calendar/, f);
    assert.match(text, /Remove next to the account/, f);
    assert.match(text, /Removing a Google account/, f);
  }
});

function msSandbox(store = {}) {
  const c = sandbox('2026-09-28T12:00:00', { store });
  run(c, `NY_MS_CLIENT_ID = 'ms-test'`);                      // read at call time through msReady()
  c.__calls = [];
  c.__auth = async ({ url }) => { const s = new URL(url).searchParams; c.__authUrl = s; return `https://ext.chromiumapp.org/?code=abc&state=${s.get('state')}`; };
  c.__route = async (url, opts) => {
    c.__calls.push({ url, method: opts.method || 'GET', body: opts.body ? String(opts.body) : null });
    if (url.endsWith('/oauth2/v2.0/token')) return gres(200, { access_token: 'ms-tok', expires_in: 3600 });
    if (url.endsWith('/v1.0/me')) return gres(200, { userPrincipalName: 'sam@outlook.com' });
    if (url.includes('/me/todo/lists?') || url.endsWith('/me/todo/lists')) return gres(200, { value: [{ id: 'A', displayName: 'Homework' }] });
    if (url.includes('/me/todo/lists/A/tasks') && (opts.method || 'GET') === 'GET') return gres(200, { value: [
      { id: 'k1', title: 'Essay', dueDateTime: { dateTime: '2026-10-02T00:00:00.0000000', timeZone: 'UTC' } },
      { id: 'k2', title: 'Undated' },
      { id: 'k3', title: 'Far', dueDateTime: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'UTC' } }] });
    if (opts.method === 'PATCH') return gres(200, {});
    return gres(404);
  };
  return c;
}

test('Microsoft To Do: sign in with a code and PKCE, then dated tasks come in and ticks go back', async () => {
  const c = msSandbox();
  assert.deepEqual(await run(c, `mstodoConnect()`), { ok: true });
  assert.equal(c.__authUrl.get('response_type'), 'code');
  assert.equal(c.__authUrl.get('code_challenge_method'), 'S256');
  assert.equal(c.__authUrl.get('scope'), 'Tasks.ReadWrite User.Read offline_access');
  const tokenCall = c.__calls.find(x => x.url.endsWith('/token'));
  assert.match(tokenCall.body, /code_verifier=/);
  assert.equal(c.__session.msToken.token, 'ms-tok');
  assert.equal(c.__data.connections.mstodo.account, 'sam@outlook.com');
  const items = await run(c, `connApi('mstodo').list(${JSON.stringify({ on: true, lists: {} })}, new Date())`);
  assert.deepEqual(items, [{ rid: 'A~k1', title: 'Essay', due: '2026-10-02', minutes: null, hint: 'Homework' }]);
  await run(c, `connApi('mstodo').setDone({}, 'A~k1', true)`);
  const patch = c.__calls.find(x => x.method === 'PATCH');
  assert.equal(patch.url, 'https://graph.microsoft.com/v1.0/me/todo/lists/A/tasks/k1');
  assert.equal(patch.body, JSON.stringify({ status: 'completed' }));
});

test('Microsoft To Do: without a client ID it says it isn’t set up', async () => {
  const c = sandbox('2026-09-28T12:00:00');
  assert.deepEqual(await run(c, `mstodoConnect()`), { error: 'unavailable' });
});

test('Canvas: the address, planner items (handed-in ones marked done), their course, and marking them done', async () => {
  const c = sandbox('2026-09-28T12:00:00');
  assert.equal(run(c, `canvasOrigin('school.instructure.com/courses/5')`), 'https://school.instructure.com');
  assert.equal(run(c, `canvasOrigin('not a place')`), null);
  const calls = [];
  const page1 = [
    { plannable_type: 'assignment', plannable_id: 11, plannable: { title: 'Lab report' }, plannable_date: '2026-09-30T05:59:00Z', context_name: 'Biology 11' },
    { plannable_type: 'quiz', plannable_id: 12, plannable: { title: 'Quiz 3' }, plannable_date: '2026-10-01T15:00:00Z', context_name: 'Math 10',
      planner_override: { id: 77, marked_complete: false } },
    { plannable_type: 'assignment', plannable_id: 13, plannable: { title: 'Done already' }, plannable_date: '2026-09-29T15:00:00Z', submissions: { submitted: true } },
    { plannable_type: 'announcement', plannable_id: 14, plannable: { title: 'News' }, plannable_date: '2026-09-29T15:00:00Z' },
  ];
  c.__route = async (url, opts) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body || null, auth: (opts.headers || {}).Authorization });
    if (url.includes('/planner/items') && !url.includes('page=2')) return { ...gres(200, page1),
      headers: { get: k => k === 'Link' ? '<https://school.instructure.com/api/v1/planner/items?page=2>; rel="next"' : null } };
    if (url.includes('page=2')) return { ...gres(200, []), headers: { get: () => null } };
    return { ...gres(200, {}), headers: { get: () => null } };
  };
  const conn = { school: 'https://school.instructure.com', token: 'tok' };
  const all = await run(c, `connApi('canvas').list(${JSON.stringify(conn)}, new Date())`);
  assert.deepEqual(all.filter(i => i.done).map(i => i.rid), ['assignment~13'], 'handed in: comes back done');
  const items = all.filter(i => !i.done);
  assert.deepEqual(items.map(i => [i.rid, i.title, i.due, i.hint]), [
    ['assignment~11', 'Lab report', hwDueOf(c, '2026-09-30T05:59:00Z'), 'Biology 11'],
    ['quiz~12', 'Quiz 3', hwDueOf(c, '2026-10-01T15:00:00Z'), 'Math 10'],
  ]);
  assert.ok(calls.every(x => x.auth === 'Bearer tok'));
  await run(c, `connApi('canvas').setDone(${JSON.stringify(conn)}, 'quiz~12', true, ${JSON.stringify(items[1])})`);
  await run(c, `connApi('canvas').setDone(${JSON.stringify(conn)}, 'assignment~11', true, ${JSON.stringify(items[0])})`);
  const writes = calls.filter(x => x.method !== 'GET');
  assert.deepEqual(writes.map(x => [x.method, x.url.replace('https://school.instructure.com/api/v1/', ''), JSON.parse(x.body)]), [
    ['PUT', 'planner/overrides/77', { marked_complete: true }],
    ['POST', 'planner/overrides', { plannable_type: 'assignment', plannable_id: '11', marked_complete: true }],
  ]);
});
const hwDueOf = (c, iso) => run(c, `hwTodayStr(new Date('${iso}'))`);   // due times land on the local day

// ── Connections: what the final review found ────────────────────────────────

// A pretend app that remembers: open tasks are listed, finished ones come back
// marked done (as the real apps report them), and ticks change it.
const stateApp = (c, tasks) => {
  c.__tasks = tasks; c.__down = false; c.__ticks = [];
  run(c, `connRegister('fake', {
    list: async () => { if (__down) throw new ConnError('offline'); return __tasks.map(t => ({ rid: t.rid, title: t.title, due: t.due, minutes: null, hint: '', ...(t.closed ? { done: true } : {}) })); },
    setDone: async (conn, rid, done) => { if (__down) throw new ConnError('offline'); __ticks.push([rid, done]); __tasks.find(t => t.rid === rid).closed = done; } })`);
};
const idsOn = (c, ds) => (c.__data.hwTasksByDay[ds] || []).map(t => t.id);

test('sync: a task ticked here doesn’t come back the next day while its app can’t be reached', async () => {
  const c = sandbox('2026-09-28T20:00:00', { store: { connections: { fake: { on: true } } } });
  stateApp(c, [{ rid: '1', title: 'Lab', due: '2026-09-28' }]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(await run(c, `hwSetDone('2026-09-28', 'x-fake-1', true)`), 'ok');
  assert.equal(c.__data.connCache.fake.items[0].done, true, 'the cache knows it’s finished');
  c.__setNow('2026-09-29T00:05:00'); c.__down = true;            // the laptop wakes before the wifi
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(idsOn(c, '2026-09-29').includes('x-fake-1'), false);
});

test('sync: a task that leaves its app unfinished stays on today, unticked; one finished there is ticked', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  stateApp(c, [{ rid: '1', title: 'Chores', due: '2026-09-28' }, { rid: '2', title: 'Lab', due: '2026-09-28' }, { rid: '3', title: 'Essay', due: '2026-09-30' }]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  c.__tasks[1].closed = true;                                    // finished in the app
  c.__tasks.splice(2, 1); c.__tasks.splice(0, 1);                // Essay and Chores left it (a list switched off, a new date)
  await run(c, `hwSyncFromCalendar({ force: true })`);
  const today = c.__data.hwTasksByDay['2026-09-28'];
  assert.equal(today.find(t => t.id === 'x-fake-1').done, false, 'left the app: still to do here');
  assert.equal(today.find(t => t.id === 'x-fake-2').done, true, 'finished in the app: ticked here');
  assert.equal(c.__data.hwTasksByDay['2026-09-30'], undefined, 'the days ahead follow the app');
});

test('sync: a queued tick goes out before the apps are read', async () => {
  // Ticked offline on Monday: Tuesday's first good sync closes it first, so no fresh copy lands on Tuesday
  const c = sandbox('2026-09-28T20:00:00', { store: { connections: { fake: { on: true } } } });
  stateApp(c, [{ rid: '1', title: 'Lab', due: '2026-09-28' }]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  c.__down = true;
  assert.equal(await run(c, `hwSetDone('2026-09-28', 'x-fake-1', true)`), 'queued');
  c.__setNow('2026-09-29T08:00:00'); c.__down = false;
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(idsOn(c, '2026-09-29').includes('x-fake-1'), false, 'no fresh copy');
  assert.deepEqual(structuredClone(c.__ticks), [['1', true]]);
  // Ticked, then unticked offline: the untick goes out first, and it ends up open in both places
  stateApp(c, [{ rid: '2', title: 'Poster', due: '2026-09-29' }]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  await run(c, `hwSetDone('2026-09-29', 'x-fake-2', true)`);
  c.__down = true;
  assert.equal(await run(c, `hwSetDone('2026-09-29', 'x-fake-2', false)`), 'queued');
  c.__down = false;
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.hwTasksByDay['2026-09-29'].find(t => t.id === 'x-fake-2').done, false, 'open here');
  assert.equal(c.__tasks[0].closed, false, 'open in the app');
});

test('sync: an imported task deleted here stays deleted, and one moved to another day isn’t put back', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { fake: { on: true } } } });
  stateApp(c, [{ rid: '1', title: 'Old worksheet', due: '2026-09-20' }, { rid: '2', title: 'Lab', due: '2026-09-28' }]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  await run(c, `hwRemoveTask('2026-09-28', 'x-fake-1')`);
  await run(c, `hwMoveTask('2026-09-28', 'x-fake-2', '2026-09-30')`);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.deepEqual(idsOn(c, '2026-09-28'), []);
  assert.deepEqual(idsOn(c, '2026-09-30'), ['x-fake-2']);
  c.__setNow('2026-09-29T08:00:00');
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.deepEqual(idsOn(c, '2026-09-29'), [], 'still overdue in the app, still gone here');
  c.__tasks[0].due = '2026-10-02';                               // a repeating task's next time comes in
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.deepEqual(idsOn(c, '2026-10-02'), ['x-fake-1']);
});

test('Canvas: finished items come back marked done, and unticking uses the mark made when ticking', async () => {
  const school = 'https://school.instructure.com', due = '2026-09-28T18:00:00Z';
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { canvas: { on: true, school, token: 'tok' } } } });
  const calls = []; let marked = false;
  const noLink = { headers: { get: () => null } };
  c.__route = async (url, opts) => {
    calls.push([opts.method || 'GET', url.replace(school + '/api/v1/', ''), opts.body ? JSON.parse(opts.body) : null]);
    if (url.includes('/planner/items')) return { ...gres(200, [
      { plannable_type: 'assignment', plannable_id: 11, plannable: { title: 'Lab report' }, plannable_date: due, context_name: 'Biology 11',
        ...(marked ? { planner_override: { id: 99, marked_complete: true } } : {}) },
      { plannable_type: 'quiz', plannable_id: 12, plannable: { title: 'Quiz 3' }, plannable_date: due, submissions: { submitted: true } }]), ...noLink };
    if (url.endsWith('/planner/overrides') && opts.method === 'POST') { marked = true; return { ...gres(200, { id: 99, marked_complete: true }), ...noLink }; }
    return { ...gres(200, {}), ...noLink };
  };
  const items = await run(c, `connApi('canvas').list({ school: '${school}', token: 'tok' }, new Date())`);
  assert.deepEqual(items.map(i => [i.rid, !!i.done]), [['assignment~11', false], ['quiz~12', true]]);
  await run(c, `hwSyncFromCalendar({ force: true })`);
  const ds = hwDueOf(c, due);
  await run(c, `hwSetDone('${ds}', 'x-canvas-assignment~11', true)`);
  await run(c, `hwSetDone('${ds}', 'x-canvas-assignment~11', false)`);
  assert.deepEqual(calls.filter(x => x[0] !== 'GET'), [
    ['POST', 'planner/overrides', { plannable_type: 'assignment', plannable_id: '11', marked_complete: true }],
    ['PUT', 'planner/overrides/99', { marked_complete: false }]]);
});

test('Microsoft To Do: a due date lands on its own day in any time zone', async () => {
  const was = process.env.TZ;
  try {
    for (const [tz, stored] of [['Europe/Berlin', '2026-10-01T22:00:00.0000000'], ['America/Los_Angeles', '2026-10-02T07:00:00.0000000'],
      ['Asia/Tokyo', '2026-10-01T15:00:00.0000000']]) {
      process.env.TZ = tz;                                       // To Do keeps a due day as that day's local midnight, in UTC
      const c = msSandbox();
      const route = c.__route;
      c.__route = async (url, opts) => url.includes('/me/todo/lists/A/tasks')
        ? gres(200, { value: [{ id: 'k1', title: 'Essay', dueDateTime: { dateTime: stored, timeZone: 'UTC' } }] }) : route(url, opts);
      await run(c, `mstodoConnect()`);
      const items = await run(c, `connApi('mstodo').list({ on: true, lists: {} }, new Date())`);
      assert.equal(items[0].due, '2026-10-02', tz);
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

test('a restored backup’s Canvas (no token, no site permission yet) asks for the token, not the internet', async () => {
  const c = sandbox('2026-09-28T12:00:00', { store: { connections: { canvas: { on: true, school: 'https://school.instructure.com' } } } });
  c.__route = async () => { throw new TypeError('Failed to fetch'); };
  await run(c, `hwSyncFromCalendar({ force: true })`);
  assert.equal(c.__data.connections.canvas.error, 'Canvas didn’t accept that token. Paste a new one.');
});

test('Microsoft To Do: the quiet sign-in waits through Microsoft’s redirects instead of stopping at the first page', async () => {
  const c = msSandbox({ connections: { mstodo: { on: true, account: 'sam@outlook.com' } } });
  const seen = [], auth = c.__auth;
  c.__auth = async o => { seen.push({ interactive: o.interactive, abort: o.abortOnLoadForNonInteractive }); return auth(o); };
  await run(c, `msToken()`);
  assert.deepEqual(seen, [{ interactive: false, abort: false }]);
});

// ── Settings as cards ───────────────────────────────────────────────────────

test('colours: a named colour or a hue gives dot and highlight values', () => {
  const c = sandbox('2026-09-28T12:00:00');
  assert.deepEqual(run(c, `nyColorCss('sky')`), { dot: 'var(--dot-sky)', hl: 'var(--hl-sky)' });
  const hue = run(c, `nyColorCss('h210')`);
  assert.match(hue.dot, /^light-dark\(hsl\(210 /);
  assert.match(hue.hl, /^light-dark\(hsl\(210 /);
  assert.deepEqual(run(c, `nyColorCss('nope')`), { dot: 'var(--dot-stone)', hl: 'var(--hl-stone)' });
  assert.equal(run(c, `nyHueOf('h7')`), 7);
  assert.equal(run(c, `nyHueOf('sky')`), null);
  assert.equal(run(c, `nyHueOf('h400')`), null);
});

test('messages: each site has its own, mixed with the everywhere ones, no repeats', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const cfg = run(c, `NY_CFG`);
  assert.ok(cfg.siteNotes.youtube.length >= 4 && cfg.siteNotes.tiktok.length >= 4, 'starters for built-in sites');
  assert.equal(cfg.lockNotes.some(n => /YouTube/.test(n)), false, 'everywhere says nothing site-specific');
  const kept = run(c, `nyNormalize({ siteNotes: { youtube: [] } }).siteNotes`);
  assert.deepEqual(kept.youtube, [], 'an emptied list stays empty');
  assert.ok(kept.reddit.length, 'missing ones get their starters');
  const mixed = run(c, `nyLockMessages({ lockNotes: ['a', 'b', 'c', 'd'], siteNotes: { tiktok: ['t1', 't2', 't3'] } }, 'tiktok', 6)`);
  assert.equal(mixed.length, 6);
  assert.equal(new Set(mixed).size, 6);
  assert.equal(mixed.filter(m => m.startsWith('t')).length, 3, 'up to half from the site');
  assert.deepEqual(run(c, `nyLockMessages({ lockNotes: ['a'], siteNotes: {} }, 'site-x', 6)`), ['a'], 'a site with none: everywhere only');
  assert.equal(run(c, `nyLockMessages({ lockNotes: [], siteNotes: { youtube: ['y1', 'y2'] } }, 'youtube', 6)`).length, 2, 'fills from whichever has some');
});

test('calendar links: each lands on its app’s card', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const app = u => run(c, `calFeedApp(${JSON.stringify(u)})`);
  assert.equal(app('https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics'), 'gcal');
  assert.equal(app('https://outlook.live.com/owa/calendar/1/2/calendar.ics'), 'outlook');
  assert.equal(app('https://outlook.office365.com/owa/calendar/a/b/reachcalendar.ics'), 'outlook');
  assert.equal(app('https://outlook.office.com/owa/calendar/a/b/calendar.ics'), 'outlook');
  assert.equal(app('https://school.instructure.com/feeds/calendars/user_abc.ics'), 'canvascal');
  assert.equal(app('https://app.schoology.com/calendar/feed/ical/123/abc/ical.ics'), 'schoology');
  assert.equal(app('webcal://p42-caldav.icloud.com/published/2/abc'), 'ical');
  assert.equal(app('https://notinstructure.com/x.ics'), 'ical', 'the whole name, not just its end');
  assert.equal(app('not a link'), 'ical');
});

// ── Stats ────────────────────────────────────────────────────────────────────

test('streaks: finished days in a row, rest days neither add nor break, today can still count', () => {
  const c = sandbox('2026-09-30T16:00:00');                       // Wednesday afternoon, not finished yet
  const d = { '2026-09-24': { total: 3 }, '2026-09-25': { total: 2 }, '2026-09-27': { total: 0 }, '2026-09-28': { total: 4 }, '2026-09-29': { total: 5 } };
  assert.deepEqual(run(c, `nyStreak(${JSON.stringify(d)}, '2026-09-30')`), { current: 2, best: 2 });   // 26th missing breaks it
  d['2026-09-26'] = { total: 1 };
  assert.deepEqual(run(c, `nyStreak(${JSON.stringify(d)}, '2026-09-30')`), { current: 5, best: 5 });   // the rest day on the 27th is skipped
  d['2026-09-30'] = { total: 2 };
  assert.equal(run(c, `nyStreak(${JSON.stringify(d)}, '2026-09-30').current`), 6);
  assert.deepEqual(run(c, `nyStreak({}, '2026-09-30')`), { current: 0, best: 0 });
});

test('finishing the list records the day once; bedtime never does', () => {
  const c = sandbox('2026-09-30T16:00:00');
  const done = { why: 'done', counts: { total: 3 } };
  const a = run(c, `nyRecordDone({}, ${JSON.stringify(done)}, new Date())`);
  assert.equal(a['2026-09-30'].total, 3);
  assert.equal(run(c, `nyRecordDone(${JSON.stringify(a)}, ${JSON.stringify(done)}, new Date())`), null, 'already recorded');
  const rest = run(c, `nyRecordDone({}, { why: 'done', counts: { total: 0 } }, new Date())`);
  assert.equal(rest['2026-09-30'].total, 0, 'nothing on the list yet: a rest day');
  assert.equal(run(c, `nyRecordDone(${JSON.stringify(rest)}, ${JSON.stringify(done)}, new Date())`)['2026-09-30'].total, 3, 'then work came in and got finished: it counts');
  assert.equal(run(c, `nyRecordDone({}, { why: 'bed', counts: { total: 3 } }, new Date())`), null);
  assert.equal(run(c, `nyRecordDone({}, { why: 'tasks', counts: { total: 3 } }, new Date())`), null);
  const old = { '2025-01-01': { total: 1 } };
  assert.equal('2025-01-01' in run(c, `nyRecordDone(${JSON.stringify(old)}, ${JSON.stringify(done)}, new Date())`), false, 'older than 400 days goes');
});

test('usual length: the median real time for a subject, from three timed tasks', () => {
  const c = sandbox('2026-09-30T16:00:00');
  const e = (date, course, actualMin) => ({ date, course, actualMin, estMin: 30, hourStarted: 16 });
  const log = [e('2026-09-20', 'math', 38), e('2026-09-22', 'math', 44), e('2026-09-25', 'science', 20)];
  assert.equal(run(c, `nyUsualLength(${JSON.stringify(log)}, 'math')`), null, 'two is too few');
  log.push(e('2026-09-28', 'math', 41), e('2026-06-01', 'math', 200));
  assert.equal(run(c, `nyUsualLength(${JSON.stringify(log)}, 'math')`), 40, 'median 41 → 40, the June one is too old');
  assert.equal(run(c, `nyUsualLength(${JSON.stringify(log)}, 'english')`), null);
});

test('the Sunday review: Sunday, or Monday if Sunday was missed; once; not in the first week', () => {
  const at = iso => sandbox(iso);
  assert.equal(run(at('2026-10-04T18:00:00'), `nyReviewWeek(new Date(), '', '2026-09-01')`), '2026-10-04');            // Sunday
  assert.equal(run(at('2026-10-05T08:00:00'), `nyReviewWeek(new Date(), '', '2026-09-01')`), '2026-10-04');            // Monday, unseen
  assert.equal(run(at('2026-10-05T08:00:00'), `nyReviewWeek(new Date(), '2026-10-04', '2026-09-01')`), null);          // seen
  assert.equal(run(at('2026-10-06T08:00:00'), `nyReviewWeek(new Date(), '', '2026-09-01')`), null);                    // Tuesday
  assert.equal(run(at('2026-10-04T18:00:00'), `nyReviewWeek(new Date(), '', '2026-10-01')`), null, 'installed this week');
  assert.deepEqual(run(at('2026-10-04T18:00:00'), `nyWeekRange('2026-10-04')`), { from: '2026-09-28', to: '2026-10-04' });
});

test('stats: minutes and tasks per subject, guesses, hours and eight weeks', () => {
  const c = sandbox('2026-09-30T16:00:00');
  const e = (date, course, estMin, actualMin, hourStarted = 16) => ({ date, course, estMin, actualMin, hourStarted, type: 'M', title: 'x' });
  const log = [e('2026-09-28', 'math', 30, 40), e('2026-09-29', 'math', 30, 36, 17), e('2026-09-30', 'math', 20, 30, 17),
    e('2026-09-29', 'english', 45, 45, 19), e('2026-09-22', 'math', 30, 60, 10)];
  const byDay = { '2026-09-28': [{ id: 'a', done: true }, { id: 'b', done: false }], '2026-09-30': [{ id: 'c', done: true }], '2026-09-20': [{ id: 'd', done: true }] };
  const s = run(c, `nyStats(${JSON.stringify(byDay)}, ${JSON.stringify(log)}, {}, { from: '2026-09-28', to: '2026-10-04' })`);
  assert.equal(s.minutes, 151);
  assert.equal(s.done, 2);
  assert.deepEqual(s.bySubject.map(x => [x.id, x.minutes, x.count]), [['math', 106, 3], ['english', 45, 1]]);
  const m = s.guesses.find(g => g.id === 'math');
  assert.deepEqual([m.est, m.act, m.n], [30, 36, 3]);
  assert.equal(Math.round(m.ratio * 10) / 10, 1.2);
  assert.equal(s.guesses.some(g => g.id === 'english'), false, 'one timed task is too few');
  assert.equal(s.hours[17], 2);
  assert.equal(s.weeks.length, 8);
  assert.equal(s.weeks.at(-1).minutes, 151);
  assert.equal(s.weeks.at(-2).minutes, 60);
});

// ── Focus help ───────────────────────────────────────────────────────────────

test('just start: a 5-minute countdown that turns into a stopwatch instead of finishing the task', async () => {
  const c = sandbox('2026-09-28T16:00:00', { store: { hwTasksByDay: { '2026-09-28': [{ id: 't1', title: 'Essay', estMin: 45, type: 'M', done: false, course: 'english' }] } } });
  const t = await run(c, `hwJustStart({ id: 't1', estMin: 45, type: 'M' }, '2026-09-28')`);
  assert.deepEqual([t.mode, t.totalMs, t.justStart, t.breakOffsets.length], ['down', 300000, true, 0]);
  assert.ok(c.__alarms['hwdone::t1'], 'an alarm at five minutes');
  c.__setNow('2026-09-28T16:05:00');
  await run(c, `hwTimerRanOut('t1')`);
  const after = c.__data.hwActiveTimers.t1;
  assert.deepEqual([after.mode, !!after.askKeepGoing, 'justStart' in after], ['up', true, false]);
  assert.equal(c.__data.hwTasksByDay['2026-09-28'][0].done, false, 'not finished by the clock');
  await run(c, `hwKeepGoing('t1', true)`);
  assert.equal('askKeepGoing' in c.__data.hwActiveTimers.t1, false);
  c.__setNow('2026-09-28T16:30:00');
  await run(c, `hwSetDone('2026-09-28', 't1', true)`);
  assert.equal(c.__data.hwLog.at(-1).actualMin, 30, 'the whole time is logged');
  await run(c, `hwJustStart({ id: 't1', estMin: 45, type: 'M' }, '2026-09-28')`);
  c.__setNow('2026-09-28T16:36:00');
  await run(c, `hwTimerRanOut('t1')`);
  await run(c, `hwKeepGoing('t1', false)`);
  assert.equal(c.__data.hwActiveTimers.t1, undefined, 'stop here: the clock goes');
});

test('steps: the next one, how many, and saving them keeps a calendar task unedited', async () => {
  const c = sandbox('2026-09-28T16:00:00', { store: { hwTasksByDay: { '2026-09-28': [{ id: 'cal-1', title: 'Essay', estMin: 45, type: 'M', done: false }] } } });
  assert.deepEqual(run(c, `nyNextStep([])`), { step: null, index: -1, done: 0, total: 0 });
  const steps = [{ id: 'a', text: 'Outline', done: true }, { id: 'b', text: 'Draft', done: false }, { id: 'c', text: 'Edit', done: false }];
  assert.deepEqual(run(c, `nyNextStep(${JSON.stringify(steps)})`), { step: steps[1], index: 1, done: 1, total: 3 });
  assert.equal(run(c, `nyNextStep(${JSON.stringify(steps.map(s => ({ ...s, done: true })))})`).step, null);
  await run(c, `hwSetSteps('2026-09-28', 'cal-1', ${JSON.stringify(steps)})`);
  const t = c.__data.hwTasksByDay['2026-09-28'][0];
  assert.equal(t.steps.length, 3);
  assert.equal('edited' in t, false, 'the calendar can still update it');
});

test('focus sounds play only while a timer is running, not paused or on a break', () => {
  const c = sandbox('2026-09-28T16:00:00');
  const now = new Date('2026-09-28T16:00:00').getTime();
  const run1 = { startedAt: now - 60000, mode: 'up', pausedMs: 0, totalMs: 0, breakOffsets: [] };
  const on = { focusSound: 'rain', focusVolume: .5 };
  assert.equal(run(c, `nySoundFor({}, ${JSON.stringify(on)}, ${now})`), null, 'no timer');
  assert.equal(run(c, `nySoundFor({ a: ${JSON.stringify(run1)} }, { focusSound: 'off' }, ${now})`), null, 'off');
  assert.equal(run(c, `nySoundFor({ a: ${JSON.stringify(run1)} }, ${JSON.stringify(on)}, ${now})`), 'rain');
  assert.equal(run(c, `nySoundFor({ a: ${JSON.stringify({ ...run1, pausedAt: now - 1000 })} }, ${JSON.stringify(on)}, ${now})`), null, 'paused');
  const brk = { startedAt: now - 26 * 60000, mode: 'down', pausedMs: 0, totalMs: 60 * 60000, breakOffsets: [25 * 60000] };
  assert.equal(run(c, `nySoundFor({ a: ${JSON.stringify(brk)} }, ${JSON.stringify(on)}, ${now})`), null, 'on a break');
  assert.equal(run(c, `nySoundFor({ a: ${JSON.stringify({ ...run1, pausedAt: now })}, b: ${JSON.stringify(run1)} }, ${JSON.stringify(on)}, ${now})`), 'rain', 'one of two running');
  assert.equal(run(c, `nyNormalize({}).focusSound`), 'off');
  assert.equal(run(c, `nyNormalize({ focusSound: 'jazz', focusVolume: 7 }).focusVolume`), 1);
});

// ── Stats: what the final review found ──────────────────────────────────────

test('the install date is kept: a fresh install gets today, an older one its earliest day, and the review can come', async () => {
  const fresh = sandbox('2026-09-28T12:00:00');
  await run(fresh, `hwEnsureInstallDate()`);
  assert.equal(fresh.__data.hwSettings.installDate, '2026-09-28');
  const older = sandbox('2026-10-04T18:00:00', { store: { hwTasksByDay: { '2026-09-20': [{ id: 'a', done: true }] }, hwLog: [{ date: '2026-09-14', actualMin: 20 }] } });
  await run(older, `hwEnsureInstallDate()`);
  assert.equal(older.__data.hwSettings.installDate, '2026-09-14', 'the earliest day anything was stored');
  assert.equal(await run(older, `getHwState().then(hw => nyReviewWeek(new Date(), '', hw.hwSettings.installDate))`), '2026-10-04', 'Sunday: the review comes');
  const kept = sandbox('2026-10-04T18:00:00', { store: { hwSettings: { phaseMode: 'auto', installDate: '2026-08-01' } } });
  await run(kept, `hwEnsureInstallDate()`);
  assert.deepEqual(structuredClone(kept.__data.hwSettings), { phaseMode: 'auto', installDate: '2026-08-01' });
});

test('a rest day stops being one when work comes in and isn’t finished', () => {
  const c = sandbox('2026-09-30T16:00:00');
  const rest = run(c, `nyRecordDone({}, { why: 'done', counts: { total: 0, left: 0 } }, new Date())`);
  const after = run(c, `nyRecordDone(${JSON.stringify(rest)}, { why: 'tasks', counts: { total: 2, left: 1 } }, new Date())`);
  assert.ok(after && !('2026-09-30' in after), 'work came in, not finished: no record for today');
  assert.equal(run(c, `nyRecordDone(${JSON.stringify(rest)}, { why: 'bed', counts: { total: 2, left: 1 } }, new Date())`)['2026-09-30'], undefined, 'bedtime with work left');
  assert.equal(run(c, `nyRecordDone(${JSON.stringify(rest)}, { why: 'tasks', counts: { total: 0, left: 0 } }, new Date())`), null, 'still nothing on it: unchanged');
});

test('a day the computer stayed off with nothing on the list is a rest day, not a break', () => {
  const c = sandbox('2026-10-05T16:00:00');                       // Monday afternoon
  const days = { '2026-09-29': { total: 3 }, '2026-09-30': { total: 2 }, '2026-10-01': { total: 4 }, '2026-10-02': { total: 3 } };
  const filled = run(c, `nyRestDays(${JSON.stringify(days)}, ds => ds === '2026-10-03' || ds === '2026-10-04', '2026-10-05')`);
  assert.deepEqual([filled['2026-10-03'], filled['2026-10-04']].map(d => d.total), [0, 0]);
  assert.equal(run(c, `nyStreak(${JSON.stringify(filled)}, '2026-10-05').current`), 4);
  const busy = run(c, `nyRestDays(${JSON.stringify(days)}, ds => ds === '2026-10-04', '2026-10-05')`);
  assert.equal('2026-10-03' in busy, false, 'Saturday had something on it: it stays a gap');
  assert.equal(run(c, `nyRestDays({}, () => true, '2026-10-05')`), null, 'nothing recorded yet: nothing to fill');
});

// ── Test countdown ───────────────────────────────────────────────────────────

test('tests: which titles are tests', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const is = t => run(c, `nyIsTest(${JSON.stringify(t)})`);
  for (const t of ['Math unit test', 'Chem quiz', 'French exam', 'History midterm', 'Bio finals', 'Final exam: English', 'Science assessment', 'Quizzes 3-4'])
    assert.equal(is(t), true, t);
  for (const t of ['Unit test study', 'Quiz review', 'Exam prep', 'Final draft due', 'Test drive', 'Band practice', 'Contest entry'])
    assert.equal(is(t), false, t);
});

test('study days: the days just before the test, from today, never on it', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const days = (t, n) => run(c, `nyStudyDays('${t}', '2026-09-28', ${n})`);
  assert.deepEqual(days('2026-10-01', 3), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(days('2026-10-05', 3), ['2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(days('2026-10-01', 5), ['2026-09-28', '2026-09-29', '2026-09-30'], 'fewer if there isn’t room');
  assert.deepEqual(days('2026-09-29', 3), ['2026-09-28'], 'tomorrow: one, today');
  assert.deepEqual(days('2026-09-28', 3), [], 'today: none');
  assert.deepEqual(days('2026-09-20', 3), [], 'past');
});

test('the next test: soonest first, skipped ones hidden, planned ones count their sessions', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const tests = [{ key: 'b|2026-10-05', title: 'History test', ds: '2026-10-05', color: 'sky' },
    { key: 'a|2026-10-01', title: 'Chem quiz', ds: '2026-10-01', color: 'mint' },
    { key: 'z|2026-11-20', title: 'Far exam', ds: '2026-11-20', color: 'pink' }];
  const next = (plans, byDay = {}) => run(c, `nyNextTest(${JSON.stringify(tests)}, ${JSON.stringify(plans)}, ${JSON.stringify(byDay)}, '2026-09-28')`);
  const a = next({});
  assert.deepEqual([a.title, a.daysLeft, a.plan], ['Chem quiz', 3, null]);
  assert.equal(next({ 'a|2026-10-01': 'skip' }).title, 'History test');
  const byDay = { '2026-09-28': [{ id: 's1', studyFor: 'a|2026-10-01', done: true }], '2026-09-29': [{ id: 's2', studyFor: 'a|2026-10-01', done: false }] };
  const p = next({ 'a|2026-10-01': { at: 1, n: 2, min: 25 } }, byDay);
  assert.deepEqual([p.studyDone, p.studyTotal, !!p.plan], [1, 2, true]);
  assert.equal(next({ 'a|2026-10-01': 'skip', 'b|2026-10-05': 'skip' }), null, 'the far one is past two weeks');
});

// ── Focus: what the final review found ──────────────────────────────────────

test('the store package carries every file the extension loads', () => {
  const read = f => readFileSync(join(root, f), 'utf8');
  const zipLine = read('dev/build.sh').split('\n').find(l => l.startsWith('zip -qr'));
  const packed = zipLine.replace(/^zip -qr "\$OUT" /, '').replace(/ -x .*$/, '').trim().split(/\s+/);
  const covered = f => packed.some(p => f === p || f.startsWith(p + '/'));
  const bg = read('background.js');
  const refs = [
    ...[...bg.matchAll(/importScripts\(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])),
    ...[...bg.matchAll(/url: '([^']+\.html)'/g)].map(m => m[1]),
    ...[...read('offscreen.html').matchAll(/src="([^"]+)"/g)].map(m => m[1]),
    ...[...read('offscreen.js').matchAll(/addModule\('([^']+)'\)/g)].map(m => m[1]),
    ...(JSON.stringify(JSON.parse(read('manifest.json'))).match(/[\w/.-]+\.(?:js|html|css|png)/g) || []),
  ];
  assert.deepEqual([...new Set(refs)].filter(f => !covered(f)), [], 'files the extension loads but the zip leaves out');
});

// ── Test countdown: what the final review found ─────────────────────────────

test('a test that moves day keeps its study plan and sessions', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const tests = [{ key: 'math unit test|2026-10-02', title: 'Math unit test', ds: '2026-10-02', color: 'sky' }];
  const plans = { 'math unit test|2026-10-01': { at: 1, n: 2, min: 25 } };
  const byDay = { '2026-09-29': [{ id: 's1', studyFor: 'math unit test|2026-10-01', done: true }], '2026-09-30': [{ id: 's2', studyFor: 'math unit test|2026-10-01', done: false }] };
  const t = run(c, `nyNextTest(${JSON.stringify(tests)}, ${JSON.stringify(plans)}, ${JSON.stringify(byDay)}, '2026-09-28')`);
  assert.ok(t.plan, 'the plan follows it');
  assert.deepEqual([t.studyDone, t.studyTotal], [1, 2]);
});

test('study sessions don’t carry past their test', () => {
  const c = sandbox('2026-10-02T08:00:00');
  const byDay = { '2026-09-30': [{ id: 's1', title: 'Study: Chem quiz', studyFor: 'chem quiz|2026-10-01', done: false },
    { id: 'w1', title: 'Worksheet', done: false }] };
  const out = run(c, `(() => { const b = ${JSON.stringify(byDay)}; hwCarryOver(b, {}, '2026-10-02'); return b; })()`);
  assert.deepEqual((out['2026-10-02'] || []).map(t => t.id), ['w1'], 'the worksheet carries, the study session for a past test doesn’t');
});

test('exam weeks: once the next test is planned or today, the one after it comes along as “after”', () => {
  const c = sandbox('2026-09-28T12:00:00');
  const tests = [{ key: 'math test|2026-10-01', title: 'Math test', ds: '2026-10-01', color: 'sky' },
    { key: 'chem quiz|2026-10-02', title: 'Chem quiz', ds: '2026-10-02', color: 'mint' },
    { key: 'french exam|2026-10-03', title: 'French exam', ds: '2026-10-03', color: 'pink' }];
  const next = (plans, today = '2026-09-28') => run(c, `nyNextTest(${JSON.stringify(tests)}, ${JSON.stringify(plans)}, {}, '${today}')`);
  assert.equal(next({}).after, null, 'the first still needs planning: nothing more');
  const planned = next({ 'math test|2026-10-01': { at: 1, n: 3, min: 25 } });
  assert.deepEqual([planned.title, planned.after.title, planned.after.daysLeft], ['Math test', 'Chem quiz', 4]);
  assert.equal(next({ 'math test|2026-10-01': { at: 1 }, 'chem quiz|2026-10-02': 'skip' }).after.title, 'French exam', 'skipped ones stay hidden');
  assert.equal(next({ 'math test|2026-10-01': { at: 1 }, 'chem quiz|2026-10-02': { at: 1 } }).after.title, 'French exam', 'planned ones too');
  assert.equal(next({}, '2026-10-01').after.title, 'Chem quiz', 'the first is today');
});
