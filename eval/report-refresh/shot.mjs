// A headless-Chrome screenshot over the DevTools protocol (Node's own WebSocket, no packages):
// opens the URL, waits until `ready` (a JS expression) is true in the page, lets it settle, and
// saves a PNG. Used by run.mjs for the before/after shots of a report page.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function screenshot({ url, file, profile, ready = 'true', settleMs = 2500 }) {
  if (!existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME}`);
  mkdirSync(dirname(file), { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1280,1600',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), 30_000);
      chrome.stderr.on('data', (d) => {
        text += d.toString();
        const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      chrome.on('close', () => reject(new Error('Chrome exited')));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    };
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: 1280,
        height: 1600,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sessionId,
    );
    await send('Page.navigate', { url }, sessionId);
    const deadline = Date.now() + 45_000;
    for (;;) {
      const r = await send(
        'Runtime.evaluate',
        { expression: `Boolean(${ready})`, returnByValue: true },
        sessionId,
      );
      if (r.result?.value === true) break;
      if (Date.now() > deadline) throw new Error(`page never got ready: ${ready}`);
      await sleep(250);
    }
    await sleep(settleMs);
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(file, Buffer.from(data, 'base64'));
    await send('Browser.close').catch(() => {});
    ws.close();
  } finally {
    await sleep(200);
    if (chrome.exitCode === null) process.kill(chrome.pid, 'SIGTERM');
  }
}
