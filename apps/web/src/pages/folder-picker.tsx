import clsx from 'clsx';
import { ChevronLeft, Folder, FolderGit2, FolderPlus, FolderSearch, Home } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { BUTTON } from '../catalog/ui';

// New folder in the sidebar, with the folder on this computer found or made in place: browse from
// home, enter a folder with a click, "Use this folder", or make a new one there (Chaeeon, 10-23:
// "Find folder option for Local path when create new folder" and "Create a new folder option too").

type Listing = {
  path: string;
  display: string;
  parent: string | null;
  folders: { name: string; path: string; repo: boolean }[];
};

const OWNER = { 'x-pharos-author': 'human:me' };
const FIELD = 'w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm';

async function listing(path?: string): Promise<Listing> {
  const res = await fetch(`/api/disk/folders${path ? `?path=${encodeURIComponent(path)}` : ''}`, {
    headers: OWNER,
  });
  const body = (await res.json()) as Listing & { error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? 'Couldn’t read that folder');
  return body;
}

/** Browse folders from home; pick one or make one. */
export function FolderBrowser({
  start,
  onPick,
  onCancel,
}: {
  start?: string;
  onPick: (picked: { path: string; display: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [at, setAt] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const go = (path?: string) =>
    listing(path).then(
      (l) => (setAt(l), setError(null)),
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    // From the path typed so far, else home; a path that doesn't exist yet falls back to home.
    void listing(start || '~').then(setAt, () =>
      listing('~').then(setAt, (e: Error) => setError(e.message)),
    );
  }, [start]);
  const make = async (e: FormEvent) => {
    e.preventDefault();
    if (!at || !name.trim()) return;
    const res = await fetch('/api/disk/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...OWNER },
      body: JSON.stringify({ parent: at.path, name: name.trim() }),
    });
    const body = (await res.json()) as Listing & { error?: { message: string } };
    if (!res.ok) return setError(body.error?.message ?? 'Couldn’t make that folder');
    setAt(body);
    setMaking(false);
    setName('');
    setError(null);
  };
  const here = at?.display.split('/').pop() ?? '';
  return (
    <div data-folder-browser="" className="space-y-2 rounded-tile border border-line bg-sunken p-2">
      <div className="flex items-center gap-1 text-xs">
        <button
          type="button"
          aria-label="Up one folder"
          disabled={!at?.parent}
          onClick={() => at?.parent && void go(at.parent)}
          className="rounded-control p-1 text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Home folder"
          onClick={() => void go('~')}
          className="rounded-control p-1 text-muted hover:bg-surface hover:text-ink"
        >
          <Home aria-hidden className="size-3.5" />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-ink-soft" title={at?.display}>
          {at?.display ?? '…'}
        </span>
      </div>
      <ul aria-label="Folders" className="max-h-52 overflow-y-auto rounded-control bg-surface">
        {at?.folders.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => void go(f.path)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-sunken"
            >
              {f.repo ? (
                <FolderGit2 aria-label="code repository" className="size-4 shrink-0 text-accent" />
              ) : (
                <Folder aria-hidden className="size-4 shrink-0 text-faint" />
              )}
              <span className="truncate">{f.name}</span>
            </button>
          </li>
        ))}
        {at && !at.folders.length && (
          <li className="px-2 py-2 text-xs text-muted">No folders inside.</li>
        )}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
      {making ? (
        <form onSubmit={(e) => void make(e)} className="flex gap-1.5">
          <input
            autoFocus
            aria-label="New folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setMaking(false))}
            placeholder="new-folder"
            className={FIELD}
          />
          <button type="submit" disabled={!name.trim()} className={BUTTON.secondary}>
            Make
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setMaking(true)} className={BUTTON.secondary}>
            <FolderPlus aria-hidden className="size-3.5" /> New folder here
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={BUTTON.secondary}>
            Close
          </button>
          <button
            type="button"
            disabled={!at}
            onClick={() => at && onPick({ path: at.path, display: at.display, name: here })}
            className={clsx(BUTTON.primary)}
          >
            Use {here ? `“${here}”` : 'this folder'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The sidebar's New folder: a name and, optionally, where it lives on this computer. */
export function NewFolderDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (values: { name: string; path: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [finding, setFinding] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New folder"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit({ name: name.trim(), path: path.trim() });
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="relative w-full max-w-md space-y-4 rounded-block bg-surface p-5 shadow-overlay"
      >
        <h2 className="text-base font-semibold">New folder</h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Name</span>
          <input
            name="name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-app"
            className={FIELD}
          />
        </label>
        <div className="space-y-1">
          <label htmlFor="folder-path" className="block text-sm font-medium">
            Local path <span className="font-normal text-muted">(optional)</span>
          </label>
          <div className="flex gap-1.5">
            <input
              id="folder-path"
              name="path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/code/my-app"
              className={FIELD}
            />
            <button
              type="button"
              aria-expanded={finding}
              onClick={() => setFinding((f) => !f)}
              className={clsx(BUTTON.secondary, 'shrink-0')}
            >
              <FolderSearch aria-hidden className="size-3.5" /> Find
            </button>
          </div>
          {finding && (
            <FolderBrowser
              start={path || undefined}
              onCancel={() => setFinding(false)}
              onPick={(p) => {
                setPath(p.display);
                if (!name.trim()) setName(p.name);
                setFinding(false);
              }}
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className={BUTTON.primary}>
            Create folder
          </button>
        </div>
      </form>
    </div>
  );
}
