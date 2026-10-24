// Repository file links (repo: links) in Markdown and their viewer. Every repository, branch and
// file here is made up; fetch is stubbed, so no request leaves the test.
import {
  findRepoPaths,
  parseRepoHref,
  refInSentence,
  repoHref,
  repoPathInCode,
  type ProjectDataset,
  type RepoFile,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider } from '../catalog/context';
import { Markdown } from '../catalog/ui';
import { clearRepoPathCache } from './repo-links';
import { resolveRelative } from './repo-viewer';

const data = dataset as unknown as ProjectDataset;
const BRANCH = 'review/formal-model';
const MODEL =
  '# Formal model\n\nA made-up model of a **garden** queue, checked by `eval/scripts/frontier_sim.py`.\n';

describe('repo: links', () => {
  it('parses path, ref and lines', () => {
    expect(parseRepoHref('repo:docs/research/FORMAL_MODEL.md@review/formal-model')).toEqual({
      path: 'docs/research/FORMAL_MODEL.md',
      ref: BRANCH,
    });
    expect(parseRepoHref('repo:src/a.ts#L10-L40')).toEqual({
      path: 'src/a.ts',
      lines: { from: 10, to: 40 },
    });
    expect(parseRepoHref('repo:src/a.ts@main#L7')).toEqual({
      path: 'src/a.ts',
      ref: 'main',
      lines: { from: 7, to: 7 },
    });
    expect(parseRepoHref('repo:My%20Notes/a%20b.md')).toEqual({ path: 'My Notes/a b.md' });
    for (const bad of ['repo:../x.md', 'repo:/etc/hosts', 'repo:a/../../b', 'https://x.io/a.md'])
      expect(parseRepoHref(bad), bad).toBeNull();
    // An option-looking ref isn't a ref: it stays part of the path.
    expect(parseRepoHref('repo:a.md@-oops')).toEqual({ path: 'a.md@-oops' });
    expect(
      parseRepoHref(repoHref({ path: 'a b/c.md', ref: 'main', lines: { from: 2, to: 5 } })),
    ).toEqual({ path: 'a b/c.md', ref: 'main', lines: { from: 2, to: 5 } });
  });

  it('finds candidate paths in text, conservatively', () => {
    const text =
      'docs/research/FORMAL_MODEL.md and eval/scripts/frontier_sim.py, written today on review/formal-model.';
    expect(findRepoPaths(text).map((f) => f.path)).toEqual([
      'docs/research/FORMAL_MODEL.md',
      'eval/scripts/frontier_sim.py',
    ]);
    expect(refInSentence(text)).toBe(BRANCH);
    expect(refInSentence('Fixed on branch main.')).toBe('main');
    expect(refInSentence('Written on docs/a.md')).toBeUndefined();
    expect(refInSentence('Checks rule 3 on 1,000 made-up seasons.')).toBeUndefined();
    expect(refInSentence('Written on Tuesday on review/x.')).toBe('review/x');
    expect(findRepoPaths('See https://example.com/docs/a.md or example.com/a.md')).toEqual([]);
    expect(findRepoPaths('version 1.2, a/b, and README.md')).toEqual([]);
    expect(repoPathInCode('README.md')).toBe('README.md');
    expect(repoPathInCode('./src/a.ts')).toBe('src/a.ts');
    expect(repoPathInCode('npm run build')).toBeNull();
    expect(repoPathInCode('1.2.3')).toBeNull();
  });

  it('resolves links inside a Markdown file against its folder', () => {
    expect(resolveRelative('docs/research/A.md', '../B.md')).toBe('docs/B.md');
    expect(resolveRelative('docs/A.md', './c/d.md#top')).toBe('docs/c/d.md');
    expect(resolveRelative('A.md', '../../x.md')).toBeNull();
    expect(resolveRelative('A.md', 'https://example.com')).toBeNull();
    expect(resolveRelative('A.md', '#part')).toBeNull();
  });
});

