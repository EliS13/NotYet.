// stats.js — streaks, usual lengths, the Sunday review and the numbers on the
// stats page. Everything is worked out from what's already stored: hwLog
// (every task finished with its timer running), hwTasksByDay (30 days) and
// nyDoneDays (the days the list was finished before bedtime). Days are local.

const NY_DONE_KEEP = 400;
const nyDsAdd = (ds, n) => hwTodayStr(nyAddDays(nyParseDs(ds), n));
const nyMedian = arr => { const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The gate opened because everything was done: that day goes on record, once.
// Bedtime closes the gate first, so a recorded day was finished before bed. A
// day first seen empty (a rest day) counts once work comes in and gets done.
// Resolves the new record, or null when nothing changes.
function nyRecordDone(days, gate, now = new Date()) {
  const today = hwTodayStr(now), total = gate && gate.counts ? gate.counts.total : 0, had = days && days[today];
  // Recorded as a rest day, then work came in and isn't finished: it isn't a rest day any more
  if (had && !had.total && gate && gate.why !== 'done' && total > 0 && gate.counts.left > 0) {
    const out = { ...days };
    delete out[today];
    return out;
  }
  if (!gate || gate.why !== 'done' || (had && (had.total > 0 || !total))) return null;
  const out = { ...(days || {}), [today]: { at: now.getTime(), total } };
  const floor = nyDsAdd(today, -NY_DONE_KEEP);
  for (const ds of Object.keys(out)) if (ds < floor) delete out[ds];
  return out;
}

// Days the computer stayed off: each one after the last record, up to
// yesterday (two weeks at most), that had nothing on the list is a rest day,
// so a weekend away doesn't break a streak. `isEmpty(ds)` knows the list.
function nyRestDays(days, isEmpty, today = hwTodayStr(), maxBack = 14) {
  const recorded = Object.keys(days || {}).sort();
  if (!recorded.length) return null;
  let out = null, ds = nyDsAdd(recorded[recorded.length - 1], 1);
  if (ds < nyDsAdd(today, -maxBack)) ds = nyDsAdd(today, -maxBack);
  for (; ds < today; ds = nyDsAdd(ds, 1)) if (!days[ds] && isEmpty(ds)) (out ||= { ...days })[ds] = { at: 0, total: 0 };
  return out;
}

// Days in a row the list was finished before bedtime. A day with nothing to
// do is skipped; a day with no record ends the run; today counts once it's done.
function nyStreak(days, today = hwTodayStr()) {
  days = days || {};
  let current = 0;
  for (let ds = days[today] ? today : nyDsAdd(today, -1), i = 0; i < NY_DONE_KEEP; ds = nyDsAdd(ds, -1), i++) {
    const d = days[ds];
    if (!d) break;
    if (d.total > 0) current++;
  }
  let best = 0, run = 0;
  const first = Object.keys(days).sort()[0];
  if (first) for (let ds = first; ds <= today; ds = nyDsAdd(ds, 1)) {
    const d = days[ds];
    if (!d) run = 0;
    else if (d.total > 0) best = Math.max(best, ++run);
  }
  return { current, best: Math.max(best, current) };
}

// How long a subject really takes you: the median of the last 60 days' timed
// tasks, from three of them, to the nearest 5 minutes (5 to 180). Or null.
function nyUsualLength(log, subjectId, now = new Date()) {
  if (!subjectId) return null;
  const from = hwTodayStr(nyAddDays(now, -60));
  const mins = (log || []).filter(r => r.course === subjectId && r.date >= from && r.actualMin > 0).map(r => r.actualMin);
  if (mins.length < 3) return null;
  return Math.min(180, Math.max(5, Math.round(nyMedian(mins) / 5) * 5));
}

// A week runs Monday to Sunday; a review is named by its Sunday.
const nyWeekRange = sunday => ({ from: nyDsAdd(sunday, -6), to: sunday });

// The Sunday a review is due for: on Sunday, or on Monday if it wasn't seen,
// and never for the week the app was installed. Or null.
function nyReviewWeek(now = new Date(), seen = '', installDate = '') {
  const dow = now.getDay();
  if (dow !== 0 && dow !== 1) return null;
  const sunday = hwTodayStr(nyAddDays(now, dow === 0 ? 0 : -1));
  if (seen === sunday) return null;
  if (installDate && installDate > nyWeekRange(sunday).from) return null;
  return sunday;
}

// The stats page's numbers for from..to (inclusive): timed minutes, tasks done,
// minutes and tasks per subject, guesses against real time (subjects with three
// timed tasks, the biggest gap first), timed tasks per starting hour, and the
// 8 Monday–Sunday weeks ending with the week of `to`.
function nyStats(byDay, log, days, { from, to }) {
  const inRange = ds => ds >= from && ds <= to;
  const timed = (log || []).filter(r => r.actualMin > 0);
  const rows = timed.filter(r => inRange(r.date));
  const sum = rs => rs.reduce((n, r) => n + r.actualMin, 0);
  let done = 0;
  for (const [ds, list] of Object.entries(byDay || {})) if (inRange(ds)) done += list.filter(t => t.done).length;
  const by = new Map();
  for (const r of rows) { const id = r.course || 'other'; (by.get(id) || by.set(id, []).get(id)).push(r); }
  const bySubject = [...by].map(([id, rs]) => ({ id, minutes: sum(rs), count: rs.length })).sort((a, b) => b.minutes - a.minutes);
  const guesses = [...by].filter(([, rs]) => rs.length >= 3).map(([id, rs]) => {
    const est = nyMedian(rs.map(r => r.estMin)), act = nyMedian(rs.map(r => r.actualMin));
    return { id, est, act, ratio: est ? act / est : 1, n: rs.length };
  }).sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
  const hours = Array(24).fill(0);
  for (const r of rows) if (r.hourStarted >= 0 && r.hourStarted < 24) hours[r.hourStarted]++;
  const lastMonday = nyDsAdd(to, -((nyParseDs(to).getDay() + 6) % 7));
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const wf = nyDsAdd(lastMonday, -7 * (7 - i)), wt = nyDsAdd(wf, 6);
    return { from: wf, minutes: sum(timed.filter(r => r.date >= wf && r.date <= wt)) };
  });
  return { minutes: sum(rows), done, bySubject, guesses, hours, weeks };
}

