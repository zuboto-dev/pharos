import type { Board, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

const data = dataset as unknown as ProjectDataset;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);
afterEach(cleanup);

const board: Board = {
  component: 'Board',
  widgets: [
    { id: 'a', w: 4, node: { component: 'ProgressRing', title: 'Ring' } },
    { id: 'b', w: 8, h: 300, node: { component: 'GoalTree', title: 'Goals' } },
    { id: 'c', node: { component: 'ScopeBoard', title: 'Scope' } },
  ],
};

function renderBoard(editing: boolean) {
  const onChange = vi.fn();
  render(
    <ViewDataProvider data={data} version={1}>
      <ViewRenderer spec={board} editing={editing} onChange={onChange} />
    </ViewDataProvider>,
  );
  return onChange;
}

const widget = (id: string) => document.querySelector(`[data-widget="${id}"]`) as HTMLElement;

describe('board', () => {
  it('places widgets by width, column, and height', () => {
    renderBoard(false);
    expect(widget('a').style.getPropertyValue('--col')).toBe('span 4');
    expect(widget('b').style.getPropertyValue('--h')).toBe('300px');
    expect(widget('c').style.getPropertyValue('--col')).toBe('span 12');
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('removes a widget in edit mode', () => {
    const onChange = renderBoard(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Goals' }));
    expect(onChange).toHaveBeenCalledWith(
      { component: 'Board', widgets: [board.widgets[0], board.widgets[2]] },
      'Remove “Goals” widget',
    );
  });

  it('reorders widgets by dragging a grip onto another widget', () => {
    const onChange = renderBoard(true);
    const dataTransfer = {
      getData: () => 'c',
      setData: () => {},
      types: ['application/x-pharos-widget'],
    };
    // happy-dom rects are all zero, so the pointer counts as being on the "after" side.
    fireEvent.dragOver(widget('a'), { dataTransfer, clientX: 10, clientY: 10 });
    fireEvent.drop(widget('a'), { dataTransfer, clientX: 10, clientY: 10 });
    const [next, message] = onChange.mock.calls[0]!;
    expect(next.widgets.map((w: { id: string }) => w.id)).toEqual(['a', 'c', 'b']);
    expect(message).toBe('Move “Scope” widget');
  });
});
