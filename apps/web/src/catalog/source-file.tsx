import { FILE_ROUTES, type ArtifactFileMatch, type Entity } from '@pharos/schema';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FolderRequestCard } from '../files/FolderRequests';
import { getJson } from '../lib/api';
import { useViewData, type ViewData } from './context';
import { isHttp } from './ui';

/**
 * Claim sources and other artifacts on disk (R7.6, R7.12). A source whose local path is a project
 * file opens that file; otherwise its path stays as text, with a line saying why it can't open
 * yet: the folder it needs (with the agent's request to approve, when there is one), a missing
 * file, or a file Pharos never reads.
 */

type Artifact = Entity<'artifact'>;

/** The project file a source is, when `artifact.fileId` is set and the file is in the dataset. */
export function linkedFileOf(byId: ViewData['entityById'], source: Artifact): string | undefined {
  const { fileId } = source.data;
  return fileId && byId.get(fileId)?.type === 'file' ? fileId : undefined;
}

/** `GET /api/artifacts/:artifactId/file`, the live page's `ViewActions.findSourceFile`. */
export function findSourceFile(artifactId: string): Promise<ArtifactFileMatch> {
  return getJson(FILE_ROUTES.artifactFile.replace(':artifactId', encodeURIComponent(artifactId)));
}

/**
 * Where a source not linked yet sits, asked again whenever the dataset changes (or `refresh`
 * does, after a folder is approved). Undefined while loading, where the page can't ask (a static
 * preview), and for a web or linked source.
 */
export function useSourceMatch(
  source: Artifact,
  ask: boolean,
  refresh = 0,
): ArtifactFileMatch | undefined {
  const { version, actions } = useViewData();
  const find = ask ? actions.findSourceFile : undefined;
  const [match, setMatch] = useState<{ key: string; value: ArtifactFileMatch }>();
  const key = `${source.id}:${version}:${refresh}`;
  useEffect(() => {
    if (!find) return;
    let cancelled = false;
    find(source.id).then(
      (value) => !cancelled && setMatch({ key, value }),
      // When the server can't say, the path alone is shown.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [find, key, source.id]);
  return match?.key === key ? match.value : undefined;
}

const NOTE = 'text-xs text-neutral-500 dark:text-neutral-400';

/** What a source's match means for the reader, and what they can do (R7.12). */
export function SourceStatus({
  match,
  onOpen,
  onApproved,
}: {
  match: ArtifactFileMatch | undefined;
  onOpen?: () => void;
  onApproved?: () => void;
}) {
  const { actions } = useViewData();
  if (!match) return null;
  switch (match.state) {
    case 'linked':
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.();
            actions.open({ entity: match.fileId });
          }}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-sky-600 hover:underline focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-sky-400"
        >
          <FileText className="size-3 shrink-0" aria-hidden />
          Open file
        </button>
      );
    case 'in-folder':
      return (
        <p className={NOTE}>
          In a Pharos folder, not added to this project yet. Ask your agent to add it, or add it
          from Files.
        </p>
      );
    case 'missing':
      return (
        <p className={NOTE}>
          Its folder is in Pharos, but no file is at this path. It may have moved or been renamed.
        </p>
      );
    case 'refused':
      return (
        <p className={NOTE}>
          Pharos doesn’t open this file: its name looks like a key, password or backup, or it leads
          out of its folder.
        </p>
      );
    case 'not-in-folder':
      if (match.request)
        return (
          <div className="space-y-1.5" data-no-open>
            <p className={NOTE}>To open it here, Pharos needs this folder.</p>
            <FolderRequestCard request={match.request} onDone={onApproved} />
          </div>
        );
      return match.folder ? (
        <p className={NOTE}>
          Not in a folder you share with Pharos. To open it here, add{' '}
          <code className="break-all">{match.folder}</code> in{' '}
          <a href="/settings" className="text-sky-600 hover:underline dark:text-sky-400">
            Settings
          </a>{' '}
          or ask your agent to request it.
        </p>
      ) : (
        <p className={NOTE}>
          A path inside the project’s folder, but no folder is approved for this project yet. Ask
          your agent to request it, or add it in{' '}
          <a href="/settings" className="text-sky-600 hover:underline dark:text-sky-400">
            Settings
          </a>
          .
        </p>
      );
    case 'none':
      return null;
  }
}

/**
 * A local source's path, under its title in a source list: kept as text, with "Open file" when
 * it was matched to a project file, or what to do when it isn't in a Pharos folder.
 */
export function LocalSourcePath({ source, onOpen }: { source: Artifact; onOpen?: () => void }) {
  const { entityById } = useViewData();
  const [refresh, setRefresh] = useState(0);
  const { uri } = source.data;
  const local = !!uri && !isHttp(uri);
  const linked = local ? linkedFileOf(entityById, source) : undefined;
  const match = useSourceMatch(source, local && !linked, refresh);
  if (!local) return null;
  return (
    <>
      <code className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{uri}</code>
      <SourceStatus match={match} onOpen={onOpen} onApproved={() => setRefresh((n) => n + 1)} />
    </>
  );
}

/**
 * The panel at the top of an artifact's drawer when its local document can't open yet (R7.12):
 * where it is and why, with the one-click Approve when an agent asked for its folder.
 */
export function ArtifactSourcePanel({ artifact }: { artifact: Artifact }) {
  const { entityById } = useViewData();
  const [refresh, setRefresh] = useState(0);
  const { uri } = artifact.data;
  const local = !!uri && !isHttp(uri);
  const linked = local ? linkedFileOf(entityById, artifact) : undefined;
  const match = useSourceMatch(artifact, local && !linked, refresh);
  if (!local || linked) return null;
  return (
    <section
      aria-label="Document"
      className="mb-4 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Document</p>
      <code className="block text-xs break-all text-neutral-600 dark:text-neutral-300">{uri}</code>
      {match ? (
        <SourceStatus match={match} onApproved={() => setRefresh((n) => n + 1)} />
      ) : (
        <p className={NOTE}>Pharos can open documents in folders you share with it.</p>
      )}
    </section>
  );
}
