// connections.js — other apps' tasks in Not yet. (Todoist, Google Tasks through
// the Google card, Microsoft To Do, Canvas): the gallery's list of apps, fetching
// each connected one, and ticking tasks back. Each app's own calls live in lib/apps/<app>.js
// and register here. No DOM in here.

const CONN_AHEAD = 14;                     // days ahead that come in (and overdue ones)
const CONN_TTL = 9 * 60000;                // an app is fetched at most this often unless forced

// Every card in Settings → Connections. kind: tasks | calendar, or both (Google).
// status: connect | link | soon.
// how: token | google | microsoft | canvas | gcal | link. mark: a letter, an
// icon name, or 'google' for Google's G, drawn on a tile in `color`.
// **Words** in steps are shown bold.
const CONN_APPS = [
  { id: 'todoist', name: 'Todoist', kind: 'tasks', status: 'connect', how: 'token', mark: 'T', color: '#e44332',
    blurb: 'Tasks with a due date, ticked back when you finish them',
    comes: 'Tasks due in the next two weeks, and overdue ones on today. The length comes from the task’s duration.',
    changes: 'Ticks a task done in Todoist when you tick it here, and reopens it if you untick it. Nothing else.',
    steps: ['Open Todoist and go to **Settings → Integrations**.', 'Open **Developer** and copy your **API token**.', 'Paste it here.'] },
  { id: 'gcal', name: 'Google', kind: ['calendar', 'tasks'], status: 'connect', how: 'gcal', mark: 'google', color: '#1a73e8',
    blurb: 'Calendars and tasks from your Google accounts',
    comes: 'Events from the calendars you pick, and Google Tasks with a due date in the next two weeks or overdue.',
    changes: 'Adds, changes and deletes the events you choose to here. Marks a task completed in Google Tasks when you tick it here, and not completed if you untick it.' },
  { id: 'mstodo', name: 'Microsoft To Do', kind: 'tasks', status: 'connect', how: 'microsoft', mark: 'M', color: '#2564cf',
    blurb: 'Your To Do lists, with Outlook’s flagged tasks',
    comes: 'Tasks with a due date from the lists you pick, due in the next two weeks or overdue.',
    changes: 'Marks a task completed in To Do when you tick it here, and not started if you untick it.' },
  { id: 'canvas', name: 'Canvas', kind: 'tasks', status: 'connect', how: 'canvas', mark: 'C', color: '#e13f2b',
    blurb: 'Assignments and quizzes from your courses',
    comes: 'Assignments, quizzes and discussions due in the next two weeks that you haven’t handed in, with their course as the subject.',
    changes: 'Marks them done in your Canvas planner when you tick them here. It never hands anything in.',
    steps: ['Open Canvas and go to **Account → Settings**.', 'Under **Approved integrations**, click **New access token**, name it “Not yet.” and copy it.', 'Paste your school’s Canvas address and the token here.'] },
  { id: 'outlook', name: 'Outlook Calendar', kind: 'calendar', status: 'link', how: 'link', mark: 'O', color: '#0078d4',
    blurb: 'Outlook and school Microsoft calendars, through a published link',
    steps: ['In Outlook on the web, open **Settings → Calendar → Shared calendars**.', 'Under **Publish a calendar**, pick your calendar and **Can view all details**, then **Publish**.', 'Copy the **ICS** link and paste it here.'] },
  { id: 'canvascal', name: 'Canvas Calendar', kind: 'calendar', status: 'link', how: 'link', mark: 'C', color: '#e13f2b',
    blurb: 'Your courses’ calendar feed',
    steps: ['In Canvas, open **Calendar**.', 'Click **Calendar Feed** and copy the link.', 'Paste it here.'] },
  { id: 'schoology', name: 'Schoology', kind: 'calendar', status: 'link', how: 'link', mark: 'S', color: '#0077c8',
    blurb: 'Your Schoology calendar, through its iCal feed',
    steps: ['In Schoology, open **Calendar**.', 'Click **iCal feed** and copy the link.', 'Paste it here.'] },
  { id: 'ical', name: 'Any calendar', kind: 'calendar', status: 'link', how: 'link', mark: 'link', color: '#8b87a1',
    blurb: 'Any calendar with an iCal or webcal link',
    steps: ['Find your calendar’s **iCal**, **ICS** or **webcal** link in its settings.', 'Paste it here.'] },
  { id: 'notion', name: 'Notion', kind: 'tasks', status: 'soon', mark: 'N', color: '#191919', blurb: 'A homework database' },
  { id: 'ticktick', name: 'TickTick', kind: 'tasks', status: 'soon', mark: 'T', color: '#4772fa', blurb: 'Tasks and lists' },
  { id: 'classroom', name: 'Google Classroom', kind: 'tasks', status: 'soon', mark: 'google', color: '#1e8e3e', blurb: 'Assignments from your classes' },
];
const connKinds = app => [].concat(app.kind);
// Google Tasks has no card of its own (it's part of Google), but its tasks still say where they came from
const connName = id => id === 'gtasks' ? 'Google Tasks' : (CONN_APPS.find(a => a.id === id) || { name: id }).name;

