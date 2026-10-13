import { TEXT_PREVIEW_MAX_BYTES, fileTypeOf, fileUrl, type Entity } from '@pharos/schema';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { FileTypeIcon } from '../catalog/components/file-list';
import { BUTTON, Markdown } from '../catalog/ui';
import { extensionOf, formatSize, pdfFrame, readTextLimited, type PdfFrame } from './files';

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
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      {children}
    </div>
  );
}

/** A calm placeholder where a preview can't be shown, with what to do instead. */
function NoPreview({ path, children }: { path: string; children: ReactNode }) {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
        <FileTypeIcon path={path} className="size-8 text-neutral-300 dark:text-neutral-600" />
        {children}
      </div>
    </Frame>
  );
}

/** Markdown images would fetch from the web; show their text instead. */
const NO_IMAGES = {
  img: ({ alt }: { alt?: string }) => <span className="text-neutral-500">[image: {alt}]</span>,
};

function TextPreview({ file, markdown }: { file: Entity<'file'>; markdown: boolean }) {
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

  if (state.status === 'loading')
    return <NoPreview path={file.data.path}>Loading the preview…</NoPreview>;
  if (state.status === 'error')
    return <NoPreview path={file.data.path}>Couldn’t load the preview.</NoPreview>;
  return (
    <div className="space-y-1">
      <Frame>
        <div className="max-h-[60vh] overflow-auto bg-white p-4 dark:bg-neutral-900">
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
        <p className="text-xs text-neutral-500">
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
}: {
  file: Entity<'file'>;
  available: boolean;
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
            className="mx-auto max-h-[60vh] w-auto object-contain"
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
              className="h-[60vh] w-full bg-white"
            />
          </Frame>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Blank preview? <NewTabLinkInline fileId={file.id} />
          </p>
        </div>
      ) : (
        <NoPreview path={file.data.path}>
          <span>This browser doesn’t show PDFs inside a page.</span>
          <NewTabLink fileId={file.id}>Open the PDF in a new tab</NewTabLink>
        </NoPreview>
      );
    case 'text':
    case 'markdown':
      return <TextPreview file={file} markdown={type.preview === 'markdown'} />;
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
