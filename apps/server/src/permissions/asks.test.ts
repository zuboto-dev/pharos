import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import type {
  PermissionAsk,
  PermissionAskDecision,
  PermissionPreview,
  NotificationList,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { PermissionAsks, isUnattended } from './asks.js';
import { PermissionService } from './service.js';

// Live asks from the Claude Code PermissionRequest hook, with made-up hook input, a temp home and
// temp project folders. Nothing here reads or writes the real ~/.claude.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const HOOK = join(ROOT, 'agents', 'claude', 'hooks', 'permission-ask.mjs');
const SETUP = join(ROOT, 'scripts', 'agents-setup.mjs');

let base: string;
let home: string;
let claudeHome: string;
let repo: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let projectId: string;

const OWNER = {
  origin: 'http://localhost',
  'sec-fetch-site': 'same-origin',
  'x-pharos-author': 'human:me',
};

function hookInput(extra: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    cwd: join(repo, '.claude', 'worktrees', 'night'),
    hook_event_name: 'PermissionRequest',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: 'npx pnpm@12.9.1 test 2>&1 | tail -5', description: 'Run tests' },
    ...extra,
  };
}

async function report(input: unknown, headers: Record<string, string> = {}) {
  return app.request('http://localhost/api/permission-asks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(input),
  });
}

