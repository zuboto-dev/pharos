// Search everything (⌘K). Every project and item here is made up.
import type { SearchHit } from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchButton, SearchProvider } from './SearchPalette';
import { isSearchShortcut } from './shortcut';

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'id' | 'type' | 'title'>): SearchHit => ({
  projectId: 'prj_garden',
  project: 'Garden',
  href: `/projects/prj_garden?entity=${over.id}`,
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

const HITS: SearchHit[] = [
  hit({ id: 'gol_1', type: 'goal', title: 'Tomatoes' }),
  hit({ id: 'tsk_1', type: 'task', title: 'Water tomatoes' }),
  hit({
    id: 'tsk_2',
    type: 'task',
    title: 'Fix the fence',
    snippet: 'Buy posts before the tomatoes go in.',
  }),
  hit({
    id: 'viw_1',
    type: 'view',
    title: 'Season report',
    href: '/projects/prj_garden/views/viw_1',
  }),
];

let queries: string[];

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SearchProvider>
        <SearchButton />
        <input aria-label="Elsewhere" />
        <div data-agent-panel="">
          <textarea aria-label="Terminal" />
        </div>
        <Where />
      </SearchProvider>
    </MemoryRouter>,
  );
}

const setPlatform = (platform: string) =>
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });

beforeEach(() => {
  queries = [];
  localStorage.clear();
  setPlatform('MacIntel');
  vi.stubGlobal('fetch', async (url: string) => {
    const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
    queries.push(q);
    return Response.json({ query: q, hits: q.includes('tom') ? HITS : [] });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const palette = () => screen.queryByRole('dialog', { name: 'Search' });
const press = (key: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });

describe('search palette', () => {
  it('opens and closes with ⌘K from anywhere, and with the button', async () => {
    renderApp();
    expect(palette()).toBeNull();
    press('k', screen.getByLabelText('Elsewhere'), { metaKey: true });
    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    press('k', screen.getByRole('combobox'), { metaKey: true });
    expect(palette()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(palette()).not.toBeNull();
    press('Escape', screen.getByRole('combobox'));
    expect(palette()).toBeNull();
  });

  it('uses Ctrl+K off a Mac, but leaves it to the agent terminal', () => {
    setPlatform('Win32');
    renderApp();
    press('k', screen.getByLabelText('Terminal'), { ctrlKey: true });
    expect(palette()).toBeNull();
    press('k', screen.getByLabelText('Elsewhere'), { ctrlKey: true });
    expect(palette()).not.toBeNull();
  });

  it('shows results by kind, highlights the words, and opens one with arrows and Enter', async () => {
    renderApp();
    press('k', document.body, { metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'tom' } });
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(4));
    expect(
      within(list)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Goals', 'Tasks', 'Views and reports']);
    expect(within(list).getAllByText('Tom', { selector: 'mark' }).length).toBe(1);
    expect(screen.getByText('Buy posts before the', { exact: false })).toBeTruthy();
    const options = within(list).getAllByRole('option');
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    press('ArrowDown', input);
    press('ArrowDown', input);
    expect(options[2]!.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2]!.id);
    press('ArrowUp', input);
    press('ArrowUp', input);
    press('ArrowUp', input);
    expect(options[3]!.getAttribute('aria-selected')).toBe('true');
    press('Enter', input);
    expect(palette()).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/projects/prj_garden/views/viw_1');
    expect(queries).toEqual(['tom']);
  });

  it('opens a result with the mouse, and remembers it for an empty search', async () => {
    renderApp();
    press('k', document.body, { metaKey: true });
    expect(screen.getByText(/Find any project/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tomatoes' } });
    fireEvent.click(await screen.findByRole('option', { name: /Water tomatoes/ }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/prj_garden?entity=tsk_1');
    press('k', document.body, { metaKey: true });
    const group = screen.getByRole('group', { name: 'Recently opened' });
    expect(within(group).getByRole('option').textContent).toContain('Water tomatoes');
  });

  it('says when nothing matches, and waits for the results before Enter opens', async () => {
    renderApp();
    press('k', document.body, { metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zebra' } });
    await screen.findByText('Nothing matches “zebra”.');
    fireEvent.change(input, { target: { value: 'tomatoes' } });
    press('Enter', input);
    expect(palette()).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/projects/prj_garden?entity=gol_1'),
    );
    await act(async () => {});
    expect(palette()).toBeNull();
  });
});

describe('isSearchShortcut', () => {
  it('needs exactly ⌘K on a Mac', () => {
    setPlatform('MacIntel');
    const key = (init: KeyboardEventInit) => isSearchShortcut(new KeyboardEvent('keydown', init));
    expect(key({ key: 'k', metaKey: true })).toBe(true);
    expect(key({ key: 'K', metaKey: true })).toBe(true);
    expect(key({ key: 'k', ctrlKey: true })).toBe(false);
    expect(key({ key: 'k', metaKey: true, shiftKey: true })).toBe(false);
    expect(key({ key: 'j', metaKey: true })).toBe(false);
  });
});
