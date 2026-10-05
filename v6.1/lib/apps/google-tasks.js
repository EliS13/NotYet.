// google-tasks.js — Google Tasks for every Google account with Tasks on. The
// Tasks permission is asked for in the same Google window as the calendars
// (lib/gcal.js), or on its own with Turn on. Each task remembers its account.

const GTASKS_API = 'https://tasks.googleapis.com/tasks/v1/';

// Google's errors in Google Tasks' words
async function gtasksApi(url, opts, account) {
  try { return await gcalApi(url, { ...opts, account }); }
  catch (e) {
    const kind = { signin: 'signin', 'signed-out': 'signin', offline: 'offline', denied: 'permission', disabled: 'disabled' }[e.kind] || 'failed';
    throw new ConnError(kind, 'Google Tasks');
  }
}

// '' when this account's task lists can be read, else why not, in words.
async function gtasksCheck(email) {
  try { await gtasksApi(GTASKS_API + 'users/@me/lists', { query: { maxResults: '1' } }, email); return ''; }
  catch (e) { return e.message; }
}

// What's known about each account's tasks: connections.gtasks.accounts[email] = { error, lists }.
async function gtasksNote(email, patch) {
  const c = (await connLoad()).gtasks || {}, accounts = c.accounts || {};
  await connSet('gtasks', { accounts: { ...accounts, [email]: { ...(accounts[email] || {}), ...patch } } });
}

// Turn on: Google's window for the Tasks permission alone, for one account.
// Resolves { ok, tasksError } or { error }.
async function gtasksConnect(email) {
  if (!gcalReady()) return { error: 'unavailable' };
  if (!(await gcalAccountsLoad()).some(a => a.email === email)) return { error: 'signed-out' };
  const state = gcalNonce();
  let url;
  try {
    url = await chrome.identity.launchWebAuthFlow({ interactive: true,
      url: gcalAuthUrl({ interactive: true, email, state, scopes: [GTASKS_SCOPE], prompt: '' }) });
  } catch { return { error: 'closed' }; }
  const r = gcalReadRedirect(url, state, [GTASKS_SCOPE]);
  if (r.error) return { error: r.error === 'scopes' ? 'tasks-scope' : r.error };
  await gcalKeep(email, r.token, r.expires);
  await gcalAccountSet(email, { tasks: true });
  const tasksError = await gtasksCheck(email);
  await gtasksNote(email, { error: tasksError });
  await connSet('gtasks', { on: true });
  return { ok: true, tasksError };
}

// One account removed: its tasks leave the days ahead and the cache, and what was
// known about it goes. The connection stays for the other accounts.
async function gtasksForgetAccount(email) {
  const { connCache = {} } = await chrome.storage.local.get({ connCache: {} });
  const rids = new Set((((connCache.gtasks || {}).items) || []).filter(i => i.account === email).map(i => i.rid));
  await connForget('gtasks', rids);
  const c = (await connLoad()).gtasks;
  if (c && c.accounts) { const accounts = { ...c.accounts }; delete accounts[email]; await connSet('gtasks', { accounts }); }
}

connRegister('gtasks', {
  // One account's lists
  async lists(conn, account) {
    const r = await gtasksApi(GTASKS_API + 'users/@me/lists', { query: { maxResults: '100' } }, account);
    return ((r && r.items) || []).map(l => ({ id: l.id, name: l.title || 'Tasks' }));
  },
  // From every account with Tasks on: open tasks due by two weeks out, then ones
  // finished in the last two days (done). An account that fails, or needs to sign
  // in again, keeps its open tasks from last time, without done marks, and doesn't
  // stop the others. Every account failing is the app failing.
  async list(conn, now = new Date()) {
    const dueMax = nyAddDays(now, CONN_AHEAD + 1).toISOString(), completedMin = nyAddDays(now, -2).toISOString(), out = [];
    const { connCache = {} } = await chrome.storage.local.get({ connCache: {} });
    const kept = email => (((connCache.gtasks || {}).items) || []).filter(i => i.account === email && !i.done);
    const each = async (account, l, query, take) => {
      let page = '';
      do {
        const r = await gtasksApi(GTASKS_API + `lists/${encodeURIComponent(l.id)}/tasks`, { query: { ...query, maxResults: '100', ...(page ? { pageToken: page } : {}) } }, account);
        for (const t of (r && r.items) || []) take(t);
        page = (r && r.nextPageToken) || '';
      } while (page);
    };
    let answered = 0, failure = null;
    for (const a of (await gcalAccountsLoad()).filter(x => x.tasks)) {
      if (a.needsSignIn) { out.push(...kept(a.email)); continue; }
      try {
        const mine = [], on = (await this.lists(conn, a.email)).filter(l => !conn.lists || conn.lists[l.id] !== false);
        for (const l of on) {
          await each(a.email, l, { showCompleted: 'false', showHidden: 'false', dueMax }, t => {
            if (t.due && t.title) mine.push({ rid: `${l.id}~${t.id}`, title: t.title.trim(), due: t.due.slice(0, 10), minutes: null, hint: l.name, account: a.email });
          });
          await each(a.email, l, { showCompleted: 'true', showHidden: 'true', completedMin }, t => {
            if (t.status === 'completed') mine.push({ rid: `${l.id}~${t.id}`, title: String(t.title || '').trim(), due: '', minutes: null, hint: l.name, account: a.email, done: true });
          });
        }
        out.push(...mine);
        answered++;
        await gtasksNote(a.email, { error: '', lists: on.length });
      } catch (e) {
        failure = failure || e;
        out.push(...kept(a.email));
        await gtasksNote(a.email, { error: e.message });
      }
    }
    if (failure && !answered) throw failure;
    const still = new Set((await gcalAccountsLoad()).map(a => a.email));   // an account removed meanwhile stays gone
    return out.filter(i => still.has(i.account));
  },
  // Ticks go back through the task's own account. A task whose account was
  // removed (or that isn't known any more) stays ticked here only: guessing
  // another account would fail, and keep trying.
  async setDone(conn, rid, done, item) {
    const [l, t] = rid.split('~');
    const account = item && item.account;
    if (!account || !(await gcalAccountsLoad()).some(a => a.email === account)) return null;
    return gtasksApi(GTASKS_API + `lists/${encodeURIComponent(l)}/tasks/${encodeURIComponent(t)}`,
      { method: 'PATCH', body: done ? { status: 'completed' } : { status: 'needsAction', completed: null } }, account);
  },
});
