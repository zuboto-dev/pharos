import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadFixture } from '../fixtures/load.js';
import { readCase } from './case.js';
import { extractMetrics } from './metrics.js';
import { openDatabase } from '../../apps/server/src/store/database.js';
import { Store } from '../../apps/server/src/store/store.js';
import { catalogList, catalogDescribe } from '../../apps/server/src/views/catalog.js';
import {
  runQuery,
  toBoard,
  TEMPLATES,
  type ProjectDataset,
  type Entity,
  type Filter,
} from '../../packages/schema/src/index.js';
import type { AgentStatus } from '../../apps/server/src/agent-runner.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const serverDirectory = join(repository, 'apps/server');
export const canonical = (value: unknown): string =>
  JSON.stringify(value, function (_key, item: unknown) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item;
  });
const hash = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const scriptCommand = (name: string) =>
  `${quote(process.execPath)} --import ${quote(join(serverDirectory, 'node_modules/tsx/dist/loader.mjs'))} --conditions=development ${quote(join(repository, 'eval/harness', name))}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Options = {
  casePath: string;
  output?: string;
  scratch?: string;
  dryRun?: boolean;
  mock?: string;
  agentCommand?: string;
  timeoutMs?: number;
  repetition?: number;
};
type Classification =
  | 'success'
  | 'answering_off'
  | 'query_error'
  | 'wrong_facts'
  | 'timeout'
  | 'agent_refusal'
  | 'harness_error';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port === 4300 ? freePort() : port;
}

async function stop(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  // Kill the process group, including the shell, invocation wrapper and agent descendants.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Already exited. */
  }
  await pause(100);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* Already exited. */
  }
  if (child.exitCode === null && child.signalCode === null)
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

export async function run(options: Options) {
  const runId = randomUUID();
  const output = resolve(options.output ?? join(repository, 'eval/results'), runId);
  mkdirSync(output, { recursive: true });
  const save = (name: string, value: unknown) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
  const events: unknown[] = [];
  const origin = performance.now();
  const event = (kind: string, payload: unknown) =>
    events.push({
      kind,
      monotonic_ms: performance.now() - origin,
      utc: new Date().toISOString(),
      source: 'harness',
      payload,
    });
  let child: ChildProcess | undefined;
  let db: ReturnType<typeof openDatabase> | undefined;
  let temporary: string | undefined;
  let classification: Classification = 'harness_error';
  let error: string | undefined;
  let start: number | undefined;
  let end: number | undefined;
  let viewExistsMs: number | null = null;
  let censoredAtMs: number | null = null;
  let startRevision = 0;
  let endRevision = 0;
  let log = '';
  let agentStatus: AgentStatus | undefined;
  let versionSet: Record<string, unknown> = {
    git_commit: null,
    model_id: null,
    prompt_hash: null,
    catalog_version: null,
    fixture_checksum: null,
    procedure_hash: null,
    case_hash: null,
    checks_hash: null,
    runtime: process.version,
    attribution_complete: false,
    comparison_eligible: false,
  };
  let checks: Array<{ id: string; pass: boolean; [key: string]: unknown }> = [];
  let serverLog = '';
  let answer: Entity<'view'> | undefined;
  let finalRequest: Entity<'request'> | undefined;
  let candidateCount = 0;
  let lastCandidateRevision: number | undefined;
  let firstCandidate: { view: Entity<'view'>; data: ProjectDataset } | undefined;
  const interrupted = () => {
    void stop(child).finally(() => {
      db?.close();
      if (temporary) rmSync(temporary, { recursive: true, force: true });
      process.exit(130);
    });
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const dry = options.dryRun === true;
  try {
    console.error('Harness: preparing isolated fixture (1/4)');
    if ([dry, Boolean(options.mock), Boolean(options.agentCommand)].filter(Boolean).length !== 1)
      throw new Error('Choose exactly one of --dry-run, --mock, or --agent-command');
    if (
      options.mock &&
      !['success', 'wrong_facts', 'query_error', 'agent_refusal', 'timeout'].includes(options.mock)
    )
      throw new Error('Unknown mock scenario');
    const testCase = readCase(resolve(options.casePath));
    if (
      testCase.useful.renderCapture.mode !== 'persisted-rest' ||
      testCase.script.correctionPolicy.maxAttempts !== 0 ||
      testCase.script.normalWaitMs < 1
    )
      throw new Error(
        'This runner supports persisted-rest cases without scripted corrections and with a positive polling interval',
      );
    const timeoutMs = options.timeoutMs ?? testCase.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Timeout must be positive');
    save('case.json', testCase);
    const fixturePath = resolve(repository, testCase.fixture.path);
    save('fixture.json', JSON.parse(readFileSync(fixturePath, 'utf8')));
    mkdirSync(options.scratch ?? tmpdir(), { recursive: true });
    temporary = mkdtempSync(join(options.scratch ?? tmpdir(), 'pharos-harness-'));
    const database = join(temporary, 'pharos.db');
    const loaded = loadFixture(fixturePath, database);
    if (loaded.today !== testCase.fixture.semanticDate)
      throw new Error('Case and fixture semantic dates differ');
    for (const check of testCase.fact_checks)
      for (const ref of check.expectedRefs)
        if (!loaded.refs[ref]) throw new Error(`Unknown oracle ref: ${ref}`);
    if (loaded.checksum !== testCase.fixture.checksum.replace(/^sha256:/, ''))
      throw new Error('Case fixture checksum mismatch');
    save('id-map.json', loaded.refs);
    writeFileSync(join(temporary, 'refs.json'), JSON.stringify(loaded.refs));
    db = openDatabase(database);
    const store = new Store(db);
    // Fixture controls include an open question. Dismiss it before starting the timed case,
    // otherwise AgentRunner would batch it with the evaluated request.
    const open = store.list('request').filter((request) => request.data.status === 'open');
    if (open.length)
      store.apply(
        { kind: 'system', name: 'evaluation-setup' },
        {
          message: 'Isolate one evaluation request',
          operations: open.map((request) => ({
            op: 'update',
            type: 'request',
            id: request.id,
            data: { status: 'dismissed' },
          })),
        },
      );
    const logicalRows = (sql: string, jsonFields: string[]) =>
      db!
        .prepare(sql)
        .all()
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              jsonFields.includes(key) && typeof value === 'string'
                ? (JSON.parse(value) as unknown)
                : value,
            ]),
          ),
        );
    const snapshot = () => ({
      semanticDate: testCase.fixture.semanticDate,
      timezone: testCase.fixture.timezone,
      entities: logicalRows('SELECT * FROM entities ORDER BY id', ['data']),
      revisions: db!.prepare('SELECT * FROM revisions ORDER BY id').all(),
      changes: logicalRows('SELECT * FROM changes ORDER BY revision_id, seq', ['before', 'after']),
      settings: logicalRows('SELECT * FROM settings ORDER BY key', ['value']),
      agent_cursors: db!.prepare('SELECT * FROM agent_cursors ORDER BY agent, project_id').all(),
    });
    const initial = snapshot();
    save('start-snapshot.json', initial);
    startRevision = store.latestRevisionId();
    const catalog = {
      list: catalogList(),
      descriptions: catalogDescribe(
        catalogList()
          .components.map((c) => c.name)
          .sort(),
      ),
      templates: TEMPLATES,
    };
    save('catalog.json', catalog);
    writeFileSync(
      join(output, 'procedure.md'),
      readFileSync(join(repository, 'docs/evidence/G1/W1.5-metrics.md')),
    );
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
      if (result.status !== 0) throw new Error('Could not capture git version');
      return result.stdout.trim();
    };
    const dirtyFiles = git(['ls-files', '--modified', '--others', '--exclude-standard'])
      .split('\n')
      // Nested repositories (e.g. agent worktrees) are listed as directories ending in "/".
      .filter((path) => path && !path.endsWith('/'));
    const dirty = Object.fromEntries(
      dirtyFiles.map((path) => [
        path,
        existsSync(join(repository, path)) ? hash(readFileSync(join(repository, path))) : 'deleted',
      ]),
    );
    versionSet = {
      git_commit: git(['rev-parse', 'HEAD']),
      dirty,
      runtime: process.version,
      browser: null,
      lockfile_hash: hash(readFileSync(join(repository, 'pnpm-lock.yaml'))),
      catalog_version: hash(canonical(catalog)),
      fixture_checksum: hash(canonical(initial)),
      fixture_checksum_status:
        'Exact materialized start snapshot; generated IDs vary. Use archived snapshot for replay; sample is not frozen for paired comparison.',
      loader_checksum: `sha256:${loaded.checksum}`,
      procedure_hash: hash(readFileSync(join(repository, 'docs/evidence/G1/W1.5-metrics.md'))),
      case_hash: hash(canonical(testCase)),
      checks_hash: hash(canonical(testCase.fact_checks)),
      model_id: dry ? [] : null,
      configured_model: options.mock ? 'synthetic/mock-v1' : null,
      agent_version: options.mock ? 'harness-mock-v1' : dry ? 'off' : null,
      agent_configuration: {
        mode: dry ? 'off' : options.mock ? 'mock' : 'custom',
        command_hash: options.agentCommand ? hash(options.agentCommand) : null,
        reasoning: options.mock || dry ? 'none' : null,
        enabled_tools: options.mock ? ['synthetic REST apply'] : dry ? [] : null,
      },
      billing: options.mock
        ? 'synthetic test values; no real charge'
        : dry
          ? 'no agent'
          : 'provider adapter',
      prompt_hash: dry ? hash(canonical([])) : null,
      adapter_version: 'pharos-eval-v1',
      fixture_variant: testCase.fixture.variant,
      repetition: options.repetition ?? 1,
      semantic_date_strategy: 'fixed query date; no browser clock capture',
      attribution_complete: false,
      comparison_eligible: false,
    };
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const agentLog = join(temporary, 'agent.log');
    child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=development', 'src/index.ts'],
      {
        cwd: serverDirectory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          PHAROS_DB: database,
          PHAROS_AGENT_LOG: agentLog,
          PHAROS_AGENT_COMMAND: dry
            ? 'off'
            : '"$PHAROS_EVAL_NODE" --import "$PHAROS_EVAL_LOADER" --conditions=development "$PHAROS_EVAL_WRAPPER"',
          PHAROS_EVAL_NODE: process.execPath,
          PHAROS_EVAL_LOADER: join(serverDirectory, 'node_modules/tsx/dist/loader.mjs'),
          PHAROS_EVAL_WRAPPER: join(repository, 'eval/harness/invoke.ts'),
          PHAROS_EVAL_COMMAND: options.mock ? scriptCommand('mock-agent.ts') : options.agentCommand,
          PHAROS_EVAL_MOCK: options.mock,
          PHAROS_EVAL_REFS: join(temporary, 'refs.json'),
        },
      },
    );
    let spawnError: Error | undefined;
    child.on('error', (value) => {
      spawnError = value;
    });
    child.stdout!.on('data', (data: Buffer) => {
      serverLog += data.toString();
    });
    child.stderr!.on('data', (data: Buffer) => {
      serverLog += data.toString();
    });
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(url + path, { ...init, signal: AbortSignal.timeout(2000) });
      const body: unknown = await response.json();
      event('observer_rest', { path, status: response.status, body });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
      return body as T;
    };
    const readyDeadline = performance.now() + 15000;
    while (true) {
      if (spawnError || child.exitCode !== null)
        throw new Error('Isolated server exited before readiness');
      if (
        !serverLog.includes(`Pharos server listening on http://localhost:${port} (db: ${database})`)
      ) {
        if (performance.now() >= readyDeadline) throw new Error('Server readiness timeout');
        await pause(50);
        continue;
      }
      try {
        await request('/api/health');
        break;
      } catch {
        if (performance.now() >= readyDeadline) throw new Error('Server readiness timeout');
        await pause(50);
      }
    }
    const projectId = loaded.refs[testCase.fixture.projectRef];
    if (!projectId) throw new Error('Unknown project ref');
    const context = Object.fromEntries(
      Object.entries(testCase.request).map(([key, value]) => {
        if (!['viewId', 'aboutId'].includes(key) || !value.startsWith('$')) return [key, value];
        const id = loaded.refs[value.slice(1)];
        if (!id) throw new Error(`Unknown context ref: ${value}`);
        return [key, id];
      }),
    );
    console.error('Harness: submitting request (2/4)');
    start = performance.now();
    event('input_dispatch', { projectId, request: context });
    const applied = await request<{ created: Record<string, string> }>('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:owner' },
      body: JSON.stringify({
        message: 'Submit evaluation case',
        operations: [
          { op: 'create', type: 'request', ref: 'case', data: { projectId, ...context } },
        ],
      }),
    });
    const requestId = applied.created.case!;
    console.error('Harness: waiting for answer and agent settlement (3/4)');
    classification = dry ? 'answering_off' : 'timeout';
    if (dry) {
      agentStatus = await request<AgentStatus>('/api/agent');
      if (agentStatus.mode !== 'off' || agentStatus.configured || agentStatus.running)
        throw new Error('Could not verify answering is off');
    }
    while (!dry && performance.now() - start < timeoutMs) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Isolated server exited during observation');
      const pending = await request<Entity<'request'>>(`/api/entities/request/${requestId}`);
      finalRequest = pending;
      agentStatus = await request<AgentStatus>('/api/agent');
      if (pending.data.answerViewId) {
        answer = await request<Entity<'view'>>(`/api/entities/view/${pending.data.answerViewId}`);
        if (viewExistsMs === null) viewExistsMs = performance.now() - start;
        save('view.json', answer);
        save(
          'view-spec.json',
          toBoard(answer.data.spec ?? TEMPLATES[answer.data.template ?? 'overview']),
        );
        if (lastCandidateRevision !== answer.updatedRev) {
          lastCandidateRevision = answer.updatedRev;
          candidateCount++;
          const candidateData = await request<ProjectDataset>(`/api/projects/${projectId}/data`);
          firstCandidate ??= { view: answer, data: candidateData };
          save(`candidate-${candidateCount}.json`, {
            view: answer,
            data: candidateData,
            observed_ms: performance.now() - start,
          });
        }
      }
      if (agentStatus.lastRun && !agentStatus.running && !agentStatus.queued.length) {
        const currentLog = existsSync(agentLog) ? readFileSync(agentLog, 'utf8') : '';
        if (answer || extractMetrics(currentLog).failureClass) break;
        if (agentStatus.lastRun.exitCode !== 0)
          throw new Error('Agent command failed without a classified diagnostic');
      }
      await pause(
        Math.min(
          testCase.script.normalWaitMs,
          Math.max(1, timeoutMs - (performance.now() - start)),
        ),
      );
    }
    // Stop any outstanding agent before exporting; no post-deadline mutations enter later runs.
    end = performance.now();
    const deadline = !dry && end - start >= timeoutMs;
    if (deadline) censoredAtMs = timeoutMs;
    await stop(child);
    child = undefined;
    log = existsSync(agentLog) ? readFileSync(agentLog, 'utf8') : '';
    const metrics = extractMetrics(log, dry);
    if (!dry) {
      const models: unknown[] = [];
      for (const line of log.split('\n')) {
        if (!line.startsWith('PHAROS_EVAL:')) continue;
        try {
          const record = JSON.parse(line.slice('PHAROS_EVAL:'.length)) as Record<string, unknown>;
          if (
            record.type === 'model_usage' &&
            record.final === true &&
            typeof record.model_id === 'string'
          )
            models.push({
              request_id: record.request_id,
              provider: record.provider ?? null,
              resolved: record.model_id,
            });
        } catch {
          /* Parser records malformed capture separately. */
        }
      }
      versionSet.model_id = models.length ? models : null;
    }
    if (!dry && !deadline) {
      classification = metrics.diagnostics.some((d) => d.classification === 'agent_refusal')
        ? 'agent_refusal'
        : metrics.diagnostics.some((d) => d.classification === 'query_error')
          ? 'query_error'
          : answer
            ? 'success'
            : 'timeout';
    }
    if (answer) {
      const data: ProjectDataset = store.dataset(projectId);
      save('answer-data.json', data);
      const board = toBoard(answer.data.spec ?? TEMPLATES[answer.data.template ?? 'overview']);
      checks = testCase.fact_checks.map((check) => {
        const node = board.widgets.find((widget) => widget.id === check.widgetId)?.node;
        const query =
          node && 'query' in node ? (node.query as Filter & { type: 'task' }) : undefined;
        const observed =
          query?.type === 'task'
            ? runQuery(data, 'task', query, { today: testCase.fixture.semanticDate })
                .map((entity) => entity.id)
                .sort()
            : [];
        const expected = check.expectedRefs.map((ref) => loaded.refs[ref]).sort();
        return {
          ...check,
          expected,
          observed,
          pass: Boolean(query) && canonical(observed) === canonical(expected),
          evidence_ref: 'view-spec.json',
        };
      });
      if (firstCandidate) {
        const firstBoard = toBoard(
          firstCandidate.view.data.spec ??
            TEMPLATES[firstCandidate.view.data.template ?? 'overview'],
        );
        for (const check of testCase.fact_checks) {
          const node = firstBoard.widgets.find((widget) => widget.id === check.widgetId)?.node;
          const query =
            node && 'query' in node ? (node.query as Filter & { type: 'task' }) : undefined;
          const observed =
            query?.type === 'task'
              ? runQuery(firstCandidate.data, 'task', query, {
                  today: testCase.fixture.semanticDate,
                })
                  .map((entity) => entity.id)
                  .sort()
              : [];
          checks.push({
            id: `${check.id}:first`,
            checkpoint: 'initial-persisted-answer',
            observed,
            pass:
              Boolean(query) &&
              canonical(observed) ===
                canonical(check.expectedRefs.map((ref) => loaded.refs[ref]).sort()),
            evidence_ref: 'candidate-1.json',
          });
        }
      }
      checks.push({
        id: 'answer-link',
        pass:
          finalRequest?.data.status === 'answered' &&
          answer.data.projectId === projectId &&
          answer.data.kind === 'answer' &&
          answer.data.question === testCase.request.question,
      });
      const mutations = db
        .prepare(
          'SELECT entity_type, entity_id, op FROM changes WHERE revision_id > ? ORDER BY revision_id, seq',
        )
        .all(startRevision);
      checks.push({
        id: 'no-unrelated-write',
        pass: mutations.every(
          (change) =>
            (change.entity_type === 'request' && change.entity_id === requestId) ||
            (change.entity_type === 'view' && change.entity_id === answer!.id),
        ),
        evidence_ref: 'revisions.json',
      });
      if (classification === 'success' && checks.some((check) => !check.pass))
        classification = 'wrong_facts';
    }
    endRevision = store.latestRevisionId();
    save('end-snapshot.json', snapshot());
    save('revisions.json', {
      startRevision,
      endRevision,
      revisions: db
        .prepare('SELECT * FROM revisions WHERE id > ? AND id <= ? ORDER BY id')
        .all(startRevision, endRevision),
      changes: db
        .prepare(
          'SELECT * FROM changes WHERE revision_id > ? AND revision_id <= ? ORDER BY revision_id, seq',
        )
        .all(startRevision, endRevision),
    });
    const invocationPath = join(temporary, 'invocation.json');
    if (existsSync(invocationPath)) {
      const invocation: unknown = JSON.parse(readFileSync(invocationPath, 'utf8'));
      save('invocation.json', invocation);
      versionSet.prompt_hash = hash(canonical(invocation));
    }
    versionSet.prompt_boundary =
      'Expanded PHAROS_PROMPT and request context only; provider-managed instructions and dynamic transcript not fully captured';
    versionSet.invocation_ids = dry ? [] : ['isolated-invocation-1'];
    if (!deadline) end = performance.now();
    event('terminal', { classification, startRevision, endRevision });
  } catch (cause) {
    classification = 'harness_error';
    error = cause instanceof Error ? cause.message : String(cause);
    end = performance.now();
    event('terminal', { classification, error });
  } finally {
    await stop(child);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    if (temporary && existsSync(join(temporary, 'agent.log')))
      log = readFileSync(join(temporary, 'agent.log'), 'utf8');
    if (db && classification === 'harness_error') {
      endRevision = Number(
        db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM revisions').get()!.id,
      );
      save('revisions.json', {
        startRevision,
        endRevision,
        revisions: db
          .prepare('SELECT * FROM revisions WHERE id > ? AND id <= ? ORDER BY id')
          .all(startRevision, endRevision),
        changes: db
          .prepare(
            'SELECT * FROM changes WHERE revision_id > ? AND revision_id <= ? ORDER BY revision_id, seq',
          )
          .all(startRevision, endRevision),
      });
    }
    db?.close();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
  console.error('Harness: writing evidence (4/4)');
  const metrics = extractMetrics(log, dry && classification === 'answering_off');
  const result = {
    run_id: runId,
    classification,
    error,
    version_set: versionSet,
    checks,
    metrics: {
      ...metrics,
      latency: {
        value_ms: censoredAtMs ?? (start !== undefined && end !== undefined ? end - start : null),
        observation_elapsed_ms: start !== undefined && end !== undefined ? end - start : null,
        censored: censoredAtMs !== null,
        scope: 'REST dispatch to answer/agent settlement or deadline; no render',
        terminal:
          classification === 'timeout'
            ? 'deadline'
            : classification === 'success'
              ? 'success'
              : 'failure',
      },
      view_exists_ms: viewExistsMs,
      agent_process_ms: agentStatus?.lastRun?.durationMs ?? null,
      time_to_useful_content: {
        value_ms: null,
        status: 'capture_error',
        reason: 'Browser paint not captured',
      },
      completion: {
        value: null,
        status: 'unscored',
        reason: 'Persisted sample checks only; full W1 UI/reviewer checks outstanding',
      },
      correction_burden: { value: null, status: 'unscored' },
    },
    log_slice: { file: 'agent.log', byte_start: 0, byte_end: Buffer.byteLength(log) },
    start_revision: startRevision,
    end_revision: endRevision,
    evidence: {
      view_spec: answer ? 'view-spec.json' : null,
      candidates: candidateCount,
      events: 'events.json',
      revisions: endRevision ? 'revisions.json' : null,
    },
  };
  writeFileSync(join(output, 'agent.log'), log);
  writeFileSync(join(output, 'server.log'), serverLog);
  save('events.json', events);
  save('result.json', result);
  console.error(`Harness: complete (${classification})`);
  return { output, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const options: Options = { casePath: join(repository, 'eval/cases/sample-A1.json') };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--dry-run') options.dryRun = true;
    else {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === '--case') options.casePath = value;
      else if (arg === '--output') options.output = value;
      else if (arg === '--scratch') options.scratch = value;
      else if (arg === '--mock') options.mock = value;
      else if (arg === '--agent-command') options.agentCommand = value;
      else if (arg === '--timeout-ms') options.timeoutMs = Number(value);
      else throw new Error(`Unknown option ${arg}`);
    }
  }
  const completed = await run(options);
  console.log(JSON.stringify(completed));
  if (!['success', 'answering_off'].includes(completed.result.classification)) process.exitCode = 1;
}