async function owner(method: string, path: string, body?: unknown, headers = OWNER) {
  return app.request(`http://localhost/api/permissions${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function created(input: unknown = hookInput()): Promise<string> {
  const res = await report(input);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function waitFor(id: string, ms = 2000): Promise<PermissionAskDecision> {
  const res = await app.request(`http://localhost/api/permission-asks/${id}/wait?ms=${ms}`);
  return (await res.json()) as PermissionAskDecision;
}

function makeApp(waitMs = 60_000) {
  const service = new PermissionService(store, { home, claudeHome });
  app = createApp(store, undefined, undefined, {
    folders: { home },
    permissions: service,
    permissionAsks: (s, onAsk) => new PermissionAsks(s, { onAsk }, waitMs),
  });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-asks-')));
  home = join(base, 'home');
  claudeHome = join(home, '.claude');
  repo = join(home, 'code', 'shop');
  mkdirSync(repo, { recursive: true });
  store = new Store(openDatabase(':memory:'));
  const result = store.apply({ kind: 'human', name: 'me' }, {
    message: 'test',
    operations: [
      { op: 'create', type: 'repository', ref: 'r', data: { name: 'shop', path: repo } },
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Shop site', repositoryId: '$r' } },
    ],
  } as never);
  projectId = (result as { created: Record<string, string> }).created.p!;
  makeApp();
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('live permission asks', () => {
  it('explains an ask: project, agent, command, plain words and risk; and notifies', async () => {
    // The session's transcript says which routine started it.
    const transcript = join(claudeHome, 'projects', 'x', 's1.jsonl');
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'user', entrypoint: 'cli', message: { content: '<command-name>/triage</command-name>' } })}\n`,
    );
    const id = await created(hookInput({ transcript_path: transcript }));
    const asks = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(asks[0]).toMatchObject({
      id,
      status: 'waiting',
      folder: repo,
      displayFolder: '~/code/shop',
      projects: ['Shop site'],
      projectId,
      agent: '/triage',
      tool: 'Bash',
      example: 'npx pnpm@12.9.1 test 2>&1',
      rule: 'Bash(npx pnpm@12.9.1 test:*)',
      summary: 'Runs the project’s tests',
      risk: 'low',
      canAlwaysAllow: true,
    });
    const list = (await (
      await app.request('http://localhost/api/notifications')
    ).json()) as NotificationList;
    expect(list.items[0]).toMatchObject({
      kind: 'desk',
      gate: true,
      title: 'Shop site: an agent asks permission. Runs the project’s tests',
      href: '/settings#permissions',
      projectId,
    });
  });

  it('reads only Claude Code’s own transcripts for the agent', async () => {
    const elsewhere = join(base, 'secret.jsonl');
    writeFileSync(elsewhere, '<command-name>/leak</command-name>\n');
    await created(hookInput({ transcript_path: elsewhere }));
    const [ask] = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(ask!.agent).toBe('a Claude Code session');
  });

  it('answers the hook: once, deny, or in the terminal', async () => {
    for (const [answer, expected] of [
      ['once', { status: 'allowed_once', behavior: 'allow' }],
      ['deny', { status: 'denied', behavior: 'deny' }],
      ['terminal', { status: 'terminal' }],
    ] as const) {
      const id = await created();
      const waiting = waitFor(id);
      const res = await owner('POST', `/asks/${id}/answer`, { answer });
      expect(res.status, answer).toBe(200);
      const decision = await waiting;
      expect(decision).toMatchObject(expected);
      if (answer === 'terminal') expect(decision.behavior).toBeUndefined();
    }
  });

  it('Allow always shows the change, writes it with a backup, and the call runs', async () => {
    const local = join(repo, '.claude', 'settings.local.json');
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }));
    const id = await created();
    const preview = (await (
      await owner('POST', `/asks/${id}/preview`, { target: 'local' })
    ).json()) as PermissionPreview;
    expect(preview).toMatchObject({
      path: local,
      after: { allow: ['Bash(ls:*)', 'Bash(npx pnpm@12.9.1 test:*)'] },
    });
    const waiting = waitFor(id);
    const res = await owner('POST', `/asks/${id}/answer`, {
      answer: 'always',
      target: 'local',
      hash: preview.hash,
    });
    expect(res.status).toBe(200);
    const ask = (await res.json()) as PermissionAsk;
    expect(ask.status).toBe('allowed_always');
    expect(ask.record?.backup).toMatch(/pharos-backup-/);
    expect(await waiting).toMatchObject({ behavior: 'allow' });
    expect(JSON.parse(readFileSync(local, 'utf8')).permissions.allow).toContain(
      'Bash(npx pnpm@12.9.1 test:*)',
    );
    // The same Undo as the page.
    expect((await owner('POST', '/undo', { id: ask.record!.id })).status).toBe(200);
    expect(JSON.parse(readFileSync(local, 'utf8')).permissions.allow).toEqual(['Bash(ls:*)']);
  });

  it('never keeps a rule for deny-only commands, nor outside a project folder', async () => {
    const id = await created(hookInput({ tool_input: { command: 'rm -rf dist' } }));
    const [ask] = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(ask).toMatchObject({ allowable: false, canAlwaysAllow: false, risk: 'high' });
    expect((await owner('POST', `/asks/${id}/preview`, {})).status).toBe(400);
    const always = await owner('POST', `/asks/${id}/answer`, {
      answer: 'always',
      hash: 'x',
    });
    expect(always.status).toBe(400);
    expect(existsSync(join(repo, '.claude'))).toBe(false);
    // Once is the owner's call, for this one command.
    expect((await owner('POST', `/asks/${id}/answer`, { answer: 'once' })).status).toBe(200);

    const homeAsk = await created(hookInput({ cwd: home }));
    const asks = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(asks.find((a) => a.id === homeAsk)?.canAlwaysAllow).toBe(false);
  });

  it('only the owner answers, and browsers can’t report asks', async () => {
    const id = await created();
    const agent = await owner(
      'POST',
      `/asks/${id}/answer`,
      { answer: 'once' },
      {
        ...OWNER,
        'x-pharos-author': 'agent:Claude Code',
      },
    );
    expect(agent.status).toBe(403);
    const noHeader = await owner('POST', `/asks/${id}/answer`, { answer: 'once' }, {
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
    } as typeof OWNER);
    expect(noHeader.status).toBe(403);
    expect(
      (await owner('GET', '/asks', undefined, { ...OWNER, 'x-pharos-author': 'agent:x' })).status,
    ).toBe(403);
    const browser = await report(hookInput(), { origin: 'http://localhost' });
    expect(browser.status).toBe(403);
    const site = await report(hookInput(), { 'sec-fetch-site': 'cross-site' });
    expect(site.status).toBe(403);
    expect((await waitFor(id, 10)).status).toBe('waiting');
  });

  it('expires when the hook stops waiting', async () => {
    makeApp(50);
    const id = await created();
    expect(await waitFor(id, 1000)).toMatchObject({ status: 'waiting' });
    await new Promise((r) => setTimeout(r, 1200));
    expect(await waitFor(id, 10)).toMatchObject({ status: 'expired' });
    expect((await owner('POST', `/asks/${id}/answer`, { answer: 'once' })).status).toBe(400);
  });
});

/** Runs the hook script with this stdin and environment; resolves with its exit and output. */
function runHook(stdin: unknown, env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string }>((done) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { PATH: process.env.PATH ?? '', HOME: home, ...env },
    });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('exit', (code) => done({ code, stdout }));
    child.stdin.end(JSON.stringify(stdin));
  });
}

describe('the hook script', () => {
  let server: ServerType | undefined;
  afterEach(() => server?.close());

  async function listen(): Promise<string> {
    return new Promise((ready) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) =>
        ready(`http://127.0.0.1:${info.port}`),
      );
    });
  }

  it('returns the owner’s Allow to Claude Code', async () => {
    const url = await listen();
    const run = runHook(hookInput(), { PHAROS_URL: url, PHAROS_ASK_WAIT: '10' });
    let ask: PermissionAsk | undefined;
    for (let i = 0; i < 50 && !ask; i++) {
      await new Promise((r) => setTimeout(r, 50));
      ask = ((await (await owner('GET', '/asks')).json()) as PermissionAsk[])[0];
    }
    expect(ask?.expiresAt).toBeTruthy();
    await owner('POST', `/asks/${ask!.id}/answer`, { answer: 'once' });
    const { code, stdout } = await run;
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });

  it('returns a Deny with a message', async () => {
    const url = await listen();
    const run = runHook(hookInput(), { PHAROS_URL: url, PHAROS_ASK_WAIT: '10' });
    let ask: PermissionAsk | undefined;
    for (let i = 0; i < 50 && !ask; i++) {
      await new Promise((r) => setTimeout(r, 50));
      ask = ((await (await owner('GET', '/asks')).json()) as PermissionAsk[])[0];
    }
    await owner('POST', `/asks/${ask!.id}/answer`, { answer: 'deny' });
    const { code, stdout } = await run;
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { decision: { behavior: string; message: string } };
    };
    expect(out.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(out.hookSpecificOutput.decision.message).toMatch(/denied this in Pharos/);
  });

  it('leaves the prompt to Claude Code when Pharos is down, times out, or isn’t local', async () => {
    const down = await runHook(hookInput(), {
      PHAROS_URL: 'http://127.0.0.1:9',
      PHAROS_ASK_WAIT: '5',
    });
    expect(down).toEqual({ code: 2, stdout: '' });
    const url = await listen();
    const quiet = await runHook(hookInput(), { PHAROS_URL: url, PHAROS_ASK_WAIT: '1' });
    expect(quiet).toEqual({ code: 2, stdout: '' });
    const remote = await runHook(hookInput(), { PHAROS_URL: 'https://example.com' });
    expect(remote).toEqual({ code: 2, stdout: '' });
    const broken = await runHook('not json', { PHAROS_URL: url });
    expect(broken).toEqual({ code: 2, stdout: '' });
  }, 20_000);
});

