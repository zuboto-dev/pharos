// Repository file links (repo: links). Every repository, branch and file here is made up, in a
// temporary folder; no test reads the owner's files.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Author, type RepoFile, repoFileUrl, repoPathsUrl } from '@pharos/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { findInRepo, readRepoFile, RepoFileError } from './repo-files.js';

const human: Author = { kind: 'human', name: 'me' };
const BRANCH = 'review/formal-model';
const MODEL = '# Formal model\n\nA made-up model of a garden queue.\n\n- item one\n- item two\n';

let dir: string;
let repo: string;

function git(...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString();
}

function write(path: string, text: string | Buffer) {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), text);
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-repo-')));
  repo = join(dir, 'garden');
  mkdirSync(repo);
  writeFileSync(join(dir, 'outside.txt'), 'outside the repository\n');
  git('init', '-q', '-b', 'main');
  write('README.md', '# Garden\n');
  write('src/plan.ts', 'export const rows = 3;\n'.repeat(5));
  write('.env', 'TOKEN=made-up\n');
  write('config/secrets.json', '{"made":"up"}\n');
  write('pics/dot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  write('data/blob.bin', Buffer.from([1, 2, 0, 3, 4]));
  write('big.txt', 'x'.repeat(500 * 1024));
  write('sub/inner.md', '# Inner\n');
  symlinkSync('../outside.txt', join(repo, 'link.md'));
  git('add', '-A');
  git('commit', '-q', '-m', 'main');
  git('checkout', '-q', '-b', BRANCH);
  write('docs/research/FORMAL_MODEL.md', MODEL);
  write('eval/scripts/frontier_sim.py', 'print("made up")\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'formal model');
  git('checkout', '-q', 'main');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function refusal(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RepoFileError) return error.status;
    throw error;
  }
  return 200;
}

