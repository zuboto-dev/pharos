import { compareDocs, comparisonLine, type Entity, type ViewVersion } from '@pharos/schema';
import clsx from 'clsx';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useViewData } from '../catalog/context';
import { Skeleton } from '../catalog/skeleton';
import { BUTTON } from '../catalog/ui';
import { useResource } from '../lib/api';
import { dateTime, plural } from '../lib/format';
import { DocumentCompare } from './document';

/**
 * A page's version history, like a shared document's: every change (who, when and why) in a list
 * beside the page, and the version picked shown with what it changed marked. Versions come from
 * the change log (GET /api/views/:id/versions); restoring one is a new change, undoable.
 */

type ViewData = Entity<'view'>['data'];
type At = { version: ViewVersion; before: ViewData | null; after: ViewData | null };

/** "History · 4 versions" beside the page's updated line; opens the history in place. */
export function VersionsLink({ view }: { view: Entity<'view'> }) {
  const { version } = useViewData();
  const versions = useResource<ViewVersion[]>(`/api/views/${view.id}/versions?v=${version}`);
  const n = Array.isArray(versions.data) ? versions.data.length : 0;
  if (n < 2) return null;
  return (
    <Link
      to="?versions=latest"
      className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink"
    >
      <History className="size-3.5" aria-hidden /> History · {plural(n, 'version')}
    </Link>
  );
}

/** What changed on a board between two versions: widgets by id. */
function boardChanges(before: ViewData | null, after: ViewData | null) {
  const widgets = (d: ViewData | null) => {
    const spec = d?.spec as { widgets?: { id: string; node: unknown }[] } | undefined;
    return new Map((spec?.widgets ?? []).map((w) => [w.id, JSON.stringify(w)]));
  };
  const a = widgets(before);
  const b = widgets(after);
  return {
    added: [...b.keys()].filter((id) => !a.has(id)).length,
    removed: [...a.keys()].filter((id) => !b.has(id)).length,
    changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)).length,
  };
}

export function ViewVersions({ view, selected }: { view: Entity<'view'>; selected: string }) {
  const { version, actions } = useViewData();
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
  const shownView = data?.after ? { ...view, data: data.after } : view;
  const restore = () => {
    if (!data?.after) return;
    const after = data.after;
    void actions.apply(
      `Restore “${view.data.name}” to its version of ${dateTime(data.version.at)} (#${data.version.revision})`,
      [
        {
          op: 'update',
          type: 'view',
          id: view.id,
          data: { doc: after.doc ?? null, spec: after.spec ?? null, page: after.page ?? null },
        },
      ],
      { undoable: true },
    );
  };

  return (
    <section aria-label="Version history" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
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
                : comparison
                  ? comparisonLine(comparison)
                  : data.after?.spec
                    ? comparisonLine(boardChanges(data.before, data.after)).replace(
                        'blocks',
                        'widgets',
                      )
                    : 'Changed'}
            </p>
          )}
          {data && rev !== latest && data.after && data.version.op !== 'delete' && (
            <button type="button" onClick={restore} className={clsx(BUTTON.accent, 'ml-auto')}>
              <RotateCcw className="size-3.5" aria-hidden /> Restore this version
            </button>
          )}
        </div>
        {data && <p className="text-sm text-ink-soft">{data.version.message}</p>}
        {!data ? (
          <Skeleton lines={6} label="Loading the version" />
        ) : comparison ? (
          <DocumentCompare view={shownView} comparison={comparison} />
        ) : (
          <p className="text-sm text-muted">
            This version is a board or a page written as HTML: its changes are listed by count
            above. Open the page to see it as it is now.
          </p>
        )}
      </div>
      <nav aria-label="Versions" className="space-y-1 lg:sticky lg:top-4 lg:self-start">
        <h2 className="mb-2 text-sm font-medium text-muted">Versions</h2>
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
                <span className="block text-xs text-muted">{v.author.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">{v.message}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
