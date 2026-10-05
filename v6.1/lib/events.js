// events.js — every calendar in one list. Events come from three places:
//   google  calendars in a signed-in Google account (lib/gcal.js)
//   feed    secret iCal links, read-only (lib/ics.js)
//   local   events saved in Not yet. only
// Pages and the task import get the same shape back, whatever the source:
//   { id, source, calendarId, calendarName, color, title, allDay, start, end,
//     place, notes, editable, seriesId, recurring, repeat, link, uid? }  (uid: Google's iCalUID)
// All-day events keep dates ('YYYY-MM-DD', end exclusive, as Google stores
// them); timed ones keep epoch milliseconds. No DOM in here.

const CAL_LOCAL = 'local';                        // the calendar ID of "Not yet. only"
const CAL_FEED_BACK = 7, CAL_FEED_AHEAD = 365;    // days of each link kept, around today

// ── Colours ─────────────────────────────────────────────────────────────────
// Other apps' calendar colours, matched to the nearest of the app's pastels by
// hue, so a bright Google red still looks like it belongs here.
const CAL_HUES = { lilac: 253, mint: 152, peach: 19, butter: 46, sky: 208, pink: 334, sage: 94 };

function calNearestColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 'stone';
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.12) return 'stone';                   // greys
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  let best = 'stone', gap = 360;
  for (const [name, h] of Object.entries(CAL_HUES)) {
    const away = Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h));
    if (away < gap) { best = name; gap = away; }
  }
  return best;
}

// The first pastel nobody's using yet.
const calUnusedColor = used => NY_COLORS.find(c => c !== 'stone' && !used.includes(c)) || 'lilac';

// ── Dates ───────────────────────────────────────────────────────────────────
const calDayMs = ds => nyParseDs(ds).getTime();
const calNextDs = (ds, n = 1) => hwTodayStr(nyAddDays(nyParseDs(ds), n));
const calYm = d => hwTodayStr(d).slice(0, 7);

// [start, end) in milliseconds, whatever kind of event it is.
function calSpan(ev) {
  return ev.allDay ? [calDayMs(ev.start), calDayMs(ev.end)] : [ev.start, Math.max(ev.start, ev.end)];
}

// The dates an event shows on.
function calDaysOf(ev) {
  const [s, e] = calSpan(ev), out = [];
  const d = new Date(s); d.setHours(0, 0, 0, 0);
  do { out.push(hwTodayStr(d)); d.setDate(d.getDate() + 1); } while (d.getTime() < e);
  return out;
}

