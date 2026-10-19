#!/usr/bin/env node
// Report documents (R14) written by a real agent over MCP, on a throwaway server:
//
//   pnpm build
//   node eval/report-doc/run.mjs --agent claude|codex [--port 4394] [--out <dir>]
//        [--timeout <seconds>] [--model <model>]
//
// It starts the built server itself on --port (never 4300) with a new database in a temp folder
// and answering off, seeds a made-up fixture project (fixture.mjs: a community garden's season),
// then runs the agent CLI connected only to that server (per-run MCP config, as eval/compat does;
// no user config is touched) and asks it to write a report document about the project. Checks:
// a view with doc exists in the project, the doc is a valid ReportDoc, view_preview has no
// warnings, and it uses at least one live value and one chart or table. The agent's doc, the
// preview and the agent's output are saved in --out (default eval/results/report-doc/<agent>-<time>).
// The server is stopped by its PID at the end. Exit 0 when every check passes. The run uses the
// agent's own usage.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentCommand, agentVersion, mcpCall, runProcess } from '../compat/run.mjs';
import { FIXTURE, PROJECT_NAME, RECORD_COUNT } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const agent = value('--agent');
const port = Number(value('--port', '4394'));
const timeoutMs = Number(value('--timeout', '900')) * 1000;
const model = value('--model');
if (!['claude', 'codex'].includes(agent)) throw new Error('--agent is claude or codex');
if (!Number.isInteger(port) || port === 4300 || port < 1024)
  throw new Error('Pick a test port other than 4300, e.g. --port 4394');
const serverEntry = join(repo, 'apps', 'server', 'dist', 'index.js');
const schemaEntry = join(repo, 'packages', 'schema', 'dist', 'index.js');
if (!existsSync(serverEntry) || !existsSync(schemaEntry))
  throw new Error('Run pnpm build first (no apps/server/dist or packages/schema/dist)');
