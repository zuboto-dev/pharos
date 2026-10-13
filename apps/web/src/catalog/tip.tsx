import clsx from 'clsx';
import type { ReactNode } from 'react';

const ICON_BASE =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-sm font-medium transition-colors duration-(--motion-quick) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-40';

/** Icon-only buttons (the project's top bar, compact file actions); complete strings per look. */
export const ICON_BUTTON = {
  secondary: `${ICON_BASE} border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100`,
  accent: `${ICON_BASE} border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900`,
  pressed: `${ICON_BASE} border-neutral-400 bg-neutral-100 text-neutral-900 dark:border-neutral-500 dark:bg-neutral-800 dark:text-neutral-100`,
  primary: `${ICON_BASE} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`,
} as const;

/**
 * A small tooltip for an icon-only control (v0.2 B1): shown on hover (after a short wait) and
 * at once on keyboard focus. The control keeps its own `aria-label` (and `aria-keyshortcuts`),
 * so the tooltip is only what sighted readers see; screen readers already hear the label.
 * Hidden with `display: none` when not shown, so it never widens the page on a phone.
 */
export function Tip({
  label,
  shortcut,
  align = 'center',
  side = 'bottom',
  children,
  className,
}: {
  label: string;
  /** The keyboard shortcut, as this computer writes it (e.g. "⌘\\"). */
  shortcut?: string;
  /** Which edge of the control the tooltip lines up with; `end` near the right of the screen. */
  align?: 'start' | 'center' | 'end';
  side?: 'bottom' | 'right';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx('group/tip relative inline-flex', className)}>
      {children}
      <span
        aria-hidden
        data-tip
        className={clsx(
          'pointer-events-none absolute z-[70] hidden items-center gap-1.5 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white shadow-md dark:bg-neutral-100 dark:text-neutral-900',
          'animate-pop-in group-hover/tip:flex group-hover/tip:[animation-delay:300ms] group-has-[:focus-visible]/tip:flex group-has-[:focus-visible]/tip:[animation-delay:0ms]',
          side === 'bottom'
            ? clsx(
                'top-full mt-1.5',
                align === 'start' && 'left-0',
                align === 'end' && 'right-0',
                align === 'center' && 'left-1/2 -translate-x-1/2',
              )
            : 'top-1/2 left-full ml-1.5 -translate-y-1/2',
        )}
      >
        {label}
        {shortcut && (
          <kbd className="rounded bg-white/15 px-1 font-sans text-[0.7rem] dark:bg-black/10">
            {shortcut}
          </kbd>
        )}
      </span>
    </span>
  );
}
