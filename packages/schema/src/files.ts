import { z } from 'zod';

/**
 * Project files (R7, docs/reframe/roadmap-2.md §3): the contract shared by the server and the
 * web app. Files stay where they are, inside folders the owner adds on the Settings page. Pharos
 * only reads them: no upload, rename or delete. Every URL carries a file id, never a path.
 *
 * Who owns what (R7.1 sets the shapes, the later tasks build them):
 * - R7.2 the scan, the scan cache, the file routes and actions (`apps/server/src/files/`)
 * - R7.3 the folders on the Settings page and their routes (`apps/server/src/files/folders.ts`)
 * - R7.4 FileList, the file drawer and the Files page (`apps/web/src/files/`)
 * - R7.5 what agents see of files (snapshot, dataset for agents, MCP)
 * - R7.6 claim sources on disk (artifact.fileId)
 */

// ------------------------------------------------------------------ paths

/** No control characters (NUL, newlines, …) anywhere in a path. */
const noControl = (p: string) => ![...p].some((c) => c.charCodeAt(0) < 0x20);

/**
 * A file's path relative to its folder: "/"-separated, no leading "/", no empty, "." or ".."
 * parts, and no part starting with "." (dotfiles and dot-folders are never scanned or served).
 * The server still resolves the real path and rejects it outside its folder (symlinks).
 */
export const FilePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(noControl, 'No control characters')
  .refine((p) => !p.includes('\\'), 'Use "/" between parts')
  .refine(
    (p) => p.split('/').every((part) => part.length > 0 && !part.startsWith('.')),
    'A relative path inside its folder, without empty, "." or ".." parts or dotfiles',
  )
  .describe('Path relative to its folder, e.g. "2025/Tax/receipt.pdf"');

/** An absolute folder path as the owner typed it: no trailing "/", no ".", ".." or empty parts. */
export const FolderPath = z
  .string()
  .min(2)
  .max(1024)
  .refine(noControl, 'No control characters')
  .refine((p) => p.startsWith('/'), 'An absolute path, starting with "/"')
  .refine(
    (p) =>
      p
        .slice(1)
        .split('/')
        .every((part) => part.length > 0 && part !== '.' && part !== '..'),
    'No trailing "/", and no empty, "." or ".." parts',
  );

/** Whether `child` is `parent` or inside it (plain path comparison; real paths are the server's). */
export function folderContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`);
}

// ------------------------------------------------------------------ folders (app settings)

/**
 * Folders are app settings, like the agent pause: saved with `Store.setSetting(FOLDERS_SETTING)`,
 * never project data, never revisions, and never reachable over MCP. Only the Settings page adds,
 * renames or removes them (R7.3).
 */
export const FOLDERS_SETTING = 'files.folders';

/**
 * What agents may see of a folder's files:
 * - hidden: owner only; agents see nothing, not even that the files exist
 * - details (default): the details of files added to a project, never contents
 * - contents: details, and one MCP tool may read a file's text
 */
export const FolderLevel = z.enum(['hidden', 'details', 'contents']);
export type FolderLevel = z.infer<typeof FolderLevel>;
export const DEFAULT_FOLDER_LEVEL: FolderLevel = 'details';

export const FOLDER_LEVELS: Record<FolderLevel, { label: string; agents: string }> = {
  hidden: { label: 'Hidden', agents: 'Agents see nothing from this folder.' },
  details: {
    label: 'Details',
    agents:
      'Agents see the names and details of files (kind, issuer, dates, tags), never their contents.',
  },
  contents: {
    label: 'Contents',
    agents: 'Agents see names and details, and can read the text of .txt, .csv and .md files.',
  },
};

export const FolderId = z
  .string()
  .regex(/^root_[a-z0-9]{6,32}$/, 'A folder id, e.g. "root_k3j9x2"')
  .describe('Folder (root) id, from Settings');

export const FileFolder = z.strictObject({
  id: FolderId,
  path: FolderPath,
  label: z.string().trim().min(1).max(60).describe('Shown instead of the path, e.g. "Company"'),
  level: FolderLevel,
  addedAt: z.iso.datetime(),
  identity: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional()
    .describe(
      'Device and inode of the folder when it was added (R7.9); Pharos refuses a folder replaced since',
    ),
});
export type FileFolder = z.infer<typeof FileFolder>;

/**
 * The saved folder list. Ids and paths are unique, and no folder sits inside another, so every
 * file has exactly one folder and one level (a hidden folder can't be read through its parent).
 */
export const FileFolders = z.array(FileFolder).superRefine((folders, ctx) => {
  folders.forEach((a, i) => {
    folders.forEach((b, j) => {
      if (j <= i) return;
      if (a.id === b.id)
        ctx.addIssue({ code: 'custom', message: `Duplicate folder id "${b.id}"`, path: [j, 'id'] });
      if (folderContains(a.path, b.path) || folderContains(b.path, a.path))
        ctx.addIssue({
          code: 'custom',
          message: `"${b.path}" overlaps "${a.path}"; folders can't sit inside each other`,
          path: [j, 'path'],
        });
    });
  });
});
export type FileFolders = z.infer<typeof FileFolders>;

