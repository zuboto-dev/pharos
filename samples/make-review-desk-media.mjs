// Writes the made-up pictures and sound of the R15 "Review desk (sample)" in
// samples/files/review-desk/: three phone screenshots of an invented shopping-list app
// ("Pantry", no real product, brand or person; each marked SAMPLE) rendered from HTML in headless
// Chrome over the DevTools protocol (Node's own WebSocket, no packages), and a short reminder
// chime synthesized as 16-bit mono WAV.
//
//   node samples/make-review-desk-media.mjs
//
// Needs Google Chrome at the usual macOS path for the screenshots (the chime needs nothing).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'files', 'review-desk');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 390;
const H = 640;

// ------------------------------------------------------------------ the screens

const ITEMS = [
  ['Oat milk', '2 cartons'],
  ['Rye bread', '1 loaf'],
  ['Lemons', '6'],
  ['Basmati rice', '1 kg'],
  ['Tinned tomatoes', '4'],
  ['Spinach', '1 bag'],
  ['Coffee beans', '250 g'],
  ['Dish soap', '1'],
];

const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #f6f4ef;
    font: 16px/1.35 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #1f1c17; }
  .status { height: 44px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 22px; font-size: 14px; font-weight: 600; }
  header { padding: 6px 20px 12px; display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.01em; }
  .count { color: #7a7266; font-size: 14px; }
  .banner { background: #2b2a33; color: #fff; padding: 12px 20px; font-size: 14px;
    display: flex; gap: 10px; align-items: center; }
  .banner b { font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #f5a524; flex: none; }
  .overlay { position: absolute; left: 12px; right: 12px; top: 104px; border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,.25); padding: 16px 18px; }
  ul { list-style: none; margin: 0; padding: 0 12px; }
  li { background: #fff; border-radius: 12px; margin: 0 0 8px; padding: 13px 14px;
    display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 0 rgba(0,0,0,.06); }
  li .box { width: 22px; height: 22px; border-radius: 6px; border: 2px solid #b9b1a3; flex: none; }
  li .qty { margin-left: auto; color: #7a7266; font-size: 14px; }
  li.new { outline: 2px solid #2f7d4f; }
  .tag { font-size: 11px; font-weight: 700; color: #2f7d4f; letter-spacing: .04em; }
  .sample { position: absolute; right: 14px; bottom: 12px; font: 700 11px/1 ui-monospace, Menlo, monospace;
    color: #b0443a; border: 1.5px solid #b0443a; border-radius: 4px; padding: 3px 5px; background: #fff8; }
  .toast { position: absolute; left: 16px; right: 16px; bottom: 44px; background: #1f1c17; color: #fff;
    border-radius: 12px; padding: 13px 16px; font-size: 14px; }
`;

const list = (items, extra = () => '') =>
  `<ul>${items.map(([name, qty], i) => `<li class="${extra(i)}"><span class="box"></span>${name}${extra(i) ? ' <span class="tag">NEW</span>' : ''}<span class="qty">${qty}</span></li>`).join('')}</ul>`;

const page = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body>
  <div class="status"><span>9:41</span><span>Offline</span></div>${body}
  <div class="sample">SAMPLE</div></body></html>`;

const SCREENS = {
  // Before: the offline banner floats over the list and hides its first two rows.
  'banner-before.png': page(`
    <header><h1>Pantry</h1><span class="count">${ITEMS.length} items</span></header>
    ${list(ITEMS)}
    <div class="banner overlay"><span class="dot"></span><span><b>You're offline.</b> Changes will sync when you're back online.</span></div>`),
  // After: the banner sits in the page above the list; every row shows.
  'banner-after.png': page(`
    <div class="banner"><span class="dot"></span><span><b>You're offline.</b> Changes sync later.</span></div>
    <header><h1>Pantry</h1><span class="count">${ITEMS.length} items</span></header>
    ${list(ITEMS)}`),
  // The import: the same file imported twice adds only the two new rows.
  'import-after.png': page(`
    <header><h1>Pantry</h1><span class="count">10 items</span></header>
    ${list([...ITEMS, ['Chickpeas', '2 tins'], ['Ginger', '1 piece']], (i) => (i >= ITEMS.length ? 'new' : ''))}
    <div class="toast">Imported <b>groceries.csv</b>: 2 added, 8 already on the list.</div>`),
};

// ------------------------------------------------------------------ Chrome over DevTools

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withChrome(fn) {
  const profile = mkdtempSync(join(tmpdir(), 'pharos-review-desk-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
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
    await fn(send);
    await send('Browser.close').catch(() => {});
    ws.close();
  } finally {
    await sleep(200);
    // Only the Chrome this script started, by its own PID.
    if (chrome.exitCode === null) process.kill(chrome.pid, 'SIGTERM');
    rmSync(profile, { recursive: true, force: true });
  }
}

async function shoot(send, html, file) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 2, mobile: true },
    sessionId,
  );
  await send('Page.enable', {}, sessionId);
  const { frameTree } = await send('Page.getFrameTree', {}, sessionId);
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(file, Buffer.from(data, 'base64'));
  await send('Target.closeTarget', { targetId });
}

// ------------------------------------------------------------------ the chime

const RATE = 11025;

/** Two soft bell notes (E5 then A5) with a quick attack and a long decay, as 16-bit samples. */
function chime() {
  const notes = [
    [659.25, 0],
    [880, 0.28],
  ];
  const length = Math.round(1.6 * RATE);
  const samples = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    let v = 0;
    for (const [f, start] of notes) {
      if (t < start) continue;
      const u = t - start;
      const env = Math.min(1, u / 0.006) * Math.exp(-u * 3.2);
      v += env * (Math.sin(2 * Math.PI * f * u) + 0.25 * Math.sin(2 * Math.PI * 2.01 * f * u));
    }
    const fade = Math.min(1, (length - i) / (0.05 * RATE));
    samples[i] = Math.round(Math.max(-1, Math.min(1, v * 0.35 * fade)) * 32767);
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ------------------------------------------------------------------ write them

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'reminder-chime.wav'), wav(chime()));
console.log('reminder-chime.wav: 1.6 s');
if (!existsSync(CHROME)) {
  console.error(`No Chrome at ${CHROME}: the screenshots were not made.`);
  process.exit(1);
}
await withChrome(async (send) => {
  for (const [name, html] of Object.entries(SCREENS)) {
    await shoot(send, html, join(out, name));
    console.log(`${name}: ${W}×${H} at 2x`);
  }
});
