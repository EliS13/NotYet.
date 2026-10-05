// shots.mjs — screenshots of every screen, light and dark, from the preview
// server (python3 dev/serve.py). Output: dev/shots/review/. Not shipped.
// Run: node dev/shots.mjs [filter]

import { launch, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'review');
mkdirSync(out, { recursive: true });
const B = 'http://127.0.0.1:5178/pages/';
const MON = 'd=2026-09-28';
const filter = process.argv[2] || '';

// [name, url, width, height, prep?]  prep runs in the page before the shot
const SHOTS = [
  ['popup', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580],
  ['popup-timer', `popup.html?seed=timer&t=16:20&${MON}`, 780, 580],
  ['popup-tomorrow', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, `document.querySelector('.cal-day.sel').nextElementSibling.click()`],
  ['popup-edit', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, `[...document.querySelectorAll('.grp-head .btn')][0].click()`],
  ['popup-menu', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, `document.querySelectorAll('.row-more')[1].click()`],
  ['popup-bed', `popup.html?seed=done&t=23:30&${MON}`, 780, 580],
  ['popup-fresh', `popup.html?seed=fresh&t=16:20&${MON}`, 780, 580],
  ['popup-tour', `popup.html?seed=busy&tour=1&t=16:20&${MON}`, 780, 580, `document.querySelector('.tour .btn-primary').click(); document.querySelector('.tour .btn-primary').click()`],
  ['planner', `planner.html?seed=busy&t=16:20&${MON}`, 1440, 900],
  ['settings', `settings.html?seed=busy&t=16:20&${MON}`, 1280, 900, null, true],
  ['lock', `blocked.html?seed=busy&t=16:20&${MON}`, 1440, 900],
  ['lock-done', `blocked.html?seed=done&t=16:20&${MON}`, 1440, 900],
  ['bedtime', `blocked.html?seed=busy&t=23:42&${MON}`, 1440, 900],
  ['focus', `focus.html?seed=timer&t=16:20&${MON}#2026-09-28/cal-b`, 1280, 800],
  ['welcome-0', `welcome.html?seed=fresh`, 1280, 800],
  ['welcome-1', `welcome.html?seed=fresh`, 1280, 800, `document.querySelector('.btn-primary').click()`],
  ['welcome-2', `welcome.html?seed=fresh`, 1280, 800, `(async()=>{for(let i=0;i<2;i++){document.querySelector('.btn-primary').click(); await new Promise(r=>setTimeout(r,250));}})()`],
  ['welcome-3', `welcome.html?seed=fresh`, 1280, 800, `(async()=>{for(let i=0;i<3;i++){document.querySelector('.btn-primary').click(); await new Promise(r=>setTimeout(r,250));}})()`],
  ['welcome-4', `welcome.html?seed=fresh`, 1280, 800, `(async()=>{for(let i=0;i<4;i++){document.querySelector('.btn-primary').click(); await new Promise(r=>setTimeout(r,250));}})()`],
  ['welcome-5', `welcome.html?seed=fresh`, 1280, 800, `(async()=>{for(let i=0;i<5;i++){document.querySelector('.btn-primary').click(); await new Promise(r=>setTimeout(r,250));}})()`],
  ['popup-forced', `popup.html?seed=busy&theme=dark&accent=mint&sites=youtube,tiktok,reddit&t=16:20&${MON}`, 780, 580],
  ['lock-sites', `blocked.html?seed=busy&sites=youtube,tiktok,reddit&t=16:20&${MON}#https://www.tiktok.com/@someone`, 1440, 900],
  ['yt', `../dev/yt-mock.html`, 1280, 800],
];

// 6.1: calendars and events. G adds helpers to each prep.
const G = `const W = ms => new Promise(r => setTimeout(r, ms)), $$ = s => [...document.querySelectorAll(s)];
  const row = t => $$('.row-event').find(x => x.innerText.includes(t));
  const gCard = () => $$('#cn-grid .sc-card').find(c => c.querySelector('b').textContent.trim() === 'Google');   // Settings → Connections
  const day = l => $$('.cal-grid button').find(b => (b.getAttribute('aria-label') || '').startsWith(l));
  const typeEvent = async t => { document.querySelector('.add-bar .seg [data-kind="event"]').click();
    const i = document.querySelector('.add-input'); i.value = t; i.dispatchEvent(new Event('input')); await W(200); };`;
