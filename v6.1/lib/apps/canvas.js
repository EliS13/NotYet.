// canvas.js — Canvas LMS, with the school's Canvas address and the student's
// access token (Account → Settings → New access token). Canvas doesn't allow
// calls from pages, so Settings asks Chrome for the school's site when connecting.

const CANVAS_TYPES = ['assignment', 'quiz', 'discussion_topic', 'sub_assignment'];

// "school.instructure.com/courses/5" → "https://school.instructure.com"
function canvasOrigin(text) {
  let s = String(text || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') ? u.origin : null; } catch { return null; }
}

async function canvasFetch(conn, path, opts = {}) {
  if (!conn.token) throw new ConnError('token', 'Canvas');   // a restored backup: no token (and no site permission yet)
  let res;
  try {
    res = await fetch(path.startsWith('https://') ? path : `${conn.school}/api/v1/${path}`, { ...opts,
      headers: { Authorization: 'Bearer ' + conn.token, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw new ConnError('offline', 'Canvas'); }
  if (res.status === 401) throw new ConnError('token', 'Canvas');
  if (res.status === 403) throw new ConnError('school', 'Canvas');
  if (!res.ok) throw new ConnError('failed', 'Canvas');
  const link = (res.headers && res.headers.get && res.headers.get('Link')) || '';
  const next = (/<([^>]+)>;\s*rel="next"/.exec(link) || [])[1] || '';
  return { body: res.status === 204 ? null : await res.json(), next };
}

connRegister('canvas', {
  check: conn => canvasFetch(conn, 'users/self'),
  async list(conn, now = new Date()) {
    const params = new URLSearchParams({ start_date: nyAddDays(now, -CONN_AHEAD).toISOString(),
      end_date: nyAddDays(now, CONN_AHEAD + 1).toISOString(), per_page: '100' });
    const out = [];
    let next = 'planner/items?' + params;
    while (next) {
      const r = await canvasFetch(conn, next);
      for (const it of r.body || []) {
        const s = it.submissions || {}, when = it.plannable_date || (it.plannable && it.plannable.due_at);
        if (!CANVAS_TYPES.includes(it.plannable_type) || !when) continue;
        // Handed in or marked done: kept (done) with its mark, so unticking can undo the mark
        const finished = (it.planner_override && it.planner_override.marked_complete) || s.submitted || s.excused || s.graded;
        out.push({ rid: `${it.plannable_type}~${it.plannable_id}`, title: String((it.plannable && it.plannable.title) || '').trim(),
          due: hwTodayStr(new Date(when)), minutes: null, hint: it.context_name || '',
          meta: { override: it.planner_override ? it.planner_override.id : null }, ...(finished ? { done: true } : {}) });
      }
      next = r.next;
    }
    return out;
  },
  // Canvas keeps one mark per item: the first tick makes it (and it's kept), later ones change it
  async setDone(conn, rid, done, item) {
    const [type, id] = rid.split('~'), override = item && item.meta && item.meta.override;
    if (override) return canvasFetch(conn, `planner/overrides/${override}`, { method: 'PUT', body: JSON.stringify({ marked_complete: done }) });
    const r = await canvasFetch(conn, 'planner/overrides', { method: 'POST', body: JSON.stringify({ plannable_type: type, plannable_id: id, marked_complete: done }) });
    return r.body && r.body.id ? { meta: { override: r.body.id } } : null;
  },
});
