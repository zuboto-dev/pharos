import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentsOverview, Author, PharosNotification } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentsOverview } from './agents.js';
import { createApp } from './app.js';
import { RunLog } from './desk.js';
import { RevisionFeed } from './feed.js';
import { LookupLog } from './lookups.js';
import { Notifications, answeredNotifies } from './notifications.js';
import { Presence } from './presence.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { TURN_ROUTE, terminalCommand, terminalHookSettings } from './terminal/command.js';
import { TerminalService } from './terminal/service.js';
import type { Pty, PtySpawn, TerminalClient } from './terminal/sessions.js';

const me: Author = { kind: 'human', name: 'me' };

class FakePty implements Pty {
  readonly pid = 4242;
  private data = new Set<(d: string) => void>();
  private exits = new Set<(e: { exitCode: number }) => void>();
  constructor(
    readonly args: string[],
    readonly env: Record<string, string>,
  ) {}
  onData(fn: (d: string) => void) {
    this.data.add(fn);
  }
  onExit(fn: (e: { exitCode: number }) => void) {
    this.exits.add(fn);
  }
  emit(d: string) {
    for (const fn of this.data) fn(d);
  }
  write() {}
  resize() {}
  kill() {}
}

let home: string;
let store: Store;
let clock: number;
let spawned: FakePty[];
const spawn: PtySpawn = (_file, args, options) => {
  const pty = new FakePty(args, options.env);
  spawned.push(pty);
  return pty;
};
const panel = (): TerminalClient => ({ send: () => {}, close: () => {} });
const size = { cols: 80, rows: 24 };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pharos-agents-'));
  store = new Store(openDatabase(':memory:'));
  clock = Date.now();
  spawned = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function project(name: string): string {
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name } }],
  });
  return created.p!;
}

function service(installed: { claude?: string; codex?: string } = { claude: '/usr/bin/claude' }) {
  return new TerminalService({
    store,
    installed,
    mcpConfigPath: join(home, 'agent-mcp.json'),
    hookSettingsPath: join(home, 'terminal-settings.json'),
    serverUrl: 'http://localhost:4490',
    home: join(home, 'pharos'),
    pty: { spawn },
    killGroup: () => {},
    now: () => clock,
  });
}

function center() {
  return new Notifications(store, new RunLog(store), () => new Date(clock));
}

describe('the Stop hook', () => {
  it('Claude Code gets the hook settings for its session only; Codex does not', () => {
    expect(
      terminalCommand('claude', {
        mcpConfigPath: '/h/mcp.json',
        serverUrl: 'http://localhost:4490',
        settingsPath: '/h/terminal-settings.json',
      }).args,
    ).toEqual([
      '--mcp-config',
      '/h/mcp.json',
      '--strict-mcp-config',
      '--settings',
      '/h/terminal-settings.json',
    ]);
    const settings = JSON.parse(terminalHookSettings()) as {
      hooks: { Stop: { hooks: { type: string; command: string }[] }[] };
    };
    const hook = settings.hooks.Stop[0]!.hooks[0]!;
    expect(hook.type).toBe('command');
    expect(hook.command).toContain(`"$PHAROS_URL${TURN_ROUTE}"`);
    expect(hook.command).toContain('x-pharos-terminal: $PHAROS_TERMINAL_TOKEN');
    expect(hook.command).toContain('--data-binary @-');
    expect(hook.command).toMatch(/\|\| true$/);

    const terminal = service({ claude: '/usr/bin/claude', codex: '/usr/bin/codex' });
    const id = project('Tutti');
    terminal.attach(id, panel(), size);
    expect(spawned[0]!.args).toContain('--settings');
    expect(spawned[0]!.env.PHAROS_TERMINAL_TOKEN).toMatch(/^[0-9a-f]{32}$/);
    store.setSetting('agent.preset', 'codex');
    const codex = service({ claude: '/usr/bin/claude', codex: '/usr/bin/codex' });
    expect(codex.launch(project('Other')).hooked).toBe(false);
  });

  it('the route ends the turn of the session with that token, and refuses others', async () => {
    const terminal = service();
    const id = project('Tutti');
    const notifications = center();
    const app = createApp(store, new RevisionFeed(store, 0), undefined, {
      terminal,
      notifications,
    });
    notifications.watch(new RevisionFeed(store, 0), { terminal: terminal.sessions! });
    const got: PharosNotification[] = [];
    notifications.subscribe((n) => got.push(n));
    const client = panel();
    terminal.attach(id, client, size);
    const token = spawned[0]!.env.PHAROS_TERMINAL_TOKEN!;
    terminal.sessions!.detach(terminal.key(id), client);
    const post = (headers: Record<string, string>, body: object = { hook_event_name: 'Stop' }) =>
      app.request(TURN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ session_id: 'abc', cwd: home, ...body }),
      });
    expect((await post({ 'x-pharos-terminal': 'nope' })).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect((await post({ 'x-pharos-terminal': token, 'x-forwarded-for': '1.2.3.4' })).status).toBe(
      403,
    );
    expect(got).toEqual([]);
    const ok = await post({ 'x-pharos-terminal': token });
    expect(ok.status).toBe(200);
    expect(got.map((n) => [n.kind, n.title, n.href, n.action])).toEqual([
      ['agent-answered', 'Claude Code answered in Tutti', `/projects/${id}?terminal=1`, 'Open'],
    ]);
    // Another hook event is ignored.
    clock += 1000;
    await post({ 'x-pharos-terminal': token }, { hook_event_name: 'SubagentStop' });
    expect(got).toHaveLength(1);
    notifications.stop();
  });
});

