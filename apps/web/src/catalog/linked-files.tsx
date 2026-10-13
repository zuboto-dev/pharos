import type { Entity } from '@pharos/schema';
import clsx from 'clsx';
import { fileTitle } from '../files/files';
import { glanceDateOf } from '../files/glance';
import { FileTypeIcon } from './components/file-list';
import { useViewData } from './context';
import { useOpenItem } from './open-item';

/**
 * The project files an item links with `fileIds` (R7.12), as small links at a glance (v0.2 B2:
 * the type icon and title; the one date that matters in the tooltip): tapping one opens the
 * file in the board's FileView when there is one, else its preview in the drawer. Files the reader
 * can't see (not in the dataset) are left out.
 */
export function LinkedFiles({
  ids,
  className,
}: {
  ids: readonly string[] | undefined;
  className?: string;
}) {
  const { entityById } = useViewData();
  const open = useOpenItem();
  const files = (ids ?? [])
    .map((id) => entityById.get(id))
    .filter((e): e is Entity<'file'> => e?.type === 'file');
  if (!files.length) return null;
  return (
    <span className={clsx('flex flex-wrap gap-1', className)} aria-label="Linked files">
      {files.map((file) => {
        const title = fileTitle(file, entityById.values());
        return (
          <button
            key={file.id}
            type="button"
            title={[`Open “${title}”`, glanceDateOf(file.data)?.text].filter(Boolean).join(' · ')}
            onClick={(e) => {
              e.stopPropagation();
              open(file.id);
            }}
            className="inline-flex max-w-[14rem] items-center gap-1 rounded-control border border-line-strong px-1.5 py-0.5 text-xs text-accent-strong hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-400 dark:hover:bg-sky-950"
          >
            <FileTypeIcon path={file.data.path ?? ''} className="size-3 shrink-0" />
            <span className="truncate">{title}</span>
          </button>
        );
      })}
    </span>
  );
}

/** The `fileIds` of an item that links files, or undefined. */
export function fileIdsOf(entity: Entity): string[] | undefined {
  const ids = (entity.data as { fileIds?: unknown }).fileIds;
  return Array.isArray(ids) ? (ids as string[]) : undefined;
}
