import { useEffect, useState } from 'react';

// Motion helpers (v0.2 B3). The animations themselves are CSS (`animate-*` in index.css), with
// shared durations and easing; reduced motion turns every movement into an opacity change.

/** How long a leaving drawer, lightbox or block stays on screen (index.css `--motion-base`). */
export const EXIT_MS = 160;

/**
 * Keeps the last value on screen for `ms` after it goes away, so it can fade out: `shown` is the
 * value to render (the last one while leaving), `leaving` says it's on its way out.
 */
export function useExit<T>(value: T | null | undefined, ms = EXIT_MS) {
  const present = value !== null && value !== undefined;
  const [last, setLast] = useState<T | null>(present ? value : null);
  // Remember the latest value while it is present (adjusting state during render, as React
  // recommends for state derived from props).
  if (present && last !== value) setLast(value);
  const leaving = !present && last !== null;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLast(null), ms);
    return () => clearTimeout(timer);
  }, [leaving, ms]);
  return { shown: present ? value : last, leaving };
}