describe('the answered rule', () => {
  it('notifies only when no visible panel shows it and the owner is not typing', () => {
    expect(answeredNotifies({ watched: false, typing: false })).toBe(true);
    expect(answeredNotifies({ watched: true, typing: false })).toBe(false);
    expect(answeredNotifies({ watched: false, typing: true })).toBe(false);

    const terminal = service();
    const id = project('Tutti');
    const notifications = center();
    const got: PharosNotification[] = [];
    terminal.sessions!.onTurn((turn) => {
      const n = notifications.agentAnswered(turn);
      if (n) got.push(n);
    });
    const client = panel();
    const session = terminal.attach(id, client, size);
    const key = session.key;
    // Watched in a visible tab: nothing.
    terminal.hookTurn(session.launch.env.PHAROS_TERMINAL_TOKEN!);
    expect(got).toHaveLength(0);
    // The tab went to the background: it notifies.
    terminal.sessions!.visibility(key, client, false);
    clock += 1000;
    terminal.hookTurn(session.launch.env.PHAROS_TERMINAL_TOKEN!);
    expect(got).toHaveLength(1);
    // Typing in the panel a moment ago (a hidden tab still gets keys, e.g. a paste): nothing.
    terminal.sessions!.input(key, 'y');
    clock += 2000;
    terminal.hookTurn(session.launch.env.PHAROS_TERMINAL_TOKEN!);
    expect(got).toHaveLength(1);
    // Sending a message is not typing: a quick answer in the hidden tab still notifies.
    clock += 10_000;
    terminal.sessions!.input(key, 'Reply with hello\r');
    clock += 2000;
    terminal.hookTurn(session.launch.env.PHAROS_TERMINAL_TOKEN!);
    expect(got).toHaveLength(2);
    // Some seconds later, no panel at all: it notifies again (a new turn, a new notification).
    clock += 10_000;
    terminal.sessions!.detach(key, client);
    terminal.hookTurn(session.launch.env.PHAROS_TERMINAL_TOKEN!);
    expect(got).toHaveLength(3);
    expect(got[2]!.kind).toBe('agent-answered');
  });

  it('agents without a hook (Codex): output quiet after the owner sent something ends the turn', () => {
    store.setSetting('agent.preset', 'codex');
    const terminal = service({ codex: '/usr/bin/codex' });
    const id = project('Tutti');
    const notifications = center();
    const got: PharosNotification[] = [];
    terminal.sessions!.onTurn((turn) => {
      const n = notifications.agentAnswered(turn);
      if (n) got.push(n);
    });
    const client = panel();
    const session = terminal.attach(id, client, size);
    terminal.sessions!.detach(session.key, client);
    // Output with nothing asked (its start screen) is no turn.
    spawned[0]!.emit('Codex ready');
    clock += 20_000;
    expect(terminal.sessions!.checkQuiet()).toEqual([]);
    expect(session.state(clock).state).toBe('idle');
    terminal.sessions!.input(session.key, 'fix the bug\r');
    clock += 1000;
    spawned[0]!.emit('Working…');
    expect(session.state(clock).state).toBe('working');
    clock += 3000;
    expect(terminal.sessions!.checkQuiet()).toEqual([]);
    clock += 6000;
    expect(terminal.sessions!.checkQuiet()).toHaveLength(1);
    expect(session.state(clock).state).toBe('waiting');
    expect(got.map((n) => n.title)).toEqual(['Codex answered in Tutti']);
    // Once only for that turn.
    clock += 10_000;
    expect(terminal.sessions!.checkQuiet()).toEqual([]);
  });
});

