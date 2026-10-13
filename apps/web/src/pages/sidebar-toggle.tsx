import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// R7.14: hide and show the app's left sidebar on wide screens, from a button or ⌘\ (Ctrl+\ off
// a Mac). The choice is remembered in this browser. Phones keep the sidebar above the page.

export const SIDEBAR_HIDDEN_KEY = 'pharos-sidebar-hidden';
/** The sidebar's element id, named by the toggles' aria-controls. */
export const SIDEBAR_ID = 'app-sidebar';

function readHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(SIDEBAR_HIDDEN_KEY, '1');
    else localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
  } catch {
    // Storage may be unavailable; the sidebar still toggles for this page.
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

/**
 * Whether the sidebar is hidden, a toggle, and the toggle's focus target: after a button hides or
 * shows the sidebar, focus moves to the button that shows or hides it again.
 */
export function useSidebarHidden() {
  const [hidden, setHidden] = useState(readHidden);
  const moveFocus = useRef(false);
  const toggle = useCallback((fromButton = false) => {
    moveFocus.current = fromButton;
    setHidden((h) => {
      saveHidden(!h);
      return !h;
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
  return { hidden, toggle, moveFocus };
}

const BUTTON =
  'hidden size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-sky-400 md:inline-flex dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200';

/** The button that hides or shows the sidebar (wide screens only; phones don't need it). */
export function SidebarToggle({
  hidden,
  onToggle,
  focusOnMount,
}: {
  hidden: boolean;
  onToggle: () => void;
  /** Take focus when shown, because the button that was pressed just went away. */
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  const label = hidden ? 'Show sidebar' : 'Hide sidebar';
  const Icon = hidden ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-expanded={!hidden}
      aria-controls={SIDEBAR_ID}
      aria-keyshortcuts="Meta+Backslash Control+Backslash"
      title={`${label} (${shortcutLabel()})`}
      onClick={onToggle}
      className={BUTTON}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
