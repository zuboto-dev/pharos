import { compareDocs, comparisonLine, type Entity, type ViewVersion } from '@pharos/schema';
import clsx from 'clsx';
import { ArrowLeft, Layers, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useViewData } from '../catalog/context';
import { Skeleton } from '../catalog/skeleton';
import { BUTTON } from '../catalog/ui';
import { ApiError, ownerSend, useResource } from '../lib/api';
import { dateTime } from '../lib/format';
import { DocumentCompare } from './document';

/**
 * A page's version history, like a shared document's: every change (who, when and why) in a list
 * beside the page, and the version picked shown with what it changed marked. Versions come from
 * the change log (GET /api/views/:id/versions); restoring one is a new change, undoable.
 */

type ViewData = Entity<'view'>['data'];
type At = { version: ViewVersion; before: ViewData | null; after: ViewData | null };

/** How many versions a page has (its revisions). */
export function useVersionCount(view: Entity<'view'>): number {
  const { version } = useViewData();
  const versions = useResource<ViewVersion[]>(`/api/views/${view.id}/versions?v=${version}`);
  return Array.isArray(versions.data) ? versions.data.length : 0;
}

/**
 * "Versions · 4" beside the page's updated line: this page's own versions, shown in place. Named
 * apart from the project history (the clock in the toolbar), which lists every change in the
 * project.
 */
export function VersionsLink({ view }: { view: Entity<'view'> }) {
  const n = useVersionCount(view);
  if (n < 2) return null;
  return (
    <Link
      to="?versions=latest"
      className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 font-medium text-ink-soft hover:border-sky-400 hover:text-ink"
    >
      <Layers className="size-3.5" aria-hidden /> Versions · {n}
    </Link>
  );
}

export function ViewVersions({ view, selected }: { view: Entity<'view'>; selected: string }) {
  const { version } = useViewData();
  const list = useResource<ViewVersion[]>(`/api/views/${view.id}/versions?v=${version}`);
  const versions = Array.isArray(list.data) ? list.data : [];
  const rev = selected === 'latest' ? versions[0]?.revision : Number(selected);
  const at = useResource<At>(rev ? `/api/views/${view.id}/versions/${rev}` : null);
  const data = at.data?.version.revision === rev ? at.data : undefined;
  const comparison = useMemo(
    () => (data?.after?.doc ? compareDocs(data.before?.doc, data.after.doc) : undefined),
    [data],
  );
  const latest = versions[0]?.revision;
  // The version's document is the page as it is now (later changes left its blocks alone).
  const sameDoc =
    !!data?.after?.doc && JSON.stringify(data.after.doc) === JSON.stringify(view.data.doc);
  const shownView = data?.after ? { ...view, data: data.after } : view;
  const [restoreError, setRestoreError] = useState<string>();
  // A main page stays a document: a version that was a board can't be restored onto it.
  const blocked =
    view.data.kind === 'main' && data?.after && !data.after.doc && !data.after.page
      ? 'This version was a board; the main page is a document, so it can’t be restored here.'
      : undefined;
  const restore = async () => {
    if (!data?.after) return;
    setRestoreError(undefined);
    try {
      await ownerSend(`/api/views/${view.id}/versions/${data.version.revision}/restore`, {});
    } catch (e) {
      setRestoreError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <section
      aria-label="Versions of this page"
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="?" className={BUTTON.secondary}>
            <ArrowLeft className="size-3.5" aria-hidden /> Back to the page
          </Link>
          {data && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">{dateTime(data.version.at)}</span> by{' '}
              {data.version.author.name}
              {' · '}
              {data.version.op === 'create'
                ? 'First version'
                : data.version.changes
                  ? comparisonLine(data.version.changes, data.version.changes.of)
                  : 'Changed'}
            </p>
          )}
          {data && rev !== latest && data.after && data.version.op !== 'delete' && !blocked && (
            <button
              type="button"
              onClick={() => void restore()}
              className={clsx(BUTTON.accent, 'ml-auto')}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Restore this version
            </button>
          )}
        </div>
        {blocked && rev !== latest && <p className="text-sm text-muted">{blocked}</p>}
        {restoreError && (
          <p role="alert" className="text-sm text-rose-600">
            {restoreError}
          </p>
        )}
        {data && <p className="text-sm text-ink-soft">{data.version.message}</p>}
        {!data ? (
          <Skeleton lines={6} label="Loading the version" />
        ) : comparison ? (
          <DocumentCompare view={shownView} comparison={comparison} current={sameDoc} />
        ) : (
          <p className="text-sm text-muted">
            This version is a board or a page written as HTML: its changes are listed by count
            above. Open the page to see it as it is now.
          </p>
        )}
      </div>
      <nav aria-label="Versions" className="space-y-1 lg:sticky lg:top-4 lg:self-start">
        <h2 className="mb-2 text-sm font-medium text-muted">Versions of this page</h2>
        {!list.data && <Skeleton lines={5} label="Loading versions" />}
        <ol className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
          {versions.map((v) => (
            <li key={v.revision}>
              <Link
                to={`?versions=${v.revision}`}
                aria-current={v.revision === rev ? 'true' : undefined}
                className={clsx(
                  'block rounded-control px-3 py-2 text-sm',
                  v.revision === rev
                    ? 'bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{dateTime(v.at)}</span>
                  {v.revision === latest && <span className="text-xs text-muted">Current</span>}
                  {v.revertedBy && <span className="text-xs text-muted">Undone</span>}
                </span>
                <span className="block text-xs text-muted">
                  {v.author.name}
                  {v.changes &&
                    v.op !== 'create' &&
                    ` · ${comparisonLine(v.changes, v.changes.of)}`}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">{v.message}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
