// night.js — bedtime math. Pure functions, no DOM and no storage, so the
// background worker, the pages and the YouTube content script share one clock.
//
// Every moment belongs to an "evening": 6 PM on Tuesday and 1 AM on Wednesday
// are both Tuesday evening. YouTube closes at that evening's bedtime and opens
// at the next morning's wake time. It's a school night if the next day is a
// school day, by the calendar when it knows, by weekday when it doesn't.
//
// ctx = { cfg, calDays }   cfg from config.js, calDays = { 'YYYY-MM-DD': bool }

function nyIsSchoolDay(ds, bed, calDays) {
  if (calDays && Object.prototype.hasOwnProperty.call(calDays, ds)) return !!calDays[ds];
  return bed.days.includes(new Date(ds + 'T00:00:00').getDay());
}

var nyMinsOf = d => d.getHours() * 60 + d.getMinutes();
var nyAddDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Local midnight of the evening `now` belongs to.
function nyEvening(now, ctx) {
  const wake = nyBedFor(ctx.cfg, nyDateStr(now)).wake;
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  return nyMinsOf(now) < wake ? nyAddDays(d, -1) : d;
}

function nyCloseAt(evening, ctx) {
  const bed = nyBedFor(ctx.cfg, nyDateStr(evening));
  const school = nyIsSchoolDay(nyDateStr(nyAddDays(evening, 1)), bed, ctx.calDays);
  const min = school ? bed.school : bed.other;
  const d = new Date(evening); d.setHours(0, min, 0, 0);     // setHours rolls 1500 min into tomorrow
  return { ts: d.getTime(), school, fit: school && bed.fit, min };
}

function nyOpenAt(evening, ctx) {
  const morning = nyAddDays(evening, 1);
  const d = new Date(morning); d.setHours(0, nyBedFor(ctx.cfg, nyDateStr(morning)).wake, 0, 0);
  return d.getTime();
}

// Everything the night rule knows about right now.
function nyNight(now, ctx) {
  const ev = nyEvening(now, ctx);
  const close = nyCloseAt(ev, ctx);
  const openTs = nyOpenAt(ev, ctx);
  const t = now.getTime();
  return {
    closed: t >= close.ts && t < openTs,
    closeTs: close.ts, openTs,
    school: close.school,
    fit: close.fit,            // only start videos that end before bedtime
    evening: ev,
  };
}

// The next moment YouTube might open or close, or the day might change.
function nyNextEdge(now, ctx) {
  const t = now.getTime();
  const ev = nyEvening(now, ctx);
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const candidates = [
    nyCloseAt(ev, ctx).ts, nyOpenAt(ev, ctx),
    nyCloseAt(nyAddDays(ev, 1), ctx).ts, midnight.getTime(),
  ];
  return Math.min(...candidates.filter(x => x > t));
}

// ── Clock text ───────────────────────────────────────────────────────────────

var NY_TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function nyClock(ts) {
  const d = new Date(ts);
  const m = nyMinsOf(d);
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  return NY_TIME_FMT.format(d);
}

// Minutes after an evening's midnight → "11:00 PM", "midnight", "1:30 AM".
function nyClockMin(min) {
  return nyClock(new Date(2000, 0, 1, 0, min).getTime());
}
