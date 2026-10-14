#!/usr/bin/env node
// Agent compatibility runner (eval/compat): runs the five scenarios in scenarios.mjs with a real
// agent CLI connected only to one isolated Pharos server, and checks the end state over REST.
//
//   node eval/compat/run.mjs --agent claude|codex|opencode --url http://127.0.0.1:<port>
//        [--only setup,mark-done] [--out <dir>] [--timeout <seconds>] [--model <model>]
//
// Start the server yourself first, on its own port and database, with answering off:
//   PORT=4391 PHAROS_DB=/tmp/compat.db PHAROS_AGENT_COMMAND=off \
//     PHAROS_AGENT_LOG=/tmp/compat-agent.log pnpm --filter @pharos/server dev
// The runner starts no server and refuses port 4300 (your own Pharos) and non-local hosts. Each
// scenario is one agent run and uses that agent's usage. Results: a table on stdout and a JSON
// file in --out (default eval/results/compat).

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check } from './checks.mjs';
import { SCENARIOS } from './scenarios.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Entity types, as in packages/schema/src/entities.ts (a test keeps them in step). */
export const ENTITY_TYPES = [
  'section',
  'repository',
  'assignee',
  'project',
  'goal',
  'scope_item',
  'stage',
  'task',
  'artifact',
  'decision',
  'view',
  'request',
  'claim',
  'term',
  'file',
  'record',
];

export const AGENTS = ['claude', 'codex', 'opencode'];
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The server's base URL, or throws: only a local server on a port other than 4300. */
export function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:') throw new Error('Use an http:// URL of a local test server');
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(`Refusing ${url.hostname}: the runner only talks to a server on this machine`);
  if (!url.port) throw new Error('Give the test server’s port, e.g. http://127.0.0.1:4391');
  if (url.port === '4300')
    throw new Error(
      'Refusing port 4300: that is your own Pharos. Start an isolated server on another port',
    );
  return `${url.protocol}//${url.host}`;
}

export function parseArgs(argv) {
  const options = { only: undefined, timeout: 600, out: undefined, model: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--agent') options.agent = value();
    else if (arg === '--url') options.url = value();
    else if (arg === '--only') options.only = value().split(',');
    else if (arg === '--out') options.out = value();
    else if (arg === '--timeout') options.timeout = Number(value());
    else if (arg === '--model') options.model = value();
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!AGENTS.includes(options.agent))
    throw new Error(`--agent must be one of ${AGENTS.join(', ')}`);
  if (!options.url) throw new Error('--url is required (an isolated test server)');
  options.url = checkUrl(options.url);
  if (!Number.isFinite(options.timeout) || options.timeout <= 0)
    throw new Error('--timeout must be a positive number of seconds');
  const known = SCENARIOS.map((s) => s.id);
  for (const id of options.only ?? [])
    if (!known.includes(id)) throw new Error(`Unknown scenario ${id} (${known.join(', ')})`);
  return options;
}

// ---------------------------------------------------------------- REST

export function restClient(base) {
  const request = async (path, init = {}) => {
    const response = await fetch(`${base}/api${path}`, init);
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  return {
    get: (path) => request(path),
    /** Applies the scenario's seed as a person (not an agent), before the agent starts. */
    apply: (input) =>
      request('/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:compat-setup' },
        body: JSON.stringify(input),
      }),
    /** Folder requests are the owner's list, read as the Pharos page reads it. */
    folderRequests: () =>
      request('/settings/folder-requests', { headers: { 'sec-fetch-site': 'same-origin' } }),
  };
}

export async function allEntities(api) {
  const lists = await Promise.all(ENTITY_TYPES.map((type) => api.get(`/entities/${type}`)));
  return lists.flat();
}

async function latestRevision(api) {
  return (await api.get('/settings')).revisions;
}

