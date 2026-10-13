import type { Board, Entity, PresenceEntry, ProjectDataset } from '@pharos/schema';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcePresence } from '../lib/events';
import { ViewTabs } from '../pages/ViewTabs';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { CHANGED_CLASS } from './live';
import { viewsWithPresence, workingLine } from './presence';
import { ViewRenderer } from './renderer';

// v0.2 B5: calm marks for where an agent is at work, which clear when it stops and never move
// layout.

const data = dataset as unknown as ProjectDataset;
const VIEW = { id: 'view_board', name: 'Board' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  act(() => announcePresence({ entries: [] }));
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const board: Board = {
  component: 'Board',
  widgets: [
    { id: 'notes', w: 6, node: { component: 'Text', content: 'Plain notes' } },
    { id: 'goals', w: 6, node: { component: 'GoalTree', title: 'Goals' } },
  ],
};
const widget = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`)!;

const editing = (widgetId?: string, expiresInMs = 20_000): PresenceEntry => ({
  agent: 'Claude Code',
  projectId: 'p',
  viewId: VIEW.id,
  ...(widgetId ? { widgetId } : {}),
  activity: 'editing',
  since: new Date().toISOString(),
  expiresInMs,
});

function renderBoard(version = 1) {
  const view = (v: number) => (
    <ViewDataProvider data={data} version={v} actions={{ apply: vi.fn(), open: vi.fn() }}>
      <ViewRenderer spec={board} view={VIEW} />
    </ViewDataProvider>
  );
  const result = render(view(version));
  return { rerender: (v: number) => result.rerender(view(v)) };
}

describe('presence on a board', () => {
  it('marks the block an agent is editing with its name, and the view', () => {
    renderBoard();
    expect(screen.queryByText(/is editing/)).toBeNull();
    act(() => announcePresence({ entries: [editing(), editing('goals')] }));
    const mark = screen.getByText('Claude Code is editing…');
    expect(widget('goals').contains(mark)).toBe(true);
    expect(widget('notes').querySelector('[data-presence]')).toBeNull();
    expect(screen.getByText('Claude Code is working on this view')).toBeTruthy();
    expect(widget('goals').querySelector('[data-presence-dot]')).not.toBeNull();
  });

  it('never moves layout: the marks are placed absolutely and the block only gets an outline', () => {
    renderBoard();
    const before = widget('goals').className;
    const content = widget('goals').firstElementChild;
    act(() => announcePresence({ entries: [editing(), editing('goals')] }));
    // The block's content is the same element, still first; nothing was put before it.
    expect(widget('goals').firstElementChild).toBe(content);
    for (const mark of document.querySelectorAll('[data-presence]')) {
      expect(mark.className).toMatch(/(^|\s)absolute(\s|$)/);
      expect(mark.className).toContain('pointer-events-none');
    }
    const added = widget('goals')
      .className.split(/\s+/)
      .filter((c) => !before.split(/\s+/).includes(c));
    expect(added.length).toBeGreaterThan(0);
    for (const c of added) expect(c).toMatch(/^(rounded-block|outline-[a-z0-9/-]+)$/);
    // The view's mark is not a grid item: absolutely placed in the board, not a block.
    const viewMark = screen.getByText('Claude Code is working on this view').parentElement!;
    expect(viewMark.hasAttribute('data-widget')).toBe(false);
    expect(viewMark.className).toMatch(/(^|\s)absolute(\s|$)/);
  });

  it("doesn't count the mark as a change to the block (no change ring on the next update)", () => {
    const { rerender } = renderBoard(1);
    act(() => announcePresence({ entries: [editing('goals')] }));
    rerender(2);
    expect(widget('goals').classList.contains(CHANGED_CLASS)).toBe(false);
  });

  it('clears the marks when the agent stops', () => {
    renderBoard();
    act(() => announcePresence({ entries: [editing(), editing('goals')] }));
    expect(document.querySelectorAll('[data-presence]')).toHaveLength(2);
    act(() => announcePresence({ entries: [] }));
    expect(document.querySelectorAll('[data-presence]')).toHaveLength(0);
    expect(widget('goals').className).not.toContain('outline-presence');
  });

  it('lets a mark expire on its own when its time is up', () => {
    vi.useFakeTimers();
    renderBoard();
    act(() => announcePresence({ entries: [editing('goals', 1_000)] }));
    expect(screen.getByText('Claude Code is editing…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.queryByText('Claude Code is editing…')).toBeNull();
  });

  it('keeps a mark without an expiry (an answering run) until the server says it ended', () => {
    vi.useFakeTimers();
    renderBoard();
    const held = { ...editing(), expiresInMs: undefined };
    act(() => announcePresence({ entries: [held] }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByText('Claude Code is working on this view')).toBeTruthy();
  });
});

describe('presence on the view tabs', () => {
  const views = [...data.views] as Entity<'view'>[];
  it('puts a dot on the tab of a view an agent works on, and says so to screen readers', () => {
    render(
      <MemoryRouter initialEntries={[`/projects/p/views/${views[0]!.id}`]}>
        <ViewDataProvider data={data} version={1} actions={{ apply: vi.fn(), open: vi.fn() }}>
          <ViewTabs projectId="p" views={views} active={views[0]} onCreated={vi.fn()} />
        </ViewDataProvider>
      </MemoryRouter>,
    );
    const target = views[1]!;
    act(() => announcePresence({ entries: [{ ...editing(), viewId: target.id }] }));
    const tab = screen.getByRole('link', { name: new RegExp(target.data.name) });
    expect(tab.querySelector('[data-presence-dot]')).not.toBeNull();
    expect(tab.querySelector('[data-presence-dot]')!.className).toContain('absolute');
    expect(tab.textContent).toContain('Claude Code is working on it');
    const other = screen.getByRole('link', { name: views[0]!.data.name });
    expect(other.querySelector('[data-presence-dot]')).toBeNull();
  });
});

describe('presence helpers', () => {
  it('groups agents by view and words them', () => {
    const map = viewsWithPresence([
      editing(),
      { ...editing('goals'), agent: 'Codex' },
      { ...editing(), viewId: undefined },
    ]);
    expect([...map]).toEqual([[VIEW.id, ['Claude Code', 'Codex']]]);
    expect(workingLine(['Claude Code'], 'this view')).toBe('Claude Code is working on this view');
    expect(workingLine(['A', 'B', 'C'], 'it')).toBe('A, B and C are working on it');
  });
});
