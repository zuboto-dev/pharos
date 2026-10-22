import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { terminalCommand, terminalCwd, terminalEnv, terminalPreset } from './command.js';
import { terminalPlaceRefusal, terminalSocketRefusal } from './guard.js';
import { TerminalService } from './service.js';
import {
  TerminalSessions,
  type Pty,
  type PtySpawn,
  type TerminalClient,
  type TerminalServerMessage,
} from './sessions.js';

/** A pseudo-terminal that runs nothing: it records what it was given and echoes input. */
class FakePty implements Pty {
  static last: FakePty | undefined;
  readonly written: string[] = [];
  size: [number, number];
  killed: string[] = [];
  private data = new Set<(d: string) => void>();
  private exit = new Set<(e: { exitCode: number }) => void>();
  constructor(
    readonly pid: number,
    readonly file: string,
    readonly args: string[],
    readonly options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
  ) {
    this.size = [options.cols, options.rows];
    FakePty.last = this;
  }
  onData(fn: (d: string) => void) {
    this.data.add(fn);
  }
  onExit(fn: (e: { exitCode: number }) => void) {
    this.exit.add(fn);
  }
  emit(d: string) {
    for (const fn of this.data) fn(d);
  }
  end(code = 0) {
    for (const fn of this.exit) fn({ exitCode: code });
  }
  write(d: string) {
    this.written.push(d);
    this.emit(d);
  }
  resize(cols: number, rows: number) {
    this.size = [cols, rows];
  }
  kill(signal?: string) {
    this.killed.push(signal ?? 'SIGHUP');
  }
}

let nextPid = 1000;
const spawned: FakePty[] = [];
const fakeSpawn: PtySpawn = (file, args, options) => {
  const pty = new FakePty(nextPid++, file, args, options);
  spawned.push(pty);
  return pty;
};

function client(): TerminalClient & { got: TerminalServerMessage[] } {
  const got: TerminalServerMessage[] = [];
  return { got, send: (m) => got.push(m), close: () => {} };
}

const headers = (h: Record<string, string>) => (name: string) => h[name];

let home: string;
let store: Store;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pharos-terminal-'));
  store = new Store(openDatabase(':memory:'));
  spawned.length = 0;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function project(name = 'Garden', repositoryPath?: string): string {
  const ops: Parameters<Store['apply']>[1]['operations'] = [];
  if (repositoryPath)
    ops.push({
      op: 'create',
      type: 'repository',
      ref: 'r',
      data: { name: 'Repo', path: repositoryPath },
    });
  ops.push({
    op: 'create',
    type: 'project',
    ref: 'p',
    data: { name, status: 'active', ...(repositoryPath ? { repositoryId: '$r' } : {}) },
  });
  const revision = store.apply({ kind: 'human', name: 'me' }, { message: 'test', operations: ops });
  return revision.changes.find((c) => c.type === 'project')!.id;
}

describe('the terminal guard', () => {
  const local = { host: 'localhost:4300', origin: 'http://localhost:4300' };

  it('lets a Pharos page on this computer in', () => {
    expect(terminalSocketRefusal(headers(local))).toBeUndefined();
    expect(
      terminalSocketRefusal(headers({ host: '127.0.0.1:4300', origin: 'http://127.0.0.1:4300' })),
    ).toBeUndefined();
    expect(
      terminalSocketRefusal(headers({ host: '[::1]:4300', origin: 'http://[::1]:4300' })),
    ).toBeUndefined();
    // Vite's dev server proxies with its own host and origin.
    expect(
      terminalSocketRefusal(headers({ host: 'localhost:5173', origin: 'http://localhost:5173' })),
    ).toBeUndefined();
  });

  it('refuses the hosted address, even when a tunnel rewrites the host', () => {
    expect(
      terminalSocketRefusal(
        headers({ host: 'pharos.example.com', origin: 'https://pharos.example.com' }),
      )?.code,
    ).toBe('hosted');
    expect(
      terminalSocketRefusal(headers({ ...local, 'x-forwarded-for': '203.0.113.9' }))?.code,
    ).toBe('hosted');
    expect(
      terminalSocketRefusal(headers({ ...local, 'cf-connecting-ip': '203.0.113.9' }))?.code,
    ).toBe('hosted');
    expect(terminalPlaceRefusal(headers({ host: 'pharos.example.com' }))?.code).toBe('hosted');
  });

  it('refuses another site, another local port, and a missing origin', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:8080',
      'http://127.0.0.1:4300', // another host name than the request's
      'null',
      undefined,
    ])
      expect(
        terminalSocketRefusal(headers({ host: 'localhost:4300', ...(origin ? { origin } : {}) }))
          ?.code,
      ).toBe('origin');
  });

  it('refuses an agent author', () => {
    expect(
      terminalSocketRefusal(headers({ ...local, 'x-pharos-author': 'agent:Claude Code' }))?.code,
    ).toBe('agent');
    expect(terminalPlaceRefusal(headers({ ...local, 'x-pharos-author': 'bot' }))?.code).toBe(
      'agent',
    );
    expect(terminalPlaceRefusal(headers({ ...local, 'x-pharos-author': 'human:me' }))).toBe(
      undefined,
    );
  });
});

