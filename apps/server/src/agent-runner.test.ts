import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner, agentMcpConfig, agentSetup, type Runner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const person: Author = { kind: 'human', name: 'me' };

afterEach(() => {
  vi.useRealTimers();
});

function setup(command = 'answer-my-questions') {
  const store = new Store(openDatabase(':memory:'));
  const feed = new RevisionFeed(store, 0);
  const calls: { command: string; env: Record<string, string> }[] = [];
  let finish: () => void = () => {};
  const runner: Runner = (cmd, env) => {
    calls.push({ command: cmd, env });
    return new Promise((resolve) => {
      finish = () => resolve({ exitCode: 0, timedOut: false });
    });
  };
  const agent = new AgentRunner(store, {
    command,
    runner,
    batchMs: 50,
    prompt: (ids) => `Answer the questions in ${ids.join(', ')}`,
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
  return { store, feed, agent, calls, ask, projectId, finish: () => finish() };
}

describe('AgentRunner', () => {
  it('logs a failed run and still answers the next question', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const calls: string[] = [];
    const runner: Runner = (cmd) => {
      calls.push(cmd);
      return calls.length === 1
        ? Promise.reject(new Error('spawn failed'))
        : Promise.resolve({ exitCode: 0, timedOut: false });
    };
    const agent = new AgentRunner(store, { command: 'answer', runner, batchMs: 50 });
    agent.watch(feed);
    const projectId = store.apply(person, {
      message: 'Create A',
      operations: [{ op: 'create', type: 'project', data: { name: 'A' } }],
    }).created['0']!;
    const ask = (question: string) =>
      store.apply(person, {
        message: `Ask: ${question}`,
        operations: [{ op: 'create', type: 'request', data: { projectId, question } }],
      });
    ask('First?');
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(agent.status()).toMatchObject({ running: false, answering: [], queued: [] });
    ask('Second?');
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(2);
    errors.mockRestore();
  });

  it('does nothing unless a command is configured', async () => {
    vi.useFakeTimers();
    const { agent, calls, ask } = setup('');
    ask('What is next?');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([]);
    expect(agent.status()).toMatchObject({
      configured: false,
      mode: 'unavailable',
      running: false,
      answering: [],
      queued: [],
    });
  });

  it('runs the command once for questions asked together, with their ids', async () => {
    vi.useFakeTimers();
    const { agent, calls, ask, projectId } = setup();
    const a = ask('What is next?');
    const b = ask('Are we on track?');
    expect(agent.status().queued).toEqual([projectId]);
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('answer-my-questions');
    expect(calls[0]!.env).toMatchObject({
      PHAROS_PROJECT_IDS: projectId,
      PHAROS_REQUEST_IDS: `${a},${b}`,
      PHAROS_PROMPT: `Answer the questions in ${projectId}`,
    });
    expect(agent.status()).toMatchObject({ running: true, answering: [projectId], queued: [] });
  });

  it('never overlaps runs; questions asked meanwhile get the next run', async () => {
    vi.useFakeTimers();
    const { agent, calls, ask, finish } = setup();
    ask('What is next?');
    await vi.advanceTimersByTimeAsync(50);
    const later = ask('Who is on what?');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);

    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(2);
    // The first question is still open (the fake agent didn't answer it), so it is included again.
    expect(calls[1]!.env.PHAROS_REQUEST_IDS).toContain(later);
    expect(agent.status().lastRun).toMatchObject({ exitCode: 0, timedOut: false });
  });

  it('skips the run when the questions were answered or dismissed in the meantime', async () => {
    vi.useFakeTimers();
    const { store, calls, ask } = setup();
    const id = ask('What is next?');
    store.apply(person, {
      message: 'Dismiss',
      operations: [{ op: 'update', type: 'request', id, data: { status: 'dismissed' } }],
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([]);
  });

  it('ignores revisions that ask nothing', async () => {
    vi.useFakeTimers();
    const { store, calls, projectId } = setup();
    store.apply(person, {
      message: 'Add a task',
      operations: [{ op: 'create', type: 'task', data: { projectId, title: 'T' } }],
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([]);
  });

  it('can be paused from Settings, and then asks nothing', async () => {
    vi.useFakeTimers();
    const { store, feed, agent, calls, ask } = setup();
    const app = createApp(store, feed, agent, { dataPath: '/tmp/x.db', port: 4300 });
    const put = await app.request('/api/settings/agent', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(await put.json()).toMatchObject({ enabled: false });
    ask('What is next?');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
    // The choice is saved with the data, so it survives a restart.
    expect(
      new AgentRunner(store, {
        command: 'x',
        runner: async () => ({ exitCode: 0, timedOut: false }),
      }).enabled,
    ).toBe(false);

    agent.setEnabled(true);
    const waiting = await app.request('/api/agent/answer-waiting', { method: 'POST' });
    expect(await waiting.json()).toEqual({ questions: 1 });
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(1);
  });

  it('shows where data lives and how agents connect', async () => {
    const { store, feed, agent } = setup();
    const app = createApp(store, feed, agent, {
      dataPath: '/home/me/.pharos/pharos.db',
      port: 4301,
    });
    expect(await (await app.request('/api/settings')).json()).toMatchObject({
      dataPath: '/home/me/.pharos/pharos.db',
      port: 4301,
      mcpUrl: 'http://localhost:4301/mcp',
      projects: 1,
      agent: { configured: true, enabled: true },
    });
    const without = createApp(store);
    const refused = await without.request('/api/settings/agent', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(refused.status).toBe(400);
  });

  it('reports its status over REST', async () => {
    const { store, feed, agent } = setup();
    const app = createApp(store, feed, agent);
    const res = await app.request('/api/agent');
    expect(await res.json()).toEqual({
      configured: true,
      enabled: true,
      paused: false,
      state: 'idle',
      mode: 'custom',
      command: 'answer-my-questions',
      running: false,
      answering: [],
      queued: [],
    });
    const without = createApp(store);
    // W7.9: nothing set up means questions aren't answered automatically.
    expect(await (await without.request('/api/agent')).json()).toMatchObject({
      configured: false,
      enabled: false,
      state: 'unavailable',
    });
  });
});

describe('agentSetup', () => {
  const opts = { hasClaude: true, mcpConfigPath: '/home/me/.pharos/agent-mcp.json' };

  it('uses Claude Code by default when it is installed, over MCP to this server only', () => {
    const setup = agentSetup(undefined, opts);
    expect(setup.mode).toBe('default');
    expect(setup.command).toMatch(/^claude -p "\$PHAROS_PROMPT" /);
    expect(setup.command).toContain(
      '--mcp-config "/home/me/.pharos/agent-mcp.json" --strict-mcp-config',
    );
    expect(setup.command).toContain('--allowedTools "mcp__pharos__*"');
    expect(JSON.parse(agentMcpConfig('http://localhost:4300'))).toEqual({
      mcpServers: { pharos: { type: 'http', url: 'http://localhost:4300/mcp' } },
    });
  });

  it('prefers the configured command, and can be turned off', () => {
    expect(agentSetup('codex exec "answer"', opts)).toEqual({
      mode: 'custom',
      command: 'codex exec "answer"',
    });
    expect(agentSetup('off', opts)).toEqual({ mode: 'off' });
    expect(agentSetup('', { ...opts, hasClaude: false })).toEqual({ mode: 'unavailable' });
  });
});
