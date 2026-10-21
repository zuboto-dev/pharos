import {
  FOLDER_LEVELS,
  fileTypeOf,
  fileUrl,
  type Entity,
  type EntityType,
  type FileAction,
  type FileInfo,
  type ProjectDataset,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  AppWindow,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  TriangleAlert,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ExpiryBadge } from '../catalog/components/file-list';
import { useViewData } from '../catalog/context';
import {
  EditableDate,
  EditableList,
  EditableMarkdown,
  EditableText,
  EditableTitle,
} from '../catalog/editable';
import { EntityRef, TYPE_LABELS, labelOf } from '../catalog/interactive';
import { EditOptionsButton, useOptions } from '../catalog/options';
import { Select } from '../catalog/select';
import { ICON_BUTTON, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import { formatDate } from '../lib/format';
import { FilePreview, NewTabLink, PreviewSkeleton } from './FilePreview';
import { MISSING_TEXT, extensionOf, fileActionUrl, fileName, formatSize } from './files';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3 py-1.5 text-sm">
      <dt className="pt-0.5 text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>;
}

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Open (default app), Reveal in Finder, Copy path, Download (the real file name), and Open in a
 * new tab for files the browser can show. Each says what happened next to the buttons.
 * `compact` (a FileView in a view, v0.2 B2) shows them as a row of icons with tooltips, and never
 * writes the path out: that stays in the file's details.
 */
export function FileActions({
  file,
  info,
  compact = false,
}: {
  file: Entity<'file'>;
  info: FileInfo | undefined;
  compact?: boolean;
}) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const available = info?.available ?? false;
  const type = info?.type ?? fileTypeOf(file.data.path);
  const run = async (action: FileAction, done: string) => {
    setFeedback(null);
    try {
      await postJson(fileActionUrl(file.id, action), {});
      setFeedback({ kind: 'ok', text: done });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: `Couldn’t do that: ${err instanceof ApiError ? err.message : String(err)}`,
      });
    }
  };
  const copyPath = async () => {
    if (!info?.absolutePath) return;
    try {
      await navigator.clipboard.writeText(info.absolutePath);
      setFeedback({ kind: 'ok', text: 'Path copied' });
    } catch {
      setFeedback({
        kind: 'error',
        text: compact
          ? 'Couldn’t copy. Open the file’s details to see its path.'
          : `Couldn’t copy. The path is ${info.absolutePath}`,
      });
    }
  };
  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="group" aria-label="File actions" className="flex items-center gap-1">
          <Tooltip label="Download">
            {available ? (
              <a
                href={fileUrl('download', file.id)}
                download
                aria-label="Download"
                className={ICON_BUTTON.secondary}
              >
                <Download className="size-4" aria-hidden />
              </a>
            ) : (
              <button
                type="button"
                disabled
                aria-label="Download"
                className={ICON_BUTTON.secondary}
              >
                <Download className="size-4" aria-hidden />
              </button>
            )}
          </Tooltip>
          {type.open && (
            <Tooltip label="Open in its app">
              <button
                type="button"
                disabled={!available}
                aria-label="Open in its app"
                onClick={() => void run('open', 'Opened in its app')}
                className={ICON_BUTTON.secondary}
              >
                <AppWindow className="size-4" aria-hidden />
              </button>
            </Tooltip>
          )}
          <Tooltip label="Reveal in Finder">
            <button
              type="button"
              disabled={!available}
              aria-label="Reveal in Finder"
              onClick={() => void run('reveal', 'Shown in Finder')}
              className={ICON_BUTTON.secondary}
            >
              <FolderOpen className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Copy path">
            <button
              type="button"
              disabled={!info?.absolutePath}
              aria-label="Copy path"
              onClick={() => void copyPath()}
              className={ICON_BUTTON.secondary}
            >
              <Copy className="size-4" aria-hidden />
            </button>
          </Tooltip>
          {available && type.preview !== 'none' && (
            <Tooltip label="Open in a new tab">
              <a
                href={fileUrl('content', file.id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in a new tab"
                className={ICON_BUTTON.secondary}
              >
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </Tooltip>
          )}
        </div>
        <ActionFeedback feedback={feedback} />
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {available ? (
          <a href={fileUrl('download', file.id)} download className={BUTTON.primary}>
            <Download className="size-3.5" aria-hidden /> Download
          </a>
        ) : (
          <button type="button" disabled className={BUTTON.primary}>
            <Download className="size-3.5" aria-hidden /> Download
          </button>
        )}
        {type.open && (
          <button
            type="button"
            disabled={!available}
            onClick={() => void run('open', 'Opened in its app')}
            className={BUTTON.secondary}
          >
            <AppWindow className="size-3.5" aria-hidden /> Open
          </button>
        )}
        <button
          type="button"
          disabled={!available}
          onClick={() => void run('reveal', 'Shown in Finder')}
          className={BUTTON.secondary}
        >
          <FolderOpen className="size-3.5" aria-hidden /> Reveal in Finder
        </button>
        <button
          type="button"
          disabled={!info?.absolutePath}
          onClick={() => void copyPath()}
          className={BUTTON.secondary}
        >
          <Copy className="size-3.5" aria-hidden /> Copy path
        </button>
        {available && type.preview !== 'none' && <NewTabLink fileId={file.id} />}
      </div>
      <ActionFeedback feedback={feedback} />
    </div>
  );
}

