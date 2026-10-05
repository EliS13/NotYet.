// config.js — everything a person can change in Settings, the defaults a fresh
// install starts from, and the rules for changing bedtime. No DOM here: the
// background worker, every page and the YouTube content script all load it.

var NY_COLORS = ['lilac', 'mint', 'peach', 'butter', 'sky', 'pink', 'sage', 'stone'];

var NY_DEFAULT_SUBJECTS = [
  { id: 'math',      name: 'Math',        color: 'sky',    words: 'math, algebra, geometry, calculus, stats, trig' },
  { id: 'science',   name: 'Science',     color: 'mint',   words: 'science, biology, bio, chemistry, chem, physics, lab' },
  { id: 'english',   name: 'English',     color: 'peach',  words: 'english, ela, essay, novel, poem, poetry' },
  { id: 'history',   name: 'History',     color: 'butter', words: 'history, social studies, geography, civics' },
  { id: 'languages', name: 'Languages',   color: 'pink',   words: 'french, spanish, german, mandarin, chinese, japanese, latin' },
  { id: 'arts',      name: 'Art & music', color: 'lilac',  words: 'art, music, piano, violin, guitar, drawing, band, choir' },
  { id: 'coding',    name: 'Coding',      color: 'sage',   words: 'coding, code, programming, python, java, javascript' },
];

// A tag is how a calendar event says "this is a task". It's whatever the
// event title starts with: an emoji, or a word like HW.
//   kind 'down' = countdown, finishes on its own
//   kind 'up'   = stopwatch, you decide when it's done
var NY_DEFAULT_TAGS = [
  { mark: '📝', name: 'Homework', min: 30, kind: 'down', subject: '' },
  { mark: '📚', name: 'Study',    min: 30, kind: 'down', subject: '' },
  { mark: '📖', name: 'Reading',  min: 20, kind: 'down', subject: '' },
  { mark: '✍️', name: 'Writing',  min: 45, kind: 'up',   subject: 'english' },
  { mark: '🧪', name: 'Project',  min: 45, kind: 'up',   subject: '' },
  { mark: 'HW', name: 'Homework', min: 30, kind: 'down', subject: '' },
];

var NY_LOCK_NOTES = [
  'YouTube will still be there in 20 minutes. Promise.',
  'Start with the smallest thing on the list.',
  'Two minutes of starting beats twenty minutes of dreading it.',
  'Future you says thanks. Future you also wants to watch that video.',
  'Every video is better with nothing hanging over you.',
  'The list is not going to do itself. I checked.',
  'Nobody has ever regretted finishing early.',
  'Do the boring one first. Then it’s gone forever.',
  'That thumbnail isn’t going anywhere.',
  'Tiny progress still counts.',
  'Phone face down. Yes, that one.',
  'Recommended for you: finishing your homework.',
  'One thing, then the next one. That’s the whole trick.',
  'Close the other tabs. You know which ones.',
];

var NY_BED_NOTES = [
  'The algorithm will still be there tomorrow.',
  'Your pillow misses you.',
  'One more video is never one more video.',
  'Sleep now. Tomorrow-you gets the good mood.',
  'Watch Later exists for exactly this moment.',
  'Your brain saves your progress while you sleep.',
  'Nothing good was ever watched at 1 AM. Okay, almost nothing.',
  'Autoplay is not a bedtime story.',
  'Sleep is free. Take as much as you want.',
  'The comments section can wait.',
  'Lights off. Screen down. Goodnight.',
];

// Sites Not Yet can close. YouTube comes switched on; any other site asks
// Chrome for access the moment it's switched on.
var NY_SITES = [
  { id: 'youtube',   name: 'YouTube',   domains: ['youtube.com'] },
  { id: 'tiktok',    name: 'TikTok',    domains: ['tiktok.com'] },
  { id: 'instagram', name: 'Instagram', domains: ['instagram.com'] },
  { id: 'reddit',    name: 'Reddit',    domains: ['reddit.com'] },
  { id: 'x',         name: 'X',         domains: ['x.com', 'twitter.com'] },
  { id: 'facebook',  name: 'Facebook',  domains: ['facebook.com'] },
  { id: 'snapchat',  name: 'Snapchat',  domains: ['snapchat.com'] },
  { id: 'twitch',    name: 'Twitch',    domains: ['twitch.tv'] },
  { id: 'pinterest', name: 'Pinterest', domains: ['pinterest.com'] },
];

