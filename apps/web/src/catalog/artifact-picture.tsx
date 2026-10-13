import { fileUrl, imageSource, isPictureFile, type Entity } from '@pharos/schema';
import clsx from 'clsx';
import { ImageOff, Link2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useViewData } from './context';
import { labelOf } from './interactive';
import { Select } from './select';
import { BUTTON } from './ui';

/**
 * An artifact's picture in the drawer (R7.15): the owner picks one of the project's image files
 * or pastes an https address, or clears it. A small preview shows what the Gallery will show.
 */
export function ArtifactPicture({ artifact }: { artifact: Entity<'artifact'> }) {
  const { actions, files } = useViewData();
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const image = artifact.data.image;
  const source = image ? imageSource(image) : null;
  const pictures = (files ?? []).filter((f) => isPictureFile(f.data.path));
  const file =
    source?.kind === 'file' ? (files ?? []).find((f) => f.id === source.fileId) : undefined;
  const src =
    source?.kind === 'file' && file && isPictureFile(file.data.path)
      ? fileUrl('content', file.id)
      : source?.kind === 'url' && source.safe
        ? source.url
        : null;

  const save = (value: string | null, message: string) =>
    void actions.apply(
      message,
      [{ op: 'update', type: 'artifact', id: artifact.id, data: { image: value } }],
      { undoable: true },
    );
  const commitLink = (text: string) => {
    const value = text.trim();
    if (!value) return setLinking(false);
    const parsed = imageSource(value);
    if (parsed.kind !== 'url' || !parsed.safe) {
      setError(
        parsed.kind === 'url' && parsed.problem
          ? `Can’t use this address: ${parsed.problem}.`
          : 'Use an https address of the picture.',
      );
      return;
    }
    setError(null);
    setLinking(false);
    save(parsed.url, `Set the picture of “${labelOf(artifact)}” to a link`);
  };

  return (
    <div className="space-y-2">
      {image && (
        <div className="flex items-start gap-2">
          <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
            {src ? (
              <img
                src={src}
                alt={artifact.data.alt ?? ''}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff aria-hidden className="size-5 text-neutral-300 dark:text-neutral-600" />
            )}
          </div>
          <div className="min-w-0 space-y-1 text-xs text-neutral-500">
            <p className="truncate">
              {file ? labelOf(file) : source?.kind === 'url' ? source.host : 'Not shown'}
            </p>
            <button
              type="button"
              onClick={() => save(null, `Remove the picture of “${labelOf(artifact)}”`)}
              className="inline-flex items-center gap-1 text-neutral-500 hover:text-rose-600"
            >
              <X aria-hidden className="size-3.5" /> Remove picture
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {pictures.length > 0 && (
          <Select
            label="Picture from the project’s files"
            placeholder="Choose a picture…"
            value={file?.id ?? ''}
            className="max-w-60"
            options={pictures.map((f) => ({ value: f.id, label: labelOf(f) }))}
            onChange={(id) => {
              const chosen = pictures.find((f) => f.id === id);
              if (chosen)
                save(id, `Set the picture of “${labelOf(artifact)}” to “${labelOf(chosen)}”`);
            }}
          />
        )}
        {!linking && (
          <button type="button" onClick={() => setLinking(true)} className={BUTTON.secondary}>
            <Link2 aria-hidden className="size-3.5" /> Use a link
          </button>
        )}
      </div>
      {linking && (
        <div className="space-y-1">
          <label htmlFor={inputId} className="sr-only">
            Picture address
          </label>
          <input
            id={inputId}
            autoFocus
            type="url"
            placeholder="https://…"
            defaultValue={source?.kind === 'url' ? source.url : ''}
            onBlur={(e) => commitLink(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLink(e.currentTarget.value);
              if (e.key === 'Escape') {
                e.stopPropagation();
                setError(null);
                setLinking(false);
              }
            }}
            className={clsx(
              'w-full max-w-72 rounded-md border bg-white px-2 py-1 text-sm outline-none focus:ring-2 dark:bg-neutral-900',
              error
                ? 'border-rose-400 focus:ring-rose-200 dark:border-rose-700'
                : 'border-sky-300 focus:ring-sky-200 dark:border-sky-800 dark:focus:ring-sky-900',
            )}
          />
          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