describe('GET /api/agents', () => {
  it('lists panels, connected agents, answering and routine runs, with the counts', async () => {
    const terminal = service();
    const tutti = project('Tutti');
    const garden = project('Garden');
    const presence = new Presence({ now: () => clock });
    const runs = new RunLog(store, () => new Date(clock));
    const lookups = new LookupLog(store, () => new Date(clock));
    const app = createApp(store, new RevisionFeed(store, 0), undefined, { terminal, presence });

    // A panel working, then one waiting for the owner.
    const a = terminal.attach(tutti, panel(), size);
    terminal.sessions!.input(a.key, 'go\r');
    spawned[0]!.emit('thinking');
    // An MCP agent on a view now; another wrote a revision and looked something up earlier.
    presence.touch('codex', { projectId: garden, activity: 'viewing' });
    store.apply(
      { kind: 'agent', name: 'night-runner' },
      {
        message: 'Watered the tomatoes',
        operations: [
          { op: 'create', type: 'task', ref: 't', data: { projectId: garden, title: 'Water' } },
        ],
      },
    );
    lookups.record('claude-code', 'project_snapshot', { projectId: tutti });
    runs.report({ kind: 'agent', name: 'Routines' }, { name: 'Morning brief', kind: 'routine' });
    runs.report(
      { kind: 'agent', name: 'Routines' },
      { name: 'Done', kind: 'routine', outcome: 'ok' },
    );

    const overview = agentsOverview({
      store,
      presence,
      runs,
      lookups,
      panels: () => terminal.panels(clock),
      now: new Date(clock),
      local: true,
    });
    expect(overview.panels).toHaveLength(1);
    expect(overview.panels[0]).toMatchObject({
      agent: 'Claude Code',
      projects: [{ id: tutti, name: 'Tutti' }],
      state: 'working',
      watched: true,
      cwd: a.launch.cwd,
    });
    // Its revision just now marks the night runner live too (presence from revisions).
    expect(overview.connected.map((c) => [c.agent, c.live])).toEqual([
      ['night-runner', true],
      ['Codex', true],
      ['Claude Code', false],
    ]);
    expect(overview.connected.find((c) => c.agent === 'night-runner')).toMatchObject({
      projects: [{ id: garden, name: 'Garden' }],
      last: { kind: 'revision', text: 'Watered the tomatoes', projectId: garden },
    });
    expect(overview.connected.find((c) => c.agent === 'Claude Code')?.last).toMatchObject({
      kind: 'lookup',
      text: 'Looked up “Tutti”',
    });
    expect(overview.runs.map((r) => r.name)).toEqual(['Morning brief']);
    // 1 panel + 2 live agents + 1 routine working; the one that only looked something up idle.
    expect(overview.counts).toEqual({ working: 4, waiting: 0, idle: 1 });

    // The turn ends: waiting for you. Later, the old marks and revisions fall out of the window.
    terminal.hookTurn(a.launch.env.PHAROS_TERMINAL_TOKEN!);
    const res = await app.request('/api/agents');
    const live = (await res.json()) as AgentsOverview;
    expect(live.panels[0]!.state).toBe('waiting');
    expect(live.counts.waiting).toBe(1);
    expect(live.local).toBe(true);

    // Agents may read it, without the panels' folders.
    const asAgent = (await (
      await app.request('/api/agents', { headers: { 'x-pharos-author': 'agent:Codex' } })
    ).json()) as AgentsOverview;
    expect(asAgent.panels[0]!.cwd).toBeUndefined();
    expect(asAgent.local).toBe(false);
    presence.dispose();
  });
});