var NY_ACCENTS = ['lilac', 'mint', 'peach', 'sky', 'pink', 'butter'];

var NY_DEFAULTS = {
  v: 1,
  // Bedtime. Times are minutes after the evening's midnight, so 23:00 is 1380
  // and 1:00 AM is 1500. `days` are school days (0 = Sunday); the night before
  // one is a school night.
  bed: { days: [1, 2, 3, 4, 5], school: 23 * 60, other: 24 * 60, wake: 6 * 60, fit: true },
  bedNext: null,          // { bed, from: 'YYYY-MM-DD' }: a later bedtime waiting for tomorrow
  warn: 10,               // minutes of heads-up on YouTube before bedtime; 0 = off
  tags: NY_DEFAULT_TAGS,
  subjects: NY_DEFAULT_SUBJECTS,
  classMark: '',          // text that marks a class event; blank = school days above
  blocks: 'Homework block',
  lockNotes: NY_LOCK_NOTES,
  bedNotes: NY_BED_NOTES,
  sitesOn: ['youtube'],
  sitesOffFrom: {},       // { siteId: 'YYYY-MM-DD' }: switched off, waiting for tomorrow like a later bedtime
  customSites: [],        // [{ id, name, domains: ['example.com'] }]
  theme: 'system',        // 'system' | 'light' | 'dark'
  accent: 'lilac',
  onboarded: false,
  toured: false,
};

// Bedtimes run from 6 PM to 3 AM; YouTube opens between 4 AM and noon.
var NY_BED_MIN = 18 * 60, NY_BED_MAX = 27 * 60;
var NY_WAKE_MIN = 4 * 60, NY_WAKE_MAX = 12 * 60;

function nyClone(x) { return JSON.parse(JSON.stringify(x)); }

function nyNormalize(raw) {
  const c = Object.assign(nyClone(NY_DEFAULTS), raw || {});
  c.bed = nyCleanBed(Object.assign(nyClone(NY_DEFAULTS.bed), (raw && raw.bed) || {}));
  if (c.bedNext && (!c.bedNext.bed || !c.bedNext.from)) c.bedNext = null;
  if (c.bedNext) c.bedNext.bed = nyCleanBed(Object.assign(nyClone(NY_DEFAULTS.bed), c.bedNext.bed));
  if (!Array.isArray(c.tags)) c.tags = nyClone(NY_DEFAULT_TAGS);
  if (!Array.isArray(c.subjects)) c.subjects = nyClone(NY_DEFAULT_SUBJECTS);
  if (!Array.isArray(c.lockNotes)) c.lockNotes = nyClone(NY_LOCK_NOTES);
  if (!Array.isArray(c.bedNotes)) c.bedNotes = nyClone(NY_BED_NOTES);
  c.warn = [0, 5, 10, 15, 30].includes(+c.warn) ? +c.warn : 10;
  if (!Array.isArray(c.customSites)) c.customSites = [];
  const known = new Set([...NY_SITES, ...c.customSites].map(s => s.id));
  c.sitesOn = Array.isArray(c.sitesOn) ? [...new Set(c.sitesOn)].filter(id => known.has(id)) : ['youtube'];
  if (!c.sitesOffFrom || typeof c.sitesOffFrom !== 'object') c.sitesOffFrom = {};
  for (const id of Object.keys(c.sitesOffFrom)) if (!c.sitesOn.includes(id)) delete c.sitesOffFrom[id];
  if (!['system', 'light', 'dark'].includes(c.theme)) c.theme = 'system';
  if (!NY_ACCENTS.includes(c.accent)) c.accent = 'lilac';
  return c;
}

function nyCleanBed(b) {
  const clamp = (v, lo, hi, d) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d;
  return {
    days: Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter(d => d >= 0 && d <= 6))].sort() : [1, 2, 3, 4, 5],
    school: clamp(b.school, NY_BED_MIN, NY_BED_MAX, 23 * 60),
    other:  clamp(b.other,  NY_BED_MIN, NY_BED_MAX, 24 * 60),
    wake:   clamp(b.wake,   NY_WAKE_MIN, NY_WAKE_MAX, 6 * 60),
    fit: b.fit !== false,
  };
}

