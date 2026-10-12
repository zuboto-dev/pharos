import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ViewRenderer } from './renderer';

// R3.1: the StartHere block that opens a report page (docs/reframe/start-here.md).

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const STAGE = base.stages[0]!;
const TASK = base.tasks[0]!;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};
const report = {
  id: 'art_report',
  type: 'artifact',
  data: {
    projectId: P,
    title: 'Test run',
    kind: 'link',
    status: 'delivered',
    uri: 'https://example.com/run',
  },
  ...meta,
} as Entity<'artifact'>;
const finding = {
  id: 'clm_point',
  type: 'claim',
  data: {
    projectId: P,
    statement: 'Readers find the point faster when it comes first.',
    certainty: 'reading',
    checkedOn: '2026-10-11',
    sourceIds: ['art_report'],
    tags: [],
    order: 0,
  },
  ...meta,
} as Entity<'claim'>;
const data: ProjectDataset = {
  ...base,
  artifacts: [...base.artifacts, report],
  claims: [finding],
  terms: [],
};

const start = (extra: Record<string, unknown> = {}) =>
  ({
    component: 'StartHere',
    purpose: 'done',
    headline: 'Report pages now open with a start-here block.',
    evidence: ['art_report', TASK.id],
    stageId: STAGE.id,
    date: '2026-10-12',
    path: [
      { label: 'What changed', says: 'The block, before and after', target: 'changed' },
      { label: 'What is left', says: 'Two open points' },
    ],
    ...extra,
  }) as ViewNode;

function renderBoard(node: ViewNode, actions?: Partial<ViewActions>) {
  return render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open: () => {}, ...actions }}
    >
      <ViewRenderer
        spec={{
          component: 'Board',
          widgets: [
            { id: 'start', node },
            { id: 'changed', node: { component: 'Text', content: 'What changed, in full.' } },
          ],
        }}
      />
    </ViewDataProvider>,
  );
}

describe('StartHere', () => {
  it('shows the purpose, headline, where it sits and the numbered path', () => {
    renderBoard(start());
    const opening = screen.getByRole('region', { name: 'Done: start here' });
    expect(within(opening).getByText('Done')).toBeTruthy();
    expect(within(opening).getByRole('heading', { level: 2 }).textContent).toBe(
      'Report pages now open with a start-here block.',
    );
    const where = within(opening).getByRole('navigation', { name: 'Where this sits' });
    expect(where.textContent).toContain('Pharos');
    expect(where.textContent).toContain(STAGE.data.name);
    expect(where.querySelector('time')!.getAttribute('dateTime')).toBe('2026-10-12');
    const path = within(opening).getByRole('navigation', { name: 'Reading path' });
    const steps = within(path).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      '1Step 1: What changedThe block, before and after',
      '2Step 2: What is leftTwo open points',
    ]);
    // Only a step with a target is a button.
    expect(within(path).getAllByRole('button')).toHaveLength(1);
  });

  it('links evidence: a web address opens in a new tab, a record opens in the drawer', () => {
    const open = vi.fn();
    renderBoard(start(), { open });
    const link = screen.getByRole('link', { name: /Test run/ });
    expect(link.getAttribute('href')).toBe('https://example.com/run');
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: TASK.data.title }));
    expect(open).toHaveBeenCalledWith({ entity: TASK.id });
  });

  it('scrolls to and focuses the widget a step points at', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderBoard(start());
    fireEvent.click(screen.getByRole('button', { name: /What changed/ }));
    const target = document.querySelector('[data-widget="changed"]')!;
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(target);
    expect(document.activeElement).toBe(target);
  });

  it('states the claim on a found page, with its certainty mark', () => {
    renderBoard(
      start({ purpose: 'found', claim: finding.id, headline: undefined, evidence: undefined }),
    );
    const opening = screen.getByRole('region', { name: 'Found: start here' });
    expect(within(opening).getByRole('heading', { level: 2 }).textContent).toBe(
      finding.data.statement,
    );
    expect(opening.textContent).toContain('Our reading');
  });

  it('says by when on a needs-you page, and copes with a missing claim', () => {
    renderBoard(start({ purpose: 'needs-you', due: '2026-10-20' }));
    expect(screen.getByText(/Answer by/).textContent).toMatch(/Answer by Oct 20/);
    cleanup();
    renderBoard(start({ claim: 'clm_gone', headline: undefined }));
    expect(screen.getByText('This finding was deleted or isn’t in this project')).toBeTruthy();
  });
});
