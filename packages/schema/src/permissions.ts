import { z } from 'zod';

/**
 * Claude Code permissions helper (Settings → Agent permissions).
 *
 * Pharos reads Claude Code's session transcripts (`~/.claude/projects/<slug>/*.jsonl`, read-only)
 * and counts, per project folder, the tool calls that needed the owner's approval or were refused,
 * grouped into a rule in Claude Code's permission syntax (`Bash(git log:*)`, `mcp__pharos__apply`,
 * `Read(~/notes/**)`). The owner allows or denies a rule with one click; Pharos writes it into that
 * folder's `.claude/settings.local.json` (or the shared `.claude/settings.json`), keeping a backup
 * and offering Undo.
 *
 * Agents never write their own permissions: the routes answer only `X-Pharos-Author: human:…`
 * from the Pharos page, and no MCP tool reads or changes them. What the routes return is counts,
 * the suggested rule and up to three short example commands with secrets masked; never transcript
 * text beyond that.
 */

export const PERMISSION_ROUTES = {
  list: '/api/permissions',
  preview: '/api/permissions/preview',
  write: '/api/permissions/write',
  undo: '/api/permissions/undo',
  /** Live asks for the owner (GET), and their answers (POST /:id/preview, /:id/answer). */
  asks: '/api/permissions/asks',
  /** Where the Claude Code hook reports a permission prompt (POST) and waits (GET /:id/wait). */
  hook: '/api/permission-asks',
} as const;

/** How far back the counts go, and the shorter window behind "this week". */
export const PERMISSION_WINDOW_DAYS = 14;
export const PERMISSION_WEEK_DAYS = 7;

export const PermissionAction = z.enum(['allow', 'deny']);
export type PermissionAction = z.infer<typeof PermissionAction>;

/**
 * Which settings file a rule goes in: the folder's own (`local`, just the owner; `shared`, committed
 * with the repository), or the owner's `~/.claude/settings.json` (`user`, every project; only for
 * low-risk rules the page offers as "All my projects").
 */
export const PermissionTarget = z.enum(['local', 'shared', 'user']);
export type PermissionTarget = z.infer<typeof PermissionTarget>;
export type FolderTarget = Exclude<PermissionTarget, 'user'>;

export const PERMISSION_TARGETS: Record<FolderTarget, { file: string; label: string }> = {
  local: { file: '.claude/settings.local.json', label: 'Just me (settings.local.json)' },
  shared: { file: '.claude/settings.json', label: 'Everyone on the repo (settings.json)' },
};

/** One "How far" choice for a rule: the exact rule written, and where. */
export type PermissionScope = {
  id: string;
  kind: 'narrow' | 'folder' | 'wider' | 'user';
  rule: string;
  /** `local` (the folder's settings; the dialog can switch it to `shared`) or `user`. */
  target: 'local' | 'user';
  /** The choice, short ("Only `git commit -m …`", "As suggested", "All my projects"). */
  label: string;
  /** "Only in breathe" or "In all your projects". */
  where: string;
  /** What it lets agents do: "run `npx pnpm@12.9.1 test …`". */
  phrase: string;
};

/** Folders hidden from Agent permissions (an app setting: paths). */
export const PERMISSION_HIDDEN_SETTING = 'permissions.hiddenFolders';

/** What a settings file already says about a rule. */
export const PERMISSION_RISKS = ['low', 'medium', 'high'] as const;
export type PermissionRisk = (typeof PERMISSION_RISKS)[number];

export type PermissionStatus = 'allowed' | 'denied' | 'ask' | 'not_set';

/** Where a matching rule was found. */
export type PermissionSource = 'local' | 'shared' | 'user';

