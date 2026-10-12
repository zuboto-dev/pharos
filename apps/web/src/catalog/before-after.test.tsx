import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { paneParts } from './components/before-after';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

afterEach(cleanup);

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};

const artifact = (id: string, title: string, uri: string) =>
  ({
    id,
    type: 'artifact',
    data: { projectId: P, title, kind: 'link', status: 'delivered', uri },
    ...meta,
  }) as Entity<'artifact'>;

const claim = (id: string, data: Partial<Entity<'claim'>['data']>) =>
  ({
    id,
    type: 'claim',
    data: {
      projectId: P,
      statement: `Statement ${id}`,
      certainty: 'verified',
      checkedOn: '2026-10-11',
      sourceIds: [],
      tags: [],
      order: 0,
      ...data,
    },
    ...meta,
  }) as Entity<'claim'>;

const OLD = [
  '# Setup',
  'Install pnpm first.',
  'Run pnpm dev to start the server.',
  'Open the app.',
];
const NEW = [
  '# Setup',
  'Install pnpm first.',
  'Run pnpm service install to start the server.',
  'Open the app.',
];

const data: ProjectDataset = {
  ...base,
  artifacts: [
    artifact('art_old', 'README at 8bb6b32', 'README.md'),
    artifact('art_new', 'README on main', 'README.md'),
  ],
  claims: [
    claim('clm_change', {
      statement: 'The guide now starts the server as a service.',
      certainty: 'reading',
      quote: 'Run pnpm service install to start the server.',
      assumption: 'The change is not yet published.',
      sourceIds: ['art_new'],
    }),
    claim('clm_before', {
      quote: OLD.join('\n'),
      locator: 'commit 8bb6b32, line 12',
      sourceIds: ['art_old'],
    }),
    claim('clm_after', { quote: NEW.join('\n'), locator: 'main, line 12', sourceIds: ['art_new'] }),
    claim('clm_added', { quote: [...OLD, 'Stop it with Ctrl+C.'].join('\n') }),
    claim('clm_same', { quote: OLD.join('\n') }),
    claim('clm_unquoted', {}),
    claim('clm_ab', { quote: 'Line A\nLine B' }),
    claim('clm_ba', { quote: 'Line B\nLine A' }),
  ],
};

type BeforeAfterNode = Extract<ViewNode, { component: 'BeforeAfter' }>;

const spec = (extra: Partial<BeforeAfterNode> = {}): ViewNode => ({
  component: 'BeforeAfter',
  claim: 'clm_change',
  before: 'clm_before',
  after: 'clm_after',
  beforeLabel: '8bb6b32',
  afterLabel: 'main',
  ...extra,
});

function renderSpec(node: ViewNode) {
  return render(
    <ViewDataProvider data={data} version={1}>
      <ViewRenderer spec={node} />
    </ViewDataProvider>,
  );
}

const pane = (side: 'Before' | 'After') =>
  screen.getByRole('region', { name: new RegExp(`^${side}`) });

