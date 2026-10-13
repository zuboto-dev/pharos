import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PRESENCE_TTL_MS, type Author, type PresenceState } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner, shellRunner, type Runner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { Presence, changedWidgets, watchAgentRevisions } from './presence.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const person: Author = { kind: 'human', name: 'me' };

afterEach(() => {
  vi.useRealTimers();
});

function project(store: Store, name = 'A') {
  return store.apply(person, {
    message: `Create ${name}`,
    operations: [{ op: 'create', type: 'project', data: { name } }],
  }).created['0']!;
}

const places = (state: PresenceState) =>
  state.entries.map((e) => [e.agent, e.viewId ?? '-', e.widgetId ?? '-', e.activity].join(' '));

describe('Presence', () => {
  it('expires a mark about 20 s after the last call, and tells its listeners', () => {
    vi.useFakeTimers();
    const presence = new Presence();
    const seen: PresenceState[] = [];
    presence.subscribe((s) => seen.push(s));
    presence.touch('claude-code', { projectId: 'p', viewId: 'v', activity: 'editing' });
    expect(presence.state().entries).toMatchObject([
      { agent: 'Claude Code', projectId: 'p', viewId: 'v', expiresInMs: PRESENCE_TTL_MS },
    ]);
    vi.advanceTimersByTime(PRESENCE_TTL_MS - 1000);
    expect(presence.state().entries).toHaveLength(1);
    vi.advanceTimersByTime(1100);
    expect(presence.state().entries).toEqual([]);
    // The last event the browsers got clears the mark: nothing is left behind.
    expect(seen.at(-1)).toEqual({ entries: [] });
    presence.dispose();
  });

  it('renews a mark on every call', () => {
    vi.useFakeTimers();
    const presence = new Presence();
    presence.touch('a', { projectId: 'p', viewId: 'v', activity: 'viewing' });
    vi.advanceTimersByTime(15_000);
    presence.touch('a', { projectId: 'p', viewId: 'v', activity: 'editing' });
    vi.advanceTimersByTime(15_000);
    expect(presence.state().entries).toMatchObject([{ activity: 'editing' }]);
    vi.advanceTimersByTime(6_000);
    expect(presence.state().entries).toEqual([]);
    presence.dispose();
  });

  it('keeps a held mark until it is released, and a touch never shortens it', () => {
    vi.useFakeTimers();
    const presence = new Presence();
    const release = presence.hold('Claude Code', { projectId: 'p', activity: 'answering' }, 'run');
    presence.touch('claude-code', { projectId: 'p', activity: 'working' }, 'mcp');
    vi.advanceTimersByTime(PRESENCE_TTL_MS * 5);
    expect(presence.state().entries).toEqual([
      expect.objectContaining({ agent: 'Claude Code', activity: 'answering' }),
    ]);
    expect(presence.state().entries[0]).not.toHaveProperty('expiresInMs');
    release();
    expect(presence.state().entries).toEqual([]);
    presence.dispose();
  });

  it('clears everything a source marked when it stops', () => {
    const presence = new Presence();
    presence.touch('a', { projectId: 'p', viewId: 'v', activity: 'editing' }, 's1');
    presence.touch('a', { projectId: 'p', viewId: 'v', widgetId: 'w', activity: 'editing' }, 's1');
    presence.touch('b', { projectId: 'p', activity: 'working' }, 's2');
    presence.clearSource('s1');
    expect(places(presence.state())).toEqual(['b - - working']);
    presence.dispose();
  });

  it('keeps going when a listener throws', () => {
    const presence = new Presence();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    presence.subscribe(() => {
      throw new Error('closed stream');
    });
    presence.subscribe((s) => seen.push(s.entries.length));
    presence.touch('a', { projectId: 'p', activity: 'working' });
    expect(seen).toEqual([1]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    presence.dispose();
  });
});

describe('changedWidgets', () => {
  const board = (...widgets: { id: string; text: string }[]) => ({
    component: 'Board',
    widgets: widgets.map((w) => ({ id: w.id, node: { component: 'Text', text: w.text } })),
  });
  it('names added and changed blocks, not unchanged or removed ones', () => {
    expect(
      changedWidgets(
        board({ id: 'a', text: '1' }, { id: 'b', text: '2' }, { id: 'gone', text: '3' }),
        board({ id: 'a', text: '1' }, { id: 'b', text: 'two' }, { id: 'new', text: '4' }),
      ),
    ).toEqual(['b', 'new']);
  });
  it('treats a missing spec as empty', () => {
    expect(changedWidgets(null, board({ id: 'a', text: '1' }))).toEqual(['a']);
    expect(changedWidgets(board({ id: 'a', text: '1' }), null)).toEqual([]);
  });
});

describe('presence from revisions', () => {
  it("marks an agent's project, view and changed blocks, but not a person's", () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const presence = new Presence();
    watchAgentRevisions(store, feed, presence);
    const projectId = project(store);
    expect(presence.state().entries).toEqual([]);
    const agent: Author = { kind: 'agent', name: 'claude-code' };
    const viewId = store.apply(agent, {
      message: 'A view',
      operations: [
        {
          op: 'create',
          type: 'view',
          data: {
            projectId,
            name: 'V',
            spec: {
              component: 'Board',
              widgets: [{ id: 'note', node: { component: 'Text', content: 'Hi' } }],
            },
          },
        },
      ],
    }).created['0']!;
    expect(places(presence.state()).sort()).toEqual([
      `Claude Code - - working`,
      `Claude Code ${viewId} - editing`,
      `Claude Code ${viewId} note editing`,
    ]);
    presence.dispose();
  });
});

