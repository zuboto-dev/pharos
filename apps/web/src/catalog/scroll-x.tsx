import { MoveHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Wide tables on narrow screens (v0.2 B9): a table wider than its block scrolls inside the block,
// never the page, and says so: a soft fade at the edge with more to see, and a line under it
// ("Scroll sideways for more"). One rule for every table block (DataTable, TaskTable,
// AssigneeMatrix), chosen over stacked cards so columns keep lining up for comparison.

export function ScrollX({
  children,
  className,
  label = 'Table',
}: {
  children: ReactNode;
  className?: string;
  /** What scrolls, for screen readers ("Tasks"); it's announced only when it does scroll. */
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ wide: false, end: true });
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const wide = el.scrollWidth > el.clientWidth + 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setState((s) => (s.wide === wide && s.end === end ? s : { wide, end }));
  }, []);
  useEffect(() => {
    const el = box.current;
    measure();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className={className} data-scroll-x={state.wide || undefined}>
      <div className="relative">
        <div
          ref={box}
          onScroll={measure}
          // A keyboard can scroll it too, once it's wider than the block.
          tabIndex={state.wide ? 0 : undefined}
          role={state.wide ? 'region' : undefined}
          aria-label={state.wide ? `${label} (scrolls sideways)` : undefined}
          className="overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400"
        >
          {children}
        </div>
        {state.wide && !state.end && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-surface to-transparent"
          />
        )}
      </div>
      {state.wide && (
        <p className="flex items-center gap-1.5 border-t border-line-soft px-4 py-1.5 text-xs text-muted">
          <MoveHorizontal className="size-3.5" aria-hidden /> Scroll sideways for more
        </p>
      )}
    </div>
  );
}
