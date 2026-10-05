// gcal.js — Google: signing in with Google's own window (any accounts the
// person picks, one or several), keeping each account's one-hour pass fresh,
// and the Calendar API calls (Google Tasks shares the passes). Talks only to
// Google, straight from the browser. No DOM in here.

// From the Google Cloud project (store/google-setup.md); it isn't a secret. A page or
// test can set NY_GCAL_CLIENT_ID first (the preview's pretend Google); '' means none,
// and then Google sign-in stays hidden and everything else works.
const GCAL_CLIENT_ID = globalThis.NY_GCAL_CLIENT_ID ?? '922319609333-vsvk7p5gd34ij9ifn2u0hci3vuaqgu7n.apps.googleusercontent.com';
const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const GTASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';   // asked for in the same window, and optional
const GCAL_API = 'https://www.googleapis.com/calendar/v3/';
const GCAL_RENEW_EARLY = 5 * 60000;               // renew a pass with less than this left

const gcalReady = () => !!GCAL_CLIENT_ID;

// What went wrong, in words people can act on.
const GCAL_MESSAGES = {
  'signed-out': 'Sign in with Google first.',
  signin: 'Google Calendar needs you to sign in again.',
  offline: 'Couldn’t reach Google. Check your internet and try again.',
  limit: 'Google is busy right now. Try again in a minute.',
  denied: 'Google didn’t allow that change on this calendar.',
  gone: 'That event isn’t in Google Calendar anymore.',
  failed: 'Something went wrong talking to Google. Try again.',
  closed: 'Sign-in didn’t finish. If Google said your school blocks this app, a secret link or a personal Google account still works.',
  access_denied: 'Google didn’t give Not yet. access. If your school manages this Google account, it may block apps like this one; a secret link or a personal Google account still works.',
  admin_policy_enforced: 'Your school’s Google account doesn’t allow this app. You can use a secret link instead, or a personal Google account.',
  scopes: 'Not yet. needs both calendar permissions. Sign in again and leave both boxes ticked.',
  unavailable: 'Google sign-in isn’t set up in this version.',
  'tasks-scope': 'Not yet. needs the Tasks permission. Try again and leave the box ticked.',
  'tasks-off': 'Tasks are off for this account.',
  disabled: 'That Google service isn’t switched on for Not yet. yet.',
};

class GcalError extends Error {
  constructor(kind, account = '') { super(GCAL_MESSAGES[kind] || GCAL_MESSAGES.failed); this.kind = kind; this.account = account; }
}

function gcalNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function gcalAuthUrl({ interactive, email = '', state, scopes = GCAL_SCOPES, prompt = interactive ? 'select_account' : 'none' }) {
  const p = new URLSearchParams({ client_id: GCAL_CLIENT_ID, redirect_uri: chrome.identity.getRedirectURL(),
    response_type: 'token', scope: scopes.join(' '), state, include_granted_scopes: 'true' });
  if (prompt) p.set('prompt', prompt);
  if (email) p.set('login_hint', email);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

// Google sends the pass back in the redirect's #fragment (or an error), with the
// permissions it covers.
function gcalReadRedirect(url, state, need = GCAL_SCOPES) {
  let u;
  try { u = new URL(url); } catch { return { error: 'failed' }; }
  const q = new URLSearchParams(u.hash.replace(/^#/, '') || u.search.replace(/^\?/, ''));
  if (q.get('error')) return { error: q.get('error') };
  if (q.get('state') !== state) return { error: 'failed' };
  const granted = (q.get('scope') || '').split(/\s+/);
  if (!need.every(s => granted.includes(s))) return { error: 'scopes' };
  const token = q.get('access_token');
  if (!token) return { error: 'failed' };
  return { token, expires: Date.now() + (Number(q.get('expires_in')) || 3600) * 1000, granted };
}

// ── Accounts ────────────────────────────────────────────────────────────────
// gcalAccounts: [{ email, connectedAt, needsSignIn, tasks }], in the order added.
// Each account's pass is kept for this browser session only, in gcalTokens.
async function gcalAccountsLoad() { return (await chrome.storage.local.get({ gcalAccounts: [] })).gcalAccounts; }
async function gcalAccountSet(email, patch) {
  const list = await gcalAccountsLoad();
  if (list.some(a => a.email === email)) await chrome.storage.local.set({ gcalAccounts: list.map(a => a.email === email ? { ...a, ...patch } : a) });
}
const gcalSignedIn = raw => !!(raw && (raw.gcalAccounts || []).length);

async function gcalKeep(email, token, expires) {
  const { gcalTokens: all } = await chrome.storage.session.get({ gcalTokens: {} });
  await chrome.storage.session.set({ gcalTokens: { ...all, [email]: { token, expires } } });
}
async function gcalDrop(email) {
  const { gcalTokens: all } = await chrome.storage.session.get({ gcalTokens: {} });
  const t = all[email] || null;
  delete all[email];
  await chrome.storage.session.set({ gcalTokens: all });
  return t;
}

// Opens Google's window for the calendars and Google Tasks together, with
// Google's account picker (and `email` suggested, signing in again). The calendar
// permissions are needed; Tasks is up to them. A new account is added after the
// others; one already here gets its new pass and keeps its choices. Before it
// says connected, the calendars have been read, and the task lists when allowed.
// Resolves { ok, email, added, tasks, tasksError } or { error }.
async function gcalSignIn({ email = '' } = {}) {
  if (!gcalReady()) return { error: 'unavailable' };
  const state = gcalNonce();
  let url;
  try { url = await chrome.identity.launchWebAuthFlow({ url: gcalAuthUrl({ interactive: true, state, email, scopes: [...GCAL_SCOPES, GTASKS_SCOPE] }), interactive: true }); }
  catch { return { error: 'closed' }; }
  const r = gcalReadRedirect(url, state);
  if (r.error) return { error: r.error };
  let items;
  try { items = await gcalListCalendars('', r.token); }
  catch (e) { return { error: e.kind || 'failed' }; }
  const primary = items.find(c => c.primary);
  if (!primary) return { error: 'failed' };
  const who = primary.id;                          // the main calendar's ID is the account's email
  await gcalKeep(who, r.token, r.expires);
  const tasks = r.granted.includes(GTASKS_SCOPE);
  const tasksError = tasks ? await gtasksCheck(who) : '';
  const s = await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [], gcalDefault: '' });
  const had = s.gcalAccounts.some(a => a.email === who);
  const accounts = had ? s.gcalAccounts.map(a => a.email === who ? { ...a, needsSignIn: false, tasks } : a)
    : [...s.gcalAccounts, { email: who, connectedAt: Date.now(), needsSignIn: false, tasks }];
  await chrome.storage.local.set({ gcalAccounts: accounts, gcalCalendars: gcalPutCalendars(s.gcalCalendars, accounts, who, items),
    ...(s.gcalAccounts.length ? {} : { gcalDefault: who }) });
  if (tasks) { await gtasksNote(who, { error: tasksError }); await connSet('gtasks', { on: true }); }
  return { ok: true, email: who, added: !had, tasks, tasksError };
}

async function gcalToken(email) {
  const { gcalTokens: all } = await chrome.storage.session.get({ gcalTokens: {} });
  const t = all[email];
  if (t && t.expires - Date.now() > GCAL_RENEW_EARLY) return t.token;
  return gcalRenew(email);
}

// A fresh pass for one account without showing anything, while the person is
// still signed in to it in this browser. If Google wants them to sign in again,
// that account says so once and stops trying until they do. Calls for the same
// account at the same moment share one try; other accounts renew on their own.
const gcalRenewing = {};
function gcalRenew(email) {
  if (gcalRenewing[email]) return gcalRenewing[email];
  return gcalRenewing[email] = (async () => {
    const a = (await gcalAccountsLoad()).find(x => x.email === email);
    if (!a) throw new GcalError('signed-out', email);
    if (a.needsSignIn) throw new GcalError('signin', email);
    const state = gcalNonce();
    let url;
    try {
      url = await chrome.identity.launchWebAuthFlow({ url: gcalAuthUrl({ interactive: false, email, state }),
        interactive: false, timeoutMsForNonInteractive: 8000 });
    } catch (e) {
      // Only Google wanting them to sign in means "sign in again". No wifi yet
      // (a laptop waking up), a login page on the network or a timeout: try later
      if (!/interaction required/i.test(String(e && e.message))) throw new GcalError('offline', email);
    }
    const r = url ? gcalReadRedirect(url, state) : {};
    if (r.token) { await gcalKeep(email, r.token, r.expires); return r.token; }
    await gcalAccountSet(email, { needsSignIn: true });
    throw new GcalError('signin', email);
  })().finally(() => { delete gcalRenewing[email]; });
}

// One Google API call for `account` (or with `token`, as it is: signing in, before
// the account is known). A 401 gets one quiet renewal and one retry.
async function gcalApi(path, { method = 'GET', query = null, body = null, account = '', token = null } = {}, retried = false) {
  const pass = token || await gcalToken(account);
  const url = (path.startsWith('https://') ? path : GCAL_API + path) + (query ? '?' + new URLSearchParams(query) : '');
  let res;
  try {
    res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + pass, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new GcalError('offline', account); }
  if (res.status === 401 && !retried && !token) {
    await gcalDrop(account);
    return gcalApi(path, { method, query, body, account }, true);
  }
  if (res.status === 401) {
    if (!token) await gcalAccountSet(account, { needsSignIn: true });
    throw new GcalError('signin', account);
  }
  if (res.status === 204) return null;
  if (res.ok) return res.json();
  const text = await res.text().catch(() => '');
  if (res.status === 404 || res.status === 410) throw new GcalError('gone', account);
  if (res.status === 429 || (res.status === 403 && /rateLimit|quota/i.test(text))) throw new GcalError('limit', account);
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(text)) throw new GcalError('disabled', account);
  if (res.status === 403) throw new GcalError('denied', account);
  throw new GcalError('failed', account);
}