/** Revisions after `start`, oldest first. */
export async function revisionsAfter(api, start) {
  const found = [];
  let before;
  for (;;) {
    const page = await api.get(
      `/history?after=${start}&limit=200${before ? `&before=${before}` : ''}`,
    );
    found.push(...page);
    if (page.length < 200) break;
    before = page[page.length - 1].id;
  }
  return found.sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------- MCP (for view_preview only)

/** Calls one read-only MCP tool on the test server over streamable HTTP. */
export async function mcpCall(base, name, args) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const post = async (body, session) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: session ? { ...headers, 'mcp-session-id': session } : headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`MCP ${body.method}: ${response.status} ${text}`);
    const messages = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5)))
      : text
        ? [JSON.parse(text)]
        : [];
    return { session: response.headers.get('mcp-session-id'), messages };
  };
  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'pharos-compat-check', version: '1' },
    },
  });
  const session = init.session;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const { messages } = await post(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    session,
  );
  await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': session } }).catch(
    () => {},
  );
  const reply = messages.find((m) => m.id === 2);
  const text = reply?.result?.content?.[0]?.text ?? '';
  if (!reply || reply.error || reply.result?.isError)
    throw new Error(`MCP ${name}: ${reply?.error?.message ?? text}`);
  return JSON.parse(text);
}

// ---------------------------------------------------------------- agents

/**
 * The command for one agent run, connected only to the test server. Per-run flags and overrides
 * only: no user config is ever edited.
 */
export function agentCommand(agent, { url, prompt, dir, model }) {
  if (agent === 'claude') {
    const config = join(dir, 'mcp.json');
    writeFileSync(
      config,
      JSON.stringify({ mcpServers: { pharos: { type: 'http', url: `${url}/mcp` } } }),
    );
    return {
      command: 'claude',
      args: [
        '-p',
        prompt,
        '--mcp-config',
        config,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__pharos__*',
        // No built-in tools (shell, files, web): only the Pharos server.
        '--tools',
        '',
        '--output-format',
        'json',
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
      ],
      finalMessage: (stdout) => {
        try {
          return JSON.parse(stdout).result ?? '';
        } catch {
          return stdout.trim();
        }
      },
    };
  }
  if (agent === 'codex') {
    const last = join(dir, 'last-message.txt');
    return {
      command: 'codex',
      args: [
        'exec',
        '--skip-git-repo-check',
        // Not the user's config.toml (other MCP servers, profiles): only the overrides below.
        '--ignore-user-config',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--cd',
        dir,
        '--color',
        'never',
        '-c',
        `mcp_servers.pharos.url="${url}/mcp"`,
        // Codex asks before an MCP tool call; exec can't ask, so approve this test server's tools.
        '-c',
        'mcp_servers.pharos.default_tools_approval_mode="approve"',
        '-o',
        last,
        ...(model ? ['--model', model] : []),
        prompt,
      ],
      finalMessage: () => {
        try {
          return readFileSync(last, 'utf8');
        } catch {
          return '';
        }
      },
    };
  }
  // TODO(OpenCode): add `opencode run` here once its MCP config can be passed per run (connected
  // only to the test server) and its tool permissions can be granted non-interactively.
  return undefined;
}

export function agentVersion(agent) {
  const result = spawnSync(agent, ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Runs one agent process in its own group and directory; kills the group on timeout. */
function runProcess({ command, args }, dir, timeoutMs) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: dir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already gone. */
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already gone. */
        }
      }, 2000).unref();
    }, timeoutMs);
    const done = (code, error) => {
      clearTimeout(timer);
      resolveRun({
        code,
        timedOut,
        error,
        stdout,
        stderr,
        seconds: (Date.now() - started) / 1000,
      });
    };
    child.on('error', (error) => done(null, error.message));
    child.on('close', (code) => done(code));
  });
}

// ---------------------------------------------------------------- one scenario

/** Seeds a scenario (as a person) and returns its context. */
export async function prepare(api, scenario, { tag, scratch }) {
  const ctx = { tag, ids: {} };
  if (scenario.needsFolder) {
    const path = join(scratch, `${scenario.id}-${tag}`, 'Made-up company papers');
    mkdirSync(path, { recursive: true });
    ctx.folderPath = realpathSync(path);
  }
  if (scenario.seed) ctx.ids = (await api.apply(scenario.seed(ctx))).created;
  return ctx;
}

/** What the agent left: entities, revisions since `start`, folder requests, view previews. */
export async function collect(api, base, scenario, ctx, before, start, finalMessage = '') {
  const state = {
    before,
    after: await allEntities(api),
    revisions: await revisionsAfter(api, start),
    folderRequests: await api.folderRequests(),
    previews: {},
    finalMessage,
  };
  for (const viewId of scenario.previewIds?.(state, ctx) ?? []) {
    try {
      state.previews[viewId] = await mcpCall(base, 'view_preview', { viewId });
    } catch (error) {
      state.previews[viewId] = { error: error.message, warnings: [error.message] };
    }
  }
  return state;
}