describe('BeforeAfter', () => {
  it('states the change above two labelled panes', () => {
    const { container } = renderSpec(spec());
    expect(container.textContent).toContain('The guide now starts the server as a service.');
    const before = screen.getByRole('region', { name: 'Before, 8bb6b32' });
    const after = screen.getByRole('region', { name: 'After, main' });
    expect(within(before).getByRole('heading').textContent).toBe('Before · 8bb6b32');
    expect(within(after).getByRole('heading').textContent).toBe('After · main');
  });

  it('shows only the changed lines, with removed words in <del> and added in <ins>', () => {
    renderSpec(spec());
    const before = pane('Before');
    const after = pane('After');
    const passage = (el: HTMLElement) => el.querySelector('blockquote')!.textContent;
    expect(passage(before)).toContain('Run pnpm');
    expect(passage(before)).not.toContain('Install pnpm first.');
    expect(passage(after)).not.toContain('Open the app.');
    expect([...before.querySelectorAll('del')].map((d) => d.textContent?.trim())).toEqual(['dev']);
    expect(before.querySelector('ins')).toBeNull();
    expect([...after.querySelectorAll('ins')].map((d) => d.textContent?.trim())).toEqual([
      'service install',
    ]);
    expect(after.querySelector('del')).toBeNull();
    expect(before.textContent).toContain('3 unchanged lines not shown');
    expect(after.textContent).toContain('3 unchanged lines not shown');
  });

  it('labels changes in words, not colour alone', () => {
    renderSpec(spec());
    expect(pane('Before').querySelector('blockquote')!.textContent).toContain('[removed: dev ]');
    expect(pane('After').querySelector('blockquote')!.textContent).toContain(
      '[added: service install ]',
    );
  });

  it("opens each pane's source and quote from its mark, with the locator beside it", () => {
    renderSpec(spec());
    const before = pane('Before');
    expect(before.textContent).toContain('commit 8bb6b32, line 12');
    fireEvent.click(within(before).getByRole('button', { name: /^From source, / }));
    const popover = screen.getByRole('dialog');
    expect(popover.textContent).toContain('README at 8bb6b32');
    expect(popover.textContent).toContain('Run pnpm dev to start the server.');
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const after = pane('After');
    expect(after.textContent).toContain('main, line 12');
    fireEvent.click(within(after).getByRole('button', { name: /^From source, / }));
    expect(screen.getByRole('dialog').textContent).toContain('README on main');
  });

  it('marks a line only added, with nothing in the before pane', () => {
    renderSpec(spec({ after: 'clm_added' }));
    const before = pane('Before');
    expect(before.textContent).toContain('Nothing here before');
    expect(before.textContent).toContain('4 unchanged lines not shown');
    expect(pane('After').querySelector('ins')?.textContent?.trim()).toBe('Stop it with Ctrl+C.');
  });

  it('shows the whole passage when nothing changed', () => {
    const { container } = renderSpec(spec({ after: 'clm_same' }));
    expect(container.textContent).toContain('The two passages are the same.');
    expect(container.querySelector('del, ins')).toBeNull();
    expect(pane('After').textContent).toContain('Open the app.');
  });

  it('gives the stated change its own mark and quote/assumption, beneath its statement', () => {
    const { container } = renderSpec(spec());
    const statement = screen.getByText('The guide now starts the server as a service.');
    const evidence = statement.nextElementSibling as HTMLElement;
    const basis = within(evidence).getByRole('button', { name: /Quote and assumption/ });
    fireEvent.click(basis);
    expect(container.textContent).toContain('The change is not yet published.');
    fireEvent.click(within(evidence).getAllByRole('button', { name: /reading/i })[0]!);
    expect(screen.getByRole('dialog').textContent).toContain('README on main');
  });

  it('treats reordered lines as a change and shows both passages whole', () => {
    const { container } = renderSpec(spec({ before: 'clm_ab', after: 'clm_ba' }));
    expect(container.textContent).not.toContain('The two passages are the same.');
    expect(container.textContent).toContain('The same lines, in a different order.');
    expect(pane('Before').querySelector('blockquote')!.textContent).toBe('Line A\nLine B');
    expect(pane('After').querySelector('blockquote')!.textContent).toBe('Line B\nLine A');
  });

  it('says when a passage is missing or unquoted', () => {
    renderSpec(spec({ before: 'clm_gone', after: 'clm_unquoted' }));
    expect(pane('Before').textContent).toContain('This passage was deleted');
    expect(pane('After').textContent).toContain('No passage quoted');
    cleanup();
    const { container } = renderSpec(spec({ before: 'clm_gone', after: 'clm_gone2' }));
    expect(container.textContent).toContain('These passages were deleted');
  });

  it('stacks the panes until its container is wide enough', () => {
    renderSpec(spec());
    const grid = pane('Before').parentElement!;
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('@lg:grid-cols-2');
    expect(grid.className).not.toMatch(/(^| )grid-cols-2/);
  });
});

describe('paneParts', () => {
  it("keeps the before pane's own line breaks", () => {
    const before = 'one two\nthree';
    const after = 'one 2 three';
    const parts = paneParts('Before', before, after);
    expect(parts.map((p) => p.text).join('')).toBe(before);
    expect(parts.filter((p) => p.op === 'removed').map((p) => p.text.trim())).toEqual(['two']);
    const afterParts = paneParts('After', before, after);
    expect(afterParts.map((p) => p.text).join('')).toBe(after);
  });
});