const { ReportDoc, docLeaves } = await import(pathToFileURL(schemaEntry).href);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(
  value('--out', join(repo, 'eval', 'results', 'report-doc', `${agent}-${stamp}`)),
);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'pharos-report-doc-'));
const base = `http://127.0.0.1:${port}`;
const OWNER = { 'content-type': 'application/json', 'x-pharos-author': 'human:me' };
const results = { agent, version: agentVersion(agent), model: model ?? null, port, work, out };
results.checks = {};
const log = (line) => console.log(`[report-doc] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(`${base}/api${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  return JSON.parse(text);
}

function check(name, ok, detail) {
  results.checks[name] = { ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) };
  log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`,
  );
}

/** Components that count as "a chart or a table". */
const CHARTS_AND_TABLES = new Set([
  'CountChart',
  'FindingChart',
  'CategoryBreakdown',
  'DataTable',
  'TaskTable',
  'DataList',
  'Timeline',
]);

/** One line per block, for the report: id, kind, component and what it is. */
function outline(doc) {
  const line = (b) =>
    b.kind === 'block'
      ? `${b.id}: ${b.node.component}${b.node.title ? ` "${b.node.title}"` : ''}${
          b.node.component === 'Text' || b.node.component === 'Markdown'
            ? ` — ${String(b.node.content ?? '')
                .split('\n')[0]
                .slice(0, 90)}`
            : ''
        }${b.node.values ? ` [values: ${Object.keys(b.node.values).join(', ')}]` : ''}`
      : b.kind === 'drawing'
        ? `${b.id}: drawing ${b.height}px, reads ${JSON.stringify(b.reads ?? [])}${b.caption ? ` "${b.caption}"` : ''}`
        : `${b.id}: embed ${b.url}`;
  return doc.blocks.map((b) =>
    b.kind === 'columns'
      ? `${b.id}: columns ${b.columns.length} [${b.columns.map((c) => c.map(line).join('; ')).join(' | ')}]`
      : line(b),
  );
}

// ------------------------------------------------------------------ the server
const env = {
  ...process.env,
  PORT: String(port),
  PHAROS_DB: join(work, 'pharos.db'),
  PHAROS_AGENT_LOG: join(work, 'agent.log'),
  PHAROS_AGENT_COMMAND: 'off',
};
delete env.PHAROS_SERVICE;
delete env.PHAROS_WEB_URL;
const server = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

  // ---------------------------------------------------------------- the fixture (made-up)
  const seeded = await api('/apply', {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify(FIXTURE),
  });
  const projectId = seeded.created.project;
  results.projectId = projectId;
  log(`seeded "${PROJECT_NAME}" (${projectId})`);

  // ---------------------------------------------------------------- the agent
  const prompt = [
    `You are connected to a Pharos server over MCP (the "pharos" tools). Its project "${PROJECT_NAME}" (id ${projectId}) holds made-up data about a community garden's season: harvests, expenses, tasks and stages.`,
    'Write a report for the garden committee about how the season went, as a Pharos report document: read report_guide first, look at the project with project_snapshot (and list records if you need them), then create one view named "Season report" with view_create and doc.',
    'Use live numbers from the data (Text values, Stat, charts or tables), not numbers typed in by hand. Check it with view_preview and fix every warning before you finish.',
    "Don't change the project's data, and don't make any other views. When done, reply in one sentence.",
  ].join('\n\n');
  const scratch = join(work, 'agent');
  mkdirSync(scratch, { recursive: true });
  const command = agentCommand(agent, { url: base, prompt, dir: scratch, model });
  log(`running ${agent} (${results.version ?? 'version unknown'})…`);
  const run = await runProcess(command, scratch, timeoutMs);
  results.run = {
    code: run.code,
    timedOut: run.timedOut,
    seconds: Math.round(run.seconds),
    final: command.finalMessage(run.stdout).slice(0, 2000),
  };
  writeFileSync(join(out, 'agent-stdout.txt'), run.stdout);
  writeFileSync(join(out, 'agent-stderr.txt'), run.stderr);
  check('agent finished', run.code === 0 && !run.timedOut, {
    code: run.code,
    timedOut: run.timedOut,
    seconds: Math.round(run.seconds),
  });

  // ---------------------------------------------------------------- the checks
  const views = await api(`/entities/view?projectId=${projectId}`);
  const docs = views.filter((v) => v.data.doc);
  results.views = views.map((v) => ({
    id: v.id,
    name: v.data.name,
    kind: v.data.doc ? 'doc' : v.data.page ? 'page' : 'board',
  }));
  check('a view with doc exists', docs.length >= 1, results.views);
  const view = docs.find((v) => v.data.name === 'Season report') ?? docs.at(-1);
  if (view) {
    const doc = view.data.doc;
    writeFileSync(join(out, `${agent}-doc.json`), JSON.stringify(doc, null, 2) + '\n');
    results.viewId = view.id;
    results.outline = outline(doc);
    const parsed = ReportDoc.safeParse(doc);
    check(
      'doc is a valid ReportDoc',
      parsed.success,
      parsed.success ? undefined : parsed.error.issues.slice(0, 5),
    );
    const preview = await mcpCall(base, 'view_preview', { viewId: view.id });
    writeFileSync(join(out, `${agent}-preview.json`), JSON.stringify(preview, null, 2) + '\n');
    const warnings = [
      ...(preview.warnings ?? []),
      ...(preview.findings ?? []).map((f) => `finding: ${f.path}: ${f.message}`),
    ];
    results.previewSummary = preview.summary;
    check('preview has 0 warnings', warnings.length === 0, warnings.slice(0, 10));
    const leaves = docLeaves(doc.blocks);
    const nodes = leaves.filter((b) => b.kind === 'block').map((b) => b.node);
    const liveValues = nodes.filter(
      (n) => n.component === 'Text' && n.values && Object.keys(n.values).length,
    );
    check('uses at least one live value', liveValues.length > 0, {
      texts: liveValues.length,
      values: liveValues.flatMap((n) => Object.keys(n.values)),
    });
    const charts = nodes.filter((n) => CHARTS_AND_TABLES.has(n.component));
    check(
      'has a chart or table',
      charts.length > 0,
      charts.map((n) => n.component),
    );
    results.stats = {
      blocks: leaves.length,
      components: [...new Set(nodes.map((n) => n.component))],
      drawings: leaves.filter((b) => b.kind === 'drawing').length,
      embeds: leaves.filter((b) => b.kind === 'embed').length,
      columns: doc.blocks.filter((b) => b.kind === 'columns').length,
      summary: doc.summary ?? null,
      evidenceRevision: view.data.evidenceRevision ?? null,
    };
    for (const line of results.outline) log(`  ${line}`);
  }
  const project = await api(`/entities/project/${projectId}`);
  const records = await api(`/entities/record?projectId=${projectId}`);
  check('project data unchanged', records.length === RECORD_COUNT && !!project, {
    records: records.length,
  });
  exitCode = Object.values(results.checks).every((c) => c.ok) ? 0 : 1;
} catch (error) {
  results.error = String(error?.stack ?? error);
  log(`error: ${error.message}`);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  stop();
  log(`results in ${out}`);
}
process.exit(exitCode);