describe('presence over MCP', () => {
  async function connect(app: ReturnType<typeof createApp>, name = 'claude-code') {
    const client = new Client({ name, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
      fetch: async (url, init) => app.fetch(new Request(url, init)),
    });
    await client.connect(transport);
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      if (result.isError) throw new Error(text);
      return JSON.parse(text);
    };
    return { call, transport };
  }

  it('marks the view and the block a view tool works on, and clears them when the agent stops', async () => {
    const store = new Store(openDatabase(':memory:'));
    const presence = new Presence();
    const app = createApp(store, new RevisionFeed(store, 0), undefined, { presence });
    const projectId = project(store);
    const { call, transport } = await connect(app);
    const made = await call('view_create', {
      projectId,
      name: 'Board',
      message: 'A board',
      widgets: [{ id: 'note', node: { component: 'Text', content: 'Hello' } }],
    });
    const viewId = made.view.id as string;
    presence.clearSource(`revisions:Claude Code`); // only what the tools themselves mark, below
    for (const e of presence.state().entries) expect(e.agent).toBe('Claude Code');

    await call('view_preview', { viewId });
    expect(presence.state().entries).toContainEqual(
      expect.objectContaining({ viewId, activity: 'viewing' }),
    );
    await call('view_update', {
      viewId,
      message: 'Edit the note',
      ops: [{ op: 'update', id: 'note', set: { content: 'Hello again' } }],
    });
    expect(presence.state().entries).toContainEqual(
      expect.objectContaining({ viewId, widgetId: 'note', activity: 'editing' }),
    );
    // Over REST too: the browsers can read it.
    const res = await app.fetch(new Request('http://localhost:4300/api/presence'));
    expect(((await res.json()) as PresenceState).entries.length).toBeGreaterThan(0);

    await transport.terminateSession();
    expect(presence.state().entries).toEqual([]);
    presence.dispose();
  });
});

describe('presence from the answering run', () => {
  function setup(runner: Runner) {
    const store = new Store(openDatabase(':memory:'));
    const presence = new Presence();
    const agent = new AgentRunner(store, { command: 'answer', runner, batchMs: 10, presence });
    agent.watch(new RevisionFeed(store, 0));
    const projectId = project(store);
    store.apply(person, {
      message: 'Ask',
      operations: [{ op: 'create', type: 'request', data: { projectId, question: 'What now?' } }],
    });
    return { store, presence, agent, projectId };
  }

  it('marks the project while the run lasts, and clears it when the run finishes', async () => {
    let finish: () => void = () => {};
    const { presence, projectId } = setup(
      () => new Promise((r) => (finish = () => r({ exitCode: 0, timedOut: false }))),
    );
    await vi.waitFor(() =>
      expect(presence.state().entries).toEqual([
        expect.objectContaining({ agent: 'Claude Code', projectId, activity: 'answering' }),
      ]),
    );
    // What its agent marked over MCP during the run goes with it.
    presence.touch('claude-code', { projectId, viewId: 'v', activity: 'editing' }, 'mcp:x');
    finish();
    await vi.waitFor(() => expect(presence.state().entries).toEqual([]));
    presence.dispose();
  });

  it('clears the mark when the run fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail: () => void = () => {};
    const { presence } = setup(
      () => new Promise((_, reject) => (fail = () => reject(new Error('no')))),
    );
    await vi.waitFor(() => expect(presence.state().entries).toHaveLength(1));
    fail();
    await vi.waitFor(() => expect(presence.state().entries).toEqual([]));
    errors.mockRestore();
    presence.dispose();
  });

  it('stops the run when answering is paused, so the mark clears', async () => {
    let signal: AbortSignal | undefined;
    const { presence, agent } = setup(
      (_c, _e, _t, s) =>
        new Promise((resolve) => {
          signal = s;
          s?.addEventListener('abort', () => resolve({ exitCode: null, timedOut: false }));
        }),
    );
    await vi.waitFor(() => expect(presence.state().entries).toHaveLength(1));
    agent.setEnabled(false);
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(presence.state().entries).toEqual([]));
    expect(agent.status()).toMatchObject({ running: false, lastRun: { stopped: true } });
    presence.dispose();
  });
});

describe('shellRunner', () => {
  it('stops the command when the run is aborted (answering paused)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pharos-runner-'));
    const log = join(dir, 'agent.log');
    const stop = new AbortController();
    const started = Date.now();
    const running = shellRunner(log)('sleep 30', {}, 60_000, stop.signal);
    setTimeout(() => stop.abort(), 100);
    const result = await running;
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.timedOut).toBe(false);
    expect(readFileSync(log, 'utf8')).toContain('stopped: answering was paused');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('clearing a finished run (v0.2 review, gap 12)', () => {
  it("clears only the named agent's marks since the run started", () => {
    let now = 5_000;
    const presence = new Presence({ now: () => now });
    presence.touch('Claude Code', { projectId: 'p1', activity: 'working' }, 'mcp:a');
    now += 1;
    presence.touch('Codex', { projectId: 'p1', activity: 'editing' }, 'mcp:b');
    presence.clearProjects(['p1'], 5_000, 'Claude Code');
    expect(presence.state().entries.map((e) => e.agent)).toEqual(['Codex']);
    presence.dispose();
  });
});