// Forgets one account: Google is told to forget its pass, and its calendars go,
// with the months of calendars no other account has (a shared one's are fetched
// again through the account that shows it now). Its tasks leave the days ahead.
// New events that went to one of its calendars go to the next account's main
// calendar. The last account going is signing out.
async function gcalRemoveAccount(email) {
  const t = await gcalDrop(email);
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.token), { method: 'POST', mode: 'no-cors' }).catch(() => {});
  const s = await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [], gcalCache: {}, gcalDefault: '' });
  const accounts = s.gcalAccounts.filter(a => a.email !== email);
  if (!accounts.length) {
    await chrome.storage.local.remove(['gcalAccounts', 'gcalCalendars', 'gcalCache', 'gcalDefault']);
    await connForget('gtasks');
    return;
  }
  const calendars = s.gcalCalendars.filter(c => c.account !== email);
  const theirs = new Set(s.gcalCalendars.filter(c => c.account === email).map(c => c.id));
  const cache = {};
  for (const [id, months] of Object.entries(s.gcalCache)) {
    if (!calendars.some(c => c.id === id)) continue;
    cache[id] = theirs.has(id) ? Object.fromEntries(Object.entries(months).map(([ym, m]) => [ym, { ...m, at: 0 }])) : months;
  }
  const shown = gcalShown({ gcalAccounts: accounts, gcalCalendars: calendars }).filter(c => c.writable);
  const stays = s.gcalDefault === CAL_LOCAL || shown.some(c => c.id === s.gcalDefault);
  const next = shown.find(c => c.primary && c.account === accounts[0].email) || shown.find(c => c.primary) || shown[0];
  await chrome.storage.local.set({ gcalAccounts: accounts, gcalCalendars: calendars, gcalCache: cache,
    gcalDefault: stays ? s.gcalDefault : next ? next.id : CAL_LOCAL });
  await gtasksForgetAccount(email);
}

