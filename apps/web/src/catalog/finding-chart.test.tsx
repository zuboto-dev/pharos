import { optionsFor, type Entity, type ProjectDataset, type ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
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

const artifact = (id: string, title: string, uri?: string) =>
  ({
    id,
    type: 'artifact',
    data: { projectId: P, title, kind: 'link', status: 'delivered', ...(uri ? { uri } : {}) },
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

const data = {
  ...base,
  artifacts: [
    ...base.artifacts,
    artifact('art_report', 'OpenUI benchmark', 'https://example.com/bench'),
    artifact('art_notes', 'Notes', 'docs/notes.md'),
  ],
  claims: [
    claim('clm_head', { statement: 'OpenUI needs half the tokens.', sourceIds: ['art_report'] }),
    claim('clm_json', {
      statement: 'OpenUI says JSON needs 10,180 tokens.',
      figure: { value: 10180, unit: 'tokens', label: 'JSON' },
      quote: 'JSON took 10,180 tokens.',
      locator: '§3 Results',
      sourceIds: ['art_report'],
      tags: ['bench'],
      order: 1,
    }),
    claim('clm_openui', {
      statement: 'OpenUI says it needs 4,800 tokens.',
      figure: { value: 4800, unit: 'tokens', label: 'OpenUI' },
      quote: 'OpenUI took 4,800 tokens.',
      locator: '§3 Results',
      sourceIds: ['art_report'],
      tags: ['bench'],
      order: 0,
    }),
    claim('clm_local', {
      statement: 'Our notes say 82.8% of screens fit.',
      figure: { value: 82.8, unit: '%', label: 'Fit' },
      quote: '82.8% fit on one screen.',
      sourceIds: ['art_notes'],
      tags: ['local'],
    }),
    claim('clm_nofigure', { tags: ['bench'], order: 2 }),
    claim('clm_count', {
      statement: '2 of the 7 tools say how sure they are.',
      certainty: 'reading',
      figure: { value: 2, unit: 'of 7', label: 'Says how sure' },
      assumption: 'Counted from each tool’s own pages.',
      sourceIds: ['art_report', 'art_notes'],
      tags: ['count'],
      order: 0,
    }),
    claim('clm_count_steps', {
      statement: '6 of the 7 tools show their steps.',
      certainty: 'reading',
      figure: { value: 6, unit: 'of 7', label: 'Shows steps' },
      assumption: 'Counted from each tool’s own pages.',
      sourceIds: ['art_report'],
      tags: ['count'],
      order: 1,
    }),
  ],
} as unknown as ProjectDataset;

function renderChart(node: Partial<Extract<ViewNode, { component: 'FindingChart' }>>) {
  const open = vi.fn();
  const actions = { open } as unknown as ViewActions;
  const utils = render(
    <ViewDataProvider data={data} version={1} actions={actions}>
      <ViewRenderer spec={{ component: 'FindingChart', ...node }} />
    </ViewDataProvider>,
  );
  return { ...utils, open };
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('li')].map((li) => li.textContent);
const lit = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-highlighted]')].map(
    (bar) => bar.closest('li')?.querySelector('span')?.textContent,
  );

describe('FindingChart', () => {
  it('titles the chart with the stored claim and its mark, and labels each bar', () => {
    const { container } = renderChart({ claim: 'clm_head', bars: { where: { tags: 'bench' } } });
    const caption = container.querySelector('figcaption')!;
    expect(caption.textContent).toContain('OpenUI needs half the tokens.');
    expect(caption.textContent).toMatch(/Oct 11/);
    // In claim order; a claim without a figure draws no bar.
    expect(rows(container)).toEqual([
      `OpenUI${(4800).toLocaleString()} tokens`,
      `JSON${(10180).toLocaleString()} tokens`,
    ]);
    expect(screen.getByRole('list', { name: 'OpenUI needs half the tokens.' })).toBeTruthy();
    // No legend and no axis: every label and value sits on its bar.
    expect(container.querySelector('svg[role="img"], [role="legend"]')).toBeNull();
  });

  it('draws every bar on one scale, the highlighted one in the accent colour', () => {
    const { container } = renderChart({
      bars: { where: { tags: 'bench' } },
      highlight: 'clm_json',
    });
    const fills = [...container.querySelectorAll<HTMLElement>('li [aria-hidden][style]')];
    expect(fills.map((f) => f.style.width)).toEqual([
      `calc((100% - 14ch) * ${4800 / 10180})`,
      'calc((100% - 14ch) * 1)',
    ]);
    expect(fills[1]!.className).toContain('bg-sky-500');
    expect(fills[0]!.className).not.toContain('bg-sky-500');
    expect(lit(container)).toEqual(['JSON']);
    expect(screen.getByRole('button', { name: /JSON, 10,180 tokens, highlighted/ })).toBeTruthy();
  });

  it('highlights the first bar by default', () => {
    const { container } = renderChart({ bars: { where: { tags: 'bench' } } });
    expect(lit(container)).toEqual(['OpenUI']);
  });

  it('opens a bar to its claim, quote, locator and source, and closes again', () => {
    renderChart({ bars: { where: { tags: 'bench' } } });
    const bar = screen.getByRole('button', { name: /^OpenUI, 4,800 tokens/ });
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bar);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'OpenUI says it needs 4,800 tokens.' });
    expect(bar.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.textContent).toContain('“OpenUI took 4,800 tokens.”');
    expect(panel.textContent).toContain('§3 Results');
    const link = within(panel).getByRole('link', { name: /OpenUI benchmark/ });
    expect(link.getAttribute('href')).toBe('https://example.com/bench');
    // One open at a time.
    fireEvent.click(screen.getByRole('button', { name: /^JSON/ }));
    expect(screen.queryByRole('region', { name: 'OpenUI says it needs 4,800 tokens.' })).toBeNull();
    expect(
      screen.getByRole('region', { name: 'OpenUI says JSON needs 10,180 tokens.' }),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: /^JSON/ }), { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens a counted bar to its assumption and every source behind it', () => {
    renderChart({ bars: { where: { tags: 'count' } } });
    fireEvent.click(screen.getByRole('button', { name: /^Says how sure, 2 of 7/ }));
    const panel = screen.getByRole('region', { name: '2 of the 7 tools say how sure they are.' });
    // The basis is open already, and can be closed.
    const basis = within(panel).getByRole('button', { name: /Assumption/ });
    expect(basis.getAttribute('aria-expanded')).toBe('true');
    expect(panel.textContent).toContain('Assumes: Counted from each tool’s own pages.');
    expect(panel.textContent).toContain('Sources (2)');
    expect(within(panel).getByRole('link', { name: /OpenUI benchmark/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(panel.textContent).toContain('docs/notes.md');
    fireEvent.click(basis);
    expect(panel.textContent).not.toContain('Assumes:');
    // The mark's popover names the assumption too.
    fireEvent.click(within(panel).getByRole('button', { name: /Sources \(2\)/ }));
    expect(screen.getByRole('dialog').textContent).toContain(
      'Assumes: Counted from each tool’s own pages.',
    );
  });

  it('draws bars against a maximum on a faint full-length track', () => {
    const { container } = renderChart({ bars: { where: { tags: 'count' } }, max: 7 });
    const tracks = [...container.querySelectorAll<HTMLElement>('[data-track]')];
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.style.width)).toEqual(['calc(100% - 7ch)', 'calc(100% - 7ch)']);
    const fills = tracks.map((t) => t.firstElementChild as HTMLElement);
    expect(fills.map((f) => f.style.width)).toEqual([`${(2 / 7) * 100}%`, `${(6 / 7) * 100}%`]);
    expect(fills[0]!.className).toContain('bg-sky-500');
    // A figure over the maximum fills the track and no more.
    cleanup();
    const over = renderChart({ bars: { where: { tags: 'count' } }, max: 4 }).container;
    const capped = [...over.querySelectorAll<HTMLElement>('[data-track] > span')];
    expect(capped.map((f) => f.style.width)).toEqual(['50%', '100%']);
    cleanup();
    // Without a maximum there is no track; the longest bar fills the width.
    const plain = renderChart({ bars: { where: { tags: 'count' } } }).container;
    expect(plain.querySelector('[data-track]')).toBeNull();
  });

  it('opens a local source in the drawer and shows its path', () => {
    const { open } = renderChart({ bars: { where: { tags: 'local' } } });
    fireEvent.click(screen.getByRole('button', { name: /^Fit, 82\.8%/ }));
    const panel = screen.getByRole('region');
    expect(panel.textContent).toContain('docs/notes.md');
    fireEvent.click(within(panel).getByRole('button', { name: 'Notes' }));
    expect(open).toHaveBeenCalledWith({ entity: 'art_notes' });
  });

  it('moves between bars with the arrow keys, Home and End', () => {
    renderChart({ bars: { where: { tags: 'bench' } } });
    const [first, second] = screen.getAllByRole('button', { name: /tokens/ });
    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first!, { key: 'End' });
    expect(document.activeElement).toBe(second);
  });

  it('counts project items with option labels, in the option order', () => {
    const { container } = renderChart({
      count: { query: { type: 'task' }, by: 'status' },
      highlight: 'blocked',
    });
    const order = optionsFor(data.project, 'task.status');
    const label = (v: string) => order.find((o) => o.value === v)!.label;
    expect(rows(container)).toEqual(
      [
        ['todo', 3],
        ['in_progress', 2],
        ['blocked', 1],
        ['done', 3],
      ]
        .sort(
          ([a], [b]) =>
            order.findIndex((o) => o.value === a) - order.findIndex((o) => o.value === b),
        )
        .map(([v, n]) => `${label(v as string)}${n}`),
    );
    expect(lit(container)).toEqual([label('blocked')]);
    // Counted bars have no claim behind them, so they are not buttons.
    expect(screen.queryAllByRole('button', { name: /highlighted/ })).toEqual([]);
  });

  it('names referenced items, sorts by count, keeps the limit and highlights by label', () => {
    const { container } = renderChart({
      count: { query: { type: 'task' }, by: 'stageId', sort: 'count', limit: 2 },
      highlight: 'm3 generative views',
    });
    expect(rows(container)).toEqual(['M2 Catalog + renderer5', 'M3 Generative views2']);
    expect(lit(container)).toEqual(['M3 Generative views']);
  });

  it('draws bars from claims when both bars and count are set', () => {
    const { container } = renderChart({
      bars: { where: { tags: 'bench' } },
      count: { query: { type: 'task' }, by: 'status' },
    });
    expect(rows(container)).toHaveLength(2);
    expect(rows(container)[0]).toContain('OpenUI');
  });

  it('says so when there is nothing to draw', () => {
    const { container } = renderChart({ claim: 'clm_head', bars: { where: { tags: 'none' } } });
    expect(container.textContent).toContain('No numbers to draw yet');
    expect(container.textContent).toContain('OpenUI needs half the tokens.');
  });
});
