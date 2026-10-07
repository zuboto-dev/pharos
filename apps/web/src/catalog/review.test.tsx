import type { ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../lib/format';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { ViewRenderer } from './renderer';

const base = dataset as unknown as ProjectDataset;
vi.stubGlobal('fetch', async () => Response.json([]));
afterEach(cleanup);

function actions(): ViewActions {
  return {
    apply: vi.fn(async () => ({ ok: true as const, revision: 1, created: {} })),
    open: vi.fn(),
  };
}

describe('decisions', () => {
  it('shows who made each decision and when', () => {
    const [first, ...rest] = base.decisions;
    const data: ProjectDataset = {
      ...base,
      decisions: [
        {
          ...first!,
          data: { ...first!.data, decidedById: 'asg_dc7d702b0bcf', decisionDate: '2026-10-05' },
        },
        ...rest,
      ],
    };
    render(
      <ViewDataProvider data={data} version={1} actions={actions()}>
        <ViewRenderer spec={{ component: 'DecisionLog', title: 'Decisions' }} />
      </ViewDataProvider>,
    );
    const row = screen.getByText(first!.data.title).closest('li')!;
    expect(row.textContent).toContain('Alex · Oct 5');
  });

  it('dates decisions recorded from the UI, and lets people say who decided', () => {
    const all = actions();
    render(
      <ViewDataProvider data={base} version={1} actions={all}>
        <ViewRenderer spec={{ component: 'DecisionLog', title: 'Decisions' }} />
      </ViewDataProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record a decision' }));
    const input = screen.getByLabelText('Record a decision');
    fireEvent.change(input, { target: { value: 'Ship on Fridays' } });
    fireEvent.submit(input.closest('form')!);
    const [, operations] = vi.mocked(all.apply).mock.calls.at(-1)!;
    expect(operations[0]).toMatchObject({
      op: 'create',
      type: 'decision',
      data: { title: 'Ship on Fridays', decisionDate: localToday() },
    });
    cleanup();

    render(
      <ViewDataProvider data={base} version={1} actions={actions()}>
        <DetailDrawer target={{ entity: base.decisions[0]!.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Decided by')).toBeTruthy();
    expect(within(dialog).getByText('Decision date')).toBeTruthy();
  });
});

describe('detail drawer', () => {
  it('goes back to the previous details only when there were some', () => {
    const onBack = vi.fn();
    render(
      <ViewDataProvider data={base} version={1} actions={actions()}>
        <DetailDrawer target={{ entity: base.tasks[0]!.id }} onClose={() => {}} onBack={onBack} />
      </ViewDataProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
    cleanup();
    render(
      <ViewDataProvider data={base} version={1} actions={actions()}>
        <DetailDrawer target={{ entity: base.tasks[0]!.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('data tables', () => {
  it('keeps room for names while other columns shorten', () => {
    render(
      <ViewDataProvider data={base} version={1} actions={actions()}>
        <ViewRenderer
          spec={{
            component: 'DataTable',
            title: 'Tasks',
            query: { type: 'task' },
            columns: [{ field: 'title' }, { field: 'dependsOn', label: 'After' }],
          }}
        />
      </ViewDataProvider>,
    );
    const row = screen.getAllByRole('row')[1]!;
    const [name, after] = within(row).getAllByRole('cell');
    expect(name!.firstElementChild!.className).toContain('min-w-40');
    expect(after!.firstElementChild!.className).toContain('max-w-56');
  });
});
