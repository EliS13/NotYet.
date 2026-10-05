// guard.js — runs on every site Not Yet closes (YouTube always; TikTok,
// Reddit and the rest once they're switched on). Sites like YouTube never
// reload when you click around, so the network rule in background.js can't
// see it; this script enforces the same rules inside the page:
//   • the lock comes back (a break ends, new work lands): a heads-up, then the lock screen
//   • bedtime: straight to the lock screen, mid-video or not
//   • a few minutes before bedtime: a heads-up in the corner
//   • YouTube on school nights: a video that would end after bedtime doesn't start
// Needs lib/config.js and lib/night.js loaded first.

(() => {
  if (window.__notYet) window.__notYet.stop();
  let alive = true;

  const s = { cfg: nyNormalize({}), calDays: {}, gate: null, prevWhy: null, site: null, on: false };
  let lockAt = 0;            // when a daytime lock takes the tab
  let locking = false;
  let warnDismissed = 0;     // the bedtime the heads-up was closed for

  // Video length check
  let currentId = null, needMeta = false, idSince = 0, verdict = null, refusedEnd = 0, firstTick = true;

  const contextOk = () => { try { return !!chrome.runtime && !!chrome.runtime.id; } catch { return false; } };

  async function load() {
    const v = await chrome.storage.local.get({ config: null, hwSchoolDays: { days: {} }, ytGate: null });
    s.cfg = nyNormalize(v.config);
    s.calDays = (v.hwSchoolDays && v.hwSchoolDays.days) || {};
    s.prevWhy = s.gate ? s.gate.why : null;
    s.gate = v.ytGate;
    s.site = nySiteFor(location.hostname, s.cfg);
    s.on = !!s.site && nySitesOn(s.cfg).some(x => x.id === s.site.id);
  }
  const onChange = (changes, area) => {
    if (area === 'local' && (changes.config || changes.hwSchoolDays || changes.ytGate)) load().then(tick);
  };
  chrome.storage.onChanged.addListener(onChange);

  // ── Page readers ──────────────────────────────────────────────────────────
  function videoId() {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const m = location.pathname.match(/^\/(shorts|live)\/([\w-]+)/);
    return m ? m[2] : null;
  }
  const player = () => document.querySelector('#movie_player');
  const video = () => document.querySelector('#movie_player video') || document.querySelector('video');
  const adShowing = () => !!(player() && player().classList.contains('ad-showing'));

  // Seconds of video, NaN until known, Infinity for a livestream.
  function duration() {
    const v = video();
    if (!v || adShowing() || v.readyState < 1) return NaN;
    if (needMeta && Date.now() - idSince < 4000) return NaN;   // the last video's numbers can linger
    return v.duration;
  }
  const onMeta = e => { if (e.target instanceof HTMLVideoElement) needMeta = false; };
  document.addEventListener('loadedmetadata', onMeta, true);
  document.addEventListener('durationchange', onMeta, true);

  // A refused video stays paused however it's restarted.
  const onPlay = e => {
    if (verdict === 'too-long' && currentId === videoId() && e.target instanceof HTMLVideoElement) e.target.pause();
  };
  document.addEventListener('play', onPlay, true);

  // ── Actions ───────────────────────────────────────────────────────────────
  function lockTab() {
    if (locking) return;
    locking = true;
    try { video() && video().pause(); } catch {}
    try { chrome.runtime.sendMessage({ type: 'yt-lock-tab', url: location.href }); } catch {}
  }

  function el(id, html) {
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.innerHTML = html;
      document.documentElement.appendChild(node);
    }
    node.style.colorScheme = s.cfg.theme === 'system' ? 'light dark' : s.cfg.theme;   // Settings → Appearance
    return node;
  }

  function showOverlay() {
    const o = el('ny-overlay', `
      <div class="ny-card" role="dialog" aria-modal="true" aria-labelledby="ny-o-title">
        <div class="ny-mark" aria-hidden="true"></div>
        <h2 id="ny-o-title">This one runs past bedtime</h2>
        <p class="ny-body"></p>
        <p class="ny-hint">Pick something shorter, or save it for tomorrow.</p>
        <button type="button" class="ny-btn">Go back</button>
      </div>`);
    o.querySelector('.ny-btn').onclick = () => history.back();
    o.querySelector('.ny-body').textContent =
      `It ends at ${nyClock(refusedEnd)}, and bedtime is ${nyClock(nyNight(new Date(), ctx()).closeTs)}.`;
    o.hidden = false;
  }
  const hideOverlay = () => { const o = document.getElementById('ny-overlay'); if (o) o.hidden = true; };

  function showToast(text, { sub = '', closable = false, onClose } = {}) {
    const t = el('ny-toast', `<span class="ny-moon" aria-hidden="true"></span><p role="status"><b></b><span></span></p>
      <button type="button" class="ny-x" aria-label="Dismiss">
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>`);
    t.querySelector('p b').textContent = text;
    t.querySelector('p span').textContent = sub;
    const x = t.querySelector('.ny-x');
    x.hidden = !closable;
    x.onclick = () => { t.hidden = true; if (onClose) onClose(); };
    t.hidden = false;
  }
  const hideToast = () => { const t = document.getElementById('ny-toast'); if (t) t.hidden = true; };

  // ── The rules, checked every second ───────────────────────────────────────
  const ctx = () => ({ cfg: s.cfg, calDays: s.calDays });

  function checkLength(now, night) {
    if (verdict === 'too-long') { try { video().pause(); } catch {} showOverlay(); return; }
    if (verdict === 'ok') return;
    const dur = duration();
    if (Number.isNaN(dur)) return;
    if (!Number.isFinite(dur)) { verdict = 'ok'; return; }        // livestream: bedtime ends it
    const v = video();
    const end = now.getTime() + Math.max(0, dur - v.currentTime) * 1000;
    if (end <= night.closeTs) { verdict = 'ok'; return; }
    verdict = 'too-long';
    refusedEnd = end;
    try { v.pause(); } catch {}
    showOverlay();
  }

  function tick() {
    if (!alive) return;
    if (!contextOk()) { stop(); return; }                          // extension updated or removed
    if (locking) return;
    if (!s.on) { hideToast(); hideOverlay(); return; }            // this site isn't switched on
    const now = new Date();
    const night = nyNight(now, ctx());

    if (night.closed || (s.gate && s.gate.why === 'bed')) return lockTab();

    // The daytime lock came back while this tab was open.
    if (s.gate && s.gate.open === false) {
      if (!lockAt) {
        lockAt = Date.now() + 15000;
        showToast(s.prevWhy === 'break' ? 'Break’s over.' : 'Something new landed on your list.',
          { sub: `${s.site.name} closes in 15 seconds.` });
      }
      if (Date.now() >= lockAt) return lockTab();
      return;
    }
    if (lockAt) { lockAt = 0; hideToast(); }

    // Heads-up before bedtime.
    const warnMs = s.cfg.warn * 60000, left = night.closeTs - now.getTime();
    if (warnMs && left > 0 && left <= warnMs && warnDismissed !== night.closeTs) {
      const mins = Math.ceil(left / 60000);
      showToast(`${mins} minute${mins === 1 ? '' : 's'} to bedtime`,
        { sub: `${s.site.name} closes at ${nyClock(night.closeTs)}.`, closable: true, onClose: () => { warnDismissed = night.closeTs; } });
    } else if (!lockAt) hideToast();

    // School nights: only start videos that finish before bedtime.
    const id = videoId();
    if (id !== currentId) {
      needMeta = !firstTick;
      currentId = id; idSince = Date.now(); verdict = null; refusedEnd = 0;
      hideOverlay();
    }
    firstTick = false;
    if (!id || !night.fit || s.site.id !== 'youtube') {
      if (verdict === 'too-long') verdict = null;
      hideOverlay();
      return;
    }
    checkLength(now, night);
  }

  const iv = setInterval(tick, 1000);

  function stop() {
    alive = false;
    clearInterval(iv);
    try { chrome.storage.onChanged.removeListener(onChange); } catch {}
    document.removeEventListener('loadedmetadata', onMeta, true);
    document.removeEventListener('durationchange', onMeta, true);
    document.removeEventListener('play', onPlay, true);
  }
  window.__notYet = { stop };

  load().then(tick);
})();
