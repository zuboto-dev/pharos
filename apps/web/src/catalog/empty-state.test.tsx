import type { ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskDialog } from '../pages/requests';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ViewRenderer } from './renderer';

afterEach(cleanup);
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

const data = dataset as unknown as ProjectDataset;
const empty: ProjectDataset = { ...data, tasks: [], decisions: [], stages: [], files: [] };

function setup(spec: Parameters<typeof ViewRenderer>[0]['spec'], actions: Partial<ViewActions>) {
  const all: ViewActions = {
    apply: vi.fn(async () => ({ ok: true as const, revision: 1, created: {} })),
    open: vi.fn(),
    ...actions,
  };
  render(
    <ViewDataProvider data={empty} version={1} actions={all}>
      <ViewRenderer spec={spec} view={{ id: 'view_1', name: 'Plan' }} />
    </ViewDataProvider>,
  );
  return all;
}

describe('empty states (v0.2 B8)', () => {
  it('offer the add action as a button that becomes the title field', () => {
    const actions = setup({ component: 'TaskTable', title: 'Tasks' }, {});
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const field = screen.getByRole('textbox', { name: 'Add task' });
    fireEvent.change(field, { target: { value: 'Write the brief' } });
    fireEvent.submit(field.closest('form')!);
    expect(actions.apply).toHaveBeenCalledWith(
      'Add task “Write the brief”',
      [expect.objectContaining({ op: 'create', type: 'task' })],
      { undoable: true },
    );
  });

  it('ask an agent about this block with a question to start from', () => {
    const ask = vi.fn();
    setup({ component: 'DependencyGraph', title: 'Order' }, { ask });
    fireEvent.click(screen.getByRole('button', { name: 'Ask an agent' }));
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: 'view_1',
        widgetId: expect.any(String),
        question: expect.stringMatching(/tasks/),
      }),
    );
  });

  it('hide "Ask an agent" where asking is not available', () => {
    setup({ component: 'DependencyGraph' }, {});
    expect(screen.queryByRole('button', { name: 'Ask an agent' })).toBeNull();
  });

  it('offer Add files and a folder request where there are no files', () => {
    const ask = vi.fn();
    setup({ component: 'FileList' }, { ask });
    expect(screen.getByRole('link', { name: 'Add files' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask an agent for a folder' }));
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ question: expect.stringMatching(/folder/) }),
    );
  });

  it('record a decision from an empty DecisionLog', () => {
    setup({ component: 'DecisionLog' }, {});
    fireEvent.click(screen.getByRole('button', { name: 'Record a decision' }));
    expect(screen.getByRole('textbox', { name: 'Record a decision' })).toBeTruthy();
  });

  it('start the ask dialog from the prefilled question', () => {
    render(
      <AskDialog
        projectId="prj_1"
        about={{ label: 'Tasks', question: 'Break the work into tasks.' }}
        apply={async () => ({ ok: false })}
        onClose={() => {}}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Break the work into tasks.',
    );
  });
});
