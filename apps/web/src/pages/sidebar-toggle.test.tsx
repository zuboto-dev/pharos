// R7.14: hide and show the sidebar from a button or ⌘\ / Ctrl+\, remembered per browser · Opus 5.5
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { SIDEBAR_HIDDEN_KEY, SIDEBAR_ID } from './sidebar-toggle';

beforeEach(() => {
  vi.stubGlobal('fetch', async () => Response.json([]));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderShell() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>Home page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return document.getElementById(SIDEBAR_ID)!;
}

const isHidden = (aside: HTMLElement) => aside.className.split(/\s+/).includes('md:hidden');

describe('sidebar toggle', () => {
  it('hides and shows the sidebar from the header button, with an accessible name and state', () => {
    const aside = renderShell();
    expect(isHidden(aside)).toBe(false);
    const hide = screen.getByRole('button', { name: 'Hide sidebar' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(hide.getAttribute('aria-controls')).toBe(SIDEBAR_ID);
    expect(hide.getAttribute('title')).toMatch(/Hide sidebar \((⌘|Ctrl\+)\\\)/);
    fireEvent.click(hide);
    expect(isHidden(aside)).toBe(true);
    const show = screen.getByRole('button', { name: 'Show sidebar' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    // The pressed button went away; focus moves to the one that brings the sidebar back.
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    expect(isHidden(aside)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide sidebar' }));
    // The page itself stays.
    expect(screen.getByText('Home page')).toBeTruthy();
  });

  it('toggles with ⌘\\ and Ctrl+\\, but not with other keys', () => {
    const aside = renderShell();
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true });
    expect(isHidden(aside)).toBe(true);
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', ctrlKey: true });
    expect(isHidden(aside)).toBe(false);
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash' });
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true, shiftKey: true });
    expect(isHidden(aside)).toBe(false);
  });

  it('remembers the choice in this browser', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBe('1');
    cleanup();
    const aside = renderShell();
    expect(isHidden(aside)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBeNull();
  });

  it('still toggles when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const aside = renderShell();
    expect(isHidden(aside)).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', code: 'Backslash', ctrlKey: true });
    });
    expect(isHidden(aside)).toBe(true);
  });

  it('keeps phones as they were: the toggles show on wide screens only', () => {
    const aside = renderShell();
    // Hidden applies from the md breakpoint up; below it the sidebar stays above the page.
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(aside.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    const show = screen.getByRole('button', { name: 'Show sidebar' });
    expect(show.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(show.className).toContain('md:inline-flex');
  });
});
