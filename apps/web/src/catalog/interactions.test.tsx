import type { Entity, Operation, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { choose } from '../test/choose';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { ViewRenderer } from './renderer';

const data = dataset as unknown as ProjectDataset;
const task = (title: string) => data.tasks.find((t) => t.data.title === title)!;
const stage = (name: string) => data.stages.find((s) => s.data.name === name)!;

vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
let open: ReturnType<typeof vi.fn<ViewActions['open']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
  open = vi.fn<ViewActions['open']>();
});
afterEach(cleanup);

function renderSpec(spec: ViewNode) {
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

function lastOps(): Operation[] {
  return apply.mock.calls.at(-1)![1];
}

describe('task interactions', () => {
  it('marks a task done from its checkbox, and reopens a done one', () => {
    renderSpec({ component: 'TaskTable' });
    const review = task('Review the UI in the browser');
    fireEvent.click(screen.getByRole('button', { name: `Mark “${review.data.title}” done` }));
    expect(apply).toHaveBeenLastCalledWith('Mark “Review the UI in the browser” as done', [
      { op: 'update', type: 'task', id: review.id, data: { status: 'done' } },
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reopen “Renderer with error boundaries”' }),
    );
    expect(lastOps()[0]).toMatchObject({ data: { status: 'todo' } });
    expect(open).not.toHaveBeenCalled();
  });

  it('lists human tasks in the checklist and starts them', () => {
    renderSpec({ component: 'TaskChecklist', assigneeKind: 'human' });
    expect(screen.getByText('Review the UI in the browser')).toBeTruthy();
    expect(screen.queryByText('Catalog components')).toBeNull(); // assigned to an agent
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(lastOps()[0]).toMatchObject({ data: { status: 'in_progress' } });
  });

  it('opens a task when its card is clicked, but not when a nested control is', () => {
    renderSpec({ component: 'KanbanBoard' });
    fireEvent.click(screen.getByText('Catalog components'));
    expect(open).toHaveBeenLastCalledWith({ entity: task('Catalog components').id });
    open.mockClear();
    fireEvent.click(screen.getAllByRole('link', { name: 'M2 Catalog + renderer' })[0]!);
    expect(open).toHaveBeenLastCalledWith({ entity: stage('M2 Catalog + renderer').id });
  });

  it('moves a card to another column by drag and drop', () => {
    renderSpec({ component: 'KanbanBoard', groupBy: 'stage' });
    const moved = task('Answer views');
    const target = screen.getByText('M3 Generative views', { selector: 'div' }).parentElement!;
    const dataTransfer = { getData: () => moved.id, types: ['application/x-pharos-task'] };
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(apply).toHaveBeenLastCalledWith('Move “Answer views” to M3 Generative views', [
      {
        op: 'update',
        type: 'task',
        id: moved.id,
        data: { stageId: stage('M3 Generative views').id },
      },
    ]);
  });
});

describe('kanban size', () => {
  it('collapses a long finished column to its latest cards', () => {
    const done = Array.from({ length: 9 }, (_, i) => ({
      ...data.tasks[0]!,
      id: `task_done_${i}`,
      updatedRev: 100 + i,
      data: { ...data.tasks[0]!.data, title: `Finished ${i}`, status: 'done', dependsOn: [] },
    }));
    render(
      <ViewDataProvider
        data={{ ...data, tasks: [...data.tasks, ...done] }}
        version={1}
        actions={{ apply, open }}
      >
        <ViewRenderer spec={{ component: 'KanbanBoard' }} />
      </ViewDataProvider>,
    );
    // 3 done in the fixture + 9 more: the latest 5 show, newest first.
    expect(screen.getByText('Finished 8')).toBeTruthy();
    expect(screen.getByText('Finished 4')).toBeTruthy();
    expect(screen.queryByText('Finished 3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 7 more' }));
    expect(screen.getByText('Finished 0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeTruthy();
  });
});

describe('due dates', () => {
  it('flags overdue tasks unless they are finished', () => {
    const due = (id: string, status: string, dueDate: string) => ({
      ...data.tasks[0]!,
      id,
      data: { ...data.tasks[0]!.data, title: id, status, dueDate, dependsOn: [] },
    });
    render(
      <ViewDataProvider
        data={{
          ...data,
          tasks: [
            due('Late', 'todo', '2020-01-02'),
            due('Shipped', 'done', '2020-01-02'),
            due('Later', 'todo', '2099-01-02'),
          ],
        }}
        version={1}
        actions={{ apply, open }}
      >
        <ViewRenderer spec={{ component: 'TaskTable', columns: ['dueDate'] }} />
      </ViewDataProvider>,
    );
    const cell = (title: string) => screen.getByText(title).closest('tr')!.textContent;
    expect(cell('Late')).toMatch(/Overdue · Jan 2/);
    expect(cell('Shipped')).toMatch(/Due Jan 2/);
    expect(cell('Later')).toMatch(/Due Jan 2/);
  });
});

describe('stage progress', () => {
  it('shows a done stage as complete even without tasks', () => {
    renderSpec({ component: 'StageTracker' });
    const m0 = screen.getByText('M0 Foundations').closest('[role=button]') as HTMLElement;
    expect(within(m0).getByText('Done')).toBeTruthy();
    const fill = m0.querySelector('[style*="width"]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(fill.className).toContain('bg-chart-ok');
  });

  it('shows "No tasks yet" without a bar for an empty planned stage', () => {
    renderSpec({ component: 'StageTracker' });
    const m5 = screen.getByText('M5 Polish + dogfood').closest('[role=button]') as HTMLElement;
    expect(within(m5).getByText('No tasks yet')).toBeTruthy();
    expect(m5.querySelector('[style*="width"]')).toBeNull();
  });

  it('keeps a long stage name whole, wrapping it instead of cutting it short', () => {
    const name = 'R3 · Readable agent reports that explain where the project stands';
    const long = { ...data.stages[0]!, data: { ...data.stages[0]!.data, name } };
    render(
      <ViewDataProvider
        data={{ ...data, stages: [long, ...data.stages.slice(1)] }}
        version={1}
        actions={{ apply, open }}
      >
        <ViewRenderer spec={{ component: 'StageTracker' }} />
      </ViewDataProvider>,
    );
    const label = screen.getByText(name);
    expect(label.getAttribute('title')).toBe(name);
    expect(label.className).toContain('line-clamp-2');
    expect(label.className).not.toContain('truncate');
  });
});

describe('detail drawer', () => {
  function renderDrawer(entity: Entity) {
    return render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
        <DetailDrawer target={{ entity: entity.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
  }

  it('shows a task with its references and edits fields as revisions', () => {
    const t = task('Default Overview view');
    renderDrawer(t);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Default Overview view')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Catalog components' })).toBeTruthy(); // dependsOn
    expect(within(dialog).getByText('Blocks')).toBeTruthy();
    choose('Status', 'Blocked', dialog);
    expect(apply).toHaveBeenLastCalledWith('Set status of “Default Overview view” to Blocked', [
      { op: 'update', type: 'task', id: t.id, data: { status: 'blocked' } },
    ]);
    choose('Assignee', 'None', dialog);
    expect(lastOps()[0]).toMatchObject({ data: { assigneeId: null } });
  });

  it('lists a stage’s tasks', () => {
    renderDrawer(stage('M2 Catalog + renderer'));
    expect(screen.getByText('Tasks (5)')).toBeTruthy();
  });
});
