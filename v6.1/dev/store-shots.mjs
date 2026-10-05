// store-shots.mjs — the Chrome Web Store images: five 1280×800 screenshots
// and the 440×280 / 1400×560 promo tiles. Needs dev/serve.py running.
// Output: store/images/v<version>/ (each release keeps its own). Run: node dev/store-shots.mjs

import { launch, sleep } from './cdp.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const out = join(root, 'store', 'images', 'v' + version);
mkdirSync(out, { recursive: true });
const S = 'http://127.0.0.1:5178';
const MON = 't=16:20&d=2026-09-28';
const frame = p => `${S}/dev/store/frame.html?` + new URLSearchParams(p).toString();

const SHOTS = [
  ['1-popup', frame({ layout: 'side', src: `/pages/popup.html?seed=busy&${MON}`, w: 780, h: 580, s: 1,
    title: 'Your list first. Then YouTube.',
    sub: 'Homework, habits and your calendar in one popup. Tick everything off and YouTube opens by itself.' }), 1280, 800],
  ['2-lock', frame({ layout: 'top', src: `/pages/blocked.html?seed=busy&${MON}`, w: 1440, h: 900, s: 0.78,
    title: 'Too early? Not yet.',
    sub: 'Open YouTube before you’re done and you land here instead, with what’s left. At bedtime it closes by itself.' }), 1280, 800],
  ['3-planner', frame({ layout: 'top', src: `/pages/planner.html?seed=busy&${MON}`, w: 1440, h: 900, s: 0.78,
    title: 'A whole planner, not just a blocker.',
    sub: 'Plan the month, see your next test coming, and spread short study sessions over the days before it.' }), 1280, 800],
  ['4-stats', frame({ layout: 'top', src: `/pages/stats.html?seed=stats&range=month&${MON}`, w: 1440, h: 900, s: 0.78,
    title: 'See where your time goes.',
    sub: 'How long each subject really takes you, how close your guesses are, and when you focus best.' }), 1280, 800],
  ['5-google', frame({ layout: 'top', src: `/pages/settings.html?seed=busy&google=2&${MON}`, to: 'connections', open: 'Google', reveal: '.sc-sheet .g-acct', w: 1440, h: 900, s: 0.78,
    title: 'Every calendar. Every account.',
    sub: 'Sign in with Google for your calendars and Google Tasks, from school and personal accounts. Todoist and Canvas work too.' }), 1280, 800],
  ['tile-small', `${S}/dev/store/tile.html`, 440, 280],
  ['tile-marquee', `${S}/dev/store/tile.html?size=marquee`, 1400, 560],
];

const chrome = await launch({});
const page = await chrome.open('about:blank');
await page.send('Page.bringToFront');
try {
  for (const [name, url, w, h] of SHOTS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await page.send('Page.navigate', { url });
    await sleep(3500);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    writeFileSync(join(out, name + '.png'), Buffer.from(data, 'base64'));
    console.log('store image', name);
  }
} finally { await chrome.close(); }
