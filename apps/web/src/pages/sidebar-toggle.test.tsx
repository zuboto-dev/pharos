// The sidebar on wide screens (the owner, 10-21): collapsed to a rail by default, sliding out on
// hover or focus; a button keeps it open, and the same button (or ⌘\ / Ctrl+\) collapses it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { SIDEBAR_ID, SIDEBAR_PINNED_KEY } from './sidebar-toggle';

beforeEach(() => {
  vi.stubGlobal('fetch', async () => Response.json([]));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

const state = () => document.getElementById(SIDEBAR_ID)!.dataset.sidebar;
const rail = () => document.querySelector<HTMLElement>('[data-sidebar-rail]');

describe('sidebar on wide screens', () => {
  it('starts collapsed to a rail with no toggle button, and slides out while hovered', () => {
    vi.useFakeTimers();
    renderShell();
    expect(state()).toBe('collapsed');
    expect(rail()).toBeTruthy();
    // Only the bell (what happened while away) sits on the rail: no toggle.
    expect(rail()!.querySelector('button:not([data-bell])')).toBeNull();
    fireEvent.mouseEnter(rail()!);
    expect(state()).toBe('peek');
    // Moving from the rail onto the sidebar keeps it out.
    fireEvent.mouseLeave(rail()!);
    fireEvent.mouseEnter(document.getElementById(SIDEBAR_ID)!);
    act(() => vi.advanceTimersByTime(400));
    expect(state()).toBe('peek');
    fireEvent.mouseLeave(document.getElementById(SIDEBAR_ID)!);
    act(() => vi.advanceTimersByTime(400));
    expect(state()).toBe('collapsed');
  });

  it('opens on keyboard focus too', () => {
    renderShell();
    fireEvent.focus(screen.getByRole('link', { name: 'Pharos home' }));
    expect(state()).toBe('peek');
  });

  it('keeps it open from the button, and the same button collapses it again', () => {
    renderShell();
    fireEvent.mouseEnter(rail()!);
    const keep = screen.getByRole('button', { name: 'Keep the sidebar open' });
    expect(keep.getAttribute('aria-pressed')).toBe('false');
    expect(keep.getAttribute('aria-controls')).toBe(SIDEBAR_ID);
    fireEvent.click(keep);
    expect(state()).toBe('open');
    expect(rail()).toBeNull();
    expect(localStorage.getItem(SIDEBAR_PINNED_KEY)).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the sidebar' }));
    expect(state()).toBe('collapsed');
    expect(localStorage.getItem(SIDEBAR_PINNED_KEY)).toBeNull();
  });

  it('switches with ⌘\\ and Ctrl+\\, but not with other keys', () => {
    renderShell();
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    expect(state()).toBe('open');
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    expect(state()).toBe('collapsed');
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(state()).toBe('collapsed');
  });

  it('remembers kept open in this browser', () => {
    localStorage.setItem(SIDEBAR_PINNED_KEY, '1');
    renderShell();
    expect(state()).toBe('open');
  });

  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderShell();
    expect(state()).toBe('collapsed');
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    expect(state()).toBe('open');
  });

  it('keeps phones as they were: the rail and the button show on wide screens only', () => {
    renderShell();
    expect(rail()!.className).toContain('hidden');
    expect(rail()!.className).toContain('md:flex');
    expect(document.getElementById(SIDEBAR_ID)!.className).toContain('md:hidden');
  });
});
