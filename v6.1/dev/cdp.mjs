// cdp.mjs — launches a throwaway Chrome with the extension loaded, over the
// DevTools pipe (Chrome 137+ ignores --load-extension). Not shipped.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({ extPath, headless = true, width = 1280, height = 860, userAgent = null }) {
  const profile = mkdtempSync(join(tmpdir(), 'ny-chrome-'));
  const args = [
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-search-engine-choice-screen', `--window-size=${width},${height}`,
    ...(headless ? ['--headless=new'] : []), ...(userAgent ? [`--user-agent=${userAgent}`] : []), 'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const write = proc.stdio[3], read = proc.stdio[4];
  let buf = '', nextId = 1;
  const pending = new Map(), handlers = [];
  read.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else handlers.forEach(h => h(msg));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const on = fn => handlers.push(fn);

  const extId = extPath ? (await send('Extensions.loadUnpacked', { path: extPath })).id : null;

  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    await s('Runtime.enable');
    return {
      sessionId, send: s,
      async eval(expr) {
        const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
    };
  }

  async function open(url) {
    const { targetId } = await send('Target.createTarget', { url });
    const page = await attach(targetId);
    await page.send('Page.enable');
    page.targetId = targetId;
    return page;
  }

  async function worker() {
    for (let i = 0; i < 50; i++) {
      const { targetInfos } = await send('Target.getTargets');
      const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extId));
      if (sw) return attach(sw.targetId);
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('no service worker');
  }

  async function close() {
    try { await send('Browser.close'); } catch {}
    await new Promise(r => setTimeout(r, 300));
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }

  return { send, on, extId, open, attach, worker, close, targets: async () => (await send('Target.getTargets')).targetInfos };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
