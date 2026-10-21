import clsx from 'clsx';
import { Info } from 'lucide-react';
import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

// The one tooltip (docs/design/principles.md): a symbol leads and the words wait here, never
// deleted. Shown on hover after a short wait, at once on keyboard focus, and on a long press on a
// touch screen. Screen readers never read the floating copy (it is aria-hidden); they hear the
// same words from the control itself: its accessible name (`label` must match it) and, for
// `detail`, a description this component adds with aria-describedby.

const ICON_BASE =
  'inline-flex h-8 min-w-8 shrink-0 pointer-coarse:min-w-11 items-center justify-center gap-1 rounded-control border px-1.5 text-sm font-medium transition-colors duration-(--motion-quick) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-40';

/** Icon-only buttons (the project's top bar, compact file actions); complete strings per look. */
export const ICON_BUTTON = {
  secondary: `${ICON_BASE} border-line-strong bg-surface text-ink-soft hover:bg-neutral-50 hover:text-ink dark:hover:bg-neutral-800`,
  accent: `${ICON_BASE} border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900`,
  pressed: `${ICON_BASE} border-neutral-400 bg-subtle text-ink dark:border-neutral-500`,
  primary: `${ICON_BASE} border-inverse bg-inverse text-on-inverse hover:bg-neutral-700 dark:hover:bg-neutral-300`,
} as const;

/** A quiet icon button (sidebar rows, tab bars, notices): no border, faint until hovered. */
export const ICON_GHOST =
  'inline-flex shrink-0 items-center justify-center rounded-control p-1 text-faint hover:bg-subtle hover:text-ink-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400';

/** How long the pointer rests on a control before its tooltip shows. */
export const HOVER_DELAY = 350;
/** How long a finger stays down before the tooltip shows (and the tap no longer counts). */
export const LONG_PRESS = 450;
/** How long a long-press tooltip stays after the finger lifts. */
const TOUCH_LINGER = 1600;
const HIDDEN_AT_START: CSSProperties = { left: 0, top: 0, visibility: 'hidden' };
const GAP = 6;
const INSET = 8;

export type TipSide = 'bottom' | 'top' | 'right';

/**
 * Where a tooltip of `size` goes beside `anchor`: on `side` when it fits, else the opposite side,
 * centred on the control and kept 8px inside the screen (the same inset as popovers).
 */
export function placeTip(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  side: TipSide = 'bottom',
): { left: number; top: number; side: TipSide } {
  const clampX = (x: number) => Math.max(INSET, Math.min(x, viewport.width - size.width - INSET));
  const clampY = (y: number) => Math.max(INSET, Math.min(y, viewport.height - size.height - INSET));
  const centreX = (anchor.left + anchor.right) / 2 - size.width / 2;
  const centreY = (anchor.top + anchor.bottom) / 2 - size.height / 2;
  if (side === 'right' && anchor.right + GAP + size.width + INSET <= viewport.width)
    return { left: anchor.right + GAP, top: clampY(centreY), side: 'right' };
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const fitsBelow = below + size.height + INSET <= viewport.height;
  const fitsAbove = above >= INSET;
  const goBelow = side === 'top' ? !fitsAbove && fitsBelow : fitsBelow || !fitsAbove;
  return {
    left: clampX(centreX),
    top: goBelow ? clampY(below) : clampY(above),
    side: goBelow ? 'bottom' : 'top',
  };
}

const focusVisible = (el: Element) => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

