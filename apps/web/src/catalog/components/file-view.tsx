import { fileUrl, type Entity, type FileInfo, type NodeOf } from '@pharos/schema';
import { FileQuestion } from 'lucide-react';
import { FileActions, MissingNotice } from '../../files/FileDetails';
import { FilePreview } from '../../files/FilePreview';
import { fileName } from '../../files/files';
import { GlanceDate } from '../../files/glance';
import { useResource } from '../../lib/api';
import { useBoardFiles, useWidgetId } from '../board-files';
import { useViewData } from '../context';
import { Clickable } from '../interactive';
import { Empty } from '../ui';
import { FileTypeIcon } from './file-list';

// One file shown inline in a view (R7.11): the same preview and missing-file notice as the file
// drawer, under a glance (v0.2 B2): its type icon, name and the one date that matters, with the
// actions as a row of icons. The title opens the drawer for the rest (kind, issuer, tags, notes,
// tasks, where it is on disk). A FileList on the same board can switch the file.

function FileCard({ file, size }: { file: Entity<'file'>; size: 'compact' | 'full' }) {
  const { version } = useViewData();
  const info = useResource<FileInfo>(`${fileUrl('info', file.id)}?v=${version}`);
  const d = file.data;
  const known = info.data && typeof info.data.available === 'boolean' ? info.data : undefined;
  return (
    <div className="space-y-3">
      {/* The glance (v0.2 B2): type icon, name and the one date that matters. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Clickable
          id={file.id}
          title={`${fileName(d.path)}: open the details`}
          className="-mx-1 flex min-w-0 items-start gap-2 rounded-md px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
        >
          <FileTypeIcon
            path={d.path}
            className="mt-0.5 size-4 text-neutral-400 dark:text-neutral-500"
          />
          <span className="min-w-0 text-sm leading-snug font-semibold text-neutral-900 dark:text-neutral-100">
            {d.title}
          </span>
        </Clickable>
        <GlanceDate file={d} />
      </div>
      {known && <MissingNotice file={file} info={known} />}
      {info.status === 'error' && !known && (
        <p role="note" className="text-sm text-neutral-500">
          Couldn’t reach the file service, so the preview and actions are off for now.
        </p>
      )}
      <FileActions file={file} info={known} compact />
      {known && <FilePreview file={file} available={known.available} size={size} />}
    </div>
  );
}

export function FileView({ node }: { node: NodeOf<'FileView'> }) {
  const { files } = useViewData();
  const boardFiles = useBoardFiles();
  const widgetId = useWidgetId();
  const fileId = (widgetId && boardFiles?.shown(widgetId)) || node.file;
  if (!fileId) return <Empty>Pick a file in the list to show it here.</Empty>;
  const file = files?.find((f) => f.id === fileId);
  if (!file)
    return (
      <div
        role="note"
        className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400"
      >
        <FileQuestion className="size-8 text-neutral-300 dark:text-neutral-600" aria-hidden />
        <p>
          This file isn’t in the project. It may have been removed; add it again from the Files
          page, or ask your agent to point this widget at another file.
        </p>
      </div>
    );
  return <FileCard key={file.id} file={file} size={node.size ?? 'full'} />;
}