// What went wrong, in words people can act on.
const CONN_MESSAGES = {
  token: app => `${app} didn’t accept that token. Paste a new one.`,
  signin: app => `${app} needs you to sign in again.`,
  permission: app => `${app} needs permission again. Connect it again and leave the box ticked.`,
  offline: () => 'Couldn’t reach it. Check your internet and try again.',
  school: app => `Your school turned this off in ${app}. Ask your teacher, or add a calendar link instead.`,
  address: () => 'That doesn’t look like a Canvas address. It’s the start of your Canvas page, like school.instructure.com.',
  unavailable: app => `${app} isn’t set up in this version yet.`,
  disabled: app => `${app} isn’t switched on for Not yet. yet.`,
  failed: app => `Something went wrong talking to ${app}. Try again.`,
};
class ConnError extends Error {
  constructor(kind, app = 'the app') { super((CONN_MESSAGES[kind] || CONN_MESSAGES.failed)(app)); this.kind = kind; }
}

// Each app file registers { list, setDone, check?, lists? } here.
const CONN_API = {};
const connRegister = (id, api) => { CONN_API[id] = api; };
const connApi = id => CONN_API[id] || null;

async function connLoad() { return (await chrome.storage.local.get({ connections: {} })).connections; }
async function connSet(id, patch) {
  const all = await connLoad();
  all[id] = { ...(all[id] || {}), ...patch };
  await chrome.storage.local.set({ connections: all });
  return all[id];
}
async function connAny() { return Object.values(await connLoad()).some(c => c && c.on); }

// Fetches every connected app (in parallel; one failing doesn't stop the
// others), caching what comes back and noting errors on the connection.
async function connRefresh({ force = false } = {}) {
  const conns = await connLoad(), now = Date.now();
  const { connCache = {} } = await chrome.storage.local.get({ connCache: {} });
  const got = {}, errs = {};
  await Promise.all(Object.entries(conns).map(async ([id, c]) => {
    const api = connApi(id);
    if (!c || !c.on || !api) return;
    if (!force && connCache[id] && now - connCache[id].at < CONN_TTL) return;
    try { got[id] = { at: now, items: await api.list(c, new Date(now)) }; errs[id] = ''; }
    catch (e) { errs[id] = (e && e.message) || CONN_MESSAGES.failed(connName(id)); }
  }));
  if (!Object.keys(errs).length) return;
  // Onto what's stored now, so a connection made or removed meanwhile stands
  const { connCache: cache = {}, connections: all = {} } = await chrome.storage.local.get({ connCache: {}, connections: {} });
  for (const [id, err] of Object.entries(errs)) {
    if (!all[id]) continue;
    if (got[id]) cache[id] = got[id];
    all[id] = { ...all[id], error: err, ...(err ? {} : { lastSync: now }) };
  }
  await chrome.storage.local.set({ connCache: cache, connections: all });
}

