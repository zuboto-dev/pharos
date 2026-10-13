import type { Board, ProjectDataset } from '@pharos/schema';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resourceOf, useResource } from '../lib/api';
import { EXIT_MS } from '../lib/motion';
import dataset from './__fixtures__/dataset.json';
import { withLeaving } from './board';
import { ViewDataProvider } from './context';
import { CHANGED_CLASS, ENTER_CLASS, diffBlocks, focusKeyOf, signatureOf } from './live';
import { ViewRenderer } from './renderer';

// v0.2 B4: live updates keep the reader's place; changed blocks fade a soft ring, new blocks fade
// in, removed ones fade out where they were.

const data = dataset as unknown as ProjectDataset;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ring = (title: string) => ({
  id: 'a',
  w: 4,
  node: { component: 'ProgressRing' as const, title },
});
const goals = { id: 'b', w: 8, node: { component: 'GoalTree' as const, title: 'Goals' } };
const boardOf = (...widgets: Board['widgets']): Board => ({ component: 'Board', widgets });
const widget = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`)!;

const actions = {
  apply: vi.fn(async () => ({ ok: false as const })),
  open: vi.fn(),
  ask: vi.fn(),
};

function renderLive(board: Board, quiet = () => false) {
  const view = (b: Board, version: number, editing = false) => (
    <ViewDataProvider data={data} version={version} actions={actions}>
      <ViewRenderer spec={b} editing={editing} quiet={quiet} />
    </ViewDataProvider>
  );
  const result = render(view(board, 1));
  return {
    update: (b: Board, version: number, editing = false) =>
      result.rerender(view(b, version, editing)),
  };
}

describe('live helpers', () => {
  it('diffs blocks by id and by what they show', () => {
    const before = new Map([
      ['a', 'Ring 1'],
      ['b', 'Goals'],
    ]);
    const after = new Map([
      ['a', 'Ring 2'],
      ['b', 'Goals'],
      ['c', 'New'],
    ]);
    expect(diffBlocks(before, after)).toEqual({ entered: ['c'], changed: ['a'] });
    // Nothing is marked on the first render.
    expect(diffBlocks(null, after)).toEqual({ entered: [], changed: [] });
  });

  it('reads a block’s text as its signature, ignoring spacing', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>Due  <b>Dec 31</b></p>\n<p>3 tasks</p>';
    expect(signatureOf(el)).toBe('Due Dec 31 3 tasks');
  });

  it('names a control by its label, so it can be found again in a new element', () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Ask about Goals');
    expect(focusKeyOf(button)).toBe('BUTTON||Ask about Goals');
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.textContent = '  Tax  registration letter ';
    expect(focusKeyOf(row)).toBe('DIV|button|Tax registration letter');
  });

  it('puts removed widgets back at their old places while they fade out', () => {
    const list = withLeaving([ring('R'), goals], [{ widget: { ...goals, id: 'x' }, index: 1 }]);
    expect(list.map((w) => [w.widget.id, w.gone])).toEqual([
      ['a', false],
      ['x', true],
      ['b', false],
    ]);
  });
});

describe('a board under live updates', () => {
  it('marks a block whose content changed, and fades in a new one', () => {
    const { update } = renderLive(boardOf(ring('Ring 1'), goals));
    expect(widget('a').classList.contains(CHANGED_CLASS)).toBe(false);
    update(
      boardOf(ring('Ring 2'), goals, {
        ...goals,
        id: 'c',
        node: { ...goals.node, title: 'More goals' },
      }),
      2,
    );
    expect(widget('a').classList.contains(CHANGED_CLASS)).toBe(true);
    expect(widget('b').classList.contains(CHANGED_CLASS)).toBe(false);
    expect(widget('c').classList.contains(ENTER_CLASS)).toBe(true);
    // The mark goes when its animation ends.
    act(() => {
      widget('a').dispatchEvent(new Event('animationend'));
    });
    expect(widget('a').classList.contains(CHANGED_CLASS)).toBe(false);
  });

  it('doesn’t mark the owner’s own changes, or changes while editing the layout', () => {
    let own = true;
    const { update } = renderLive(boardOf(ring('Ring 1'), goals), () => own);
    update(boardOf(ring('Ring 2'), goals), 2);
    expect(widget('a').classList.contains(CHANGED_CLASS)).toBe(false);
    own = false;
    update(boardOf(ring('Ring 3'), goals), 3, true);
    expect(widget('a').classList.contains(CHANGED_CLASS)).toBe(false);
  });

  it('lets a removed block fade out where it was, then takes it away', () => {
    vi.useFakeTimers();
    const { update } = renderLive(boardOf(ring('Ring'), goals));
    update(boardOf(ring('Ring')), 2);
    const leaving = document.querySelector('[data-leaving="b"]')!;
    expect(leaving.getAttribute('aria-hidden')).toBe('true');
    expect(leaving.className).toContain('animate-fade-out');
    expect(widget('b')).toBeNull();
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(document.querySelector('[data-leaving]')).toBeNull();
  });

  it('gives focus back to the same control when an update replaced its element', () => {
    const { update } = renderLive(boardOf(ring('Ring'), goals));
    const ask = screen.getByRole('button', { name: 'Ask about Goals' });
    ask.focus();
    // An agent swaps the widget for one with a new id but the same content.
    update(boardOf(ring('Ring'), { ...goals, id: 'b2' }), 2);
    expect(ask.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask about Goals' }));
  });

  it('holds the board’s height while swapped blocks load, so the page doesn’t jump', () => {
    vi.useFakeTimers();
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1800);
    const { update } = renderLive(boardOf(ring('Ring'), goals));
    const grid = widget('a').parentElement!;
    height.mockReturnValue(400);
    update(boardOf({ ...ring('Ring'), id: 'a2' }, { ...goals, id: 'b2' }), 2);
    expect(grid.style.minHeight).toBe('1800px');
    // The feed often reloads the same change twice: the second reload doesn't let go early.
    update(boardOf({ ...ring('Ring'), id: 'a2' }, { ...goals, id: 'b2' }), 3);
    act(() => vi.advanceTimersByTime(600));
    expect(grid.style.minHeight).toBe('1800px');
    act(() => vi.advanceTimersByTime(1300));
    expect(grid.style.minHeight).toBe('');
    height.mockRestore();
  });
});

describe('useResource across live updates', () => {
  it('names the resource without its version', () => {
    expect(resourceOf('/api/history?entityId=a&limit=1&v=3')).toBe(
      '/api/history?entityId=a&limit=1',
    );
    expect(resourceOf('/api/files/f/info?v=12')).toBe('/api/files/f/info');
    expect(resourceOf('/x?v=2&a=1')).toBe('/x?a=1');
  });

  it('keeps the old data while the same resource reloads at a new version', async () => {
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('v=1')
        ? Promise.resolve(Response.json({ n: 1 }))
        : new Promise<Response>((r) => (resolve = r)),
    );
    const { result, rerender } = renderHook(({ path }) => useResource<{ n: number }>(path), {
      initialProps: { path: '/api/thing?v=1' },
    });
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    rerender({ path: '/api/thing?v=2' });
    // Still the old data, not "loading": the block keeps its size.
    expect(result.current.status).toBe('ok');
    expect(result.current.data).toEqual({ n: 1 });
    await act(async () => resolve(Response.json({ n: 2 })));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    // A different resource still starts from nothing.
    rerender({ path: '/api/other?v=2' });
    expect(result.current.status).toBe('loading');
  });
});
