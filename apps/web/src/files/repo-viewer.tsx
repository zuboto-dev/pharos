import { repoFileUrl, repoMediaUrl, type RepoFile, type RepoLink } from '@pharos/schema';
import clsx from 'clsx';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import { Markdown } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import { FileTypeIcon } from '../catalog/components/file-list';
import { FileViewer } from './FileViewer';
import { PreviewSkeleton } from './FilePreview';
import { fileActionUrl, fileName, formatSize } from './files';
import { RepoDefaultRef, RepoFileLink, RepoMedia } from './repo-links';

// The viewer for a repository file (repo: links): the file viewer's dialog (Esc closes, a full
// sheet on phones) with the file read from the project's repository, at a ref or from the
// working tree. Markdown is rendered, code and text shown with line numbers and the linked lines
// marked; a picture is shown, a video or sound played; a missing file reads "Not found on <ref>".

export function RepoFileViewer({
  projectId,
  link,
  onClose,
  leaving,
}: {
  projectId: string;
  link: RepoLink;
  onClose: () => void;
  leaving?: boolean;
}) {
  const res = useResource<RepoFile>(repoFileUrl(projectId, link.path, link.ref));
  const file = res.data;
  const where = link.ref ?? 'the working tree';
  return (
    <FileViewer
      items={[
        {
          key: `${link.path}@${link.ref ?? ''}`,
          title: fileName(link.path),
          label: `${link.path}${link.ref ? ` on ${link.ref}` : ''}`,
          meta: (
            <span data-repo-meta="" className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
              <FileTypeIcon path={link.path} className="size-3.5 text-faint" />
              <code className="break-all">{link.path}</code>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3.5" aria-hidden />
                {link.ref ?? 'working tree'}
              </span>
              {file && <span>{formatSize(file.size)}</span>}
            </span>
          ),
          headerActions: file?.fileId ? <ShowInFolder fileId={file.fileId} /> : undefined,
          preview: (
            <div className="space-y-2">
              {res.status === 'loading' && <PreviewSkeleton label="Loading the file" />}
              {res.status === 'error' && !file && (
                <Calm>
                  {res.error instanceof ApiError && res.error.status === 404
                    ? res.error.message
                    : res.error instanceof ApiError && res.error.status === 403
                      ? 'Pharos doesn’t show this file: it’s a dotfile, a secret or a link.'
                      : `Couldn’t read it from ${where}.`}
                </Calm>
              )}
              {file && <RepoFileBody file={file} projectId={projectId} link={link} />}
            </div>
          ),
        },
      ]}
      index={0}
      onIndex={() => {}}
      onClose={onClose}
      leaving={leaving}
    />
  );
}

function Calm({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="note"
      className="rounded-tile border border-line bg-surface px-4 py-6 text-center text-sm text-muted"
    >
      {children}
    </p>
  );
}

function ShowInFolder({ fileId }: { fileId: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {note && <span className="text-xs text-muted">{note}</span>}
      <button
        type="button"
        onClick={() =>
          postJson(fileActionUrl(fileId, 'reveal'), {}).then(
            () => setNote('Shown in Finder'),
            () => setNote('Couldn’t show it'),
          )
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm text-ink-soft hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <FolderOpen className="size-4" aria-hidden />
        Open in folder
      </button>
    </span>
  );
}

/** A relative link inside a Markdown file, from the folder it is in ("../a.md", "b/c.md"). */
export function resolveRelative(fromPath: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/'))
    return null;
  const target = href.split('#')[0]!.split('?')[0]!;
  if (!target) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const part of decodeURIComponent(target).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

function RepoFileBody({
  file,
  projectId,
  link,
}: {
  file: RepoFile;
  projectId: string;
  link: RepoLink;
}) {
  const components = useMemo<Components>(
    () => ({
      // Pictures would fetch from the web or a path the browser can't read: their text instead.
      img: ({ alt }) => <span className="text-muted">[image: {alt}]</span>,
      // Links between the repository's files open here too, at the same ref.
      a: ({ href, children }) => {
        const path = href ? resolveRelative(file.path, href) : null;
        if (path)
          return (
            <RepoFileLink
              projectId={projectId}
              link={{ path, ...(link.ref ? { ref: link.ref } : {}) }}
            >
              {children}
            </RepoFileLink>
          );
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
    }),
    [file.path, projectId, link.ref],
  );
  const cut = file.truncated && (
    <p className="text-xs text-muted">
      Showing the first {formatSize(file.content?.length ?? 0)} of {formatSize(file.size)}.
    </p>
  );
  if (file.kind === 'image')
    return file.content ? (
      <img src={file.content} alt={file.path} className="mx-auto max-h-[70vh] max-w-full" />
    ) : (
      <Calm>This picture is too big to show here ({formatSize(file.size)}).</Calm>
    );
  if (file.kind === 'video' || file.kind === 'audio')
    return file.truncated ? (
      <Calm>
        This {file.kind === 'video' ? 'video' : 'sound'} is too big to play here (
        {formatSize(file.size)}).
      </Calm>
    ) : (
      <RepoMedia
        kind={file.kind}
        src={repoMediaUrl(projectId, file.path, link.ref)}
        label={file.path}
        size="viewer"
      />
    );
  if (file.kind === 'binary' || file.content === undefined)
    return (
      <Calm>
        A binary file ({formatSize(file.size)}); Pharos shows text, code, pictures, videos and
        sounds.
      </Calm>
    );
  if (file.kind === 'markdown')
    return (
      <div className="space-y-1">
        <div className="rounded-tile border border-line bg-surface p-4 sm:p-6">
          <RepoDefaultRef.Provider value={link.ref}>
            <Markdown components={components}>{file.content}</Markdown>
          </RepoDefaultRef.Provider>
        </div>
        {cut}
      </div>
    );
  return (
    <div className="space-y-1">
      <CodeLines text={file.content} lines={link.lines} language={file.language} />
      {cut}
    </div>
  );
}

/** Code or text with line numbers; the linked lines are marked and scrolled to. */
export function CodeLines({
  text,
  lines,
  language,
}: {
  text: string;
  lines?: { from: number; to: number };
  language?: string;
}) {
  const rows = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  const first = useRef<HTMLTableRowElement>(null);
  useEffect(() => first.current?.scrollIntoView?.({ block: 'center' }), [lines?.from]);
  return (
    <div className="overflow-auto rounded-tile border border-line bg-surface">
      <table
        data-language={language}
        className="w-full border-collapse font-mono text-xs leading-relaxed"
      >
        <tbody>
          {rows.map((row, i) => {
            const n = i + 1;
            const marked = !!lines && n >= lines.from && n <= lines.to;
            return (
              <tr
                key={n}
                ref={marked && n === lines!.from ? first : undefined}
                data-line={n}
                data-marked={marked || undefined}
                className={clsx(marked && 'bg-amber-100/70 dark:bg-amber-900/40')}
              >
                <td className="w-1 border-r border-line-soft px-3 text-right align-top text-faint select-none">
                  {n}
                </td>
                <td className="px-3 whitespace-pre">{row || ' '}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