// ── Tests ────────────────────────────────────────────────────────────────────
// A calendar event is a test when its title says so, and isn't itself
// studying for one ("Unit test study", "Quiz review", "Exam prep").
function nyIsTest(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(study|studying|review|prep|practice)\b/.test(t) || /\btest (drive|run)\b/.test(t)) return false;
  return /\b(tests?|quiz(zes)?|exams?|midterms?|assessments?|finals)\b/.test(t);
}

// The n days just before a test to study on: never before today, never on the day itself.
function nyStudyDays(testDs, today, n) {
  const out = [];
  for (let ds = nyDsAdd(testDs, -n); ds < testDs; ds = nyDsAdd(ds, 1)) if (ds >= today) out.push(ds);
  return out;
}

// The soonest test in the next two weeks that wasn't waved off, how many days
// are left, and how its study sessions are going. `tests` are { key, title, ds, color }.
function nyNextTest(tests, plans, byDay, today) {
  const last = nyDsAdd(today, 14);
  const soon = (tests || []).filter(x => x.ds >= today && x.ds <= last && (plans || {})[x.key] !== 'skip' && nyIsTest(x.title))
    .sort((a, b) => a.ds.localeCompare(b.ds));
  const t = soon[0];
  if (!t) return null;
  // A test that moved day keeps its plan: one made for the same title on a nearby
  // day where that test no longer is (within two weeks either way)
  const title = t.key.slice(0, t.key.lastIndexOf('|')), here = new Set((tests || []).map(x => x.key));
  const near = k => { const d = k.slice(k.lastIndexOf('|') + 1); return d >= nyDsAdd(t.ds, -14) && d <= nyDsAdd(t.ds, 14); };
  const planKey = plans && plans[t.key] && plans[t.key] !== 'skip' ? t.key
    : Object.keys(plans || {}).find(k => k.startsWith(title + '|') && plans[k] !== 'skip' && !here.has(k) && near(k)) || null;
  const study = Object.values(byDay || {}).flat().filter(x => x && (x.studyFor === t.key || (planKey && x.studyFor === planKey)));
  const daysTo = ds => Math.round((nyParseDs(ds) - nyParseDs(today)) / 864e5), daysLeft = daysTo(t.ds);
  // Exam weeks: once this one is planned (or is today), the next one still to plan comes along
  const next = planKey || daysLeft === 0 ? soon.slice(1).find(x => x.ds > today && !(plans || {})[x.key]) : null;
  return { ...t, daysLeft, plan: planKey ? plans[planKey] : null, planKey,
    studyDone: study.filter(x => x.done).length, studyTotal: study.length,
    after: next ? { ...next, daysLeft: daysTo(next.ds) } : null };
}
