import { TextQuote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '../catalog/tooltip';
import { NOT_PICKABLE, PICK_SELECTOR, describeTarget, targetAt } from './reference';

type Box = { top: number; left: number; width: number; height: number; label: string };

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  const t = describeTarget(el);
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    label: t.title ? `${t.kind} · ${t.title}` : t.kind,
  };
}

/**
 * Picker mode (R17): while on, the pointer (or Tab focus) highlights the innermost block, sheet,
 * decision or task row under it, and a click (or Enter) picks it instead of opening it. Escape
 * leaves. The highlight is an outline drawn over the page, so nothing moves.
 */
export function usePicker(active: boolean, onPick: (el: Element) => void, onExit: () => void) {
  const [box, setBox] = useState<Box | null>(null);
  const current = useRef<Element | null>(null);
  const pick = useRef(onPick);
  const exit = useRef(onExit);
  useEffect(() => {
    pick.current = onPick;
    exit.current = onExit;
  }, [onPick, onExit]);

  useEffect(() => {
    if (!active) return;
    const show = (el: Element | null) => {
      current.current = el;
      setBox(el ? boxOf(el) : null);
    };
    const onMove = (e: PointerEvent) => {
      const el = targetAt(document.elementFromPoint(e.clientX, e.clientY));
      if (el !== current.current) show(el);
    };
    const swallow = (e: Event) => {
      const el = targetAt(e.target as Node);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const el = targetAt(e.target as Node);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      pick.current(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exit.current();
      } else if (e.key === 'Enter' && current.current && !e.isComposing) {
        const el = targetAt(e.target as Node);
        if (!el || el !== current.current) return;
        e.preventDefault();
        e.stopPropagation();
        pick.current(el);
      }
    };
    const onFocus = (e: FocusEvent) => {
      const el = targetAt(e.target as Node);
      if (el) show(el);
    };
    const follow = () => current.current && setBox(boxOf(current.current));
    // Blocks and documents' blocks aren't focusable by themselves: they are, while picking.
    const added: Element[] = [];
    for (const el of document.querySelectorAll(PICK_SELECTOR))
      if (!el.hasAttribute('tabindex') && !el.closest(NOT_PICKABLE)) {
        el.setAttribute('tabindex', '0');
        added.push(el);
      }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.documentElement.dataset.picking = '';
    // The first block takes focus, so Tab and Enter work right away.
    (added[0] as HTMLElement | undefined)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      delete document.documentElement.dataset.picking;
      for (const el of added) el.removeAttribute('tabindex');
      current.current = null;
      setBox(null);
    };
  }, [active]);

  return box;
}

/** The picker's outline over the page: drawn on top, so the page keeps its layout. */
export function PickHighlight({ box }: { box: Box | null }) {
  if (!box) return null;
  return createPortal(
    <div
      aria-hidden
      data-pick-ignore=""
      className="pointer-events-none fixed z-[70] rounded-tile outline-2 outline-offset-2 outline-accent"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      <span className="absolute -top-6 left-0 max-w-full truncate rounded-control bg-accent px-1.5 py-0.5 text-xs font-medium text-on-inverse dark:text-neutral-900">
        {box.label}
      </span>
    </div>,
    document.body,
  );
}

/**
 * Text selected on the page (R17): a small icon by the selection points the agent at it, with
 * the quoted words and where they are.
 */
export function SelectionPoint({
  enabled,
  onPoint,
}: {
  enabled: boolean;
  onPoint: (target: Element | null, text: string) => void;
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const picked = useRef<{ target: Element | null; text: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const selection = document.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!selection || selection.isCollapsed || !text || !selection.rangeCount) {
        picked.current = null;
        setAt(null);
        return;
      }
      const anchor = selection.anchorNode;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement;
      // Not in the panel, a field or other chrome; only words on the project's page.
      if (!el || el.closest(`${NOT_PICKABLE}, input, textarea, [contenteditable="true"]`)) {
        picked.current = null;
        setAt(null);
        return;
      }
      const rects = selection.getRangeAt(0).getClientRects();
      const last = rects[rects.length - 1];
      if (!last) return;
      picked.current = { target: targetAt(el), text };
      setAt({
        top: Math.min(last.bottom + 6, window.innerHeight - 40),
        left: Math.min(last.right, window.innerWidth - 44),
      });
    };
    const later = () => setTimeout(check, 0);
    const hide = () => setAt(null);
    const collapsed = () => document.getSelection()?.isCollapsed && hide();
    document.addEventListener('mouseup', later);
    document.addEventListener('keyup', later);
    document.addEventListener('selectionchange', collapsed);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseup', later);
      document.removeEventListener('keyup', later);
      document.removeEventListener('selectionchange', collapsed);
      window.removeEventListener('scroll', hide, true);
      setAt(null);
    };
  }, [enabled]);

  if (!at) return null;
  return createPortal(
    <div data-pick-ignore="" className="fixed z-[70]" style={{ top: at.top, left: at.left }}>
      <Tooltip label="Point the agent at this">
        <button
          type="button"
          aria-label="Point the agent at this"
          // Keeps the selection while the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const p = picked.current;
            if (p) onPoint(p.target, p.text);
            document.getSelection()?.removeAllRanges();
            setAt(null);
          }}
          className="inline-flex size-8 items-center justify-center rounded-control border border-line-strong bg-surface text-accent shadow-popover hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <TextQuote className="size-4" aria-hidden />
        </button>
      </Tooltip>
    </div>,
    document.body,
  );
}
