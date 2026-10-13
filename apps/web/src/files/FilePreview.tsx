import { TEXT_PREVIEW_MAX_BYTES, fileTypeOf, fileUrl, type Entity } from '@pharos/schema';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { FileTypeIcon } from '../catalog/components/file-list';
import { Skeleton } from '../catalog/skeleton';
import { BUTTON, Markdown } from '../catalog/ui';
import { AudioPreview } from './audio';
import { extensionOf, formatSize, pdfFrame, readTextLimited, type PdfFrame } from './files';

/**
 * How tall a preview is: in the file drawer, in a compact FileView next to a list, or a full
 * FileView (R7.11). The preview itself is the same everywhere.
 */
export type PreviewSize = 'drawer' | 'compact' | 'full';

const HEIGHT: Record<PreviewSize, { box: string; max: string }> = {
  drawer: { box: 'h-[60vh]', max: 'max-h-[60vh]' },
  compact: { box: 'h-80', max: 'max-h-80' },
  full: { box: 'h-[75vh] min-h-96', max: 'max-h-[75vh]' },
};

/** Opens the file's contents in a new tab (the browser's own viewer). */
export function NewTabLink({ fileId, children }: { fileId: string; children?: ReactNode }) {
  return (
    <a
      href={fileUrl('content', fileId)}
      target="_blank"
      rel="noopener noreferrer"
      className={BUTTON.secondary}
    >
      <ExternalLink className="size-3.5" aria-hidden /> {children ?? 'Open in a new tab'}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-tile border border-line bg-canvas">{children}</div>
  );
}

/** A calm placeholder where a preview can't be shown, with what to do instead. */
function NoPreview({ path, children }: { path: string; children: ReactNode }) {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted">
        <FileTypeIcon path={path} className="size-8 text-faint" />
        {children}
      </div>
    </Frame>
  );
}

/** The preview while it loads: a frame of text-shaped lines, about as tall as a short page. */
export function PreviewSkeleton({ label = 'Loading the preview' }: { label?: string }) {
  return (
    <Frame>
      <Skeleton lines={6} label={label} className="bg-surface p-4" />
    </Frame>
  );
}

/** Markdown images would fetch from the web; show their text instead. */
const NO_IMAGES = {
  img: ({ alt }: { alt?: string }) => <span className="text-muted">[image: {alt}]</span>,
};

function TextPreview({
  file,
  markdown,
  size,
}: {
  file: Entity<'file'>;
  markdown: boolean;
  size: PreviewSize;
}) {
  // Keyed by file and revision, so a result for an earlier file never shows (and a new one loads).
  const key = `${file.id}@${file.updatedRev}`;
  const [loaded, setLoaded] = useState<
    { key: string } & ({ status: 'ok'; text: string; truncated: boolean } | { status: 'error' })
  >();
  useEffect(() => {
    const controller = new AbortController();
    readTextLimited(fileUrl('content', file.id), TEXT_PREVIEW_MAX_BYTES, controller.signal).then(
      (result) => setLoaded({ key, status: 'ok', ...result }),
      () => !controller.signal.aborted && setLoaded({ key, status: 'error' }),
    );
    return () => controller.abort();
  }, [file.id, key]);
  const state = loaded?.key === key ? loaded : { status: 'loading' as const };

  if (state.status === 'loading') return <PreviewSkeleton />;
  if (state.status === 'error')
    return <NoPreview path={file.data.path}>Couldn’t load the preview.</NoPreview>;
  return (
    <div className="space-y-1">
      <Frame>
        <div className={clsx(HEIGHT[size].max, 'overflow-auto bg-surface p-4')}>
          {markdown ? (
            <Markdown components={NO_IMAGES}>{state.text}</Markdown>
          ) : (
            <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {state.text}
            </pre>
          )}
        </div>
      </Frame>
      {state.truncated && (
        <p className="text-xs text-muted">
          Showing the first {formatSize(TEXT_PREVIEW_MAX_BYTES)}. Download it to read the rest.
        </p>
      )}
    </div>
  );
}

/**
 * The file's contents, by its allowlisted type: images inline, PDFs in a frame (see `pdfFrame`;
 * a new tab without a PDF viewer), text and Markdown up to TEXT_PREVIEW_MAX_BYTES.
 * Everything else, and HTML or SVG above all, is never shown inline.
 */
export function FilePreview({
  file,
  available,
  pdf = pdfFrame(),
  size = 'drawer',
}: {
  file: Entity<'file'>;
  available: boolean;
  size?: PreviewSize;
  /** Overridable for tests; defaults to what this browser can do. */
  pdf?: PdfFrame;
}) {
  const type = fileTypeOf(file.data.path);
  const ext = extensionOf(file.data.path).toUpperCase() || 'this kind of';
  if (!available) return null;
  switch (type.preview) {
    case 'image':
      return (
        <Frame>
          <img
            src={fileUrl('content', file.id)}
            alt={file.data.title}
            className={clsx('mx-auto w-auto object-contain', HEIGHT[size].max)}
          />
        </Frame>
      );
    case 'pdf':
      return pdf !== 'new-tab' ? (
        <div className="space-y-2">
          <Frame>
            <iframe
              title={`Preview of ${file.data.title}`}
              src={fileUrl('content', file.id)}
              // Chromium won't show a PDF in a sandboxed frame; the response is sandboxed anyway.
              {...(pdf === 'sandboxed' ? { sandbox: '' } : {})}
              referrerPolicy="no-referrer"
              className={clsx('w-full bg-white', HEIGHT[size].box)}
            />
          </Frame>
          <p className="text-xs text-muted">
            Blank preview? <NewTabLinkInline fileId={file.id} />
          </p>
        </div>
      ) : (
        <NoPreview path={file.data.path}>
          <span>This browser doesn’t show PDFs inside a page.</span>
          <NewTabLink fileId={file.id}>Open the PDF in a new tab</NewTabLink>
        </NoPreview>
      );
    case 'audio':
      return <AudioPreview fileId={file.id} title={file.data.title} />;
    case 'text':
    case 'markdown':
      return <TextPreview file={file} markdown={type.preview === 'markdown'} size={size} />;
    default:
      return (
        <NoPreview path={file.data.path}>
          No preview for {ext} files.{' '}
          {type.open ? 'Open it in its app or download it.' : 'Download it to open it.'}
        </NoPreview>
      );
  }
}

function NewTabLinkInline({ fileId }: { fileId: string }) {
  return (
    <a
      href={fileUrl('content', fileId)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-700 hover:underline dark:text-sky-400"
    >
      Open it in a new tab
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
