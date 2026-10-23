import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ruleFor, type Suggested } from './rules.js';

/**
 * Reading Claude Code session transcripts (`<claudeHome>/projects/<slug>/*.jsonl`, and subagents'
 * under `<slug>/<session>/subagents/`), read-only, for the tool calls that needed permission.
 *
 * The markers, from Claude Code's own files:
 * - A user entry carrying a `tool_result` has `permissionDecision` (newer versions):
 *   `{ decision: 'accept', source: 'config' }` ran without asking (a rule or the mode);
 *   `{ decision: 'accept', source: 'user_temporary' }` the owner approved it at the prompt;
 *   `{ decision: 'accept', source: 'user_permanent' }` without `reasonType: 'rule'` the owner said
 *   "don't ask again" (with it, a rule saved earlier allowed it: not an ask);
 *   `{ decision: 'reject', … }` with `toolDenialKind`: `user-rejected` (the owner said no, or a
 *   headless run had nobody to ask: "This command requires approval"), `permission-rule` (a deny
 *   rule, or a background agent that can't ask: `reasonType: 'asyncAgent'`), `automode-blocked`
 *   (auto mode's classifier). `reasonCode` says why a command wasn't matched: `bashMiss:no-rule-match`
 *   (a rule would fix it), `bashMiss:too-complex`, `bashMiss:cd-git-compound`, `bashMiss:multi-cd`,
 *   `bashMiss:shell-operators`, `workingDir` (outside the session's folders), `safetyCheck`.
 * - Older transcripts only have the error text of the `tool_result`: "This command requires
 *   approval", "The following part requires approval: …", "Permission to use X [with command …]
 *   has been denied", "The user doesn't want to proceed with this tool use", "Claude requested
 *   permissions to …, but you haven't granted it yet", "denied by the Claude Code auto mode
 *   classifier", "denied by a built-in Claude Code safety check".
 *
 * Only these entries and the matching `tool_use` inputs are kept; nothing else of the transcript.
 */

export type AskKind = 'approved' | 'denied' | 'blocked' | 'ruleDenied' | 'unfixable';

export type AskEvent = {
  at: number;
  kind: AskKind;
  /** Absent for `unfixable` ones. */
  suggested?: Suggested;
};

export type TranscriptSummary = {
  /** The folder the session started in (`cwd` of its first entry). */
  cwd?: string;
  sessionId?: string;
  /** Which agent: a routine (`/nightshift`), a headless run, an interactive session; a subagent's. */
  origin: string;
  events: AskEvent[];
};

/** Claude Code's own slash commands: not a routine. */
const BUILTIN_COMMANDS = new Set([
  'model',
  'clear',
  'plugin',
  'plugins',
  'mcp',
  'exit',
  'reload-plugins',
  'list-agents',
  'config',
  'compact',
  'resume',
  'login',
  'logout',
  'help',
  'cost',
  'status',
  'permissions',
  'memory',
  'init',
  'doctor',
  'agents',
  'hooks',
  'context',
  'rewind',
  'export',
  'usage',
  'theme',
  'vim',
]);
const COMMAND_NAME = /<command-name>\/?([\w:.-]+)<\/command-name>/;

/** Watches a transcript's lines for what kind of session it is. */
export class OriginReader {
  routine?: string;
  headless = false;
  constructor(private readonly subagent: boolean) {}
  /** Feed every line (cheap: only a substring check unless it can matter). */
  line(line: string): void {
    if (!this.headless && line.includes('"entrypoint":"sdk-')) this.headless = true;
    if (this.routine === undefined && line.includes('<command-name>')) {
      const name = COMMAND_NAME.exec(line)?.[1];
      if (name && !BUILTIN_COMMANDS.has(name)) this.routine = `/${name}`;
    }
  }
  get label(): string {
    const base =
      this.routine ?? (this.headless ? 'a headless run (claude -p)' : 'an interactive session');
    return this.subagent ? `a subagent` : base;
  }
}

export const isSubagentTranscript = (file: string) => /[/]subagents[/][^/]+\.jsonl$/.test(file);