describe('what the terminal runs', () => {
  const target = { mcpConfigPath: '/h/.pharos/agent-mcp.json', serverUrl: 'http://localhost:4490' };

  it('runs Claude Code interactively with only this Pharos over MCP', () => {
    expect(terminalCommand('claude', target)).toEqual({
      file: 'claude',
      args: ['--mcp-config', '/h/.pharos/agent-mcp.json', '--strict-mcp-config'],
    });
  });

  it('runs Codex interactively with this Pharos as its pharos server', () => {
    expect(terminalCommand('codex', target)).toEqual({
      file: 'codex',
      args: ['-c', 'mcp_servers.pharos.url="http://localhost:4490/mcp"'],
    });
  });

  it('follows the agent chosen in Settings while it is installed', () => {
    expect(terminalPreset(store, ['claude', 'codex'])).toBe('claude');
    store.setSetting('agent.preset', 'codex');
    expect(terminalPreset(store, ['claude', 'codex'])).toBe('codex');
    expect(terminalPreset(store, ['claude'])).toBe('claude');
    expect(terminalPreset(store, [])).toBeUndefined();
  });

  it('starts in the repository folder when it exists, else a folder of its own', () => {
    const withRepo = project('Code', home);
    expect(terminalCwd(store, withRepo, join(home, 'pharos'))).toEqual({
      cwd: home,
      kind: 'repository',
    });
    const missing = project('Gone', join(home, 'not-there'));
    expect(terminalCwd(store, missing, join(home, 'pharos'))).toEqual({
      cwd: join(home, 'pharos', 'agent-home', missing),
      kind: 'home',
    });
    const plain = project('Plain');
    expect(terminalCwd(store, plain, join(home, 'pharos')).cwd).toBe(
      join(home, 'pharos', 'agent-home', plain),
    );
  });

  it('gives the agent PATH and HOME of the server, not the rest of its environment', () => {
    const env = terminalEnv(
      { PATH: '/bin', HOME: '/h', SECRET_TOKEN: 'x', PHAROS_AGENT_COMMAND: 'rm -rf /' },
      'http://localhost:4490',
    );
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', TERM: 'xterm-256color' });
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.PHAROS_AGENT_COMMAND).toBeUndefined();
  });
});