// Months from one date to another, both included.
function calMonthsBetween(fromDs, toDs) {
  const out = [], d = nyParseDs(fromDs.slice(0, 7) + '-01'), last = toDs.slice(0, 7);
  while (calYm(d) <= last) { out.push(calYm(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}

// Earliest first; on the same day, all-day events before timed ones.
const calOrder = (a, b) => (calSpan(a)[0] - calSpan(b)[0]) || (b.allDay - a.allDay) || a.title.localeCompare(b.title);

// ── Secret links ────────────────────────────────────────────────────────────
function calFeedName(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  if (/(^|\.)google\.com$/.test(host)) return 'Google Calendar';
  if (/(^|\.)(outlook|office365|live|office)\.com$/.test(host)) return 'Outlook';
  if (/(^|\.)icloud\.com$/.test(host)) return 'iCloud';
  return host || 'Calendar';
}

// Which Settings → Connections card a link belongs to, by its address.
function calFeedApp(url) {
  let host = '';
  try { host = new URL(nyFeedUrl(url)).hostname.toLowerCase(); } catch { return 'ical'; }
  const is = d => host === d || host.endsWith('.' + d);
  if (host === 'calendar.google.com') return 'gcal';
  if (['outlook.live.com', 'outlook.office365.com', 'outlook.office.com'].includes(host)) return 'outlook';
  if (is('instructure.com')) return 'canvascal';
  if (is('schoology.com')) return 'schoology';
  return 'ical';
}

// A Google secret link carries its calendar's ID:
// calendar.google.com/calendar/ical/<ID>/private-…/basic.ics
function calFeedGoogleId(url) {
  const m = /calendar\.google\.com\/calendar\/ical\/([^/]+)\//i.exec(url || '');
  return m ? decodeURIComponent(m[1]) : '';
}

// The links. The first time, 6.0's single link (hwSettings.icsUrl) moves in.
async function calFeedsLoad() {
  const { calFeeds, hwSettings } = await chrome.storage.local.get({ calFeeds: null, hwSettings: null });
  if (calFeeds) return calFeeds;
  const url = nyFeedUrl(hwSettings && hwSettings.icsUrl);
  const feeds = url ? [{ id: 'feed-1', url, name: calFeedName(url), color: 'sky', on: true }] : [];
  await chrome.storage.local.set({ calFeeds: feeds, ...(hwSettings ? { hwSettings: { ...hwSettings, icsUrl: '' } } : {}) });
  await chrome.storage.local.remove('calAgenda');            // 6.0's one list of events; now kept per calendar
  return feeds;
}

async function calFetchFeed(url) {
  let res;
  try { res = await fetch(url, { cache: 'no-store' }); }
  catch { throw new Error('Couldn’t reach that calendar. Check the link and your internet.'); }
  if (!res.ok) throw new Error(res.status === 404 ? 'That calendar link doesn’t work anymore.' : 'The calendar said ' + res.status + '.');
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That link isn’t a calendar feed.');
  return text;
}

// A feed's events from a week back to a year ahead, one entry per day each
// lands on (without the feed's name and colour, which can change).
function calExpandFeed(events, feed, now = new Date()) {
  const from = nyAddDays(now, -CAL_FEED_BACK), to = nyAddDays(now, CAL_FEED_AHEAD), out = [];
  for (const ev of events) {
    if (!ev.summary || !ev.start) continue;
    const series = ev.uid || ev.summary;
    for (const day of ICS.days(ev, from, to)) {
      const base = { id: `${feed.id}:${series}:${day}`, seriesId: series, title: ev.summary.trim(),
        place: ev.location || '', notes: ev.description || '' };
      if (ev.allDay) { out.push({ ...base, allDay: true, start: day, end: calNextDs(day) }); continue; }
      const s = nyParseDs(day); s.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
      out.push({ ...base, allDay: false, start: s.getTime(), end: s.getTime() + Math.max(0, (ev.end || ev.start) - ev.start) });
    }
  }
  return out;
}

// Adds a link after checking it really is a calendar. Throws an Error whose
// message is written for people.
async function calAddFeed(rawUrl) {
  const url = nyFeedUrl(rawUrl);
  if (!/^https:\/\/\S+$/i.test(url)) throw new Error('Calendar links start with https:// or webcal://');
  const feeds = await calFeedsLoad();
  if (feeds.some(f => f.url === url)) throw new Error('That calendar is already here.');
  const text = await calFetchFeed(url);
  const feed = { id: 'feed-' + Date.now().toString(36), url, name: ICS.name(text) || calFeedName(url),
    color: calUnusedColor(feeds.map(f => f.color)), on: true };
  const { feedCache } = await chrome.storage.local.get({ feedCache: {} });
  feedCache[feed.id] = { at: Date.now(), url, items: calExpandFeed(ICS.parse(text), feed), error: '' };
  await chrome.storage.local.set({ calFeeds: [...feeds, feed], feedCache });
  return feed;
}

async function calSetFeed(id, patch) {
  const feeds = (await calFeedsLoad()).map(f => f.id === id ? { ...f, ...patch } : f);
  await chrome.storage.local.set({ calFeeds: feeds });
}

async function calRemoveFeed(id) {
  const feeds = (await calFeedsLoad()).filter(f => f.id !== id);
  const { feedCache } = await chrome.storage.local.get({ feedCache: {} });
  delete feedCache[id];
  await chrome.storage.local.set({ calFeeds: feeds, feedCache });
}

// Fetches each switched-on link at most every 10 minutes (any time, if
// forced). A link that fails keeps its last events and says why in `error`.
async function calRefreshFeeds({ force = false } = {}) {
  const feeds = await calFeedsLoad();
  const { feedCache } = await chrome.storage.local.get({ feedCache: {} });
  const now = Date.now();
  for (const f of feeds) {
    const c = feedCache[f.id];
    if (!f.on || (!force && c && c.url === f.url && now - c.at < HW_SYNC_THROTTLE_MS)) continue;
    try { feedCache[f.id] = { at: now, url: f.url, items: calExpandFeed(ICS.parse(await calFetchFeed(f.url)), f), error: '' }; }
    catch (e) { feedCache[f.id] = { items: [], ...c, at: now, url: f.url, error: String(e.message || e) }; }
  }
  for (const id of Object.keys(feedCache)) if (!feeds.some(f => f.id === id)) delete feedCache[id];
  await chrome.storage.local.set({ feedCache });
}

// ── One list ────────────────────────────────────────────────────────────────
// Everything calCollect needs, straight from storage (nyLoadAll adds it as D.cal).
async function calLoadRaw() {
  const calFeeds = await calFeedsLoad();
  const rest = await chrome.storage.local.get({ feedCache: {}, gcalAccounts: [], gcalCalendars: [], gcalCache: {},
    gcalDefault: '', localEvents: [], calLocalColor: 'lilac', calLocalNoteSeen: false });
  return { calFeeds, ...rest };
}

// Every switched-on event touching fromDs..toDs (both included), in order.
function calCollect(raw, fromDs, toDs) {
  const from = calDayMs(fromDs), to = calDayMs(calNextDs(toDs));
  const hits = ev => { const [s, e] = calSpan(ev); return e > s ? s < to && e > from : s >= from && s < to; };
  const out = [];
  for (const f of raw.calFeeds || []) {
    if (!f.on) continue;
    for (const it of ((raw.feedCache || {})[f.id] || {}).items || []) if (hits(it))
      out.push({ ...it, source: 'feed', calendarId: f.id, calendarName: f.name, color: f.color,
        editable: false, recurring: false, repeat: null, link: '' });
  }
  for (const c of gcalShown(raw)) {                // a calendar in two accounts, once
    if (!c.on) continue;
    const seen = new Set();
    for (const ym of calMonthsBetween(fromDs, toDs)) for (const it of (((raw.gcalCache || {})[c.id] || {})[ym] || {}).items || []) {
      if (seen.has(it.id) || !hits(it)) continue;
      seen.add(it.id);
      out.push({ ...it, source: 'google', calendarId: c.id, calendarName: c.name, color: c.color, editable: c.writable, repeat: null,
        link: it.link ? gcalLinkFor(it.link, c.account) : '' });
    }
  }
  for (const it of calExpandLocal(raw.localEvents || [], fromDs, toDs)) if (hits(it))
    out.push({ ...it, source: 'local', calendarId: CAL_LOCAL, calendarName: 'Not yet. only',
      color: raw.calLocalColor || 'lilac', editable: true, link: '' });
  return out.sort(calOrder);
}

// What stands out, for the month's marks and Coming up. Something that comes
// round again within a week (classes, practices, a daily reminder) is routine:
// the day still lists it. Monthly and yearly things, one-offs, and one trip
// over several days (a link's pieces on days in a row) all stand out.
function calStandouts(evs) {
  const series = {};
  for (const ev of evs) (series[ev.calendarId + '|' + ev.seriesId] || (series[ev.calendarId + '|' + ev.seriesId] = [])).push(ev);
  const routine = new Set(Object.keys(series).filter(k => {
    const list = series[k];
    const starts = list.map(e => calDayMs(e.allDay ? e.start : hwTodayStr(new Date(e.start)))).sort((a, b) => a - b);
    // A link sends an event over several days as one all-day piece per day: days in a row are one time
    const pieces = list.every(e => e.allDay && !e.recurring && !e.repeat);
    const times = pieces ? starts.filter((t, i) => i === 0 || t - starts[i - 1] > 1.5 * 864e5) : starts;
    return times.some((t, i) => i > 0 && t - times[i - 1] <= 7.5 * 864e5);
  }));
  return evs.filter(ev => !routine.has(ev.calendarId + '|' + ev.seriesId));
}

// { 'YYYY-MM-DD': [events] } for each day from fromDs to toDs.
function calByDay(events, fromDs, toDs) {
  const out = {};
  for (const ev of events) for (const ds of calDaysOf(ev)) if (ds >= fromDs && ds <= toDs) (out[ds] || (out[ds] = [])).push(ev);
  return out;
}

// ── Events saved in Not yet. only ───────────────────────────────────────────
// Stored as series: { id, title, allDay, start, end, place, notes, repeat, skip }
// where repeat is one of CAL_REPEATS or null, and skip lists dates left out.
const CAL_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
const calNewId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Does a series that starts on firstDs happen on ds?
function calRepeatsOn(repeat, firstDs, ds) {
  if (ds < firstDs) return false;
  if (!repeat) return ds === firstDs;
  const a = nyParseDs(firstDs), d = nyParseDs(ds);
  switch (repeat) {
    case 'daily': return true;
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return d.getDay() === a.getDay();
    case 'monthly': return d.getDate() === a.getDate();
    case 'yearly': return d.getDate() === a.getDate() && d.getMonth() === a.getMonth();
  }
  return false;
}

// The same event on another date: same time of day, same length.
function calMoveTo(ev, ds) {
  if (ev.allDay) {
    const days = Math.max(1, Math.round((calDayMs(ev.end) - calDayMs(ev.start)) / 86400000));
    return { start: ds, end: calNextDs(ds, days) };
  }
  const t = new Date(ev.start), d = nyParseDs(ds);
  d.setHours(t.getHours(), t.getMinutes(), 0, 0);
  return { start: d.getTime(), end: d.getTime() + Math.max(0, ev.end - ev.start) };
}

const calFirstDs = ev => ev.allDay ? ev.start : hwTodayStr(new Date(ev.start));

// Each time a local series happens that touches fromDs..toDs.
function calExpandLocal(list, fromDs, toDs) {
  const out = [];
  for (const ev of list) {
    const first = calFirstDs(ev), skip = new Set(ev.skip || []);
    const reach = calDaysOf(ev).length - 1;               // days one time runs past its first
    const d = nyParseDs(fromDs > first ? fromDs : first);
    d.setDate(d.getDate() - reach);
    for (; hwTodayStr(d) <= toDs; d.setDate(d.getDate() + 1)) {
      const ds = hwTodayStr(d);
      if (skip.has(ds) || !calRepeatsOn(ev.repeat, first, ds)) continue;
      out.push({ ...ev, ...calMoveTo(ev, ds), id: ev.repeat ? `${ev.id}:${ds}` : ev.id, seriesId: ev.id,
        recurring: !!ev.repeat, repeat: ev.repeat || null, occurrence: ds });
      if (!ev.repeat) break;
    }
  }
  return out;
}

// What gets stored from the event window or the add bar.
function calClean(d) {
  return { title: String(d.title || '').trim() || 'Untitled', allDay: !!d.allDay, start: d.start, end: d.end,
    place: String(d.place || '').trim(), notes: String(d.notes || '').trim(),
    repeat: CAL_REPEATS.includes(d.repeat) ? d.repeat : null };
}

// A series moved so the time `occ` lands where `draft` says: the same shift in
// days from its first date, with the draft's time of day and length.
function calShiftSeries(series, occ, draft) {
  const days = Math.round((calDayMs(calFirstDs(draft)) - calDayMs(occ.occurrence)) / 86400000);
  return calMoveTo(draft, calNextDs(calFirstDs(series), days));
}

async function calLocalLoad() { return (await chrome.storage.local.get({ localEvents: [] })).localEvents; }
const calLocalSave = list => chrome.storage.local.set({ localEvents: list });

async function calLocalAdd(draft) {
  const ev = { id: calNewId('l-'), ...calClean(draft), skip: [] };
  await calLocalSave([...(await calLocalLoad()), ev]);
  return ev;
}

// scope: 'one' changes just this time of a repeating event, 'all' the series.
async function calLocalChange(occ, draft, scope = 'one') {
  const list = await calLocalLoad();
  const i = list.findIndex(e => e.id === occ.seriesId);
  if (i < 0) throw new Error('That event isn’t here anymore.');
  const series = list[i], clean = calClean(draft);
  if (series.repeat && scope === 'one') {
    list[i] = { ...series, skip: [...(series.skip || []), occ.occurrence] };
    list.push({ id: calNewId('l-'), ...clean, repeat: null, skip: [] });
  } else if (series.repeat) {
    list[i] = { ...series, ...clean, ...calShiftSeries(series, occ, clean),
      skip: clean.repeat === series.repeat ? series.skip || [] : [] };
  } else {
    list[i] = { ...series, ...clean, skip: [] };
  }
  await calLocalSave(list);
}

async function calLocalDelete(occ, scope = 'one') {
  const list = await calLocalLoad();
  const i = list.findIndex(e => e.id === occ.seriesId);
  if (i < 0) return;
  if (list[i].repeat && scope === 'one') list[i] = { ...list[i], skip: [...(list[i].skip || []), occ.occurrence] };
  else list.splice(i, 1);
  await calLocalSave(list);
}

// ── Reading what people type ─────────────────────────────────────────────────
// "Dentist fri 3pm", "Soccer sat 10am-12pm at the park", "Study group tomorrow
// 4-5:30 at the library". Peels a time or time range, a length, a day and a
// place off the end in any order; what's left is the title. A bare number is a
// time only after "at" or "from" or with am/pm or a colon, so "Math 10" and
// "Read ch 4-5" stay titles. A place is only kept when a day or time was
// found too, so "Look at the sun" stays a title.
const CAL_T = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.|a|p)?';
const CAL_WORD_TIMES = { noon: 720, midday: 720, midnight: 0 };

// Minutes after midnight, or null. Without am/pm: 13–23 and 0x are 24-hour;
// 1–6 mean afternoon, 7–11 morning and 12 noon, the likelier reading for a
// student's day.
function nyTimeMin(hh, mm, ap) {
  const h = +hh, m = +(mm || 0);
  if (!(m >= 0 && m <= 59)) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    return (h % 12 + (/^p/i.test(ap) ? 12 : 0)) * 60 + m;
  }
  if (h > 23) return null;
  if (h >= 13 || h === 0 || /^0\d/.test(String(hh))) return h * 60 + m;
  return (h <= 6 ? h + 12 : h) * 60 + m;
}

// A time typed on its own ("3", "3:45pm", "15:30", "noon").
function nyParseTime(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t in CAL_WORD_TIMES) return CAL_WORD_TIMES[t];
  const m = new RegExp('^' + CAL_T + '$', 'i').exec(t);
  return m ? nyTimeMin(m[1], m[2], m[3]) : null;
}

