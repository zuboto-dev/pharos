import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const WIDTH = 288;
/** The gap between the button and the panel. */
const GAP = 6;
/** The panel keeps at least this far from every edge of the screen. */
const INSET = 8;

export type Placement = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  /** The panel scrolls past this, so it never runs off the screen. */
  maxHeight: number;
};

/**
 * Where a panel of `height` goes beside `anchor` in a `viewport`: below the button when it fits
 * there or there's more room below than above, otherwise above; always inside an 8px inset, with
 * a height cap so a tall panel (a claim with seven sources) scrolls instead of leaving the screen.
 */
export function placePanel(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left'>,
  viewport: { width: number; height: number },
  height: number,
): Placement {
  const width = Math.max(0, Math.min(WIDTH, viewport.width - 2 * INSET));
  const left = Math.max(INSET, Math.min(anchor.left, viewport.width - width - INSET));
  const roomBelow = viewport.height - anchor.bottom - GAP - INSET;
  const roomAbove = anchor.top - GAP - INSET;
  const clampEdge = (edge: number) => Math.max(INSET, Math.min(edge, viewport.height - INSET));
  if (height <= roomBelow || roomBelow >= roomAbove) {
    const top = clampEdge(anchor.bottom + GAP);
    return { left, width, top, maxHeight: Math.max(0, viewport.height - INSET - top) };
  }
  const bottom = clampEdge(viewport.height - anchor.top + GAP);
  return { left, width, bottom, maxHeight: Math.max(0, viewport.height - INSET - bottom) };
}

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
  // Measured once open (before paint), so the side is chosen by the panel's real height.
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = panel.current;
    if (el) setHeight(el.scrollHeight + el.offsetHeight - el.clientHeight);
  }, []);
  const place = placePanel(
    anchor,
    { width: window.innerWidth, height: window.innerHeight },
    height,
  );
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
        style={place}
        className="fixed z-[61] animate-pop-in space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-3 text-left text-sm font-normal text-neutral-700 shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