/** `POST /api/settings/folders` (R7.3). The server makes the id and checks the folder exists. */
export const FolderCreateInput = z.strictObject({
  path: FolderPath,
  label: FileFolder.shape.label.optional().describe('Default: the folder name'),
  level: FolderLevel.optional().describe('Default: details'),
});
export type FolderCreateInput = z.infer<typeof FolderCreateInput>;

/** `PATCH /api/settings/folders/:folderId` (R7.3). The path can't change; remove and re-add. */
export const FolderUpdateInput = z
  .strictObject({ label: FileFolder.shape.label.optional(), level: FolderLevel.optional() })
  .refine((u) => u.label !== undefined || u.level !== undefined, 'Change label or level');
export type FolderUpdateInput = z.infer<typeof FolderUpdateInput>;

/** One folder as the Settings page shows it (`GET /api/settings/folders`, R7.3 with R7.2). */
export type FolderStatus = FileFolder & {
  /** Whether the folder exists and can be read now. */
  available: boolean;
  /** Files found by the last scan (null before the first). */
  files: number | null;
  scannedAt: string | null;
  scanning: boolean;
  /** The last scan error, in plain words, without file contents. */
  error: string | null;
  /** Claude Code permission deny rules for this folder; empty for `contents` (R7.3). */
  denyRules: string[];
};

// ------------------------------------------------------------------ folder requests (R7.12)

/**
 * Agents ask for a folder (MCP `folder_request`); the owner approves or declines it with one click
 * in Pharos. Requests are app settings next to the folders (`FOLDER_REQUESTS_SETTING`), never
 * project data or revisions. Agents can't approve, decline or change levels. Approving adds the
 * folder exactly as "Add folder" does; a declined path stays declined.
 */
export const FOLDER_REQUESTS_SETTING = 'files.folderRequests';

export const FolderRequestId = z
  .string()
  .regex(/^freq_[a-z0-9]{6,32}$/, 'A folder request id, e.g. "freq_k3j9x2"');

/** Levels an agent may ask for; hidden is the owner's alone. */
export const RequestLevel = z.enum(['details', 'contents']);
export type RequestLevel = z.infer<typeof RequestLevel>;

export const FolderRequestStatus = z.enum(['pending', 'approved', 'declined']);
export type FolderRequestStatus = z.infer<typeof FolderRequestStatus>;

export const FolderRequest = z.strictObject({
  id: FolderRequestId,
  /** The folder's real path, checked like "Add folder". */
  path: FolderPath,
  level: RequestLevel,
  reason: z.string().trim().min(1).max(300),
  /** The project it is for: once approved, the base of that project's relative artifact uris. */
  projectId: z.string().min(1).optional(),
  /** The agent that asked (its MCP client name). */
  requestedBy: z.string().min(1).max(120),
  requestedAt: z.iso.datetime(),
  status: FolderRequestStatus,
  decidedAt: z.iso.datetime().optional(),
  /** The folder (root) it became, or the folder already holding it. */
  folderId: FolderId.optional(),
});
export type FolderRequest = z.infer<typeof FolderRequest>;
export const FolderRequests = z.array(FolderRequest);

