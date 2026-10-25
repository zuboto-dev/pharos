import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  PermissionPreview,
  PermissionWriteRecord,
  PermissionWriteResult,
  PermissionCommandsPreview,
  PermissionCommandsResult,
  PermissionsOverview,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { bashRule, covers, example, maskSecrets, pathRule, ruleFor } from './rules.js';
import { PermissionService } from './service.js';
import { BACKUPS_KEPT } from './settings-files.js';
import { readTranscript } from './transcripts.js';

// Everything here lives in a temp folder: a made-up home with its own ~/.claude, made-up project
// folders and made-up transcripts. The real ~/.claude is never read or written.

const NOW = new Date('2026-10-23T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let base: string;
let home: string;
let claudeHome: string;
let repo: string;
let other: string;
let store: Store;
let service: PermissionService;
let app: ReturnType<typeof createApp>;

const OWNER = {
  origin: 'http://localhost',
  'sec-fetch-site': 'same-origin',
  'x-pharos-author': 'human:me',
};

const slug = (path: string) => path.replace(/[/.]/g, '-');

type Line = Record<string, unknown>;
let uses = 0;

/** A tool call and its result, as Claude Code writes them. */
function call(
  cwd: string,
  at: string,
  name: string,
  input: Record<string, unknown>,
  result: { text: string; error?: boolean; decision?: Record<string, unknown>; denial?: string },
): Line[] {
  const id = `toolu_${++uses}`;
  return [
    {
      type: 'assistant',
      cwd,
      sessionId: 's1',
      timestamp: at,
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    },
    {
      type: 'user',
      cwd,
      sessionId: 's1',
      timestamp: at,
      ...(result.decision ? { permissionDecision: result.decision } : {}),
      ...(result.denial ? { toolDenialKind: result.denial } : {}),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: result.text,
            ...(result.error === false ? {} : { is_error: true }),
          },
        ],
      },
    },
  ];
}

const REQUIRES = {
  text: 'This command requires approval',
  decision: { decision: 'reject', source: 'config', reasonCode: 'bashMiss:no-rule-match' },
  denial: 'user-rejected',
};
const APPROVED = {
  text: 'ok',
  error: false,
  decision: { decision: 'accept', source: 'user_temporary' },
};
const RAN = { text: 'ok', error: false, decision: { decision: 'accept', source: 'config' } };

function transcript(cwd: string, name: string, lines: Line[], sub?: string) {
  const dir = join(claudeHome, 'projects', slug(cwd), ...(sub ? [sub, 'subagents'] : []));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: name }),
      ...lines.map((l) => JSON.stringify(l)),
      '{not json',
    ].join('\n'),
  );
  return file;
}