/** What the last file action did, next to the buttons. */
function ActionFeedback({ feedback }: { feedback: Feedback }) {
  return (
    <p
      role="status"
      className={clsx('min-h-4 text-xs', feedback?.kind === 'error' ? 'text-danger' : 'text-muted')}
    >
      {feedback && (
        <>
          {feedback.kind === 'ok' && <Check className="mr-1 inline size-3" aria-hidden />}
          {feedback.text}
        </>
      )}
    </p>
  );
}

/** Shown when the file can't be reached; offers the new path when the scan found it moved. */
export function MissingNotice({ file, info }: { file: Entity<'file'>; info: FileInfo }) {
  const { actions } = useViewData();
  if (info.available && !info.movedTo) return null;
  return (
    <div
      role="note"
      className="flex gap-2.5 rounded-tile border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1.5">
        {!info.available && (
          <p>
            <strong className="font-semibold">This file can’t be opened now.</strong>{' '}
            {MISSING_TEXT[info.missing ?? 'file-gone']}
          </p>
        )}
        {info.movedTo && (
          <>
            <p>
              Found with the same contents at <code className="break-all">{info.movedTo}</code>.
            </p>
            <button
              type="button"
              className={BUTTON.secondary}
              onClick={() =>
                void actions.apply(`Update the path of “${labelOf(file)}” after it moved`, [
                  { op: 'update', type: 'file', id: file.id, data: { path: info.movedTo } },
                ])
              }
            >
              Use the new path
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function KindSelect({ file }: { file: Entity<'file'> }) {
  const { actions } = useViewData();
  const options = useOptions();
  const choices = options.list('file.kind').map((o) => ({
    value: o.value,
    label: o.label,
    color: o.color,
  }));
  return (
    <div className="flex items-center gap-1">
      <Select
        label="Kind"
        value={file.data.kind}
        options={choices}
        className="max-w-60"
        onChange={(value) =>
          void actions.apply(
            `Set kind of “${labelOf(file)}” to ${options.get('file.kind', value).label}`,
            [{ op: 'update', type: 'file', id: file.id, data: { kind: value } }],
          )
        }
      />
      <EditOptionsButton field="file.kind" />
    </div>
  );
}

/** The tasks this file belongs to, with a picker to link another. */
function LinkedTasks({ file }: { file: Entity<'file'> }) {
  const { tasks, actions } = useViewData();
  const linked = file.data.taskIds;
  const others = tasks.filter((t) => !linked.includes(t.id));
  return (
    <div className="space-y-1.5">
      {linked.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {linked.map((id) => (
            <EntityRef key={id} id={id} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <Select
          label="Link a task"
          value=""
          placeholder="Link a task…"
          className="max-w-60"
          options={others.map((t) => ({ value: t.id, label: t.data.title }))}
          onChange={(id) => {
            const task = others.find((t) => t.id === id);
            void actions.apply(`Link “${labelOf(file)}” to task “${task?.data.title ?? id}”`, [
              { op: 'update', type: 'file', id: file.id, data: { taskIds: [...linked, id] } },
            ]);
          }}
        />
      )}
      {!linked.length && !others.length && <span className="text-faint">None</span>}
    </div>
  );
}

/**
 * The file drawer (R7.4): preview, actions, the details people fill in, where it is on disk,
 * linked tasks and the owner's notes. `history` is the drawer's own history list.
 */
/** Types that link files with `fileIds`, in the order "Linked from" lists them. */
const LINKING: { type: EntityType; key: keyof ProjectDataset }[] = [
  { type: 'task', key: 'tasks' },
  { type: 'decision', key: 'decisions' },
  { type: 'goal', key: 'goals' },
  { type: 'stage', key: 'stages' },
  { type: 'claim', key: 'claims' },
];

/**
 * What links this file (R7.12): items whose `fileIds` include it, the tasks it lists, and the
 * sources (artifacts) that are this file. Each opens its own details.
 */
function LinkedFrom({ file }: { file: Entity<'file'> }) {
  const data = useViewData();
  const items: Entity[] = [];
  const seen = new Set<string>();
  const push = (e: Entity | undefined) => {
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      items.push(e);
    }
  };
  for (const { key } of LINKING) {
    const list = (data[key] ?? []) as Entity[];
    for (const e of list)
      if (((e.data as { fileIds?: string[] }).fileIds ?? []).includes(file.id)) push(e);
  }
  for (const id of file.data.taskIds) push(data.taskById.get(id));
  for (const a of data.artifacts) if (a.data.fileId === file.id) push(a);
  if (!items.length) return null;
  return (
    <section className="space-y-1">
      <Heading>Linked from</Heading>
      <ul className="space-y-1" aria-label="Linked from">
        {items.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2 text-sm">
            <span className="w-16 shrink-0 text-xs text-muted">{TYPE_LABELS[e.type]}</span>
            <button
              type="button"
              onClick={() => data.actions.open({ entity: e.id })}
              className="min-w-0 truncate text-left text-accent-strong hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              {labelOf(e)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FileDetails({ file, history }: { file: Entity<'file'>; history?: ReactNode }) {
  const { version } = useViewData();
  const info = useResource<FileInfo>(`${fileUrl('info', file.id)}?v=${version}`);
  const d = file.data;
  const folder = info.data?.folder;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <EditableTitle entity={file} />
        <p className="truncate text-xs text-muted" title={d.path}>
          {fileName(d.path)} · {formatSize(d.size)}
        </p>
      </div>
      {info.data && <MissingNotice file={file} info={info.data} />}
      {info.status === 'error' && !info.data && (
        <p role="note" className="text-sm text-muted">
          Couldn’t reach the file service, so the preview and actions are off for now.
        </p>
      )}
      <FileActions file={file} info={info.data} />
      {info.data ? (
        <FilePreview file={file} available={info.data.available} />
      ) : (
        info.status === 'loading' && <PreviewSkeleton />
      )}
      <section className="space-y-1">
        <Heading>Details</Heading>
        <dl className="divide-y divide-line-soft">
          <Row label="Kind">
            <KindSelect file={file} />
          </Row>
          <Row label="Issuer">
            <EditableText entity={file} field="issuer" placeholder="Who issued or sent it" />
          </Row>
          <Row label="Issued">
            <EditableDate entity={file} field="issuedDate" />
          </Row>
          <Row label="Expires">
            <span className="flex flex-wrap items-center gap-2">
              <EditableDate entity={file} field="expiryDate" />
              {d.expiryDate && <ExpiryBadge date={d.expiryDate} />}
            </span>
          </Row>
          <Row label="Tags">
            <EditableList entity={file} field="tags" />
          </Row>
          <Row label="Tasks">
            <LinkedTasks file={file} />
          </Row>
        </dl>
      </section>
      <LinkedFrom file={file} />
      <section className="space-y-1">
        <Heading>On disk</Heading>
        <dl className="divide-y divide-line-soft">
          <Row label="Folder">
            {folder ? (
              <span>
                {folder.label}
                <span className="block text-xs text-muted">
                  {FOLDER_LEVELS[folder.level].agents}
                </span>
              </span>
            ) : (
              <span className="text-faint">{info.data ? 'Removed' : '…'}</span>
            )}
          </Row>
          <Row label="Path">
            <code className="text-xs break-all">{d.path}</code>
          </Row>
          <Row label="Type">{extensionOf(d.path).toUpperCase() || 'Unknown'}</Row>
          <Row label="Size">{formatSize(d.size)}</Row>
          <Row label="Changed">{formatDate(d.modifiedAt.slice(0, 10))}</Row>
        </dl>
      </section>
      <section className="space-y-2">
        <Heading>Notes · agents don’t see these</Heading>
        <EditableMarkdown entity={file} field="notes" />
      </section>
      {history && (
        <section className="space-y-2">
          <Heading>History</Heading>
          {history}
        </section>
      )}
    </div>
  );
}
