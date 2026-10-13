import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  FOLDER_REQUESTS_SETTING,
  FolderRequestInput,
  FolderRequests,
  folderContains,
  type FileFolder,
  type FolderRequest,
  type FolderRequestSummary,
} from '@pharos/schema';
import { Hono } from 'hono';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import {
  addFolder,
  checkFolderPath,
  cleanPath,
  forbidden,
  isAgent,
  notAPerson,
  savedFolders,
} from './folders.js';
import { sameOriginOnly } from './routes.js';
import { identityOf } from './safety.js';
import type { FileScanner } from './scan.js';

/** The identity ("dev:ino") of the directory at a real path now, or null if it isn't one. */
function directoryIdentity(path: string): string | null {
  try {
    const stats = lstatSync(path, { bigint: true });
    return stats.isDirectory() ? identityOf(stats) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the directory at the request's path is still the one asked about: not a link now, still
 * resolving to itself, and (when recorded) the same directory identity.
 */
function stillTheRequestedFolder(request: FolderRequest): boolean {
  try {
    if (lstatSync(request.path).isSymbolicLink()) return false;
    if (realpathSync(request.path) !== request.path) return false;
  } catch {
    return false;
  }
  const identity = directoryIdentity(request.path);
  if (!identity) return false;
  return request.identity === undefined || request.identity === identity;
}

/**
 * Folder requests (R7.12, owner decision 2026-10-13): an agent asks for a folder with the MCP tool
 * `folder_request`; the owner approves or declines it with one click in Pharos. Requests are app
 * settings beside the folders (FOLDER_REQUESTS_SETTING), never project data or revisions.
 *
 * - The path is checked with the rules of "Add folder" (it exists; no system, home-root, Library
 *   or dot folder) when asked and again when approved.
 * - Asking twice for one path returns the same request; a declined path stays declined.
 * - A path inside a folder the owner already shares is answered at once (nothing is widened);
 *   inside a hidden folder it is refused.
 * - Only a person on the Pharos page approves or declines (the browser-guarded routes below);
 *   approving adds the folder exactly as "Add folder" does and starts its scan.
 * - A request naming a project makes the folder (the requested path) the base for that
 *   project's relative artifact uris once approved (`projectBases`).
 */

/** At most this many requests wait at once, so an agent can't flood the owner. */
const MAX_PENDING = 20;
/** Requests kept in all; the oldest decided ones go first. */
const MAX_KEPT = 200;

/** The saved requests (an unreadable setting counts as none). */
export function savedRequests(store: Store): FolderRequest[] {
  const parsed = FolderRequests.safeParse(store.setting(FOLDER_REQUESTS_SETTING) ?? []);
  return parsed.success ? parsed.data : [];
}

function saveRequests(store: Store, requests: FolderRequest[]): void {
  let kept = requests;
  while (kept.length > MAX_KEPT) {
    const oldest = kept.findIndex((r) => r.status !== 'pending');
    if (oldest < 0) break;
    kept = kept.filter((_, i) => i !== oldest);
  }
  store.setSetting(FOLDER_REQUESTS_SETTING, FolderRequests.parse(kept));
}

function newRequestId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `freq_${[...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

export const summaryOf = (r: FolderRequest): FolderRequestSummary => ({
  id: r.id,
  path: r.path,
  level: r.level,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requestedBy,
});

/** A request as the asking agent sees it, with what to do next. */
export type AgentFolderRequest = {
  id: string;
  path: string;
  level: FolderRequest['level'];
  reason: string;
  projectId?: string;
  status: FolderRequest['status'];
  folderId?: string;
  next: string;
};

export function forAgent(r: FolderRequest): AgentFolderRequest {
  const next =
    r.status === 'pending'
      ? 'Waiting for the owner. Tell them in one line: open Pharos (the notice at the top of the page, or Settings → Folders) and click Approve. Then call folder_request_status with this id.'
      : r.status === 'approved'
        ? `Approved as folder ${r.folderId}. List its files with files_unadded, then add them with apply (type "file", rootId "${r.folderId}", the path files_unadded gives).`
        : "The owner declined this folder. Don't ask for it again; ask the owner in chat what they'd like instead.";
  return {
    id: r.id,
    path: r.path,
    level: r.level,
    reason: r.reason,
    ...(r.projectId ? { projectId: r.projectId } : {}),
    status: r.status,
    ...(r.folderId ? { folderId: r.folderId } : {}),
    next,
  };
}

const LEVEL_RANK = { details: 1, contents: 2 } as const;

/** `folder_request`: records (or finds) the agent's request for a folder. */
export function requestFolder(
  store: Store,
  raw: unknown,
  requestedBy: string,
  home: string = homedir(),
): FolderRequest {
  const input = FolderRequestInput.parse(raw);
  if (input.projectId) store.getOfType('project', input.projectId);
  const cleaned = cleanPath(input.path, home);
  if (typeof cleaned !== 'string' || !cleaned.startsWith('/'))
    throw new PharosError('invalid', 'path: an absolute folder path, e.g. "/Users/me/Company"');
  const path = checkFolderPath(cleaned, home);
  const level = input.level ?? 'details';
  const now = new Date().toISOString();
  const requests = savedRequests(store);
  const folders = savedFolders(store);

  const holder = folders.find((f) => folderContains(f.path, path));
  if (holder) {
    if (holder.level === 'hidden')
      throw new PharosError(
        'invalid',
        "The owner keeps this folder from agents in Pharos; ask them in chat if you need it, and don't look for its files yourself",
      );
    // Already shared: nothing is widened, so the answer is at once (and names the project).
    const same = requests.find(
      (r) =>
        r.path === path &&
        r.status === 'approved' &&
        r.folderId === holder.id &&
        (r.projectId ?? null) === (input.projectId ?? null),
    );
    if (same) return same;
    const approved: FolderRequest = {
      id: newRequestId(),
      path,
      level: holder.level === 'contents' ? 'contents' : 'details',
      reason: input.reason,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      requestedBy,
      requestedAt: now,
      status: 'approved',
      decidedAt: now,
      folderId: holder.id,
    };
    saveRequests(store, [...requests, approved]);
    return approved;
  }
  if (folders.some((f) => folderContains(path, f.path)))
    throw new PharosError(
      'invalid',
      `${path} contains a folder already in Pharos; ask for a folder that doesn't contain another one`,
    );

  const declined = requests.find((r) => r.path === path && r.status === 'declined');
  if (declined) return declined;
  const pending = requests.find((r) => r.path === path && r.status === 'pending');
  const identity = directoryIdentity(path) ?? undefined;
  if (pending && pending.identity === identity) {
    // The same request again: keep one, naming the project and the higher level asked for.
    const merged: FolderRequest = {
      ...pending,
      ...(!pending.projectId && input.projectId ? { projectId: input.projectId } : {}),
      level: LEVEL_RANK[level] > LEVEL_RANK[pending.level] ? level : pending.level,
    };
    saveRequests(
      store,
      requests.map((r) => (r.id === pending.id ? merged : r)),
    );
    return merged;
  }
  if (requests.filter((r) => r.status === 'pending').length >= MAX_PENDING)
    throw new PharosError(
      'invalid',
      'Too many folder requests are waiting for the owner; wait for them to answer',
    );
  const request: FolderRequest = {
    id: newRequestId(),
    path,
    level,
    reason: input.reason,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    requestedBy,
    requestedAt: now,
    status: 'pending',
    ...(identity ? { identity } : {}),
  };
  // An earlier approval of this path whose folder was removed since is replaced by the new ask,
  // and so is a pending one for a directory replaced at this path since it was asked.
  saveRequests(store, [
    ...requests.filter(
      (r) => !(r.path === path && (r.status === 'approved' || r.status === 'pending')),
    ),
    request,
  ]);
  return request;
}

