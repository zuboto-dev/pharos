import {
  FILE_ROUTES,
  type AddFilesInput,
  type FolderStatus,
  type ScannedFile,
} from '@pharos/schema';
import { FolderSearch, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FileTypeIcon } from '../catalog/components/file-list';
import { useOptions } from '../catalog/options';
import { Select } from '../catalog/select';
import { BUTTON, Empty } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import { formatDate, plural } from '../lib/format';
import { addFilesUrl, fileName, formatSize, scannedUrl } from './files';

const keyOf = (f: { rootId: string; path: string }) => `${f.rootId}\n${f.path}`;

/** Waits until typing pauses before searching the scan cache. */
function useDebounced<T>(value: T, ms = 200): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}

/**
 * "Add files from your folders": search the folders' scan cache (never the disk directly), tick
 * files, and add them to the project as one revision through the add route. Files already in
 * this project are marked. Esc or the backdrop closes it.
 */
export function AddFilesDialog({
  projectId,
  onClose,
  onAdded,
}: {
  projectId: string;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const options = useOptions();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const folders = useResource<FolderStatus[]>(FILE_ROUTES.folders);
  const scanned = useResource<ScannedFile[]>(scannedUrl(projectId, debounced));
  const [picked, setPicked] = useState<Map<string, ScannedFile>>(new Map());
  const [kind, setKind] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const labelOf = (rootId: string) => folders.data?.find((f) => f.id === rootId)?.label ?? 'Folder';
  const toggle = (file: ScannedFile) =>
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(keyOf(file))) next.delete(keyOf(file));
      else next.set(keyOf(file), file);
      return next;
    });

  const add = async () => {
    if (!picked.size) return;
    setSaving(true);
    setError(null);
    const files = [...picked.values()];
    const body: AddFilesInput = {
      message: `Add ${plural(files.length, 'file')} from ${[...new Set(files.map((f) => labelOf(f.rootId)))].join(', ')}`,
      files: files.map((f) => ({ rootId: f.rootId, path: f.path, ...(kind ? { kind } : {}) })),
    };
    try {
      await postJson(addFilesUrl(projectId), body);
      onAdded(files.length);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err));
    } finally {
      setSaving(false);
    }
  };

  const noFolders = folders.status === 'ok' && folders.data.length === 0;
  const results = scanned.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-files-title"
        className="relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-surface shadow-overlay sm:max-w-xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id="add-files-title" className="text-base font-semibold">
              Add files from your folders
            </h2>
            <p className="text-xs text-muted">
              Files stay where they are. Pharos only remembers which ones belong to this project.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-control p-1 text-muted hover:bg-subtle"
          >
            <X className="size-5" />
          </button>
        </header>
        {noFolders ? (
          <div className="space-y-3 px-5 py-8 text-center text-sm text-ink-soft">
            <FolderSearch className="mx-auto size-8 text-faint" />
            <p>No folders yet. Add a folder in Settings, and Pharos will list its files here.</p>
            <Link to="/settings" className={BUTTON.secondary}>
              Open Settings
            </Link>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-2">
              <label className="relative block">
                <span className="sr-only">Search your folders</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-neutral-400"
                  aria-hidden
                />
                <input
                  ref={search}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by file or folder name"
                  className="w-full rounded-control border border-line-strong bg-surface py-1.5 pr-2.5 pl-8 text-sm placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:outline-none dark:focus-visible:ring-sky-800"
                />
              </label>
            </div>
            <div className="min-h-40 flex-1 overflow-y-auto px-3 pb-2">
              {scanned.status === 'loading' ? (
                <Empty>Looking through your folders…</Empty>
              ) : scanned.status === 'error' && !scanned.data ? (
                <Empty>Couldn’t read the folder list. Try again in a moment.</Empty>
              ) : results.length === 0 ? (
                <Empty>
                  {query
                    ? 'No files match.'
                    : 'No files found yet. Folders are scanned in Settings.'}
                </Empty>
              ) : (
                <ul aria-label="Files in your folders">
                  {results.map((file) => {
                    const added = file.addedAs.length > 0;
                    const checked = picked.has(keyOf(file));
                    const folder = file.path.includes('/')
                      ? file.path.slice(0, file.path.lastIndexOf('/'))
                      : '';
                    return (
                      <li key={keyOf(file)}>
                        <label
                          className={
                            added
                              ? 'flex items-center gap-2.5 rounded-control px-2 py-1.5 text-neutral-400'
                              : 'flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-sunken'
                          }
                        >
                          <input
                            type="checkbox"
                            checked={added || checked}
                            disabled={added}
                            onChange={() => toggle(file)}
                            className="size-4 shrink-0 accent-neutral-900 dark:accent-neutral-100"
                          />
                          <FileTypeIcon path={file.path} className="size-4 text-neutral-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{fileName(file.path)}</span>
                            <span className="block truncate text-xs text-muted">
                              {[labelOf(file.rootId), folder].filter(Boolean).join(' / ')}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs text-muted tabular-nums">
                            {added ? (
                              'Added'
                            ) : (
                              <>
                                {formatSize(file.size)}
                                <span className="hidden sm:inline">
                                  {' '}
                                  · {formatDate(file.modifiedAt.slice(0, 10), true)}
                                </span>
                              </>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <footer className="space-y-2 border-t border-line px-5 py-3">
              {error && (
                <p role="alert" className="text-sm whitespace-pre-line text-rose-600">
                  Couldn’t add them: {error}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Kind</span>
                  <Select
                    label="Kind for the added files"
                    value={kind}
                    onChange={setKind}
                    className="w-44"
                    options={[
                      { value: '', label: 'Decide later' },
                      ...options
                        .list('file.kind')
                        .map((o) => ({ value: o.value, label: o.label, color: o.color })),
                    ]}
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} className={BUTTON.secondary}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!picked.size || saving}
                    onClick={() => void add()}
                    className={BUTTON.primary}
                  >
                    {saving
                      ? 'Adding…'
                      : picked.size
                        ? `Add ${plural(picked.size, 'file')}`
                        : 'Add files'}
                  </button>
                </div>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