export type PermissionSuggestion = {
  /** The rule in Claude Code's syntax, e.g. `Bash(git log:*)`. */
  rule: string;
  tool: string;
  /** Calls in the window that needed approval or were refused, and those in the last week. */
  total: number;
  week: number;
  /** Approved by the owner at the prompt (once). */
  approved: number;
  /** Needed approval and nobody gave it: the owner said no, or no one could be asked. */
  denied: number;
  /** Stopped by Claude Code's auto mode classifier. */
  blocked: number;
  /** Stopped by a deny rule already in place. */
  ruleDenied: number;
  lastAt: string;
  /** Up to three short example commands or targets, at most 120 characters, secrets masked. */
  examples: string[];
  status: PermissionStatus;
  statusSource?: PermissionSource;
  /** The existing rule that decides it, when there is one. */
  matchedBy?: string;
  /** False for rules that would let an agent run anything (a shell, `rm`, `git push`): Deny only. */
  allowable: boolean;
  /** Why it can only be denied. */
  reason?: string;
  /** What it does, in plain words ("Runs the project’s tests"). */
  summary: string;
  risk: PermissionRisk;
  /** One line on why that risk. */
  riskWhy: string;
  /** Which routines or kinds of session asked ("/nightshift", "an interactive session"), most first. */
  origins: { label: string; count: number }[];
  /** "How far": narrower variants from the actual asks, this folder (the default), all projects. */
  scopes: PermissionScope[];
};

export type PermissionFile = { path: string; exists: boolean; error?: string };

export type PermissionFolder = {
  /** Stable for a path: what the write routes take instead of a path. */
  id: string;
  path: string;
  /** Shown with `~` for the home folder. */
  displayPath: string;
  label: string;
  /** Pharos projects whose repository is this folder. */
  projects: string[];
  sessions: number;
  total: number;
  week: number;
  /**
   * Calls refused for the command's shape (a variable, `cd` before `git`, a path outside the
   * session's folders) or by Claude Code's safety checks: no rule changes those.
   */
  unfixable: number;
  files: Record<FolderTarget, PermissionFile>;
  /** A Pharos repository has this path; otherwise it shows under "Not in Pharos". */
  inPharos: boolean;
  /** The repository's name, or the folder's own name. */
  name: string;
  suggestions: PermissionSuggestion[];
  /** Suggestions beyond those listed. */
  more: number;
};

export type PermissionWriteRecord = {
  id: string;
  at: string;
  folderId: string;
  path: string;
  rule: string;
  action: PermissionAction;
  /** The backup taken before the write; absent when the file didn't exist yet. */
  backup?: string;
  undone?: string;
  /** Whether Undo can still restore it (the file is as Pharos left it and the backup is there). */
  undoable?: boolean;
};

export type PermissionsOverview = {
  windowDays: number;
  scannedAt: string;
  /** Transcript files read (from cache or disk) for this answer. */
  transcripts: number;
  user: PermissionFile;
  folders: PermissionFolder[];
  /** Folders the owner hid (not in `folders`). */
  hidden: number;
  recent: PermissionWriteRecord[];
};

export type PermissionLists = { allow: string[]; deny: string[]; ask: string[] };

export const PermissionChangeInput = z.strictObject({
  folderId: z.string().min(1).max(64),
  /** The rule written: the suggestion's, or one of its "How far" scopes. */
  rule: z.string().min(1).max(400),
  /** The suggestion it came from, when `rule` is a narrower or wider scope of it. */
  base: z.string().min(1).max(400).optional(),
  action: PermissionAction,
  target: PermissionTarget.default('local'),
});
export type PermissionChangeInput = z.infer<typeof PermissionChangeInput>;

export type PermissionPreview = {
  folderId: string;
  path: string;
  exists: boolean;
  rule: string;
  action: PermissionAction;
  /** The lists the rule is added to and removed from. */
  addTo: 'allow' | 'deny';
  removeFrom: ('allow' | 'deny' | 'ask')[];
  before: PermissionLists;
  after: PermissionLists;
  /** Nothing would change: the rule is already there. */
  unchanged: boolean;
  /** Things worth knowing before writing, e.g. another file denies it and deny wins. */
  warnings: string[];
  /** Identifies the file as previewed; the write is refused if it changed since. */
  hash: string;
};