/** The origin of a session from the start of its transcript (the hook's live asks). */
export async function readOrigin(file: string, maxLines = 400): Promise<string> {
  return (await readSession(file, maxLines)).label;
}

/** A session's kind from the start of its transcript: its label, routine and whether headless. */
export async function readSession(
  file: string,
  maxLines = 400,
): Promise<{ label: string; routine?: string; headless: boolean }> {
  const origin = new OriginReader(isSubagentTranscript(file));
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count > maxLines) break;
      if (line.length <= MAX_LINE) origin.line(line);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return {
    label: origin.label,
    headless: origin.headless,
    ...(origin.routine ? { routine: origin.routine } : {}),
  };
}

/** Lines longer than this are skipped unread (huge tool outputs); a file stops after MAX_LINES. */
const MAX_LINE = 2_000_000;
const MAX_LINES = 200_000;
/** Tool uses remembered while reading one file, to name what a refused result was about. */
const MAX_USES = 5_000;

const PART = /The following part requires approval:\s*([\s\S]*)$/;
const DENIED_WITH = /^Permission to use (\S+) with command ([\s\S]+?) has been denied/;
const UNFIXABLE_TEXT =
  /can't be checked before it runs|shell operators that require approval|Multiple directory changes|changes directory before running a version-control|built-in Claude Code safety check|was blocked\. For security, Claude Code may only/;
const UNFIXABLE_CODES = new Set([
  'bashMiss:too-complex',
  'bashMiss:cd-git-compound',
  'bashMiss:multi-cd',
  'bashMiss:shell-operators',
]);

type ToolUse = { name: string; input: unknown };

type Decision = {
  decision?: string;
  source?: string;
  reasonType?: string;
  reasonCode?: string;
};

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : ''))
      .join(' ');
  return '';
}

/** Classifies one tool result; undefined when it ran without asking or isn't about permission. */
function classify(
  decision: Decision | undefined,
  denialKind: string | undefined,
  text: string,
  isError: boolean,
): AskKind | undefined {
  if (decision?.decision === 'accept') {
    if (decision.source === 'user_temporary') return 'approved';
    if (decision.source === 'user_permanent' && decision.reasonType !== 'rule') return 'approved';
    return undefined;
  }
  if (decision?.decision === 'reject') {
    if (decision.reasonType === 'safetyCheck' || decision.reasonCode === 'safetyCheck')
      return 'unfixable';
    if (decision.reasonCode && UNFIXABLE_CODES.has(decision.reasonCode)) return 'unfixable';
    if (UNFIXABLE_TEXT.test(text)) return 'unfixable';
    if (denialKind === 'automode-blocked' || decision.reasonType === 'classifier') return 'blocked';
    if (denialKind === 'automode-unavailable') return 'unfixable';
    if (denialKind === 'permission-rule' && decision.reasonType !== 'asyncAgent')
      return 'ruleDenied';
    return 'denied';
  }
  if (!isError || decision) return undefined;
  // Older transcripts: the error text only.
  if (UNFIXABLE_TEXT.test(text)) return 'unfixable';
  if (/denied by the Claude Code auto mode classifier/.test(text)) return 'blocked';
  if (DENIED_WITH.test(text)) return 'ruleDenied';
  if (
    /^This command requires approval|requires approval:|has been denied|doesn't want to proceed with this tool use|but you haven't granted it yet/.test(
      text,
    )
  )
    return 'denied';
  return undefined;
}

/** Turns a slug's sessions into the worktree's repository: `/repo/.claude/worktrees/x` → `/repo`. */
export function projectFolder(cwd: string): string {
  const i = cwd.indexOf('/.claude/worktrees/');
  return i > 0 ? cwd.slice(0, i) : cwd.replace(/\/+$/, '') || '/';
}