describe('terminal sessions', () => {
  const launch = () => ({
    preset: 'claude' as const,
    file: 'claude',
    args: [],
    cwd: home,
    env: { PATH: '/bin' },
  });
  const size = { cols: 80, rows: 24 };

  it('keeps one session per project, reused when the panel reopens, with its output', () => {
    const sessions = new TerminalSessions(fakeSpawn, { killGroup: () => {} });
    const first = client();
    sessions.attach('p1', launch, first, size);
    spawned[0]!.emit('Welcome to Claude Code');
    sessions.detach('p1', first);
    const again = client();
    sessions.attach('p1', launch, again, size);
    expect(spawned).toHaveLength(1);
    expect(again.got[0]).toMatchObject({ t: 'start', replay: true });
    expect(again.got[1]).toEqual({ t: 'o', d: 'Welcome to Claude Code' });
    // Another project never shares it.
    sessions.attach('p2', launch, client(), size);
    expect(spawned).toHaveLength(2);
    sessions.input('p2', 'hello');
    expect(spawned[0]!.written).toEqual([]);
    expect(spawned[1]!.written).toEqual(['hello']);
  });

  it('ends a session 30 minutes after its last panel left, killing its process group', () => {
    let now = 0;
    const killed: [number, string][] = [];
    const sessions = new TerminalSessions(fakeSpawn, {
      now: () => now,
      killGroup: (pid, signal) => killed.push([pid, signal]),
    });
    const panel = client();
    sessions.attach('p1', launch, panel, size);
    now = 60 * 60_000;
    expect(sessions.sweep()).toEqual([]); // attached: kept however long
    sessions.detach('p1', panel);
    now += 29 * 60_000;
    expect(sessions.sweep()).toEqual([]);
    now += 60_000;
    expect(sessions.sweep()).toEqual(['p1']);
    expect(killed).toContainEqual([spawned[0]!.pid, 'SIGTERM']);
    expect(sessions.get('p1')).toBeUndefined();
  });

  it('kills every session when the server stops', () => {
    const killed: [number, string][] = [];
    const sessions = new TerminalSessions(fakeSpawn, {
      killGroup: (pid, signal) => killed.push([pid, signal]),
    });
    sessions.attach('p1', launch, client(), size);
    sessions.attach('p2', launch, client(), size);
    sessions.killAll();
    expect(killed.filter(([, s]) => s === 'SIGKILL').map(([pid]) => pid)).toEqual(
      spawned.map((p) => p.pid),
    );
    expect(sessions.size).toBe(0);
  });

  it('restarts for the attached panels, and starts again after the agent exits', () => {
    const sessions = new TerminalSessions(fakeSpawn, { killGroup: () => {} });
    const panel = client();
    sessions.attach('p1', launch, panel, size);
    sessions.restart('p1', launch, size);
    expect(spawned).toHaveLength(2);
    sessions.input('p1', 'x');
    expect(spawned[1]!.written).toEqual(['x']);
    spawned[1]!.end(0);
    expect(panel.got.at(-1)).toEqual({ t: 'exit', code: 0 });
    expect(sessions.get('p1')).toBeUndefined();
    sessions.attach('p1', launch, client(), size);
    expect(spawned).toHaveLength(3);
  });

  it('never signals an agent that already exited (its pid may be another program’s by now)', () => {
    const killed: [number, string][] = [];
    const sessions = new TerminalSessions(fakeSpawn, {
      killGroup: (pid, signal) => killed.push([pid, signal]),
    });
    sessions.attach('p1', launch, client(), size);
    sessions.attach('p2', launch, client(), size);
    const [first, second] = [spawned[0]!, spawned[1]!];
    first.end(0);
    sessions.restart('p1', launch, size); // the restart button after the agent quit
    second.end(0);
    sessions.killAll(); // the server stops with an exited session still open in a panel
    const pids = killed.map(([pid]) => pid);
    expect(pids).not.toContain(first.pid);
    expect(pids).not.toContain(second.pid);
    expect(first.killed).toEqual([]);
    expect(second.killed).toEqual([]);
  });

  it('survives a panel whose connection throws', () => {
    const sessions = new TerminalSessions(fakeSpawn, { killGroup: () => {} });
    sessions.attach('p1', launch, { send: () => {}, close: () => {} }, size);
    const broken: TerminalClient = {
      send: () => {
        throw new Error('gone');
      },
      close: () => {},
    };
    sessions.get('p1')!.clients.add(broken);
    expect(() => spawned[0]!.emit('output')).not.toThrow();
  });
});

