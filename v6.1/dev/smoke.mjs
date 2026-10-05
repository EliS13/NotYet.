// smoke.mjs — loads the real extension into a throwaway Chrome and walks the
// main paths: install, the lock, the redirect back, the popup, bedtime on an
// open YouTube tab. Screenshots land in dev/shots/. Run: node dev/smoke.mjs

import { launch, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'dev', 'shots');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
let skipped = 0;
const skip = (name, why) => { skipped++; console.log(`SKIP  ${name}  (${why})`); };
const errors = [];

const chrome = await launch({ extPath: root });
chrome.on(msg => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
});
const ext = `chrome-extension://${chrome.extId}`;

async function shot(page, name, w = 1280, h = 860) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, name + '.png'), Buffer.from(data, 'base64'));
}
const urlOf = async targetId => (await chrome.targets()).find(t => t.targetId === targetId)?.url || '';

try {
  const sw = await chrome.worker();
  await sleep(1500);

  // Install
  const welcome = (await chrome.targets()).find(t => t.url.startsWith(ext + '/pages/welcome.html'));
  check('install opens the welcome page', !!welcome);
  const cfg = await sw.eval(`chrome.storage.local.get('config').then(r => r.config)`);
  check('fresh install is not onboarded', cfg && cfg.onboarded === false);
  const installed = await sw.eval(`chrome.storage.local.get('hwSettings').then(r => r.hwSettings && r.hwSettings.installDate)`);
  check('a fresh install keeps the day it was installed', installed === await sw.eval(`hwTodayStr()`), String(installed));
  const manifestErrors = await sw.eval(`typeof nyGate === 'function' && typeof ICS.parse === 'function'`);
  check('worker loaded every library', manifestErrors === true);

  // Pin bedtime to 3 AM and opening to 4 AM so the run works at any hour
  // but 3 to 4 AM. Minutes count from the evening's midnight, so after
  // midnight "now" is past 1440.
  const evMin = (d = new Date()) => { const m = d.getHours() * 60 + d.getMinutes(); return m < 240 ? m + 1440 : m; };
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
    c.bed = { ...c.bed, school: 1620, other: 1620, wake: 240 }; await chrome.storage.local.set({ config: c }); })()`);
  await sleep(600);

  // Lock: add one habit, today
  await sw.eval(`chrome.storage.local.set({ tasks: [{ name: 'Read', duration: null, days: Array(7).fill(true) }] })`);
  await sleep(800);
  const rules = await sw.eval(`chrome.declarativeNetRequest.getDynamicRules()`);
  const night = await sw.eval(`nyNight(new Date(), nyNightCtx()).closed`);
  check('an undone habit adds the block rule', rules.length === 1, night ? '(it is past bedtime right now)' : '');
  const badge = await sw.eval(`chrome.action.getBadgeText({})`);
  check('badge counts what is left', badge === (night ? 'zz' : '1'), `badge="${badge}"`);

  // A site switched on without access yet: YouTube keeps working, nothing breaks
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.sitesOn = ['youtube', 'tiktok']; await chrome.storage.local.set({ config: c }); })()`);
  await sleep(900);
  const rule = (await sw.eval(`chrome.declarativeNetRequest.getDynamicRules()`))[0];
  check('the rule covers only sites Chrome has allowed', rule && JSON.stringify(rule.condition.requestDomains) === '["youtube.com"]', JSON.stringify(rule && rule.condition));
  const reg = await sw.eval(`chrome.scripting.getRegisteredContentScripts()`);
  check('no guard is registered for a site without access', reg.length === 0);

  // A YouTube load goes to the lock screen, carrying the address along
  const yt = await chrome.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await sleep(2500);
  let u = await urlOf(yt.targetId);
  check('YouTube redirects to the lock screen', u.startsWith(ext + '/pages/blocked.html'), u);
  check('the lock screen knows where you were going', u.endsWith('#https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  const lockText = await yt.eval(`document.querySelector('#card').innerText`);
  // Between 3 and 4 AM nothing can be open (latest bedtime 3 AM, earliest wake 4 AM),
  // so at that hour the lock screen is the bedtime one and the daytime checks are skipped.
  if (night) check('lock screen is the bedtime one (it’s 3–4 AM, daytime checks skipped)', /Bedtime/.test(lockText), JSON.stringify(lockText.slice(0, 80)));
  else check('lock screen lists the habit', /Read/.test(lockText), JSON.stringify(lockText.slice(0, 80)));
  await shot(yt, 'lock');

  // Before setup the popup points at setup; after it, the first popup gets the tour
  const pre = await chrome.open(ext + '/pages/popup.html');
  await sleep(1000);
  const preText = await pre.eval(`document.querySelector('.day-list').innerText + ' | tour:' + !!document.querySelector('.tour')`);
  check('before setup, no tour, and the popup offers setup', /Set it up/.test(preText) && /tour:false/.test(preText));
  await chrome.send('Target.closeTarget', { targetId: pre.targetId });
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.onboarded = true; await chrome.storage.local.set({ config: c }); })()`);

  // Popup, drawn at popup size
  const pop = await chrome.open(ext + '/pages/popup.html');
  await sleep(1200);
  await shot(pop, 'popup', 780, 580);
  const tour = await pop.eval(`!!document.querySelector('.tour')`);
  check('first popup shows the tour', tour);
  await pop.eval(`document.querySelector('.tour-skip').click()`);
  await sleep(300);
  const toured = await sw.eval(`chrome.storage.local.get('config').then(r => r.config.toured)`);
  check('skipping the tour remembers it', toured === true);

  // Add a task from the popup's bar, then move it to tomorrow from its menu
  await pop.eval(`(() => { const i = document.querySelector('.add-input'); i.value = 'Essay draft 45m'; i.dispatchEvent(new Event('input')); document.querySelector('.add-bar').requestSubmit(); })()`);
  await sleep(900);
  const added = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => r.hwTasksByDay[hwTodayStr()] || [])`);
  check('the add bar adds a task, minutes parsed', added.some(t => t.title === 'Essay draft' && t.estMin === 45));
  const rowShown = await pop.eval(`[...document.querySelectorAll('.row-title .txt')].some(e => e.textContent === 'Essay draft')`);
  check('the new task shows up in the list', rowShown);
  const menuFor = title => pop.eval(`[...document.querySelectorAll('.row')].find(r => r.textContent.includes('${title}')).querySelector('.row-more').click()`);
  const pickItem = label => pop.eval(`[...document.querySelectorAll('.menu button')].find(b => b.textContent === '${label}').click()`);
  // Rename it: after Enter the row shows the new name, not a field
  await menuFor('Essay draft'); await sleep(300); await pickItem('Rename'); await sleep(200);
  await pop.eval(`(() => { const i = document.querySelector('.day-list .row input'); i.value = 'Essay final'; i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(900);
  const renamed = await pop.eval(`({ field: !!document.querySelector('.day-list .row input'), shown: [...document.querySelectorAll('.row-title .txt')].some(e => e.textContent === 'Essay final') })`);
  check('renaming a task shows the new name', !renamed.field && renamed.shown, JSON.stringify(renamed));
  // Change its time with the length picker
  await menuFor('Essay final'); await sleep(300); await pickItem('Change time'); await sleep(200);
  await pop.eval(`[...document.querySelectorAll('.time-pop .cg-opt')].find(b => b.textContent === '1h').click()`);
  await sleep(900);
  const len = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => (r.hwTasksByDay[hwTodayStr()] || []).find(t => t.title === 'Essay final'))`);
  check('Change time picks a length', len && len.estMin === 60, JSON.stringify(len && len.estMin));
  // Move it to tomorrow on the calendar
  await menuFor('Essay final'); await sleep(300); await pickItem('Move to another day'); await sleep(300);
  await pop.eval(`(() => { const t = new Date(Date.now() + 864e5).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    [...document.querySelectorAll('.date-pop .cal-grid button')].find(b => b.getAttribute('aria-label').startsWith(t)).click(); })()`);
  await sleep(900);
  const moved = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => { const t = new Date(); t.setDate(t.getDate() + 1); return (r.hwTasksByDay[hwTodayStr(t)] || []).map(x => x.title); })`);
  check('Move to another day moves it', moved.includes('Essay final'));

  // A habit for weekdays only, added straight from the bar
  await pop.eval(`(async () => {
    [...document.querySelectorAll('.add-bar .seg button')][1].click();
    await new Promise(r => setTimeout(r, 150));
    const i = document.querySelector('.add-input');
    if (!document.querySelector('.add-repeat').hidden) throw new Error('Repeats row shows before anything is typed');
    i.value = 'Stretch 10m'; i.dispatchEvent(new Event('input'));
    [...document.querySelectorAll('.add-repeat .preset')].find(b => b.textContent === 'Weekdays').click();
    document.querySelector('.add-bar').requestSubmit();
  })()`);
  await sleep(900);
  const stretch = await sw.eval(`chrome.storage.local.get('tasks').then(r => r.tasks.find(t => t.name === 'Stretch'))`);
  check('a habit can be added for chosen days', stretch && stretch.duration === 10 && JSON.stringify(stretch.days) === '[true,true,true,true,true,false,false]',
    JSON.stringify(stretch));

  // A task for a day picked from the bar's day chip
  await pop.eval(`(async () => {
    [...document.querySelectorAll('.add-bar .seg button')][0].click();
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('.add-day').click();
    await new Promise(r => setTimeout(r, 150));
    const d3 = new Date(Date.now() + 3 * 864e5).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    [...document.querySelectorAll('.date-pop .cal-grid button')].find(b => b.getAttribute('aria-label').startsWith(d3)).click();   // three days from now
    await new Promise(r => setTimeout(r, 300));
    const i = document.querySelector('.add-input'); i.value = 'Lab report 60m'; i.dispatchEvent(new Event('input'));
    document.querySelector('.add-bar').requestSubmit();
  })()`);
  await sleep(900);
  const lab = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => { const d = new Date(); d.setDate(d.getDate() + 3); return (r.hwTasksByDay[hwTodayStr(d)] || []).find(t => t.title === 'Lab report'); })`);
  check('a task can be added for a chosen day', lab && lab.estMin === 60, JSON.stringify(lab));
  // A day typed into the task: "Poster in 5 days 20m"
  await pop.eval(`(async () => {
    const i = document.querySelector('.add-input'); i.value = 'Poster in 5 days 20m'; i.dispatchEvent(new Event('input'));
    document.querySelector('.add-bar').requestSubmit();
  })()`);
  await sleep(900);
  const poster = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => { const d = new Date(); d.setDate(d.getDate() + 5); return (r.hwTasksByDay[hwTodayStr(d)] || []).find(t => t.title === 'Poster'); })`);
  check('a day typed into a task schedules it', poster && poster.estMin === 20, JSON.stringify(poster));
  // Clicking the day chip again closes its calendar
  const press = sel => `(() => { const b = document.querySelector('${sel}'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); b.click(); })()`;
  await pop.eval(`document.querySelector('.wordmark').click()`); await sleep(200);
  await pop.eval(press('.add-day')); await sleep(300);
  const opened = await pop.eval(`!!document.querySelector('.date-pop')`);
  await pop.eval(press('.add-day')); await sleep(300);
  const closedAgain = await pop.eval(`!document.querySelector('.date-pop')`);
  check('clicking the day chip again closes its calendar', opened && closedAgain, JSON.stringify({ opened, closedAgain }));
  // What's typed shows its subject before it's added, and the task gets it
  await pop.eval(`(() => { document.querySelector('.wordmark').click(); document.querySelector('.add-bar .seg [data-kind="task"]').click();
    const i = document.querySelector('.add-input'); i.value = 'calc problems 1h 30m'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(250);
  const chips = await pop.eval(`({ subj: (document.querySelector('.add-subj:not([hidden])') || {}).textContent || '', min: (document.querySelector('.add-min:not([hidden])') || {}).textContent || '' })`);
  check('the add bar shows the subject and length it read', chips.subj === 'Math' && chips.min === '1h 30m', JSON.stringify(chips));
  await pop.eval(`document.querySelector('.add-bar').requestSubmit()`);
  await sleep(900);
  const calc = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => (r.hwTasksByDay[hwTodayStr()] || []).find(t => t.title === 'Calc problems'))`);
  check('the task gets the subject and length', calc && calc.course === 'math' && calc.estMin === 90, JSON.stringify(calc));
  await pop.eval(`(async () => { const r = [...document.querySelectorAll('.day-list .row')].find(x => x.textContent.includes('Calc problems'));
    r.querySelector('.check').click(); await new Promise(z => setTimeout(z, 600));
    [...document.querySelectorAll('.day-list .row')].find(x => x.textContent.includes('Calc problems')).querySelector('.check').click(); })()`);   // done, so the list can finish later
  await sleep(900);
  // A task's checkbox starts its timer; clicking it again finishes it and logs the time against the estimate
  await pop.eval(`document.querySelector('.wordmark').click()`);
  await sleep(300);
  await pop.eval(`(() => { document.querySelector('.add-bar .seg [data-kind="task"]').click(); const i = document.querySelector('.add-input');
    i.value = 'Quiz prep 20m'; i.dispatchEvent(new Event('input')); document.querySelector('.add-bar').requestSubmit(); })()`);
  await sleep(900);
  const quizBox = `[...document.querySelectorAll('.day-list .row')].find(r => r.textContent.includes('Quiz prep')).querySelector('.check')`;
  const quiz = () => sw.eval(`(async () => { const r = await chrome.storage.local.get({ hwActiveTimers: {}, hwTasksByDay: {}, hwLog: [] });
    const t = (r.hwTasksByDay[hwTodayStr()] || []).find(x => x.title === 'Quiz prep');
    return t && { running: !!r.hwActiveTimers[t.id], done: !!t.done, actual: t.actualMin || 0, logged: r.hwLog.some(l => l.title === 'Quiz prep' && l.estMin === 20) }; })()`);
  await pop.eval(`${quizBox}.click()`);
  await sleep(900);
  const started = await quiz();
  check('the checkbox starts a task’s timer', started && started.running && !started.done, JSON.stringify(started));
  await pop.eval(`${quizBox}.click()`);
  await sleep(900);
  const finished = await quiz();
  check('clicking it again finishes it and logs the time against the estimate', finished && !finished.running && finished.done && finished.actual >= 1 && finished.logged, JSON.stringify(finished));
  // Events saved in Not yet. only (no Google sign-in in a test browser)
  await pop.eval(`(() => { document.querySelector('.add-bar .seg [data-kind="event"]').click();
    const i = document.querySelector('.add-input'); i.value = 'Dentist tomorrow 3pm at Main St'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(200);
  const card = await pop.eval(`(() => { const c = document.querySelector('.add-event'); return c && !c.hidden ? c.innerText : ''; })()`);
  check('the event card says what was understood', /3:00\s?PM/.test(card) && /Main St/.test(card) && /Not yet\. only/.test(card), JSON.stringify(card));
  await pop.eval(`document.querySelector('.add-bar button[type=submit]').click()`);
  await sleep(900);
  const dentist = (await sw.eval(`chrome.storage.local.get({ localEvents: [] }).then(r => r.localEvents)`)).find(e => e.title === 'Dentist');
  check('an event can be added in the add bar', !!dentist && !dentist.allDay && dentist.place === 'Main St', JSON.stringify(dentist));
  await pop.eval(`document.querySelector('.toast .btn').click()`);
  await sleep(400);
  const row = await pop.eval(`(() => { const r = [...document.querySelectorAll('.row-event')].find(x => x.innerText.includes('Dentist')); return r ? r.innerText : ''; })()`);
  check('the event shows on its day', /Dentist/.test(row) && /Main St/.test(row), JSON.stringify(row));
  await pop.eval(`[...document.querySelectorAll('.row-event')].find(x => x.innerText.includes('Dentist')).click()`);
  await sleep(300);
  await pop.eval(`(() => { document.querySelector('.ev-title').value = 'Dentist check-up'; document.querySelector('.ev-repeat').click(); })()`);
  await sleep(150);
  await pop.eval(`[...document.querySelectorAll('.menu button')].find(b => b.textContent.startsWith('Every week on')).click()`);
  await pop.eval(`[...document.querySelectorAll('.ev-foot .btn')].find(b => b.textContent === 'Save').click()`);
  await sleep(700);
  let series = (await sw.eval(`chrome.storage.local.get({ localEvents: [] }).then(r => r.localEvents)`)).find(e => e.title === 'Dentist check-up');
  check('the event window makes it repeat weekly', !!series && series.repeat === 'weekly', JSON.stringify(series));
  await pop.eval(`(() => { const c = document.querySelector('.pl-side .cal-grid [tabindex="0"]'); c.focus();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })()`);
  await sleep(400);
  await pop.eval(`[...document.querySelectorAll('.row-event')].find(x => x.innerText.includes('Dentist check-up')).click()`);
  await sleep(300);
  await pop.eval(`[...document.querySelectorAll('.ev-foot .btn')].find(b => b.textContent === 'Delete').click()`);
  await sleep(250);
  await pop.eval(`[...document.querySelectorAll('.ev-small .btn')].find(b => b.textContent === 'Just this one').click()`);
  await sleep(700);
  series = (await sw.eval(`chrome.storage.local.get({ localEvents: [] }).then(r => r.localEvents)`)).find(e => e.title === 'Dentist check-up');
  check('deleting just one time skips that week', !!series && series.skip.length === 1, JSON.stringify(series && series.skip));
  // Enter twice in the event window saves it once
  await pop.eval(`(async () => { document.querySelector('.add-bar .seg [data-kind="event"]').click();
    const i = document.querySelector('.add-input'); i.value = 'Orthodontist fri 4pm'; i.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 150)); document.querySelector('.ae-more').click();
    await new Promise(r => setTimeout(r, 300));
    const t = document.querySelector('.ev-title'), send = window.calSave;
    window.__saves = 0; window.calSave = (...a) => { window.__saves++; return send(...a); };   // with Google, each one is an insert
    for (let k = 0; k < 2; k++) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(900);
  const saves = await pop.eval(`window.__saves`);
  check('Enter twice in the event window saves it once', saves === 1, `${saves} saves sent`);
  await pop.eval(`document.querySelector('.wordmark').click()`);            // back to today for the checks below
  await sleep(400);

  // Tick the habit in the popup: the rule goes, the lock screen sends you back
  if (!night) {
    await pop.eval(`document.querySelector('.day-list .check').focus(); document.querySelector('.day-list .check').click()`);
    await sleep(1200);
    const ticked = await pop.eval(`document.querySelector('.day-list .check').getAttribute('aria-checked')`);
    check('the tick shows right away, even with focus on it', ticked === 'true');
    const kept = await pop.eval(`document.activeElement && document.activeElement.dataset.fk`);
    check('keyboard focus stays on the same checkbox', kept === 'h:Read', `focus=${kept}`);
    // Stretch (added above for weekdays, with a 10-minute timer) is on the list too on a weekday; its finished timer ticks it
    await sw.eval(`setHabitDone('Stretch', new Date(), true)`);
    await sleep(1200);
    const after = await sw.eval(`chrome.declarativeNetRequest.getDynamicRules()`);
    check('finishing the list removes the rule', after.length === 0);
    const doneDay = await sw.eval(`chrome.storage.local.get({ nyDoneDays: {} }).then(r => r.nyDoneDays[hwTodayStr()] || null)`);
    check('finishing the list records today for the streak', !!doneDay && doneDay.total > 0, JSON.stringify(doneDay));
    for (let i = 0; i < 20 && !(u = await urlOf(yt.targetId)).startsWith('https://www.youtube.com'); i++) await sleep(400);
    check('lock screen returns you to the video', u.startsWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), u);
    await sleep(3000);

    // Bedtime can only be set from 6 PM to 3 AM, and wake-up no later than noon.
    // So the heads-up (bedtime a few minutes away) can only be checked in the
    // evening. Bedtime itself can be checked in the evening, or in the morning,
    // where a noon wake-up makes now part of last night. Noon to 6 PM, neither.
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    const soon = m >= 17 * 60 + 55 || m < 2 * 60 + 55;     // a bedtime 5 minutes from now can be set
    const evening = m >= 18 * 60 || m < 3 * 60;             // a bedtime a minute ago can be set
    const morning = m >= 4 * 60 && m < 11 * 60 + 55;

    // Heads-up: bedtime in 5 minutes
    if (soon) {
      const inFive = evMin(now) + 5;
      await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
        c.bed.school = ${inFive}; c.bed.other = ${inFive}; c.warn = 10; await chrome.storage.local.set({ config: c }); })()`);
      await sleep(2500);
      const toast = await yt.eval(`(() => { const t = document.getElementById('ny-toast'); return t && !t.hidden ? t.innerText : ''; })()`);
      check('YouTube shows the bedtime heads-up', /[45] minutes to bedtime/.test(toast), JSON.stringify(toast));
      await shot(yt, 'yt-headsup');
    } else skip('YouTube shows the bedtime heads-up', 'needs a bedtime minutes away, so only from 5:55 PM to 2:55 AM');

    // Bedtime: the open tab goes to the bedtime screen
    if (evening || morning) {
      const set = evening ? `c.bed.school = ${evMin(now) - 1}; c.bed.other = ${evMin(now) - 1};` : 'c.bed.wake = 720;';
      await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
        ${set} await chrome.storage.local.set({ config: c }); })()`);
      // The guard only starts once YouTube has finished loading, which can take a
      // few seconds headless, so wait for the move rather than a fixed time.
      const t0 = Date.now();
      for (let i = 0; i < 50 && !(u = await urlOf(yt.targetId)).startsWith(ext); i++) await sleep(300);
      check('bedtime sends an open YouTube tab to the lock page', u.startsWith(ext + '/pages/blocked.html'), `after ${((Date.now() - t0) / 1000).toFixed(1)}s  ${u}`);
      const bedPage = await chrome.attach(yt.targetId);
      await bedPage.send('Page.enable');
      await sleep(800);
      const isBed = await bedPage.eval(`document.body.classList.contains('bed')`);
      check('it is the bedtime screen', isBed);
      await shot(bedPage, 'bedtime');
      const badge2 = await sw.eval(`chrome.action.getBadgeText({})`);
      check('badge says zz at bedtime', badge2 === 'zz', `badge="${badge2}"`);
    } else skip('bedtime checks', 'bedtime can’t be made to start between noon and 6 PM');
  }

  // The full planner goes to Settings in the same tab, and back again
  const tabs = async page => (await chrome.targets()).filter(t => t.type === 'page' && t.url.includes('/pages/' + page)).length;
  const pl = await chrome.open(ext + '/pages/planner.html');
  await sleep(1200);
  const settingsBefore = await tabs('settings.html');
  await pl.eval(`document.querySelector('.pl-top-actions [aria-label="Settings"]').click()`);
  await sleep(1200);
  const plUrl = (await chrome.targets()).find(t => t.targetId === pl.targetId)?.url || '';
  check('Settings opens in the planner’s own tab', plUrl.includes('/pages/settings.html') && await tabs('settings.html') === settingsBefore + 1, plUrl);

  // Sticky notes come in sizes: a Wide one spans both columns
  const board = await chrome.open(ext + '/pages/planner.html');
  await sleep(1200);
  await board.eval(`(async () => { if (!document.querySelector('.sn-tile')) { document.querySelector('.sn-empty').click(); await new Promise(r => setTimeout(r, 600)); }
    document.querySelector('.sn-tile .sn-size[data-size="wide"]').click(); })()`);
  await sleep(900);
  const wide = await board.eval(`({ cls: document.querySelector('.sn-tile').className, span: getComputedStyle(document.querySelector('.sn-tile')).gridColumnStart })`);
  const stored = await sw.eval(`chrome.storage.local.get({ stickyNotes: [] }).then(r => r.stickyNotes[0] && r.stickyNotes[0].size)`);
  check('a sticky note can be made wide', stored === 'wide' && /sn-wide/.test(wide.cls) && wide.span === 'span 2', JSON.stringify({ stored, ...wide }));

  // Signing in from the popup happens in Settings: the popup closes as soon as Google's window opens
  const pop2 = await chrome.open(ext + '/pages/popup.html');
  await sleep(800);
  pop2.eval(`nyGoogleSignIn()`).catch(() => {});
  await sleep(900);
  const signInTab = (await chrome.targets()).some(t => t.url.includes('/pages/settings.html#connections'));
  check('signing in from the popup opens Settings → Connections', signInTab);

  // The planner: a quiet streak, and a length from your own history
  await sw.eval(`(async () => { const d = n => hwTodayStr(nyAddDays(new Date(), n));
    const { hwLog = [] } = await chrome.storage.local.get({ hwLog: [] });
    for (const [n, m] of [[-3, 40], [-2, 44], [-1, 41]]) hwLog.push({ date: d(n), hourStarted: 16, title: 'Worksheet', course: 'math', type: 'M', estMin: 30, actualMin: m });
    await chrome.storage.local.set({ hwLog, nyDoneDays: { [d(-2)]: { at: 1, total: 3 }, [d(-1)]: { at: 1, total: 4 } } }); })()`);
  const sp3 = await chrome.open(ext + '/pages/popup.html');
  await sleep(900);
  await sp3.eval(`(() => { const i = document.querySelector('.add-input'); i.value = 'Algebra worksheet'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(200);
  const usual = await sp3.eval(`(() => { const m = document.querySelector('.add-min'); return m && !m.hidden ? m.textContent : ''; })()`);
  check('adding a Math task suggests how long Math usually takes you', usual === '~40m', JSON.stringify(usual));
  const streak = await sp3.eval(`(() => { const s = document.querySelector('.streak'); return s && !s.hidden ? s.textContent : ''; })()`);
  check('the planner shows the streak quietly', /2 days in a row/.test(streak), JSON.stringify(streak));
  check('the planner has a button for your stats', await sp3.eval(`!!document.querySelector('.pl-top [aria-label="Your stats"]')`));
  const stp = await chrome.open(ext + '/pages/stats.html');
  for (let i = 0; i < 30 && !(await stp.eval(`document.querySelectorAll('.st-num').length`)); i++) await sleep(200);
  const stv = await stp.eval(`({ nums: document.querySelectorAll('.st-num').length, subjects: [...document.querySelectorAll('.st-subject b')].map(b => b.textContent) })`);
  check('the stats page shows the numbers and time per subject', stv.nums === 3 && stv.subjects.includes('Math'), JSON.stringify(stv));

  // Focus help: just five minutes, and steps in a task
  await sw.eval(`hwAddTask(hwTodayStr(), { title: 'Essay draft', estMin: 45, course: 'english' })`);
  const fp = await chrome.open(ext + '/pages/popup.html');
  await sleep(900);
  const rowOf = `[...document.querySelectorAll('.day-list .row')].find(r => r.textContent.includes('Essay draft'))`;
  const essayId = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => r.hwTasksByDay[hwTodayStr()].find(t => t.title === 'Essay draft').id)`);
  const pick = label => fp.eval(`(async () => { ${rowOf}.querySelector('.row-more').click(); await new Promise(r => setTimeout(r, 150));
    [...document.querySelectorAll('.menu button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click(); })()`);
  await pick('Just 5 minutes');
  await sleep(600);
  const jt = await sw.eval(`chrome.storage.local.get({ hwActiveTimers: {} }).then(r => r.hwActiveTimers[${JSON.stringify(essayId)}] || null)`);
  check('“Just 5 minutes” starts a five-minute countdown', !!jt && jt.totalMs === 300000 && jt.justStart === true, JSON.stringify(jt && { totalMs: jt.totalMs, justStart: jt.justStart }));
  const runningRow = await fp.eval(`${rowOf}.innerText`);
  check('a running countdown’s row shows no stray “null”', !/null/.test(runningRow), JSON.stringify(runningRow));
  await pick('Break into steps');
  await sleep(300);
  await fp.eval(`(() => { const i = document.querySelector('.steps-pop input.steps-add');
    for (const t of ['Outline', 'Draft']) { i.value = t; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await sleep(800);
  const s1 = await fp.eval(`(${rowOf}.querySelector('.row-steps') || {}).textContent || ''`);
  await fp.eval(`${rowOf}.querySelector('.row-steps .step-check').click()`);
  await sleep(800);
  const s2 = await fp.eval(`(${rowOf}.querySelector('.row-steps') || {}).textContent || ''`);
  check('a task’s steps show the next one, and ticking it moves on', /Outline/.test(s1) && /0 of 2/.test(s1) && /Draft/.test(s2) && /1 of 2/.test(s2), JSON.stringify([s1, s2]));

  // Focus sounds: with a sound chosen, a running timer opens the sound page; stopping it closes it
  const pages = () => sw.eval(`chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(c => c.length)`);
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.focusSound = 'rain'; await chrome.storage.local.set({ config: c }); })()`);
  let soundOn = 0;
  for (let i = 0; i < 15 && !(soundOn = await pages()); i++) await sleep(200);   // the "Just 5 minutes" timer is still running
  await sleep(1200);
  const engine = await sw.eval(`chrome.runtime.sendMessage({ target: 'offscreen', status: true }).catch(e => ({ error: String(e) }))`);
  check('the sound engine is really playing rain', !!engine && engine.playing === 'rain' && engine.state === 'running' && engine.parts > 0, JSON.stringify(engine));
  // Paused and resumed quickly: the sound comes back and stays
  const quick = await sw.eval(`(async () => { const to = m => chrome.runtime.sendMessage({ target: 'offscreen', ...m }).catch(() => null);
    await to({ stop: true }); await new Promise(r => setTimeout(r, 250)); await to({ play: 'rain', volume: .5 });
    await new Promise(r => setTimeout(r, 1500)); return to({ status: true }); })()`);
  check('a sound stopped and started again quickly keeps playing', !!quick && quick.playing === 'rain' && quick.parts > 0, JSON.stringify(quick));
  // A pomodoro break always schedules its end, so the sound comes back after it
  const brkEnd = await sw.eval(`(async () => { if (typeof hwBreakStarted !== 'function') return 'no hwBreakStarted';
    await hwBreakStarted(); const a = await chrome.alarms.get('hw-break-end');
    await chrome.storage.local.set({ breakUntil: 0 }); return a ? 'set' : 'none'; })()`);
  check('a break always schedules its end', brkEnd === 'set', brkEnd);
  await sw.eval(`hwStopTimer(${JSON.stringify(essayId)})`);
  let soundOff = 1;
  for (let i = 0; i < 20 && (soundOff = await pages()); i++) await sleep(200);
  check('a chosen focus sound plays while a timer runs and stops with it', soundOn === 1 && soundOff === 0, JSON.stringify({ soundOn, soundOff }));
  // A sample plays once and the sound page closes after it
  await fp.eval(`chrome.runtime.sendMessage({ type: 'sound-sample', sound: 'rain', volume: .5 }).catch(() => {})`);
  let sampleOpen = 0;
  for (let i = 0; i < 10 && !(sampleOpen = await pages()); i++) await sleep(200);
  await sleep(7500);
  const afterSample = await pages();
  check('a sample plays once, then the sound page closes', sampleOpen === 1 && afterSample === 0, JSON.stringify({ sampleOpen, afterSample }));
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.focusSound = 'off'; await chrome.storage.local.set({ config: c }); })()`);

  // Next test: a quiz on the calendar four days out shows with its countdown; Plan study spreads three sessions before it
  const quizDay = await sw.eval(`hwTodayStr(nyAddDays(new Date(), 4))`);
  await sw.eval(`(async () => { const at = nyParseDs(hwTodayStr(nyAddDays(new Date(), 4))).getTime() + 10 * 3600000;
    const { localEvents = [] } = await chrome.storage.local.get({ localEvents: [] });
    localEvents.push({ id: 'l-quiz', title: 'Chemistry quiz', allDay: false, start: at, end: at + 3600000, place: '', notes: '', repeat: null, skip: [] });
    localEvents.push({ id: 'l-hist', title: 'History test', allDay: false, start: at + 86400000, end: at + 86400000 + 3600000, place: '', notes: '', repeat: null, skip: [] });
    const band = at - 2 * 86400000;
    localEvents.push({ id: 'l-band', title: 'Band concert', allDay: false, start: band, end: band + 3600000, place: '', notes: '', repeat: null, skip: [] });
    await chrome.storage.local.set({ localEvents }); })()`);
  const tp = await chrome.open(ext + '/pages/popup.html');
  await tp.send('Emulation.setDeviceMetricsOverride', { width: 780, height: 580, deviceScaleFactor: 1, mobile: false });   // the popup's real size
  await tp.eval(`location.reload()`);
  await sleep(1200);
  const fitsSide = await tp.eval(`(() => { const side = document.querySelector('.pl-side').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.upcoming .up-row')];
    return { first: rows[0] ? Math.round(rows[0].getBoundingClientRect().bottom) : null, bottom: Math.round(side.bottom),
      twice: rows.some(r => r.textContent.includes('Chemistry quiz')) }; })()`);
  check('in the popup, the next test leaves Coming up in view and isn’t listed twice', fitsSide.first != null && fitsSide.first <= fitsSide.bottom && !fitsSide.twice, JSON.stringify(fitsSide));
  const testCard = await tp.eval(`(document.querySelector('.next-test') || {}).innerText || ''`);
  check('the next test shows with its countdown', /Chemistry quiz/.test(testCard) && /in 4 days/.test(testCard), JSON.stringify(testCard));
  const popFit = await tp.eval(`(async () => { [...document.querySelectorAll('.next-test button')].find(b => b.textContent === 'Plan study').click();
    await new Promise(r => setTimeout(r, 200));
    const pop = document.querySelector('.study-pop'), fits = () => Math.round(pop.getBoundingClientRect().bottom) <= innerHeight;
    const first = fits();
    const five = [...pop.querySelectorAll('[aria-label="How many sessions"] button')].find(b => b.textContent === '5');
    five.focus(); five.click();                                     // as the keyboard does it: focus, then Enter
    await new Promise(r => setTimeout(r, 100));
    const kept = document.activeElement && document.activeElement.textContent === '5' && pop.contains(document.activeElement);
    const after = fits();
    [...pop.querySelectorAll('[aria-label="How many sessions"] button')].find(b => b.textContent === '3').click();
    return { first, after, kept }; })()`);
  check('the study popover fits the popup, and a picked chip keeps the focus', popFit.first && popFit.after && popFit.kept, JSON.stringify(popFit));
  await tp.eval(`[...document.querySelectorAll('.study-pop button')].find(b => b.textContent === 'Add to my days').click()`);
  await sleep(1200);
  const study = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => Object.entries(r.hwTasksByDay).flatMap(([d, l]) => l.filter(t => t.studyFor).map(t => d + ' ' + t.title)))`);
  const want = [3, 2, 1].map(n => { const d = new Date(quizDay + 'T12:00'); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} Study: Chemistry quiz`; });
  const card2 = await tp.eval(`(document.querySelector('.next-test') || {}).innerText || ''`);
  check('Plan study adds three sessions on the days before the test', JSON.stringify(study.sort()) === JSON.stringify(want) && /0 of 3/.test(card2), JSON.stringify({ study, card2 }));
  const thenLine = await tp.eval(`(() => { const t = document.querySelector('.next-test .nt-then'); return t ? t.innerText : ''; })()`);
  check('once it’s planned, the next test comes along with its own Plan study', /History test/.test(thenLine) && /Plan study/.test(thenLine), JSON.stringify(thenLine));

  // Settings → Connections: every app has a card; Todoist opens its sheet
  const cn = await chrome.open(`${ext}/pages/settings.html#connections`);
  for (let i = 0; i < 40 && !(await cn.eval(`document.querySelectorAll('#cn-grid .sc-card').length`)); i++) await sleep(200);
  const cards = await cn.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].map(c => c.querySelector('b').textContent)`);
  check('the Connections gallery shows every app, and nothing from Apple', cards.length === 11 && cards.includes('Todoist') && !cards.some(n => /Apple/.test(n)), JSON.stringify(cards));
  const gCards = await cn.eval(`(async () => {
    const names = () => [...document.querySelectorAll('#cn-grid .sc-card')].map(c => c.querySelector('b').textContent.trim());
    const out = { all: names() };
    for (const f of ['Tasks', 'Calendars', 'All']) {
      [...document.querySelectorAll('#cn-filters button')].find(b => b.textContent === f).click();
      await new Promise(r => setTimeout(r, 300));
      out[f] = names();
    }
    return out;
  })()`);
  check('Connections has one Google card, under Tasks and Calendars, and no separate Google Tasks or Google Calendar',
    gCards.all.filter(n => n === 'Google').length === 1 && gCards.Tasks.includes('Google') && gCards.Calendars.includes('Google')
      && !gCards.all.some(n => n === 'Google Tasks' || n === 'Google Calendar'), JSON.stringify(gCards));
  // Two Google accounts, put straight into storage (a test browser can't sign in to Google). The sheet
  // draws what's stored at once while the task lists load, and every switch says whose it is, so after
  // a flip, focus comes back to the same account's switch.
  await cn.eval(`(async () => {
    const acct = email => ({ email, connectedAt: 1, needsSignIn: false, tasks: true });
    const main = email => ({ id: email, account: email, name: email, access: 'owner', writable: true, primary: true, color: 'sky', on: true });
    await chrome.storage.session.set({ gcalTokens: { 'home@example.com': { token: 'x', expires: Date.now() + 3600e3 }, 'school@example.edu': { token: 'y', expires: Date.now() + 3600e3 } } });
    await chrome.storage.local.set({ gcalAccounts: [acct('home@example.com'), acct('school@example.edu')], gcalCalendars: [main('home@example.com'), main('school@example.edu')] });
    window.__lists = new Promise(r => { window.__openLists = r; });
    const f = window.fetch;
    window.fetch = async (u, o) => String(u).includes('tasks.googleapis.com')
      ? (await window.__lists, new Response(JSON.stringify({ items: [{ id: 'L', title: 'My Tasks' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : f(u, o);
  })()`);
  await sleep(400);
  await cn.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].find(c => c.querySelector('b').textContent.trim() === 'Google').click()`);
  await sleep(600);
  const early = await cn.eval(`document.querySelectorAll('.sc-sheet .g-acct .cal-row').length`);
  check('the Google sheet shows each account’s calendars at once, while its task lists load', early >= 2, `${early} calendar rows before the lists came back`);
  await cn.eval(`window.__openLists()`);
  let gLabels = [];
  for (let i = 0; i < 20 && gLabels.length < 4; i++) {                    // each account's lists fill in as they arrive
    await sleep(200);
    gLabels = await cn.eval(`[...document.querySelectorAll('.sc-sheet .g-acct [role="switch"]')].map(s => s.getAttribute('aria-label'))`);
  }
  check('every switch in the Google sheet says whose it is', gLabels.length === 4 && new Set(gLabels).size === 4, JSON.stringify(gLabels));
  const gBack = await cn.eval(`(async () => {
    const sw = document.querySelectorAll('.sc-sheet .g-acct')[1].querySelector('.cal-row [role="switch"]');
    sw.focus(); sw.click();
    await new Promise(r => setTimeout(r, 900));
    const a = document.activeElement, block = a && a.closest('.g-acct');
    return block ? block.getAttribute('aria-label') : String(a && a.tagName);
  })()`);
  check('after flipping the school account’s calendar, focus stays on that account’s switch', gBack === 'school@example.edu', gBack);
  await cn.eval(`(async () => {
    await chrome.storage.local.remove(['gcalAccounts', 'gcalCalendars', 'gcalCache', 'gcalDefault']);
    await chrome.storage.session.remove('gcalTokens');
    location.reload();
  })()`).catch(() => {});
  await sleep(800);
  for (let i = 0; i < 40 && !(await cn.eval(`document.querySelectorAll('#cn-grid .sc-card').length`).catch(() => 0)); i++) await sleep(200);
  await cn.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].find(c => c.textContent.includes('Todoist')).click()`);
  await sleep(300);
  const sheet = await cn.eval(`(document.querySelector('.sc-sheet') || {}).innerText || ''`);
  check('a card opens a sheet that says what comes in', /What comes in/.test(sheet) && /API token/.test(sheet), JSON.stringify(sheet.slice(0, 120)));
  // Connect Todoist against a pretend Todoist, bring a task in, tick it back
  const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // not toISOString: that's UTC
  const todo = { closed: [] };
  const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' }];
  const answer = async (session, m) => {
    if (m.params.request.method === 'OPTIONS') {                 // the browser's check before a call with a token
      await chrome.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 204, responseHeaders: cors }, session);
      return;
    }
    const u = new URL(m.params.request.url), body = u.pathname.endsWith('/close') ? (todo.closed.push(u.pathname), null)
      : u.pathname.endsWith('/projects') ? { results: [{ id: 'p1', name: 'Science' }], next_cursor: null }
      : u.pathname.includes('/tasks/completed/') ? { items: [], next_cursor: null }
      : { results: [{ id: '501', content: 'Chem worksheet', due: { date: localDay() }, project_id: 'p1' }], next_cursor: null };
    await chrome.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: body ? 200 : 204,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...cors],
      body: Buffer.from(body ? JSON.stringify(body) : '').toString('base64') }, session);
  };
  chrome.on(m => { if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m).catch(() => {}); });
  await cn.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.todoist.com/*' }] });
  await cn.eval(`(async () => { const s = document.querySelector('.sc-sheet'); s.querySelector('input').value = 'pretend-token';
    [...s.querySelectorAll('button')].find(b => b.textContent === 'Connect').click(); })()`);
  let chem = null;
  for (let i = 0; i < 30 && !chem; i++) {
    await sleep(300);
    chem = await sw.eval(`chrome.storage.local.get('hwTasksByDay').then(r => (r.hwTasksByDay[hwTodayStr()] || []).find(t => t.id === 'x-todoist-501'))`);
  }
  check('connecting Todoist brings its tasks in', chem && chem.title === 'Chem worksheet' && chem.course === 'science', JSON.stringify(chem));
  await cn.eval(`hwSetDone(hwTodayStr(), 'x-todoist-501', true)`);
  await sleep(600);
  check('ticking it here closes it in Todoist', todo.closed.includes('/api/v1/tasks/501/close'), JSON.stringify(todo.closed));

  // Settings → Connections → Any calendar: a 6.0 link moves in; the Calendar section is gone
  await sw.eval(`chrome.storage.local.remove('calFeeds').then(() => chrome.storage.local.set({ hwSettings: { icsUrl: 'https://calendar.example/feed.ics', phaseMode: 'target', installDate: '2026-09-01' } }))`);
  const st = await chrome.open(`${ext}/pages/settings.html#connections`);
  for (let i = 0; i < 40 && !(await st.eval(`!!document.querySelector('#cn-grid .sc-card.is-on')`)); i++) await sleep(200);   // the link counted
  check('the Calendar section is gone; its settings live in Connections',
    await st.eval(`!document.getElementById('calendar') && ![...document.querySelectorAll('#nav a')].some(a => a.textContent === 'Calendar')`));
  await st.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].find(c => c.textContent.includes('Any calendar')).click()`);
  await sleep(400);
  const feedsText = await st.eval(`(() => { const f = document.querySelector('.sc-sheet');            // names are editable fields
    return f ? [f.innerText, ...[...f.querySelectorAll('input')].map(i => i.value)].join(' | ') : ''; })()`);
  check('a 6.0 link moves into Connections → Any calendar', /calendar\.example/.test(feedsText), JSON.stringify(feedsText.slice(0, 120)));

  // Settings → Tags and Subjects: cards whose sheets take one change after another
  const tg = await chrome.open(`${ext}/pages/settings.html#tags`);
  for (let i = 0; i < 40 && !(await tg.eval(`document.querySelectorAll('#tag-cards .sc-card').length`)); i++) await sleep(200);
  await sleep(400);
  const openCard = grid => tg.eval(`document.querySelector('${grid} .sc-card:not(.sc-add)').click()`);
  const rename = (label, value) => tg.eval(`(() => { const i = document.querySelector('.sc-sheet input[aria-label="${label}"]'); i.focus(); i.value = ${JSON.stringify(value)};
    i.dispatchEvent(new Event('change')); i.blur(); })()`);
  const pickMark = m => tg.eval(`(() => { document.querySelector('.sc-sheet .mark-btn').click();
    [...document.querySelectorAll('.chip-pop .cg-opt')].find(b => b.textContent === ${JSON.stringify(m)}).click(); })()`);
  await openCard('#tag-cards'); await sleep(300);
  await rename('Name', 'Worksheets'); await sleep(500);
  await pickMark('🧪'); await sleep(500);
  await rename('Name', 'Problem sets'); await sleep(500);
  await pickMark('🎨'); await sleep(500);
  const tag0 = await sw.eval(`chrome.storage.local.get('config').then(r => r.config.tags[0])`);
  check('a tag’s name and icon can each be changed, again and again', tag0.name === 'Problem sets' && tag0.mark === '🎨', JSON.stringify(tag0));
  await tg.eval(`(() => { const d = [...document.querySelectorAll('.sc-sheet .row .btn')].find(b => b.textContent === 'Done'); d && d.click(); })()`);
  await sleep(300);
  await openCard('#subject-cards'); await sleep(300);
  await rename('Subject name', 'Maths'); await sleep(500);
  await tg.eval(`(() => { const s = document.querySelector('.sc-sheet [role="slider"]'); s.focus();
    const key = k => s.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('End'); key('ArrowLeft'); key('ArrowLeft'); key('ArrowLeft'); })()`);
  await sleep(600);
  const sub0 = await sw.eval(`chrome.storage.local.get('config').then(r => r.config.subjects[0])`);
  check('a subject’s name and hue can both be changed', sub0.name === 'Maths' && sub0.color === 'h344', JSON.stringify(sub0));

  // Settings → Sites: a site added today goes right away; an older one that's on goes at midnight
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
    c.customSites = [...c.customSites, { id: 'site-new', name: 'discord.com', domains: ['discord.com'], added: nyDateStr() },
      { id: 'site-old', name: 'x.org', domains: ['x.org'], added: '2026-01-01' }];
    c.sitesOn = [...c.sitesOn, 'site-new', 'site-old']; await chrome.storage.local.set({ config: c }); })()`);
  const sp = await chrome.open(`${ext}/pages/settings.html#sites`);
  for (let i = 0; i < 40 && !(await sp.eval(`!!document.querySelector('[aria-label="Remove discord.com"]')`)); i++) await sleep(200);
  await sp.eval(`document.querySelector('[aria-label="Remove discord.com"]').click()`);
  await sleep(600);
  await sp.eval(`document.querySelector('[aria-label="Remove x.org"]').click()`);
  await sleep(600);
  const sites = await sw.eval(`chrome.storage.local.get('config').then(r => ({ ids: r.config.customSites.map(s => s.id), on: r.config.sitesOn,
    old: r.config.customSites.find(s => s.id === 'site-old') }))`);
  check('a site added today can be removed right away', !sites.ids.includes('site-new') && !sites.on.includes('site-new'), JSON.stringify(sites.ids));
  check('an older site that’s on is removed at midnight, closed until then', !!(sites.old && sites.old.removeFrom) && sites.on.includes('site-old'), JSON.stringify(sites.old));

  // Settings → Bedtime: a card with the times; its sheet changes them
  const bd = await chrome.open(`${ext}/pages/settings.html#bedtime`);
  for (let i = 0; i < 40 && !(await bd.eval(`!!document.querySelector('#bedtime .sc-card')`)); i++) await sleep(200);
  await bd.eval(`[...document.querySelectorAll('#bedtime .sc-card')].find(c => c.textContent.includes('Bedtime')).click()`);
  await sleep(300);
  await bd.eval(`(() => { const b = document.querySelector('.sc-sheet #bed-school'); b.value = '1350'; b.dispatchEvent(new Event('change')); })()`);
  await sleep(600);
  const bedNow = await sw.eval(`chrome.storage.local.get('config').then(r => r.config.bed.school)`);
  await bd.eval(`document.querySelector('.sc-sheet .btn-quiet').click()`);
  await sleep(300);
  const bedCard = await bd.eval(`[...document.querySelectorAll('#bedtime .sc-card')].map(c => c.innerText).join(' | ')`);
  check('Bedtime is a card whose sheet changes the times', bedNow === 1350 && /10:30/.test(bedCard), JSON.stringify(bedCard));
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.bed.school = 1620; await chrome.storage.local.set({ config: c }); })()`);

  // Settings → Messages: each site has its own; one added for YouTube is saved
  const ms = await chrome.open(`${ext}/pages/settings.html#messages`);
  for (let i = 0; i < 40 && !(await ms.eval(`!!document.querySelector('#msg-cards .sc-card')`)); i++) await sleep(200);
  const msgCards = await ms.eval(`[...document.querySelectorAll('#msg-cards .sc-card')].map(c => c.querySelector('b').textContent)`);
  await ms.eval(`[...document.querySelectorAll('#msg-cards .sc-card')].find(c => c.textContent.includes('YouTube')).click()`);
  await sleep(300);
  await ms.eval(`(() => { const f = document.querySelector('.sc-sheet .note-add'); f.querySelector('input').value = 'Watch it after the essay.';
    f.requestSubmit(); })()`);
  await sleep(600);
  const ytNotes = await sw.eval(`chrome.storage.local.get('config').then(r => r.config.siteNotes.youtube)`);
  check('Messages: Everywhere, YouTube and At bedtime cards; a YouTube one is saved',
    msgCards[0] === 'Everywhere' && msgCards.includes('YouTube') && msgCards.at(-1) === 'At bedtime' && ytNotes.includes('Watch it after the essay.'), JSON.stringify(msgCards));

  // Sheets behave: they scroll, keep what's typed, take and give back focus, fit a phone, and Escape cancels an edit
  const sh = await chrome.open(`${ext}/pages/settings.html#connections`);
  await sh.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 40 && !(await sh.eval(`document.querySelectorAll('#cn-grid .sc-card').length`)); i++) await sleep(200);
  await sh.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].find(c => c.querySelector('b').textContent.trim() === 'Google').click()`);
  await sleep(500);
  const reach = await sh.eval(`(() => { const d = document.querySelector('.sc-sheet details.how'); if (!d) return 'no guide'; d.open = true;
    const f = d.querySelector('input'); f.scrollIntoView({ block: 'nearest' }); const r = f.getBoundingClientRect();
    return r.bottom <= innerHeight && r.top >= 0 ? 'ok' : 'field at ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' of ' + innerHeight; })()`);
  check('a tall sheet scrolls, so its last field can be reached', reach === 'ok', reach);
  await sh.eval(`document.querySelector('.sc-sheet .row .btn').click()`);
  await sleep(200);
  // A sync finishing mid-rename keeps the field (the sync is slowed down to land while typing)
  await sh.eval(`[...document.querySelectorAll('#cn-grid .sc-card')].find(c => c.textContent.includes('Any calendar')).click()`);
  await sleep(500);
  const kept = await sh.eval(`(async () => {
    window.hwSyncFromCalendar = () => new Promise(r => setTimeout(() => r(0), 600));
    [...document.querySelectorAll('.sc-sheet button')].find(b => b.textContent.includes('Sync now')).click();
    await new Promise(r => setTimeout(r, 50));
    const i = document.querySelector('.sc-sheet .cal-name-in'); if (!i) return 'no field';
    i.focus(); i.value = 'Renamed';
    await new Promise(r => setTimeout(r, 900));
    return i.isConnected && document.activeElement === i && i.value === 'Renamed' ? 'ok' : 'lost'; })()`);
  check('a sync finishing while a calendar is being renamed keeps the field', kept === 'ok', kept);
  await sh.eval(`document.activeElement.blur(); document.querySelector('.sc-sheet .row .btn').click()`);
  await sleep(300);
  // Opening from the keyboard puts focus in the sheet; after an edit, closing puts it back on the card
  await sh.eval(`location.hash = '#tags'`);
  const focusIn = await sh.eval(`(async () => { const c = document.querySelector('#tag-cards .sc-card'); c.focus(); c.click();
    await new Promise(r => setTimeout(r, 300)); return !!document.activeElement.closest('.sc-sheet'); })()`);
  check('a sheet opened from the keyboard takes the focus', focusIn);
  const back = await sh.eval(`(async () => {
    [...document.querySelectorAll('.sc-sheet .seg button')].find(b => b.textContent === 'Stopwatch').click();
    await new Promise(r => setTimeout(r, 600));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const a = document.activeElement; return a && a.matches('#tag-cards .sc-card') ? 'card' : (a && a.tagName) || 'none'; })()`);
  check('after an edit, closing the sheet puts focus back on its card', back === 'card', back);
  // Escape while editing a message cancels the edit and keeps the sheet
  await sh.eval(`location.hash = '#messages'`);
  const esc = await sh.eval(`(async () => {
    [...document.querySelectorAll('#msg-cards .sc-card')].find(c => c.textContent.includes('YouTube')).click();
    await new Promise(r => setTimeout(r, 300));
    const t = document.querySelector('.sc-sheet .nl-text'), before = t.textContent; t.click();
    const i = document.querySelector('.sc-sheet .nl-row input'); i.value = before + ' EDITED';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const cfg = (await chrome.storage.local.get('config')).config;
    return { open: !!document.querySelector('.sc-sheet'), saved: cfg.siteNotes.youtube.some(n => n.endsWith(' EDITED')) }; })()`);
  check('Escape while editing a message cancels the edit and keeps the sheet', esc.open && !esc.saved, JSON.stringify(esc));
  // The history sheet fits a phone
  await sh.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sh.eval(`location.reload()`);
  await sleep(1500);
  const fits = await sh.eval(`(async () => {
    document.getElementById('timers').scrollIntoView();
    [...document.querySelectorAll('#timer-cards .sc-card')].find(c => c.textContent.includes('How long')).click();
    await new Promise(r => setTimeout(r, 400));
    const box = document.querySelector('.sc-sheet'); const worst = Math.max(...[...box.querySelectorAll('.row .btn, h2')].map(e => e.getBoundingClientRect().right));
    return { right: Math.round(box.getBoundingClientRect().right), worst: Math.round(worst), width: innerWidth }; })()`);
  check('the history sheet fits a phone', fits.right <= fits.width && fits.worst <= fits.width, JSON.stringify(fits));

  // Settings → Timers → Focus sounds: pick one, set the volume with the keyboard
  const fs = await chrome.open(`${ext}/pages/settings.html#timers`);
  for (let i = 0; i < 40 && !(await fs.eval(`!!document.querySelector('#timer-cards .sc-card')`)); i++) await sleep(200);
  const picked = await fs.eval(`(async () => {
    const card = [...document.querySelectorAll('#timer-cards .sc-card')].find(c => c.textContent.includes('Focus sounds')); if (!card) return 'no card';
    card.click(); await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('.sc-sheet #sound-choice button')].find(b => b.textContent === 'Rain').click();
    await new Promise(r => setTimeout(r, 400));
    const v = document.querySelector('.sc-sheet #sound-vol'); v.focus(); v.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const c = (await chrome.storage.local.get('config')).config; return c.focusSound + ' ' + c.focusVolume; })()`);
  check('a focus sound and its volume are chosen in Settings', picked === 'rain 1', picked);
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config; c.focusSound = 'off'; c.focusVolume = .5; await chrome.storage.local.set({ config: c }); })()`);

  // Every page opens without errors
  for (const p of ['planner', 'settings', 'welcome', 'focus', 'privacy']) {
    const page = await chrome.open(`${ext}/pages/${p}.html`);
    await sleep(1200);
    await shot(page, 'page-' + p);
  }
} catch (e) {
  check('smoke run finished', false, e.stack);
} finally {
  const real = errors.filter(e => !/youtube\.com|ytimg|googlevideo|doubleclick|ERR_|net::/i.test(e));
  check('no errors in extension pages or worker', real.length === 0, real.slice(0, 5).join('\n'));
  await chrome.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed${skipped ? `, ${skipped} skipped for the time of day` : ''}`);
  process.exit(failed ? 1 : 0);
}
