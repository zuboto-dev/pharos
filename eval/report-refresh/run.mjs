#!/usr/bin/env node
// The report-page refresh loop, end to end on a throwaway server (R13 + R11):
//
//   pnpm build   # the built server also serves the web app, for the screenshots
//   node eval/report-refresh/run.mjs [--agent stub|claude] [--port 4392] [--shots <dir>]
//        [--timeout <seconds>] [--out <file.json>]
//
// It starts the built server itself on --port (never 4300) with a new database and agent log in a
// temp folder, answering with the stub (stub-agent.mjs) or with Claude Code (`claude`, the
// default PHAROS_AGENT_COMMAND; that run uses its usage). Then: installs the "Spending story"
// sample (made-up data), changes one record the page reads (as the owner), checks the page is
// out of date, asks to refresh it (the request the web app's "Ask to refresh" makes), waits for
// the run, and checks that the page has one more version, a newer evidenceRevision, the request
// answered and freshness fresh. With --shots, headless Chrome saves the page before (stale) and
// after (refreshed). The server is stopped by its PID at the end. Exit 0 when every check passes.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenshot } from './shot.mjs';
import { SAMPLES_PROJECT, connect, guarded, sleep } from '../../samples/install/lib.mjs';
import * as r13 from '../../samples/install/steps/r13-report-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const agentKind = value('--agent', 'stub');
const port = Number(value('--port', '4392'));
const shots = value('--shots');
const timeoutMs = Number(value('--timeout', agentKind === 'stub' ? '60' : '900')) * 1000;
if (!['stub', 'claude'].includes(agentKind)) throw new Error('--agent is stub or claude');
if (!Number.isInteger(port) || port === 4300 || port < 1024)
  throw new Error('Pick a test port other than 4300, e.g. --port 4392');
const serverEntry = join(repo, 'apps', 'server', 'dist', 'index.js');
if (!existsSync(serverEntry)) throw new Error('Run pnpm build first (no apps/server/dist)');

const work = mkdtempSync(join(tmpdir(), 'pharos-refresh-'));
const base = `http://127.0.0.1:${port}`;
const OWNER = { 'content-type': 'application/json', 'x-pharos-author': 'human:me' };
const results = { agent: agentKind, port, work, checks: {} };
const log = (line) => console.log(`[refresh] ${line}`);

async function api(path, init) {
  const res = await fetch(`${base}/api${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  return JSON.parse(text);
}
const apply = (body) =>
  api('/apply', { method: 'POST', headers: OWNER, body: JSON.stringify(body) });

function check(name, ok, detail) {
  results.checks[name] = { ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) };
  log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`,
  );
}

/** Saves a screenshot of the page once the frame has loaded; a failure is logged, not fatal. */
async function shot(url, file, ready) {
  try {
    await screenshot({ url, file, profile: join(work, 'chrome'), ready });
    log(`screenshot ${file}`);
  } catch (error) {
    log(`screenshot failed: ${error.message}`);
  }
}
const FRAME_SHOWN = `document.querySelector('[data-report-bar]') && document.querySelector('iframe')?.style.opacity === '1' && /Updated .* by /.test(document.querySelector('[data-report-bar]').textContent)`;

// ------------------------------------------------------------------ the server
const env = {
  ...process.env,
  PORT: String(port),
  PHAROS_DB: join(work, 'pharos.db'),
  PHAROS_AGENT_LOG: join(work, 'agent.log'),
};
delete env.PHAROS_AGENT_COMMAND;
delete env.PHAROS_SERVICE;
delete env.PHAROS_WEB_URL;
if (agentKind === 'stub') env.PHAROS_AGENT_COMMAND = `node "${join(here, 'stub-agent.mjs')}"`;
const server = spawn(process.execPath, [serverEntry], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(join(work, 'server.pid'), String(server.pid));
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(d.toString()));
server.stderr.on('data', (d) => serverLog.push(d.toString()));
const stop = () => {
  if (server.exitCode === null) process.kill(server.pid, 'SIGTERM');
};
process.on('exit', stop);
log(`server PID ${server.pid} on ${base}, data in ${work}`);