describe('pnpm agents install / remove (the hook)', () => {
  function setup(command: string) {
    return new Promise<string>((done) => {
      const child = spawn(process.execPath, [SETUP, command], {
        env: {
          PATH: process.env.PATH ?? '',
          HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          CODEX_HOME: join(home, '.codex'),
        },
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('exit', () => done(out));
    });
  }

  it('adds the hook after a backup, keeps everything else, and removes only its own', async () => {
    mkdirSync(claudeHome, { recursive: true });
    const settings = join(claudeHome, 'settings.json');
    const before = {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }],
      },
    };
    writeFileSync(settings, JSON.stringify(before));
    expect(await setup('install')).toMatch(/permission and session-note hooks added/);
    const installed = JSON.parse(readFileSync(settings, 'utf8'));
    expect(installed.permissions).toEqual(before.permissions);
    // Your own Stop hook stays first; the session-note hook is added after it.
    expect(installed.hooks.Stop).toEqual([
      before.hooks.Stop[0],
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `node "${HOOK.replace('permission-ask.mjs', 'session-note.mjs')}"`,
            timeout: 10,
          },
        ],
      },
    ]);
    expect(installed.hooks.PermissionRequest).toEqual([
      before.hooks.PermissionRequest[0],
      {
        matcher: '*',
        hooks: [{ type: 'command', command: `node "${HOOK}"`, timeout: 120 }],
      },
    ]);
    expect(readdirSync(claudeHome).filter((n) => n.includes('pharos-backup-'))).toHaveLength(1);
    expect(await setup('install')).toMatch(/permission and session-note hooks already current/);
    expect(await setup('status')).toMatch(/permission hook: installed, current/);
    expect(await setup('status')).toMatch(/session-note hook: installed, current/);
    expect(await setup('remove')).toMatch(/permission and session-note hooks removed/);
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual(before);
    expect(await setup('remove')).toMatch(/no Pharos hooks/);
  });
});

