import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { projectBrief } from './brief.js';
import { lastAssistantText, SessionNotes } from './session-notes.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

let dir: string;
let store: Store;
let projectId: string;
let repo: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pharos-notes-'));
  repo = join(dir, 'garden');
  mkdirSync(join(repo, '.claude', 'worktrees', 'x'), { recursive: true });
  store = new Store(openDatabase(':memory:'));
  const { created } = store.apply({ kind: 'human', name: 'me' }, {
    message: 'set up',
    operations: [
      { op: 'create', type: 'repository', ref: 'r', data: { name: 'garden', path: repo } },
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden', repositoryId: '$r' } },
    ],
  } as never);
  projectId = created.p!;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function transcript(...texts: string[]): string {
  const file = join(dir, `t-${Math.random()}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      ...texts.map((t) =>
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }),
      ),
    ].join('\n') + '\n',
  );
  return file;
}

describe('session notes', () => {
  it('keeps one note per session, its latest turn, in the project its folder belongs to', () => {
    let t = 0;
    const notes = new SessionNotes(store, () => new Date(Date.UTC(2026, 9, 26, 1, t++)));
    notes.record({
      session_id: 's1',
      cwd: repo,
      kind: 'terminal',
      message: 'Moved tutti to the desktop.',
    });
    notes.record({ session_id: 's1', cwd: repo, kind: 'terminal', message: 'Desk is down to 28.' });
    notes.record({
      session_id: 's2',
      cwd: join(repo, '.claude', 'worktrees', 'x'),
      host: 'axion-01',
      kind: 'routine: Night run',
      agent: 'Claude Code',
      message: 'All 2,029 tests pass on main.',
    });
    notes.record({
      session_id: 's3',
      cwd: dir,
      kind: 'terminal',
      message: 'Not a project folder.',
    });
    const recent = notes.recent(projectId);
    expect(recent.map((n) => [n.sessionId, n.message, n.turns])).toEqual([
      ['s2', 'All 2,029 tests pass on main.', 1],
      ['s1', 'Desk is down to 28.', 2],
    ]);
    expect(notes.get('s3')?.projectId).toBeNull();
    // Every session's brief starts from them.
    const brief = projectBrief(store, projectId, { notes });
    expect(brief).toContain('## Recent sessions (their last message)');
    expect(brief).toContain(
      'Claude Code (routine: Night run on axion-01): All 2,029 tests pass on main.',
    );
    expect(brief).toContain('agent (terminal on this Mac): Desk is down to 28.');
  });

  it('reads the last thing the assistant said from a transcript', () => {
    expect(lastAssistantText(transcript('first', 'the last answer'))).toBe('the last answer');
    expect(lastAssistantText(join(dir, 'missing.jsonl'))).toBe('');
  });

  it('takes notes from this computer only, and shows them per project', async () => {
    const app = createApp(store);
    const post = (headers: Record<string, string>) =>
      app.request('http://127.0.0.1:4300/api/sessions/note', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4300', ...headers },
        body: JSON.stringify({ session_id: 'abc', cwd: repo, message: 'Hello from the terminal.' }),
      });
    const ok = await post({});
    expect(await ok.json()).toEqual({ ok: true, projectId });
    expect((await post({ 'x-forwarded-for': '203.0.113.9' })).status).toBe(403);
    expect((await post({ 'x-pharos-author': 'agent:Claude Code' })).status).toBe(403);
    const list = (await (
      await app.request(`http://127.0.0.1:4300/api/projects/${projectId}/sessions`)
    ).json()) as { message: string }[];
    expect(list.map((n) => n.message)).toEqual(['Hello from the terminal.']);
  });

  it('the hook script posts what the transcript said last', async () => {
    const seen: unknown[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url, body: JSON.parse(body) });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const script = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'agents',
      'claude',
      'hooks',
      'session-note.mjs',
    );
    const input = JSON.stringify({
      session_id: 'h1',
      cwd: repo,
      hook_event_name: 'Stop',
      transcript_path: transcript('Done: the runner is ready.'),
    });
    await new Promise<void>((done, fail) => {
      import('node:child_process').then(({ spawn }) => {
        const p = spawn(process.execPath, [script], {
          env: {
            ...process.env,
            PHAROS_URL: url,
            PHAROS_SESSION_KIND: 'routine: Night run',
            PHAROS_HOST: 'axion-01',
          },
        });
        p.stdin.end(input);
        p.on('exit', (code) => (code === 0 ? done() : fail(new Error(`exit ${code}`))));
      }, fail);
    });
    server.close();
    expect(seen).toEqual([
      {
        url: '/api/sessions/note',
        body: {
          session_id: 'h1',
          cwd: repo,
          host: 'axion-01',
          kind: 'routine: Night run',
          agent: 'Claude Code',
          message: 'Done: the runner is ready.',
        },
      },
    ]);
  });
});