function findRequest(requests: FolderRequest[], id: string): FolderRequest {
  const found = requests.find((r) => r.id === id);
  if (!found) throw new PharosError('not_found', `Folder request ${id} not found`);
  if (found.status !== 'pending')
    throw new PharosError('conflict', `This request was already ${found.status}`);
  return found;
}

/**
 * The owner approves: the folder is added exactly as "Add folder" adds it (checked again, at the
 * level asked for) and its scan starts; a folder added since that holds the path is used as is.
 */
export function approveRequest(
  store: Store,
  id: string,
  options: { home?: string; scanner?: Pick<FileScanner, 'scan'> } = {},
): { request: FolderRequest; folder: FileFolder } {
  const requests = savedRequests(store);
  const request = findRequest(requests, id);
  // The path must still name the directory the agent asked about (v0.2 review, gap 2): a folder
  // moved away, or a link or another folder put in its place, needs a fresh request.
  if (!stillTheRequestedFolder(request)) {
    saveRequests(
      store,
      requests.filter((r) => r.id !== id),
    );
    throw new PharosError(
      'conflict',
      `The folder at ${request.path} changed since the agent asked for it, so this request was removed; the agent can ask again`,
    );
  }
  const holder = savedFolders(store).find((f) => folderContains(f.path, request.path));
  if (holder?.level === 'hidden')
    throw new PharosError(
      'invalid',
      `This folder is inside "${holder.label}", which you keep hidden; change its level in Settings instead`,
    );
  const folder =
    holder ??
    addFolder(
      store,
      { path: request.path, level: request.level },
      options.home ?? homedir(),
      options.scanner,
    );
  const approved: FolderRequest = {
    ...request,
    status: 'approved',
    decidedAt: new Date().toISOString(),
    folderId: folder.id,
  };
  saveRequests(
    store,
    requests.map((r) => (r.id === id ? approved : r)),
  );
  return { request: approved, folder };
}