describe('unattended sessions', () => {
  function session(name: string, lines: object[]) {
    const file = join(claudeHome, 'projects', 'x', `${name}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return file;
  }
  const routine = (name: string, entrypoint = 'cli') => ({
    type: 'user',
    entrypoint,
    message: { content: `<command-name>/${name}</command-name>` },
  });

  it('tells which sessions nobody watches', () => {
    expect(isUnattended({ permission_mode: 'dontAsk' }, undefined)).toBe(true);
    expect(isUnattended({ entrypoint: 'sdk-cli' }, undefined)).toBe(true);
    expect(isUnattended({}, { headless: true })).toBe(true);
    expect(isUnattended({}, { headless: false, routine: '/nightshift' })).toBe(true);
    expect(isUnattended({}, { headless: false, routine: '/wrapup' })).toBe(true);
    expect(isUnattended({}, { headless: false, routine: '/daybreak' })).toBe(true);
    // When unsure: interactive.
    expect(isUnattended({ entrypoint: 'cli', permission_mode: 'default' }, undefined)).toBe(false);
    expect(isUnattended({}, { headless: false, routine: '/triage' })).toBe(false);
  });

  it('posts a night run’s ask as notify-only, and the hook doesn’t wait', async () => {
    const night = session('night', [routine('nightshift', 'sdk-cli')]);
    const res = await report(hookInput({ transcript_path: night }));
    expect(await res.json()).toMatchObject({ wait: false });
    const [ask] = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(ask).toMatchObject({ status: 'unattended', unattended: true, agent: '/nightshift' });
    expect(await waitFor(ask!.id, 1000)).toEqual({ status: 'unattended' });
    const list = (await (
      await app.request('http://localhost/api/notifications')
    ).json()) as NotificationList;
    expect(list.items[0]?.title).toMatch(/\/nightshift needed permission and couldn’t wait/);
    // Only a rule for next time, or dismissing it.
    expect((await owner('POST', `/asks/${ask!.id}/answer`, { answer: 'once' })).status).toBe(400);
    const preview = (await (
      await owner('POST', `/asks/${ask!.id}/preview`, {})
    ).json()) as PermissionPreview;
    const always = await owner('POST', `/asks/${ask!.id}/answer`, {
      answer: 'always',
      hash: preview.hash,
    });
    expect(always.status).toBe(200);
    expect(((await always.json()) as PermissionAsk).status).toBe('allowed_always');
  });

  it('counts a subagent of a night run as unattended, and lets the owner dismiss it', async () => {
    session('parent', [routine('wrapup')]);
    const sub = join(claudeHome, 'projects', 'x', 'parent', 'subagents', 'agent-1.jsonl');
    mkdirSync(dirname(sub), { recursive: true });
    writeFileSync(sub, '{}\n');
    const id = await created(hookInput({ transcript_path: sub }));
    const [ask] = (await (await owner('GET', '/asks')).json()) as PermissionAsk[];
    expect(ask).toMatchObject({ id, status: 'unattended', agent: 'a subagent of /wrapup' });
    expect((await owner('POST', `/asks/${id}/answer`, { answer: 'dismiss' })).status).toBe(200);
    expect((await waitFor(id, 10)).status).toBe('dismissed');
  });

  it('PHAROS_ASK_WAIT overrides: an unattended run waits when told to', async () => {
    const res = await report(
      hookInput({ entrypoint: 'sdk-cli', wait_override: true, wait_seconds: 30 }),
    );
    expect(await res.json()).toMatchObject({ wait: true });
  });

  it('the hook exits at once for an unattended run, and waits for an interactive one', async () => {
    const server = await new Promise<{ url: string; close: () => void }>((ready) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) =>
        ready({ url: `http://127.0.0.1:${info.port}`, close: () => s.close() }),
      );
    });
    try {
      const started = Date.now();
      const night = await runHook(hookInput(), {
        PHAROS_URL: server.url,
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
      });
      expect(night).toEqual({ code: 2, stdout: '' });
      expect(Date.now() - started).toBeLessThan(5000);
      // Interactive (no override set): still waiting after a second, until the owner answers.
      const run = runHook(hookInput(), { PHAROS_URL: server.url, CLAUDE_CODE_ENTRYPOINT: 'cli' });
      await new Promise((r) => setTimeout(r, 1000));
      const waiting = ((await (await owner('GET', '/asks')).json()) as PermissionAsk[]).find(
        (a) => a.status === 'waiting',
      );
      expect(waiting).toBeTruthy();
      await owner('POST', `/asks/${waiting!.id}/answer`, { answer: 'once' });
      const { code, stdout } = await run;
      expect(code).toBe(0);
      expect(stdout).toContain('"behavior":"allow"');
    } finally {
      server.close();
    }
  }, 20_000);
});