async function nyLoadConfig() {
  const { config } = await chrome.storage.local.get({ config: null });
  NY_CFG = nyNormalize(config);
  return NY_CFG;
}

async function nySaveConfig(patch) {
  const { config } = await chrome.storage.local.get({ config: null });
  NY_CFG = nyNormalize(Object.assign(nyNormalize(config), patch));
  await chrome.storage.local.set({ config: NY_CFG });
  return NY_CFG;
}

// ── Bedtime changes ─────────────────────────────────────────────────────────
// An earlier bedtime starts right away. A later one starts tomorrow, so
// tonight's bedtime can never be pushed back on the night itself.

function nyDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The bedtime that applies to the evening of date string `ds`.
function nyBedFor(cfg, ds) {
  if (cfg.bedNext && ds >= cfg.bedNext.from) return cfg.bedNext.bed;
  return cfg.bed;
}

// Closing minute for the evening of weekday `dow`, by weekday alone.
function nyCloseOn(bed, dow) { return bed.days.includes((dow + 1) % 7) ? bed.school : bed.other; }

// Would `next` let YouTube stay open anywhere `cur` wouldn't?
function nyBedLooser(cur, next) {
  for (let dow = 0; dow < 7; dow++) if (nyCloseOn(next, dow) > nyCloseOn(cur, dow)) return true;
  if (next.wake < cur.wake) return true;
  if (cur.fit && !next.fit) return true;
  return false;
}

// Returns the new config plus when the change takes effect.
function nyPlanBed(cfg, nextBed, now = new Date()) {
  const next = nyCleanBed(nextBed);
  const current = nyBedFor(cfg, nyDateStr(now));
  const out = nyClone(cfg);
  if (!nyBedLooser(current, next)) {
    out.bed = next; out.bedNext = null;
    return { cfg: out, when: 'now' };
  }
  const t = new Date(now); t.setDate(t.getDate() + 1);
  out.bed = current;
  out.bedNext = { bed: next, from: nyDateStr(t) };
  return { cfg: out, when: out.bedNext.from };
}

// Called at midnight: a waiting bedtime becomes the bedtime, and sites
// switched off yesterday finally switch off. Returns null if nothing changed.
function nyPromoteBed(cfg, now = new Date()) {
  const today = nyDateStr(now);
  const out = nyClone(cfg);
  let changed = false;
  if (out.bedNext && today >= out.bedNext.from) { out.bed = out.bedNext.bed; out.bedNext = null; changed = true; }
  for (const [id, from] of Object.entries(out.sitesOffFrom || {})) {
    if (today >= from) { out.sitesOn = out.sitesOn.filter(x => x !== id); delete out.sitesOffFrom[id]; changed = true; }
  }
  return changed ? out : null;
}

// ── Sites ───────────────────────────────────────────────────────────────────

const nyAllSites = (cfg = NY_CFG) => [...NY_SITES, ...cfg.customSites];

// Sites that are closed while the list isn't done. A site switched off today
// stays on until tomorrow.
function nySitesOn(cfg = NY_CFG, ds = nyDateStr()) {
  return nyAllSites(cfg).filter(s => cfg.sitesOn.includes(s.id) && !(cfg.sitesOffFrom[s.id] && ds >= cfg.sitesOffFrom[s.id]));
}

function nySiteFor(host, cfg = NY_CFG) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  return nyAllSites(cfg).find(s => s.domains.some(d => host === d || host.endsWith('.' + d))) || null;
}

// "YouTube", "YouTube and TikTok", "YouTube + 2 more". Never ends in a full
// stop, so it can sit at the end of a sentence.
function nySitesLabel(cfg = NY_CFG) {
  const on = nySitesOn(cfg);
  if (!on.length) return 'the fun stuff';
  if (on.length === 1) return on[0].name;
  if (on.length === 2) return `${on[0].name} and ${on[1].name}`;
  return `${on[0].name} + ${on.length - 1} more`;
}