/** The owner declines: the path stays declined for agents. */
export function declineRequest(store: Store, id: string): FolderRequest {
  const requests = savedRequests(store);
  const request = findRequest(requests, id);
  const declined: FolderRequest = {
    ...request,
    status: 'declined',
    decidedAt: new Date().toISOString(),
  };
  saveRequests(
    store,
    requests.map((r) => (r.id === id ? declined : r)),
  );
  return declined;
}

/**
 * The folders approved for a project through requests (R7.12): the requested path (the base its
 * relative artifact uris resolve against) and the folder in Settings holding it now.
 */
export function projectBases(
  store: Store,
  projectId: string,
  folders: readonly FileFolder[] = savedFolders(store),
): { base: string; folder: FileFolder }[] {
  const seen = new Set<string>();
  const bases: { base: string; folder: FileFolder }[] = [];
  for (const r of savedRequests(store)) {
    if (r.status !== 'approved' || r.projectId !== projectId || seen.has(r.path)) continue;
    const folder = folders.find((f) => f.id === r.folderId && folderContains(f.path, r.path));
    if (!folder) continue;
    seen.add(r.path);
    bases.push({ base: r.path, folder });
  }
  return bases;
}

/** A pending request covering this absolute path, or else one for the project, if any. */
export function pendingRequestFor(
  store: Store,
  where: { path?: string; projectId?: string },
): FolderRequest | null {
  const pending = savedRequests(store).filter((r) => r.status === 'pending');
  if (where.path) {
    const covering = pending.find((r) => folderContains(r.path, where.path!));
    if (covering) return covering;
    return null;
  }
  return pending.find((r) => r.projectId === where.projectId) ?? null;
}

export type FolderRequestRouteOptions = {
  home?: string;
  scanner?: Pick<FileScanner, 'scan'>;
  /** Runs after an approval (the app links the project's sources once the scan is done). */
  onApproved?: (request: FolderRequest, folder: FileFolder) => void;
};

/**
 * `/api/settings/folder-requests*`: the owner's list and one-click answers. Every route answers
 * the Pharos page only; agents get no list over REST (they use folder_request_status), and only a
 * person may approve or decline.
 */
export function folderRequestRoutes(store: Store, options: FolderRequestRouteOptions = {}) {
  const routes = new Hono();
  routes.use('*', sameOriginOnly);

  routes.get('/', (c) => {
    if (isAgent(c)) return forbidden(c, 'Agents check their requests with folder_request_status');
    const list = [...savedRequests(store)].sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt),
    );
    return c.json(list);
  });

  routes.post('/:requestId/approve', (c) => {
    const refusal = notAPerson(c);
    if (refusal) return forbidden(c, 'Only the owner approves folder requests, in Pharos');
    const { request, folder } = approveRequest(store, c.req.param('requestId'), options);
    try {
      options.onApproved?.(request, folder);
    } catch (error) {
      console.error('[pharos] After approving a folder request:', error);
    }
    return c.json(request);
  });

  routes.post('/:requestId/decline', (c) => {
    const refusal = notAPerson(c);
    if (refusal) return forbidden(c, 'Only the owner declines folder requests, in Pharos');
    return c.json(declineRequest(store, c.req.param('requestId')));
  });

  return routes;
}
