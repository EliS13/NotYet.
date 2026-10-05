// core.js — habits, tasks, timers, the calendar sync and the YouTube gate.
// Loaded by the background worker and every page (after config.js, night.js
// and ics.js). Storage keys are the same ones v5 used, so an update in place
// keeps everything.
//
//   Habits  tasks: [{name, duration, days[Mon..Sun], durationWeeks?, startDate?}]
//           weeks: { '2026-W39': { name: [Mon..Sun booleans] } }
//   Tasks   hwTasksByDay: { 'YYYY-MM-DD': [{id, title, course, estMin, type, done, ...}] }
//   Timers  activeTimers (habits, by name), hwActiveTimers (tasks, by id)

// ── Dates ────────────────────────────────────────────────────────────────────

const hwTodayStr = nyDateStr;
const nyParseDs = ds => new Date(ds + 'T00:00:00');
const nyDayIdx = d => (d.getDay() + 6) % 7;            // Mon = 0 … Sun = 6
const todayDayIdx = () => nyDayIdx(new Date());

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThu = Date.UTC(d.getUTCFullYear(), 0, 4);
  const wn = 1 + Math.round((d.getTime() - firstThu) / 604800000);
  return `${d.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

// ── Habits ───────────────────────────────────────────────────────────────────

async function getStorage() {
  const raw = await chrome.storage.local.get({
    tasks: [], taskNames: [], weeks: {}, taskDurations: {}, activeTimers: {}
  });
  // One-time move from the very first format (a plain list of names).
  if (raw.taskNames && raw.taskNames.length > 0 && raw.tasks.length === 0) {
    raw.tasks = raw.taskNames.map(name => ({
      name, duration: (raw.taskDurations && raw.taskDurations[name]) || null, days: Array(7).fill(true)
    }));
    await chrome.storage.local.set({ tasks: raw.tasks, taskNames: [], taskDurations: {} });
  }
  if (!raw.tasks) raw.tasks = [];
  return raw;
}

const isScheduledOn = (habit, dayIdx) => !habit.days || habit.days[dayIdx] !== false;

// A habit with a start date and a length in weeks only runs inside that window.
function isTaskActive(habit, date = new Date()) {
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  if (habit.startDate && day < nyParseDs(habit.startDate)) return false;
  if (!habit.durationWeeks || !habit.startDate) return true;
  const end = nyParseDs(habit.startDate); end.setDate(end.getDate() + habit.durationWeeks * 7);
  return day < end;
}

function habitsOn(tasks, date) {
  const col = nyDayIdx(date);
  return (tasks || []).filter(h => h.name && h.name.trim() && isScheduledOn(h, col) && isTaskActive(h, date));
}

function habitDoneOn(weeks, name, date) {
  const wk = weeks[getWeekKey(date)];
  return !!(wk && wk[name] && wk[name][nyDayIdx(date)]);
}

async function setHabitDone(name, date, value) {
  const { weeks } = await chrome.storage.local.get({ weeks: {} });
  const wk = getWeekKey(date), col = nyDayIdx(date);
  if (!weeks[wk]) weeks[wk] = {};
  if (!weeks[wk][name]) weeks[wk][name] = Array(7).fill(false);
  weeks[wk][name][col] = value;
  await chrome.storage.local.set({ weeks });
  return weeks;
}

const autoCompleteTask = name => setHabitDone(name, new Date(), true);

function isTodayComplete(tasks, weeks, now = new Date()) {
  return habitsOn(tasks, now).every(h => habitDoneOn(weeks, h.name, now));
}

// Renaming a habit carries its history along.
async function renameHabit(oldName, newName) {
  newName = (newName || '').trim();
  const { tasks, weeks, activeTimers } = await getStorage();
  if (!newName || newName === oldName || tasks.some(h => h.name === newName)) return false;
  const h = tasks.find(x => x.name === oldName);
  if (!h) return false;
  h.name = newName;
  for (const wk of Object.keys(weeks)) {
    if (weeks[wk][oldName] !== undefined) { weeks[wk][newName] = weeks[wk][oldName]; delete weeks[wk][oldName]; }
  }
  if (activeTimers[oldName]) {
    activeTimers[newName] = activeTimers[oldName]; delete activeTimers[oldName];
    await chrome.alarms.clear('timer::' + oldName);
    nyArmHabit(newName, activeTimers[newName]);
  }
  await chrome.storage.local.set({ tasks, weeks, activeTimers });
  return true;
}

async function deleteHabit(name) {
  const { tasks, weeks, activeTimers } = await getStorage();
  await chrome.alarms.clear('timer::' + name);
  delete activeTimers[name];
  for (const wk of Object.keys(weeks)) delete weeks[wk][name];
  await chrome.storage.local.set({ tasks: tasks.filter(h => h.name !== name), weeks, activeTimers });
}

async function saveHabit(name, patch) {
  const { tasks } = await getStorage();
  const h = tasks.find(x => x.name === name);
  if (!h) return;
  Object.assign(h, patch);
  await chrome.storage.local.set({ tasks });
}

async function addHabit({ name, duration = null, days = Array(7).fill(true), durationWeeks = null }) {
  name = (name || '').trim();
  const { tasks } = await getStorage();
  if (!name || tasks.some(h => h.name === name)) return false;
  tasks.push({ name, duration: duration > 0 ? duration : null, days, durationWeeks: durationWeeks > 0 ? durationWeeks : null,
    startDate: hwTodayStr() });
  await chrome.storage.local.set({ tasks });
  return true;
}

// ── Habit timers ─────────────────────────────────────────────────────────────
// activeTimers[name] = { startedAt, durationMs, pausedAt?, pausedMs }

const nyElapsed = (t, now = Date.now()) => Math.max(0, (t.pausedAt || now) - t.startedAt - (t.pausedMs || 0));
const habitLeftMs = (t, now = Date.now()) => Math.max(0, t.durationMs - nyElapsed(t, now));

function nyArmHabit(name, t) {
  if (t.pausedAt) return;
  chrome.alarms.create('timer::' + name, { when: Math.max(Date.now() + 500, t.startedAt + (t.pausedMs || 0) + t.durationMs) });
}

async function startHabitTimer(name, minutes) {
  const { activeTimers } = await chrome.storage.local.get({ activeTimers: {} });
  activeTimers[name] = { startedAt: Date.now(), durationMs: minutes * 60000, pausedMs: 0 };
  nyArmHabit(name, activeTimers[name]);
  await chrome.storage.local.set({ activeTimers });
}

async function stopHabitTimer(name) {
  const { activeTimers } = await chrome.storage.local.get({ activeTimers: {} });
  await chrome.alarms.clear('timer::' + name);
  delete activeTimers[name];
  await chrome.storage.local.set({ activeTimers });
}

async function pauseHabitTimer(name, pause) {
  const { activeTimers } = await chrome.storage.local.get({ activeTimers: {} });
  const t = activeTimers[name];
  if (!t) return;
  if (pause && !t.pausedAt) { t.pausedAt = Date.now(); await chrome.alarms.clear('timer::' + name); }
  if (!pause && t.pausedAt) { t.pausedMs = (t.pausedMs || 0) + Date.now() - t.pausedAt; delete t.pausedAt; nyArmHabit(name, t); }
  await chrome.storage.local.set({ activeTimers });
}

// ── Tasks (homework) ─────────────────────────────────────────────────────────

const HW_WORK_SEG = 25 * 60 * 1000;   // a countdown longer than 45 min runs as 25-minute blocks
const HW_BREAK_MS = 5 * 60 * 1000;    // with a 5-minute YouTube break between them
const HW_POMODORO_THRESHOLD = 45;
const HW_CALIBRATION_DAYS = 14;
const HW_SYNC_THROTTLE_MS = 10 * 60 * 1000;
const HW_KEEP_DAYS = 30;
const NY_PLAN_AHEAD = 14;              // calendar tasks show up this many days early
const NY_SCHOOL_LOOKAHEAD = 21;

// Which dates have classes, from the calendar. Empty unless a class mark is set.
let HW_SCHOOL_DAYS = {};

// When Not yet. was installed, kept for good (the Sunday review skips the first
// week). Installs from before it was stored use the earliest day anything was saved.
async function hwEnsureInstallDate() {
  const s = await chrome.storage.local.get({ hwSettings: null, hwTasksByDay: {}, hwLog: [], nyDoneDays: {} });
  if (s.hwSettings && s.hwSettings.installDate) return s.hwSettings.installDate;
  const today = hwTodayStr();
  const seen = [...Object.keys(s.hwTasksByDay), ...s.hwLog.map(r => r && r.date), ...Object.keys(s.nyDoneDays)]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d < today).sort();
  const installDate = seen[0] || today;
  await chrome.storage.local.set({ hwSettings: { icsUrl: '', phaseMode: 'target', ...(s.hwSettings || {}), installDate } });
  return installDate;
}

async function getHwState() {
  const raw = await chrome.storage.local.get({
    hwSettings: { icsUrl: '', phaseMode: 'target', installDate: hwTodayStr() },
    hwTasksByDay: {},
    hwLog: [],
    breakUntil: 0,
    hwSchoolDays: { computedAt: 0, days: {} },
  });
  HW_SCHOOL_DAYS = (raw.hwSchoolDays && raw.hwSchoolDays.days) || {};
  return raw;
}

// 'calibration' = every timer is a stopwatch, to learn how long things take.
function hwPhase(s) {
  if (s.phaseMode === 'calibration' || s.phaseMode === 'target') return s.phaseMode;
  const start = nyParseDs(s.installDate || hwTodayStr());
  return (Date.now() - start.getTime()) / 86400000 < HW_CALIBRATION_DAYS ? 'calibration' : 'target';
}

const hwTasksOn = (hw, ds = hwTodayStr()) => hw.hwTasksByDay[ds] || [];
const hwTasksToday = hwTasksOn;
const hwCourse = id => nySubject(id);
const hwGuessCourse = (title, hint) => nyGuessSubject(title, hint);

function hwTaskFromEvent(ev) {
  const tagged = nyParseTitle(ev.summary);
  if (tagged) return tagged;
  if (nyIsBlock(ev.summary)) {
    const dur = ev.end && ev.start && !ev.allDay ? Math.round((ev.end - ev.start) / 60000) : 60;
    return { title: ev.summary.trim(), estMin: Math.max(15, dur), type: 'M', block: true, courseHint: '' };
  }
  return null;
}

// webcal:// links are the same feed over https.
function nyFeedUrl(url) {
  url = String(url || '').trim();
  if (!url) return '';
  return url.replace(/^webcal:\/\//i, 'https://');
}

const nyOriginPattern = url => { try { return new URL(nyFeedUrl(url)).origin + '/*'; } catch { return null; } };

// Brings every connected calendar up to date, then plans the next two weeks'
// tasks from events that start with a tag (or are homework blocks) and works
// out which days are school days. Events saved in Not yet. only don't count:
// they're plans, not homework. Throttled unless forced.
async function hwSyncFromCalendar({ force = false } = {}) {
  if (!(await calAnySource()) && !(await connAny())) return null;
  const { hwLastSync = 0 } = await chrome.storage.local.get({ hwLastSync: 0 });
  if (!force && Date.now() - hwLastSync < HW_SYNC_THROTTLE_MS) return 0;
  await nyLoadConfig();
  await calRefreshSources({ force });
  await connRetryTicks().catch(() => {});             // first, so what the apps say next already has them
  await connRefresh({ force }).catch(() => {});

  const now = new Date(), today = hwTodayStr(now);
  const planEnd = hwTodayStr(nyAddDays(now, NY_PLAN_AHEAD - 1));
  const raw = await calLoadRaw();
  // Read the list only now: ticks and new tasks made while calendars loaded must not be written over
  const hw = await getHwState();
  const { hwDismissed = {}, connDismissed = {}, hwActiveTimers = {} } = await chrome.storage.local.get({ hwDismissed: {}, connDismissed: {}, hwActiveTimers: {} });
  const events = calCollect(raw, hwTodayStr(nyAddDays(now, -1)), hwTodayStr(nyAddDays(now, NY_SCHOOL_LOOKAHEAD)))
    .filter(ev => ev.source !== 'local');
  const wanted = {}, classDays = {};
  const marksClasses = !!String(NY_CFG.classMark || '').trim();

  for (const ev of events) {
    const tmpl = hwTaskFromEvent(calAsIcs(ev));
    const isClass = marksClasses && nyIsClass(ev.title);
    for (const ds of calDaysOf(ev)) {
      if (isClass) classDays[ds] = true;
      if (tmpl && ds >= today && ds <= planEnd) (wanted[ds] || (wanted[ds] = [])).push({ id: 'cal-' + (ev.uid || ev.seriesId), tmpl });   // a link's seriesId is its UID
    }
  }
  // Other apps' tasks: on their due day, overdue ones on today. One deleted or
  // moved here stays out while the app has it on that same due day.
  const conn = await connCollect(now);
  const appKey = (id, due) => `${id}|${due}`;
  for (const it of conn.items) {
    const ds = it.due < today ? today : it.due;
    if (ds > planEnd) continue;
    (wanted[ds] || (wanted[ds] = [])).push({ id: it.id, tmpl: connTemplate(it), hint: it.hint, key: appKey(it.id, it.due),
      extra: { src: it.app, appDue: it.due, ...(it.due < today ? { carriedFrom: it.due } : {}) } });
  }
  const stillThere = new Set(conn.items.map(it => appKey(it.id, it.due)));
  for (const k of Object.keys(connDismissed)) {
    const p = connIdParts(k.split('|')[0]);
    if (!p || (conn.live.has(p.app) && !stillThere.has(k))) delete connDismissed[k];
  }
  const fromLiveApp = t => { const p = connIdParts(t.id); return !!p && conn.live.has(p.app); };

  let added = 0;
  for (let i = 0; i < NY_PLAN_AHEAD; i++) {
    const ds = hwTodayStr(nyAddDays(now, i));
    let list = hw.hwTasksByDay[ds] || [];
    const want = wanted[ds] || [];
    const gone = new Set(hwDismissed[ds] || []);
    if (ds > today) {
      // Ahead of time the calendar and the apps are the source of truth: a task
      // that left them leaves the plan, unless it's been started, finished or edited.
      list = list.filter(t => !(t.id.startsWith('cal-') || fromLiveApp(t)) || t.done || t.edited ||
        (hwActiveTimers[t.id] && hwActiveTimers[t.id].taskDate === ds) || want.some(w => w.id === t.id));
      for (const t of list) {
        const w = want.find(x => x.id === t.id);
        if (w && !t.done && !t.edited) Object.assign(t, { title: w.tmpl.title, estMin: w.tmpl.estMin, type: w.tmpl.type,
          course: hwGuessCourse(w.tmpl.title, w.tmpl.courseHint || nyFindSubject(w.hint || '') || '') });
      }
    } else {
      // Today stays as shown, except a task its app says was finished is ticked here too
      for (const t of list) if (!t.done && conn.done.has(t.id)) t.done = true;
    }
    for (const w of want) {
      if (gone.has(w.id) || (w.key && connDismissed[w.key]) || list.some(t => t.id === w.id)) continue;
      list.push({ id: w.id, title: w.tmpl.title, course: hwGuessCourse(w.tmpl.title, w.tmpl.courseHint || nyFindSubject(w.hint || '') || ''),
        estMin: w.tmpl.estMin, type: w.tmpl.type, done: false, ...(w.tmpl.block ? { block: true } : {}), ...(w.extra || {}) });
      if (ds === today) added++;
    }
    if (list.length) hw.hwTasksByDay[ds] = list; else delete hw.hwTasksByDay[ds];
  }

  const days = {};
  if (marksClasses) for (let i = -1; i <= NY_SCHOOL_LOOKAHEAD; i++) {
    const ds = hwTodayStr(nyAddDays(now, i));
    days[ds] = !!classDays[ds];
  }
  HW_SCHOOL_DAYS = days;
  hwPruneOldDays(hw.hwTasksByDay);
  const feedError = raw.calFeeds.filter(f => f.on).map(f => (raw.feedCache[f.id] || {}).error).find(Boolean) || '';
  await chrome.storage.local.set({
    hwLastSync: Date.now(), hwLastSyncError: feedError, hwTasksByDay: hw.hwTasksByDay, connDismissed,
    hwSchoolDays: { computedAt: Date.now(), days },
  });
  return added;
}

function hwPruneOldDays(byDay) {
  const floor = hwTodayStr(nyAddDays(new Date(), -HW_KEEP_DAYS));
  for (const ds of Object.keys(byDay)) if (ds < floor) delete byDay[ds];
}

// A calendar or app task removed by hand stays removed, or the next sync would
// put it back. An app's task (`t`, as it was) is kept out by its id and due day,
// not the day it sat on: an overdue one lands on a new today each day, and a
// repeating one's next time should still come in.
async function hwDismiss(id, ds, t = null) {
  if (id.startsWith('x-')) {
    const { connDismissed = {} } = await chrome.storage.local.get({ connDismissed: {} });
    connDismissed[`${id}|${(t && (t.appDue || t.carriedFrom)) || ds}`] = true;
    await chrome.storage.local.set({ connDismissed });
    return;
  }
  if (!id.startsWith('cal-')) return;
  const { hwDismissed = {} } = await chrome.storage.local.get({ hwDismissed: {} });
  const list = hwDismissed[ds] || (hwDismissed[ds] = []);
  if (!list.includes(id)) list.push(id);
  const today = hwTodayStr();
  for (const d of Object.keys(hwDismissed)) if (d < today) delete hwDismissed[d];
  await chrome.storage.local.set({ hwDismissed });
}

// Timestamp for the next 00:05, just after the day rolls over.
function hwNextMorning(from = new Date()) {
  const d = nyAddDays(from, 1);
  d.setHours(0, 5, 0, 0);
  return d.getTime();
}

const hwSyncedToday = last => last > 0 && hwTodayStr(new Date(last)) === hwTodayStr();

// Pages left open across midnight reload so they never show yesterday as today.
function hwWatchForMidnight() {
  const boot = hwTodayStr();
  setInterval(() => { if (hwTodayStr() !== boot) location.reload(); }, 30 * 1000);
}

// ── Leftovers carry into today ───────────────────────────────────────────────
// Anything not done moves into today's list, tagged with the day it was due.
// Recurring blocks don't: a missed time slot isn't a piece of work.

const hwIsSessionTitle = title => nyIsBlock(title);

function hwCarryOver(byDay, timers = {}, today = hwTodayStr()) {
  const dest = byDay[today] || (byDay[today] = []);
  let moved = 0;
  for (const ds of Object.keys(byDay).sort()) {
    if (ds >= today) continue;
    const stay = [];
    for (const t of byDay[ds]) {
      const pastTest = t.studyFor && t.studyFor.slice(t.studyFor.lastIndexOf('|') + 1) < today;   // studying for a test that's been
      if (t.done || t.block || hwIsSessionTitle(t.title) || pastTest) { stay.push(t); continue; }
      if (!dest.some(x => x.id === t.id)) {
        dest.push({ ...t, carriedFrom: t.carriedFrom || ds });
        if (timers[t.id]) timers[t.id].taskDate = today;
        moved++;
      }
    }
    if (stay.length) byDay[ds] = stay; else delete byDay[ds];
  }
  if (!dest.length) delete byDay[today];
  else dest.sort((a, b) => (a.carriedFrom ? 0 : 1) - (b.carriedFrom ? 0 : 1));
  return moved;
}

async function hwRollForward() {
  const hw = await getHwState();
  const timers = await getHwTimers();
  const { hwLastRoll = '' } = await chrome.storage.local.get({ hwLastRoll: '' });
  const today = hwTodayStr();
  const moved = hwCarryOver(hw.hwTasksByDay, timers, today);
  if (moved || hwLastRoll !== today) {
    await chrome.storage.local.set({ hwTasksByDay: hw.hwTasksByDay, hwActiveTimers: timers, hwLastRoll: today });
  }
  return moved;
}

function hwDaysLate(task, today = hwTodayStr()) {
  if (!task.carriedFrom) return 0;
  return Math.round((nyParseDs(today) - nyParseDs(task.carriedFrom)) / 86400000);
}

// "From yesterday", "From Tue", "From Sep 14"
function hwCarriedLabel(task) {
  if (task.src && task.carriedFrom) return 'From ' + connName(task.src);   // overdue in another app
  const n = hwDaysLate(task);
  if (n <= 0) return '';
  if (n === 1) return 'From yesterday';
  return 'From ' + nyParseDs(task.carriedFrom).toLocaleDateString(undefined,
    n < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}

// ── Editing tasks ────────────────────────────────────────────────────────────

async function hwMutate(fn) {
  const hw = await getHwState();
  const timers = await getHwTimers();
  const extra = (await fn(hw, timers)) || {};
  await chrome.storage.local.set({ hwTasksByDay: hw.hwTasksByDay, hwLog: hw.hwLog, hwActiveTimers: timers, ...extra });
}

async function hwAddTask(ds, { title, estMin = 30, type = 'M', course = null, studyFor = null }) {
  title = (title || '').trim();
  if (!title) return;
  await hwMutate(hw => {
    const list = hw.hwTasksByDay[ds] || (hw.hwTasksByDay[ds] = []);
    list.push({ id: 'man-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title,
      course: course || hwGuessCourse(title), estMin: Math.max(1, Math.round(estMin) || 30),
      type: type === 'Q' ? 'Q' : 'M', done: false, ...(studyFor ? { studyFor } : {}) });
  });
}

async function hwEditTask(ds, id, patch) {
  await hwMutate(hw => {
    const t = (hw.hwTasksByDay[ds] || []).find(x => x.id === id);
    if (t) Object.assign(t, patch, { edited: true });
  });
}

async function hwRemoveTask(ds, id) {
  await hwStopTimer(id);
  let was = null;
  await hwMutate(hw => {
    was = (hw.hwTasksByDay[ds] || []).find(x => x.id === id) || null;
    hw.hwTasksByDay[ds] = (hw.hwTasksByDay[ds] || []).filter(x => x.id !== id);
    if (!hw.hwTasksByDay[ds].length) delete hw.hwTasksByDay[ds];
  });
  await hwDismiss(id, ds, was);
}

async function hwMoveTask(ds, id, toDs) {
  if (ds === toDs) return;
  await hwStopTimer(id);
  let was = null;
  await hwMutate(hw => {
    const list = hw.hwTasksByDay[ds] || [];
    const t = was = list.find(x => x.id === id);
    if (!t) return;
    hw.hwTasksByDay[ds] = list.filter(x => x !== t);
    if (!hw.hwTasksByDay[ds].length) delete hw.hwTasksByDay[ds];
    const dest = hw.hwTasksByDay[toDs] || (hw.hwTasksByDay[toDs] = []);
    const moved = { ...t, id: t.id.startsWith('cal-') ? 'man-' + Date.now().toString(36) : t.id, edited: true };
    delete moved.carriedFrom;
    dest.push(moved);
  });
  await hwDismiss(id, ds, was);
}

// Done or not done. Finishing with a timer running logs the real time spent.
async function hwSetDone(ds, id, done) {
  const { hwActiveTimers = {} } = await chrome.storage.local.get({ hwActiveTimers: {} });
  const running = hwActiveTimers[id] && hwActiveTimers[id].taskDate === ds;
  if (running) await hwClearAlarms(id, hwActiveTimers[id]);
  await hwMutate((hw, timers) => {
    const t = (hw.hwTasksByDay[ds] || []).find(x => x.id === id);
    if (!t) return;
    if (done && running && timers[id]) {
      const timer = timers[id];
      const workMs = timer.mode === 'up' ? nyElapsed(timer) : hwWorkElapsed(timer);
      t.actualMin = Math.max(1, Math.round(workMs / 60000));
      hw.hwLog.push({ date: ds, hourStarted: new Date(timer.startedAt).getHours(), title: t.title,
        course: t.course, type: t.type, estMin: t.estMin, actualMin: t.actualMin });
      delete timers[id];
    }
    t.done = done;
    if (!done) delete t.actualMin;
    return running ? { breakUntil: 0 } : {};
  });
  return /^x-/.test(id) ? connTickBack(ds, id, done) : 'ok';   // another app's task: tick it there too
}

// ── Task timers ──────────────────────────────────────────────────────────────
// Countdowns finish the task on their own; stopwatches wait for you.
// hwActiveTimers[id] = { startedAt, mode, estMin, taskDate, totalMs, breakOffsets, pausedAt?, pausedMs }

function hwBuildSchedule(estMin) {
  const workMs = estMin * 60000;
  if (estMin <= HW_POMODORO_THRESHOLD) return { totalMs: workMs, breakOffsets: [] };
  const offs = [];
  let workDone = 0;
  while (workMs - workDone > HW_WORK_SEG) {
    workDone += HW_WORK_SEG;
    offs.push(workDone + offs.length * HW_BREAK_MS);
  }
  return { totalMs: workMs + offs.length * HW_BREAK_MS, breakOffsets: offs };
}

function hwWorkElapsed(timer, now = Date.now()) {
  const el = Math.min(nyElapsed(timer, now), timer.totalMs || Infinity);
  let breakMs = 0;
  for (const off of timer.breakOffsets || []) if (el > off) breakMs += Math.min(el - off, HW_BREAK_MS);
  return Math.max(0, el - breakMs);
}

// Is this countdown inside one of its breaks right now?
function hwOnBreak(timer, now = Date.now()) {
  const el = nyElapsed(timer, now);
  return (timer.breakOffsets || []).some(off => el >= off && el < off + HW_BREAK_MS);
}

const getHwTimers = async () => (await chrome.storage.local.get({ hwActiveTimers: {} })).hwActiveTimers;

function hwArm(id, t) {
  if (t.mode !== 'down' || t.pausedAt) return;
  const base = t.startedAt + (t.pausedMs || 0), now = Date.now();
  (t.breakOffsets || []).forEach((off, i) => { if (base + off > now) chrome.alarms.create(`hwbrk::${id}::${i}`, { when: base + off }); });
  chrome.alarms.create(`hwdone::${id}`, { when: Math.max(now + 500, base + t.totalMs) });
}

async function hwClearAlarms(id, t) {
  await chrome.alarms.clear(`hwdone::${id}`);
  await Promise.all(((t && t.breakOffsets) || []).map((_, i) => chrome.alarms.clear(`hwbrk::${id}::${i}`)));
}

async function hwStartTimer(task, phase, ds = hwTodayStr()) {
  const timers = await getHwTimers();
  const up = phase === 'calibration' || task.type === 'Q';
  const entry = { startedAt: Date.now(), mode: up ? 'up' : 'down', estMin: task.estMin, taskDate: ds, pausedMs: 0,
    ...(up ? { totalMs: 0, breakOffsets: [] } : hwBuildSchedule(task.estMin)) };
  timers[task.id] = entry;
  hwArm(task.id, entry);
  await chrome.storage.local.set({ hwActiveTimers: timers });
  return entry;
}

// "Just start": five minutes, no breaks. When they're up the task isn't
// finished; the clock carries on as a stopwatch and asks whether to keep going.
const HW_JUST_START_MS = 5 * 60000;
async function hwJustStart(task, ds = hwTodayStr()) {
  const timers = await getHwTimers();
  const entry = { startedAt: Date.now(), mode: 'down', estMin: task.estMin, taskDate: ds, pausedMs: 0,
    totalMs: HW_JUST_START_MS, breakOffsets: [], justStart: true };
  timers[task.id] = entry;
  hwArm(task.id, entry);
  await chrome.storage.local.set({ hwActiveTimers: timers });
  return entry;
}

// "Keep going?" answered: keep the stopwatch, or stop here (the task stays open, nothing is logged).
async function hwKeepGoing(id, keep) {
  if (!keep) return hwStopTimer(id);
  const timers = await getHwTimers();
  if (!timers[id]) return;
  delete timers[id].askKeepGoing;
  await chrome.storage.local.set({ hwActiveTimers: timers });
}

// A task's small steps. Not an edit: the calendar or app can still update its title and length.
async function hwSetSteps(ds, id, steps) {
  await hwMutate(hw => {
    const t = (hw.hwTasksByDay[ds] || []).find(x => x.id === id);
    if (t) t.steps = steps.map(s => ({ id: s.id, text: String(s.text).slice(0, 120), done: !!s.done }));
  });
}

// The next step to do, and how far along: { step, index, done, total }.
function nyNextStep(steps) {
  const list = steps || [], index = list.findIndex(s => !s.done);
  return { step: index < 0 ? null : list[index], index, done: list.filter(s => s.done).length, total: list.length };
}

// The focus sound to play now: the chosen one while some timer is really
// running (not paused, not on a break), otherwise null.
function nySoundFor(timers, cfg, now = Date.now()) {
  const sound = cfg && cfg.focusSound;
  if (!sound || sound === 'off') return null;
  return Object.values(timers || {}).some(t => t && !t.pausedAt && !(t.mode === 'down' && hwOnBreak(t, now))) ? sound : null;
}

// Throws the running clock away without finishing the task.
async function hwStopTimer(id) {
  const timers = await getHwTimers();
  if (!timers[id]) return;
  await hwClearAlarms(id, timers[id]);
  delete timers[id];
  await chrome.storage.local.set({ hwActiveTimers: timers, breakUntil: 0 });
}

async function hwPauseTimer(id, pause) {
  const timers = await getHwTimers();
  const t = timers[id];
  if (!t) return;
  if (pause && !t.pausedAt) { t.pausedAt = Date.now(); await hwClearAlarms(id, t); }
  if (!pause && t.pausedAt) { t.pausedMs = (t.pausedMs || 0) + Date.now() - t.pausedAt; delete t.pausedAt; hwArm(id, t); }
  await chrome.storage.local.set({ hwActiveTimers: timers, ...(pause ? { breakUntil: 0 } : {}) });
}

// A countdown ran out: the task is done, logged at its full length. A "just
// start" countdown instead becomes a stopwatch that asks whether to keep going.
async function hwTimerRanOut(id) {
  const timers = await getHwTimers();
  const t = timers[id];
  if (!t) return;
  if (t.justStart) {
    await hwClearAlarms(id, t);
    delete t.justStart;
    Object.assign(t, { mode: 'up', totalMs: 0, breakOffsets: [], askKeepGoing: true });
    await chrome.storage.local.set({ hwActiveTimers: timers });
    return;
  }
  await hwMutate((hw, tm) => {
    const task = (hw.hwTasksByDay[t.taskDate] || []).find(x => x.id === id);
    if (task && !task.done) {
      task.done = true; task.actualMin = t.estMin;
      hw.hwLog.push({ date: t.taskDate, hourStarted: new Date(t.startedAt).getHours(), title: task.title,
        course: task.course, type: task.type, estMin: t.estMin, actualMin: t.estMin });
    }
    delete tm[id];
    return { breakUntil: 0 };
  });
  if (/^x-/.test(id)) await connTickBack(t.taskDate, id, true);
}

// "12:04" counting down, "↑ 3:10" counting up.
function nyFmtMs(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function hwTimerMs(t, now = Date.now()) {
  return t.mode === 'up' ? nyElapsed(t, now) : Math.max(0, t.totalMs - nyElapsed(t, now));
}

// ── The lock rule ────────────────────────────────────────────────────────────
// Today's habits, plus tonight's tasks if tomorrow is a school day. Only a
// pomodoro break opens YouTube early, and bedtime closes it no matter what.

function hwGatesOn(d = new Date()) {
  const bed = nyBedFor(NY_CFG, hwTodayStr(d));
  return nyIsSchoolDay(hwTodayStr(nyAddDays(d, 1)), bed, HW_SCHOOL_DAYS);
}
const hwLocksOn = (task, d = new Date()) => hwGatesOn(d);
const hwGatingTasks = (hw, d = new Date()) => hwGatesOn(d) ? hwTasksOn(hw, hwTodayStr(d)) : [];

function gatingComplete(tasks, weeks, hw, d = new Date()) {
  return isTodayComplete(tasks, weeks, d) && hwGatingTasks(hw, d).every(t => t.done);
}

const nyNightCtx = () => ({ cfg: NY_CFG, calDays: HW_SCHOOL_DAYS });

function nyTodayCounts(store, hw, now = new Date()) {
  const habits = habitsOn(store.tasks, now);
  const habitsDone = habits.filter(h => habitDoneOn(store.weeks, h.name, now)).length;
  const tasks = hwGatingTasks(hw, now);
  const tasksDone = tasks.filter(t => t.done).length;
  const total = habits.length + tasks.length, done = habitsDone + tasksDone;
  return { habits: habits.length, habitsDone, tasks: tasks.length, tasksDone, total, done, left: total - done };
}

// Is YouTube open right now, and why?
//   why: 'bed' | 'tasks' | 'break' | 'done'
function nyGate(store, hw, now = new Date()) {
  const night = nyNight(now, nyNightCtx());
  const counts = nyTodayCounts(store, hw, now);
  const base = { counts, closeTs: night.closeTs, openTs: night.openTs, fit: night.fit };
  if (night.closed) return { ...base, open: false, why: 'bed' };
  if (counts.left === 0) return { ...base, open: true, why: 'done' };
  if (now.getTime() < (hw.breakUntil || 0)) return { ...base, open: true, why: 'break', until: hw.breakUntil };
  return { ...base, open: false, why: 'tasks' };
}

// A length someone typed into a length picker: "45", "45m", "1h 20m", "1.5h",
// "1:30", "2 hours". Minutes from 1 to 480, or null.
function nyParseLength(text) {
  const t = String(text || '').trim().toLowerCase();
  let m, min = null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) min = +m[1] * 60 + +m[2];
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d{1,2})\s*(?:m|min|mins|minutes)?)?$/.exec(t))) min = Math.round(+m[1] * 60) + +(m[2] || 0);
  else if ((m = /^(\d{1,3})\s*(?:m|min|mins|minutes)?$/.exec(t))) min = +m[1];
  return min >= 1 && min <= 480 ? min : null;
}

// ── Quick add: "Essay friday 45m" ───────────────────────────────────────────
// Pulls a length ("45m", "1h") and a day ("today", "tomorrow", "friday",
// "next mon", "in 3 days", "10/3", "oct 12", "2026-10-03", optionally after
// "due", "by", "on" or "for") off the end of what was typed, in either order.
// Returns { title, minutes, date } with date null when none was given.

const NY_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NY_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Does this locale write day before month (3/10 = 3 October)?
function nyDayFirst() {
  try {
    const parts = new Intl.DateTimeFormat(typeof navigator !== 'undefined' ? navigator.language : 'en-US',
      { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2020, 11, 31));
    return parts.findIndex(p => p.type === 'day') < parts.findIndex(p => p.type === 'month');
  } catch { return false; }
}

function nyWeekdayIndex(word) {
  const w = word.toLowerCase();
  return NY_WEEKDAYS.findIndex(d => d === w || (w.length >= 3 && d.startsWith(w)));
}

// A day at the end of `str`, optionally after "due", "by", "on" or "for":
// { date, rest } or null. `today` is local midnight.
function nyDayAtEnd(str, today) {
  const plus = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  function weekday(word, next) {
    const want = nyWeekdayIndex(word);
    if (want < 0) return null;
    const ahead = (want - today.getDay() + 7) % 7;
    return plus(ahead + (next ? 7 : 0));
  }
  function exact(y, mo, d) {
    const x = new Date(y, mo - 1, d);
    return x.getMonth() === mo - 1 && x.getDate() === d ? x : null;
  }
  // A month and day with no year: this year, or next year if it's already gone by.
  function monthDay(mo, d, y) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    if (y) return exact(y.length === 2 ? 2000 + +y : +y, mo, d);
    const x = exact(today.getFullYear(), mo, d);
    if (!x) return null;
    return x < today ? exact(today.getFullYear() + 1, mo, d) : x;
  }
  const pre = '(?:\\s+(?:due|by|on|for))?';
  const tries = [
    [/\s+(today|tonight)$/i, () => plus(0)],
    [/\s+(tomorrow|tmrw|tmr)$/i, () => plus(1)],
    [/\s+in\s+(\d{1,2})\s+days?$/i, m => plus(+m[1])],
    [/\s+in\s+a\s+week$/i, () => plus(7)],
    [/\s+next\s+week$/i, () => plus(7)],
    [/\s+(?:due|by|on|for)\s+(sat|sun)$/i, m => weekday(m[1], false)],
    [new RegExp(pre + '\\s+(next\\s+)?(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sunday)$', 'i'),
      m => weekday(m[2], !!m[1])],
    [new RegExp(pre + '\\s+(\\d{4})-(\\d{1,2})-(\\d{1,2})$'), m => exact(+m[1], +m[2], +m[3])],
    [new RegExp(pre + '\\s+(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?$'), m => {
      const [a, b] = nyDayFirst() ? [+m[2], +m[1]] : [+m[1], +m[2]];
      return monthDay(a, b, m[3]);
    }],
    [new RegExp(pre + '\\s+(' + NY_MONTHS.join('|') + ')[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?$', 'i'),
      m => monthDay(NY_MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])],
    [new RegExp(pre + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + NY_MONTHS.join('|') + ')[a-z]*\\.?$', 'i'),
      m => monthDay(NY_MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])],
  ];
  for (const [rx, make] of tries) {
    const m = str.match(rx);
    if (!m) continue;
    const d = make(m);
    if (d) return { date: d, rest: str.slice(0, m.index).trim() };
  }
  return null;
}

// A length at the end: "45m", "for 45 min", "1h 30m", "1.5h", "2 hours".
const NY_LENGTH_END = /\s+(?:for\s+)?(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes)?)?|(\d{1,3})\s*(?:m|min|mins|minute|minutes))$/i;

// The same length as a word of its own anywhere: "30m science test", "science 30m test".
const NY_LENGTH_WORD = /(?:^|\s)(?:for\s+)?(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes))?|(\d{1,3})\s*(?:m|min|mins|minute|minutes))(?=\s|$)/i;

// What a typed task says: its title, how long, which day and which subject.
function nyParseQuick(text, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let s = String(text || '').trim(), minutes = null, date = null;
  for (let pass = 0; pass < 2; pass++) {
    const m = minutes == null && s.match(NY_LENGTH_END);
    if (m) {
      minutes = Math.min(480, m[3] ? +m[3] : Math.round(+m[1] * 60) + +(m[2] || 0));
      s = s.slice(0, m.index).trim(); continue;
    }
    const d = !date && nyDayAtEnd(s, today);
    if (d && d.rest) { date = d.date; s = d.rest; continue; }
  }
  // A length first ("30m science test") or on its own in the middle comes out too
  if (minutes == null) {
    const m = s.match(NY_LENGTH_WORD);
    if (m && s.replace(m[0], ' ').trim()) {
      minutes = Math.min(480, m[3] ? +m[3] : Math.round(+m[1] * 60) + +(m[2] || 0));
      s = s.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }
  const title = s.charAt(0).toUpperCase() + s.slice(1);
  return { title, minutes: minutes || null, date, subject: nyFindSubject(title) };
}