async function runScenario(options, api, scenario, run) {
  const dir = mkdtempSync(join(run.scratch, `${scenario.id}-`));
  const ctx = await prepare(api, scenario, run);
  const before = await allEntities(api);
  const start = await latestRevision(api);
  const prompt = scenario.prompt(ctx);
  const command = agentCommand(options.agent, {
    url: options.url,
    prompt,
    dir,
    model: options.model,
  });
  const result = await runProcess(command, dir, options.timeout * 1000);
  writeFileSync(join(run.output, `${scenario.id}.stdout.txt`), result.stdout);
  writeFileSync(join(run.output, `${scenario.id}.stderr.txt`), result.stderr);
  const finalMessage = command.finalMessage(result.stdout);
  const state = await collect(api, options.url, scenario, ctx, before, start, finalMessage);
  const checks = [
    check(
      'agent-exited',
      result.code === 0 && !result.timedOut,
      result.timedOut ? 'timed out' : (result.error ?? `exit ${result.code}`),
    ),
    ...scenario.check(state, ctx),
  ];
  writeFileSync(
    join(run.output, `${scenario.id}.state.json`),
    JSON.stringify({ ctx, prompt, state }, null, 2),
  );
  return {
    scenario: scenario.id,
    title: scenario.title,
    pass: checks.every((c) => c.pass),
    seconds: Math.round(result.seconds),
    checks,
    notes: checks
      .filter((c) => !c.pass)
      .map((c) => `${c.id}${c.note ? `: ${c.note}` : ''}`)
      .join('; '),
    finalMessage: finalMessage.trim().slice(0, 500),
  };
}

export function table(rows) {
  const lines = [
    '| Scenario | Result | Seconds | Notes |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.scenario} | ${r.pass ? 'pass' : 'FAIL'} | ${r.seconds ?? ''} | ${(r.notes || '').replaceAll('|', '/').slice(0, 300)} |`,
    ),
  ];
  return lines.join('\n');
}

export async function main(argv) {
  const options = parseArgs(argv);
  const version = options.agent === 'opencode' ? null : agentVersion(options.agent);
  if (!agentCommand(options.agent, { url: options.url, prompt: '', dir: tmpdir() })) {
    console.log(`${options.agent}: not supported yet (see the TODO in eval/compat/run.mjs).`);
    return 2;
  }
  if (!version) throw new Error(`${options.agent} is not installed (or --version failed)`);
  const api = restClient(options.url);
  const health = await api.get('/health');
  if (health.name !== 'pharos') throw new Error(`${options.url} is not a Pharos server`);
  const answering = await api.get('/agent');
  if (answering.configured && answering.enabled)
    throw new Error(
      'The test server answers questions itself; start it with PHAROS_AGENT_COMMAND=off',
    );
  const tag = randomBytes(3).toString('hex');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = resolve(
    options.out ?? join(here, '../results/compat'),
    `${options.agent}-${stamp}`,
  );
  mkdirSync(output, { recursive: true });
  const run = { tag, output, scratch: mkdtempSync(join(tmpdir(), 'pharos-compat-')) };
  const rows = [];
  for (const scenario of SCENARIOS.filter((s) => !options.only || options.only.includes(s.id))) {
    console.error(`[compat] ${options.agent}: ${scenario.id} …`);
    try {
      rows.push(await runScenario(options, api, scenario, run));
    } catch (error) {
      rows.push({
        scenario: scenario.id,
        title: scenario.title,
        pass: false,
        seconds: null,
        checks: [],
        notes: `runner error: ${error.message}`,
      });
    }
    console.error(`[compat] ${scenario.id}: ${rows.at(-1).pass ? 'pass' : 'FAIL'}`);
  }
  const report = {
    agent: options.agent,
    version,
    model: options.model ?? null,
    date: new Date().toISOString(),
    url: options.url,
    tag,
    passed: rows.filter((r) => r.pass).length,
    total: rows.length,
    results: rows,
  };
  writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${options.agent} ${version} — ${report.passed}/${report.total} passed\n`);
  console.log(table(rows));
  console.log(`\nResults: ${join(output, 'results.json')}`);
  return report.passed === report.total ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`[compat] ${error.message}`);
      process.exitCode = 2;
    },
  );
}