// Signing out: every account removed. Links and events saved in Not yet. stay.
async function gcalSignOut() {
  for (const a of await gcalAccountsLoad()) await gcalRemoveAccount(a.email);
  await chrome.storage.session.remove('gcalTokens');
  await chrome.storage.local.remove(['gcalAccounts', 'gcalCalendars', 'gcalCache', 'gcalDefault']);
}

// ── Calendars ───────────────────────────────────────────────────────────────
async function gcalListCalendars(account, token = null) {
  const r = await gcalApi('users/me/calendarList', { query: { maxResults: '250', minAccessRole: 'freeBusyReader' }, account, token });
  return ((r && r.items) || []).filter(c => !c.deleted);
}

// One account's calendars from Google's list, keeping choices: this account's
// own, else those of another account's copy of the same calendar. New calendars
// start the way they're ticked in Google Calendar. Main calendar first, then ones
// you can add to, then the rest by name.
function gcalMergeCalendars(items, old = [], account = '', others = []) {
  const rank = c => c.primary ? 0 : c.writable ? 1 : 2;
  return items.map(c => {
    const prev = old.find(o => o.id === c.id) || others.find(o => o.id === c.id);
    return { id: c.id, account, name: c.summaryOverride || c.summary || c.id, access: c.accessRole,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer', primary: !!c.primary,
      color: prev ? prev.color : calNearestColor(c.backgroundColor), on: prev ? prev.on : !!(c.primary || c.selected) };
  }).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
// `email`'s calendars put in among everyone else's, in account order.
function gcalPutCalendars(all, accounts, email, items) {
  const mine = gcalMergeCalendars(items, all.filter(c => c.account === email), email, all.filter(c => c.account !== email));
  return accounts.flatMap(a => a.email === email ? mine : all.filter(c => c.account === a.email));
}

// The calendars Not yet. shows: one per calendar ID, through the account that can
// do the most with it (owner, writer, reader, free/busy). An account that needs to
// sign in again comes after the others, and on a tie the account added first wins.
// Calendars of accounts no longer here show nothing. Keeps the stored order.
const GCAL_RANK = { owner: 0, writer: 1, reader: 2, freeBusyReader: 3 };
function gcalShown(raw) {
  const accounts = (raw && raw.gcalAccounts) || [], cals = (raw && raw.gcalCalendars) || [];
  const order = new Map(accounts.map((a, i) => [a.email, [a.needsSignIn ? 1 : 0, i]]));
  const score = c => { const [out, i] = order.get(c.account); return [out, GCAL_RANK[c.access] ?? 4, i]; };
  const before = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  const best = new Map();
  for (const c of cals) {
    if (!order.has(c.account)) continue;
    const prev = best.get(c.id);
    if (!prev || before(score(c), score(prev))) best.set(c.id, c);
  }
  return cals.filter(c => best.get(c.id) === c);
}
// The account a calendar's calls go through: the one whose copy shows.
async function gcalAccountFor(calendarId) {
  const raw = await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [] });
  const c = gcalShown(raw).find(x => x.id === calendarId);
  if (!c) throw new GcalError(gcalSignedIn(raw) ? 'gone' : 'signed-out');
  return c.account;
}

// A switch or colour belongs to the calendar, so every copy of it changes.
async function gcalSetCalendar(id, patch) {
  const { gcalCalendars } = await chrome.storage.local.get({ gcalCalendars: [] });
  await chrome.storage.local.set({ gcalCalendars: gcalCalendars.map(c => c.id === id ? { ...c, ...patch } : c) });
}

// ── Events ──────────────────────────────────────────────────────────────────
const gcalPath = id => 'calendars/' + encodeURIComponent(id) + '/events';
const gcalEventPath = (cal, id) => gcalPath(cal) + '/' + encodeURIComponent(id);