// "3-4pm", "11-1pm", "10am-12pm", "4-5:30": the start shares the end's half
// of the day when that keeps it before the end.
function calRange(m) {
  const [h1, m1, a1, h2, m2, a2] = [m[2], m[3], m[4], m[5], m[6], m[7]];
  let end = nyTimeMin(h2, m2, a2), start;
  if (end == null) return null;
  if (a1) start = nyTimeMin(h1, m1, a1);
  else if (a2) {
    start = nyTimeMin(h1, m1, a2);
    if (start != null && start >= end) start = nyTimeMin(h1, m1, /^p/i.test(a2) ? 'am' : 'pm');
  } else start = nyTimeMin(h1, m1, null);
  if (start == null) return null;
  if (!a2 && end <= start && end + 720 < 1440) end += 720;
  return end > start ? [start, end] : null;
}

function nyParseEvent(text, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const RANGE = new RegExp('\\s+(at\\s+|from\\s+)?' + CAL_T + '\\s*(?:-|–|—|to|until|till)\\s*' + CAL_T + '$', 'i');
  const ONE = new RegExp('\\s+(at\\s+)?' + CAL_T + '$', 'i');
  const WORD = /\s+(?:at\s+)?(noon|midday|midnight)$/i;
  let s = ' ' + String(text || '').trim();
  let date = null, startMin = null, endMin = null, minutes = null, minutesText = '', place = '', placeText = '';
  const ap = x => x && x.length > 1;                // am/pm; a lone a or p needs "at" or a colon ("Problem set 2a")
  const timed = /\d\s*(am|pm|a\.m\.|p\.m\.)\b|\d:\d\d|\b(at|from)\s+\d|\b(noon|midday|midnight)\b/i.test(s);
  for (let pass = 0; pass < 6; pass++) {
    let m;
    if (startMin == null && (m = RANGE.exec(s)) && (m[1] || m[3] || ap(m[4]) || m[6] || ap(m[7]))) {
      const r = calRange(m);
      if (r) { [startMin, endMin] = r; s = s.slice(0, m.index); continue; }
    }
    if (startMin == null && (m = WORD.exec(s))) { startMin = CAL_WORD_TIMES[m[1].toLowerCase()]; s = s.slice(0, m.index); continue; }
    if (startMin == null && (m = ONE.exec(s)) && (m[1] || m[3] || ap(m[4]))) {
      const t = nyTimeMin(m[2], m[3], m[4]);
      if (t != null) { startMin = t; s = s.slice(0, m.index); continue; }
    }
    if (minutes == null && (m = /\s+(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours)$/i.exec(s))) {
      minutes = Math.min(24 * 60, +m[1] * (/^h/i.test(m[2]) ? 60 : 1)); minutesText = s.slice(m.index); s = s.slice(0, m.index); continue;
    }
    if (!date) {
      // A bare "sat" or "sun" is a day only when a time is typed too (tasks need
      // "due sat"), so "Soccer sat 10am" works and "Watch the sun" stays a title.
      const bare = timed ? s.replace(/\s+sat$/i, ' saturday').replace(/\s+sun$/i, ' sunday') : s;
      const d = nyDayAtEnd(bare, today);
      if (d && d.rest) { date = d.date; s = ' ' + d.rest; continue; }
    }
    if (!place && (m = /^(.*\S)\s+(?:at|@)\s+(.+)$/i.exec(s)) && /[a-z]/i.test(m[2]) && nyParseTime(m[2]) == null) {
      place = m[2].trim(); placeText = s.slice(m[1].length); s = m[1]; continue;
    }
    break;
  }
  if (place && !date && startMin == null) { s += placeText; place = ''; }   // "Look at the sun" is a title
  if (minutes != null && startMin == null) { s += minutesText; minutes = null; }   // "Swim 200m": a length needs a time
  if (startMin != null && endMin == null) endMin = startMin + (minutes || 60);
  return { title: s.trim(), date, allDay: startMin == null, startMin, endMin, minutes, place };
}

