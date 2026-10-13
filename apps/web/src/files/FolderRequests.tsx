import { FILE_ROUTES, FOLDER_LEVELS, type FolderRequest } from '@pharos/schema';
import { FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BUTTON } from '../catalog/ui';
import { postJson, useResource } from '../lib/api';

/**
 * Agents' folder requests (R7.12): an agent asks for a folder over MCP, and the owner approves or
 * declines it here with one click. The server checks that the click comes from the Pharos page;
 * approving adds the folder exactly as "Add folder" does and starts its scan.
 */

const fill = (route: string, requestId: string) =>
  route.replace(':requestId', encodeURIComponent(requestId));

export const approveFolderRequest = (id: string) =>
  postJson<FolderRequest>(fill(FILE_ROUTES.approveFolderRequest, id), {});
export const declineFolderRequest = (id: string) =>
  postJson<FolderRequest>(fill(FILE_ROUTES.declineFolderRequest, id), {});

/** How often open pages look for new requests (agents may ask from another process). */
const POLL_MS = 15_000;

/** Every request, newest first, refreshed now and then and when the tab comes back. */
export function useFolderRequests() {
  const resource = useResource<FolderRequest[]>(FILE_ROUTES.folderRequests);
  const { reload } = resource;
  useEffect(() => {
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const all = Array.isArray(resource.data) ? resource.data : [];
  return { all, pending: all.filter((r) => r.status === 'pending'), reload };
}

/** One request with Approve and Decline. */
export function FolderRequestCard({
  request,
  onDone,
}: {
  request: Pick<FolderRequest, 'id' | 'path' | 'level' | 'reason' | 'requestedBy' | 'status'>;
  onDone?: (result: FolderRequest) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await (approve ? approveFolderRequest : declineFolderRequest)(request.id);
      onDone?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work');
    } finally {
      setBusy(false);
    }
  };
  const name = request.path.slice(request.path.lastIndexOf('/') + 1) || request.path;
  return (
    <div
      role="group"
      aria-label={`Folder request for ${name}`}
      className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="flex items-start gap-2">
        <FolderPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          <strong className="font-medium">{request.requestedBy}</strong> asks to use the folder{' '}
          <strong className="font-medium">{name}</strong>
          {request.reason ? <>: “{request.reason}”</> : null}
        </span>
      </p>
      <p className="text-xs break-all text-amber-900/80 dark:text-amber-100/70">
        <code>{request.path}</code> · {FOLDER_LEVELS[request.level].label}:{' '}
        {FOLDER_LEVELS[request.level].agents}
      </p>
      {request.status === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer(true)}
            className={BUTTON.primary}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer(false)}
            className={BUTTON.secondary}
          >
            Decline
          </button>
        </div>
      ) : (
        <p className="text-xs">{request.status === 'approved' ? 'Approved.' : 'Declined.'}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The small notice on every page (and on a project's page for its own requests) while an agent
 * waits for a folder. Approving or declining here is the same one click as in Settings.
 */
export function FolderRequestNotice({
  projectId,
  exceptProjectId,
  onAnswered,
}: {
  /** Only this project's requests (the project page). */
  projectId?: string;
  /** All but this project's (the shell, while that project's page shows its own). */
  exceptProjectId?: string;
  onAnswered?: () => void;
}) {
  const { pending, reload } = useFolderRequests();
  const shown = pending.filter((r) =>
    projectId ? r.projectId === projectId : !exceptProjectId || r.projectId !== exceptProjectId,
  );
  if (!shown.length) return null;
  return (
    <section aria-label="Folder requests" className="space-y-2">
      {shown.slice(0, 3).map((r) => (
        <FolderRequestCard
          key={r.id}
          request={r}
          onDone={() => {
            reload();
            onAnswered?.();
          }}
        />
      ))}
      {shown.length > 3 && (
        <p className="text-xs text-neutral-500">
          {shown.length - 3} more in{' '}
          <a href="/settings" className="text-sky-600 hover:underline dark:text-sky-400">
            Settings
          </a>
          .
        </p>
      )}
    </section>
  );
}
