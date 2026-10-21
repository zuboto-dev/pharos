import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '../catalog/tooltip';

// The app's left sidebar on wide screens (the owner, 10-21): collapsed to a slim rail by default,
// sliding out over the page while hovered or focused; a button in it keeps it open, and the same
// button (or ⌘\, Ctrl+\ off a Mac) collapses it again. Kept open is remembered in this browser.
// Phones keep the sidebar above the page.

export const SIDEBAR_PINNED_KEY = 'pharos-sidebar-pinned';
/** The old hide/show setting (R7.14), no longer read. */
export const SIDEBAR_HIDDEN_KEY = 'pharos-sidebar-hidden';
/** The sidebar's element id, named by the toggles' aria-controls. */
export const SIDEBAR_ID = 'app-sidebar';

function readPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_KEY) === '1';
  } catch {
    return false;
  }
}

function savePinned(pinned: boolean) {
  try {
    if (pinned) localStorage.setItem(SIDEBAR_PINNED_KEY, '1');
    else localStorage.removeItem(SIDEBAR_PINNED_KEY);
  } catch {
    // Storage may be unavailable; the choice lasts for this page.
  }
}

/** ⌘\ on a Mac, Ctrl+\ elsewhere (either is accepted). */
export function isToggleShortcut(e: KeyboardEvent): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    (e.key === '\\' || e.code === 'Backslash')
  );
}

const isMac = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The shortcut as this computer writes it. */
export const shortcutLabel = () => (isMac() ? '⌘\\' : 'Ctrl+\\');

/** Whether the sidebar is kept open, and the switch between kept open and collapsed. */
export function useSidebarPinned() {
  const [pinned, setPinned] = useState(readPinned);
  const toggle = useCallback(() => {
    setPinned((p) => {
      savePinned(!p);
      return !p;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isToggleShortcut(e)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return { pinned, toggle };
}

/**
 * While collapsed: whether the sidebar is sliding out over the page (hovered or focused). It
 * opens at once and closes a moment after the pointer and focus leave, so passing over the edge
 * doesn't flicker.
 */
export function usePeek() {
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(() => {
    clearTimeout(timer.current);
    setPeek(true);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(false), 250);
  }, []);
  return { peek, show, hide, setPeek };
}

const BUTTON =
  'hidden size-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-sky-400 md:inline-flex';

/** The button in the open sidebar: keep it open, or collapse it back to the rail. */
export function SidebarToggle({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const label = pinned ? 'Collapse the sidebar' : 'Keep the sidebar open';
  const Icon = pinned ? PanelLeftClose : PanelLeftOpen;
  return (
    <Tooltip label={label} shortcut={shortcutLabel()}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pinned}
        aria-controls={SIDEBAR_ID}
        aria-keyshortcuts="Meta+Backslash Control+Backslash"
        onClick={onToggle}
        className={BUTTON}
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
