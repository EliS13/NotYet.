// smoke-sites.mjs — proves every site Not Yet can close really is closed:
// all nine built-in sites (X under both addresses) plus one added by hand.
// Chrome only shows the "Allow access" prompt to a person, so this loads a
// throwaway copy of the extension whose manifest already grants those sites,
// which is exactly the state after someone clicks Allow.
// Run: node dev/smoke-sites.mjs

import { launch, sleep } from './cdp.mjs';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [site id, name, address to open, domains Chrome grants]
const SITES = [
  ['youtube',   'YouTube',   'https://www.youtube.com/watch?v=dQw4w9WgXcQ', []],
  ['tiktok',    'TikTok',    'https://www.tiktok.com/explore',               ['tiktok.com']],
  ['instagram', 'Instagram', 'https://www.instagram.com/explore/',           ['instagram.com']],
  ['reddit',    'Reddit',    'https://www.reddit.com/r/aww/',                ['reddit.com']],
  ['x',         'X',         'https://x.com/explore',                        ['x.com', 'twitter.com']],
  ['x',         'X',         'https://twitter.com/home',                     []],
  ['facebook',  'Facebook',  'https://www.facebook.com/watch/',              ['facebook.com']],
  ['snapchat',  'Snapchat',  'https://www.snapchat.com/spotlight',           ['snapchat.com']],
  ['twitch',    'Twitch',    'https://www.twitch.tv/directory',              ['twitch.tv']],
  ['pinterest', 'Pinterest', 'https://www.pinterest.com/ideas/',             ['pinterest.com']],
  ['custom',    'discord.com', 'https://discord.com/app',                    ['discord.com']],
];

