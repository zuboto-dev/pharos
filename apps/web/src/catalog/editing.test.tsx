import type { Board, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { choose } from '../test/choose';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { defaultsFrom } from './quickadd';
import { ViewRenderer } from './renderer';
import { WidgetSettings } from './settings';

const data = dataset as unknown as ProjectDataset;
const stage = (name: string) => data.stages.find((s) => s.data.name === name)!;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

function renderWith(children: React.ReactNode) {
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
      {children}
    </ViewDataProvider>,
  );
}

function addThrough(label: string, title: string, within_: HTMLElement = document.body) {
  fireEvent.click(within(within_).getAllByRole('button', { name: label })[0]!);
  const input = within(within_).getByLabelText(label);
  fireEvent.change(input, { target: { value: title } });
  fireEvent.submit(input.closest('form')!);
}

describe('quick add', () => {
  it('derives defaults from a widget filter', () => {
    expect(
      defaultsFrom(
        { stageId: '$currentStage', status: { not: 'cancelled' }, priority: ['high'] },
        'stg_2',
      ),
    ).toEqual({
      stageId: 'stg_2',
      priority: 'high',
    });
    expect(defaultsFrom(undefined, undefined)).toEqual({});
  });

  it('adds a task to a kanban column with that column’s value', () => {
    renderWith(<ViewRenderer spec={{ component: 'KanbanBoard', groupBy: 'stage' }} />);
    const column = screen.getByText('M3 Generative views', { selector: 'div' }).parentElement!;
    addThrough('Add task', 'Write MCP docs', column);
    expect(apply).toHaveBeenLastCalledWith(
      'Add task “Write MCP docs”',
      [
        {
          op: 'create',
          type: 'task',
          data: {
            projectId: data.project.id,
            stageId: stage('M3 Generative views').id,
            title: 'Write MCP docs',
          },
        },
      ],
      { undoable: true },
    );
  });

  it('adds stages, goals, scope items, and decisions', () => {
    renderWith(<ViewRenderer spec={{ component: 'StageTracker' }} />);
    addThrough('Add stage', 'M6 Launch');
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({
      type: 'stage',
      data: { name: 'M6 Launch' },
    });
    cleanup();
    renderWith(<ViewRenderer spec={{ component: 'ScopeBoard' }} />);
    addThrough(
      'Add',
      'Offline mode',
      screen.getByRole('heading', { name: /Out of scope/ }).parentElement!,
    );
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({
      type: 'scope_item',
      data: { title: 'Offline mode', kind: 'out' },
    });
  });
});

describe('drawer delete', () => {
  it('confirms, explains side effects, and deletes as an undoable revision', () => {
    const m2 = stage('M2 Catalog + renderer');
    const onClose = vi.fn();
    renderWith(<DetailDrawer target={{ entity: m2.id }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toMatch(/Its 5 tasks will stay, without a stage/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(apply).toHaveBeenLastCalledWith(
      'Delete stage “M2 Catalog + renderer”',
      [{ op: 'delete', type: 'stage', id: m2.id }],
      { undoable: true },
    );
    expect(onClose).toHaveBeenCalled();
  });
});

describe('widget settings', () => {
  function renderSettings(node: ViewNode) {
    const onSave = vi.fn();
    renderWith(<WidgetSettings node={node} onSave={onSave} onClose={() => {}} />);
    return onSave;
  }

  it('limits a stage tracker to the current stage', () => {
    const onSave = renderSettings({ component: 'StageTracker', title: 'Stages' });
    choose('Stages', 'Current stage');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      component: 'StageTracker',
      title: 'Stages',
      filter: { where: { id: '$currentStage' } },
    });
  });

  it('picks specific stages and regroups a kanban board', () => {
    const onSave = renderSettings({
      component: 'KanbanBoard',
      filter: { where: { status: { not: 'cancelled' } } },
    });
    choose('Stages', 'Specific stages');
    fireEvent.click(screen.getByLabelText('M3 Generative views'));
    choose('Group by', 'By assignee');
    fireEvent.click(screen.getByLabelText('Hide cancelled tasks'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      component: 'KanbanBoard',
      groupBy: 'assignee',
      filter: { where: { stageId: [stage('M0 Foundations').id, stage('M3 Generative views').id] } },
    });
  });
});

describe('widget toolbar', () => {
  it('moves widgets up and down', () => {
    const board: Board = {
      component: 'Board',
      widgets: [
        { id: 'a', node: { component: 'GoalTree', title: 'Goals' } },
        { id: 'b', x: 6, w: 6, node: { component: 'ScopeBoard', title: 'Scope' } },
      ],
    };
    const onChange = vi.fn();
    renderWith(<ViewRenderer spec={board} editing onChange={onChange} />);
    expect(
      (screen.getByRole('button', { name: 'Move Goals up' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Scope up' }));
    expect(onChange).toHaveBeenCalledWith(
      {
        component: 'Board',
        widgets: [{ id: 'b', w: 6, node: board.widgets[1]!.node }, board.widgets[0]],
      },
      'Move “Scope” widget up',
    );
  });
});
