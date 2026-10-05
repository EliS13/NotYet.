importScripts('lib/config.js', 'lib/night.js', 'lib/ics.js', 'lib/core.js');

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
  if (next) await nySaveConfig({ bed: next.bed, bedNext: next.bedNext, sitesOn: next.sitesOn, sitesOffFrom: next.sitesOffFrom });
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
});

// ── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  const n = alarm.name;
  if (n === 'hw-morning') return morningRefresh();
  if (n === 'yt-night-edge') { await promoteBedtime(); await refreshBlock(); return scheduleNight(); }
  if (n === 'hourly') { await catchUpIfStale(); return refreshBlock(); }
  if (n === 'hw-break-end') return refreshBlock();
  if (n.startsWith('hwbrk::')) {
    // A 25-minute block just finished: YouTube opens for one break.
    return chrome.storage.local.set({ breakUntil: Date.now() + HW_BREAK_MS });
  }
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
// output (ytGate) and sync bookkeeping don't.
const QUIET_KEYS = new Set(['ytGate', 'hwLastSync', 'hwLastSyncError', 'calAgenda', 'stickyNotes', 'hwLog', 'hwDismissed', 'hwLastRoll']);

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
