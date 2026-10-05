// offscreen.js — focus sounds, made live with Web Audio while a task timer runs:
// brown noise, rain and waves. Nothing is downloaded, recorded or sent. The
// background opens this page and sends it
//   { target: 'offscreen', play: 'brown' | 'rain' | 'waves', volume, sample? }
//   { target: 'offscreen', stop: true }
// A sample plays for five seconds. Stopping fades out, then the background closes the page.

let ctx = null, master = null, playing = null, parts = [], dropTimer = null, sampleTimer = null, closeTimer = null, teardownTimer = null;
const FADE = 0.6;

async function audio() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule('offscreen-noise.js');
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

const noise = kind => new AudioWorkletNode(ctx, 'ny-noise', { outputChannelCount: [2], processorOptions: { kind } });
function filter(type, frequency, Q = 0.7) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; return f; }
function gain(value) { const g = ctx.createGain(); g.gain.value = value; return g; }
const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); parts.push(...nodes); return nodes[nodes.length - 1]; };

// Each sound is a small graph ending in the master gain
const SOUNDS = {
  // Deep and even: brown noise, a little rounded off
  brown() { chain(noise('brown'), filter('lowpass', 900), gain(0.9), master); },
  // A steady hiss of rain on a window, and drops landing now and then
  rain() {
    chain(noise('pink'), filter('highpass', 350), filter('lowpass', 6500), gain(0.55), master);
    const burst = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
    const b = burst.getChannelData(0);
    for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / b.length, 3);
    const drop = () => {
      if (!playing) return;
      const src = ctx.createBufferSource(), f = filter('bandpass', 1400 + Math.random() * 3600, 2.5), g = gain(0.04 + Math.random() * 0.12);
      src.buffer = burst; src.connect(f); f.connect(g); g.connect(master); src.start();
      src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
      dropTimer = setTimeout(drop, 20 + Math.random() * 90);
    };
    drop();
  },
  // Slow swells, like waves reaching a beach
  waves() {
    const swell = gain(0.45);
    chain(noise('pink'), filter('lowpass', 520), swell, master);
    for (const [hz, depth] of [[0.075, 0.3], [0.031, 0.15]]) {
      const lfo = ctx.createOscillator(), amt = gain(depth);
      lfo.frequency.value = hz; lfo.connect(amt); amt.connect(swell.gain); lfo.start();
      parts.push(lfo, amt);
    }
  },
};

function teardown() {
  clearTimeout(dropTimer);
  for (const n of parts) { try { if (n.stop) n.stop(); } catch {} try { n.disconnect(); } catch {} }
  parts = [];
}

async function play(kind, volume = 0.5, sample = false) {
  if (!SOUNDS[kind]) return;
  await audio();
  if (ctx.state === 'suspended') await ctx.resume();
  clearTimeout(closeTimer); clearTimeout(sampleTimer); clearTimeout(teardownTimer);   // a stop just before mustn't take this sound down
  const now = ctx.currentTime, level = Math.max(0.05, Math.min(1, volume)) * 0.6;
  if (playing !== kind) {
    teardown();
    playing = kind;
    SOUNDS[kind]();
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
  }
  master.gain.linearRampToValueAtTime(level, now + FADE);
  if (sample) sampleTimer = setTimeout(() => {           // the sample's done: back to whatever the timers want
    stop();
    chrome.runtime.sendMessage({ target: 'background', sampleEnded: true }).catch(() => {});
  }, 5000);
}

function stop() {
  if (!ctx || !playing) { closeSoon(); return; }
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + FADE);
  playing = null;
  teardownTimer = setTimeout(() => { if (!playing) teardown(); }, FADE * 1000 + 50);
  closeSoon();
}
// Nothing playing for a moment: the background can close this page
function closeSoon() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (!playing) chrome.runtime.sendMessage({ target: 'background', soundSilent: true }).catch(() => {}); }, FADE * 1000 + 300);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.status) { reply({ playing, state: ctx ? ctx.state : 'none', parts: parts.length }); return; }   // for the smoke test
  if (msg.stop) stop();
  else if (msg.play) play(msg.play, msg.volume, !!msg.sample);
});
chrome.runtime.sendMessage({ target: 'background', soundReady: true }).catch(() => {});   // ready: tell the background what to play