const P = (code) => `(async () => { ${G} ${code} })()`;
const OUT = `seed=busy&${MON}`, IN = `seed=busy&google=1&${MON}`, EXP = `seed=busy&google=expired&${MON}`;
SHOTS.push(
  ['ev-popup-out', `popup.html?${OUT}&t=10:30`, 780, 580],
  ['ev-popup-google', `popup.html?${IN}&t=10:30`, 780, 580],
  ['ev-popup-expired', `popup.html?${EXP}&t=16:20`, 780, 580],
  ['ev-day-out', `popup.html?${OUT}&t=10:30`, 780, 580, P(`$$('.grp').find(g => g.querySelector('.row-event')).scrollIntoView({ block: 'start' });`)],
  ['ev-day-google', `popup.html?${IN}&t=10:30`, 780, 580, P(`$$('.grp').find(g => g.querySelector('.row-event')).scrollIntoView({ block: 'start' });`)],
  ['ev-day-expired', `popup.html?${EXP}&t=16:20`, 780, 580, P(`$$('.grp').find(g => g.querySelector('.row-event')).scrollIntoView({ block: 'start' });`)],
  ['ev-add-out', `popup.html?${OUT}&t=16:20`, 780, 580, P(`await typeEvent('Dentist tomorrow 3pm at Main St');`)],
  ['ev-add-google', `popup.html?${IN}&t=16:20`, 780, 580, P(`await typeEvent('Dentist tomorrow 3pm at Main St');`)],
  ['ev-new', `popup.html?${IN}&t=16:20`, 780, 580, P(`await typeEvent('Dentist tomorrow 3pm at Main St'); document.querySelector('.ae-more').click();`)],
  ['ev-edit-local', `popup.html?${OUT}&t=16:20`, 780, 580, P(`day('Friday, October 2').click(); await W(300); row('Movie night').click();`)],
  ['ev-series-checking', `popup.html?${IN}&t=16:20`, 780, 580, P(`const f = window.fetch; window.fetch = (u, o) => String(u).includes('/events/piano') ? new Promise(r => setTimeout(() => r(f(u, o)), 8000)) : f(u, o); row('Piano lesson').click();`)],
  ['ev-series', `popup.html?${IN}&t=16:20`, 780, 580, P(`row('Piano lesson').click();`)],
  ['ev-readonly', `popup.html?${IN}&t=10:30`, 780, 580, P(`row('Math 10').click();`)],
  ['ev-timepop', `popup.html?${IN}&t=16:20`, 780, 580, P(`row('Piano lesson').click(); await W(500); document.querySelector('.ev-when [aria-label^="Starts at"]').click();`)],
  ['ev-scope', `popup.html?${IN}&t=16:20`, 780, 580, P(`row('Piano lesson').click(); await W(500); $$('.ev-foot .btn').find(b => b.textContent === 'Delete').click();`)],
  ['ev-choose', `popup.html?${OUT}&t=16:20`, 780, 580, P(`nyGoogleSignIn();`)],
  ['ev-move', `popup.html?${OUT}&t=16:20`, 780, 580, P(`nyGoogleSignIn(); await W(600); document.querySelector('.ev-dialog .btn-primary, dialog .btn-primary').click();`)],
  ['ev-notice', `popup.html?${OUT}&t=16:20`, 780, 580, P(`evNotice('Google Calendar isn’t connected', GCAL_MESSAGES.access_denied);`)],
  ['ev-planner-out', `planner.html?${OUT}&t=10:30`, 1280, 860],
  ['ev-planner-google', `planner.html?${IN}&t=10:30`, 1280, 860],
  ['ev-planner-expired', `planner.html?${EXP}&t=16:20`, 1280, 860],
  ['ev-planner-out-narrow', `planner.html?${OUT}&t=10:30`, 390, 844],
  ['ev-planner-google-narrow', `planner.html?${IN}&t=10:30`, 390, 844],
  ['ev-planner-expired-narrow', `planner.html?${EXP}&t=16:20`, 390, 844],
  ['ev-w-guide', `welcome.html?seed=fresh`, 1280, 900, P(`for (let i = 0; i < 4; i++) { document.querySelector('.btn-primary').click(); await W(250); } document.querySelector('.how').open = true; await W(100); document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.how').scrollIntoView({ block: 'start' });`)],
  ['ev-w-tags', `welcome.html?seed=fresh`, 1280, 900, P(`for (let i = 0; i < 5; i++) { document.querySelector('.btn-primary').click(); await W(250); }`)],
  ['ev-w-emoji', `welcome.html?seed=fresh`, 1280, 900, P(`for (let i = 0; i < 5; i++) { document.querySelector('.btn-primary').click(); await W(250); } document.querySelectorAll('.tg-row .mark-btn')[1].click();`)],
  ['ev-settings-tags', `settings.html?${OUT}&t=16:20`, 1280, 860, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('tags').getBoundingClientRect().top + scrollY - 24); await W(100); document.querySelector('#tag-cards .sc-card').click(); await W(300); document.querySelector('.sc-sheet .mark-btn').click();`)],
  ['ev-datepop', `popup.html?${IN}&t=16:20`, 780, 580, P(`document.querySelector('.add-day').click();`)],
  ['cn-gallery', `settings.html?${OUT}&apps=1&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('connections').getBoundingClientRect().top + scrollY - 24);`)],
  ['cn-todoist', `settings.html?${OUT}&apps=1&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(300); [...document.querySelectorAll('.sc-card')].find(c => c.textContent.includes('Todoist')).click();`)],
  ['cn-outlook', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(300); [...document.querySelectorAll('.sc-card')].find(c => c.textContent.includes('Outlook')).click();`)],
  ['cn-gcal-out', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(500);`)],
  ['cn-gcal-in', `settings.html?${IN}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(500);`)],
  ['cn-gcal-exp', `settings.html?${EXP}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(500);`)],
  ['cn-ical', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); [...document.querySelectorAll('.sc-card')].find(c => c.textContent.includes('Any calendar')).click(); await W(500);`)],
  ['gg-card', `settings.html?seed=busy&google=2&${MON}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(600);`)],
  ['gg-sheet', `settings.html?seed=busy&google=2&${MON}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(700);`)],
  ['gg-sheet-low', `settings.html?seed=busy&google=2&${MON}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(700); document.querySelector('.sc-sheet').scrollTop = 9999; await W(200);`)],
  ['gg-sheet-off', `settings.html?seed=busy&google=2-off&${MON}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(700); document.querySelector('.sc-sheet').scrollTop = 9999; await W(200);`)],
  ['gg-sheet-expired', `settings.html?seed=busy&google=2-expired&${MON}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(700); document.querySelector('.g-acct + .g-acct').scrollIntoView(); await W(200);`)],
  ['gg-calchoice', `popup.html?seed=busy&google=2&${MON}&t=16:20`, 780, 580, P(`await typeEvent('Study group tomorrow 4pm'); document.querySelector('.ae-more').click(); await W(500); document.querySelector('.ev-cal').click(); await W(300);`)],
  ['cn-gcal-narrow', `settings.html?${IN}&t=16:20`, 390, 844, P(`document.getElementById('connections').scrollIntoView(); await W(400); gCard().click(); await W(500);`)],
  ['sc-bedtime', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('bedtime').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-bed-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('bedtime').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#bedtime .sc-card')].find(c => c.textContent.includes('Bedtime')).click(); await W(400);`)],
  ['sc-before-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('bedtime').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#bedtime .sc-card')].find(c => c.textContent.includes('Before bed')).click(); await W(400);`)],
  ['sc-lower', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('timers').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-hist-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('timers').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#timers .sc-card')].find(c => c.textContent.includes('How long')).click(); await W(400);`)],
  ['sc-run-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('timers').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#timers .sc-card')].find(c => c.textContent.includes('How timers run')).click(); await W(400);`)],
  ['sc-look-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('appearance').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#appearance .sc-card')].find(c => c.textContent.includes('Look')).click(); await W(400);`)],
  ['sc-backup-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('backup').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#backup .sc-card')].find(c => c.textContent.includes('Backup')).click(); await W(400);`)],
  ['sc-over-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('backup').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#backup .sc-card')].find(c => c.textContent.includes('Start over')).click(); await W(400);`)],
  ['sc-about-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('about').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#about .sc-card')].find(c => c.textContent.includes('Not yet.')).click(); await W(400);`)],
  ['sc-bedtime-narrow', `settings.html?${OUT}&t=16:20`, 390, 844, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('bedtime').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-bed-sheet-narrow', `settings.html?${OUT}&t=16:20`, 390, 844, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('bedtime').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#bedtime .sc-card')].find(c => c.textContent.includes('Bedtime')).click(); await W(400);`)],
  ['sc-tags', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('tags').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-tag-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('tags').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#tags .sc-card')].find(c => c.textContent.includes('Homework')).click(); await W(400);`)],
  ['sc-rules-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('tags').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#tags .sc-card')].find(c => c.textContent.includes('How titles')).click(); await W(400);`)],
  ['sc-subjects', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('subjects').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-subject-sheet', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('subjects').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#subjects .sc-card')].find(c => c.textContent.includes('Math')).click(); await W(400);`)],
  ['sc-subject-hue', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('subjects').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#subjects .sc-card')].find(c => c.textContent.includes('Science')).click(); await W(400); const k = document.querySelector('.sc-sheet [role=slider]'); k.focus(); for (const key of ['End', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) k.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await W(300);`)],
  ['sc-subject-sheet-narrow', `settings.html?${OUT}&t=16:20`, 390, 844, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('subjects').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#subjects .sc-card')].find(c => c.textContent.includes('Math')).click(); await W(400);`)],
  ['sc-messages', `settings.html?${OUT}&sites=youtube,tiktok&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('messages').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['sc-msg-yt', `settings.html?${OUT}&sites=youtube,tiktok&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('messages').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#messages .sc-card')].find(c => c.textContent.includes('YouTube')).click(); await W(400);`)],
  ['sc-msg-bed', `settings.html?${OUT}&sites=youtube,tiktok&t=16:20`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('messages').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#messages .sc-card')].find(c => c.textContent.includes('At bedtime')).click(); await W(400);`)],
  ['sc-msg-yt-narrow', `settings.html?${OUT}&sites=youtube,tiktok&t=16:20`, 390, 844, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('messages').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#messages .sc-card')].find(c => c.textContent.includes('YouTube')).click(); await W(400);`)],
  ['sc-top', `settings.html?${OUT}&t=16:20`, 1280, 900],
  ['sc-top-narrow', `settings.html?${OUT}&t=16:20`, 390, 844],
  ['sc-conn-narrow', `settings.html?${OUT}&t=16:20`, 390, 844, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('connections').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['notes-folded', `planner.html?seed=busy&t=16:20&${MON}`, 1440, 900, P(`const t = document.querySelector('.sn-tile .sn-text'); t.scrollIntoView({ block: 'center' }); t.focus(); await W(300);`)],
  ['notes-open', `planner.html?seed=busy&t=16:20&${MON}`, 1440, 900, P(`const t = document.querySelector('.sn-tile .sn-text'); t.scrollIntoView({ block: 'center' }); document.querySelector('.sn-tile .sn-color[aria-pressed=true]').focus(); await W(400);`)],
  ['st-popup', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580],
  ['st-usual', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`const i = document.querySelector('.add-input'); i.focus(); i.value = 'Algebra worksheet'; i.dispatchEvent(new Event('input')); await W(200);`)],
  ['st-planner', `planner.html?seed=busy&t=16:20&${MON}`, 1440, 900],
  ['stats', `stats.html?seed=stats&t=16:20&${MON}`, 1280, 1000],
  ['stats-month', `stats.html?seed=stats&range=month&t=16:20&${MON}`, 1280, 1000],
  ['stats-empty', `stats.html?seed=fresh&t=16:20&${MON}`, 1280, 900],
  ['stats-narrow', `stats.html?seed=stats&t=16:20&${MON}`, 390, 844],
  ['st-review', `popup.html?seed=stats&t=16:20&d=2026-10-04`, 780, 580],
  ['st-review-planner', `planner.html?seed=stats&t=16:20&d=2026-10-04`, 1440, 900],
  ['fc-steps', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`await hwSetSteps(hwTodayStr(), 'cal-c', [{ id: 'a', text: 'Read pages 80 to 92', done: true }, { id: 'b', text: 'Write down the three key terms', done: false }, { id: 'c', text: 'Summary in five lines', done: false }]); await W(600); document.querySelector('.row-steps').scrollIntoView({ block: 'center' }); await W(200);`)],
  ['fc-steps-pop', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`await hwSetSteps(hwTodayStr(), 'cal-c', [{ id: 'a', text: 'Read pages 80 to 92', done: true }, { id: 'b', text: 'Write down the three key terms', done: false }, { id: 'c', text: 'Summary in five lines', done: false }]); await W(600); document.querySelector('.row-steps').scrollIntoView({ block: 'start' }); await W(200); [...document.querySelectorAll('.day-list .row')].find(r => r.textContent.includes('Chapter 5')).querySelector('.row-more').click(); await W(200); [...document.querySelectorAll('.menu button')].find(b => b.textContent.includes('steps')).click(); await W(200);`)],
  ['fc-keep', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`const { hwActiveTimers: tm = {} } = await chrome.storage.local.get('hwActiveTimers'); tm['cal-b'] = { startedAt: Date.now() - 6 * 60000, mode: 'up', estMin: 45, taskDate: hwTodayStr(), pausedMs: 0, totalMs: 0, breakOffsets: [], askKeepGoing: true }; await chrome.storage.local.set({ hwActiveTimers: tm }); await W(600); document.querySelector('.keep-going').scrollIntoView({ block: 'center' }); await W(200);`)],
  ['fc-timers', `settings.html?seed=busy&t=16:20&${MON}`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('timers').getBoundingClientRect().top + scrollY - 24); await W(300);`)],
  ['fc-sound-sheet', `settings.html?seed=busy&t=16:20&${MON}`, 1280, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('timers').getBoundingClientRect().top + scrollY - 24); await W(300); [...document.querySelectorAll('#timer-cards .sc-card')].find(c => c.textContent.includes('Focus sounds')).click(); await W(300); [...document.querySelectorAll('#sound-choice button')].find(b => b.textContent === 'Rain').click(); await W(300);`)],
  ['fc-focus-start', `focus.html?seed=busy&t=16:20&${MON}#2026-09-28/cal-c`, 1280, 800],
  ['fc-focus-keep', `focus.html?seed=busy&t=16:20&${MON}#2026-09-28/cal-b`, 1280, 800, P(`const { hwActiveTimers: tm = {} } = await chrome.storage.local.get('hwActiveTimers'); tm['cal-b'] = { startedAt: Date.now() - 6 * 60000, mode: 'up', estMin: 45, taskDate: hwTodayStr(), pausedMs: 0, totalMs: 0, breakOffsets: [], askKeepGoing: true }; await chrome.storage.local.set({ hwActiveTimers: tm }); await W(700);`)],
  ['nt-popup', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580],
  ['nt-pop', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`[...document.querySelectorAll('.next-test button')].find(b => b.textContent === 'Plan study').click(); await W(300);`)],
  ['nt-planned', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`const k = 'math unit test|' + hwTodayStr(nyAddDays(new Date(), 3)); await chrome.storage.local.set({ testPlans: { [k]: { at: 1, n: 3, min: 25 } } }); for (const n of [0, 1, 2]) await hwAddTask(hwTodayStr(nyAddDays(new Date(), n)), { title: 'Study: Math unit test', estMin: 25, course: 'math', studyFor: k }); const l = (await chrome.storage.local.get('hwTasksByDay')).hwTasksByDay; l[hwTodayStr()].find(t => t.studyFor).done = true; await chrome.storage.local.set({ hwTasksByDay: l }); await W(700);`)],
  ['nt-planner', `planner.html?seed=busy&t=16:20&${MON}`, 1440, 900],
  ['nt-then', `popup.html?seed=busy&t=16:20&${MON}`, 780, 580, P(`const k = 'math unit test|' + hwTodayStr(nyAddDays(new Date(), 3)); const { localEvents = [] } = await chrome.storage.local.get({ localEvents: [] }); const at = nyParseDs(hwTodayStr(nyAddDays(new Date(), 4))).getTime() + 9 * 3600000; localEvents.push({ id: 'l-chem', title: 'Chem quiz', allDay: false, start: at, end: at + 3600000, place: '', notes: '', repeat: null, skip: [] }); await chrome.storage.local.set({ localEvents, testPlans: { [k]: { at: 1, n: 3, min: 25 } } }); for (const n of [0, 1, 2]) await hwAddTask(hwTodayStr(nyAddDays(new Date(), n)), { title: 'Study: Math unit test', estMin: 25, course: 'math', studyFor: k }); await W(800);`)],
  ['cn-canvas', `settings.html?${OUT}&t=16:20`, 1280, 900, P(`document.getElementById('connections').scrollIntoView(); await W(300); [...document.querySelectorAll('.sc-card')].find(c => c.textContent.includes('Canvas')).click();`)],
  ['cn-popup', `popup.html?${OUT}&apps=1&t=16:20`, 780, 580],
  ['cn-narrow', `settings.html?${OUT}&apps=1&t=16:20`, 520, 900, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('connections').getBoundingClientRect().top + scrollY - 24);`)],
  ['ev-settings-out', `settings.html?${OUT}&t=16:20`, 1280, 860, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('calendar').getBoundingClientRect().top + scrollY - 24);`)],
  ['ev-settings-google', `settings.html?${IN}&t=16:20`, 1280, 860, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('calendar').getBoundingClientRect().top + scrollY - 24);`)],
  ['ev-settings-expired', `settings.html?${EXP}&t=16:20`, 1280, 860, P(`document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.getElementById('calendar').getBoundingClientRect().top + scrollY - 24);`)],
);

const chrome = await launch({});
const page = await chrome.open('about:blank');
await page.send('Page.bringToFront');
let current = '';
chrome.on(m => {
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', current, m.params.exceptionDetails.exception?.description?.split('\n').slice(0, 3).join(' | '));
});
try {
  for (const [name, url, w, h, prep, full] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    for (const scheme of ['light', 'dark']) {
      current = name + '-' + scheme;
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await page.send('Page.navigate', { url: 'about:blank' });
      await sleep(100);
      await page.send('Page.navigate', { url: B + url });
      for (let i = 0; i < 60; i++) {
        await sleep(150);
        try { if (await page.eval(`location.protocol === 'http:' && document.readyState === 'complete' && document.body.children.length > 0 && document.body.innerText.trim().length > 0`)) break; } catch {}
      }
      await sleep(600);
      if (prep) { try { await page.eval(prep); } catch (e) { console.log(name, 'prep failed', e.message); } await sleep(700); }
      let clip;
      if (full) {
        const m = await page.send('Page.getLayoutMetrics');
        clip = { x: 0, y: 0, width: w, height: Math.ceil(m.cssContentSize.height), scale: 1 };
      }
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      writeFileSync(join(out, `${name}-${scheme}.png`), Buffer.from(data, 'base64'));
    }
    console.log('shot', name);
  }
} finally {
  await chrome.close();
}