export const PermissionWriteInput = PermissionChangeInput.extend({
  hash: z.string().min(1).max(128),
});
export type PermissionWriteInput = z.infer<typeof PermissionWriteInput>;

export const PermissionUndoInput = z.strictObject({ id: z.string().min(1).max(64) });

export type PermissionWriteResult = { preview: PermissionPreview; record: PermissionWriteRecord };

// ---- Live asks (the PermissionRequest hook) ----

/**
 * What the Claude Code `PermissionRequest` hook (agents/claude/hooks/permission-ask.mjs) sends when
 * an agent is about to ask the owner: the hook's own stdin, as Claude Code gives it.
 */
export const PermissionAskInput = z.object({
  session_id: z.string().max(200).optional(),
  transcript_path: z.string().max(4096).optional(),
  cwd: z.string().min(1).max(4096),
  hook_event_name: z.string().max(100).optional(),
  permission_mode: z.string().max(100).optional(),
  tool_name: z.string().min(1).max(300),
  tool_input: z.unknown().optional(),
  /** How long the hook waits for an answer (seconds); the card goes when it stops waiting. */
  wait_seconds: z.number().min(0).max(110).optional(),
  /** PHAROS_ASK_WAIT was set: wait that long even in an unattended run. */
  wait_override: z.boolean().optional(),
  /** CLAUDE_CODE_ENTRYPOINT from the hook's environment, when Claude Code sets it (`cli`, `sdk-cli`). */
  entrypoint: z.string().max(100).optional(),
});
export type PermissionAskInput = z.infer<typeof PermissionAskInput>;

/**
 * `unattended`: asked in a run nobody watches (headless, the night/morning/wrap-up routines); the
 * hook didn't wait, Claude Code denied it there, and the card offers a rule for next time.
 */
export type PermissionAskStatus =
  | 'waiting'
  | 'unattended'
  | 'allowed_once'
  | 'allowed_always'
  | 'denied'
  | 'terminal'
  | 'expired'
  | 'dismissed';

/** The hook's answer: allow or deny this call, or nothing (Claude Code's own prompt shows). */
export type PermissionAskDecision = {
  status: PermissionAskStatus;
  behavior?: 'allow' | 'deny';
  message?: string;
};

export type PermissionAsk = {
  id: string;
  at: string;
  /** When the hook stops waiting and Claude Code asks in the terminal instead. */
  expiresAt: string;
  status: PermissionAskStatus;
  /** Asked in a run nobody watches: notify only, no waiting. */
  unattended: boolean;
  answeredAt?: string;
  folderId?: string;
  folder: string;
  displayFolder: string;
  projects: string[];
  projectId?: string;
  /** Which agent: the routine ("/nightshift"), "an interactive session", "a subagent", … */
  agent: string;
  tool: string;
  /** The command or target, one line, secrets masked. */
  example: string;
  rule: string;
  summary: string;
  risk: PermissionRisk;
  riskWhy: string;
  allowable: boolean;
  reason?: string;
  /** Whether "Allow always" can write a rule (a project folder, not the home folder). */
  canAlwaysAllow: boolean;
  /** "How far" for Allow always (empty when it can't be allowed always). */
  scopes: PermissionScope[];
  /** The write behind "Allow always", for Undo. */
  record?: PermissionWriteRecord;
};

export const PermissionAskAnswer = z.discriminatedUnion('answer', [
  z.strictObject({
    answer: z.literal('always'),
    /** One of the ask's scopes; the suggested rule when left out. */
    rule: z.string().min(1).max(400).optional(),
    target: PermissionTarget.default('local'),
    hash: z.string().min(1).max(128),
  }),
  z.strictObject({ answer: z.enum(['once', 'deny', 'terminal', 'dismiss']) }),
]);
export type PermissionAskAnswer = z.infer<typeof PermissionAskAnswer>;