/** MCP `folder_request` input. */
export const FolderRequestInput = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe('Absolute path of the folder, e.g. "/Users/me/Company"'),
  level: RequestLevel.optional().describe(
    'details (default): agents see the details of files added from it; contents: also the text of .txt, .csv and .md files',
  ),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('One plain sentence the owner reads, e.g. "To keep the company registration papers"'),
  projectId: z
    .string()
    .optional()
    .describe("The project it is for; that project's relative artifact uris resolve inside it"),
});
export type FolderRequestInput = z.infer<typeof FolderRequestInput>;

/** MCP tool names (R7.12). */
export const FOLDER_REQUEST_TOOL = 'folder_request';
export const FOLDER_REQUEST_STATUS_TOOL = 'folder_request_status';
export const FILES_UNADDED_TOOL = 'files_unadded';

// ------------------------------------------------------------------ file types (allowlist)

/** How the file drawer previews a file; `none` means details and actions only. */
export type PreviewKind = 'pdf' | 'image' | 'text' | 'markdown' | 'audio' | 'none';

export type FileType = {
  mime: string;
  preview: PreviewKind;
  /** "Open in default app" is offered (documents only, never scripts, apps or HTML). */
  open: boolean;
};

/**
 * The only mime types the server sends, by lowercase extension. Anything else goes out as
 * `application/octet-stream` and as a download; HTML and SVG are never shown inline.
 */
export const FILE_TYPES: Readonly<Record<string, FileType>> = {
  pdf: { mime: 'application/pdf', preview: 'pdf', open: true },
  png: { mime: 'image/png', preview: 'image', open: true },
  jpg: { mime: 'image/jpeg', preview: 'image', open: true },
  jpeg: { mime: 'image/jpeg', preview: 'image', open: true },
  gif: { mime: 'image/gif', preview: 'image', open: true },
  webp: { mime: 'image/webp', preview: 'image', open: true },
  heic: { mime: 'image/heic', preview: 'none', open: true },
  txt: { mime: 'text/plain; charset=utf-8', preview: 'text', open: true },
  csv: { mime: 'text/csv; charset=utf-8', preview: 'text', open: true },
  md: { mime: 'text/markdown; charset=utf-8', preview: 'markdown', open: true },
  markdown: { mime: 'text/markdown; charset=utf-8', preview: 'markdown', open: true },
  rtf: { mime: 'application/rtf', preview: 'none', open: true },
  doc: { mime: 'application/msword', preview: 'none', open: true },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    preview: 'none',
    open: true,
  },
  xls: { mime: 'application/vnd.ms-excel', preview: 'none', open: true },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    preview: 'none',
    open: true,
  },
  ppt: { mime: 'application/vnd.ms-powerpoint', preview: 'none', open: true },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    preview: 'none',
    open: true,
  },
  pages: { mime: 'application/vnd.apple.pages', preview: 'none', open: true },
  numbers: { mime: 'application/vnd.apple.numbers', preview: 'none', open: true },
  key: { mime: 'application/vnd.apple.keynote', preview: 'none', open: true },
  // Audio plays in place (R9): the drawer, a FileView, FileList rows and record file fields.
  m4a: { mime: 'audio/mp4', preview: 'audio', open: true },
  mp3: { mime: 'audio/mpeg', preview: 'audio', open: true },
  wav: { mime: 'audio/wav', preview: 'audio', open: true },
  ogg: { mime: 'audio/ogg', preview: 'audio', open: true },
  flac: { mime: 'audio/flac', preview: 'audio', open: true },
  aiff: { mime: 'audio/aiff', preview: 'none', open: true },
  aif: { mime: 'audio/aiff', preview: 'none', open: true },
};

export const UNKNOWN_FILE_TYPE: FileType = {
  mime: 'application/octet-stream',
  preview: 'none',
  open: false,
};

/** The allowlisted type of a file, by its extension (never by sniffing its contents). */
export function fileTypeOf(path: string): FileType {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return UNKNOWN_FILE_TYPE;
  return FILE_TYPES[name.slice(dot + 1).toLowerCase()] ?? UNKNOWN_FILE_TYPE;
}

/** Text and Markdown previews (and the R7.5 MCP read) stop at this many bytes. */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

// ------------------------------------------------------------------ file entity fields

/**
 * Fields only the scan sets (R7.2): what's on disk. People and agents edit the rest (title, kind,
 * issuer, dates, tags, notes, taskIds). Agents add files only from folders the owner approved,
 * and never remove or move one (R7.12).
 */