// From the apps whose last fetch worked (`live`): their open tasks due by two
// weeks out (overdue too), and the ids of tasks they say were finished. An app
// that can't be reached adds nothing and finishes nothing: its cache may be old.
async function connCollect(now = new Date()) {
  const { connections: all = {}, connCache: cache = {} } = await chrome.storage.local.get({ connections: {}, connCache: {} });
  const last = hwTodayStr(nyAddDays(now, CONN_AHEAD)), items = [], done = new Set(), live = new Set();
  for (const [id, c] of Object.entries(all)) {
    if (!c || !c.on || !cache[id] || c.error) continue;
    live.add(id);
    for (const it of cache[id].items || []) {
      if (it.done) done.add(`x-${id}-${it.rid}`);
      else if (it.due && it.due <= last) items.push({ ...it, app: id, id: `x-${id}-${it.rid}` });
    }
  }
  return { items, done, live };
}

const connIdParts = id => { const m = /^x-([a-z]+)-(.+)$/.exec(id || ''); return m ? { app: m[1], rid: m[2] } : null; };

// An imported task as a task: a tag (📝 Essay [45m]) is read like a calendar
// event's; otherwise a trailing [45m] sets the length, then the app's own.
function connTemplate(it) {
  const tagged = nyParseTitle(it.title);
  if (tagged) return { title: tagged.title, estMin: it.minutes || tagged.estMin, type: tagged.type, courseHint: tagged.courseHint };
  const m = /\s*\[(\d{1,3})\s*m\]\s*$/i.exec(it.title);
  return { title: m ? it.title.slice(0, m.index).trim() : it.title, estMin: it.minutes || (m ? +m[1] : 30), type: 'M', courseHint: '' };
}

// Ticking an imported task here ticks it in its app. If the app can't be
// reached the tick stays, and the task carries pendingDone until a sync gets
// it through. An app's setDone may resolve { meta } to keep on the item (Canvas's
// mark). Resolves 'ok' or 'queued'.
async function connTickBack(ds, id, done) {
  const p = connIdParts(id), conn = p && (await connLoad())[p.app], api = p && connApi(p.app);
  if (!p || !conn || !conn.on || !api) return 'ok';
  const { connCache = {} } = await chrome.storage.local.get({ connCache: {} });
  const item = ((connCache[p.app] || {}).items || []).find(x => x.rid === p.rid);
  let ok = true, back = null;
  try { back = await api.setDone(conn, p.rid, done, item); } catch { ok = false; }
  if (ok && item) {                            // the cache says what the app says now, so an old fetch can't bring it back
    const { connCache: cache = {} } = await chrome.storage.local.get({ connCache: {} });
    const it = ((cache[p.app] || {}).items || []).find(x => x.rid === p.rid);
    if (it) {
      if (done) it.done = true; else delete it.done;
      if (back && back.meta) it.meta = { ...it.meta, ...back.meta };
      await chrome.storage.local.set({ connCache: cache });
    }
  }
  await hwMutate(hw => {
    const t = (hw.hwTasksByDay[ds] || []).find(x => x.id === id);
    if (!t) return;
    if (ok) delete t.pendingDone; else t.pendingDone = done;
  });
  return ok ? 'ok' : 'queued';
}

async function connRetryTicks() {
  const hw = await getHwState();
  for (const [ds, list] of Object.entries(hw.hwTasksByDay))
    for (const t of list) if ('pendingDone' in t) await connTickBack(ds, t.id, t.pendingDone);
}

// Disconnecting: the app's tasks leave the days ahead (not today's, and not
// ones done, started or edited), then the connection and its cache go. With
// `rids`, only those tasks go (one account of an app), and the connection stays.
async function connForget(id, rids = null) {
  const today = hwTodayStr(), prefix = `x-${id}-`;
  const mine = t => t.id.startsWith(prefix) && (!rids || rids.has(t.id.slice(prefix.length)));
  await hwMutate((hw, timers) => {
    for (const [ds, list] of Object.entries(hw.hwTasksByDay)) {
      if (ds <= today) continue;
      const keep = list.filter(t => !mine(t) || t.done || t.edited || timers[t.id]);
      if (keep.length) hw.hwTasksByDay[ds] = keep; else delete hw.hwTasksByDay[ds];
    }
  });
  const { connections: all = {}, connCache: cache = {} } = await chrome.storage.local.get({ connections: {}, connCache: {} });
  if (rids) { if (cache[id]) cache[id] = { ...cache[id], items: (cache[id].items || []).filter(it => !rids.has(it.rid)) }; }
  else { delete all[id]; delete cache[id]; }
  await chrome.storage.local.set({ connections: all, connCache: cache });
}
