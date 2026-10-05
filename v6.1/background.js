importScripts('lib/config.js', 'lib/night.js', 'lib/ics.js', 'lib/core.js', 'lib/gcal.js', 'lib/events.js',
  'lib/connections.js', 'lib/apps/todoist.js', 'lib/apps/google-tasks.js', 'lib/apps/ms-todo.js', 'lib/apps/canvas.js', 'lib/stats.js');

const RULE_ID = 1;
const LOCK_PAGE = 'pages/blocked.html';

// ── The gate ─────────────────────────────────────────────────────────────────
// Works out whether YouTube (and any other switched-on site) is open, then:
//   • a network rule sends new page loads on those sites to the lock screen,
//   • `ytGate` in storage tells tabs already open on them (content/guard.js),
//   • the toolbar badge shows how many things are left.

let refreshing = null, again = false;

async function refreshBlock() {
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    do { again = false; await applyGate(); } while (again);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function applyGate() {
  await nyLoadConfig();
  const store = await getStorage();
  const hw = await getHwState();
  const gate = nyGate(store, hw);

  if (gate.why === 'break') chrome.alarms.create('hw-break-end', { when: gate.until + 1000 });
  // The list finished before bedtime: today counts toward the streak. Days the
  // computer stayed off with nothing on the list are rest days, not breaks.
  const { nyDoneDays = {} } = await chrome.storage.local.get({ nyDoneDays: {} });
  const carried = new Set(Object.values(hw.hwTasksByDay).flat().map(t => t.carriedFrom).filter(Boolean));
  const emptyOn = ds => { const d = nyParseDs(ds);
    return !habitsOn(store.tasks, d).length && (!hwGatesOn(d) || (!(hw.hwTasksByDay[ds] || []).length && !carried.has(ds))); };
  const rested = nyRestDays(nyDoneDays, emptyOn);
  const recorded = nyRecordDone(rested || nyDoneDays, gate);
  if (recorded || rested) await chrome.storage.local.set({ nyDoneDays: recorded || rested });

  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const domains = await allowedDomains();
  const addRules = gate.open || !domains.length ? [] : [{
    id: RULE_ID, priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: chrome.runtime.getURL(LOCK_PAGE) + '#\\0' } },
    condition: { regexFilter: '^https?://.*', requestDomains: domains, resourceTypes: ['main_frame'] },
  }];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.map(r => r.id), addRules });

  const { ytGate } = await chrome.storage.local.get({ ytGate: null });
  const next = { open: gate.open, why: gate.why, until: gate.until || 0 };
  if (!ytGate || ytGate.open !== next.open || ytGate.why !== next.why || ytGate.until !== next.until)
    await chrome.storage.local.set({ ytGate: next });

  await paintBadge(gate);
  nySoundSync().catch(() => {});
}

// ── Focus sounds ─────────────────────────────────────────────────────────────
// Made in an offscreen page (offscreen.js) while a task timer really runs: not
// paused, not on a break. The page opens when a sound should play; once it has
// faded out it says so (soundSilent) and is closed. A sample from Settings plays for five seconds.

let soundNow = null, soundVol = null, sample = null;        // sample: { sound, volume, until }

// Opens the page if it isn't there. Resolves true if it already was: a new one
// asks for its sound itself once it's ready (soundReady).
async function offscreenOpen() {
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) return true;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'],
    justification: 'Plays focus sounds, made on the device, while a task timer runs' }).catch(() => {});
  return false;
}
const toOffscreen = msg => chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});

async function nySoundSync(force = false) {
  await nyLoadConfig();
  const want = nySoundFor(await getHwTimers(), NY_CFG), vol = NY_CFG.focusVolume;
  if (sample && Date.now() > sample.until) sample = null;
  if (!force && want === soundNow && vol === soundVol) return;
  soundNow = want; soundVol = vol;
  if (want) { if (await offscreenOpen()) toOffscreen({ play: want, volume: vol }); }
  else if (sample) { if (await offscreenOpen()) toOffscreen({ play: sample.sound, volume: sample.volume, sample: true }); }
  else if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) toOffscreen({ stop: true });
}

// Domains of switched-on sites that Chrome has actually given access to.
// YouTube's access comes with the extension; the rest are granted in Settings.
async function allowedDomains() {
  const out = [];
  for (const site of nySitesOn()) for (const d of site.domains) {
    if (d === 'youtube.com' || await chrome.permissions.contains({ origins: [`https://*.${d}/*`] })) out.push(d);
  }
  return out;
}

