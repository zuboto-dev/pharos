import type { Operation, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { choose } from '../test/choose';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { OptionsEditor } from './options';
import { ViewRenderer } from './renderer';

const base = dataset as unknown as ProjectDataset;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

/** The fixture project with custom task statuses; its tasks are mapped onto them. */
const MAP: Record<string, string> = {
  todo: 'backlog',
  in_progress: 'doing',
  blocked: 'doing',
  done: 'shipped',
  cancelled: 'shipped',
};
const custom: ProjectDataset = {
  ...base,
  project: {
    ...base.project,
    data: {
      ...base.project.data,
      options: {
        'task.status': [
          { value: 'backlog', label: 'Backlog', meaning: 'todo' },
          { value: 'doing', label: 'Doing', meaning: 'in_progress' },
          { value: 'review', label: 'In review', meaning: 'in_progress', color: 'violet' },
          { value: 'shipped', label: 'Shipped', meaning: 'done' },
        ],
      },
    },
  },
  tasks: base.tasks.map((t) => ({ ...t, data: { ...t.data, status: MAP[t.data.status]! } })),
};

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

function renderWith(data: ProjectDataset, children: React.ReactNode) {
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
      {children}
    </ViewDataProvider>,
  );
}
const ops = (): Operation[] => apply.mock.calls.at(-1)![1];

describe('custom options in views', () => {
  it('uses custom statuses as kanban columns and marks tasks done with the done-meaning status', () => {
    renderWith(custom, <ViewRenderer spec={{ component: 'KanbanBoard' }} />);
    for (const label of ['Backlog', 'Doing', 'In review', 'Shipped'])
      expect(screen.getByText(label)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark “Review the UI in the browser” done' }),
    );
    expect(apply).toHaveBeenLastCalledWith('Mark “Review the UI in the browser” as shipped', [
      expect.objectContaining({ data: { status: 'shipped' } }),
    ]);
  });

  it('keeps progress working through meanings', () => {
    renderWith(custom, <ViewRenderer spec={{ component: 'ProgressRing' }} />);
    // 9 tasks: done + cancelled both became "shipped" (done), so 3 of 9.
    expect(screen.getByText('3 of 9 tasks done')).toBeTruthy();
  });
});

describe('options editor', () => {
  it('renames an option, keeping its stored value', () => {
    renderWith(custom, <OptionsEditor field="task.status" onClose={() => {}} />);
    const input = screen.getAllByLabelText('Label')[2]!;
    fireEvent.change(input, { target: { value: 'Code review' } });
    fireEvent.blur(input);
    expect(apply.mock.calls.at(-1)![0]).toBe('Rename “In review” to “Code review”');
    expect(ops()[0]).toMatchObject({
      type: 'project',
      data: {
        options: {
          'task.status': expect.arrayContaining([
            expect.objectContaining({ value: 'review', label: 'Code review' }),
          ]),
        },
      },
    });
  });

  it('adds an option with a meaning, starting from the defaults', () => {
    renderWith(base, <OptionsEditor field="scope_item.kind" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('New option'), { target: { value: 'Stretch goal' } });
    choose('New option counts as', 'Maybe');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const list = (
      ops()[0] as unknown as {
        data: { options: Record<string, { value: string; meaning: string }[]> };
      }
    ).data.options['scope_item.kind']!;
    expect(list.map((o) => [o.value, o.meaning])).toEqual([
      ['in', 'in'],
      ['maybe', 'maybe'],
      ['out', 'out'],
      ['stretch_goal', 'maybe'],
    ]);
  });

  it('removes an option in use by moving its items in the same change', () => {
    renderWith(custom, <OptionsEditor field="task.status" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Doing' }));
    const prompt = screen.getByText(/use “Doing”/).closest('div')!;
    expect(within(prompt).getByRole('button', { name: 'Move to' }).textContent).toBe('In review'); // same meaning first
    fireEvent.click(within(prompt).getByRole('button', { name: 'Move and remove' }));
    const [message, operations] = apply.mock.calls.at(-1)!;
    expect(message).toMatch(
      /^Remove “Doing” from task status options, moving \d items to “In review”$/,
    );
    expect(
      operations
        .slice(1)
        .every((op) => op.op === 'update' && op.type === 'task' && op.data.status === 'review'),
    ).toBe(true);
    expect(operations.length - 1).toBe(
      custom.tasks.filter((t) => t.data.status === 'doing').length,
    );
  });
});