// Switching a site on works now; switching one off waits for tomorrow.
function nyPlanSite(cfg, id, on, now = new Date()) {
  const out = nyClone(cfg);
  if (on) {
    if (!out.sitesOn.includes(id)) out.sitesOn.push(id);
    delete out.sitesOffFrom[id];
    return { cfg: out, when: 'now' };
  }
  if (!out.sitesOn.includes(id)) return { cfg: out, when: 'now' };
  const t = new Date(now); t.setDate(t.getDate() + 1);
  out.sitesOffFrom[id] = nyDateStr(t);
  return { cfg: out, when: out.sitesOffFrom[id] };
}

// "https://www.tiktok.com/@x" or "tiktok.com" → "tiktok.com", or null.
function nyCleanDomain(text) {
  let s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = 'https://' + s;
  try {
    const host = new URL(s).hostname.replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch { return null; }
}

// ── Subjects and tags ────────────────────────────────────────────────────────

function nyEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Does `text` contain any of the comma-separated `words`, as whole words?
function nyHasWord(text, words) {
  const list = String(words || '').split(',').map(w => w.trim()).filter(Boolean);
  return list.some(w => {
    const pre = /^\w/.test(w) ? '(?:^|[^\\w])' : '';
    const post = /\w$/.test(w) ? '(?![\\w])' : '';
    return new RegExp(pre + nyEsc(w) + post, 'i').test(text);
  });
}

var NY_OTHER = { id: 'other', name: 'Other', color: 'stone', words: '' };

function nySubject(id, cfg = NY_CFG) {
  return cfg.subjects.find(s => s.id === id) || NY_OTHER;
}

function nyGuessSubject(title, hint = '', cfg = NY_CFG) {
  const hit = cfg.subjects.find(s => nyHasWord(title, s.words));
  if (hit) return hit.id;
  return cfg.subjects.some(s => s.id === hint) ? hint : 'other';
}

function nyBareMark(m) { return String(m || '').replace(/\uFE0F/g, '').trim(); }

// "📝 Worksheet 3.2 [45m]" or "HW: Worksheet" → a task template, or null.
// [45m] sets the minutes, [up] or [down] (or the older [Q]/[M]) the timer.
function nyParseTitle(summary, cfg = NY_CFG) {
  const s = String(summary || '').replace(/\uFE0F/g, '').replace(/^\s+/, '');
  let hit = null, rest = '';
  for (const tag of cfg.tags) {
    const mark = nyBareMark(tag.mark);
    if (!mark) continue;
    if (/^\w/.test(mark)) {
      const m = s.match(new RegExp('^' + nyEsc(mark) + '(?![\\w])\\s*[:\\-–—]?\\s*', 'i'));
      if (m) { hit = tag; rest = s.slice(m[0].length); break; }
    } else if (s.startsWith(mark)) {
      hit = tag; rest = s.slice(mark.length).replace(/^\s*[:\-–—]?\s*/, ''); break;
    }
  }
  if (!hit) return null;
  const est = rest.match(/\[(\d+)\s*m(?:in)?\]/i);
  const typ = rest.match(/\[(up|down|q|m)\]/i);
  const kind = typ ? (/^(up|q)$/i.test(typ[1]) ? 'up' : 'down') : (hit.kind === 'up' ? 'up' : 'down');
  const title = rest.replace(/\[\d+\s*m(?:in)?\]/ig, '').replace(/\[(up|down|q|m)\]/ig, '').replace(/\s{2,}/g, ' ').trim();
  return {
    title: title || hit.name,
    estMin: est ? Math.max(1, +est[1]) : (+hit.min || 30),
    type: kind === 'up' ? 'Q' : 'M',
    courseHint: hit.subject || '',
  };
}

// Recurring blocks: events whose title contains one of these become a task
// timed by the event's own length.
function nyIsBlock(title, cfg = NY_CFG) {
  return nyHasWord(title || '', cfg.blocks);
}

function nyIsClass(title, cfg = NY_CFG) {
  const mark = String(cfg.classMark || '').trim();
  return !!mark && String(title || '').toLowerCase().includes(mark.toLowerCase());
}

// A fresh id for something the person adds in Settings.
function nyId(p = 'x') { return p + '-' + Math.random().toString(36).slice(2, 8); }

// Loaded before anything else reads it; pages and the worker refresh it from storage.
var NY_CFG = nyNormalize({});
