// ical-guide.js — "Where do I find that?": finding a Google Calendar's secret
// link, in four drawn steps. Setup and Settings → Connections (Google Calendar) share it. The
// pictures are drawn, not screenshots, so they stay right when Google moves
// things around; the words name what to click.

function nyIcalGuide() {
  const b = text => h('b', { text });
  const hot = el => { el.classList.add('ig-hot'); return el; };               // what to click
  const dot = color => setVars(h('i'), { '--c': `var(--dot-${color})` });
  const art = (...kids) => h('div', { class: 'ig-art', 'aria-hidden': 'true' }, ...kids);
  const step = (n, pic, ...text) => h('li', { class: 'ig-step' }, pic, h('p', {}, h('span', { class: 'ig-n', text: String(n) }), ...text));

  const gear = art(
    h('div', { class: 'ig-bar' }, h('span', { class: 'ig-logo' }, icon('calendar', 15)), h('span', { class: 'ig-search' }),
      h('span', { class: 'ig-ic' }, icon('help', 14)), hot(h('span', { class: 'ig-ic' }, icon('settings', 14)))),
    h('div', { class: 'ig-menu' }, hot(h('span', { text: 'Settings' })), h('span', { text: 'Trash' }), h('span', { text: 'Density and color' })));
  const side = art(
    h('div', { class: 'ig-side' }, h('small', { text: 'Settings for my calendars' }),
      hot(h('span', {}, dot('sky'), 'Your name')), h('span', {}, dot('mint'), 'Family'), h('span', {}, dot('butter'), 'Birthdays')));
  const copy = art(
    h('div', { class: 'ig-panel' }, h('small', { text: 'Integrate calendar' }),
      h('span', { class: 'ig-label', text: 'Secret address in iCal format' }),
      h('div', { class: 'ig-field' }, h('span', { text: '••••••••••••••••••' }), hot(h('span', { class: 'ig-ic' }, icon('copy', 14))))));
  const paste = art(
    h('small', { class: 'ig-where', text: 'Not yet.' }),
    h('div', { class: 'ig-paste' }, h('span', { class: 'ig-in', text: 'https://calendar.google.com/…/basic.ics' }), hot(h('span', { class: 'ig-add', text: 'Add' }))));

  return h('div', { class: 'ig' },
    h('ol', { class: 'ig-steps' },
      step(1, gear, 'Open ', b('Google Calendar'), ' on a computer. Click the gear, then ', b('Settings'), '.'),
      step(2, side, 'On the left, under ', b('Settings for my calendars'), ', click your calendar.'),
      step(3, copy, 'Scroll to ', b('Integrate calendar'), '. Next to ', b('Secret address in iCal format'), ', click copy.'),
      step(4, paste, 'Paste it into Not yet. and press ', b('Add'), '.')),
    h('ul', { class: 'ig-notes' },
      h('li', {}, icon('lock', 15), h('span', { text: 'Keep it to yourself: anyone with the link can see that calendar.' })),
      h('li', {}, icon('info', 15), h('span', { text: 'Not there? School accounts often turn it off. Sign in with Google instead.' })),
      h('li', {}, icon('link', 15), h('span', { text: 'Outlook and iCloud work too: use their “publish” or “public calendar” link.' }))));
}
