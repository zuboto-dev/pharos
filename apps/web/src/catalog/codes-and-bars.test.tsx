import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { fillTemplate } from './components/generic';
import { ViewDataProvider, useViewData, type ViewActions } from './context';
import { ViewRenderer } from './renderer';

// R4.8: short evidence labels (F5), hidden work codes and row terms (F6), and small bars (block 6).

vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};
const CODED = base.tasks[0]!.id;
const recipe = {
  id: 'term_recipe',
  type: 'term',
  data: { projectId: P, word: 'baseline', explanation: 'What we compare to.', alsoCalled: [] },
  ...meta,
} as Entity<'term'>;
const report = {
  id: 'art_report',
  type: 'artifact',
  data: {
    projectId: P,
    title: 'Reader test run on the new report page, round two',
    kind: 'link',
    status: 'delivered',
    uri: 'https://example.com/run',
  },
  ...meta,
} as Entity<'artifact'>;
const data: ProjectDataset = {
  ...base,
  tasks: base.tasks.map((t) =>
    t.id === CODED ? { ...t, data: { ...t.data, title: 'W3.8 · Measure the baseline' } } : t,
  ),
  artifacts: [...base.artifacts, report],
  claims: [],
  terms: [recipe],
};

function renderNode(node: ViewNode, actions?: Partial<ViewActions>) {
  return render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open: () => {}, ...actions }}
    >
      <ViewRenderer spec={node} />
    </ViewDataProvider>,
  );
}

const coded = { type: 'task' as const, where: { id: CODED } };

describe('F5 short evidence labels in StartHere', () => {
  const start = (evidence: unknown[]) =>
    ({
      component: 'StartHere',
      purpose: 'done',
      headline: 'Report pages now open with a start-here block.',
      evidence,
      date: '2026-10-12',
      path: [{ label: 'Read on' }],
    }) as ViewNode;

  it('shows a label instead of the title, keeping the title as tooltip and name', () => {
    const open = vi.fn();
    renderNode(
      start([
        { id: 'art_report', label: 'Test run' },
        { id: CODED, label: 'Baseline task' },
      ]),
      { open },
    );
    const link = screen.getByRole('link', { name: /Test run/ });
    expect(link.getAttribute('title')).toBe(report.data.title);
    expect(link.textContent).toContain(report.data.title); // screen-reader text
    const visible = [...link.querySelectorAll('span.truncate')].map(
      (s) => s.firstChild?.textContent,
    );
    expect(visible[0]).toBe('Test run');
    const button = screen.getByRole('button', { name: /Baseline task/ });
    expect(button.getAttribute('title')).toBe('W3.8 · Measure the baseline');
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith({ entity: CODED });
  });

  it('plain ids still show titles, and the two forms mix', () => {
    renderNode(start(['art_report', { id: CODED, label: 'Baseline' }, 'missing_id']));
    const link = screen.getByRole('link', { name: new RegExp(report.data.title) });
    expect(link.getAttribute('title')).toBe('https://example.com/run');
    expect(screen.getByRole('button', { name: /^Baseline/ })).toBeTruthy();
  });
});

describe('F6 hidden work codes and row terms', () => {
  it('TaskTable hides codes only when asked', () => {
    renderNode({ component: 'TaskTable', filter: { where: { id: CODED } } });
    expect(screen.getByText('W3.8 · Measure the baseline')).toBeTruthy();
    cleanup();
    renderNode({ component: 'TaskTable', filter: { where: { id: CODED } }, hideCodes: true });
    expect(screen.getByText('Measure the baseline')).toBeTruthy();
    expect(screen.queryByText(/W3\.8/)).toBeNull();
  });

  it('TaskTable marks terms in rows only with terms: true', () => {
    renderNode({ component: 'TaskTable', filter: { where: { id: CODED } }, hideCodes: true });
    expect(screen.queryByTitle('What “baseline” means')).toBeNull();
    cleanup();
    const open = vi.fn();
    renderNode(
      { component: 'TaskTable', filter: { where: { id: CODED } }, hideCodes: true, terms: true },
      { open },
    );
    const term = screen.getByTitle('What “baseline” means');
    expect(term.textContent).toBe('baseline');
    // Explaining a term doesn't open the task.
    fireEvent.click(term);
    expect(open).not.toHaveBeenCalled();
  });

  it('DataList hides codes and marks terms only when asked', () => {
    renderNode({ component: 'DataList', query: coded });
    expect(screen.getByText('W3.8 · Measure the baseline')).toBeTruthy();
    expect(screen.queryByTitle('What “baseline” means')).toBeNull();
    cleanup();
    renderNode({ component: 'DataList', query: coded, hideCodes: true, terms: true });
    const item = screen.getByRole('listitem');
    expect(item.textContent).toBe('Measure the baseline');
    expect(within(item).getByTitle('What “baseline” means')).toBeTruthy();
  });
});

describe('small bars', () => {
  const done = { type: 'task' as const, where: { status: 'done' } };
  const all = { type: 'task' as const };

  it('StatCards draws a bar with "x of y" when a stat has `of`, and none otherwise', () => {
    const { container } = renderNode({
      component: 'StatCards',
      stats: [
        { label: 'Done', query: done, of: all },
        { label: 'Open', query: { type: 'task', where: { status: 'todo' } } },
      ],
    });
    const bars = container.querySelectorAll('[data-mini-bar]');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.getAttribute('aria-hidden')).toBe('true');
    const fill = bars[0]!.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe(`${(3 / 9) * 100}%`);
    // The text equivalent: "3 of 9" for screen readers, "3 / 9" on screen.
    const number = screen.getByText('Done').nextElementSibling!;
    expect(number.textContent).toBe('3 /  of 9');
    expect(number.querySelector('.sr-only')!.textContent).toBe(' of ');
  });

  it('Text renders {bar} as an inline bar with "x of y"', () => {
    const { container } = renderNode({
      component: 'Text',
      content: 'Done so far: ${done} — see [the plan](https://example.com/plan).',
      values: { done: { bar: { query: done, of: all } } },
    });
    const inline = container.querySelector('[data-inline-bar]')!;
    expect(inline.textContent).toBe('3 of 9');
    expect(inline.closest('p')!.textContent).toBe('Done so far: 3 of 9 — see the plan.');
    expect(inline.querySelector('[data-mini-bar]')!.getAttribute('aria-hidden')).toBe('true');
    // The bar is not a link; ordinary links still are.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'the plan' }).getAttribute('href')).toBe(
      'https://example.com/plan',
    );
  });

  it('fillTemplate writes the bar as a fragment link, so the text reads "x of y"', () => {
    let filled = '';
    function Probe() {
      filled = fillTemplate(
        {
          component: 'Text',
          content: '${done}',
          values: { done: { bar: { query: done, of: all } } },
        },
        useViewData(),
      );
      return null;
    }
    render(
      <ViewDataProvider data={data} version={1}>
        <Probe />
      </ViewDataProvider>,
    );
    expect(filled).toBe('[3 of 9](#pharos-bar-3-9)');
  });

  it('an empty total draws an empty bar', () => {
    const { container } = renderNode({
      component: 'StatCards',
      stats: [
        {
          label: 'None',
          query: { type: 'task', where: { id: 'nothing' } },
          of: { type: 'task', where: { id: 'nothing' } },
        },
      ],
    });
    const fill = container.querySelector('[data-mini-bar]')!.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });
});