// One calendar's events in one month ('YYYY-MM'), repeats already expanded.
async function gcalFetchMonth(calendarId, ym, account = '') {
  account = account || await gcalAccountFor(calendarId);
  const [y, m] = ym.split('-').map(Number);
  const query = { singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    timeMin: new Date(y, m - 1, 1).toISOString(), timeMax: new Date(y, m, 1).toISOString() };
  const items = [];
  let page = '';
  do {
    const r = await gcalApi(gcalPath(calendarId), { query: page ? { ...query, pageToken: page } : query, account });
    items.push(...((r && r.items) || []));
    page = (r && r.nextPageToken) || '';
  } while (page);
  return items;
}

// A Calendar API event in the app's shape, without its calendar's name and
// colour (they can change). Free/busy calendars only say when.
function gcalNormalize(item, cal) {
  if (!item || item.status === 'cancelled' || !item.start) return null;
  const allDay = !!item.start.date;
  const busy = !!cal && cal.access === 'freeBusyReader';
  return {
    id: item.id, seriesId: item.recurringEventId || item.id, recurring: !!item.recurringEventId,
    uid: item.iCalUID || '',                         // the UID a secret link to the same calendar carries
    title: busy ? 'Busy' : String(item.summary || '(No title)').trim(), allDay,
    start: allDay ? item.start.date : Date.parse(item.start.dateTime),
    end: allDay ? (item.end && item.end.date) || calNextDs(item.start.date)
      : Date.parse((item.end && item.end.dateTime) || item.start.dateTime),
    place: busy ? '' : item.location || '',
    notes: busy ? '' : String(item.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').slice(0, 2000),
    link: item.htmlLink || '',
  };
}

const GCAL_RRULE = { daily: 'RRULE:FREQ=DAILY', weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY', monthly: 'RRULE:FREQ=MONTHLY', yearly: 'RRULE:FREQ=YEARLY' };

// Start and end for the API. A patch sends both kinds, so switching between
// all-day and timed clears the other.
function gcalWhen(draft, patch = false) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const one = v => draft.allDay
    ? { date: v, ...(patch ? { dateTime: null, timeZone: null } : {}) }
    : { dateTime: new Date(v).toISOString(), timeZone: tz, ...(patch ? { date: null } : {}) };
  return { start: one(draft.start), end: one(draft.end) };
}

// The app's repeat choice a Google series matches, 'custom' when it can't be
// shown here (every other week, an end date, several days…), null for none.
function gcalRepeatOf(recurrence, start) {
  const lines = recurrence || [];
  const rules = lines.filter(r => /^RRULE:/i.test(r));
  if (!rules.length) return null;
  if (rules.length > 1 || lines.some(r => /^(RDATE|EXRULE)/i.test(r))) return 'custom';
  const p = Object.fromEntries(rules[0].slice(6).split(';').map(kv => kv.split('=')));
  if ((p.INTERVAL && p.INTERVAL !== '1') || p.COUNT || p.UNTIL || p.BYSETPOS || p.BYMONTH || p.BYYEARDAY || p.BYWEEKNO) return 'custom';
  const day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][start.getDay()];
  if (p.FREQ === 'DAILY' && !p.BYDAY) return 'daily';
  if (p.FREQ === 'WEEKLY' && p.BYDAY === 'MO,TU,WE,TH,FR') return 'weekdays';
  if (p.FREQ === 'WEEKLY' && (!p.BYDAY || p.BYDAY === day)) return 'weekly';
  if (p.FREQ === 'MONTHLY' && !p.BYDAY && (!p.BYMONTHDAY || +p.BYMONTHDAY === start.getDate())) return 'monthly';
  if (p.FREQ === 'YEARLY' && !p.BYDAY && !p.BYMONTHDAY) return 'yearly';
  return 'custom';
}

// A skipped time of a series, the way Google writes it.
function gcalExdate(series, ds, tz) {
  const ymd = ds.replace(/-/g, '');
  if (series.allDay) return `EXDATE;VALUE=DATE:${ymd}`;
  const t = new Date(calMoveTo(series, ds).start);
  return `EXDATE;TZID=${tz}:${ymd}T${[t.getHours(), t.getMinutes(), 0].map(n => String(n).padStart(2, '0')).join('')}`;
}

