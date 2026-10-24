import {
  fileUrl,
  type Entity,
  type EntityType,
  type FileInfo,
  type ProjectDataset,
} from '@pharos/schema';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, PencilLine, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ExpiryBadge, FileTypeIcon } from '../catalog/components/file-list';
import { useViewData } from '../catalog/context';
import { TYPE_LABELS, labelOf } from '../catalog/interactive';
import { useOptions } from '../catalog/options';
import { Badge } from '../catalog/ui';
import { useResource } from '../lib/api';
import { formatDate } from '../lib/format';
import { useExit } from '../lib/motion';
import { FileActions, MissingNotice } from './FileDetails';
import { FilePreview, PreviewSkeleton } from './FilePreview';
import { extensionOf, fileName, fileTitle, formatSize } from './files';
import { GlanceDate } from './glance';
import { FileViewerContext, useFileViewer, type FileViewerApi } from './viewer-context';

// The file viewer (v0.2 A6). Files show at a glance in blocks (icon, name, one date); their
// contents appear only when the reader opens one, here: the preview, the title and the one date
// that matters, and the actions as icons with tooltips. Kind, issuer, dates, tags, where it is on
// disk and what links it wait under "Details", closed until the reader asks. ← → (and the arrows)
// step through the list it was opened from; Esc or Close returns focus to the row. A full-screen
// sheet on phones. The Gallery's large view is this same viewer, with its pictures.

