import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner, type AgentSetup, type RunResult, type Runner } from './agent-runner.js';
import { RevisionFeed } from './feed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const person: Author = { kind: 'human', name: 'me' };
type Mode = AgentSetup['mode'];
type PendingRun = {
  env: Record<string, string>;
  signal?: AbortSignal;
  resolve: (result: RunResult) => void;
  reject: (reason: unknown) => void;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(options: { mode?: Mode; storedEnabled?: boolean } = {}) {
  const store = new Store(openDatabase(':memory:'));
  if (options.storedEnabled !== undefined) store.setSetting('agent.enabled', options.storedEnabled);
  const feed = new RevisionFeed(store, 0);
  const runs: PendingRun[] = [];
  const runner: Runner = (_command, env, _timeoutMs, signal) =>
    new Promise((resolve, reject) => runs.push({ env, signal, resolve, reject }));
  const mode = options.mode ?? 'custom';
  const command = mode === 'custom' || mode === 'default' ? 'answer' : undefined;
  const agent = new AgentRunner(store, { command, mode, runner, batchMs: 10 });
  agent.watch(feed);
  const projectId = store.apply(person, {
    message: 'Create a test project',
    operations: [{ op: 'create', type: 'project', data: { name: 'R11 runner review' } }],
  }).created['0']!;
  const ask = (question: string) =>
    store.apply(person, {
      message: `Ask: ${question}`,
      operations: [{ op: 'create', type: 'request', data: { projectId, question } }],
    }).created['0']!;
  return { store, agent, runs, ask, projectId };
}

async function startRun(runs: PendingRun[]) {
  await vi.advanceTimersByTimeAsync(10);
  expect(runs).toHaveLength(1);
}

describe('R11 runner edge cases', () => {
  it.each([
    { mode: 'off' as const, storedEnabled: true, paused: false, state: 'off' as const },
    { mode: 'off' as const, storedEnabled: false, paused: true, state: 'off' as const },
    {
      mode: 'unavailable' as const,
      storedEnabled: true,
      paused: false,
      state: 'unavailable' as const,
    },
    {
      mode: 'unavailable' as const,
      storedEnabled: false,
      paused: true,
      state: 'unavailable' as const,
    },
  ])(
    'reports disabled setup correctly for mode=$mode and storedEnabled=$storedEnabled',
    ({ mode, storedEnabled, paused, state }) => {
      const { agent } = setup({ mode, storedEnabled });

      expect(agent.status()).toMatchObject({
        configured: false,
        enabled: false,
        paused,
        state,
      });
    },
  );

  it.each([
    { ending: 'resolves late', finish: 'resolve' as const },
    { ending: 'rejects late', finish: 'reject' as const },
  ])('records a paused run as stopped when it $ending', async ({ finish }) => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, agent, runs, ask, projectId } = setup();
    const requestId = ask('What remains open?');
    await startRun(runs);

    agent.setEnabled(false);
    expect(runs[0]!.signal?.aborted).toBe(true);
    expect(agent.status()).toMatchObject({ state: 'stopping', paused: true });

    if (finish === 'resolve') runs[0]!.resolve({ exitCode: 0, timedOut: false });
    else runs[0]!.reject(new Error('late runner failure'));
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.status()).toMatchObject({
      state: 'paused',
      running: false,
      lastRun: { outcome: 'stopped', stopped: true, requestIds: [requestId] },
    });
    expect(agent.status().run).toBeUndefined();
    expect(
      store.list('request', { projectId, where: { status: 'open' } }).map((request) => request.id),
    ).toEqual([requestId]);
    if (finish === 'reject')
      expect(errors).toHaveBeenCalledWith('[pharos] The answering run failed:', expect.any(Error));
    errors.mockRestore();
  });

  it('records returned failures, timeouts, and rejected runners without leaving a run active', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { agent, runs, ask } = setup();
    const requestId = ask('Can this request be retried?');

    await startRun(runs);
    runs[0]!.resolve({ exitCode: 1, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({ state: 'idle', lastRun: { outcome: 'failed' } });

    expect(agent.answerWaiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(2);
    runs[1]!.resolve({ exitCode: null, timedOut: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({
      state: 'idle',
      lastRun: { outcome: 'timed_out', requestIds: [requestId] },
    });

    expect(agent.answerWaiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(3);
    runs[2]!.reject(new Error('runner rejected'));
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({
      state: 'idle',
      running: false,
      answering: [],
      lastRun: { outcome: 'failed', exitCode: null, requestIds: [requestId] },
    });
    expect(errors).toHaveBeenCalledWith('[pharos] The answering run failed:', expect.any(Error));
    errors.mockRestore();
  });

  it('stays stopping through a quick resume, then schedules queued work after exit', async () => {
    vi.useFakeTimers();
    const { agent, runs, ask, projectId } = setup();
    const requestId = ask('Retry after stop?');
    await startRun(runs);

    agent.setEnabled(false);
    agent.setEnabled(true);
    expect(agent.status()).toMatchObject({ state: 'stopping', paused: false, enabled: true });
    expect(agent.answerWaiting()).toBe(1);
    expect(agent.status().queued).toEqual([projectId]);
    await vi.advanceTimersByTimeAsync(30);
    expect(runs).toHaveLength(1);

    runs[0]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({
      state: 'queued',
      lastRun: { outcome: 'stopped', requestIds: [requestId] },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.env.PHAROS_REQUEST_IDS).toBe(requestId);
    runs[1]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({ state: 'idle', lastRun: { outcome: 'finished' } });
  });

  it('loses lastRun and does not queue old open questions in a fresh runner instance', async () => {
    vi.useFakeTimers();
    const { store, agent, runs, ask, projectId } = setup();
    const requestId = ask('What happened before restart?');
    await startRun(runs);
    agent.setEnabled(false);
    runs[0]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status().lastRun?.outcome).toBe('stopped');

    agent.setEnabled(true);
    const freshRuns: PendingRun[] = [];
    const runner: Runner = (_command, env, _timeoutMs, signal) =>
      new Promise((resolve, reject) => freshRuns.push({ env, signal, resolve, reject }));
    const restarted = new AgentRunner(store, {
      command: 'answer',
      mode: 'custom',
      runner,
      batchMs: 10,
    });

    expect(restarted.status()).toMatchObject({
      state: 'idle',
      enabled: true,
      queued: [],
    });
    expect(restarted.status().lastRun).toBeUndefined();
    expect(
      store.list('request', { projectId, where: { status: 'open' } }).map((r) => r.id),
    ).toEqual([requestId]);
    expect(restarted.answerWaiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(freshRuns).toHaveLength(1);
    freshRuns[0]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
  });
});