const copy = mkdtempSync(join(tmpdir(), 'ny-ext-'));
for (const p of ['manifest.json', 'background.js', 'lib', 'pages', 'content', 'styles', 'fonts', 'icons']) cpSync(join(root, p), join(copy, p), { recursive: true });
const m = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'));
for (const [, , , ds] of SITES) for (const d of ds) m.host_permissions.push(`https://*.${d}/*`);
writeFileSync(join(copy, 'manifest.json'), JSON.stringify(m, null, 2));

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
let skipped = 0;
const skip = (name, why) => { skipped++; console.log(`SKIP  ${name}  (${why})`); };
// Some sites (X) answer "HeadlessChrome" with a bare 403, which Chrome shows as
// its own error page, where no extension can run. Look like ordinary Chrome.
const chrome = await launch({ extPath: copy,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36' });
const ext = `chrome-extension://${chrome.extId}`;
const lock = ext + '/pages/blocked.html';
const urlOf = async id => (await chrome.targets()).find(t => t.targetId === id)?.url || '';
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const onSite = (u, want) => { const h = hostOf(u), w = hostOf(want); return h === w || h.endsWith('.' + w) || (w === 'twitter.com' && /(^|\.)x\.com$/.test(h)); };
async function waitFor(id, test, ms = 20000) {
  let u = '';
  for (let t = 0; t < ms; t += 400) { u = await urlOf(id); if (test(u)) return u; await sleep(400); }
  return u;
}

try {
  const sw = await chrome.worker();
  await sleep(1200);

  // Every site switched on (discord.com added by hand), bedtime out of the way, one habit not done
  await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
    c.customSites = [{ id: 'site-discord', name: 'discord.com', domains: ['discord.com'] }];
    c.sitesOn = [...NY_SITES.map(s => s.id), 'site-discord'];
    c.bed = { ...c.bed, school: 1620, other: 1620, wake: 240 }; c.onboarded = true; c.toured = true;
    await chrome.storage.local.set({ config: c, tasks: [{ name: 'Read', duration: null, days: Array(7).fill(true) }] }); })()`);
  await sleep(2000);

  // The network rule and the bedtime guard cover everything
  const rule = (await sw.eval(`chrome.declarativeNetRequest.getDynamicRules()`))[0];
  const domains = rule ? rule.condition.requestDomains : [];
  const want = ['youtube.com', 'tiktok.com', 'instagram.com', 'reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'snapchat.com', 'twitch.tv', 'pinterest.com', 'discord.com'];
  const missing = want.filter(d => !domains.includes(d));
  check('block rule covers all 11 addresses', !missing.length, missing.length ? 'missing ' + missing.join(', ') : '');
  const reg = (await sw.eval(`chrome.scripting.getRegisteredContentScripts()`)).flatMap(r => r.matches);
  const noGuard = want.filter(d => d !== 'youtube.com' && !reg.includes(`https://*.${d}/*`));
  check('bedtime guard registered for all 10 non-YouTube addresses', !noGuard.length, noGuard.length ? 'missing ' + noGuard.join(', ') : '');

  // 1. Every site, opened too early, lands on the lock screen with its address kept
  const tabs = [];
  for (const [id, name, url] of SITES) tabs.push({ id, name, url, tab: await chrome.open(url) });
  await sleep(3000);
  for (const t of tabs) {
    const u = await waitFor(t.tab.targetId, x => x.startsWith(lock));
    check(`${t.name.padEnd(11)} ${hostOf(t.url).padEnd(14)} opening it early shows the lock screen`, u === lock + '#' + t.url, u === lock + '#' + t.url ? '' : u);
  }
  const text = await tabs[1].tab.eval(`document.querySelector('#card').innerText`);
  check('lock screen names the sites', /before YouTube \+ 9 more/.test(text), JSON.stringify(text.split('\n')[2]));

  // 2. Finishing the list sends every tab back where it was headed
  await sw.eval(`setHabitDone('Read', new Date(), true)`);
  for (const t of tabs) {
    const u = await waitFor(t.tab.targetId, x => x.startsWith('http'));
    check(`${t.name.padEnd(11)} ${hostOf(t.url).padEnd(14)} finishing the list takes you back`, onSite(u, t.url), u.slice(0, 70));
  }

  // 3. Let the real sites load, then bedtime: every open tab goes to the bedtime screen.
  // Bedtime can only be set from 6 PM to 3 AM, so in the evening it's set to a
  // minute ago; in the morning a noon wake-up (the latest allowed) makes now
  // part of last night. Between noon and 6 PM there's no way to make it bedtime.
  const now = new Date(), mm = now.getHours() * 60 + now.getMinutes(), ev = mm < 240 ? mm + 1440 : mm;
  const evening = mm >= 18 * 60 || mm < 3 * 60, morning = mm >= 4 * 60 && mm < 11 * 60 + 55;
  if (evening || morning) {
    await sleep(9000);
    await sw.eval(`(async () => { const c = (await chrome.storage.local.get('config')).config;
      ${evening ? `c.bed = { ...c.bed, school: ${ev - 1}, other: ${ev - 1} };` : 'c.bed = { ...c.bed, wake: 720 };'}
      await chrome.storage.local.set({ config: c }); })()`);
    for (const t of tabs) {
      const u = await waitFor(t.tab.targetId, x => x.startsWith(lock), 25000);
      let bed = false;
      if (u.startsWith(lock)) {
        const page = await chrome.attach(t.tab.targetId);
        for (let i = 0; i < 15 && !bed; i++) { await sleep(300); bed = await page.eval(`document.body.classList.contains('bed')`).catch(() => false); }
      }
      check(`${t.name.padEnd(11)} ${hostOf(t.url).padEnd(14)} bedtime puts the open tab on the bedtime screen`, bed,
        bed ? '' : u.startsWith(lock) ? 'on the lock page, but not its bedtime screen' : 'still on ' + u.slice(0, 60));
    }
  } else skip('bedtime on every site', 'bedtime can’t be made to start between noon and 6 PM');

  // 4. Switching any of them off waits for tomorrow
  const waits = await sw.eval(`[...NY_SITES.map(s => s.id), 'site-discord'].map(id => nyPlanSite(NY_CFG, id, false).when)`);
  check('switching any site off waits a day', waits.every(w => /^\d{4}-\d{2}-\d{2}$/.test(w)), [...new Set(waits)].join(', '));
} catch (e) {
  check('run finished', false, e.stack);
} finally {
  await chrome.close();
  try { rmSync(copy, { recursive: true, force: true }); } catch {}
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed${skipped ? `, ${skipped} skipped for the time of day` : ''}`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