describe('readRepoFile', () => {
  it('reads a Markdown file from a branch with git', async () => {
    const file = await readRepoFile(repo, 'docs/research/FORMAL_MODEL.md', BRANCH);
    expect(file).toMatchObject({ kind: 'markdown', ref: BRANCH, content: MODEL, truncated: false });
    expect(file.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('says a file is not on the ref, and not in the working tree', async () => {
    await expect(readRepoFile(repo, 'docs/research/FORMAL_MODEL.md', 'main')).rejects.toThrow(
      'Not found on main',
    );
    await expect(readRepoFile(repo, 'docs/research/FORMAL_MODEL.md', null)).rejects.toThrow(
      'Not found in the working tree',
    );
    await expect(readRepoFile(repo, 'README.md', 'no-such-branch')).rejects.toThrow(
      'No branch, tag or commit',
    );
  });

  it('reads the working tree, code with its language', async () => {
    expect(await readRepoFile(repo, 'src/plan.ts', null)).toMatchObject({
      kind: 'code',
      language: 'typescript',
      ref: null,
    });
  });

  it('refuses option-looking and odd refs before git sees them', async () => {
    for (const ref of ['-oops', '--output=/tmp/x', 'a..b', 'HEAD@{1}', 'main:README.md', 'a b'])
      expect(await refusal(readRepoFile(repo, 'README.md', ref)), ref).toBe(400);
  });

  it('refuses paths that leave the repository', async () => {
    for (const path of ['../outside.txt', '/etc/hosts', 'src/../../outside.txt', 'a\\b', ''])
      expect(await refusal(readRepoFile(repo, path, null)), path).toBe(400);
    expect(await refusal(readRepoFile(repo, '../outside.txt', 'main'))).toBe(400);
  });

  it('refuses dotfiles, .git and secrets, in the tree and on a ref', async () => {
    for (const ref of [null, 'main'])
      for (const path of ['.env', '.git/config', '.git/HEAD', 'config/secrets.json'])
        expect(await refusal(readRepoFile(repo, path, ref)), `${path}@${ref}`).toBe(403);
  });

  it('refuses links, in the tree and committed', async () => {
    expect(await refusal(readRepoFile(repo, 'link.md', null))).toBe(403);
    expect(await refusal(readRepoFile(repo, 'link.md', 'main'))).toBe(403);
    expect(await refusal(readRepoFile(repo, 'src', 'main'))).toBe(403);
  });

  it('cuts long text, sends pictures as data and no contents for binary files', async () => {
    const big = await readRepoFile(repo, 'big.txt', 'main');
    expect(big.truncated).toBe(true);
    expect(big.content!.length).toBe(400 * 1024);
    expect(big.size).toBe(500 * 1024);
    const pic = await readRepoFile(repo, 'pics/dot.png', null);
    expect(pic.kind).toBe('image');
    expect(pic.content).toMatch(/^data:image\/png;base64,/);
    const bin = await readRepoFile(repo, 'data/blob.bin', 'main');
    expect(bin).toMatchObject({ kind: 'binary', truncated: false });
    expect(bin.content).toBeUndefined();
  });

  it('reads a repository folder below the top of its work tree', async () => {
    const sub = join(repo, 'sub');
    expect((await readRepoFile(sub, 'inner.md', 'main')).content).toBe('# Inner\n');
    expect((await findInRepo(sub, ['inner.md'], 'main')).found).toEqual({
      'inner.md': { ref: 'main' },
    });
  });
});

describe('findInRepo', () => {
  it('finds paths on the ref, else in the working tree, and skips refused ones', async () => {
    const { found } = await findInRepo(
      repo,
      ['docs/research/FORMAL_MODEL.md', 'README.md', 'nope/x.md', '.env', '../outside.txt'],
      BRANCH,
    );
    expect(found).toEqual({
      'docs/research/FORMAL_MODEL.md': { ref: BRANCH },
      'README.md': { ref: BRANCH },
    });
    expect((await findInRepo(repo, ['README.md', 'link.md'], 'Tuesday')).found).toEqual({
      'README.md': { ref: null },
    });
  });
});

describe('routes', () => {
  let store: Store;
  let projectId: string;
  let bare: string;
  const page = { headers: { 'sec-fetch-site': 'same-origin' } };

  beforeAll(() => {
    store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(human, {
      message: 'Set up',
      operations: [
        {
          op: 'create',
          type: 'repository',
          ref: 'r',
          data: { name: 'garden', path: repo, order: 0 },
        },
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden', repositoryId: '$r' } },
        { op: 'create', type: 'project', ref: 'q', data: { name: 'No repository' } },
      ],
    });
    projectId = created.p!;
    bare = created.q!;
  });

  const app = () => createApp(store, new RevisionFeed(store));

  it('serves the owner', async () => {
    const res = await app().request(
      repoFileUrl(projectId, 'docs/research/FORMAL_MODEL.md', BRANCH),
      page,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as RepoFile).content).toBe(MODEL);
    const paths = await app().request(
      repoPathsUrl(
        projectId,
        ['docs/research/FORMAL_MODEL.md', 'eval/scripts/frontier_sim.py'],
        BRANCH,
      ),
      page,
    );
    expect(Object.keys(((await paths.json()) as { found: object }).found)).toHaveLength(2);
  });

  it('refuses agents, and requests not from the Pharos page', async () => {
    const url = repoFileUrl(projectId, 'README.md');
    for (const author of ['agent:Claude Code', 'system:pharos', 'weird']) {
      const res = await app().request(url, {
        headers: { ...page.headers, 'x-pharos-author': author },
      });
      expect(res.status, author).toBe(403);
    }
    const paths = await app().request(repoPathsUrl(projectId, ['README.md']), {
      headers: { ...page.headers, 'x-pharos-author': 'agent:codex' },
    });
    expect(paths.status).toBe(403);
    expect((await app().request(url)).status).toBe(403);
    expect((await app().request(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(
      403,
    );
  });

  it('answers not found calmly for a missing file or a project without a repository', async () => {
    const missing = await app().request(repoFileUrl(projectId, 'docs/nope.md', 'main'), page);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toBe(
      'Not found on main',
    );
    expect((await app().request(repoFileUrl(bare, 'README.md'), page)).status).toBe(404);
    expect((await app().request(repoFileUrl(projectId, '.env'), page)).status).toBe(403);
  });
});
