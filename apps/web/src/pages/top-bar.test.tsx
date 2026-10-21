import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewTabs, fitTabs, sortViews } from './ViewTabs';

// v0.2 B1: the project's top bar keeps the view tabs and the icons on one line at every width.

const data = dataset as unknown as ProjectDataset;
const [overview, delivery] = sortViews(data.views as Entity<'view'>[]) as Entity<'view'>[];
const archived: Entity<'view'> = {
  ...delivery!,
  id: 'view_old',
  data: { ...delivery!.data, name: 'Old plan', archived: true },
};
const extra = (n: number): Entity<'view'> => ({
  ...delivery!,
  id: `view_x${n}`,
  data: { ...delivery!.data, name: `Extra ${n}`, order: 10 + n, pinned: false },
});
const many = [overview!, delivery!, extra(1), extra(2), extra(3)];

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

describe('fitTabs', () => {
  it('shows every tab when they fit, or before anything is measured', () => {
    expect(fitTabs([80, 80, 80], 300, 0, 60)).toEqual([0, 1, 2]);
    expect(fitTabs([80, 80, 80], 0, 2, 60)).toEqual([0, 1, 2]);
  });

  it('keeps tabs in order and leaves room for More', () => {
    // 300 - 60 for More leaves 240: three tabs of 80.
    expect(fitTabs([80, 80, 80, 80, 80], 300, 1, 60)).toEqual([0, 1, 2]);
  });

  it('always keeps the active tab, moving the last ones that fit under More', () => {
    expect(fitTabs([80, 80, 80, 80, 80], 300, 4, 60)).toEqual([0, 1, 4]);
    // A wide active tab pushes out more than one.
    expect(fitTabs([80, 80, 80, 80, 160], 300, 4, 60)).toEqual([0, 4]);
    // Even when it alone is wider than the room.
    expect(fitTabs([80, 80, 400], 300, 2, 60)).toEqual([2]);
  });
});

describe('one-line tabs with More', () => {
  beforeEach(() => {
    // happy-dom has no layout: every tab is 100px wide, "+" 30px and More 70px, in a 300px row.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const kind = this.dataset.measure;
      const width = kind === 'tab' ? 100 : kind === 'plus' ? 30 : kind === 'more' ? 70 : 0;
      return { width, height: 20, top: 0, left: 0, right: width, bottom: 20 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('aria-label') === 'Views' ? 300 : 0;
    });
  });

  function renderMany(active: Entity<'view'>, views = many) {
    render(
      <MemoryRouter initialEntries={[`/projects/p/views/${active.id}`]}>
        <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
          <ViewTabs projectId="p" views={views} active={active} onCreated={vi.fn()} />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </ViewDataProvider>
      </MemoryRouter>,
    );
  }

  const tabNames = () =>
    [...screen.getByRole('navigation', { name: 'Views' }).querySelectorAll('a[data-tabstop]')].map(
      (a) => a.textContent,
    );

  it('puts the tabs that don’t fit under More, never on a second line', () => {
    renderMany(overview!);
    // 300 - 30 for "+" - 70 for More leaves 200: two tabs.
    expect(tabNames()).toEqual(['Overview', 'Delivery']);
    fireEvent.click(screen.getByRole('button', { name: 'More views (3)' }));
    const menu = screen.getByRole('menu', { name: 'More views' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual([
      'Extra 1',
      'Extra 2',
      'Extra 3',
    ]);
    // The menu takes focus, so it works by keyboard at once.
    expect(document.activeElement?.textContent).toBe('Extra 1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Extra 2' }));
    expect(screen.getByTestId('path').textContent).toBe('/projects/p/views/view_x2');
  });

  it('keeps the active tab visible even when it would fall under More', () => {
    renderMany(extra(3));
    expect(tabNames()).toEqual(['Overview', 'Extra 3']);
    expect(screen.getByRole('link', { name: 'Extra 3' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Options for Extra 3' })).toBeTruthy();
  });

  it('lists archived views in the same menu, after the hidden tabs', () => {
    renderMany(overview!, [...many, archived]);
    fireEvent.click(screen.getByRole('button', { name: 'More views (3, 1 archived)' }));
    const items = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')];
    expect(items.map((m) => m.textContent)).toEqual([
      'Extra 1',
      'Extra 2',
      'Extra 3',
      'Restore “Old plan”',
    ]);
    fireEvent.click(items[3]!);
    expect(apply).toHaveBeenLastCalledWith(
      'Restore view “Old plan”',
      [{ op: 'update', type: 'view', id: 'view_old', data: { archived: null } }],
      { undoable: true },
    );
  });

  it('moves between tabs with the arrow keys, and through the menu with ↑ ↓', () => {
    renderMany(overview!);
    const first = screen.getByRole('link', { name: 'Overview' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Delivery' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    const more = screen.getByRole('button', { name: 'More views (3)' });
    expect(document.activeElement).toBe(more);
    fireEvent.keyDown(more, { key: 'Home' });
    expect(document.activeElement).toBe(first);

    more.focus();
    fireEvent.click(more);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Extra 2');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    // Wraps around to the last.
    expect(document.activeElement?.textContent).toBe('Extra 3');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Extra 3');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    // Focus goes back to the button that opened it.
    expect(document.activeElement).toBe(more);
  });
});
