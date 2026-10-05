// settings-connections.js — Settings → Connections: every app Not yet. works
// with, as cards; each opens a sheet saying what comes in, what Not yet. can
// change there, and how to connect it. Calendars live here too: Google's sheet
// has each account with its calendars and its task lists, and each link card
// lists the secret links that belong to it (calFeedApp).

function nySettingsConnections({ saved }) {
  const grid = $('#cn-grid'), filters = $('#cn-filters');
  const FILTERS = [['all', 'All'], ['tasks', 'Tasks'], ['calendar', 'Calendars']];
  let show = 'all';

  // **bold** words in the steps
  const rich = text => String(text).split(/\*\*(.+?)\*\*/).map((s, i) => i % 2 ? h('b', { text: s }) : s);
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    return hwTodayStr(new Date(ts)) === hwTodayStr() ? 'at ' + nyClock(ts) : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const isCal = app => app.how === 'gcal' || app.how === 'link';

  async function state() {
    const [raw, s] = await Promise.all([calLoadRaw(), chrome.storage.local.get({ connections: {}, hwLastSync: 0 })]);
    return { conns: s.connections, accounts: raw.gcalAccounts, raw, lastSync: s.hwLastSync };
  }
  const feedsOf = (app, s) => s.raw.calFeeds.filter(f => calFeedApp(f.url) === app.id);

  function statusOf(app, s) {
    if (app.status === 'soon') return ['soon', 'Coming soon'];
    if (isCal(app)) {
      const feeds = feedsOf(app, s), accounts = app.how === 'gcal' ? s.accounts : [];
      if (!feeds.length && !accounts.length) return ['go', app.how === 'gcal' ? 'Connect' : 'Add link'];
      const notes = (s.conns.gtasks || {}).accounts || {};
      const bad = accounts.some(a => a.needsSignIn || (a.tasks && (notes[a.email] || {}).error))
        || feeds.some(f => f.on && (s.raw.feedCache[f.id] || {}).error);
      return bad ? ['warn', 'Needs attention'] : ['on', 'Connected'];
    }
    const on = s.conns[app.id] && s.conns[app.id].on ? s.conns[app.id] : null;
    if (!on) return ['go', 'Connect'];
    return on.needsSignIn || on.error ? ['warn', 'Needs attention'] : ['on', 'Connected'];
  }
  function subOf(app, s, key) {
    if (key !== 'on' && key !== 'warn') return app.blurb;
    if (isCal(app)) {
      const accounts = app.how === 'gcal' ? s.accounts : [], notes = (s.conns.gtasks || {}).accounts || {};
      const n = feedsOf(app, s).length + (accounts.length ? gcalShown(s.raw).filter(c => c.on).length : 0);
      const lists = accounts.filter(a => a.tasks).reduce((sum, a) => sum + ((notes[a.email] || {}).lists || 0), 0);
      return [accounts.length > 1 ? `${accounts.length} accounts` : '', `${n} calendar${n === 1 ? '' : 's'}`,
        lists ? `${lists} list${lists === 1 ? '' : 's'}` : '', s.lastSync ? 'synced ' + ago(s.lastSync) : ''].filter(Boolean).join(' · ');
    }
    const c = s.conns[app.id];
    return c && c.lastSync ? `Synced ${ago(c.lastSync)}` : app.blurb;
  }

  async function render() {
    const s = await state();
    filters.replaceChildren(...FILTERS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(show === k),
      onclick: () => { show = k; render(); } }, label)));
    grid.replaceChildren(...CONN_APPS.filter(a => show === 'all' || connKinds(a).includes(show)).map(app => {
      const [key, text] = statusOf(app, s);
      return nyCard({ tile: nyTile('app', app), name: app.name, status: [key, text], sub: subOf(app, s, key), label: `${app.name}: ${text}`,
        onOpen: key === 'soon' ? null : () => open(app) });
    }));
  }

  // ── The sheet ─────────────────────────────────────────────────────────────
  function open(app) {
    const sheet = nySheet({ tile: nyTile('app', app, { size: 48 }), name: app.name });
    const body = sheet.body, say = sheet.say;
    const block = (title, ...kids) => kids.some(k => k != null && k !== '') ? h('div', { class: 'sc-block' }, h('h3', { text: title }), ...kids) : null;
    const para = text => text ? h('p', {}, ...rich(text)) : null;
    const steps = () => app.steps ? h('ol', { class: 'cn-steps' }, ...app.steps.map(t => h('li', {}, ...rich(t)))) : null;
    let lists = null, syncing = false;                // an app's lists, fetched once per opening
    let drawN = 0;                                    // a draw that finishes after a later one started is dropped

    async function draw() {
      const n = ++drawN;
      const s = await state(), [key, text] = statusOf(app, s), c = s.conns[app.id];
      sheet.setStatus(key === 'go' ? null : [key, text]);   // "Connect" here would look like a button that isn't one
      const kids = [block('What comes in', para(app.comes)), block('What Not yet. can change', para(app.changes))];
      if (app.how === 'gcal') kids.push(...gcalPart(s));
      else if (app.how === 'link') kids.push(...linkPart(s));
      else if (c && c.on) kids.push(...await connectedPart(c));
      else kids.push(...connectPart(s));
      if (n !== drawN) return;
      body.replaceChildren(...kids.filter(Boolean));
    }
    sheet.refresh = draw;

    // Connected: its health, the lists to include, sync, disconnect
    async function connectedPart(c) {
      const out = [];
      if (c.needsSignIn || c.error) out.push(h('p', { class: 'sc-warn' }, c.error || CONN_MESSAGES.signin(app.name)));
      else if (c.lastSync) out.push(h('p', { class: 'sc-ok', text: `Connected${c.account ? ' as ' + c.account : ''}. Synced ${ago(c.lastSync)}.` }));
      const api = connApi(app.id);
      if (api && api.lists) {
        try {
          lists ||= await api.lists(c);
          out.push(block('Lists', h('div', { class: 'cn-lists' }, ...lists.map(l =>
            h('div', { class: 'cn-list' }, h('span', { text: l.name }),
              nySwitch(!c.lists || c.lists[l.id] !== false, `Include ${l.name}`, async () => {
                const now = (await connLoad())[app.id] || c;             // fresh, so two quick flips both count
                await connSet(app.id, { lists: { ...(now.lists || {}), [l.id]: !!(now.lists && now.lists[l.id] === false) } });
                await syncNow(); }))))));
        } catch (e) { out.push(h('p', { class: 'sc-warn', text: e.message })); }
      }
      if (c.needsSignIn || (c.error && app.how !== 'token' && app.how !== 'canvas')) out.push(...connectPart(await state(), 'Sign in again'));
      if (app.how === 'token' || app.how === 'canvas') out.push(h('details', { class: 'cn-change' }, h('summary', { text: 'Change the token' }), ...connectPart(await state())));
      out.push(h('div', { class: 'sc-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: syncNow }, icon('sync', 15), 'Sync now'),
        h('button', { type: 'button', class: 'btn btn-sm btn-quiet sc-danger', onclick: disconnect }, 'Disconnect')));
      return out;
    }

    const redraw = () => nyTyping(sheet.box) ? null : draw();        // never under someone's typing; their change redraws it
    async function syncNow() {
      say('Syncing…', false);
      await connRefresh({ force: true });
      await hwSyncFromCalendar({ force: true }).catch(() => {});
      say('');
      redraw();
    }
    async function disconnect() {
      if (!(await confirmBox({ title: `Disconnect ${app.name}?`, body: `Its tasks leave the days ahead here. Nothing changes in ${app.name}.`, yes: 'Disconnect', danger: true }))) return;
      if (app.id === 'mstodo') await chrome.storage.session.remove('msToken');
      await connForget(app.id);
      saved(`Disconnected ${app.name}`);
      draw();
    }
    const connected = async () => { saved(`Connected ${app.name}`); await syncNow(); };

    // Not connected yet: the way in for each kind of app
    function connectPart(s, again = '') {
      if (app.how === 'token') {
        const field = h('input', { class: 'input', type: 'password', placeholder: 'Paste your API token', 'aria-label': 'Todoist API token', autocomplete: 'off' });
        const go = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
          const token = field.value.trim();
          if (!token) { say('Paste the token first.'); field.focus(); return; }
          say('Checking…', false);
          try { await connApi('todoist').check({ token }); } catch (e) { say(e.message); return; }
          await connSet('todoist', { on: true, token, error: '' });
          await connected();
        } }, 'Connect');
        return [steps(), h('div', { class: 'sc-field' }, field, go)];
      }
      if (app.how === 'canvas') {
        const school = h('input', { class: 'input', placeholder: 'school.instructure.com', 'aria-label': 'Your Canvas address', autocomplete: 'off' });
        const field = h('input', { class: 'input', type: 'password', placeholder: 'Paste your access token', 'aria-label': 'Canvas access token', autocomplete: 'off' });
        const go = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
          const origin = canvasOrigin(school.value), token = field.value.trim();
          if (!origin) { say(CONN_MESSAGES.address()); school.focus(); return; }
          if (!(await chrome.permissions.request({ origins: [origin + '/*'] }))) { say('To reach Canvas, Chrome needs you to choose Allow. Press Connect to try again.'); return; }
          if (!token) { say('Paste the token first.'); field.focus(); return; }
          say('Checking…', false);
          try { await connApi('canvas').check({ school: origin, token }); } catch (e) { say(e.message); return; }
          await connSet('canvas', { on: true, school: origin, token, error: '' });
          await connected();
        } }, 'Connect');
        return [steps(), h('p', { class: 'sc-note', text: 'No “New access token” button? Your school turned it off. Add your Canvas calendar link instead.' }),
          h('div', { class: 'sc-field col' }, school, h('div', { class: 'sc-field' }, field, go))];
      }
      if (app.how === 'microsoft') {
        if (!msReady()) return [h('p', { class: 'sc-note', text: CONN_MESSAGES.unavailable(app.name) })];
        return [h('button', { type: 'button', class: 'ms-btn', onclick: async () => {
          const r = await mstodoConnect();
          if (r.error) { if (r.error !== 'closed') say(r.error === 'school' ? CONN_MESSAGES.school(app.name) : CONN_MESSAGES.failed(app.name)); return; }
          await connected();
        } }, h('span', { class: 'ms-mark', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), h('span', { text: again || 'Sign in with Microsoft' }))];
      }
      return [];
    }

    // ── Calendars ───────────────────────────────────────────────────────────
    const swatch = (color, label, onPick) => {
      const b = h('button', { type: 'button', class: 'cal-swatch', 'aria-label': label, title: 'Change colour' },
        setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${color})` }));
      b.onclick = () => openMenu(b, NY_COLORS.map(c => ({ label: c.charAt(0).toUpperCase() + c.slice(1), dot: `var(--dot-${c})`, onClick: () => onPick(c) })));
      return b;
    };

    // A secret link: its name (edit in place), colour, switch, and remove
    function feedRow(f, s) {
      const c = s.raw.feedCache[f.id] || {};
      const googleIds = new Set(gcalShown(s.raw).filter(x => x.on).map(x => x.id));
      const name = h('input', { class: 'cal-name-in', value: f.name, maxlength: '60', 'aria-label': 'Calendar name', spellcheck: 'false' });
      name.addEventListener('change', () => calSetFeed(f.id, { name: name.value.trim() || calFeedName(f.url) }));
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      const note = c.error ? h('small', { class: 'err', text: c.error })
        : googleIds.has(calFeedGoogleId(f.url)) ? h('small', { text: 'Also connected through Google. Switch one off.' }) : null;
      return h('div', { class: 'cal-row' }, swatch(f.color, `Colour for ${f.name}`, color => calSetFeed(f.id, { color })),
        h('span', { class: 'name' }, name, note),
        nySwitch(f.on, `Show ${f.name}`, () => calSetFeed(f.id, { on: !f.on })),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': `Remove ${f.name}`, title: 'Remove', onclick: async () => {
          if (!(await confirmBox({ title: `Remove ${f.name}?`, body: 'Its events leave Not yet. Tasks it already made stay.', yes: 'Remove', danger: true }))) return;
          await calRemoveFeed(f.id);
          saved(`Removed ${f.name}`);
        } }, icon('x', 16)));
    }

    // The field for one more link. A link that belongs to another card lands there, and says so.
    function addField() {
      const field = h('input', { class: 'input', type: 'url', placeholder: 'Paste the link', 'aria-label': `${app.name} link`, autocomplete: 'off', spellcheck: 'false' });
      const add = async () => {
        const url = nyFeedUrl(field.value);
        if (!url) { say('Paste the link first.'); field.focus(); return; }
        let origin;
        try { origin = new URL(url).origin; } catch { say('That doesn’t look like a link.'); return; }
        if (!(await chrome.permissions.request({ origins: [origin + '/*'] }))) { say('To read that calendar, Chrome needs you to choose Allow. Press Add to try again.'); return; }
        say('Connecting…', false);
        try {
          const f = await calAddFeed(url), home = calFeedApp(url);
          field.value = '';
          say(home === app.id ? `Added ${f.name}.` : `Added ${f.name}. It’s under ${connName(home)}.`, false);
          saved(`Added ${f.name}`);
          await syncCalendars(false);
        } catch (e) { say(String(e.message || e)); }
      };
      field.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
      return h('div', { class: 'sc-field' }, field, h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, 'Add'));
    }

    function syncLine(s) {
      return h('div', { class: 'sync-line' },
        syncing ? h('span', { text: 'Syncing…' }) : s.lastSync ? h('span', { class: 'ok', text: `Synced ${ago(s.lastSync)}` }) : null,
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', disabled: syncing, onclick: () => syncCalendars(true) }, icon('sync', 15), 'Sync now'));
    }
    async function syncCalendars(show) {
      syncing = true; await redraw();
      try {
        const added = await hwSyncFromCalendar({ force: true });
        if (show) toast(added ? `Found ${added} new task${added === 1 ? '' : 's'} for today` : 'Up to date');
      } catch (e) { if (show) toast(String(e.message || e)); }
      syncing = false; redraw();
    }

    // Google: a block per account (its calendars and its task lists), then where
    // new events go, events saved only here, secret Google links and another
    // account. Signed out: the way in, or a secret link instead. Drawn from
    // what's stored; the task lists fill in as they come.
    function gcalPart(s) {
      const raw = s.raw, accounts = s.accounts, out = [], links = feedsOf(app, s);
      if (!gcalReady()) out.push(h('p', { class: 'sc-note', text: 'Google sign-in isn’t set up in this version. Secret links still work.' }));
      else if (!accounts.length) out.push(h('p', { class: 'sc-note', text: links.length
          ? 'Connected by secret link. Sign in to see all your Google calendars and tasks, and add events that show up on your phone too.'
          : 'See your Google calendars and tasks here, and add events that show up on your phone too.' }),
        h('div', {}, nyGoogleButton({ onclick: () => signIn() })));
      else {
        for (const a of accounts) out.push(accountBlock(a, s));
        const writable = calWritable(raw);
        const def = writable.find(c => c.id === calDefaultCalendar(raw)) || writable[writable.length - 1];
        if (def) out.push(h('div', { class: 'cal-default' }, h('span', { text: 'New events go to' }),
          h('button', { type: 'button', class: 'ev-chip', 'aria-haspopup': 'menu', onclick: e => openMenu(e.currentTarget, calGrouped(writable).map(c => c === 'sep' || c.heading ? c : {
            label: c.name, aria: c.aria, dot: `var(--dot-${c.color})`,
            onClick: async () => { await chrome.storage.local.set({ gcalDefault: c.id }); saved(`New events go to ${c.name}`); } })) },
            setVars(h('span', { class: 'dot' }), { '--c': `var(--dot-${def.color})` }), h('span', { text: def.name }), icon('down', 14))));
        const localN = raw.localEvents.length;
        if (localN) out.push(h('div', { class: 'cal-strip' }, h('span', { text: `${localN} event${localN === 1 ? '' : 's'} saved only in Not yet.` }),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => nyOfferMoveToGoogle(raw) }, 'Add to Google')));
      }
      if (links.length) out.push(block('Secret links', h('div', { class: 'cal-rows' }, ...links.map(f => feedRow(f, s)))));
      if (!accounts.length) out.push(h('details', { class: 'how' }, h('summary', { text: links.length ? 'Add another secret link' : 'Or add a secret link instead' }), nyIcalGuide(), addField()));
      else if (gcalReady()) out.push(h('div', { class: 'g-add' }, nyGoogleButton({ label: 'Add another Google account', onclick: () => signIn() })));
      if (accounts.length || links.length) out.push(syncLine(s));
      return out;
    }

    // One account: its email and Remove, a strip when Google wants it signed in
    // again, its calendars (a shared one shows under the account that shows it),
    // and its task lists. Every control says which account it's for, so two
    // accounts' "Main calendar" switches stay apart (and focus comes back to the right one).
    function accountBlock(a, s) {
      const cals = gcalShown(s.raw).filter(c => c.account === a.email);
      return h('section', { class: 'g-acct', 'aria-label': a.email },
        h('div', { class: 'g-acct-head' }, h('span', { class: 'who', text: a.email, title: a.email }),
          h('button', { type: 'button', class: 'btn btn-sm btn-quiet', 'aria-label': `Remove ${a.email}`, onclick: () => removeAccount(a.email) }, 'Remove')),
        a.needsSignIn ? h('div', { class: 'cal-strip' }, h('span', { text: `${a.email} needs you to sign in again.` }),
          nyGoogleButton({ label: 'Sign in again', small: true, aria: `Sign in again to ${a.email}`, onclick: () => signIn(a.email) })) : null,
        h('h4', { text: 'Calendars' }),
        h('div', { class: 'cal-rows' }, ...cals.map(c => h('div', { class: 'cal-row' },
          swatch(c.color, `Colour for ${calMainName(c)}, ${a.email}`, color => gcalSetCalendar(c.id, { color })),
          h('span', { class: 'name' }, h('span', { class: 'nm', text: calMainName(c), title: c.name }), c.writable ? null : h('small', { text: 'view only' })),
          nySwitch(c.on, `Show ${calMainName(c)}, ${a.email}`, () => gcalSetCalendar(c.id, { on: !c.on }))))),
        h('h4', { text: 'Tasks' }),
        ...tasksPart(a, s));
    }

    // An account's Google Tasks: off (with Turn on), why they can't be read, or
    // its lists, each with a switch. Every account's lists are fetched at once,
    // once per opening; the sheet redraws as each arrives.
    const listsBy = {}, listsErr = {}, listsAsked = {};
    const forgetLists = email => { delete listsBy[email]; delete listsErr[email]; delete listsAsked[email]; };
    function loadLists(email, conn) {
      if (listsAsked[email]) return;
      listsAsked[email] = connApi('gtasks').lists(conn, email)
        .then(l => { listsBy[email] = l; }, e => { listsErr[email] = e.message; })
        .finally(() => redraw());
    }
    function tasksPart(a, s) {
      if (!a.tasks) return [h('div', { class: 'cal-row g-off' }, h('span', { class: 'cal-swatch g-list', 'aria-hidden': 'true' }, icon('list', 15)),
        h('span', { class: 'name' }, h('span', { class: 'nm', text: GCAL_MESSAGES['tasks-off'] })),
        h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': `Turn on Google Tasks for ${a.email}`, onclick: () => turnOnTasks(a.email) }, 'Turn on'))];
      if (a.needsSignIn) return [h('p', { class: 'sc-note', text: 'Its lists show again once you sign in.' })];
      const conn = s.conns.gtasks || {}, note = (conn.accounts || {})[a.email] || {};
      if (note.error) return [h('div', { class: 'cal-strip' }, h('span', { text: note.error }),
        h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': `Try again for ${a.email}`, onclick: () => { forgetLists(a.email); syncNow(); } }, 'Try again'))];
      if (listsErr[a.email]) return [h('p', { class: 'sc-warn', text: listsErr[a.email] })];
      if (!listsBy[a.email]) { loadLists(a.email, conn); return [h('p', { class: 'sc-note', text: 'Loading lists…' })]; }
      if (!listsBy[a.email].length) return [h('p', { class: 'sc-note', text: 'No task lists in this account yet.' })];
      return [h('div', { class: 'cal-rows' }, ...listsBy[a.email].map(l => h('div', { class: 'cal-row' },
        h('span', { class: 'cal-swatch g-list', 'aria-hidden': 'true' }, icon('list', 15)),
        h('span', { class: 'name' }, h('span', { class: 'nm', text: l.name, title: l.name })),
        nySwitch(!conn.lists || conn.lists[l.id] !== false, `Include ${l.name}, ${a.email}`, async () => {
          const now = (await connLoad()).gtasks || conn;               // fresh, so two quick flips both count
          await connSet('gtasks', { lists: { ...(now.lists || {}), [l.id]: !!(now.lists && now.lists[l.id] === false) } });
          await syncNow(); }))))];
    }

    // A calendar link card: how to get the link, the ones added, and one more
    function linkPart(s) {
      const links = feedsOf(app, s);
      return [steps(), links.length ? block(links.length === 1 ? 'Your calendar' : 'Your calendars', h('div', { class: 'cal-rows' }, ...links.map(f => feedRow(f, s)))) : null,
        addField(), links.length ? syncLine(s) : null];
    }

    // Signing in (again, to `email`) or adding an account. A new account's tasks come in straight away.
    async function signIn(email = '') {
      const r = await nyGoogleSignIn({ email });
      if (r.error === 'closed') say(GCAL_MESSAGES.closed, false);
      else if (r.ok) {
        saved(r.added ? `Added ${r.email}` : `Signed in to ${r.email}`);
        if (r.tasks) await syncNow();
        say(r.tasksError || '');
      }
      draw();
    }
    async function removeAccount(email) {
      if (!(await confirmBox({ title: `Remove ${email}?`, yes: 'Remove', danger: true,
        body: 'Its events and tasks leave Not yet. but stay in Google. Events saved only in Not yet. stay here.' }))) return;
      await gcalRemoveAccount(email);
      saved(`Removed ${email}`);
      draw();
    }
    async function turnOnTasks(email) {
      const r = await gtasksConnect(email);
      forgetLists(email);
      if (r.error) { if (r.error !== 'closed') say(GCAL_MESSAGES[r.error] || GCAL_MESSAGES.failed); return; }
      await syncNow();
      if (r.tasksError) say(r.tasksError); else saved(`Google Tasks is on for ${email}`);
    }

    draw();
    return { signIn };
  }

  render();
  // Sent here by "Sign in" in the popup, which can't keep Google's window open: carry on with it
  if (new URLSearchParams(location.search).has('signin')) {
    history.replaceState(null, '', location.pathname + location.hash);
    const g = open(CONN_APPS.find(a => a.id === 'gcal'));
    if (gcalReady()) g.signIn();
  }
  return { render };
}