export const SCAN_FILE_FIELDS = [
  'rootId',
  'path',
  'size',
  'modifiedAt',
  'sha256',
  'mimeType',
] as const;

/**
 * What agents see of a file added to a project from a `details` or `contents` folder (R7.5).
 * Not its path, folder or notes; nothing at all from a `hidden` folder.
 */
export const AGENT_FILE_FIELDS = [
  'projectId',
  'title',
  'kind',
  'issuer',
  'issuedDate',
  'expiryDate',
  'tags',
  'size',
  'taskIds',
] as const;

/**
 * What an agent supplies to add a file (R7.12), the same as the owner's "Add files": a scanned
 * file of a folder it may see, by folder id and path; the scan fills in the rest. Issuer, dates
 * and links are set with updates (a `$ref` in the same apply works).
 */
export const AGENT_FILE_CREATE_FIELDS = [
  'projectId',
  'rootId',
  'path',
  'title',
  'kind',
  'tags',
] as const;

/** Types whose items link project files with `fileIds` (R7.12). */
export const FILE_LINK_TYPES = ['task', 'decision', 'goal', 'stage', 'claim'] as const;
export type FileLinkType = (typeof FILE_LINK_TYPES)[number];

// ------------------------------------------------------------------ routes (all under /api)

/**
 * Every file route and action. Paths carry ids only: a file id (`file_…`), a folder id
 * (`root_…`) or a project id, never a file path. All of them answer 127.0.0.1 only and check
 * `Origin` (R7.2). Contents go out with `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
 * sandbox` and a mime type from FILE_TYPES; downloads use the real file name
 * (`Content-Disposition: attachment; filename*=UTF-8''…`).
 */
export const FILE_ROUTES = {
  /** GET → FolderStatus[]; POST FolderCreateInput → FolderStatus (R7.3). */
  folders: '/api/settings/folders',
  /** PATCH FolderUpdateInput → FolderStatus; DELETE → { removed: id } (R7.3). */
  folder: '/api/settings/folders/:folderId',
  /** POST → ScanStatus: starts a scan in the background and returns at once (R7.2). */
  scan: '/api/settings/folders/:folderId/scan',
  /** GET ?q=&limit= → ScannedFile[] from the scan cache, for "Add files" (R7.2). */
  scanned: '/api/projects/:projectId/scanned-files',
  /** POST AddFilesInput → ApplyResult: one revision through Store.apply (R7.2). */
  add: '/api/projects/:projectId/files',
  /** GET → FileInfo (R7.2). */
  info: '/api/files/:fileId',
  /** GET → the contents, inline when the preview allows it (R7.2). */
  content: '/api/files/:fileId/content',
  /** GET → the contents as a download with the real file name (R7.2). */
  download: '/api/files/:fileId/download',
  /** POST → { ok: true } (R7.2): reveal in Finder, open in default app. */
  action: '/api/files/:fileId/actions/:action',
  /** GET → ArtifactFileMatch: where an artifact's local source is (R7.6). */
  artifactFile: '/api/artifacts/:artifactId/file',
  /** GET → MentionedFile[]: the project's local sources not in Pharos yet (R7.12). */
  mentioned: '/api/projects/:projectId/mentioned-files',
  /** GET → FolderRequest[] (R7.12): agents' folder requests, newest first. */
  folderRequests: '/api/settings/folder-requests',
  /** POST → FolderRequest (R7.12): the owner approves; adds the folder and starts a scan. */
  approveFolderRequest: '/api/settings/folder-requests/:requestId/approve',
  /** POST → FolderRequest (R7.12): the owner declines; that path stays declined. */
  declineFolderRequest: '/api/settings/folder-requests/:requestId/decline',
} as const;

/** URL of one file route, from ids only. */
export function fileUrl(
  route: 'info' | 'content' | 'download',
  fileId: string,
): `/api/files/${string}` {
  const base = `/api/files/${encodeURIComponent(fileId)}` as const;
  return route === 'info' ? base : `${base}/${route}`;
}

/**
 * Actions the server runs on the owner's Mac. Copy path needs no server call: it copies
 * `FileInfo.absolutePath`. `open` is refused unless `fileTypeOf(path).open`.
 */
export const FileAction = z.enum(['reveal', 'open']);
export type FileAction = z.infer<typeof FileAction>;

