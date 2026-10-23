import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  PERMISSION_TARGETS,
  PERMISSION_WEEK_DAYS,
  PERMISSION_WINDOW_DAYS,
  type PermissionAction,
  type PermissionChangeInput,
  type PermissionFile,
  type PermissionFolder,
  type PermissionPreview,
  type PermissionSource,
  type PermissionStatus,
  type PermissionSuggestion,
  type PermissionTarget,
  type PermissionWriteInput,
  type PermissionWriteRecord,
  type PermissionWriteResult,
  type PermissionsOverview,
} from '@pharos/schema';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { covers, example, type Suggested } from './rules.js';
import {
  hashText,
  planChange,
  readSettings,
  restoreSettings,
  writeSettings,
  type SettingsRead,
} from './settings-files.js';
import {
  TranscriptCache,
  isSubagentTranscript,
  listTranscripts,
  projectFolder,
  readOrigin,
  type AskEvent,
} from './transcripts.js';
import { explain } from './explain.js';

/** What Pharos wrote, kept as an app setting (never a revision, never over MCP). */
export const PERMISSION_WRITES_SETTING = 'permissions.writes';
const WRITES_KEPT = 30;
/** Suggestions listed per folder; the rest are counted in `more`. */
const LISTED = 12;
const DAY = 24 * 60 * 60 * 1000;

type StoredWrite = PermissionWriteRecord & { afterHash: string };

/** A write as the page sees it: without the file hash Pharos keeps to check Undo. */
function shown(record: StoredWrite, undoable: boolean): PermissionWriteRecord {
  const out: PermissionWriteRecord & { afterHash?: string } = { ...record, undoable };
  delete out.afterHash;
  return out;
}

export type PermissionServiceOptions = {
  /** The owner's home folder (tests pass a temp dir; never the real one in tests). */
  home?: string;
  /** Claude Code's folder, `~/.claude` by default (`PHAROS_CLAUDE_HOME`). */
  claudeHome?: string;
  /** Sessions run in temp folders (evals, scratch) are left out unless a project uses the folder. */
  includeTemp?: boolean;
  now?: () => Date;
};

type Tally = {
  suggested: Suggested;
  total: number;
  week: number;
  approved: number;
  denied: number;
  blocked: number;
  ruleDenied: number;
  lastAt: number;
  examples: { at: number; text: string }[];
  origins: Map<string, number>;
};

type FolderTally = {
  path: string;
  sessions: Set<string>;
  unfixable: number;
  rules: Map<string, Tally>;
};

const TEMP_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];