// guard.js is declared for YouTube in the manifest; other sites get it here,
// once they're switched on and allowed.
async function syncGuards() {
  await nyLoadConfig();
  const matches = (await allowedDomains()).filter(d => d !== 'youtube.com').map(d => `https://*.${d}/*`);
  const had = await chrome.scripting.getRegisteredContentScripts({ ids: ['ny-guard'] });
  if (had.length) await chrome.scripting.unregisterContentScripts({ ids: ['ny-guard'] });
  if (matches.length) await chrome.scripting.registerContentScripts([{
    id: 'ny-guard', matches, runAt: 'document_idle', persistAcrossSessions: true,
    js: ['lib/config.js', 'lib/night.js', 'content/guard.js'], css: ['content/guard.css'],
  }]);
}

async function paintBadge(gate) {
  let text = '';
  if (gate.why === 'bed') text = 'zz';
  else if (gate.why === 'tasks') text = String(Math.min(gate.counts.left, 99));
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: gate.why === 'bed' ? '#4B4478' : '#F4B6CC' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: gate.why === 'bed' ? '#FFFFFF' : '#2A2745' });
  const sites = nySitesLabel();
  await chrome.action.setTitle({ title:
    gate.why === 'bed' ? `Not yet. Bedtime, ${sites} opens at ${nyClock(gate.openTs)}.`
    : gate.why === 'tasks' ? `Not yet. ${gate.counts.left} left before ${sites} opens.`
    : gate.why === 'break' ? 'Not yet. On a break.'
    : 'All done. Enjoy.' });
}

// ── Clock edges ──────────────────────────────────────────────────────────────
// One alarm follows bedtime, wake time and midnight, re-checking the gate at
// each and moving a waiting (later) bedtime into place once its day arrives.

async function scheduleNight() {
  await nyLoadConfig();
  await getHwState();
  await chrome.alarms.create('yt-night-edge', { when: nyNextEdge(new Date(), nyNightCtx()) + 1000 });
}

// Midnight: a waiting bedtime, or a site switched off yesterday, takes effect.
async function promoteBedtime() {
  const cfg = await nyLoadConfig();
  const next = nyPromoteBed(cfg);
  for (const s of cfg.customSites.filter(s => next && !next.customSites.some(x => x.id === s.id)))   // removed at midnight
    chrome.permissions.remove({ origins: s.domains.map(d => `https://*.${d}/*`) }).catch(() => {});
  if (next) await nySaveConfig({ bed: next.bed, bedNext: next.bedNext, sitesOn: next.sitesOn, sitesOffFrom: next.sitesOffFrom, customSites: next.customSites });
}

// ── Morning ──────────────────────────────────────────────────────────────────

async function scheduleMorning() {
  await chrome.alarms.create('hw-morning', { when: hwNextMorning() });
}

async function syncQuietly() {
  try { await hwSyncFromCalendar({ force: true }); }
  catch (e) { await chrome.storage.local.set({ hwLastSyncError: String(e.message || e) }); }
}

async function morningRefresh() {
  await promoteBedtime();
  await hwRollForward();
  await syncQuietly();
  await refreshBlock();
  await scheduleMorning();
}

async function catchUpIfStale() {
  const { hwLastSync = 0, hwLastRoll = '' } = await chrome.storage.local.get({ hwLastSync: 0, hwLastRoll: '' });
  await promoteBedtime();
  if (hwLastRoll !== hwTodayStr()) await hwRollForward();
  if (!hwSyncedToday(hwLastSync)) await syncQuietly();
}

// ── Install and startup ──────────────────────────────────────────────────────

// Tabs already open on a closed site when the extension installs or updates
// don't have guard.js yet; give it to them so bedtime still reaches them.
async function reachOpenTabs() {
  try {
    await nyLoadConfig();
    const url = (await allowedDomains()).map(d => `*://*.${d}/*`);
    if (!url.length) return;
    for (const tab of await chrome.tabs.query({ url })) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/guard.css'] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id },
          files: ['lib/config.js', 'lib/night.js', 'content/guard.js'] });
      } catch {}
    }
  } catch {}
}

async function boot() {
  await gcalMigrate().catch(() => {});         // one Google account → several (lib/gcal.js)
  await hwEnsureInstallDate();                 // the Sunday review skips the week you installed
  if (!(await chrome.alarms.get('hourly'))) await chrome.alarms.create('hourly', { periodInMinutes: 60 });
  if (!(await chrome.alarms.get('hw-morning'))) await scheduleMorning();
  await scheduleNight();
  await catchUpIfStale();
  await syncGuards();
  await refreshBlock();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.alarms.clear('yt-last-call');      // v5.7 alarms, retired
  await chrome.alarms.clear('yt-night-end');
  await chrome.alarms.clear('bonus-end');

  const { config, tasks = [] } = await chrome.storage.local.get({ config: null, tasks: [] });
  if (!config) {
    // Someone updating from v5 already knows the ropes; everyone else gets the welcome.
    const existing = tasks.length > 0 || (await chrome.storage.local.get({ hwSettings: null })).hwSettings;
    await nySaveConfig({ onboarded: !!existing, toured: false });
  }
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
  await boot();
  await reachOpenTabs();
});

