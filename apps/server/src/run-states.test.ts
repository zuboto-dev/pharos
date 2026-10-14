import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner, type AgentStatus, type RunResult, type Runner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

// R11 (W7): the answering agent's states are true. Pause stops the run in progress (the signal
// reaches the runner); until it exits the state is "stopping", then "paused" with the run's
// outcome and its questions still open. Timeouts and failures say so, and a retry runs again.

const person: Author = { kind: 'human', name: 'me' };

afterEach(() => {
  vi.useRealTimers();
});

function setup(options: { mode?: 'custom' | 'off' } = {}) {
  const store = new Store(openDatabase(':memory:'));
  const feed = new RevisionFeed(store, 0);
  const runs: {
    env: Record<string, string>;
    signal?: AbortSignal;
    resolve: (r: RunResult) => void;
  }[] = [];
  const runner: Runner = (_cmd, env, _timeout, signal) =>
    new Promise((resolve) => runs.push({ env, signal, resolve }));
  const agent = new AgentRunner(store, {
    command: options.mode === 'off' ? undefined : 'answer',
    mode: options.mode ?? 'custom',
    runner,
    batchMs: 10,
  });
  agent.watch(feed);
  const projectId = store.apply(person, {
    message: 'Create A',
    operations: [{ op: 'create', type: 'project', data: { name: 'A' } }],
  }).created['0']!;
  const ask = (question: string) =>
    store.apply(person, {
      message: `Ask: ${question}`,
      operations: [{ op: 'create', type: 'request', data: { projectId, question } }],
    }).created['0']!;
  const states: AgentStatus['state'][] = [];
  agent.onChange((s) => states.push(s.state));
  return { store, agent, runs, ask, projectId, states };
}

describe('answering run states (W7)', () => {
  it('goes queued → running with the request ids and start time', async () => {
    vi.useFakeTimers();
    const { agent, runs, ask, states } = setup();
    expect(agent.status().state).toBe('idle');
    const id = ask('What is due?');
    expect(agent.status().state).toBe('queued');
    await vi.advanceTimersByTimeAsync(10);
    const status = agent.status();
    expect(status.state).toBe('running');
    expect(status.run).toMatchObject({ requestIds: [id] });
    expect(Date.parse(status.run!.startedAt)).not.toBeNaN();
    expect(runs[0]!.env.PHAROS_REQUEST_IDS).toBe(id);
    runs[0]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({
      state: 'idle',
      lastRun: { outcome: 'finished', requestIds: [id] },
    });
    expect(agent.status().run).toBeUndefined();
    expect(states).toEqual(expect.arrayContaining(['queued', 'running', 'idle']));
  });

  it('pausing during a run stops it: stopping until it exits, then paused, questions open', async () => {
    vi.useFakeTimers();
    const { store, agent, runs, ask, projectId } = setup();
    const id = ask('What is due?');
    await vi.advanceTimersByTimeAsync(10);
    agent.setEnabled(false);
    // The signal reached the runner; the run hasn't exited yet, so nothing says "paused".
    expect(runs[0]!.signal?.aborted).toBe(true);
    expect(agent.status()).toMatchObject({ state: 'stopping', paused: true, enabled: false });
    expect(agent.status().run?.requestIds).toEqual([id]);
    // The process exits late, after the pause: its result is recorded as stopped.
    runs[0]!.resolve({ exitCode: 143, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({
      state: 'paused',
      running: false,
      lastRun: { outcome: 'stopped', stopped: true, requestIds: [id] },
    });
    expect(
      store.list('request', { projectId, where: { status: 'open' } }).map((r) => r.id),
    ).toEqual([id]);
    // Nothing new starts while paused.
    ask('Another?');
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toHaveLength(1);
    expect(agent.status().queued).toEqual([]);
  });

  it('a timeout and a failure each say so, and a retry runs the open questions again', async () => {
    vi.useFakeTimers();
    const { agent, runs, ask } = setup();
    ask('First?');
    await vi.advanceTimersByTimeAsync(10);
    runs[0]!.resolve({ exitCode: null, timedOut: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status().lastRun?.outcome).toBe('timed_out');
    expect(agent.answerWaiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(2);
    runs[1]!.resolve({ exitCode: 1, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status()).toMatchObject({ state: 'idle', lastRun: { outcome: 'failed' } });
  });

  it('a listener that throws never stops the runner', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { agent, runs, ask } = setup();
    agent.onChange(() => {
      throw new Error('listener broke');
    });
    ask('First?');
    await vi.advanceTimersByTimeAsync(10);
    runs[0]!.resolve({ exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status().lastRun?.outcome).toBe('finished');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('reports enabled:false when answering is off on the server (W7.9)', async () => {
    const { store, agent } = setup({ mode: 'off' });
    expect(agent.status()).toMatchObject({ state: 'off', enabled: false, paused: false });
    const app = createApp(store, undefined, agent, { service: true });
    const settings = (await (await app.request('/api/settings')).json()) as {
      service: boolean;
      agent: AgentStatus;
    };
    expect(settings.service).toBe(true);
    expect(settings.agent).toMatchObject({ enabled: false, state: 'off' });
  });
});