/** One thing the viewer shows: a project file, or a Gallery picture (which may be one). */
export type ViewerItem = {
  key: string;
  title: string;
  /** The dialog's accessible name, when it isn't the title (a picture's caption). */
  label?: string;
  /** The project file: its date, actions, preview and Details. */
  file?: Entity<'file'>;
  /** Shown instead of the file's preview (a Gallery picture, large). */
  preview?: ReactNode;
  /** Under the preview: a picture's description and where it comes from (given `close`). */
  caption?: ReactNode | ((close: () => void) => ReactNode);
  /** Under the title, e.g. a repository file's path and branch. */
  meta?: ReactNode;
  /** Beside the title, before Close: e.g. "Show in folder". */
  headerActions?: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, iframe, audio[controls], [tabindex]:not([tabindex="-1"])';

/** Keys typed into these belong to them, not to the viewer's ← →. */
function ownsArrows(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.(
    'input, textarea, select, audio, video, [contenteditable="true"], [role="slider"]',
  );
}

const NAV =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface/90 text-ink-soft shadow-sm transition-colors duration-(--motion-quick) hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400';

export function FileViewer({
  items,
  index,
  onIndex,
  onClose,
  leaving = false,
  noun = 'file',
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Closing: it fades out (index.css motion) before it goes. */
  leaving?: boolean;
  /** What the arrows step through: "Previous file", "Next picture". */
  noun?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();
  const at = Math.max(0, Math.min(index, items.length - 1));
  const item = items[at];
  const many = items.length > 1;
  const step = (by: number) => onIndex((at + by + items.length) % items.length);

  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    // The page behind doesn't scroll while the viewer is open (and does again as it fades out).
    if (leaving) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [leaving]);
  if (!item) return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Only the viewer closes, not a drawer under it (its listener is on window).
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && many) {
      if (ownsArrows(e.target)) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Tab') {
      const all = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const focusable = all.filter((el) => !el.closest('[aria-hidden="true"]'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Touch: swipe sideways for the next or previous one, down to close.
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const end = e.changedTouches[0];
    if (!start || !end) return;
    const dx = end.clientX - start.x;
    const dy = (end.clientY ?? 0) - start.y;
    if (dy > 80 && Math.abs(dx) < dy / 2) onClose();
    else if (many && Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx)) step(dx < 0 ? 1 : -1);
  };

  const arrows = (where: 'side' | 'bar') =>
    many && (
      <>
        <button
          type="button"
          aria-label={`Previous ${noun}`}
          title={`Previous ${noun} (←)`}
          onClick={() => step(-1)}
          className={clsx(NAV, where === 'side' && 'absolute top-1/2 left-2 -translate-y-1/2')}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Next ${noun}`}
          title={`Next ${noun} (→)`}
          onClick={() => step(1)}
          className={clsx(NAV, where === 'side' && 'absolute top-1/2 right-2 -translate-y-1/2')}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </>
    );

  const stage = (content: ReactNode) => (
    <div
      data-viewer-stage
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = t ? { x: t.clientX, y: t.clientY ?? 0 } : null;
      }}
      onTouchEnd={onTouchEnd}
    >
      <div
        key={item.key}
        className={clsx(
          'flex min-h-0 flex-1 animate-fade-in flex-col justify-center px-3 py-3 sm:py-4',
          many ? 'sm:px-16' : 'sm:px-5',
        )}
      >
        {content}
      </div>
      <div className="hidden sm:block">{arrows('side')}</div>
    </div>
  );

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={item.label ?? item.title}
      aria-hidden={leaving || undefined}
      data-file-viewer
      onKeyDown={onKeyDown}
      className={clsx(
        'fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-6',
        leaving && 'pointer-events-none',
      )}
    >
      <div
        aria-hidden
        className={clsx(
          'absolute inset-0 bg-neutral-950/60 backdrop-blur-[2px] dark:bg-black/70',
          leaving ? 'animate-fade-out' : 'animate-fade-in',
        )}
        onClick={onClose}
      />
      <section
        aria-labelledby={titleId}
        className={clsx(
          'relative flex h-full w-full flex-col overflow-hidden bg-surface text-ink shadow-overlay sm:h-auto sm:max-h-[94vh] sm:max-w-5xl sm:rounded-block sm:border sm:border-line',
          leaving ? 'animate-fade-out' : 'animate-sheet-in sm:animate-pop-in',
        )}
      >
        <header className="space-y-2 border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-3">
          <div className="flex items-start gap-2.5">
            {item.file && (
              <FileTypeIcon path={item.file.data.path} className="mt-1 size-4 text-faint" />
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base leading-snug font-semibold">
                {item.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {item.file && <GlanceDate file={item.file.data} />}
                {item.meta}
                {many && (
                  <span aria-live="polite" className="tabular-nums">
                    {at + 1} of {items.length}
                  </span>
                )}
              </div>
            </div>
            {item.headerActions}
            <button
              ref={closeButton}
              type="button"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
              className="-mt-0.5 -mr-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </header>
        {item.file ? (
          <FileParts
            key={item.key}
            file={item.file}
            preview={item.preview}
            caption={typeof item.caption === 'function' ? item.caption(onClose) : item.caption}
            stage={stage}
            onClose={onClose}
          />
        ) : (
          <>
            {stage(item.preview)}
            {item.caption && (
              <div className="border-t border-line px-4 py-3 text-sm sm:px-5">
                {typeof item.caption === 'function' ? item.caption(onClose) : item.caption}
              </div>
            )}
          </>
        )}
        {many && (
          <div className="flex justify-center gap-3 border-t border-line px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden">
            {arrows('bar')}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** A file's actions, preview and Details, with its info (available, path, folder) loaded once. */
function FileParts({
  file,
  preview,
  caption,
  stage,
  onClose,
}: {
  file: Entity<'file'>;
  preview?: ReactNode;
  caption?: ReactNode;
  stage: (content: ReactNode) => ReactNode;
  onClose: () => void;
}) {
  const { version } = useViewData();
  const info = useResource<FileInfo>(`${fileUrl('info', file.id)}?v=${version}`);
  const known = info.data && typeof info.data.available === 'boolean' ? info.data : undefined;
  return (
    <>
      <div className="border-b border-line px-4 py-2 sm:px-5">
        <FileActions file={file} info={known} compact />
      </div>
      {stage(
        <div className="space-y-3">
          {known && <MissingNotice file={file} info={known} />}
          {info.status === 'error' && !known && (
            <p role="note" className="text-sm text-muted">
              Couldn’t reach the file service, so the preview and actions are off for now.
            </p>
          )}
          {preview ??
            (known ? (
              <FilePreview file={file} available={known.available} size="viewer" />
            ) : (
              info.status === 'loading' && <PreviewSkeleton />
            ))}
        </div>,
      )}
      <div className="max-h-[40vh] space-y-2 overflow-y-auto border-t border-line px-4 py-2.5 sm:px-5">
        {caption && <div className="text-sm">{caption}</div>}
        <Details file={file} info={known} onClose={onClose} />
      </div>
    </>
  );
}

/** Types that link files with `fileIds`, in the order "Linked from" lists them. */
const LINKING: { type: EntityType; key: keyof ProjectDataset }[] = [
  { type: 'task', key: 'tasks' },
  { type: 'decision', key: 'decisions' },
  { type: 'goal', key: 'goals' },
  { type: 'stage', key: 'stages' },
  { type: 'claim', key: 'claims' },
];

/** Items that link this file, by `fileIds`, its tasks, or an artifact that is this file. */
function useLinkedFrom(file: Entity<'file'>): Entity[] {
  const data = useViewData();
  return useMemo(() => {
    const items: Entity[] = [];
    const seen = new Set<string>();
    const push = (e: Entity | undefined) => {
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        items.push(e);
      }
    };
    for (const { key } of LINKING)
      for (const e of (data[key] ?? []) as Entity[])
        if (((e.data as { fileIds?: string[] }).fileIds ?? []).includes(file.id)) push(e);
    for (const id of file.data.taskIds) push(data.taskById.get(id));
    for (const a of data.artifacts) if (a.data.fileId === file.id) push(a);
    return items;
  }, [data, file]);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Kind, issuer, dates, tags, where it is and what links it: closed until the reader asks (the
 * owner: no location until then). "Edit details" opens the file's drawer for changes and notes.
 */
function Details({
  file,
  info,
  onClose,
}: {
  file: Entity<'file'>;
  info: FileInfo | undefined;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { actions, entityById } = useViewData();
  const options = useOptions();
  const linked = useLinkedFrom(file);
  const panel = useId();
  const d = file.data;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <ChevronDown
          className={clsx(
            'size-4 transition-transform duration-(--motion-quick) motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
          aria-hidden
        />
        Details
      </button>
      {open && (
        <div id={panel} className="animate-fade-in space-y-2 pt-1">
          <dl className="divide-y divide-line-soft">
            <Row label="Kind">{options.get('file.kind', d.kind).label}</Row>
            {d.issuer && <Row label="Issuer">{d.issuer}</Row>}
            {d.issuedDate && <Row label="Issued">{formatDate(d.issuedDate)}</Row>}
            {d.expiryDate && (
              <Row label="Expires">
                <ExpiryBadge date={d.expiryDate} />
              </Row>
            )}
            {d.tags.length > 0 && (
              <Row label="Tags">
                <span className="flex flex-wrap gap-1">
                  {d.tags.map((t) => (
                    <Badge key={t} tone="muted">
                      #{t}
                    </Badge>
                  ))}
                </span>
              </Row>
            )}
            <Row label="Folder">
              {info?.folder ? (
                info.folder.label
              ) : (
                <span className="text-faint">{info ? 'Removed' : '…'}</span>
              )}
            </Row>
            <Row label="Path">
              <code className="text-xs break-all">{d.path}</code>
            </Row>
            <Row label="File">
              {fileName(d.path)} · {extensionOf(d.path).toUpperCase() || 'Unknown'} ·{' '}
              {formatSize(d.size)} · changed {formatDate(d.modifiedAt.slice(0, 10))}
            </Row>
            {linked.length > 0 && (
              <Row label="Linked from">
                <ul aria-label="Linked from" className="space-y-0.5">
                  {linked.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted">
                        {TYPE_LABELS[e.type]}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          actions.open({ entity: e.id });
                        }}
                        className="min-w-0 truncate text-left text-accent-strong hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
                      >
                        {labelOf(e)}
                      </button>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </dl>
          <button
            type="button"
            onClick={() => {
              onClose();
              actions.open({ entity: file.id });
            }}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <PencilLine className="size-3.5" aria-hidden />
            Edit details and notes
            <span className="sr-only"> of “{fileTitle(file, entityById.values())}”</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The files of the list the viewer was opened from, as viewer items (gone ones left out). */
function fileItems(ids: readonly string[], entityById: Map<string, Entity>): ViewerItem[] {
  const all = [...entityById.values()];
  return ids.flatMap((id) => {
    const file = entityById.get(id);
    if (file?.type !== 'file') return [];
    const f = file as Entity<'file'>;
    return [{ key: f.id, title: fileTitle(f, all), file: f }];
  });
}

/**
 * Gives the blocks inside it a file viewer (`useFileViewer`, `useOpenFile`). Inside another
 * provider it adds nothing, so a board in a page shares the page's one viewer.
 */
export function FileViewerProvider({ children }: { children: ReactNode }) {
  const outer = useFileViewer();
  if (outer) return <>{children}</>;
  return <OwnFileViewer>{children}</OwnFileViewer>;
}

function OwnFileViewer({ children }: { children: ReactNode }) {
  const { entityById } = useViewData();
  const [state, setState] = useState<{ ids: string[]; id: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useExit(state);
  const open = useCallback<FileViewerApi['open']>((fileId, list) => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const ids = list?.includes(fileId) ? [...new Set(list)] : [fileId];
    setState({ ids, id: fileId });
  }, []);
  const api = useMemo<FileViewerApi>(() => ({ open }), [open]);
  const close = useCallback(() => {
    setState(null);
    // Back to the row, chip or link the reader opened it from.
    const el = opener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus());
  }, []);
  const items = shown.shown ? fileItems(shown.shown.ids, entityById) : [];
  const index = shown.shown ? items.findIndex((i) => i.key === shown.shown!.id) : -1;
  // Its file was removed while open: close (the list may still have others, but the reader
  // was reading this one). Adjusting state during render, as useExit does.
  if (state && index < 0) setState(null);
  return (
    <FileViewerContext.Provider value={api}>
      {children}
      {shown.shown && index >= 0 && (
        <FileViewer
          items={items}
          index={index}
          onIndex={(i) => setState((s) => (s && items[i] ? { ...s, id: items[i]!.key } : s))}
          onClose={close}
          leaving={shown.leaving}
        />
      )}
    </FileViewerContext.Provider>
  );
}