/** Reads one transcript, line by line, keeping only permission events. */
export async function readTranscript(
  file: string,
  home: string,
  since: number,
): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = { events: [], origin: '' };
  const origin = new OriginReader(isSubagentTranscript(file));
  const uses = new Map<string, ToolUse>();
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count > MAX_LINES) break;
      if (line.length > MAX_LINE) continue;
      origin.line(line);
      // Cheap filters before parsing: the session's folder, tool uses and tool results.
      const wantCwd = summary.cwd === undefined && line.includes('"cwd"');
      const hasUse = line.includes('"tool_use"');
      const hasResult = line.includes('"tool_result"');
      if (!wantCwd && !hasUse && !hasResult) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (summary.cwd === undefined && typeof entry.cwd === 'string') {
        summary.cwd = entry.cwd;
        if (typeof entry.sessionId === 'string') summary.sessionId = entry.sessionId;
      }
      const message = entry.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? (message.content as unknown[]) : [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          if (uses.size >= MAX_USES) uses.delete(uses.keys().next().value!);
          uses.set(b.id, { name: b.name, input: b.input });
          continue;
        }
        if (b.type !== 'tool_result') continue;
        const at = Date.parse(String(entry.timestamp ?? ''));
        if (!Number.isFinite(at) || at < since) continue;
        const text = resultText(b.content);
        const kind = classify(
          entry.permissionDecision as Decision | undefined,
          typeof entry.toolDenialKind === 'string' ? entry.toolDenialKind : undefined,
          text,
          b.is_error === true,
        );
        if (!kind) continue;
        if (kind === 'unfixable') {
          summary.events.push({ at, kind });
          continue;
        }
        const use = typeof b.tool_use_id === 'string' ? uses.get(b.tool_use_id) : undefined;
        if (!use) continue;
        // The part of a compound command that needed approval, or the one a deny rule named.
        let input = use.input;
        if (use.name === 'Bash') {
          const part = PART.exec(text)?.[1] ?? DENIED_WITH.exec(text)?.[2];
          if (part) input = { command: part };
        }
        const suggested = ruleFor(use.name, input, home);
        if (suggested) summary.events.push({ at, kind, suggested });
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  summary.origin = origin.label;
  return summary;
}

export type TranscriptFile = { path: string; slug: string; mtimeMs: number; size: number };

/** Transcript files changed since `since`, newest first, at most `limit`. */
export function listTranscripts(claudeHome: string, since: number, limit = 600): TranscriptFile[] {
  const root = join(claudeHome, 'projects');
  const out: TranscriptFile[] = [];
  const add = (path: string, slug: string) => {
    try {
      const st = statSync(path);
      if (st.isFile() && st.mtimeMs >= since)
        out.push({ path, slug, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // gone meanwhile
    }
  };
  let slugs: string[];
  try {
    slugs = readdirSync(root);
  } catch {
    return [];
  }
  for (const slug of slugs) {
    const dir = join(root, slug);
    let names: string[];
    try {
      if (statSync(dir).mtimeMs < since && !hasRecent(dir, since)) continue;
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('.jsonl')) add(join(dir, name), slug);
      else if (!name.includes('.')) {
        // A session's folder: its subagents' transcripts.
        const sub = join(dir, name, 'subagents');
        let subs: string[];
        try {
          subs = readdirSync(sub);
        } catch {
          continue;
        }
        for (const s of subs) if (s.endsWith('.jsonl')) add(join(sub, s), slug);
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

/** A slug folder's own mtime only changes when files are added; appends don't touch it. */
function hasRecent(dir: string, since: number): boolean {
  try {
    return readdirSync(dir).some((n) => {
      try {
        return statSync(join(dir, n)).mtimeMs >= since;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Parsed transcripts by path, reused while the file's size and mtime stay the same. */
export class TranscriptCache {
  private entries = new Map<
    string,
    { mtimeMs: number; size: number; since: number; summary: TranscriptSummary }
  >();

  async get(file: TranscriptFile, home: string, since: number): Promise<TranscriptSummary> {
    const hit = this.entries.get(file.path);
    if (hit && hit.mtimeMs === file.mtimeMs && hit.size === file.size && hit.since <= since)
      return { ...hit.summary, events: hit.summary.events.filter((e) => e.at >= since) };
    const summary = await readTranscript(file.path, home, since);
    this.entries.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, since, summary });
    return summary;
  }

  /** Drops files no longer listed. */
  retain(paths: Set<string>): void {
    for (const key of this.entries.keys()) if (!paths.has(key)) this.entries.delete(key);
  }
}
