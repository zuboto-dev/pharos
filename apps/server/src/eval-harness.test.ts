import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverDirectory = resolve(process.cwd());
const repository = resolve(serverDirectory, '../..');
const harnessCli = join(repository, 'eval/harness/run.ts');
const tsxLoader = join(serverDirectory, 'node_modules/tsx/dist/loader.mjs');
const sampleCase = join(repository, 'eval/cases/sample-A1.json');
const TEST_TIMEOUT_MS = 90_000;
const CHILD_TIMEOUT_MS = 60_000;

interface HarnessResult {
  output: string;
  result: {
    classification: string;
    version_set: Record<string, unknown>;
    checks: Array<{ pass?: boolean }>;
    metrics: {
      toolCalls: {
        total: number | null;
        pharos: number | null;
        completeness: string;
      };
      tokens: { total: number | null; completeness: string };
      cost: { actualUsd: number | null; completeness: string };
    };
  };
}

interface HarnessExecution {
  directory: string;
  result: HarnessResult;
  exitCode: number | null;
  cleanup: () => void;
}

function terminateProcessGroup(
  pid: number | undefined,
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* The child may already have exited. */
    }
  }
}

async function invokeHarness(args: string[]): Promise<HarnessExecution> {
  const directory = mkdtempSync(join(tmpdir(), 'pharos-w3-3-test-'));
  const outputRoot = join(directory, 'output');
  const scratchRoot = join(directory, 'scratch');
  const commandArgs = [
    '--import',
    tsxLoader,
    '--conditions=development',
    harnessCli,
    '--output',
    outputRoot,
    '--scratch',
    scratchRoot,
    ...args,
  ];

  try {
    const execution = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
    }>((resolveExecution, rejectExecution) => {
      const child = spawn(process.execPath, commandArgs, {
        cwd: serverDirectory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let processTimedOut = false;
      let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        processTimedOut = true;
        terminateProcessGroup(child.pid, child, 'SIGTERM');
        hardKillTimer = setTimeout(() => terminateProcessGroup(child.pid, child, 'SIGKILL'), 400);
      }, CHILD_TIMEOUT_MS);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (hardKillTimer) clearTimeout(hardKillTimer);
        callback();
      };

      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', (error) => finish(() => rejectExecution(error)));
      child.once('close', (code) =>
        finish(() => {
          if (processTimedOut) {
            rejectExecution(
              new Error(`Harness CLI exceeded ${CHILD_TIMEOUT_MS}ms. stderr: ${stderr}`),
            );
            return;
          }
          resolveExecution({ stdout, stderr, exitCode: code });
        }),
      );
    });

    const jsonLine = execution.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .at(-1);
    if (!jsonLine)
      throw new Error(`Harness CLI did not print its result JSON. stderr: ${execution.stderr}`);
    const result = JSON.parse(jsonLine) as HarnessResult;
    return {
      directory,
      result,
      exitCode: execution.exitCode,
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function resultBundle(execution: HarnessExecution): HarnessResult {
  const path = join(execution.result.output, 'result.json');
  expect(existsSync(path)).toBe(true);
  return {
    output: execution.result.output,
    result: JSON.parse(readFileSync(path, 'utf8')) as HarnessResult['result'],
  };
}

describe('W3.3 evaluation harness', () => {
  it(
    'dry run records the version set and explicitly reports answering off',
    async () => {
      const execution = await invokeHarness(['--case', sampleCase, '--dry-run']);
      try {
        const result = resultBundle(execution);
        expect(result.result.classification).toBe('answering_off');
        expect(execution.exitCode).toBe(0);
        expect(result.result.version_set.git_commit).toEqual(expect.any(String));
        expect(result.result.version_set.fixture_checksum).toEqual(
          expect.stringMatching(/^sha256:/),
        );
        expect(result.result.version_set.model_id).toEqual([]);
        expect(result.result.metrics.toolCalls).toMatchObject({
          total: 0,
          completeness: 'complete',
        });
        expect(result.result.metrics.tokens).toMatchObject({ total: 0, completeness: 'complete' });
        expect(result.result.metrics.cost).toMatchObject({
          actualUsd: 0,
          completeness: 'complete',
        });
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mock answer stores a view spec, revisions, version set, and extracted metrics',
    async () => {
      const execution = await invokeHarness([
        '--case',
        sampleCase,
        '--mock',
        'success',
        '--timeout-ms',
        '10000',
      ]);
      try {
        const result = resultBundle(execution);
        expect(result.result.classification).toBe('success');
        expect(execution.exitCode).toBe(0);
        expect(result.result.version_set).toMatchObject({
          git_commit: expect.any(String),
          catalog_version: expect.stringMatching(/^sha256:/),
          fixture_checksum: expect.stringMatching(/^sha256:/),
          case_hash: expect.stringMatching(/^sha256:/),
          adapter_version: expect.any(String),
        });
        const viewSpec = JSON.parse(
          readFileSync(join(result.output, 'view-spec.json'), 'utf8'),
        ) as {
          component?: string;
          widgets?: Array<{ id?: string }>;
        };
        expect(viewSpec.component).toBe('Board');
        expect(viewSpec.widgets?.some((widget) => widget.id === 'risks')).toBe(true);
        const revisions = JSON.parse(
          readFileSync(join(result.output, 'revisions.json'), 'utf8'),
        ) as {
          revisions: unknown[];
          changes: Array<{ entity_type?: string }>;
        };
        expect(revisions.revisions.length).toBeGreaterThan(0);
        expect(revisions.changes.some((change) => change.entity_type === 'view')).toBe(true);
        expect(result.result.metrics.toolCalls).toMatchObject({
          total: 1,
          pharos: 1,
          completeness: 'complete',
        });
        expect(result.result.metrics.tokens).toMatchObject({
          total: 170,
          completeness: 'complete',
        });
        expect(result.result.metrics.cost).toMatchObject({
          actualUsd: 0.001,
          completeness: 'complete',
        });
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'classifies a fully captured answer with incorrect facts as wrong_facts',
    async () => {
      const execution = await invokeHarness([
        '--case',
        sampleCase,
        '--mock',
        'wrong_facts',
        '--timeout-ms',
        '10000',
      ]);
      try {
        expect(execution.exitCode).toBe(1);
        const result = resultBundle(execution);
        expect(result.result.classification).toBe('wrong_facts');
        expect(result.result.checks.some((check) => check.pass === false)).toBe(true);
        expect(existsSync(join(result.output, 'view-spec.json'))).toBe(true);
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'classifies an adapter-reported query error',
    async () => {
      const execution = await invokeHarness([
        '--case',
        sampleCase,
        '--mock',
        'query_error',
        '--timeout-ms',
        '10000',
      ]);
      try {
        expect(execution.exitCode).toBe(1);
        expect(resultBundle(execution).result.classification).toBe('query_error');
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'classifies an adapter-reported agent refusal',
    async () => {
      const execution = await invokeHarness([
        '--case',
        sampleCase,
        '--mock',
        'agent_refusal',
        '--timeout-ms',
        '10000',
      ]);
      try {
        expect(execution.exitCode).toBe(1);
        expect(resultBundle(execution).result.classification).toBe('agent_refusal');
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'classifies a request that reaches its deadline',
    async () => {
      const execution = await invokeHarness([
        '--case',
        sampleCase,
        '--mock',
        'timeout',
        '--timeout-ms',
        '2600',
      ]);
      try {
        expect(execution.exitCode).toBe(1);
        expect(resultBundle(execution).result.classification).toBe('timeout');
      } finally {
        execution.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'records case loading failures as harness_error',
    async () => {
      const missingCase = join(
        mkdtempSync(join(tmpdir(), 'pharos-w3-3-missing-case-')),
        'missing.json',
      );
      const execution = await invokeHarness(['--case', missingCase, '--mock', 'success']);
      try {
        expect(execution.exitCode).toBe(1);
        expect(resultBundle(execution).result.classification).toBe('harness_error');
      } finally {
        execution.cleanup();
        rmSync(resolve(missingCase, '..'), { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it('extracts normalized usage and deduplicates adapter records without the socket harness', () => {
    const metricsUrl = new URL('../../../eval/harness/metrics.ts', import.meta.url).href;
    const source = `
      const { extractMetrics } = await import(${JSON.stringify(metricsUrl)});
      const record = value => 'PHAROS_EVAL:' + JSON.stringify({ version: 1, ...value });
      const tool = { type: 'tool_attempt', invocation_id: 'i1', call_id: 'c1', dispatch_attempt: 1, tool_name: 'apply', server: 'pharos', outcome: 'success' };
      const usage = { type: 'model_usage', request_id: 'm1', final: true, input_uncached: 100, cache_read_input: 20, cache_write_input: 10, output: 40, reasoning_output: 9, actual_cost_usd: 0.001 };
      const complete = { type: 'capture_end', tool_attempts_complete: true, model_usage_complete: true, billing_complete: true };
      const value = extractMetrics([record(tool), record(tool), record(usage), record(usage), record({ type: 'diagnostic', classification: 'query_error', message: 'bad query' }), record(complete)].join('\\n'));
      const missing = extractMetrics('');
      const off = extractMetrics('', true);
      console.log(JSON.stringify({ value, missing, off }));
    `;
    const process = spawnSync(
      globalThis.process.execPath,
      ['--import', tsxLoader, '--conditions=development', '--input-type=module', '--eval', source],
      { cwd: serverDirectory, encoding: 'utf8', timeout: 10_000 },
    );
    expect(process.status, process.stderr).toBe(0);
    const extracted = JSON.parse(process.stdout.trim()) as {
      value: {
        toolCalls: { total: number | null };
        tokens: { total: number | null; reasoningOutput: number | null };
        cost: { actualUsd: number | null };
        failureClass: string | null;
      };
      missing: HarnessResult['result']['metrics'];
      off: HarnessResult['result']['metrics'];
    };
    expect(extracted.value.toolCalls.total).toBe(1);
    expect(extracted.value.tokens.total).toBe(170);
    expect(extracted.value.tokens.reasoningOutput).toBe(9);
    expect(extracted.value.cost.actualUsd).toBe(0.001);
    expect(extracted.value.failureClass).toBe('query_error');
    expect(extracted.missing.toolCalls.total).toBeNull();
    expect(extracted.missing.tokens.total).toBeNull();
    expect(extracted.missing.cost.actualUsd).toBeNull();
    expect(extracted.off.toolCalls.total).toBe(0);
    expect(extracted.off.tokens.total).toBe(0);
    expect(extracted.off.cost.actualUsd).toBe(0);
  });

  it(
    'runs the mock agent through the in-process REST app and extracts its emitted metrics',
    () => {
      const fixtureUrl = new URL('../../../eval/fixtures/catalog-delivery.json', import.meta.url)
        .href;
      const loaderUrl = new URL('../../../eval/fixtures/load.ts', import.meta.url).href;
      const databaseUrl = new URL('./store/database.ts', import.meta.url).href;
      const storeUrl = new URL('./store/store.ts', import.meta.url).href;
      const appUrl = new URL('./app.ts', import.meta.url).href;
      const mockUrl = new URL('../../../eval/harness/mock-agent.ts', import.meta.url).href;
      const metricsUrl = new URL('../../../eval/harness/metrics.ts', import.meta.url).href;
      const source = `
      import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const { loadFixture } = await import(${JSON.stringify(loaderUrl)});
      const { openDatabase } = await import(${JSON.stringify(databaseUrl)});
      const { Store } = await import(${JSON.stringify(storeUrl)});
      const { createApp } = await import(${JSON.stringify(appUrl)});
      const { extractMetrics } = await import(${JSON.stringify(metricsUrl)});
      const fixturePath = new URL(${JSON.stringify(fixtureUrl)}).pathname;
      const temporary = mkdtempSync(join(tmpdir(), 'pharos-mock-in-process-'));
      const databasePath = join(temporary, 'pharos.db');
      const refsPath = join(temporary, 'refs.json');
      const loaded = loadFixture(fixturePath, databasePath);
      const db = openDatabase(databasePath);
      const store = new Store(db);
      const app = createApp(store);
      const projectId = loaded.refs.cd_project;
      const creation = await app.request('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:owner' },
        body: JSON.stringify({ message: 'Create socket-free evaluation request', operations: [
          { op: 'create', type: 'request', ref: 'case', data: { projectId, question: "What's blocked or at risk right now?" } },
        ] }),
      });
      if (!creation.ok) throw new Error('Could not create synthetic request: ' + await creation.text());
      const created = await creation.json();
      const requestId = created.created.case;
      writeFileSync(refsPath, JSON.stringify(loaded.refs));
      process.env.PHAROS_URL = 'http://localhost';
      process.env.PHAROS_PROJECT_IDS = projectId;
      process.env.PHAROS_REQUEST_IDS = requestId;
      process.env.PHAROS_EVAL_REFS = refsPath;
      process.env.PHAROS_EVAL_MOCK = 'success';
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const responseStatuses = [];
      const agentOutput = [];
      globalThis.fetch = async (input, init) => {
        const response = await app.request(input, init);
        responseStatuses.push(response.status);
        return response;
      };
      console.log = (...values) => { agentOutput.push(values.join(' ')); };
      try {
        await import(${JSON.stringify(mockUrl)} + '?in-process=' + Date.now());
      } finally {
        globalThis.fetch = originalFetch;
        console.log = originalLog;
      }
      const request = store.get(requestId);
      const viewId = request?.data.answerViewId;
      const view = viewId ? store.get(viewId) : null;
      const metrics = extractMetrics(agentOutput.join('\\n'));
      console.log(JSON.stringify({ responseStatuses, request, view, metrics }));
      db.close();
      rmSync(temporary, { recursive: true, force: true });
    `;
      const process = spawnSync(
        globalThis.process.execPath,
        [
          '--import',
          tsxLoader,
          '--conditions=development',
          '--input-type=module',
          '--eval',
          source,
        ],
        { cwd: serverDirectory, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
      );
      expect(process.status, process.stderr).toBe(0);
      const output = JSON.parse(process.stdout.trim()) as {
        responseStatuses: number[];
        request: { data: { status: string; answerViewId?: string } };
        view: {
          type: string;
          data: { kind?: string; spec?: { widgets?: Array<{ id?: string }> } };
        } | null;
        metrics: {
          toolCalls: { total: number | null };
          tokens: { total: number | null };
          cost: { actualUsd: number | null };
        };
      };
      expect(output.responseStatuses).toEqual([200]);
      expect(output.request.data.status).toBe('answered');
      expect(output.request.data.answerViewId).toBeTruthy();
      expect(output.view?.type).toBe('view');
      expect(output.view?.data.kind).toBe('answer');
      expect(output.view?.data.spec?.widgets?.some((widget) => widget.id === 'risks')).toBe(true);
      expect(output.metrics.toolCalls.total).toBe(1);
      expect(output.metrics.tokens.total).toBe(170);
      expect(output.metrics.cost.actualUsd).toBe(0.001);
    },
    TEST_TIMEOUT_MS,
  );
});
