// ics.js — reads a calendar's secret iCal feed (Google, Outlook, iCloud).
// ICS.parse(text) → events; ICS.days(event, from, to) → the dates it lands on.
// Handles daily/weekly/monthly/yearly repeats with INTERVAL, COUNT and UNTIL,
// cancelled instances (EXDATE) and moved ones (RECURRENCE-ID).

const ICS = (() => {
  const unfold = text => text.replace(/\r?\n[ \t]/g, '');

  const unescape = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

  function parseDate(value) {
    if (/^\d{8}$/.test(value)) return new Date(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8));
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    if (!m) return null;
    const [, Y, Mo, D, H, Mi, S, z] = m;
    if (z === 'Z') return new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S));
    return new Date(+Y, +Mo - 1, +D, +H, +Mi, +S);       // floating or TZID: read as local
  }

  function parse(text) {
    const events = [];
    let cur = null;
    for (const line of unfold(text).split(/\r?\n/)) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const left = line.slice(0, i), value = line.slice(i + 1);
      const prop = left.split(';')[0].toUpperCase();
      switch (prop) {
        case 'SUMMARY': cur.summary = unescape(value); break;
        case 'DTSTART': cur.start = parseDate(value); cur.allDay = /^\d{8}$/.test(value); break;
        case 'DTEND':   cur.end = parseDate(value); break;
        case 'UID':     cur.uid = value; break;
        case 'STATUS':  cur.cancelled = /CANCELLED/i.test(value); break;
        case 'RRULE':   cur.rrule = value; break;
        case 'RDATE':   cur.rdates = (cur.rdates || []).concat(value.split(',')); break;
        case 'EXDATE':  cur.exdates = (cur.exdates || []).concat(value.split(',')); break;
        case 'RECURRENCE-ID': cur.recurrenceId = value; break;
        case 'LOCATION':    cur.location = unescape(value); break;
        case 'DESCRIPTION': cur.description = unescape(value).slice(0, 2000); break;
      }
    }
    // A moved or cancelled instance replaces that date of its series.
    const byUid = new Map(events.filter(e => e.rrule && e.uid).map(e => [e.uid, e]));
    for (const e of events) {
      if (!e.recurrenceId || !byUid.has(e.uid)) continue;
      const master = byUid.get(e.uid);
      master.exdates = (master.exdates || []).concat(e.recurrenceId);
    }
    return events.filter(e => !e.cancelled);
  }

  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const key = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // Which of the days in [from, to] does this event fall on? 'YYYY-MM-DD' strings.
  function days(ev, from, to) {
    from = midnight(from); to = midnight(to);
    const out = [];
    const skip = new Set((ev.exdates || []).map(x => x.slice(0, 8)));
    const seen = new Set();
    const add = d => {
      const k = key(d);
      if (skip.has(k) || seen.has(k) || d < from || d > to) return;
      seen.add(k); out.push(dstr(d));
    };
    const s0 = midnight(ev.start);

    // An all-day event can span several days (DTEND is the day after the last).
    const span = ev.allDay && ev.end ? Math.max(1, Math.round((midnight(ev.end) - s0) / 86400000)) : 1;
    const addSpan = d => { for (let i = 0; i < Math.min(span, 31); i++) add(addDays(d, i)); };

    for (const r of ev.rdates || []) { const d = parseDate(r.slice(0, 8)); if (d) addSpan(d); }

    if (!ev.rrule) { addSpan(s0); return out; }

    const p = Object.fromEntries(ev.rrule.split(';').map(x => x.split('=')));
    const interval = Math.max(1, +p.INTERVAL || 1);
    const count = +p.COUNT || Infinity;
    const until = p.UNTIL ? midnight(parseDate(p.UNTIL.length === 8 ? p.UNTIL : p.UNTIL.slice(0, 15) + (p.UNTIL.endsWith('Z') ? 'Z' : ''))) : null;
    const last = until && until < to ? until : to;
    let n = 0;
    const hit = d => { n++; if (n <= count) addSpan(d); return n < count; };

    if (p.FREQ === 'DAILY') {
      for (let d = s0; d <= last; d = addDays(d, interval)) if (!hit(d)) break;
    } else if (p.FREQ === 'WEEKLY') {
      const by = (p.BYDAY || WD[s0.getDay()]).split(',').map(x => x.slice(-2));
      const week0 = addDays(s0, -s0.getDay());
      for (let d = s0; d <= last; d = addDays(d, 1)) {
        const wk = Math.floor(Math.round((d - week0) / 86400000) / 7);
        if (wk % interval === 0 && by.includes(WD[d.getDay()]) && !hit(d)) break;
      }
    } else if (p.FREQ === 'MONTHLY') {
      for (let m = 0; ; m += interval) {
        const base = new Date(s0.getFullYear(), s0.getMonth() + m, 1);
        if (base > last) break;
        let d = null;
        const nth = (p.BYDAY || '').match(/^(-?\d)([A-Z]{2})$/);
        if (nth) {
          const want = WD.indexOf(nth[2]), k = +nth[1];
          if (k > 0) {
            d = new Date(base); while (d.getDay() !== want) d = addDays(d, 1);
            d = addDays(d, 7 * (k - 1));
          } else {
            d = new Date(base.getFullYear(), base.getMonth() + 1, 0); while (d.getDay() !== want) d = addDays(d, -1);
            d = addDays(d, 7 * (k + 1));
          }
          if (d.getMonth() !== base.getMonth()) d = null;
        } else {
          const day = +(p.BYMONTHDAY || s0.getDate());
          d = new Date(base.getFullYear(), base.getMonth(), day);
          if (d.getMonth() !== base.getMonth()) d = null;
        }
        if (d && d >= s0 && d <= last && !hit(d)) break;
      }
    } else if (p.FREQ === 'YEARLY') {
      for (let y = 0; ; y += interval) {
        const d = new Date(s0.getFullYear() + y, s0.getMonth(), s0.getDate());
        if (d > last) break;
        if (d.getMonth() === s0.getMonth() && !hit(d)) break;
      }
    }
    return out;
  }

  // The calendar's own name, when the feed gives one.
  function name(text) {
    const m = unfold(text).match(/^X-WR-CALNAME:(.*)$/m);
    return m ? unescape(m[1]).trim() : '';
  }

  return { parse, days, name };
})();
