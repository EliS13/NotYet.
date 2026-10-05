// settings-messages.js — Settings → Messages: what the lock screen and bedtime
// say. Everywhere's messages show on every site's lock screen, mixed with that
// site's own (nyLockMessages); bedtime has its own. Each group is a card whose
// sheet is the list: add, edit in place, delete with Undo, and reset.

function nySettingsMessages(ctx) {
  const grid = $('#msg-cards');

  // The groups, in order: everywhere, YouTube, the other sites that are switched on
  // (the rest keep their messages for when they are), bedtime
  function groups() {
    const cfg = ctx.cfg;
    const sites = nyAllSites(cfg).filter(s => s.id === 'youtube' || cfg.sitesOn.includes(s.id));
    return [
      { key: 'lockNotes', name: 'Everywhere', tile: () => nyTile('icon', 'lock'), sub: 'On every lock screen', starters: NY_LOCK_NOTES, get: c => c.lockNotes },
      ...sites.map(s => ({ key: 'site:' + s.id, name: s.name, site: s, tile: () => nyTile('text', s.name.charAt(0).toUpperCase()),
        sub: `When ${s.name} is closed`, starters: NY_SITE_NOTES[s.id] || [], get: c => (c.siteNotes || {})[s.id] || [] })),
      { key: 'bedNotes', name: 'At bedtime', tile: () => nyTile('icon', 'moon'), sub: 'On the bedtime screen', starters: NY_BED_NOTES, get: c => c.bedNotes, bed: true },
    ];
  }
  const count = n => `${n} message${n === 1 ? '' : 's'}`;

  // Save a group's list back where it lives
  async function put(g, list) {
    if (g.site) ctx.cfg = await nySaveConfig({ siteNotes: { ...(ctx.cfg.siteNotes || {}), [g.site.id]: list } });
    else ctx.cfg = await nySaveConfig({ [g.key]: list });
    render();
  }

  function render() {
    grid.replaceChildren(...groups().map(g => nyCard({ tile: g.tile(), name: g.name, status: null,
      sub: `${count(g.get(ctx.cfg).length)} · ${g.sub.charAt(0).toLowerCase() + g.sub.slice(1)}`, onOpen: () => open(g.key) })));
  }

  function open(key) {
    const g = groups().find(x => x.key === key);
    const sheet = nySheet({ tile: g.tile(), name: g.name });
    const list = h('ul', { class: 'note-list', 'aria-label': `${g.name} messages` });
    const input = h('input', { class: 'input', maxlength: '140', placeholder: 'Add a message', 'aria-label': `Add a message for ${g.name}` });
    const form = h('form', { class: 'note-add' }, input, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add'));
    const now = () => [...g.get(ctx.cfg)];

    function draw() {
      const items = now();
      sheet.setStatus(null);
      list.replaceChildren(...items.map((text, i) => h('li', { class: 'nl-row' },
        h('button', { type: 'button', class: 'nl-text', title: 'Edit this message', text, onclick: e => edit(i, e.currentTarget) }),
        h('button', { type: 'button', class: 'icon-btn sm nl-del', 'aria-label': `Delete: ${text}`, onclick: async () => {
          const next = now(), [gone] = next.splice(i, 1);
          await put(g, next); draw();
          toast('Message deleted', { label: 'Undo', onClick: async () => { const back = now(); back.splice(i, 0, gone); await put(g, back); draw(); } });
        } }, icon('x', 15)))));
      if (!items.length) list.append(h('li', { class: 'nl-empty', text: g.site ? `None yet. ${g.name}’s lock screen uses Everywhere’s.` : 'None yet. It’s going to be very quiet.' }));
    }
    function edit(i, btn) {
      const field = h('input', { class: 'input input-sm', value: now()[i], maxlength: '140', 'aria-label': 'Edit message', 'data-escape': 'local' });
      btn.replaceWith(field); field.focus(); field.select();
      let done = false;
      const finish = async keep => {
        if (done) return; done = true;
        const v = field.value.trim(), next = now();
        if (keep && v && v !== next[i]) { next[i] = v; await put(g, next); }
        draw();
      };
      field.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      field.addEventListener('blur', () => finish(true));
    }
    form.onsubmit = async e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      await put(g, [...now(), v]);
      input.value = ''; draw();
      list.lastElementChild.scrollIntoView({ block: 'nearest' });
      input.focus();
    };
    const reset = h('button', { type: 'button', class: 'btn btn-sm btn-quiet', onclick: async () => {
      const body = g.starters.length ? 'Messages you added are removed, and deleted ones come back.' : 'Every message here is removed.';
      if (!(await confirmBox({ title: g.starters.length ? 'Bring back the starter messages?' : 'Clear these messages?', body, yes: 'Reset' }))) return;
      await put(g, [...g.starters]); draw(); ctx.saved('Messages reset');
    } }, g.starters.length ? 'Bring back the starters' : 'Clear all');

    sheet.body.append(h('p', { class: 'sc-note', text: g.bed ? 'A few of these show around the bedtime screen, picked at random.'
      : g.site ? `A few of these show on ${g.name}’s lock screen, mixed with Everywhere’s.` : 'These show on every closed site’s lock screen, mixed with that site’s own.' }),
      h('div', { class: 'note-col' + (g.bed ? ' bed' : '') }, list, form), h('div', { class: 'sc-actions' }, reset));
    draw();
    return sheet;
  }

  render();
  return { render };
}