async function gcalInsert(calendarId, draft, extra = []) {
  const body = { summary: draft.title, location: draft.place || '', description: draft.notes || '', ...gcalWhen(draft),
    reminders: { useDefault: true }, ...(draft.repeat ? { recurrence: [GCAL_RRULE[draft.repeat], ...extra] } : {}) };
  return gcalApi(gcalPath(calendarId), { method: 'POST', body, account: await gcalAccountFor(calendarId) });
}
const gcalPatch = async (calendarId, eventId, body) => gcalApi(gcalEventPath(calendarId, eventId), { method: 'PATCH', body, account: await gcalAccountFor(calendarId) });
const gcalDelete = async (calendarId, eventId) => gcalApi(gcalEventPath(calendarId, eventId), { method: 'DELETE', account: await gcalAccountFor(calendarId) });
const gcalGet = async (calendarId, eventId) => gcalApi(gcalEventPath(calendarId, eventId), { account: await gcalAccountFor(calendarId) });

// Google's lists again for every account that's signed in, keeping choices. An
// account Google won't answer keeps the calendars it had. Saved onto what's stored
// by then, so an account added or removed meanwhile stands. Forgets the months of
// calendars no account has any more. Throws only when no account answered.
async function gcalRefreshCalendars() {
  const { gcalAccounts } = await chrome.storage.local.get({ gcalAccounts: [] });
  const got = {};
  let failure = null;
  for (const a of gcalAccounts) {
    if (a.needsSignIn) continue;
    try { got[a.email] = await gcalListCalendars(a.email); } catch (e) { failure = failure || e; }
  }
  const now = await chrome.storage.local.get({ gcalAccounts: [], gcalCalendars: [], gcalCache: {} });
  let all = now.gcalCalendars;
  for (const [email, items] of Object.entries(got))
    if (now.gcalAccounts.some(a => a.email === email)) all = gcalPutCalendars(all, now.gcalAccounts, email, items);
  for (const id of Object.keys(now.gcalCache)) if (!all.some(c => c.id === id)) delete now.gcalCache[id];
  await chrome.storage.local.set({ gcalCalendars: all, gcalCache: now.gcalCache });
  if (failure && !Object.keys(got).length) throw failure;
  return all;
}

// Google's link to an event, opening in the account it came from.
function gcalLinkFor(link, email) {
  try { const u = new URL(link); u.searchParams.set('authuser', email); return String(u); } catch { return link; }
}

// Before several accounts, the one account was kept as gcalAccount (and a backup
// from then still has it): it becomes the first of gcalAccounts, its calendars and
// its Google Tasks get its email, and its old pass goes (the next call renews it
// quietly). Run again, it changes nothing. Resolves whether it moved anything.
async function gcalMigrate() {
  const s = await chrome.storage.local.get({ gcalAccount: null, gcalAccounts: null, gcalCalendars: [], connections: {}, connCache: {} });
  if (!s.gcalAccount) return false;
  if (s.gcalAccounts) { await chrome.storage.local.remove('gcalAccount'); return false; }
  const email = s.gcalAccount.email, gt = s.connCache.gtasks;
  await chrome.storage.local.set({
    gcalAccounts: [{ email, connectedAt: s.gcalAccount.connectedAt || Date.now(), needsSignIn: !!s.gcalAccount.needsSignIn,
      tasks: !!(s.connections.gtasks && s.connections.gtasks.on) }],
    gcalCalendars: s.gcalCalendars.map(c => ({ ...c, account: email })),
    ...(gt ? { connCache: { ...s.connCache, gtasks: { ...gt, items: (gt.items || []).map(i => ({ ...i, account: email })) } } } : {}),
  });
  await chrome.storage.local.remove('gcalAccount');
  await chrome.storage.session.remove('gcalToken');
  return true;
}
