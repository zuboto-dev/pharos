#!/usr/bin/env node
// Phone check (v0.2 B9): opens pages of a running local Pharos in headless Chrome as a 390 px wide
// touch phone and reports what doesn't work there:
//  - page-level horizontal scroll (the document is wider than the screen), with the elements that
//    stick out (ones inside a block that scrolls on its own are fine);
//  - tap targets under 44 × 44 px (buttons, links that aren't inline text, inputs, selects);
//  - text smaller than 11 px.
// It exits 1 when it finds any, so it can run in a release check:
//
//   node scripts/phone-check.mjs --url http://127.0.0.1:4398 /projects/<id>/views/<id> /settings …
//
// Options: --width 390 · --port 9361 (Chrome's debugging port) · --json (machine-readable report)
// · --dark · --chrome <path>. Local addresses only: it never opens anything else.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const base = (option('--url', '') ?? '').replace(/\/$/, '');
const width = Number(option('--width', '390'));
const port = Number(option('--port', '9361'));
const chromePath = option(
  '--chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
);
const json = flag('--json');
const dark = flag('--dark');
const paths = args.length ? args : ['/'];
if (!base) {
  console.error('Usage: node scripts/phone-check.mjs --url http://127.0.0.1:<port> [paths…]');
  process.exit(64);
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  console.error(`Refusing ${base}: the phone check only opens a local Pharos.`);
  process.exit(64);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'pharos-phone-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const stop = async () => {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A temporary profile left behind is harmless.
  }
};

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    // Chrome is still starting.
  }
}
if (!target) {
  await stop();
  console.error('Chrome did not start.');
  process.exit(70);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let next = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++next;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', {
  features: [
    { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
    { name: 'pointer', value: 'coarse' },
    { name: 'hover', value: 'none' },
  ],
});

// Runs in the page: everything that doesn't work on a phone.
const AUDIT = String.raw`(() => {
  const vw = document.documentElement.clientWidth;
  const describe = (el) => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 4).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (label ? ' "' + label + '"' : '');
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Inside a box that scrolls sideways on its own, or clips: sticking out there is fine.
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) return true;
    }
    return false;
  };
  const overflow = document.documentElement.scrollWidth - vw;
  const wide = [];
  if (overflow > 0)
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && visible(el) && !contained(el)) wide.push(describe(el) + ' (' + Math.round(r.left) + '–' + Math.round(r.right) + ')');
      if (wide.length >= 12) break;
    }
  const small = [];
  const interactive = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [role=option]';
  for (const el of document.querySelectorAll(interactive)) {
    if (!visible(el) || el.closest('[aria-hidden=true], [inert]')) continue;
    const s = getComputedStyle(el);
    // A link inside a line of text is exempt (WCAG 2.5.8): its line is the target. So is a
    // reference marked as inline (data-inline-target), e.g. an item named in a sentence.
    if (el.tagName === 'A' && s.display === 'inline') continue;
    if (el.closest('[data-inline-target]')) continue;
    const r = el.getBoundingClientRect();
    // Off the screen (a closed sidebar, a scrolled-away strip item): nothing to tap.
    if (r.right <= 0 || r.left >= vw) continue;
    // A small control can reach further than it is drawn: an invisible ::after hit area (.tap-area).
    const after = getComputedStyle(el, '::after');
    const hitW = after.content !== 'none' && after.position === 'absolute' ? Math.max(r.width, parseFloat(after.width) || 0) : r.width;
    const hitH = after.content !== 'none' && after.position === 'absolute' ? Math.max(r.height, parseFloat(after.height) || 0) : r.height;
    if (hitW < 43.5 || hitH < 43.5) small.push(describe(el) + ' ' + Math.round(hitW) + '×' + Math.round(hitH));
  }
  const tiny = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || !visible(el) || el.closest('svg, .sr-only, [aria-hidden=true]')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11) tiny.push(describe(el) + ' ' + size + 'px');
    if (tiny.length >= 12) break;
  }
  return { overflow, wide, small, tiny };
})()`;

const report = [];
for (const path of paths) {
  await send('Page.navigate', { url: `${base}${path}` });
  await sleep(2500);
  const result = await evaluate(AUDIT);
  report.push({ path, ...result });
}
ws.close();
await stop();

let failed = false;
if (json) console.log(JSON.stringify(report, null, 2));
for (const page of report) {
  const problems = page.overflow > 0 || page.small.length > 0 || page.tiny.length > 0;
  failed ||= problems;
  if (json) continue;
  console.log(`${problems ? '✗' : '✓'} ${page.path} at ${width} px`);
  if (page.overflow > 0) {
    console.log(`  The page scrolls sideways by ${page.overflow} px. Sticking out:`);
    for (const w of page.wide) console.log(`    ${w}`);
  }
  if (page.small.length) {
    console.log(`  ${page.small.length} tap targets under 44 px:`);
    for (const s of page.small.slice(0, 20)) console.log(`    ${s}`);
  }
  if (page.tiny.length) {
    console.log(`  Text under 11 px:`);
    for (const t of page.tiny) console.log(`    ${t}`);
  }
}
process.exit(failed ? 1 : 0);