describe('the terminal routes', () => {
  let server: ServerType | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  function service(installed: { claude?: string; codex?: string } = { claude: '/usr/bin/claude' }) {
    return new TerminalService({
      store,
      installed,
      mcpConfigPath: join(home, 'agent-mcp.json'),
      serverUrl: 'http://localhost:4490',
      home: join(home, 'pharos'),
      pty: { spawn: fakeSpawn },
      killGroup: () => {},
    });
  }

  it('says whether the terminal is available here, and why not', async () => {
    const id = project();
    const app = createApp(store, undefined, undefined, {
      terminal: service(),
      webUrl: 'https://pharos.example.com',
    });
    const status = async (url: string, h: Record<string, string> = {}) => {
      const r = await app.request(url, { headers: h });
      return [r.status, await r.json()] as const;
    };
    expect(await status(`http://localhost:4300/api/projects/${id}/terminal`)).toEqual([
      200,
      { available: true, agent: { id: 'claude', label: 'Claude Code' }, running: false },
    ]);
    const [, hosted] = await status(`https://pharos.example.com/api/projects/${id}/terminal`, {
      host: 'pharos.example.com',
    });
    expect(hosted).toMatchObject({ available: false, reason: 'hosted' });
    const [code] = await status(`http://localhost:4300/api/projects/${id}/terminal`, {
      'x-pharos-author': 'agent:Codex',
    });
    expect(code).toBe(403);
    const none = createApp(store, undefined, undefined, { terminal: service({}) });
    expect(
      await (await none.request(`http://localhost:4300/api/projects/${id}/terminal`)).json(),
    ).toMatchObject({ available: false, reason: 'no-agent' });
  });

  it('refuses the socket to the hosted address, another site and an agent', async () => {
    const id = project();
    const app = createApp(store, undefined, undefined, {
      terminal: service(),
      webUrl: 'https://pharos.example.com',
    });
    const socket = (url: string, h: Record<string, string>) =>
      app.request(url, { headers: { upgrade: 'websocket', connection: 'Upgrade', ...h } });
    const path = `/api/projects/${id}/terminal/socket`;
    expect(
      (
        await socket(`https://pharos.example.com${path}`, {
          host: 'pharos.example.com',
          origin: 'https://pharos.example.com',
        })
      ).status,
    ).toBe(403);
    expect(
      (await socket(`http://localhost:4300${path}`, { origin: 'http://localhost:9999' })).status,
    ).toBe(403);
    expect(
      (
        await socket(`http://localhost:4300${path}`, {
          origin: 'http://localhost:4300',
          'x-pharos-author': 'agent:Claude Code',
        })
      ).status,
    ).toBe(403);
    expect(spawned).toHaveLength(0);
  });

  it('streams a local panel to its project’s agent, both ways', async () => {
    const id = project();
    const terminal = service();
    const app = createApp(store, undefined, undefined, { terminal });
    server = serve({
      fetch: app.fetch,
      port: 0,
      hostname: '127.0.0.1',
      websocket: { server: new WebSocketServer({ noServer: true }) },
    });
    await new Promise((resolve) => server!.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/projects/${id}/terminal/socket?cols=90&rows=20`,
      { origin: `http://127.0.0.1:${port}` },
    );
    const got: TerminalServerMessage[] = [];
    ws.on('message', (data) => got.push(JSON.parse(String(data))));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const until = async (test: () => boolean) => {
      for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 10));
    };
    await until(() => got.length > 0);
    expect(got[0]).toMatchObject({ t: 'start', agent: 'claude' });
    const pty = spawned[0]!;
    expect(pty.file).toBe('/usr/bin/claude');
    expect(pty.args).toEqual(['--mcp-config', join(home, 'agent-mcp.json'), '--strict-mcp-config']);
    expect(pty.options.cwd).toBe(join(home, 'pharos', 'agent-home', id));
    expect(pty.size).toEqual([90, 20]);
    ws.send(JSON.stringify({ t: 'i', d: 'hello' }));
    ws.send(JSON.stringify({ t: 'r', cols: 120, rows: 40 }));
    await until(() => got.some((m) => m.t === 'o'));
    expect(pty.written).toEqual(['hello']);
    expect(got).toContainEqual({ t: 'o', d: 'hello' });
    await until(() => pty.size[0] === 120);
    expect(pty.size).toEqual([120, 40]);
    // A command from the client is never run: anything but input, a size or a restart closes it.
    ws.send(JSON.stringify({ t: 'run', file: '/bin/sh' }));
    await new Promise((resolve) => ws.once('close', resolve));
    expect(spawned).toHaveLength(1);
    await until(() => terminal.sessions!.get(id)!.clients.size === 0);
    expect(terminal.sessions!.get(id)!.clients.size).toBe(0);
  });
});
