import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MENU_PANEL } from './select';

/** A dropdown under `anchor`, in a portal so scrolling containers (tab rows, the sidebar) don't clip it. */
export function Menu({
  anchor,
  onClose,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
}) {
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 320);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        role="menu"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        style={{
          top: Math.max(8, top),
          left: Math.max(8, Math.min(anchor.left, window.innerWidth - 248)),
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
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-800',
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