// An event draft from what was typed, on `fallback` when no day was typed.
function calDraftFromText(p, fallback) {
  const day = new Date(p.date || fallback); day.setHours(0, 0, 0, 0);
  const base = { title: p.title, place: p.place, notes: '', repeat: null };
  if (p.allDay) { const ds = hwTodayStr(day); return { ...base, allDay: true, start: ds, end: calNextDs(ds) }; }
  const s = new Date(day); s.setHours(0, p.startMin, 0, 0);
  const e = new Date(day); e.setHours(0, p.endMin, 0, 0);
  return { ...base, allDay: false, start: s.getTime(), end: e.getTime() };
}

// "Fri, Oct 2 · 3:00 PM – 4:00 PM", "Thu, Oct 1 – Fri, Oct 2 · All day"
function calWhenLabel(ev) {
  const day = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const [s, e] = calSpan(ev);
  if (ev.allDay) {
    const last = calNextDs(ev.end, -1);
    return (last > ev.start ? `${day(s)} – ${day(calDayMs(last))}` : day(s)) + ' · All day';
  }
  if (hwTodayStr(new Date(s)) === hwTodayStr(new Date(Math.max(s, e - 1)))) return `${day(s)} · ${nyClock(s)} – ${nyClock(e)}`;
  return `${day(s)} ${nyClock(s)} – ${day(e)} ${nyClock(e)}`;
}

