/** Pharos means lighthouse: a tower with a lit lamp and two beams, in the icon set's line style. */
export function PharosLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* beams */}
      <path d="M3 4.5 7.5 6M3 9.5 7.5 8M21 4.5 16.5 6M21 9.5 16.5 8" opacity={0.6} />
      {/* lamp room and roof */}
      <path d="M9.5 9V5.5h5V9" />
      <path d="M8.5 5.5 12 2.5l3.5 3" />
      {/* tower */}
      <path d="M9 9h6l1.5 12h-9z" />
      <path d="M8.2 14.5h7.6" />
      <path d="M5 21h14" />
    </svg>
  );
}