chrome.runtime.onStartup.addListener(boot);

// ── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'yt-lock-tab' && sender.tab) {
    // Only ever back to a page on one of the sites this closes.
    let back = '';
    try { const u = new URL(msg.url); if (/^https?:$/.test(u.protocol) && nySiteFor(u.hostname)) back = '#' + u.href; } catch {}
    chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL(LOCK_PAGE) + back });
  }
  if (msg && msg.type === 'sync-now') {
    hwSyncFromCalendar({ force: true })
      .then(added => reply({ ok: true, added }))
      .catch(e => { chrome.storage.local.set({ hwLastSyncError: String(e.message || e) }); reply({ ok: false, error: String(e.message || e) }); });
    return true;
  }
  if (msg && msg.type === 'reschedule') { scheduleNight().then(refreshBlock); }
  // Focus sounds: the page is ready, a sample ended, or Settings wants a sample
  if (msg && msg.target === 'background' && msg.sampleEnded) sample = null;          // played once; don't play it again
  if (msg && msg.target === 'background' && (msg.soundReady || msg.sampleEnded)) nySoundSync(true);
  if (msg && msg.target === 'background' && msg.soundSilent && !soundNow && !sample) chrome.offscreen.closeDocument().catch(() => {});
  if (msg && msg.type === 'sound-sample' && NY_SOUNDS.includes(msg.sound) && msg.sound !== 'off') {
    sample = { sound: msg.sound, volume: +msg.volume || .5, until: Date.now() + 5500 };
    offscreenOpen().then(had => { if (had) toOffscreen({ play: sample.sound, volume: sample.volume, sample: true }); });
  }
});

// ── Alarms ───────────────────────────────────────────────────────────────────

// A 25-minute block just finished: YouTube opens for one break. Its end is
// always on the clock, so the gate and the focus sound catch up with it.
async function hwBreakStarted() {
  const until = Date.now() + HW_BREAK_MS;
  await chrome.alarms.create('hw-break-end', { when: until + 1000 });
  await chrome.storage.local.set({ breakUntil: until });
}

chrome.alarms.onAlarm.addListener(async alarm => {
  const n = alarm.name;
  if (n === 'hw-morning') return morningRefresh();
  if (n === 'yt-night-edge') { await promoteBedtime(); await refreshBlock(); return scheduleNight(); }
  if (n === 'hourly') { await catchUpIfStale(); await calRefreshSources().catch(() => {}); await connRefresh().catch(() => {}); return refreshBlock(); }
  if (n === 'hw-break-end') return refreshBlock();
  if (n.startsWith('hwbrk::')) return hwBreakStarted();
  if (n.startsWith('hwdone::')) return hwTimerRanOut(n.slice('hwdone::'.length));
  if (n.startsWith('timer::')) {
    const name = n.slice('timer::'.length);
    await autoCompleteTask(name);
    const { activeTimers } = await chrome.storage.local.get({ activeTimers: {} });
    delete activeTimers[name];
    await chrome.storage.local.set({ activeTimers });
  }
});

// Anything that could change the answer re-runs the gate. The gate's own
// output (ytGate), sync bookkeeping and calendar events (which never count)
// don't; school days come through hwSchoolDays, which does.
const QUIET_KEYS = new Set(['ytGate', 'hwLastSync', 'hwLastSyncError', 'stickyNotes', 'hwLog', 'hwDismissed', 'hwLastRoll',
  'calFeeds', 'feedCache', 'localEvents', 'calLocalColor', 'calLocalNoteSeen', 'gcalAccounts', 'gcalCalendars', 'gcalCache', 'gcalDefault', 'connections', 'connCache', 'connDismissed', 'nyDoneDays', 'testPlans']);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.every(k => QUIET_KEYS.has(k))) return;
  if (changes.config || changes.hwSchoolDays) await scheduleNight();
  if (changes.config) await syncGuards();
  await refreshBlock();
});

// Access to a site granted or taken away in Chrome's own settings.
chrome.permissions.onAdded.addListener(async () => { await syncGuards(); await refreshBlock(); await reachOpenTabs(); });
chrome.permissions.onRemoved.addListener(async () => { await syncGuards(); await refreshBlock(); });
