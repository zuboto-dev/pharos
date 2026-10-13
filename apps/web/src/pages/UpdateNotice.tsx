import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNewerBuild } from '../lib/events';

/**
 * Offers a reload once Pharos has been updated underneath this page, so new blocks don't show as
 * unknown. Never reloads by itself (that could drop unsaved typing); "Later" hides it until the
 * next update.
 */
export function UpdateNotice({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const build = useNewerBuild();
  const [dismissed, setDismissed] = useState<string>();
  if (!build || dismissed === build) return null;
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-tile border border-line-strong bg-surface px-4 py-3 text-sm shadow-popover"
    >
      <RefreshCw className="size-4 shrink-0 text-amber-500" aria-hidden />
      <p className="text-ink-soft">Pharos has been updated. Reload to use the new version.</p>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => setDismissed(build)}
          className="rounded-control px-2 py-1 text-muted hover:bg-subtle hover:text-ink"
        >
          Later
        </button>
        <button
          type="button"
          onClick={reload}
          className="rounded-control bg-inverse px-2.5 py-1 font-medium text-on-inverse hover:bg-neutral-700 dark:hover:bg-neutral-300"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