describe('in Markdown', () => {
  let requests: string[];

  beforeEach(() => {
    requests = [];
    clearRepoPathCache();
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/repo-paths')) {
        const ref = url.searchParams.get('ref');
        const found: Record<string, { ref: string | null }> = {};
        for (const p of url.searchParams.getAll('path'))
          if (p.startsWith('docs/') || p.startsWith('eval/')) found[p] = { ref };
          else if (p === 'README.md') found[p] = { ref: null };
        return Response.json({ found });
      }
      if (url.pathname.endsWith('/repo-file')) {
        const path = url.searchParams.get('path')!;
        const ref = url.searchParams.get('ref');
        if (path === 'docs/research/FORMAL_MODEL.md' && ref === BRANCH)
          return Response.json({
            path,
            ref,
            size: MODEL.length,
            kind: 'markdown',
            content: MODEL,
            truncated: false,
          } satisfies RepoFile);
        if (path === 'src/plan.ts')
          return Response.json({
            path,
            ref,
            size: 40,
            kind: 'code',
            language: 'typescript',
            content: 'a\nb\nc\nd\ne\n',
            truncated: false,
          } satisfies RepoFile);
        return Response.json(
          { error: { code: 'not_found', message: `Not found on ${ref ?? 'main'}` } },
          { status: 404 },
        );
      }
      return Response.json({});
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
  });

  const show = (text: string, d: ProjectDataset = data) =>
    render(
      <ViewDataProvider data={d} version={1}>
        <Markdown>{text}</Markdown>
      </ViewDataProvider>,
    );

  it('opens a repo: link in a viewer with the rendered Markdown; Esc closes it', async () => {
    show('Read [the model](repo:docs/research/FORMAL_MODEL.md@review/formal-model).');
    fireEvent.click(screen.getByRole('button', { name: 'the model' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe(`docs/research/FORMAL_MODEL.md on ${BRANCH}`);
    expect(await within(dialog).findByRole('heading', { name: 'Formal model' })).toBeTruthy();
    expect(within(dialog).getByText('garden').tagName).toBe('STRONG');
    expect(within(dialog).getByText(BRANCH)).toBeTruthy();
    // A path in the file is looked up at the branch the file is shown at.
    const inner = await within(dialog).findByRole('button', {
      name: 'eval/scripts/frontier_sim.py',
    });
    expect(inner.getAttribute('title')).toBe(`Open eval/scripts/frontier_sim.py on ${BRANCH}`);
    expect(requests).toContain(
      `/api/projects/${data.project.id}/repo-file?path=docs%2Fresearch%2FFORMAL_MODEL.md&ref=review%2Fformal-model`,
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('links plain-text paths the repository has, at the branch the sentence names', async () => {
    show(
      'docs/research/FORMAL_MODEL.md and eval/scripts/frontier_sim.py, written today on review/formal-model. Not `other/missing.md`, nor `README` text.',
    );
    const link = await screen.findByRole('button', { name: 'docs/research/FORMAL_MODEL.md' });
    expect(link.getAttribute('title')).toBe(`Open docs/research/FORMAL_MODEL.md on ${BRANCH}`);
    expect(screen.getByRole('button', { name: 'eval/scripts/frontier_sim.py' })).toBeTruthy();
    // One request for every candidate in the sentence; the missing one stays text.
    const checks = requests.filter((r) => r.includes('/repo-paths'));
    expect(checks).toHaveLength(2);
    expect(screen.getByText('other/missing.md').closest('button')).toBeNull();
    fireEvent.click(link);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('heading', { name: 'Formal model' })).toBeTruthy();
  });

  it('links inline code in the working tree when no branch is named', async () => {
    show('See `README.md` first.');
    const link = await screen.findByRole('button', { name: 'README.md' });
    expect(link.getAttribute('title')).toBe('Open README.md');
    expect(link.querySelector('code')).toBeTruthy();
  });

  it('shows code with line numbers and marks the linked lines', async () => {
    show('[plan](repo:src/plan.ts#L2-L3)');
    fireEvent.click(screen.getByRole('button', { name: 'plan' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('d');
    const marked = [...dialog.querySelectorAll('tr[data-marked]')].map((r) =>
      r.getAttribute('data-line'),
    );
    expect(marked).toEqual(['2', '3']);
    expect(dialog.querySelectorAll('tr[data-line]')).toHaveLength(5);
  });

  it('says calmly when the file is not on the ref', async () => {
    show('[gone](repo:docs/gone.md@main)');
    fireEvent.click(screen.getByRole('button', { name: 'gone' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Not found on main')).toBeTruthy();
  });

  it('without a repository: no checks, and a repo: link is just text', async () => {
    const bare = { ...data, repository: undefined } as unknown as ProjectDataset;
    show('docs/research/FORMAL_MODEL.md and [x](repo:docs/x.md)', bare);
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(screen.queryByRole('button')).toBeNull();
    expect(requests).toEqual([]);
  });
});
