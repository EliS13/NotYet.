// ms-todo.js — Microsoft To Do: signing in with Microsoft's own window (code +
// PKCE, no secret), keeping its one-hour pass fresh quietly, and Graph calls.
// The client ID comes from store/microsoft-setup.md; '' hides the Connect button.

const MS_CLIENT_ID_BUILTIN = '';
const msClientId = () => globalThis.NY_MS_CLIENT_ID ?? MS_CLIENT_ID_BUILTIN;
const msReady = () => !!msClientId();
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/';
const MS_GRAPH = 'https://graph.microsoft.com/v1.0/';
const MS_SCOPES = 'Tasks.ReadWrite User.Read offline_access';

const msB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Microsoft's window (or a quiet try), then the code swapped for a pass.
async function msAuthorize({ interactive, email = '' }) {
  const verifier = msB64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = msB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = gcalNonce();
  const p = new URLSearchParams({ client_id: msClientId(), response_type: 'code', response_mode: 'query',
    redirect_uri: chrome.identity.getRedirectURL(), scope: MS_SCOPES, state, code_challenge: challenge,
    code_challenge_method: 'S256', prompt: interactive ? 'select_account' : 'none' });
  if (email) p.set('login_hint', email);
  let url;
  try {
    url = await chrome.identity.launchWebAuthFlow({ url: MS_AUTH + 'authorize?' + p, interactive,
      ...(interactive ? {} : { timeoutMsForNonInteractive: 8000, abortOnLoadForNonInteractive: false }) });   // Microsoft hops through pages that redirect by script
  } catch (e) {
    if (interactive) return { error: 'closed' };
    return { error: /interaction required/i.test(String(e && e.message)) ? 'signin' : 'offline' };
  }
  const q = new URL(url).searchParams;
  if (q.get('error')) return { error: /interaction_required|login_required|consent_required/.test(q.get('error')) ? 'signin' : q.get('error') };
  if (q.get('state') !== state || !q.get('code')) return { error: 'failed' };
  let res;
  try {
    res = await fetch(MS_AUTH + 'token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: msClientId(), grant_type: 'authorization_code', code: q.get('code'),
        redirect_uri: chrome.identity.getRedirectURL(), code_verifier: verifier, scope: MS_SCOPES }) });
  } catch { return { error: 'offline' }; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) return { error: 'failed' };
  await chrome.storage.session.set({ msToken: { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 } });
  return { ok: true };
}

let msRenewing = null;
async function msToken() {
  const { msToken: t } = await chrome.storage.session.get({ msToken: null });
  if (t && t.expires - Date.now() > 5 * 60000) return t.token;
  msRenewing ||= (async () => {
    const conn = (await connLoad()).mstodo;
    if (!conn || conn.needsSignIn) throw new ConnError('signin', 'Microsoft To Do');
    const r = await msAuthorize({ interactive: false, email: conn.account });
    if (r.ok) return (await chrome.storage.session.get({ msToken: null })).msToken.token;
    if (r.error === 'offline') throw new ConnError('offline', 'Microsoft To Do');
    await connSet('mstodo', { needsSignIn: true });
    throw new ConnError('signin', 'Microsoft To Do');
  })().finally(() => { msRenewing = null; });
  return msRenewing;
}

async function msApi(path, { method = 'GET', body = null } = {}, retried = false) {
  const token = await msToken();
  let res;
  try {
    res = await fetch(path.startsWith('https://') ? path : MS_GRAPH + path, { method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new ConnError('offline', 'Microsoft To Do'); }
  if (res.status === 401 && !retried) { await chrome.storage.session.remove('msToken'); return msApi(path, { method, body }, true); }
  if (res.status === 401) throw new ConnError('signin', 'Microsoft To Do');
  if (res.status === 403) throw new ConnError('school', 'Microsoft To Do');
  if (!res.ok) throw new ConnError('failed', 'Microsoft To Do');
  return res.status === 204 ? null : res.json();
}

async function mstodoConnect() {
  if (!msReady()) return { error: 'unavailable' };
  const r = await msAuthorize({ interactive: true });
  if (r.error) return r;
  let me;
  try { me = await msApi('me'); } catch (e) { return { error: e.kind || 'failed' }; }
  await connSet('mstodo', { on: true, account: me.userPrincipalName || me.mail || '', lists: {}, needsSignIn: false, error: '' });
  return { ok: true };
}

// To Do keeps a due day as that day's midnight where it was set, sent in UTC:
// the nearest local midnight is the day.
function msDueDay(d) {
  if (!d || !d.dateTime) return '';
  const s = String(d.dateTime);
  if (!/^utc$/i.test(d.timeZone || 'UTC')) return s.slice(0, 10);
  const at = Date.parse(s.slice(0, 19) + 'Z');
  return Number.isFinite(at) ? hwTodayStr(new Date(at + 12 * 3600000)) : '';
}

connRegister('mstodo', {
  async lists() {
    const r = await msApi('me/todo/lists');
    return ((r && r.value) || []).map(l => ({ id: l.id, name: l.displayName || 'Tasks' }));
  },
  // Open tasks due by two weeks out, then ones finished lately (done). If To Do
  // won't list those, today's copies just stay as they are.
  async list(conn, now = new Date()) {
    const last = hwTodayStr(nyAddDays(now, CONN_AHEAD)), out = [];
    const each = async (l, filter, take) => {
      let next = `me/todo/lists/${encodeURIComponent(l.id)}/tasks?` + new URLSearchParams({ $filter: filter, $top: '100' });
      while (next) {
        const r = await msApi(next);
        for (const t of (r && r.value) || []) take(t);
        next = (r && r['@odata.nextLink']) || '';
      }
    };
    for (const l of await this.lists(conn)) {
      if (conn.lists && conn.lists[l.id] === false) continue;
      await each(l, "status ne 'completed'", t => {
        const due = msDueDay(t.dueDateTime);
        if (due && due <= last && t.title) out.push({ rid: `${l.id}~${t.id}`, title: t.title.trim(), due, minutes: null, hint: l.name });
      });
      const since = nyAddDays(now, -2).toISOString().replace(/\.\d{3}Z$/, 'Z');
      await each(l, `status eq 'completed' and lastModifiedDateTime ge ${since}`, t => {
        if (t.status === 'completed') out.push({ rid: `${l.id}~${t.id}`, title: String(t.title || '').trim(), due: '', minutes: null, hint: l.name, done: true });
      }).catch(() => {});
    }
    return out;
  },
  setDone(conn, rid, done) {
    const [l, t] = rid.split('~');
    return msApi(`me/todo/lists/${encodeURIComponent(l)}/tasks/${encodeURIComponent(t)}`,
      { method: 'PATCH', body: { status: done ? 'completed' : 'notStarted' } });
  },
});