type Props = {
  /** The control's name, as its aria-label (or text) says it. Shown first. */
  label?: string;
  /** More words than the name: shown under it, and given to screen readers as a description. */
  detail?: string;
  /** The keyboard shortcut, as this computer writes it (e.g. "⌘\\"). */
  shortcut?: string;
  side?: TipSide;
  /** A tap or click toggles it (an (i) button that has nothing else to do). */
  toggleOnClick?: boolean;
  /** The one control it explains; it keeps its own aria-label. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
};

export function Tooltip({
  label,
  detail,
  shortcut,
  side = 'bottom',
  toggleOnClick,
  children,
  className,
}: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressed = useRef(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const descriptionId = useId();
  const shown = open || pinned;

  const clear = () => clearTimeout(timer.current);
  const later = (ms: number, fn: () => void) => {
    clear();
    timer.current = setTimeout(fn, ms);
  };
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  }, []);
  useEffect(() => clear, []);

  // Placed once it is in the page and measured; follows nothing (it hides on scroll instead).
  useLayoutEffect(() => {
    if (!shown || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const place = placeTip(
      a,
      { width: t.width, height: t.height },
      { width: window.innerWidth, height: window.innerHeight },
      side,
    );
    // Straight onto the element: it starts hidden at 0,0 and is shown where it fits.
    Object.assign(tip.current.style, {
      left: `${place.left}px`,
      top: `${place.top}px`,
      visibility: 'visible',
    });
  }, [shown, side, label, detail]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    const onAway = (e: Event) => {
      if (!anchor.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('pointerdown', onAway, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('pointerdown', onAway, true);
    };
  }, [shown, hide]);

  const handlers = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') later(HOVER_DELAY, () => setOpen(true));
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        clear();
        setOpen(false);
      }
    },
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        // A click acts at once; the tooltip has done its job.
        clear();
        setOpen(false);
        return;
      }
      longPressed.current = false;
      later(LONG_PRESS, () => {
        longPressed.current = true;
        setOpen(true);
      });
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (longPressed.current) later(TOUCH_LINGER, () => setOpen(false));
      else clear();
    },
    onPointerCancel: () => clear(),
    onContextMenu: (e: MouseEvent) => {
      // A long press shows the words, not the browser's own menu.
      if (longPressed.current) e.preventDefault();
    },
    onClickCapture: (e: MouseEvent) => {
      // The finger was asking what it is, not pressing it.
      if (longPressed.current) {
        longPressed.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (toggleOnClick) setPinned((p) => !p);
    },
    onFocus: (e: FocusEvent) => {
      if (focusVisible(e.target)) {
        clear();
        setOpen(true);
      }
    },
    onBlur: () => hide(),
  };

  const trigger = detail
    ? cloneElement(children, {
        'aria-describedby': clsx(children.props['aria-describedby'], descriptionId),
      })
    : children;

  return (
    <span
      ref={anchor}
      className={clsx('inline-flex [-webkit-touch-callout:none]', className)}
      {...handlers}
    >
      {trigger}
      {detail && (
        <span id={descriptionId} className="sr-only">
          {detail}
        </span>
      )}
      {shown &&
        createPortal(
          <div
            ref={tip}
            aria-hidden
            data-tip=""
            style={HIDDEN_AT_START}
            className={clsx(
              'pointer-events-none fixed z-[70] animate-pop-in rounded-control bg-inverse px-2 py-1 text-xs text-on-inverse shadow-md',
              detail ? 'max-w-72 whitespace-normal' : 'whitespace-nowrap',
            )}
          >
            {(label || shortcut) && (
              <span className="flex items-center gap-1.5 font-medium">
                {label}
                {shortcut && (
                  <kbd className="rounded bg-white/15 px-1 font-sans text-[0.7rem] dark:bg-black/10">
                    {shortcut}
                  </kbd>
                )}
              </span>
            )}
            {detail && (
              <span className={clsx('block leading-snug', label && 'mt-0.5 opacity-80')}>
                {detail}
              </span>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * An (i) that holds an explanation: the words a page used to print, one tap, hover or focus
 * away. Its name says what it explains ("About folders"); the words are its description.
 */
export function InfoTip({
  label,
  detail,
  className,
}: {
  label: string;
  detail: string;
  className?: string;
}) {
  return (
    <Tooltip detail={detail} toggleOnClick className={className}>
      <button type="button" aria-label={label} className={clsx(ICON_GHOST, 'tap-area p-0.5')}>
        <Info className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
