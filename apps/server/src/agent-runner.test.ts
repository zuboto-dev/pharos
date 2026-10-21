import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentRunner,
  agentMcpConfig,
  agentSetup,
  presetCommand,
  type Runner,
} from './agent-runner.js';
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
      presets: [
        { id: 'claude', label: 'Claude Code', installed: false },
        { id: 'codex', label: 'Codex', installed: false },
      ],
      agent: 'Your agent',
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
    expect(agentSetup('my-agent answer', { ...opts, hasCodex: true })).toEqual({
      mode: 'custom',
      command: 'my-agent answer',
      installed: ['claude', 'codex'],
    });
    expect(agentSetup('off', opts)).toEqual({ mode: 'off', installed: ['claude'] });
    expect(agentSetup('', { ...opts, hasClaude: false })).toEqual({
      mode: 'unavailable',
      installed: [],
    });
  });

  it('offers Codex when it is installed, Claude Code staying the default', () => {
    const both = agentSetup(undefined, {
      ...opts,
      hasCodex: true,
      serverUrl: 'http://localhost:4300',
    });
    expect(both).toMatchObject({
      mode: 'default',
      preset: 'claude',
      installed: ['claude', 'codex'],
    });
    if (both.mode !== 'default') throw new Error('expected a default setup');
    expect(both.command).toBe(both.commands.claude);
    expect(both.commands.codex).toBe(
      presetCommand('codex', { mcpConfigPath: '', serverUrl: 'http://localhost:4300' }),
    );
  });

  it('uses Codex alone when only Codex is installed, over MCP to this server only', () => {
    const setup = agentSetup(undefined, {
      ...opts,
      hasClaude: false,
      hasCodex: true,
      serverUrl: 'http://localhost:4301',
    });
    expect(setup).toMatchObject({ mode: 'default', preset: 'codex', installed: ['codex'] });
    const command = setup.command!;
    expect(command).toMatch(/^codex exec /);
    // Not the person's own Codex config, no session kept, no shell writes, and the brief last.
    expect(command).toContain('--ignore-user-config');
    expect(command).toContain('--ephemeral');
    expect(command).toContain('--sandbox read-only');
    expect(command).toContain(`-c 'mcp_servers.pharos.url="http://localhost:4301/mcp"'`);
    expect(command).toContain(`-c 'mcp_servers.pharos.default_tools_approval_mode="approve"'`);
    expect(command).toMatch(/ "\$PHAROS_PROMPT"$/);
  });
});

describe('choosing the answering agent', () => {
  const commands = { claude: 'run-claude', codex: 'run-codex' };

  function chooser(options: { presets?: Partial<typeof commands>; mode?: 'default' | 'custom' }) {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const calls: string[] = [];
    let finish: () => void = () => {};
    const runner: Runner = (cmd) => {
      calls.push(cmd);
      return new Promise((resolve) => {
        finish = () => resolve({ exitCode: 0, timedOut: false });
      });
    };
    const presets = options.presets ?? commands;
    const mode = options.mode ?? 'default';
    const agent = new AgentRunner(store, {
      command: mode === 'custom' ? 'my-agent' : Object.values(presets)[0],
      ...(mode === 'default' ? { presets } : {}),
      mode,
      runner,
      batchMs: 50,
    });
    agent.watch(feed);
    const app = createApp(store, feed, agent);
    const put = (body: unknown, headers: Record<string, string> = {}) =>
      app.request('/api/settings/agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const projectId = store.apply(person, {
      message: 'Create A',
      operations: [{ op: 'create', type: 'project', data: { name: 'A' } }],
    }).created['0']!;
    const ask = (question: string) =>
      store.apply(person, {
        message: `Ask: ${question}`,
        operations: [{ op: 'create', type: 'request', data: { projectId, question } }],
      });
    return { store, agent, app, put, calls, ask, finish: () => finish() };
  }

  it('starts with Claude Code, lists both, and switches to an installed preset', async () => {
    const { store, agent, app, put } = chooser({});
    expect(await (await app.request('/api/settings')).json()).toMatchObject({
      agent: {
        mode: 'default',
        preset: 'claude',
        agent: 'Claude Code',
        command: 'run-claude',
        presets: [
          { id: 'claude', label: 'Claude Code', installed: true },
          { id: 'codex', label: 'Codex', installed: true },
        ],
      },
    });
    const res = await put({ preset: 'codex' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      preset: 'codex',
      agent: 'Codex',
      command: 'run-codex',
    });
    // An app setting, not a revision: it survives a restart and leaves the history alone.
    expect(store.setting('agent.preset')).toBe('codex');
    expect(store.latestRevisionId()).toBe(1);
    expect(agent.preset).toBe('codex');
  });

  it('refuses an unknown or uninstalled preset, and anything from an agent', async () => {
    const { put, agent } = chooser({ presets: { claude: 'run-claude' } });
    const unknown = await put({ preset: 'cursor' });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(await unknown.json())).toMatch(/Unknown agent/);
    const missing = await put({ preset: 'codex' });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(await missing.json())).toMatch(/isn't installed/);
    const fromAgent = await put({ preset: 'claude' }, { 'x-pharos-author': 'agent:Codex' });
    expect(fromAgent.status).toBe(403);
    expect((await put({})).status).toBe(400);
    expect(agent.preset).toBe('claude');
  });

  it('leaves the choice to the environment when PHAROS_AGENT_COMMAND is set', async () => {
    const { put, app } = chooser({ mode: 'custom' });
    const res = await put({ preset: 'claude' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/PHAROS_AGENT_COMMAND is set/);
    const status = (await (await app.request('/api/agent')).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ mode: 'custom', agent: 'Your agent', command: 'my-agent' });
    expect(status.preset).toBeUndefined();
  });

  it('ignores a saved choice that is no longer installed', () => {
    const { store, agent } = chooser({ presets: { codex: 'run-codex' } });
    store.setSetting('agent.preset', 'claude');
    expect(agent.preset).toBe('codex');
    expect(agent.status()).toMatchObject({ command: 'run-codex', agent: 'Codex' });
  });

  it('lets a run in progress finish with its agent; the next run uses the new one', async () => {
    vi.useFakeTimers();
    const { agent, calls, ask, finish } = chooser({});
    ask('What is next?');
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['run-claude']);
    expect(agent.status()).toMatchObject({ state: 'running', run: { agent: 'Claude Code' } });
    agent.setPreset('codex');
    // Still the same run, reported as such.
    expect(agent.status()).toMatchObject({ state: 'running', run: { agent: 'Claude Code' } });
    ask('And after that?');
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status().lastRun).toMatchObject({ outcome: 'finished', agent: 'Claude Code' });
    await vi.advanceTimersByTimeAsync(60);
    expect(calls).toEqual(['run-claude', 'run-codex']);
    expect(agent.status()).toMatchObject({ state: 'running', run: { agent: 'Codex' } });
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.status().lastRun).toMatchObject({ agent: 'Codex' });
  });
});