export const folderId = (path: string) =>
  createHash('sha256').update(path).digest('hex').slice(0, 12);

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export class PermissionService {
  readonly home: string;
  readonly claudeHome: string;
  private readonly includeTemp: boolean;
  private readonly now: () => Date;
  private readonly cache = new TranscriptCache();
  private scanning?: Promise<{ folders: Map<string, FolderTally>; transcripts: number }>;

  constructor(
    private readonly store: Store,
    options: PermissionServiceOptions = {},
  ) {
    this.home = (options.home ?? homedir()).replace(/\/+$/, '');
    this.claudeHome = options.claudeHome ?? join(this.home, '.claude');
    this.includeTemp = options.includeTemp ?? false;
    this.now = options.now ?? (() => new Date());
  }

  private display(path: string): string {
    return path === this.home
      ? '~'
      : path.startsWith(`${this.home}/`)
        ? `~${path.slice(this.home.length)}`
        : path;
  }

  /** Temp folders (evals, scratch), unless the home folder itself is in one (a test server). */
  private isTemp(path: string): boolean {
    if (path.startsWith(`${this.home}/`)) return false;
    const tmp = tmpdir().replace(/\/+$/, '');
    return TEMP_ROOTS.some((r) => `${path}/`.startsWith(r)) || `${path}/`.startsWith(`${tmp}/`);
  }

  /** Pharos projects' folders (repository paths), with the projects in each. */
  private repositories(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const repos = this.store.list('repository');
    const projects = this.store.list('project');
    for (const repo of repos) {
      const raw = repo.data.path?.trim();
      if (!raw) continue;
      const path = this.absolute(raw);
      if (!path.startsWith('/')) continue;
      const names = projects.filter((p) => p.data.repositoryId === repo.id).map((p) => p.data.name);
      out.set(path, [...(out.get(path) ?? []), ...(names.length ? names : [repo.data.name])]);
    }
    return out;
  }

  /** Where a session works: its project folder, the Pharos projects there, and how it shows. */
  whereIs(cwd: string): {
    folder: string;
    display: string;
    projects: string[];
    projectId?: string;
    folderPath?: string;
    folderId?: string;
  } {
    const repos = this.repositories();
    const path = this.folderOf(cwd, repos);
    const shown = path ?? projectFolder(cwd);
    let projectId: string | undefined;
    if (path && repos.has(path)) {
      const repo = this.store
        .list('repository')
        .find((r) => r.data.path && this.absolute(r.data.path) === path);
      projectId = this.store.list('project').find((p) => p.data.repositoryId === repo?.id)?.id;
    }
    return {
      folder: shown,
      display: this.display(shown),
      projects: path ? (repos.get(path) ?? []) : [],
      ...(projectId ? { projectId } : {}),
      ...(path && isDir(path) ? { folderPath: path, folderId: folderId(path) } : {}),
    };
  }

  private absolute(raw: string): string {
    const t = raw.trim();
    return (t.startsWith('~/') ? join(this.home, t.slice(2)) : t).replace(/\/+$/, '');
  }

  /** One scan at a time; transcripts unchanged since the last one come from the cache. */
  private async scan(repos: Map<string, string[]>) {
    this.scanning ??= this.runScan(repos).finally(() => {
      this.scanning = undefined;
    });
    return this.scanning;
  }

  private async runScan(repos: Map<string, string[]>) {
    const now = this.now().getTime();
    const since = now - PERMISSION_WINDOW_DAYS * DAY;
    const week = now - PERMISSION_WEEK_DAYS * DAY;
    const files = listTranscripts(this.claudeHome, since);
    this.cache.retain(new Set(files.map((f) => f.path)));
    const folders = new Map<string, FolderTally>();
    const repoPaths = [...repos.keys()].sort((a, b) => b.length - a.length);
    const origins = new Map<string, string>();
    // Main transcripts first, so subagents find their parent's routine.
    files.sort(
      (a, b) => Number(isSubagentTranscript(a.path)) - Number(isSubagentTranscript(b.path)),
    );
    for (const file of files) {
      let summary;
      try {
        summary = await this.cache.get(file, this.home, since);
      } catch (error) {
        console.error('[pharos] Could not read a Claude Code transcript:', error);
        continue;
      }
      if (!summary.cwd || !summary.events.length) continue;
      const path = this.folderOf(summary.cwd, repos, repoPaths);
      if (!path) continue;
      // A subagent's routine is its parent session's (`<session>/subagents/x.jsonl` → `<session>.jsonl`).
      let origin = summary.origin;
      if (isSubagentTranscript(file.path)) {
        const parent = `${dirname(dirname(file.path))}.jsonl`;
        const parentOrigin = origins.get(parent) ?? (await this.parentOrigin(parent));
        origin = `a subagent of ${parentOrigin}`;
      } else origins.set(file.path, origin);
      let tally = folders.get(path);
      if (!tally) {
        tally = { path, sessions: new Set(), unfixable: 0, rules: new Map() };
        folders.set(path, tally);
      }
      tally.sessions.add(summary.sessionId ?? file.path);
      for (const event of summary.events) this.count(tally, event, week, origin);
    }
    return { folders, transcripts: files.length };
  }

  private async parentOrigin(file: string): Promise<string> {
    try {
      return await readOrigin(file);
    } catch {
      return 'a session';
    }
  }

  /**
   * The project folder for a session's working directory: a Pharos repository containing it, or
   * the folder itself (worktrees count as their repository). Undefined for temp folders (unless a
   * project uses them), the home folder, `/` and Claude Code's own folder.
   */
  private folderOf(
    cwdRaw: string,
    repos: Map<string, string[]>,
    repoPaths = [...repos.keys()].sort((a, b) => b.length - a.length),
  ): string | undefined {
    const cwd = projectFolder(cwdRaw);
    const path = repoPaths.find((r) => cwd === r || cwd.startsWith(`${r}/`)) ?? cwd;
    if (repos.has(path)) return path;
    if (!this.includeTemp && this.isTemp(path)) return undefined;
    if (path === this.home || path === '/' || `${path}/`.startsWith(`${this.claudeHome}/`))
      return undefined;
    return path;
  }

  private count(tally: FolderTally, event: AskEvent, week: number, origin: string) {
    if (event.kind === 'unfixable' || !event.suggested) {
      tally.unfixable++;
      return;
    }
    const s = event.suggested;
    let t = tally.rules.get(s.rule);
    if (!t) {
      t = {
        suggested: s,
        total: 0,
        week: 0,
        approved: 0,
        denied: 0,
        blocked: 0,
        ruleDenied: 0,
        lastAt: 0,
        examples: [],
        origins: new Map(),
      };
      tally.rules.set(s.rule, t);
    }
    t.total++;
    t.origins.set(origin, (t.origins.get(origin) ?? 0) + 1);
    if (event.at >= week) t.week++;
    t[event.kind]++;
    if (event.at > t.lastAt) {
      t.lastAt = event.at;
      t.suggested = s;
    }
    const text = example(s.subject, this.home);
    if (s.subject !== s.tool && !t.examples.some((e) => e.text === text)) {
      t.examples.push({ at: event.at, text });
      t.examples.sort((a, b) => b.at - a.at);
      t.examples.length = Math.min(t.examples.length, 3);
    }
  }

  private files(path: string): Record<PermissionTarget, SettingsRead> {
    return {
      local: readSettings(join(path, PERMISSION_TARGETS.local.file)),
      shared: readSettings(join(path, PERMISSION_TARGETS.shared.file)),
    };
  }

  private userSettings(): SettingsRead {
    return readSettings(join(this.claudeHome, 'settings.json'));
  }

  /** Deny wins over ask, ask over allow; the folder's own files are checked before the user's. */
  private status(
    s: Suggested,
    folder: string,
    sources: [PermissionSource, SettingsRead][],
  ): { status: PermissionStatus; statusSource?: PermissionSource; matchedBy?: string } {
    const where = { home: this.home, folder };
    for (const [list, status] of [
      ['deny', 'denied'],
      ['ask', 'ask'],
      ['allow', 'allowed'],
    ] as const)
      for (const [source, read] of sources) {
        const hit = read.lists[list].find((rule) => covers(rule, s, where));
        if (hit) return { status, statusSource: source, matchedBy: hit };
      }
    return { status: 'not_set' };
  }

  private suggestion(
    t: Tally,
    folder: string,
    sources: [PermissionSource, SettingsRead][],
  ): PermissionSuggestion {
    const s = t.suggested;
    return {
      rule: s.rule,
      tool: s.tool,
      total: t.total,
      week: t.week,
      approved: t.approved,
      denied: t.denied,
      blocked: t.blocked,
      ruleDenied: t.ruleDenied,
      lastAt: new Date(t.lastAt).toISOString(),
      examples: t.examples.map((e) => e.text),
      ...this.status(s, folder, sources),
      allowable: s.allowable,
      ...(s.reason ? { reason: s.reason } : {}),
      ...explain(s),
      origins: [...t.origins]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    };
  }

  private fileOf(read: SettingsRead): PermissionFile {
    return { path: read.path, exists: read.exists, ...(read.error ? { error: read.error } : {}) };
  }

  /** Every folder with its suggestions, all of them (the overview lists the top ones). */
  private async folders(): Promise<{
    folders: (PermissionFolder & { all: PermissionSuggestion[] })[];
    transcripts: number;
    user: SettingsRead;
  }> {
    const repos = this.repositories();
    const { folders: tallies, transcripts } = await this.scan(repos);
    const user = this.userSettings();
    const paths = new Set([...repos.keys(), ...tallies.keys()]);
    const out: (PermissionFolder & { all: PermissionSuggestion[] })[] = [];
    for (const path of paths) {
      if (!isDir(path)) continue;
      const tally = tallies.get(path);
      const files = this.files(path);
      const sources: [PermissionSource, SettingsRead][] = [
        ['local', files.local],
        ['shared', files.shared],
        ['user', user],
      ];
      const all = [...(tally?.rules.values() ?? [])]
        .sort((a, b) => b.total - a.total || b.lastAt - a.lastAt)
        .map((t) => this.suggestion(t, path, sources));
      const projects = repos.get(path) ?? [];
      out.push({
        id: folderId(path),
        path,
        displayPath: this.display(path),
        label: basename(path) || path,
        projects,
        sessions: tally?.sessions.size ?? 0,
        total: all.reduce((n, s) => n + s.total, 0),
        week: all.reduce((n, s) => n + s.week, 0),
        unfixable: tally?.unfixable ?? 0,
        files: { local: this.fileOf(files.local), shared: this.fileOf(files.shared) },
        suggestions: all.slice(0, LISTED),
        more: Math.max(0, all.length - LISTED),
        all,
      });
    }
    out.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    return { folders: out, transcripts, user };
  }

  /** Reads the transcripts once in the background, so the Settings page is fast the first time. */
  warm(): void {
    this.overview().catch((error: unknown) =>
      console.error('[pharos] Could not read Claude Code transcripts:', error),
    );
  }

  async overview(): Promise<PermissionsOverview> {
    const { folders, transcripts, user } = await this.folders();
    return {
      windowDays: PERMISSION_WINDOW_DAYS,
      scannedAt: this.now().toISOString(),
      transcripts,
      user: this.fileOf(user),
      folders: folders.map((f) => {
        const listed: PermissionFolder & { all?: unknown } = { ...f };
        delete listed.all;
        return listed;
      }),
      recent: this.recent(),
    };
  }

  private writes(): StoredWrite[] {
    return this.store.setting<StoredWrite[]>(PERMISSION_WRITES_SETTING) ?? [];
  }

  private recent(): PermissionWriteRecord[] {
    return this.writes()
      .slice(-10)
      .reverse()
      .map((w) =>
        shown(
          w,
          !w.undone &&
            readSettings(w.path).hash === w.afterHash &&
            (w.backup === undefined || existsSync(w.backup)),
        ),
      );
  }

  /** The exact change a click would make, for the confirm dialog. */
  async preview(input: PermissionChangeInput): Promise<PermissionPreview> {
    const { folders, user } = await this.folders();
    const folder = folders.find((f) => f.id === input.folderId);
    if (!folder) throw new PharosError('not_found', 'That folder isn’t in the list any more');
    const suggestion = folder.all.find((s) => s.rule === input.rule);
    if (!suggestion)
      throw new PharosError('invalid', 'Pharos only writes rules it suggested for this folder');
    return this.previewAt({ ...input, folder: folder.path, ...suggestion }, user);
  }

  /** The change for a rule in a folder (from a suggestion, or a live ask's rule). */
  previewAt(
    input: PermissionChangeInput & {
      folder: string;
      tool: string;
      allowable: boolean;
      reason?: string;
    },
    user = this.userSettings(),
  ): PermissionPreview {
    if (input.action === 'allow' && !input.allowable)
      throw new PharosError('invalid', input.reason ?? 'This rule can only be denied');
    const path = join(input.folder, PERMISSION_TARGETS[input.target].file);
    const read = readSettings(path);
    if (read.error)
      throw new PharosError('invalid', `${read.error}: ${path}. Fix it by hand first.`);
    const plan = planChange(read, input.rule, input.action);
    return {
      folderId: folderId(input.folder),
      path,
      exists: read.exists,
      rule: input.rule,
      action: input.action,
      addTo: plan.addTo,
      removeFrom: plan.removeFrom,
      before: read.lists,
      after: plan.after,
      unchanged: plan.unchanged,
      warnings: this.warnings(input, input.folder, user, input),
      hash: read.hash,
    };
  }

  private warnings(
    input: PermissionChangeInput,
    folder: string,
    user: SettingsRead,
    suggestion: { tool: string; allowable: boolean },
  ): string[] {
    const out: string[] = [];
    const where = { home: this.home, folder };
    const s: Suggested = {
      rule: input.rule,
      tool: suggestion.tool,
      subject: input.rule,
      allowable: suggestion.allowable,
    };
    const others: [string, SettingsRead][] = [
      ...(['local', 'shared'] as const)
        .filter((t) => t !== input.target)
        .map((t): [string, SettingsRead] => [
          PERMISSION_TARGETS[t].file,
          readSettings(join(folder, PERMISSION_TARGETS[t].file)),
        ]),
      ['~/.claude/settings.json', user],
    ];
    for (const [name, read] of others) {
      if (input.action === 'allow') {
        const deny = read.lists.deny.find((r) => covers(r, s, where));
        if (deny) out.push(`${name} denies it (${deny}), and a deny anywhere wins.`);
        const ask = read.lists.ask.find((r) => covers(r, s, where));
        if (ask) out.push(`${name} says to ask (${ask}), which comes before allow.`);
      } else {
        const allow = read.lists.allow.find((r) => covers(r, s, where));
        if (allow) out.push(`${name} allows it (${allow}); this deny wins over that.`);
      }
    }
    if (input.target === 'shared')
      out.push('settings.json is shared: it’s committed with the repository unless it’s ignored.');
    return out;
  }

  async write(input: PermissionWriteInput): Promise<PermissionWriteResult> {
    return this.commit(await this.preview(input), input.hash);
  }

  /** Writes a previewed change if the file is still as previewed: backup first, then the file. */
  commit(preview: PermissionPreview, hash: string): PermissionWriteResult {
    const input = preview;
    if (preview.hash !== hash)
      throw new PharosError(
        'conflict',
        'The file changed since you looked at it. Check the change again.',
      );
    if (preview.unchanged) throw new PharosError('invalid', 'The rule is already there');
    const read = readSettings(preview.path);
    const plan = planChange(read, input.rule, input.action as PermissionAction);
    const { backup } = writeSettings(preview.path, plan.text, this.now());
    const record: StoredWrite = {
      id: randomUUID(),
      at: this.now().toISOString(),
      folderId: preview.folderId,
      path: preview.path,
      rule: input.rule,
      action: input.action,
      ...(backup ? { backup } : {}),
      afterHash: hashText(plan.text),
    };
    this.store.setSetting(
      PERMISSION_WRITES_SETTING,
      [...this.writes(), record].slice(-WRITES_KEPT),
    );
    return { preview, record: shown(record, true) };
  }

  /** Puts the file back as it was before that write, if nothing changed it since. */
  undo(id: string): PermissionWriteRecord {
    const writes = this.writes();
    const record = writes.find((w) => w.id === id);
    if (!record) throw new PharosError('not_found', 'Pharos has no record of that change');
    if (record.undone) throw new PharosError('invalid', 'That change was already undone');
    if (readSettings(record.path).hash !== record.afterHash)
      throw new PharosError(
        'conflict',
        `The file changed after Pharos wrote it, so Undo would lose that.${record.backup ? ` The copy from before is ${record.backup}.` : ''}`,
      );
    if (record.backup !== undefined && !existsSync(record.backup))
      throw new PharosError('conflict', 'The backup from before that change is gone');
    restoreSettings(record.path, record.backup);
    record.undone = this.now().toISOString();
    this.store.setSetting(PERMISSION_WRITES_SETTING, writes);
    return shown(record, false);
  }
}
