import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { parseDeliverable } from './task-details';

const base = dataset as unknown as ProjectDataset;
const plain = base.tasks.find((t) => t.data.title === 'Catalog components')!;
const other = base.tasks.find((t) => t.id !== plain.id)!;
const detailed: Entity<'task'> = {
  ...plain,
  data: {
    ...plain.data,
    actions: ['Draft the schema', 'Wire the drawer'],
    acceptance: ['The drawer shows three sections'],
    deliverables: [
      { label: 'Schema change', kind: 'commit', ref: 'abc1234' },
      { label: 'Spec', kind: 'link', ref: 'https://example.com/spec' },
      { label: 'Related task', kind: 'record', ref: other.id },
      { label: 'Notes', kind: 'file', ref: 'docs/notes.md' },
    ],
  },
};
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

function openDrawer(task: Entity<'task'>) {
  const data = { ...base, tasks: base.tasks.map((t) => (t.id === task.id ? task : t)) };
  render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
      <DetailDrawer target={{ entity: task.id }} onClose={() => {}} />
    </ViewDataProvider>,
  );
  return screen.getByRole('dialog');
}

describe('task details in the drawer', () => {
  it('shows what to do numbered, done when as checks, and what it produces by kind', () => {
    const dialog = openDrawer(detailed);
    const details = dialog.querySelector('[data-task-details]') as HTMLElement;
    expect(
      within(details)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['What to do', 'Done when', 'Produces']);
    const steps = details.querySelector('ol')!;
    expect([...steps.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'Draft the schema',
      'Wire the drawer',
    ]);
    expect(within(details).getByText('The drawer shows three sections')).toBeTruthy();
    // A URL opens in a new tab, a path or commit is code, an id is a link to the record.
    const link = within(details).getByRole('link', { name: 'https://example.com/spec' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(within(details).getByText('docs/notes.md').tagName).toBe('CODE');
    expect(within(details).getByText('abc1234').tagName).toBe('CODE');
    expect(
      within(details).getByRole('link', { name: (n) => n.includes(other.data.title) }),
    ).toBeTruthy();
    expect(details.querySelector('[data-kind="commit"] svg')).toBeTruthy();
    // Not repeated in the fields below.
    expect(within(dialog).queryByText('Acceptance')).toBeNull();
  });

  it('lets the owner add steps, and edit results one per line', () => {
    let dialog = openDrawer(plain);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add steps' }));
    fireEvent.change(within(dialog).getByLabelText('Actions'), {
      target: { value: 'First\n\n Second ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      { op: 'update', type: 'task', id: plain.id, data: { actions: ['First', 'Second'] } },
    ]);
    cleanup();
    dialog = openDrawer(detailed);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit deliverables' }));
    const box = within(dialog).getByLabelText('Deliverables') as HTMLTextAreaElement;
    expect(box.value.split('\n')[0]).toBe('Schema change | commit | abc1234');
    fireEvent.change(box, { target: { value: 'Guide | page | v1\nLoose note' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      {
        op: 'update',
        type: 'task',
        id: plain.id,
        data: {
          deliverables: [{ label: 'Guide', kind: 'page', ref: 'v1' }, { label: 'Loose note' }],
        },
      },
    ]);
  });

  it('reads a line without a kind as label and where', () => {
    expect(parseDeliverable('Report | out/report.pdf')).toEqual({
      label: 'Report',
      ref: 'out/report.pdf',
    });
    expect(parseDeliverable(' | file')).toBeNull();
  });
});
