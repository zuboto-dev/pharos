import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PermissionPreview, PermissionWriteResult, PermissionsOverview } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { bashRule, pathRule } from './rules.js';
import { scopesFor } from './scopes.js';
import { PermissionService } from './service.js';

// "How far" a rule reaches, folders not in Pharos, hiding. Temp home and made-up transcripts only.

const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const OWNER = {
  origin: 'http://localhost',
  'sec-fetch-site': 'same-origin',
  'x-pharos-author': 'human:me',
};

let base: string;
let home: string;
let claudeHome: string;
let repo: string;
let loose: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let n = 0;

function ask(cwd: string, name: string, input: Record<string, unknown>) {
  const id = `t${++n}`;
  return [
    {
      type: 'assistant',
      cwd,
      timestamp: ago(1),
      message: { content: [{ type: 'tool_use', id, name, input }] },
    },
    {
      type: 'user',
      cwd,
      timestamp: ago(1),
      permissionDecision: {
        decision: 'reject',
        source: 'config',
        reasonCode: 'bashMiss:no-rule-match',
      },
      toolDenialKind: 'user-rejected',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: 'This command requires approval',
            is_error: true,
          },
        ],
      },
    },
  ];
}

function transcript(cwd: string, lines: object[]) {
  const dir = join(claudeHome, 'projects', cwd.replace(/[/.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `s${++n}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
}

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = OWNER,
) {
  return app.request(`http://localhost/api/permissions${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function overview(): Promise<PermissionsOverview> {
  return (await (await request('GET', '')).json()) as PermissionsOverview;
}

const find = (o: PermissionsOverview, path: string, rule: string) =>
  o.folders.find((f) => f.path === path)!.suggestions.find((s) => s.rule === rule)!;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-scopes-')));
  home = join(base, 'home');
  claudeHome = join(home, '.claude');
  repo = join(home, 'code', 'breathe');
  loose = join(home, 'code', 'scratch');
  mkdirSync(join(repo, 'src', 'cart'), { recursive: true });
  mkdirSync(loose, { recursive: true });
  store = new Store(openDatabase(':memory:'));
  store.apply({ kind: 'human', name: 'me' }, {
    message: 'test',
    operations: [
      { op: 'create', type: 'repository', ref: 'r', data: { name: 'Breathe', path: repo } },
      { op: 'create', type: 'project', data: { name: 'Breathe app', repositoryId: '$r' } },
    ],
  } as never);
  transcript(repo, [
    ...ask(repo, 'Bash', { command: 'npx pnpm@12.9.1 test' }),
    ...ask(repo, 'Bash', { command: 'npx pnpm@12.9.1 test --run src/a.test.ts' }),
    ...ask(repo, 'Bash', { command: 'git commit -m "one"' }),
    ...ask(repo, 'Bash', { command: 'git commit -m "two"' }),
    ...ask(repo, 'Bash', { command: 'git status' }),
    ...ask(repo, 'Bash', { command: 'rm -rf dist' }),
    ...ask(repo, 'Edit', { file_path: join(repo, 'src', 'cart', 'total.ts') }),
  ]);
  transcript(loose, ask(loose, 'Bash', { command: 'make' }));
  app = createApp(store, undefined, undefined, {
    folders: { home },
    permissions: new PermissionService(store, { home, claudeHome }),
  });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('How far', () => {
  it('offers narrower rules from the actual asks, this folder, and all projects for low risk', async () => {
    const o = await overview();
    const commit = find(o, repo, 'Bash(git commit:*)');
    expect(commit.scopes.map((s) => [s.kind, s.rule, s.target])).toEqual([
      ['narrow', 'Bash(git commit -m:*)', 'local'],
      ['folder', 'Bash(git commit:*)', 'local'],
    ]);
    expect(commit.scopes[1]).toMatchObject({
      where: 'Only in Breathe',
      phrase: 'run `git commit …`',
    });
    const status = find(o, repo, 'Bash(git status:*)');
    expect(status.scopes.map((s) => s.kind)).toEqual(['folder', 'user']);
    expect(status.scopes[1]).toMatchObject({ where: 'In all your projects', target: 'user' });
    const edit = find(o, repo, 'Edit(~/code/breathe/src/cart/**)');
    expect(edit.scopes.map((s) => s.rule)).toEqual([
      'Edit(~/code/breathe/src/cart/total.ts)',
      'Edit(~/code/breathe/src/cart/**)',
      'Edit(~/code/breathe/src/**)',
    ]);
    // Never "All my projects" for medium or high risk, and deny-only stays deny-only.
    expect(find(o, repo, 'Bash(rm:*)')).toMatchObject({ allowable: false });
    expect(find(o, repo, 'Bash(rm:*)').scopes.some((s) => s.target === 'user')).toBe(false);
    expect(commit.scopes.some((s) => s.target === 'user')).toBe(false);
  });

  it('never widens a path rule onto settings or keys', () => {
    const s = pathRule('Edit', join(repo, '.claude', 'x', 'a.json'), home);
    const scopes = scopesFor({
      suggested: s,
      raws: [join(repo, '.claude', 'x', 'a.json')],
      folder: { path: repo, name: 'Breathe' },
      home,
      risk: 'high',
    });
    expect(scopes.map((x) => x.rule)).not.toContain('Edit(~/code/breathe/.claude/**)');
    const b = bashRule('python3 -c "x"');
    expect(
      scopesFor({
        suggested: b,
        raws: ['python3 -c "x"'],
        folder: { path: repo, name: 'B' },
        home,
        risk: 'high',
      }).map((x) => x.kind),
    ).toEqual(['folder']);
  });

  it('writes the narrower rule chosen, in the folder', async () => {
    const o = await overview();
    const folder = o.folders.find((f) => f.path === repo)!;
    const change = {
      folderId: folder.id,
      base: 'Bash(git commit:*)',
      rule: 'Bash(git commit -m:*)',
      action: 'allow',
    };
    const preview = (await (await request('POST', '/preview', change)).json()) as PermissionPreview;
    expect(preview).toMatchObject({
      path: join(repo, '.claude', 'settings.local.json'),
      after: { allow: ['Bash(git commit -m:*)'] },
    });
    const res = await request('POST', '/write', { ...change, hash: preview.hash });
    expect(res.status).toBe(200);
    // A rule that isn't one of the scopes is refused.
    const made = await request('POST', '/preview', { ...change, rule: 'Bash(git:*)' });
    expect(made.status).toBe(400);
  });

  it('writes All my projects to ~/.claude/settings.json only for a low-risk rule', async () => {
    const o = await overview();
    const folder = o.folders.find((f) => f.path === repo)!;
    const status = {
      folderId: folder.id,
      rule: 'Bash(git status:*)',
      action: 'allow',
      target: 'user',
    };
    const preview = (await (await request('POST', '/preview', status)).json()) as PermissionPreview;
    expect(preview.path).toBe(join(claudeHome, 'settings.json'));
    const { record } = (await (
      await request('POST', '/write', { ...status, hash: preview.hash })
    ).json()) as PermissionWriteResult;
    expect(
      JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8')).permissions.allow,
    ).toEqual(['Bash(git status:*)']);
    expect((await request('POST', '/undo', { id: record.id })).status).toBe(200);
    expect(existsSync(join(claudeHome, 'settings.json'))).toBe(false);
    const commit = await request('POST', '/preview', { ...status, rule: 'Bash(git commit:*)' });
    expect(commit.status).toBe(400);
    expect(((await commit.json()) as { error: { message: string } }).error.message).toMatch(
      /low-risk/,
    );
  });
});

describe('Not in Pharos', () => {
  it('marks folders agents asked in that aren’t in Pharos, by their own name', async () => {
    const o = await overview();
    expect(o.folders.find((f) => f.path === repo)).toMatchObject({
      inPharos: true,
      name: 'Breathe',
      projects: ['Breathe app'],
    });
    expect(o.folders.find((f) => f.path === loose)).toMatchObject({
      inPharos: false,
      name: 'scratch',
    });
  });

  it('adds a folder to Pharos as a repository, as the owner only', async () => {
    const id = (await overview()).folders.find((f) => f.path === loose)!.id;
    const agent = await request(
      'POST',
      `/folders/${id}/add`,
      {},
      { ...OWNER, 'x-pharos-author': 'agent:x' },
    );
    expect(agent.status).toBe(403);
    const res = await request('POST', `/folders/${id}/add`, {});
    expect(res.status).toBe(200);
    const repoEntity = store.list('repository').find((r) => r.data.path === loose);
    expect(repoEntity?.data.name).toBe('scratch');
    expect(store.history({ limit: 1 })[0]?.author).toEqual({ kind: 'human', name: 'me' });
    expect((await overview()).folders.find((f) => f.path === loose)?.inPharos).toBe(true);
    expect((await request('POST', `/folders/${id}/add`, {})).status).toBe(400);
  });

  it('hides a folder, and shows hidden ones again', async () => {
    const id = (await overview()).folders.find((f) => f.path === loose)!.id;
    expect((await request('POST', `/folders/${id}/hide`, {})).status).toBe(200);
    const o = await overview();
    expect(o.folders.some((f) => f.path === loose)).toBe(false);
    expect(o.hidden).toBe(1);
    await request('POST', '/folders/show-hidden', {});
    expect((await overview()).folders.some((f) => f.path === loose)).toBe(true);
  });
});
