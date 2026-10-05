// todoist.js — Todoist, with the person's own API token (Todoist → Settings →
// Integrations → Developer). Its API allows calls from any page.

const TODOIST_API = 'https://api.todoist.com/api/v1/';

async function todoistFetch(conn, path, opts = {}) {
  if (!conn.token) throw new ConnError('token', 'Todoist');
  let res;
  try {
    res = await fetch(TODOIST_API + path, { ...opts, headers: { Authorization: 'Bearer ' + conn.token,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw new ConnError('offline', 'Todoist'); }
  if (res.status === 401 || res.status === 403) throw new ConnError('token', 'Todoist');
  if (!res.ok) throw new ConnError('failed', 'Todoist');
  return res.status === 204 ? null : res.json();
}

// Every page of a list call, as one array (lists come as `results`; finished tasks as `items`)
async function todoistAll(conn, path, params = {}) {
  const out = [];
  let cursor = null;
  do {
    const r = await todoistFetch(conn, path + '?' + new URLSearchParams({ limit: '200', ...params, ...(cursor ? { cursor } : {}) }));
    out.push(...((r && (r.results || r.items)) || []));
    cursor = r && r.next_cursor;
  } while (cursor);
  return out;
}

connRegister('todoist', {
  check: conn => todoistFetch(conn, 'projects?limit=1'),
  async list(conn, now = new Date()) {
    const projects = Object.fromEntries((await todoistAll(conn, 'projects')).map(p => [p.id, p.name]));
    const tasks = await todoistAll(conn, 'tasks/filter', { query: `overdue | next ${CONN_AHEAD} days` });
    // Finished in the last two days, so today's copy is ticked here too. If
    // Todoist won't say, today's copy just stays as it is.
    const stamp = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const finished = await todoistAll(conn, 'tasks/completed/by_completion_date',
      { since: stamp(nyAddDays(now, -2)), until: stamp(new Date(now.getTime() + 60000)) }).catch(() => []);
    return [...tasks.filter(t => t.due && t.due.date).map(t => ({
      rid: String(t.id), title: String(t.content || '').trim(), due: String(t.due.date).slice(0, 10),
      minutes: t.duration && t.duration.unit === 'minute' ? +t.duration.amount : null, hint: projects[t.project_id] || '',
    })), ...finished.map(t => ({ rid: String(t.id), title: String(t.content || '').trim(), due: '', minutes: null, hint: '', done: true }))];
  },
  setDone: (conn, rid, done) => todoistFetch(conn, `tasks/${encodeURIComponent(rid)}/${done ? 'close' : 'reopen'}`, { method: 'POST' }),
});
