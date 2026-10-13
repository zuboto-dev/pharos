import clsx from 'clsx';

// A calm placeholder while something loads (W11.6, v0.2 B8): soft grey lines where the content
// will be, no spinner. Reduced motion keeps it still. Generic on purpose: a block, a list or a
// page can use it.

const WIDTHS = ['w-3/4', 'w-full', 'w-5/6', 'w-2/3', 'w-11/12', 'w-1/2'];

export function Skeleton({
  lines = 3,
  label = 'Loading',
  className,
}: {
  /** How many lines of text to suggest (default 3). */
  lines?: number;
  /** What screen readers hear while it loads. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={clsx('space-y-2.5', className)}
    >
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={clsx(
            'h-3 rounded-full bg-subtle motion-safe:animate-pulse',
            WIDTHS[i % WIDTHS.length],
          )}
        />
      ))}
    </div>
  );
}