// ── Google, through lib/gcal.js ──────────────────────────────────────────────
const CAL_GOOGLE_TTL = 6 * 3600 * 1000;           // a month on screen older than this is fetched again

// Last month to three months ahead: what the background keeps fresh.
function calWindowMonths(now = new Date()) {
  const d = new Date(now), out = [];
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  for (let i = 0; i < 5; i++) { out.push(calYm(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}

// Per calendar: always two months back to three ahead, plus the 24 other
// months (before or after) fetched most recently. The rest go.
function calPruneCache(cache, now = Date.now()) {
  const d = new Date(now);
  const oldest = calYm(new Date(d.getFullYear(), d.getMonth() - 2, 1));
  const near = calYm(new Date(d.getFullYear(), d.getMonth() + 3, 1));
  const out = {};
  for (const [id, months] of Object.entries(cache)) {
    const all = Object.entries(months), inside = ([ym]) => ym >= oldest && ym <= near;
    const keep = [...all.filter(inside),
      ...all.filter(m => !inside(m)).sort((a, b) => b[1].at - a[1].at).slice(0, 24)];
    if (keep.length) out[id] = Object.fromEntries(keep);
  }
  return out;
}

// Makes sure each switched-on Google calendar has these months, fetching the
// ones older than maxAge through the account that shows it. Throws GcalError;
// leaves alone an account that needs a new sign-in. Saves by merging into what's stored now, so two pages fetching
// at once keep each other's months.
const CAL_GOOGLE_AT_ONCE = 6;
async function calEnsureMonths(months, { maxAge = CAL_GOOGLE_TTL, only = null } = {}) {
  const raw = await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [], gcalCache: {} });
  if (!gcalReady()) return;
  const live = new Set(raw.gcalAccounts.filter(a => !a.needsSignIn).map(a => a.email));
  const now = Date.now(), fetched = {}, jobs = [];
  for (const c of gcalShown(raw)) {
    if (!c.on || !live.has(c.account) || (only && !only.includes(c.id))) continue;
    for (const ym of months) {
      const hit = (raw.gcalCache[c.id] || {})[ym];
      if (hit && now - hit.at < maxAge) continue;
      jobs.push(() => gcalFetchMonth(c.id, ym, c.account).then(items => {
        (fetched[c.id] || (fetched[c.id] = {}))[ym] = { at: now, items: items.map(it => gcalNormalize(it, c)).filter(Boolean) };
      }));
    }
  }
  // Several at once, so the first look doesn't wait on each in turn, but never
  // more than CAL_GOOGLE_AT_ONCE; one that fails doesn't cost the others
  let next = 0, failure = null;
  const worker = async () => {
    while (next < jobs.length) { try { await jobs[next++](); } catch (e) { failure = failure || e; } }
  };
  await Promise.all(Array.from({ length: Math.min(CAL_GOOGLE_AT_ONCE, jobs.length) }, worker));
  if (Object.keys(fetched).length) {
    const { gcalCache: latest } = await chrome.storage.local.get({ gcalCache: {} });
    for (const [id, got] of Object.entries(fetched)) latest[id] = { ...(latest[id] || {}), ...got };
    await chrome.storage.local.set({ gcalCache: calPruneCache(latest, now) });
  }
  if (failure) throw failure;
}

// After a change to a calendar, its other cached months are fetched again the
// next time they're looked at.
async function calMarkStale(calendarId) {
  const { gcalCache } = await chrome.storage.local.get({ gcalCache: {} });
  for (const m of Object.values(gcalCache[calendarId] || {})) m.at = 0;
  await chrome.storage.local.set({ gcalCache });
}

// Everything connected, brought up to date: links (every 10 minutes), then
// Google's calendar list and the months around today. Sign-in trouble is left
// for the pages to show; what's cached stays.
async function calRefreshSources({ force = false } = {}) {
  await calRefreshFeeds({ force });
  const { gcalAccounts } = await chrome.storage.local.get({ gcalAccounts: [] });
  if (!gcalReady() || !gcalAccounts.some(a => !a.needsSignIn)) return;
  try {
    await gcalRefreshCalendars();
    await calEnsureMonths(calWindowMonths(), { maxAge: force ? 0 : 55 * 60000 });
  } catch (e) { if (!(e instanceof GcalError)) throw e; }
}

async function calAnySource() {
  if ((await calFeedsLoad()).length) return true;
  return gcalSignedIn(await chrome.storage.local.get({ gcalAccounts: [] }));
}

// Where new events go: the chosen Google calendar while signed in (the first
// account's main one if none was chosen), else Not yet. only.
function calDefaultCalendar(raw) {
  if (!gcalSignedIn(raw) || raw.gcalDefault === CAL_LOCAL) return CAL_LOCAL;
  const cals = gcalShown(raw).filter(c => c.writable);
  const c = cals.find(x => x.id === raw.gcalDefault) || cals.find(x => x.primary) || cals[0];
  return c ? c.id : CAL_LOCAL;
}

// Calendars an event can be saved to: switched-on Google calendars you can add
// to (and the default, even if switched off), with their account, then Not yet. only.
function calWritable(raw) {
  const google = gcalSignedIn(raw) ? gcalShown(raw).filter(c => c.writable && (c.on || c.id === raw.gcalDefault)) : [];
  return [...google.map(c => ({ id: c.id, name: c.name, color: c.color, account: c.account, primary: c.primary })),
    { id: CAL_LOCAL, name: 'Not yet. only', color: raw.calLocalColor || 'lilac' }];
}

// An account's main calendar is named after its email: under that email, it's just "Main calendar".
const calMainName = c => c.primary && c.account && c.name === c.account ? 'Main calendar' : c.name;

// The calendar choice: under each account's email when there's more than one
// account, then "Not yet. only" after a line. One account: as it is.
function calGrouped(cals) {
  const google = cals.filter(c => c.account), rest = cals.filter(c => !c.account);
  const accounts = [...new Set(google.map(c => c.account))];
  if (accounts.length < 2) return cals;
  return [...accounts.flatMap(a => [{ heading: a }, ...google.filter(c => c.account === a).map(c => ({ ...c, name: calMainName(c), aria: `${calMainName(c)}, ${a}` }))]),
    ...(rest.length ? ['sep', ...rest] : [])];
}

// The first account that needs to sign in again (or `email`, the one Google just
// turned down), in words: just "Google Calendar" with one account, its email with several.
function calSignInAsk(raw, email = '') {
  const accounts = (raw && raw.gcalAccounts) || [], a = email ? { email } : accounts.find(x => x.needsSignIn);
  if (!a) return null;
  return { email: a.email, text: accounts.length > 1 ? `${a.email} needs you to sign in again.` : 'Google Calendar needs you to sign in again.' };
}

// The months to fetch again after a change: the ones on screen, plus the ones
// the event was and is in.
const calTouched = (months, ...evs) => [...new Set([...months,
  ...evs.filter(Boolean).flatMap(e => calDaysOf(e).map(ds => ds.slice(0, 7)))])];

// Saves a new event. Throws GcalError (with a message for people) if Google says no.
// After Google has taken a change, its months are fetched again. If that fails the change
// still happened (the months are marked stale), so it isn't reported: a retry would add it twice.
const calRefetch = (months, calendarId) => calEnsureMonths(months, { maxAge: 0, only: [calendarId] }).catch(() => {});

async function calCreate(draft, calendarId, { months = [] } = {}) {
  if (!calendarId || calendarId === CAL_LOCAL) return calLocalAdd(draft);
  const clean = calClean(draft);
  const item = await gcalInsert(calendarId, clean);
  await calMarkStale(calendarId);
  await calRefetch(calTouched(months, clean), calendarId);
  return item;
}

// Only what changed, so Google keeps everything else about the event as it was.
function calPatchBody(ev, d) {
  const body = {};
  if (d.title !== ev.title) body.summary = d.title;
  if (d.place !== (ev.place || '')) body.location = d.place;
  if (d.notes !== (ev.notes || '')) body.description = d.notes;
  if (d.allDay !== ev.allDay || d.start !== ev.start || d.end !== ev.end) Object.assign(body, gcalWhen(d, true));
  if (!ev.recurring && d.repeat) body.recurrence = [GCAL_RRULE[d.repeat]];     // a one-off event that now repeats
  return body;
}

// "All of them": the series keeps its first date, shifted as far as this time
// moved; a new repeat choice replaces the old rule.
function calSeriesPatch(master, ev, d) {
  const body = calPatchBody(ev, d);
  delete body.start; delete body.end;
  if (d.allDay !== ev.allDay || d.start !== ev.start || d.end !== ev.end) {
    const first = master.start.date ? { allDay: true, start: master.start.date, end: master.end.date }
      : { allDay: false, start: Date.parse(master.start.dateTime), end: Date.parse(master.end.dateTime) };
    Object.assign(body, gcalWhen({ ...d, ...calShiftSeries(first, { occurrence: calFirstDs(ev) }, d) }, true));
  }
  const had = gcalRepeatOf(master.recurrence, master.start.date ? nyParseDs(master.start.date) : new Date(master.start.dateTime));
  if (d.repeat && d.repeat !== had && had !== 'custom') body.recurrence = [GCAL_RRULE[d.repeat]];
  return body;
}

// scope: 'one' for just this time of a repeating event, 'all' for the series.
async function calUpdate(ev, draft, scope = 'one', { months = [] } = {}) {
  if (ev.source === 'local') return calLocalChange(ev, draft, scope);
  if (ev.source !== 'google' || !ev.editable) throw new GcalError('denied');
  const clean = calClean(draft);
  let id = ev.id, body;
  if (ev.recurring && scope === 'all') {
    id = ev.seriesId;
    body = calSeriesPatch(await gcalGet(ev.calendarId, ev.seriesId), ev, clean);
  } else body = calPatchBody(ev, clean);
  if (Object.keys(body).length) await gcalPatch(ev.calendarId, id, body);
  await calMarkStale(ev.calendarId);
  await calRefetch(calTouched(months, ev, clean), ev.calendarId);
}

async function calDelete(ev, scope = 'one', { months = [] } = {}) {
  if (ev.source === 'local') return calLocalDelete(ev, scope);
  if (ev.source !== 'google' || !ev.editable) throw new GcalError('denied');
  try { await gcalDelete(ev.calendarId, ev.recurring && scope === 'all' ? ev.seriesId : ev.id); }
  catch (e) { if (e.kind !== 'gone') throw e; }             // already gone is what was wanted
  await calMarkStale(ev.calendarId);
  await calRefetch(calTouched(months, ev), ev.calendarId);
}

// What the event window calls. A one-off event moved to another calendar is
// added there and then removed from the first.
async function calSave(ev, draft, scope = 'one', opts = {}) {
  if (!ev) return calCreate(draft, draft.calendarId, opts);
  if (draft.calendarId && draft.calendarId !== ev.calendarId && !ev.recurring) {
    await calCreate(draft, draft.calendarId, opts);
    return calDelete(ev, 'one', opts);
  }
  return calUpdate(ev, draft, scope, opts);
}

// "Not yet. only" events copied into a Google calendar; each local copy goes
// once Google has it.
async function calMoveLocalToGoogle(calendarId) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let moved = 0, failed = 0;
  for (const ev of await calLocalLoad()) {
    try {
      await gcalInsert(calendarId, ev, (ev.skip || []).map(ds => gcalExdate(ev, ds, tz)));
      await calLocalSave((await calLocalLoad()).filter(e => e.id !== ev.id));
      moved++;
    } catch { failed++; }
  }
  if (moved) await calMarkStale(calendarId);
  return { moved, failed };
}

// ── Events that are really tasks ─────────────────────────────────────────────
// An event starting with a tag, or a homework block, shows as a task instead of
// twice. Events saved in Not yet. are plans, never turned into tasks.
function calAsIcs(ev) {
  const [s, e] = calSpan(ev);
  return { summary: ev.title, allDay: ev.allDay, start: new Date(s), end: new Date(e) };
}
const calIsTask = ev => ev.source !== 'local' && !!hwTaskFromEvent(calAsIcs(ev));