/** Why a file added to a project can't be reached now. Files are never deleted for it. */
export const FileMissing = z.enum([
  /** Its folder was removed in Settings. */
  'folder-removed',
  /** The folder is there but can't be read (unmounted disk, permissions). */
  'folder-unavailable',
  /** Not at its path any more, and no file with its hash was found. */
  'file-gone',
]);
export type FileMissing = z.infer<typeof FileMissing>;

/** `GET /api/files/:fileId` (R7.2), for the drawer. */
export type FileInfo = {
  id: string;
  available: boolean;
  missing: FileMissing | null;
  /** Found under a new path by its hash; the drawer offers to update the file record. */
  movedTo: string | null;
  folder: { id: string; label: string; level: FolderLevel } | null;
  type: FileType;
  /** For "Copy path"; null when unavailable. */
  absolutePath: string | null;
};

/** One entry of the scan cache (`GET …/scanned-files`, R7.2). Not project data. */
export type ScannedFile = {
  rootId: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType: string;
  /** File ids in this project already pointing at this entry. */
  addedAs: string[];
};

/** Progress of one folder's scan. */
export type ScanStatus = {
  rootId: string;
  scanning: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  files: number | null;
  error: string | null;
};

/**
 * `POST /api/projects/:projectId/files` (R7.2). Each entry must be in the scan cache (known
 * good, never a path the client made up); the server fills the scan fields and creates all the
 * file entities in one revision.
 */
export const AddFilesInput = z.strictObject({
  message: z.string().trim().min(1).optional().describe('Why; default "Add files"'),
  files: z
    .array(
      z.strictObject({
        rootId: FolderId,
        path: FilePath,
        title: z.string().min(1).optional().describe('Default: the file name without extension'),
        kind: z.string().min(1).optional().describe('A file.kind value; default the "other" one'),
        tags: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type AddFilesInput = z.infer<typeof AddFilesInput>;

/** A folder request as the owner's pages show it beside a source that needs it (R7.12). */
export type FolderRequestSummary = Pick<
  FolderRequest,
  'id' | 'path' | 'level' | 'reason' | 'status' | 'requestedBy'
>;

/**
 * `GET /api/artifacts/:artifactId/file` (R7.6, R7.12): where an artifact's local source is. A
 * `uri` may be absolute, or relative to a folder approved for its project (R7.12).
 */
export type ArtifactFileMatch =
  /** `artifact.fileId` is set (or was just matched by path, then hash). */
  | { state: 'linked'; fileId: string }
  /** Inside a folder but not added to the project yet; the drawer offers to add it. */
  | { state: 'in-folder'; rootId: string; path: string }
  /**
   * Not inside any Pharos folder. `path` is where it is (absolute) or the uri as written
   * (relative, when no folder is approved for the project); `folder` is the folder that would
   * need approving (an agent's request when one covers it, else the file's own folder); `request`
   * is that agent's request while it is pending.
   */
  | {
      state: 'not-in-folder';
      path: string;
      folder: string | null;
      request: FolderRequestSummary | null;
    }
  /** Its folder is in Pharos, but no file is at that path. */
  | { state: 'missing'; rootId: string; path: string }
  /** A file is there, but Pharos never reads it (a secret or backup name, a dotfile, a link out). */
  | { state: 'refused'; rootId: string; path: string }
  /** The artifact has no local path (none, or a web address). */
  | { state: 'none' };

/** A document the project mentions that isn't in Pharos yet, for the Files page (R7.12). */
export type MentionedFile = {
  artifactId: string;
  title: string;
  uri: string;
  match: Exclude<ArtifactFileMatch, { state: 'linked' } | { state: 'none' }>;
};

// ------------------------------------------------------------------ MCP (R7.5)

/**
 * The one MCP tool that reads a file's text: only files added to the project from a `contents`
 * folder, only text types, at most TEXT_PREVIEW_MAX_BYTES. It refuses everything else with
 * FILE_TEXT_REFUSAL. Folders are never visible over MCP.
 */
export const FILE_TEXT_TOOL = 'file_read_text';
export const FILE_TEXT_REFUSAL =
  "This file's folder doesn't allow agents to read contents. Its details are in project_snapshot; ask the owner to set the folder to Contents in Pharos Settings if you need the text.";