let exitCode = 1;
try {
  for (let i = 0; ; i++) {
    try {
      await api('/health');
      break;
    } catch (error) {
      if (i > 100 || server.exitCode !== null)
        throw new Error(`server didn't start: ${error.message}\n${serverLog.join('')}`, {
          cause: error,
        });
      await sleep(100);
    }
  }
  const agentStatus = await api('/agent');
  check('answering agent set up', agentStatus.state === 'idle', {
    mode: agentStatus.mode,
    command: agentStatus.command,
  });

  // ---------------------------------------------------------------- the sample (made-up data)
  const raw = await connect(base, 'Opus 5.5');
  const scope = { ids: new Set(), names: new Set([SAMPLES_PROJECT]) };
  const call = guarded(raw, scope);
  const made = await call('apply', {
    message: 'Create a project for Pharos samples (report refresh check)',
    operations: [
      {
        op: 'create',
        type: 'project',
        ref: 'p',
        data: { name: SAMPLES_PROJECT, summary: 'Made-up data that shows Pharos features.' },
      },
    ],
  });
  const projectId = made.created.p;
  scope.ids.add(projectId);
  const [row] = await r13.run({
    call,
    samples: { id: projectId, name: SAMPLES_PROJECT },
    log: (line) => log(`sample: ${line}`),
  });
  const viewId = row.viewId;
  const viewPath = `/projects/${projectId}/views/${viewId}`;
  results.projectId = projectId;
  results.viewId = viewId;
  const view0 = await api(`/entities/view/${viewId}`);
  const versions = async () =>
    (await api(`/history?entityId=${viewId}&limit=500`)).filter((r) =>
      r.changes.some((c) => c.id === viewId),
    ).length;
  const n = await versions();
  log(
    `"Spending story" ${viewId}: evidenceRevision ${view0.data.evidenceRevision}, ${n} version(s)`,
  );

  // ---------------------------------------------------------------- a change it reads
  const records = await api(
    `/entities/record?projectId=${projectId}&recordType=household_spending`,
  );
  const last = records
    .filter((r) => r.data.fields.category === 'Groceries')
    .sort((a, b) => a.data.fields.date.localeCompare(b.data.fields.date))
    .at(-1);
  const amount = last.data.fields.amount.amount + 12000;
  await apply({
    message: 'A bigger grocery shop than first entered (made-up)',
    operations: [
      {
        op: 'update',
        type: 'record',
        id: last.id,
        data: { fields: { ...last.data.fields, amount: { amount, currency: 'EUR' } } },
      },
    ],
  });
  const evidenceOf = async () =>
    (await api(`/projects/${projectId}/freshness?view=${viewId}`)).views[viewId]?.evidence;
  const stale = await evidenceOf();
  check('stale after the change', stale && 'stale' in stale && stale.stale?.total >= 1, {
    record: last.data.title,
    amount,
    revision: stale?.revision,
  });
  if (shots)
    await shot(
      `${base}${viewPath}`,
      join(shots, `${agentKind}-before-stale.png`),
      `${FRAME_SHOWN} && document.querySelector('[data-evidence="stale"]')`,
    );

  // ---------------------------------------------------------------- ask to refresh, wait
  // The same request as the web app's "Ask to refresh" (refreshRequest in pages/freshness.tsx).
  const asked = await apply({
    message: 'Refresh “Spending story”: its data changed since it was written',
    operations: [
      {
        op: 'create',
        type: 'request',
        ref: 'q',
        data: {
          projectId,
          question: view0.data.description ?? 'Refresh “Spending story”',
          about: 'Report page “Spending story”',
          viewId,
          mode: 'refresh',
        },
      },
    ],
  });
  const requestId = asked.created.q;
  results.requestId = requestId;
  const started = Date.now();
  log(`asked to refresh: request ${requestId}; waiting for the ${agentKind} run`);
  let status;
  for (;;) {
    status = await api('/agent');
    if (status.lastRun?.requestIds.includes(requestId) && status.state !== 'running') break;
    if (Date.now() - started > timeoutMs)
      throw new Error(`no finished run in ${timeoutMs / 1000}s`);
    await sleep(1000);
  }
  results.run = { ...status.lastRun, waitedMs: Date.now() - started };
  check('run finished', status.lastRun.outcome === 'finished', {
    outcome: status.lastRun.outcome,
    durationMs: status.lastRun.durationMs,
  });

  // ---------------------------------------------------------------- after
  const view1 = await api(`/entities/view/${viewId}`);
  const request = await api(`/entities/request/${requestId}`);
  const m = await versions();
  const fresh = await evidenceOf();
  check('page version n → n+1', m === n + 1, { before: n, after: m });
  check('still a report page with the same reads', view1.data.page && !view1.data.spec, {
    reads: Object.keys(view1.data.page?.data ?? {}),
    same: JSON.stringify(view1.data.page?.data) === JSON.stringify(view0.data.page.data),
  });
  check(
    'evidenceRevision moved past the change',
    view1.data.evidenceRevision > view0.data.evidenceRevision,
    { before: view0.data.evidenceRevision, after: view1.data.evidenceRevision },
  );
  check('freshness says fresh', fresh && 'stale' in fresh && !fresh.stale, {
    revision: fresh?.revision,
  });
  check('request answered', request.data.status === 'answered', { reply: request.data.reply });
  const assets = await api(`/views/${viewId}/assets`);
  check(
    'assets kept',
    assets.some((a) => a.path === 'img/receipt-edge.svg'),
    assets.map((a) => a.path),
  );
  results.summary = { before: view0.data.page.summary, after: view1.data.page?.summary };
  results.htmlChars = { before: view0.data.page.html.length, after: view1.data.page?.html.length };
  log(`summary now: ${view1.data.page?.summary}`);
  if (shots)
    await shot(
      `${base}${viewPath}`,
      join(shots, `${agentKind}-after-refreshed.png`),
      `${FRAME_SHOWN} && !document.querySelector('[data-evidence="stale"]')`,
    );
  exitCode = Object.values(results.checks).every((c) => c.ok) ? 0 : 1;
} catch (error) {
  results.error = String(error.stack ?? error);
  log(`error: ${results.error}`);
  log(`server exit ${server.exitCode}; its output:\n${serverLog.join('').slice(-3000)}`);
} finally {
  stop();
  const out = value('--out', join(work, 'result.json'));
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  log(
    `result ${exitCode === 0 ? 'PASS' : 'FAIL'}; written to ${out}; agent log ${env.PHAROS_AGENT_LOG}`,
  );
}
process.exit(exitCode);
