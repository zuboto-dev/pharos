import { FILE_ROUTES, type ArtifactFileMatch, type Entity } from '@pharos/schema';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getJson } from '../lib/api';
import { useViewData, type ViewData } from './context';
import { isHttp } from './ui';

/**
 * Claim sources on disk (R7.6). A source whose local path is a project file opens that file in
 * the drawer; otherwise its path stays as text, with a line saying why it can't open yet.
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
 * Where a source not linked yet sits, asked again whenever the dataset changes. Undefined while
 * loading, where the page can't ask (a static preview), and for a web or linked source.
 */
function useSourceMatch(source: Artifact, ask: boolean): ArtifactFileMatch | undefined {
  const { version, actions } = useViewData();
  const find = ask ? actions.findSourceFile : undefined;
  const [match, setMatch] = useState<{ key: string; value: ArtifactFileMatch }>();
  const key = `${source.id}:${version}`;
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

/**
 * A local source's path, under its title in a source list: kept as text, with "Open file" when
 * it was matched to a project file, or what to do when it isn't in a Pharos folder.
 */
export function LocalSourcePath({ source, onOpen }: { source: Artifact; onOpen?: () => void }) {
  const { entityById, actions } = useViewData();
  const { uri } = source.data;
  const local = !!uri && !isHttp(uri);
  const linked = local ? linkedFileOf(entityById, source) : undefined;
  const match = useSourceMatch(source, local && !linked);
  if (!local) return null;
  const note = 'text-xs text-neutral-500 dark:text-neutral-400';
  return (
    <>
      <code className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{uri}</code>
      {match?.state === 'linked' && (
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
      )}
      {match?.state === 'in-folder' && (
        <p className={note}>
          In a Pharos folder, not added to this project yet. Add it from Files.
        </p>
      )}
      {match?.state === 'not-in-folder' && (
        <p className={note}>
          Not in a Pharos folder. Add its folder in{' '}
          <a href="/settings" className="text-sky-600 hover:underline dark:text-sky-400">
            Settings
          </a>{' '}
          to open it here.
        </p>
      )}
    </>
  );
}
