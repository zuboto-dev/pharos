import { useEffect, useLayoutEffect, useRef } from 'react';

// Live updates without jumps (v0.2 B4). When the change feed reloads the project while the owner
// reads, the board keeps the reading position and focus, a block whose content changed gets a
// soft ring that fades away, and a new block fades in where it lands. The marks are CSS classes
// (index.css) put straight on the block's element, so they cost no extra render.

/** A new block fading in where it lands. */
export const ENTER_CLASS = 'animate-rise-in';
/** A block whose content changed: a ring that fades out (not a flash). */
export const CHANGED_CLASS = 'animate-block-changed';
/** How long the board keeps its height after its blocks were swapped, while they load. */
export const HOLD_MS = 1200;
/** Content that loads after an update (a file's details, a history list) settles within this. */
const SETTLE_MS = 900;

/**
 * What a block shows, cheaply: its text. Two equal signatures mean nothing visible changed. An
 * agent's presence mark on the block (v0.2 B5) isn't the block's content, so it doesn't count.
 */
export function signatureOf(el: Element): string {
  let text = el.textContent ?? '';
  for (const mark of el.querySelectorAll('[data-presence]'))
    text = text.replace(mark.textContent ?? '', '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Restarts a CSS animation class on an element and takes it off when it ends. */
export function mark(el: HTMLElement, className: string) {
  el.classList.remove(className);
  // Reading layout restarts the animation when the same class comes back.
  void el.offsetWidth;
  el.classList.add(className);
  const done = () => {
    el.classList.remove(className);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

/**
 * Which blocks to mark after an update: `entered` are new ids, `changed` kept ids whose
 * signature differs. Nothing is marked on the first render (no `before`).
 */
export function diffBlocks(
  before: ReadonlyMap<string, string> | null,
  after: ReadonlyMap<string, string>,
): { entered: string[]; changed: string[] } {
  if (!before) return { entered: [], changed: [] };
  const entered: string[] = [];
  const changed: string[] = [];
  for (const [id, signature] of after) {
    if (!before.has(id)) entered.push(id);
    else if (before.get(id) !== signature) changed.push(id);
  }
  return { entered, changed };
}

/** How a focused control is found again after its block re-rendered: its name, not its node. */
export function focusKeyOf(el: Element): string {
  const name =
    el.getAttribute('aria-label') ??
    el.getAttribute('title') ??
    el.getAttribute('name') ??
    (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${el.tagName}|${el.getAttribute('role') ?? ''}|${name}`;
}

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';

/** The board's height without a height it is being held at. */
function naturalHeight(root: HTMLElement): number {
  const held = root.style.minHeight;
  root.style.minHeight = '';
  const height = root.offsetHeight;
  root.style.minHeight = held;
  return height;
}

function blocksIn(container: HTMLElement): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of container.querySelectorAll<HTMLElement>(':scope > [data-widget]'))
    map.set(el.dataset.widget!, signatureOf(el));
  return map;
}

/**
 * Live updates for a board: call it with the dataset `version` and the ids of the blocks shown,
 * and put the returned ref on the board's container (its blocks carry `data-widget`). `quiet()`
 * says the change is the owner's own (an edit on this page), and `editing` that the layout is
 * being edited; neither is marked as a change, though new blocks still fade in.
 */
export function useLiveBoard<T extends HTMLElement>(
  version: number,
  ids: readonly string[],
  quiet: () => boolean,
  editing: boolean,
) {
  const container = useRef<T>(null);
  // Read at the time of an update (the layout effect below runs after this one).
  const isQuiet = useRef(quiet);
  useLayoutEffect(() => {
    isQuiet.current = () => editing || quiet();
  });
  const seen = useRef<Map<string, string> | null>(null);
  const height = useRef(0);
  const idsKey = ids.join(' ');
  const lastIds = useRef(idsKey);
  // The control that had focus, so it can get it back if an update replaced its element.
  const focused = useRef<{ el: Element; widget: string; key: string } | null>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const widget = el.closest<HTMLElement>('[data-widget]')?.dataset.widget;
      focused.current = widget ? { el, widget, key: focusKeyOf(el) } : null;
    };
    // Moving focus elsewhere on purpose forgets it; losing it because the element went doesn't.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) focused.current = null;
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // The timer that lets go of a held height; it outlives re-renders (a second reload of the same
  // change must not let go early), and goes with the board.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    // Blocks swapped (an agent replaced the view): keep the board's height while they load, so
    // the page under the reader doesn't shrink and the scroll position stays where it was. This
    // comes first: anything below that reads layout would otherwise see the short board.
    const swapped = lastIds.current !== idsKey;
    lastIds.current = idsKey;
    if (swapped && height.current > 0) {
      const held = Math.max(height.current, parseFloat(root.style.minHeight) || 0);
      root.style.minHeight = `${held}px`;
      if (hold.current) clearTimeout(hold.current);
      hold.current = setTimeout(() => {
        root.style.minHeight = '';
        hold.current = null;
      }, HOLD_MS);
    } else if (!hold.current) height.current = root.offsetHeight;

    const after = blocksIn(root);
    const { entered, changed } = diffBlocks(seen.current, after);
    const calm = isQuiet.current();
    for (const id of entered) {
      const el = root.querySelector<HTMLElement>(`:scope > [data-widget="${CSS.escape(id)}"]`);
      if (el) mark(el, ENTER_CLASS);
    }
    if (!calm)
      for (const id of changed) {
        const el = root.querySelector<HTMLElement>(`:scope > [data-widget="${CSS.escape(id)}"]`);
        if (el) mark(el, CHANGED_CLASS);
      }
    seen.current = after;

    // Focus lost because its element was replaced: give it to the same control in the new one.
    const was = focused.current;
    const active = document.activeElement;
    if (was && !was.el.isConnected && (!active || active === document.body)) {
      // In the same block when it's still there, else anywhere on the board (a swapped block).
      const block =
        root.querySelector(`:scope > [data-widget="${CSS.escape(was.widget)}"]`) ?? root;
      const match = [...block.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
        (el) => focusKeyOf(el) === was.key,
      );
      if (match) {
        match.focus({ preventScroll: true });
        const widget = match.closest<HTMLElement>('[data-widget]')?.dataset.widget ?? was.widget;
        focused.current = { el: match, widget, key: was.key };
      }
    }

    // Content that loads just after (file details, history) is the new normal, not a change.
    const settle = setTimeout(() => {
      seen.current = blocksIn(root);
      height.current = naturalHeight(root);
    }, SETTLE_MS);
    return () => clearTimeout(settle);
  }, [version, idsKey]);
  return container;
}
