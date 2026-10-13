import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MENU_PANEL } from './select';

const ITEMS = '[role="menuitem"]:not([disabled])';

/**
 * Keyboard for a menu (v0.2 B1): ↑ ↓ move between its items (wrapping), Home and End jump to the
 * first and last, Escape closes it and Tab leaves it.
 */
export function menuKeyDown(e: KeyboardEvent<HTMLElement>, onClose: (refocus: boolean) => void) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onClose(true);
    return;
  }
  if (e.key === 'Tab') {
    onClose(false);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  if (!items.length) return;
  e.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index < 0 && e.key === 'ArrowUp' ? items.length - 1 : next]!.focus();
}

/**
 * A dropdown under `anchor`, in a portal so scrolling containers (tab rows, the sidebar) don't
 * clip it. It takes focus (its first item, or `initialFocus`), works by keyboard, and gives focus
 * back to the control that opened it when it closes with Escape.
 */
export function Menu({
  anchor,
  onClose,
  children,
  label,
  align = 'start',
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  /** What the menu is, for screen readers. */
  label?: string;
  /** `end` lines the menu up with the right edge of its button (a button at the row's end). */
  align?: 'start' | 'end';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first =
      panel.current?.querySelector<HTMLElement>('[role="menuitem"][aria-current="page"]') ??
      panel.current?.querySelector<HTMLElement>(ITEMS);
    first?.focus({ preventScroll: true });
  }, []);
  const close = (refocus: boolean) => {
    onClose();
    if (refocus) opener.current?.focus({ preventScroll: true });
  };
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 320);
  const left = align === 'end' ? anchor.right - 240 : anchor.left;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={panel}
        role="menu"
        aria-label={label}
        onKeyDown={(e) => menuKeyDown(e, close)}
        style={{
          top: Math.max(8, top),
          left: Math.max(8, Math.min(left, window.innerWidth - 248)),
        }}
        className={clsx('fixed z-[61] max-h-80 w-60 overflow-y-auto text-sm', MENU_PANEL)}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
  disabled,
  current,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** The item for the page shown now (e.g. the active view): marked, and focused first. */
  current?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800',
        current && 'font-medium',
        danger && 'text-rose-600 dark:text-rose-400',
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-neutral-400">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />;
}