function settings(path: string, permissions: Record<string, string[]>, extra = {}) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...extra, permissions }, null, 2));
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
  const res = await request('GET', '');
  expect(res.status).toBe(200);
  return (await res.json()) as PermissionsOverview;
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-permissions-')));
  home = join(base, 'home');
  claudeHome = join(home, '.claude');
  repo = join(home, 'code', 'shop');
  other = join(home, 'code', 'notes.app');
  mkdirSync(repo, { recursive: true });
  mkdirSync(other, { recursive: true });
  store = new Store(openDatabase(':memory:'));
  service = new PermissionService(store, { home, claudeHome, includeTemp: true, now: () => NOW });
  app = createApp(store, undefined, undefined, { folders: { home }, permissions: service });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('rules from commands', () => {
  it('covers a command prefix', () => {
    expect(bashRule('git status --short').rule).toBe('Bash(git status:*)');
    expect(bashRule('npx pnpm@12.9.1 test 2>&1 | tail -5').rule).toBe(
      'Bash(npx pnpm@12.9.1 test:*)',
    );
    expect(bashRule('npx pnpm@12.9.1 --filter @pharos/server test').rule).toBe(
      'Bash(npx pnpm@12.9.1 --filter @pharos/server test:*)',
    );
    expect(bashRule('cd /x/y && git commit -m "a; b"').rule).toBe('Bash(git commit:*)');
    expect(bashRule('FOO=1 pnpm build').rule).toBe('Bash(pnpm build:*)');
    expect(bashRule('git -C /repo log --oneline').rule).toBe('Bash(git -C /repo log:*)');
    expect(bashRule('python3 -I scripts/check.py --all')).toMatchObject({
      rule: 'Bash(python3 -I scripts/check.py:*)',
      allowable: true,
    });
    expect(bashRule('sed -n 1,20p a.ts')).toMatchObject({ rule: 'Bash(sed:*)', allowable: true });
    expect(bashRule('npx tsc --noEmit')).toMatchObject({
      rule: 'Bash(npx tsc:*)',
      allowable: true,
    });
  });

  it('never offers a whole shell, rm or git push as Allow', () => {
    const denyOnly = [
      ['bash -c "anything"', 'Bash(bash:*)'],
      ['sh script.sh', 'Bash(sh:*)'],
      ["python3 - <<'EOF'", 'Bash(python3:*)'],
      ['python3 -c "print(1)"', 'Bash(python3:*)'],
      ['node -e "1"', 'Bash(node:*)'],
      ['rm -rf build', 'Bash(rm:*)'],
      ['git push origin main', 'Bash(git push:*)'],
      ['git -C /repo push', 'Bash(git -C /repo push:*)'],
      ['git -c core.pager=x log', 'Bash(git -c core.pager=x log:*)'],
      ['sudo ls', 'Bash(sudo:*)'],
      ['xargs rm', 'Bash(xargs:*)'],
      ['for f in *; do echo $f; done', 'Bash(for:*)'],
      ['$W deploy', 'Bash($W:*)'],
      ['npx pnpm@12.9.1 dlx cowsay', 'Bash(npx pnpm@12.9.1 dlx:*)'],
      ['pnpm --filter x', 'Bash(pnpm:*)'],
      ['curl -s https://example.com', 'Bash(curl:*)'],
      ['npx', 'Bash(npx:*)'],
    ] as const;
    for (const [command, rule] of denyOnly) {
      const s = bashRule(command);
      expect(s.rule, command).toBe(rule);
      expect(s.allowable, command).toBe(false);
      expect(s.reason, command).toMatch(/only be denied/);
    }
  });

  it('makes path rules, and keeps agents out of their own settings', () => {
    expect(pathRule('Read', '/elsewhere/logs/a.log', home).rule).toBe('Read(//elsewhere/logs/**)');
    expect(pathRule('Edit', join(repo, 'src', 'a.ts'), home)).toMatchObject({
      rule: 'Edit(~/code/shop/src/**)',
      allowable: true,
    });
    expect(pathRule('Edit', join(repo, '.claude', 'settings.local.json'), home)).toMatchObject({
      rule: 'Edit(~/code/shop/.claude/**)',
      allowable: false,
    });
    expect(pathRule('Read', join(home, 'a.txt'), home).allowable).toBe(false);
    expect(ruleFor('Write', { file_path: join(repo, 'x.md') }, home)?.rule).toBe(
      'Edit(~/code/shop/**)',
    );
    expect(ruleFor('mcp__pharos__apply', {}, home)?.rule).toBe('mcp__pharos__apply');
    expect(ruleFor('WebFetch', { url: 'https://docs.example.com/a' }, home)?.rule).toBe(
      'WebFetch(domain:docs.example.com)',
    );
    expect(ruleFor('AskUserQuestion', {}, home)).toBeUndefined();
  });

  it('knows when an existing rule already decides a suggestion', () => {
    const where = { home, folder: repo };
    const s = bashRule('git log --oneline');
    expect(covers('Bash(git log:*)', s, where)).toBe(true);
    expect(covers('Bash(git:*)', s, where)).toBe(true);
    expect(covers('Bash(git log *)', s, where)).toBe(true);
    expect(covers('Bash', s, where)).toBe(true);
    expect(covers('Bash(git status:*)', s, where)).toBe(false);
    expect(covers('Bash(gi:*)', s, where)).toBe(false);
    const mcp = ruleFor('mcp__pharos__apply', {}, home)!;
    expect(covers('mcp__pharos', mcp, where)).toBe(true);
    expect(covers('mcp__pharos__*', mcp, where)).toBe(true);
    expect(covers('mcp__other', mcp, where)).toBe(false);
    const edit = pathRule('Edit', join(repo, 'src', 'deep', 'a.ts'), home);
    expect(covers('Edit(~/code/shop/**)', edit, where)).toBe(true);
    expect(covers('Edit(/src/**)', edit, where)).toBe(true);
    expect(covers('Edit(~/code/other/**)', edit, where)).toBe(false);
    expect(covers('Read(~/code/shop/**)', edit, where)).toBe(false);
  });

  it('masks secrets and shortens examples', () => {
    expect(maskSecrets('curl -H "Authorization: Bearer abc.def" x')).not.toContain('abc.def');
    expect(maskSecrets('API_TOKEN=supersecret pnpm deploy')).toBe('API_TOKEN=••• pnpm deploy');
    expect(maskSecrets('echo sk-ant-api03-AAAAAAAAAAAAAAAAAAAA')).toBe('echo •••');
    expect(maskSecrets('git clone https://me:pw@github.com/x')).toBe(
      'git clone https://•••@github.com/x',
    );
    expect(maskSecrets('echo ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('echo •••');
    expect(maskSecrets('ls /Users/someone/code/project/apps/server/src/permissions')).toBe(
      'ls /Users/someone/code/project/apps/server/src/permissions',
    );
    const long = example(`grep ${'x'.repeat(300)} ${home}/a`, home);
    expect(long.length).toBe(120);
    expect(example(`cat ${home}/notes.txt`, home)).toBe('cat ~/notes.txt');
  });
});

describe('reading transcripts', () => {
  it('finds asks and refusals by their markers, new and old', async () => {
    const file = transcript(repo, 'a', [
      ...call(repo, ago(1), 'Bash', { command: 'git status' }, RAN),
      ...call(repo, ago(1), 'Bash', { command: 'pnpm build' }, REQUIRES),
      ...call(repo, ago(1), 'Bash', { command: 'pnpm build --watch' }, APPROVED),
      ...call(
        repo,
        ago(2),
        'Bash',
        { command: 'echo a; git push origin main' },
        {
          text: 'Permission to use Bash with command git push origin main has been denied.',
          decision: { decision: 'reject', source: 'config', reasonType: 'subcommandResults' },
          denial: 'permission-rule',
        },
      ),
      ...call(
        repo,
        ago(2),
        'Bash',
        { command: 'gh pr view 1' },
        {
          text: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [x]',
          decision: { decision: 'reject', source: 'config', reasonType: 'classifier' },
          denial: 'automode-blocked',
        },
      ),
      ...call(
        repo,
        ago(2),
        'Bash',
        { command: 'for x in $(ls); do echo; done' },
        {
          text: "A variable in this command can't be checked before it runs",
          decision: { decision: 'reject', source: 'config', reasonCode: 'bashMiss:too-complex' },
          denial: 'user-rejected',
        },
      ),
      // Older transcripts: the text only.
      ...call(
        repo,
        ago(3),
        'Bash',
        { command: 'head -3 x; cat ~/y; make test' },
        {
          text: 'This Bash command contains multiple operations. The following part requires approval: make test',
        },
      ),
      ...call(
        repo,
        ago(3),
        'mcp__pharos__apply',
        {},
        {
          text: "Claude requested permissions to use mcp__pharos__apply, but you haven't granted it yet.",
        },
      ),
      ...call(
        repo,
        ago(3),
        'Edit',
        { file_path: join(repo, 'src', 'a.ts') },
        {
          text: "The user doesn't want to proceed with this tool use. The tool use was rejected",
        },
      ),
      // An ordinary failure isn't about permission.
      ...call(repo, ago(1), 'Bash', { command: 'pnpm test' }, { text: 'Exit code 1' }),
      // Outside the window.
      ...call(repo, ago(20), 'Bash', { command: 'pnpm lint' }, REQUIRES),
    ]);
    const summary = await readTranscript(file, home, NOW.getTime() - 14 * 86_400_000);
    expect(summary.cwd).toBe(repo);
    const got = summary.events.map((e) => [e.kind, e.suggested?.rule]);
    expect(got).toEqual([
      ['denied', 'Bash(pnpm build:*)'],
      ['approved', 'Bash(pnpm build:*)'],
      ['ruleDenied', 'Bash(git push:*)'],
      ['blocked', 'Bash(gh pr:*)'],
      ['unfixable', undefined],
      ['denied', 'Bash(make test:*)'],
      ['denied', 'mcp__pharos__apply'],
      ['denied', 'Edit(~/code/shop/src/**)'],
    ]);
  });
});

describe('/api/permissions', () => {
  function fixtures() {
    store.apply({ kind: 'human', name: 'me' }, {
      message: 'test',
      operations: [
        { op: 'create', type: 'repository', ref: 'r', data: { name: 'Shop', path: repo } },
        { op: 'create', type: 'project', data: { name: 'Shop site', repositoryId: '$r' } },
      ],
    } as never);
    transcript(repo, 'a', [
      ...call(repo, ago(1), 'Bash', { command: 'pnpm build' }, REQUIRES),
      ...call(repo, ago(2), 'Bash', { command: 'pnpm build --prod' }, REQUIRES),
      ...call(repo, ago(10), 'Bash', { command: 'pnpm build' }, APPROVED),
      ...call(repo, ago(1), 'Bash', { command: 'rm -rf dist' }, REQUIRES),
      ...call(repo, ago(1), 'Bash', { command: 'git log -3' }, REQUIRES),
      ...call(repo, ago(1), 'Bash', { command: 'API_KEY=abcdef123456 pnpm deploy' }, REQUIRES),
    ]);
    // A subagent's transcript, and a worktree session counted under its repository.
    transcript(
      repo,
      'agent-1',
      call(repo, ago(1), 'Bash', { command: 'pnpm build' }, REQUIRES),
      's1',
    );
    const worktree = join(repo, '.claude', 'worktrees', 'x');
    transcript(worktree, 'b', call(worktree, ago(1), 'mcp__pharos__apply', {}, REQUIRES));
    transcript(other, 'c', call(other, ago(1), 'Bash', { command: 'make' }, REQUIRES));
    // The user's own settings allow git log.
    settings(join(claudeHome, 'settings.json'), { allow: ['Bash(git log:*)'] });
  }

  it('answers only the owner, from the Pharos page', async () => {
    fixtures();
    const agent = await request('GET', '', undefined, {
      ...OWNER,
      'x-pharos-author': 'agent:Claude Code',
    });
    expect(agent.status).toBe(403);
    const none = await request('GET', '', undefined, {
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
    });
    expect(none.status).toBe(403);
    const elsewhere = await request('GET', '', undefined, {
      ...OWNER,
      'sec-fetch-site': 'cross-site',
    });
    expect(elsewhere.status).toBe(403);
    for (const path of ['/preview', '/write', '/undo']) {
      const res = await request('POST', path, {}, { ...OWNER, 'x-pharos-author': 'agent:x' });
      expect(res.status, path).toBe(403);
      const noOrigin = await request('POST', path, {}, { 'x-pharos-author': 'human:me' });
      expect(noOrigin.status, path).toBe(403);
    }
  });

  it('is not reachable over MCP', async () => {
    const client = new Client({ name: 'agent', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    const { tools } = await client.listTools();
    expect(
      tools.some((t) =>
        /permission|settings/i.test(`${t.name} ${t.description}`.replace(/project settings/gi, '')),
      ),
    ).toBe(false);
    await client.close();
  });

  it('counts asks per folder, grouped into rules, with their status', async () => {
    fixtures();
    const o = await overview();
    expect(o.windowDays).toBe(14);
    const shop = o.folders.find((f) => f.path === repo)!;
    expect(shop).toMatchObject({
      label: 'shop',
      displayPath: '~/code/shop',
      projects: ['Shop site'],
    });
    const build = shop.suggestions.find((s) => s.rule === 'Bash(pnpm build:*)')!;
    expect(build).toMatchObject({
      total: 4,
      week: 3,
      approved: 1,
      denied: 3,
      status: 'not_set',
      allowable: true,
    });
    expect(build.examples).toEqual(['pnpm build', 'pnpm build --prod']);
    expect(shop.suggestions.find((s) => s.rule === 'Bash(rm:*)')).toMatchObject({
      allowable: false,
    });
    expect(shop.suggestions.find((s) => s.rule === 'Bash(git log:*)')).toMatchObject({
      status: 'allowed',
      statusSource: 'user',
      matchedBy: 'Bash(git log:*)',
    });
    expect(shop.suggestions.find((s) => s.rule === 'mcp__pharos__apply')?.total).toBe(1);
    expect(shop.suggestions.find((s) => s.rule === 'Bash(pnpm deploy:*)')?.examples).toEqual([
      'API_KEY=••• pnpm deploy',
    ]);
    expect(o.folders.find((f) => f.path === other)?.suggestions[0]?.rule).toBe('Bash(make:*)');
    // Nothing but counts, rules and the short examples: no transcript text.
    expect(JSON.stringify(o)).not.toContain('requires approval');
    expect(JSON.stringify(o)).not.toContain('abcdef123456');
  });

  it('previews the exact change, writes it with a backup, and undoes it', async () => {
    fixtures();
    const local = join(repo, '.claude', 'settings.local.json');
    settings(local, { allow: ['Bash(ls:*)'], deny: ['Bash(pnpm build:*)'] }, { env: { A: '1' } });
    const shop = (await overview()).folders.find((f) => f.path === repo)!;
    expect(shop.suggestions.find((s) => s.rule === 'Bash(pnpm build:*)')?.status).toBe('denied');
    const change = { folderId: shop.id, rule: 'Bash(pnpm build:*)', action: 'allow' };
    const res = await request('POST', '/preview', change);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as PermissionPreview;
    expect(preview).toMatchObject({
      path: local,
      exists: true,
      addTo: 'allow',
      removeFrom: ['deny'],
      before: { allow: ['Bash(ls:*)'], deny: ['Bash(pnpm build:*)'], ask: [] },
      after: { allow: ['Bash(ls:*)', 'Bash(pnpm build:*)'], deny: [], ask: [] },
      unchanged: false,
    });
    // Nothing is written by a preview.
    expect(JSON.parse(readFileSync(local, 'utf8')).permissions.deny).toEqual([
      'Bash(pnpm build:*)',
    ]);

    const written = await request('POST', '/write', { ...change, hash: preview.hash });
    expect(written.status).toBe(200);
    const { record } = (await written.json()) as PermissionWriteResult;
    const after = JSON.parse(readFileSync(local, 'utf8'));
    expect(after).toEqual({
      env: { A: '1' },
      permissions: { allow: ['Bash(ls:*)', 'Bash(pnpm build:*)'], deny: [] },
    });
    expect(record.backup).toMatch(/settings\.local\.json\.pharos-backup-\d{8}T\d{9}Z$/);
    expect(JSON.parse(readFileSync(record.backup!, 'utf8')).permissions.deny).toEqual([
      'Bash(pnpm build:*)',
    ]);
    const o = await overview();
    expect(
      o.folders
        .find((f) => f.path === repo)
        ?.suggestions.find((s) => s.rule === 'Bash(pnpm build:*)'),
    ).toMatchObject({
      status: 'allowed',
      statusSource: 'local',
    });
    expect(o.recent[0]).toMatchObject({
      id: record.id,
      rule: 'Bash(pnpm build:*)',
      undoable: true,
    });

    // The same preview again is stale now.
    const stale = await request('POST', '/write', {
      ...change,
      action: 'deny',
      hash: preview.hash,
    });
    expect(stale.status).toBe(409);

    const undone = await request('POST', '/undo', { id: record.id });
    expect(undone.status).toBe(200);
    expect(JSON.parse(readFileSync(local, 'utf8')).permissions.deny).toEqual([
      'Bash(pnpm build:*)',
    ]);
    expect(((await undone.json()) as PermissionWriteRecord).undone).toBeTruthy();
    expect((await request('POST', '/undo', { id: record.id })).status).toBe(400);
  });

  it('creates the file when missing, and Undo removes it again', async () => {
    fixtures();
    const shop = (await overview()).folders.find((f) => f.path === repo)!;
    const change = { folderId: shop.id, rule: 'Bash(rm:*)', action: 'deny', target: 'shared' };
    const preview = (await (await request('POST', '/preview', change)).json()) as PermissionPreview;
    expect(preview).toMatchObject({ path: join(repo, '.claude', 'settings.json'), exists: false });
    expect(preview.warnings.join(' ')).toMatch(/shared/);
    const { record } = (await (
      await request('POST', '/write', { ...change, hash: preview.hash })
    ).json()) as PermissionWriteResult;
    expect(record.backup).toBeUndefined();
    expect(JSON.parse(readFileSync(preview.path, 'utf8'))).toEqual({
      permissions: { deny: ['Bash(rm:*)'] },
    });
    expect((await request('POST', '/undo', { id: record.id })).status).toBe(200);
    expect(existsSync(preview.path)).toBe(false);
  });

  it('refuses Allow for deny-only rules, rules it never suggested, and broken files', async () => {
    fixtures();
    const shop = (await overview()).folders.find((f) => f.path === repo)!;
    const allowRm = await request('POST', '/preview', {
      folderId: shop.id,
      rule: 'Bash(rm:*)',
      action: 'allow',
    });
    expect(allowRm.status).toBe(400);
    expect(((await allowRm.json()) as { error: { message: string } }).error.message).toMatch(
      /only be denied/,
    );
    const made = await request('POST', '/preview', {
      folderId: shop.id,
      rule: 'Bash(*)',
      action: 'allow',
    });
    expect(made.status).toBe(400);
    const missing = await request('POST', '/preview', {
      folderId: 'nope',
      rule: 'Bash(make:*)',
      action: 'allow',
    });
    expect(missing.status).toBe(404);
    const local = join(repo, '.claude', 'settings.local.json');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(local, '{ "permissions": ');
    const broken = await request('POST', '/preview', {
      folderId: shop.id,
      rule: 'Bash(pnpm build:*)',
      action: 'allow',
    });
    expect(broken.status).toBe(400);
    expect(readFileSync(local, 'utf8')).toBe('{ "permissions": ');
  });

  it('keeps the last five backups, and Undo refuses once the file changed', async () => {
    fixtures();
    const local = join(repo, '.claude', 'settings.local.json');
    settings(local, {});
    const shop = (await overview()).folders.find((f) => f.path === repo)!;
    let last: PermissionWriteRecord | undefined;
    for (let i = 0; i < 7; i++) {
      const change = {
        folderId: shop.id,
        rule: 'Bash(pnpm build:*)',
        action: i % 2 ? 'deny' : 'allow',
      };
      const preview = (await (
        await request('POST', '/preview', change)
      ).json()) as PermissionPreview;
      const res = await request('POST', '/write', { ...change, hash: preview.hash });
      expect(res.status).toBe(200);
      last = ((await res.json()) as PermissionWriteResult).record;
    }
    const backups = readdirSync(join(repo, '.claude')).filter((n) => n.includes('.pharos-backup-'));
    expect(backups).toHaveLength(BACKUPS_KEPT);
    writeFileSync(local, '{"permissions":{"allow":["Bash(ls:*)"]}}');
    const res = await request('POST', '/undo', { id: last!.id });
    expect(res.status).toBe(409);
    expect(readFileSync(local, 'utf8')).toBe('{"permissions":{"allow":["Bash(ls:*)"]}}');
  });

  it('leaves out old transcripts and folders that are gone', async () => {
    const gone = join(home, 'code', 'gone');
    transcript(gone, 'g', call(gone, ago(1), 'Bash', { command: 'make' }, REQUIRES));
    const old = transcript(other, 'o', call(other, ago(30), 'Bash', { command: 'make' }, REQUIRES));
    const t = (NOW.getTime() - 30 * 86_400_000) / 1000;
    utimesSync(old, t, t);
    const o = await overview();
    expect(o.folders.map((f) => f.path)).toEqual([]);
  });
});

describe('edge cases', () => {
  it('keeps a redirection with its command', () => {
    expect(bashRule('npx pnpm@12.9.1 test 2>&1 | tail -5').subject).toBe(
      'npx pnpm@12.9.1 test 2>&1',
    );
  });

  it('leaves out sessions run in temp folders outside the home folder', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-scratch-')));
    try {
      transcript(scratch, 't', call(scratch, ago(1), 'Bash', { command: 'make' }, REQUIRES));
      transcript(repo, 'r', call(repo, ago(1), 'Bash', { command: 'make' }, REQUIRES));
      const strict = new PermissionService(store, { home, claudeHome, now: () => NOW });
      const paths = (await strict.overview()).folders.map((f) => f.path);
      expect(paths).toContain(repo);
      expect(paths).not.toContain(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("a task's Allow button", () => {
  function project(path = repo): string {
    const { created } = store.apply({ kind: 'human', name: 'me' }, {
      message: 'test',
      operations: [
        { op: 'create', type: 'repository', ref: 'r', data: { name: 'Shop', path } },
        {
          op: 'create',
          type: 'project',
          ref: 'p',
          data: { name: 'Shop site', repositoryId: '$r' },
        },
      ],
    } as never);
    return created.p!;
  }

  it('shows each command as the rule Pharos suggests, with its risk, and what it cannot allow', async () => {
    const projectId = project();
    const res = await request('POST', '/commands/preview', {
      projectId,
      commands: ['npx pnpm@12.9.1 test', 'git log -3', 'bash -c "anything"'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PermissionCommandsPreview;
    expect(body.path).toBe(join(repo, '.claude/settings.local.json'));
    expect(body.rows.map((r) => [r.rule, r.allowable])).toEqual([
      [bashRule('npx pnpm@12.9.1 test').rule, true],
      [bashRule('git log -3').rule, true],
      [bashRule('bash -c "anything"').rule, false],
    ]);
    expect(body.rows[0]!.risk).toMatch(/low|medium|high/);
  });

  it('writes only the allowable rules, to that folder only, and Undo takes them back', async () => {
    const projectId = project();
    const res = await request('POST', '/commands/write', {
      projectId,
      commands: ['npx pnpm@12.9.1 test', 'bash -c "anything"'],
    });
    const body = (await res.json()) as PermissionCommandsResult;
    expect(body.records.map((r) => r.rule)).toEqual([bashRule('npx pnpm@12.9.1 test').rule]);
    const file = JSON.parse(readFileSync(join(repo, '.claude/settings.local.json'), 'utf8'));
    expect(file.permissions.allow).toEqual([bashRule('npx pnpm@12.9.1 test').rule]);
    expect(existsSync(join(claudeHome, 'settings.json'))).toBe(false); // never the user's file
    // Pressing again writes nothing more.
    const again = (await (
      await request('POST', '/commands/write', { projectId, commands: ['npx pnpm@12.9.1 test'] })
    ).json()) as PermissionCommandsResult;
    expect(again.records).toEqual([]);
    expect(again.rows[0]!.unchanged).toBe(true);
    expect((await request('POST', '/undo', { id: body.records[0]!.id })).status).toBe(200);
  });

  it('is the owner’s alone, and refuses a project with no folder here', async () => {
    const projectId = project(join(base, 'nowhere'));
    const agent = await request(
      'POST',
      '/commands/write',
      { projectId, commands: ['git log'] },
      { 'x-pharos-author': 'agent:Claude Code' },
    );
    expect(agent.status).toBe(403);
    const none = await request('POST', '/commands/preview', { projectId, commands: ['git log'] });
    expect(none.status).toBe(400);
  });
});
