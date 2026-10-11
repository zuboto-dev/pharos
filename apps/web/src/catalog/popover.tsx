import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const WIDTH = 288;

/**
 * A small panel that opens from a button: on tap, Enter or Space; it closes on a second tap,
 * Escape, or a tap outside. Shared by certainty marks and terms. Several buttons may open the
 * same popover (a mark and its "Sources (n)"); focus returns to the one that opened it.
 */
export function usePopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    open: anchor !== null,
    anchor,
    /** Spread on each button that opens it. */
    trigger: {
      'aria-expanded': anchor !== null,
      'aria-haspopup': 'dialog' as const,
      onClick: (e: MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        opener.current = e.currentTarget;
        setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect());
      },
    },
    close: (refocus: boolean) => {
      setAnchor(null);
      if (refocus) opener.current?.focus();
    },
  };
}

/** The panel itself, in a portal so scrolling panels don't clip it. */
export function Popover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  /** What it's about, for screen readers, e.g. the term's word. */
  label: string;
  onClose: (refocus: boolean) => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Move focus in so its links are the next Tab stops.
  useEffect(() => panel.current?.focus(), []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key !== 'Tab') return;
    // Leaving the panel closes it and goes back to its button, so Tab carries on from there.
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button')];
    const leaving = e.shiftKey
      ? document.activeElement === e.currentTarget || document.activeElement === stops[0]
      : document.activeElement === (stops.at(-1) ?? e.currentTarget);
    if (leaving) {
      e.preventDefault();
      onClose(true);
    }
  };
  const below = anchor.bottom + 240 < window.innerHeight;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => onClose(false)} />
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={
          below
            ? { left, top: anchor.bottom + 6 }
            : { left, bottom: window.innerHeight - anchor.top + 6 }
        }
        className="fixed z-[61] w-72 max-w-[calc(100vw-16px)] space-y-2 rounded-xl border border-neutral-200 bg-white p-3 text-left text-sm font-normal text-neutral-700 shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
