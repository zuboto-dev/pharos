import type { ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { choose } from '../test/choose';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';

const data = dataset as unknown as ProjectDataset;
const task = data.tasks.find((t) => t.data.title === 'Catalog components')!;
const goal = data.goals.find((g) => g.data.successCriteria.length > 0)!;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

function openDrawer(id: string) {
  render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
      <DetailDrawer target={{ entity: id }} onClose={() => {}} />
    </ViewDataProvider>,
  );
  return screen.getByRole('dialog');
}
const lastCall = () => apply.mock.calls.at(-1)!;

describe('inline editing', () => {
  it('renames an item from its title', () => {
    const dialog = openDrawer(task.id);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Catalog components' }));
    const input = within(dialog).getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'Catalog components v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastCall()).toEqual([
      'Rename task “Catalog components” to “Catalog components v2”',
      [{ op: 'update', type: 'task', id: task.id, data: { title: 'Catalog components v2' } }],
      { undoable: true },
    ]);
  });

  it('cancels a rename with Escape and ignores empty names', () => {
    const dialog = openDrawer(task.id);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Catalog components' }));
    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Catalog components' }));
    const input = within(dialog).getByLabelText('Name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(apply).not.toHaveBeenCalled();
  });

  it('adds a description as markdown, and sets and clears dates', () => {
    const dialog = openDrawer(task.id);
    fireEvent.click(within(dialog).getByRole('button', { name: /Add description/ }));
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: '  Build the **catalog**.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(lastCall()[0]).toBe('Edit the description of “Catalog components”');
    expect(lastCall()[1][0]).toMatchObject({ data: { description: 'Build the **catalog**.' } });

    fireEvent.change(within(dialog).getByLabelText('Due date'), {
      target: { value: '2026-10-20' },
    });
    expect(lastCall()[1][0]).toMatchObject({ data: { dueDate: '2026-10-20' } });
  });

  it('edits short text and success criteria, one per line', () => {
    const dialog = openDrawer(task.id);
    const estimate = within(dialog).getByText('1d');
    fireEvent.click(within(estimate.parentElement!).getByRole('button', { name: 'Edit estimate' }));
    const input = within(dialog).getByLabelText('Estimate');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastCall()).toEqual([
      'Clear the estimate of “Catalog components”',
      [{ op: 'update', type: 'task', id: task.id, data: { estimate: null } }],
      { undoable: true },
    ]);

    cleanup();
    const goalDialog = openDrawer(goal.id);
    fireEvent.click(within(goalDialog).getByRole('button', { name: 'Edit success criteria' }));
    fireEvent.change(within(goalDialog).getByLabelText('Success criteria'), {
      target: { value: 'First\n\n  Second  \n' },
    });
    fireEvent.click(within(goalDialog).getByRole('button', { name: 'Save' }));
    expect(lastCall()[1][0]).toMatchObject({ data: { successCriteria: ['First', 'Second'] } });
  });

  it('still edits options with the dropdown', () => {
    const dialog = openDrawer(task.id);
    choose('Priority', 'Urgent', dialog);
    expect(lastCall()[1][0]).toMatchObject({ data: { priority: 'urgent' } });
  });
});
