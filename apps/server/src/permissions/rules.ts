import { dirname } from 'node:path';

/**
 * Turning a tool call into a Claude Code permission rule, and checking existing rules against it.
 *
 * Rules use Claude Code's syntax: a tool name (`WebSearch`, `mcp__pharos__apply`), `Bash(<prefix>:*)`
 * for a command prefix, `Read(<path glob>)` / `Edit(<path glob>)` with `~/…` for the home folder and
 * `//…` for other absolute paths, `WebFetch(domain:<host>)`.
 *
 * A suggestion covers a command prefix, never a whole shell. Rules that would let an agent run
 * anything (a shell or interpreter without a script, `sudo`, `xargs`, `find`), delete or rewrite
 * history (`rm`, `git push`, `git reset`), reach other computers (`curl`, `ssh`) or change its own
 * permissions (`Edit(…/.claude/**)`) are offered as Deny only.
 */

export type Suggested = {
  rule: string;
  tool: string;
  /** The command or target the rule was made from (before masking), for examples and matching. */
  subject: string;
  allowable: boolean;
  reason?: string;
};

const RUNS_ANYTHING = 'Runs any command, so it can only be denied';
const RUNS_CODE = 'Runs any code, so it can only be denied';

/** Commands that run whatever follows them. */
const SHELLS = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'csh',
  'tcsh',
  'eval',
  'exec',
  'source',
  '.',
  'sudo',
  'su',
  'doas',
  'xargs',
  'env',
  'nohup',
  'time',
  'timeout',
  'watch',
  'nice',
  'command',
  'builtin',
  'parallel',
  'script',
  'osascript',
]);

/** Shell syntax rather than a command: a rule on it would allow whatever the loop runs. */
const SHELL_SYNTAX = new Set([
  'for',
  'while',
  'until',
  'if',
  'case',
  'select',
  'function',
  'do',
  'then',
  '[',
  '[[',
  '!',
]);

/** Interpreters: allowable only with a script file (`python3 scripts/x.py`), never with `-c`. */
const INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'php',
  'deno',
  'bun',
  'tsx',
  'ts-node',
  'lua',
  'Rscript',
]);
const SCRIPT_FILE = /\.(py|js|mjs|cjs|ts|mts|rb|pl|php|lua|r|sh)$/i;
/** Interpreter flags that run code given inline or on stdin. */
const INLINE_CODE = new Set([
  '-c',
  '-e',
  '-p',
  '--eval',
  '--print',
  '-',
  '-m',
  '-r',
  'eval',
  'repl',
]);

/** Never Allow, by command prefix (the first words). */
const DENY_ONLY: { prefix: string[]; reason: string }[] = [
  { prefix: ['rm'], reason: 'Deletes files, so it can only be denied' },
  { prefix: ['rmdir'], reason: 'Deletes folders, so it can only be denied' },
  { prefix: ['dd'], reason: 'Writes raw disks, so it can only be denied' },
  { prefix: ['mkfs'], reason: 'Formats disks, so it can only be denied' },
  { prefix: ['chmod'], reason: 'Changes file permissions, so it can only be denied' },
  { prefix: ['chown'], reason: 'Changes file owners, so it can only be denied' },
  { prefix: ['kill'], reason: 'Stops processes, so it can only be denied' },
  { prefix: ['pkill'], reason: 'Stops processes by name, so it can only be denied' },
  { prefix: ['killall'], reason: 'Stops processes by name, so it can only be denied' },
  { prefix: ['shutdown'], reason: 'Turns the computer off, so it can only be denied' },
  { prefix: ['reboot'], reason: 'Restarts the computer, so it can only be denied' },
  { prefix: ['launchctl'], reason: 'Changes background services, so it can only be denied' },
  { prefix: ['crontab'], reason: 'Changes scheduled jobs, so it can only be denied' },
  {
    prefix: ['find'],
    reason: 'Can run other commands (-exec) or delete, so it can only be denied',
  },
  { prefix: ['curl'], reason: 'Can send data to other computers, so it can only be denied' },
  { prefix: ['wget'], reason: 'Can send data to other computers, so it can only be denied' },
  { prefix: ['ssh'], reason: 'Runs commands on another computer, so it can only be denied' },
  { prefix: ['scp'], reason: 'Copies files to other computers, so it can only be denied' },
  { prefix: ['rsync'], reason: 'Copies files to other computers, so it can only be denied' },
  { prefix: ['sqlite3'], reason: 'Can run shell commands (.shell), so it can only be denied' },
  { prefix: ['nc'], reason: 'Opens network connections, so it can only be denied' },
  { prefix: ['git', 'push'], reason: 'Publishes to a shared remote, so it can only be denied' },
  { prefix: ['git', 'reset'], reason: 'Can throw away work, so it can only be denied' },
  { prefix: ['git', 'clean'], reason: 'Deletes untracked files, so it can only be denied' },
  { prefix: ['git', 'filter-branch'], reason: 'Rewrites history, so it can only be denied' },
  {
    prefix: ['git', '-c'],
    reason: 'Can run any program through git config, so it can only be denied',
  },
  { prefix: ['gh', 'api'], reason: 'Can change anything on GitHub, so it can only be denied' },
  { prefix: ['gh', 'repo'], reason: 'Can create or delete repositories, so it can only be denied' },
  { prefix: ['npm', 'publish'], reason: 'Publishes a package, so it can only be denied' },
  { prefix: ['pnpm', 'publish'], reason: 'Publishes a package, so it can only be denied' },
  { prefix: ['yarn', 'publish'], reason: 'Publishes a package, so it can only be denied' },
  { prefix: ['npm', 'exec'], reason: RUNS_ANYTHING },
  { prefix: ['pnpm', 'exec'], reason: RUNS_ANYTHING },
  { prefix: ['pnpm', 'dlx'], reason: RUNS_ANYTHING },
  { prefix: ['yarn', 'dlx'], reason: RUNS_ANYTHING },
  { prefix: ['npx'], reason: RUNS_ANYTHING },
  { prefix: ['bunx'], reason: RUNS_ANYTHING },
  { prefix: ['uvx'], reason: RUNS_ANYTHING },
];

/** Tools whose first word is followed by a subcommand that belongs in the rule. */
const SUBCOMMANDS = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'gh',
  'docker',
  'cargo',
  'go',
  'kubectl',
  'brew',
  'pip',
  'pip3',
  'uv',
  'poetry',
  'make',
  'swift',
  'xcodebuild',
  'turbo',
  'vitest',
  'tsc',
  'eslint',
  'prettier',
  'wrangler',
  'flyctl',
  'vercel',
]);
/** Runners whose next word is a package to run (`npx tsc`, `npx pnpm@12 test`). */
const RUNNERS = new Set(['npx', 'bunx', 'uvx']);
const PACKAGE_MANAGERS = /^(pnpm|npm|yarn|bun)(@[\w.-]+)?$/;
/** Flags that take the next word as their value. */
const VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--filter',
  '-F',
  '--dir',
  '--prefix',
  '--cwd',
  '--workspace',
]);

/** Read-only fillers that rarely are what needed approval in a compound command. */
const FILLERS = new Set([
  'cd',
  'echo',
  'printf',
  'true',
  'false',
  ':',
  'head',
  'tail',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'pwd',
]);

/** Splits a command line on `&&`, `||`, `;`, `|` and newlines outside quotes. */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) current += command[++i];
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[++i];
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }
    if (
      ch === ';' ||
      ch === '|' ||
      ch === '\n' ||
      (ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '>')
    ) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Words of one simple command, quotes kept off. Stops at a redirection. */
export function words(segment: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) out.push(current);
      current = '';
      has = false;
      continue;
    }
    if ((ch === '>' || ch === '<') && !has) break;
    current += ch;
    has = true;
  }
  if (has) out.push(current);
  return out;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The words that decide a Bash rule, after env assignments. */
function commandWords(segment: string): string[] {
  const all = words(segment);
  let i = 0;
  while (i < all.length && ENV_ASSIGNMENT.test(all[i]!)) i++;
  return all.slice(i);
}

/** Picks the part of a compound command that most likely needed approval. */
export function mainSegment(command: string): string {
  const segments = splitCommand(command);
  const real = segments.find((s) => {
    const first = commandWords(s)[0];
    return first !== undefined && !FILLERS.has(first);
  });
  return real ?? segments[0] ?? command.trim();
}

function denyOnly(ws: string[]): string | undefined {
  for (const { prefix, reason } of DENY_ONLY)
    if (prefix.every((p, i) => ws[i] === p || (i === 0 && ws[0]?.split('/').pop() === p)))
      return reason;
  return undefined;
}

const looksLikeWord = (w: string) => /^[\w@.:/=+-]+$/.test(w) && !/^\d+$/.test(w);
const isPath = (w: string) => w.includes('/') || SCRIPT_FILE.test(w);

/** The prefix words of a Bash rule for one simple command. */
function prefixWords(ws: string[]): string[] {
  const base = ws[0]!;
  if (RUNNERS.has(base)) {
    // `npx tsc --noEmit` → `npx tsc`; `npx pnpm@12.9.1 --filter x test` → through `test`.
    const out = [base];
    let i = 1;
    while (i < ws.length && ws[i]!.startsWith('-')) i++;
    if (i >= ws.length) return out;
    out.push(...ws.slice(1, i + 1));
    if (PACKAGE_MANAGERS.test(ws[i]!)) return [...out, ...subcommand(ws, i + 1)];
    return out;
  }
  if (PACKAGE_MANAGERS.test(base) || SUBCOMMANDS.has(base)) return [base, ...subcommand(ws, 1)];
  return [base];
}

/** Flags (with their values) up to and including the first plain word; none if there isn't one. */
function subcommand(ws: string[], from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < ws.length && out.length < 6; i++) {
    const w = ws[i]!;
    if (w.startsWith('-')) {
      out.push(w);
      if (VALUE_FLAGS.has(w) && i + 1 < ws.length) out.push(ws[++i]!);
      continue;
    }
    if (looksLikeWord(w) && !/^[/~.]/.test(w)) return [...out, w];
    return [];
  }
  return [];
}

/** A Bash rule for a command (the whole command line, or the part that needed approval). */
export function bashRule(command: string): Suggested {
  const segment = mainSegment(command);
  const ws = commandWords(segment);
  const subject = segment;
  if (!ws.length)
    return { rule: 'Bash', tool: 'Bash', subject, allowable: false, reason: RUNS_ANYTHING };
  const base = ws[0]!.split('/').pop()!;
  if (SHELLS.has(base) || SHELL_SYNTAX.has(base) || /^[$`({]/.test(ws[0]!))
    return {
      rule: `Bash(${ws[0]}:*)`,
      tool: 'Bash',
      subject,
      allowable: false,
      reason: RUNS_ANYTHING,
    };
  if (INTERPRETERS.has(base)) {
    // `python3 -I scripts/check.py --x` → `python3 -I scripts/check.py`; `python3 -c …` → deny only.
    let i = 1;
    while (i < ws.length && ws[i]!.startsWith('-') && !INLINE_CODE.has(ws[i]!)) i++;
    const next = ws[i];
    if (next !== undefined && !INLINE_CODE.has(next) && isPath(next) && looksLikeWord(next))
      return {
        rule: `Bash(${ws.slice(0, i + 1).join(' ')}:*)`,
        tool: 'Bash',
        subject,
        allowable: true,
      };
    return { rule: `Bash(${ws[0]}:*)`, tool: 'Bash', subject, allowable: false, reason: RUNS_CODE };
  }
  const prefix = prefixWords(ws);
  const rule = `Bash(${prefix.join(' ')}:*)`;
  const last = prefix.length > 1 ? prefix[prefix.length - 1]! : undefined;
  const sub = last !== undefined && !last.startsWith('-') ? last : undefined;
  // What the rule runs: `npx pnpm@12 test` is judged as `pnpm test`, `git -C x push` as `git push`.
  const runner = RUNNERS.has(base);
  const manager = runner && prefix[1] !== undefined && PACKAGE_MANAGERS.test(prefix[1]);
  const tool = manager ? prefix[1]!.replace(/(.)@.*/, '$1') : base;
  let reason: string | undefined;
  if (runner && prefix.length === 1) reason = RUNS_ANYTHING;
  else if (!runner || manager) {
    const own = manager ? prefix.slice(2) : prefix.slice(1);
    const judged = [tool, ...(sub !== undefined && own.includes(sub) ? [sub] : [])];
    reason = denyOnly(judged);
    if (!reason && tool === 'git' && prefix.includes('-c'))
      reason = 'Can run any program through git config, so it can only be denied';
    // A package manager or git with no subcommand (`pnpm --filter x`) could run anything.
    const managerLike = PACKAGE_MANAGERS.test(tool) || tool === 'git';
    if (!reason && managerLike && judged.length === 1 && ws.length > (manager ? 2 : 1))
      reason = RUNS_ANYTHING;
  }
  return reason
    ? { rule, tool: 'Bash', subject, allowable: false, reason }
    : { rule, tool: 'Bash', subject, allowable: true };
}

/** `~/…` for paths in the home folder, `//…` for other absolute paths (Claude Code's syntax). */
export function rulePath(path: string, home: string): string {
  const h = home.replace(/\/+$/, '');
  if (path === h) return '~';
  if (path.startsWith(`${h}/`)) return `~/${path.slice(h.length + 1)}`;
  if (path.startsWith('/')) return `/${path}`;
  return path;
}

/** Paths an agent must never be allowed to change on its own (its permissions, keys, git hooks). */
const PROTECTED_PATH = /(^|\/)(\.claude|\.ssh|\.gnupg|\.aws|\.git|\.config|\.env[^/]*)(\/|$)/;

/** A Read or Edit rule for a file: its folder and everything under it. */
export function pathRule(tool: 'Read' | 'Edit', file: string, home: string): Suggested {
  const dir = file.endsWith('/') ? file.replace(/\/+$/, '') : dirname(file);
  const rule = `${tool}(${rulePath(dir, home)}/**)`;
  const subject = file;
  const h = home.replace(/\/+$/, '');
  if (dir === '/' || dir === h || dir === '' || dir === '.' || h.startsWith(`${dir}/`))
    return {
      rule,
      tool,
      subject,
      allowable: false,
      reason: 'Covers too much of the disk, so it can only be denied',
    };
  if (tool === 'Edit' && PROTECTED_PATH.test(dir))
    return {
      rule,
      tool,
      subject,
      allowable: false,
      reason:
        'Holds settings, keys or git hooks an agent must not change, so it can only be denied',
    };
  return { rule, tool, subject, allowable: true };
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);

/** The rule for one tool call, or undefined for tools that aren't about permissions. */
export function ruleFor(tool: string, input: unknown, home: string): Suggested | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode' || tool === 'TodoWrite')
    return undefined;
  if (tool === 'Bash') {
    const command = str('command');
    return command ? bashRule(command) : undefined;
  }
  if (EDIT_TOOLS.has(tool)) {
    const file = str('file_path') ?? str('notebook_path');
    return file
      ? pathRule('Edit', file, home)
      : {
          rule: 'Edit',
          tool: 'Edit',
          subject: tool,
          allowable: false,
          reason: 'Covers every file, so it can only be denied',
        };
  }
  if (READ_TOOLS.has(tool)) {
    const file = str('file_path') ?? str('path');
    if (file && file.startsWith('/'))
      return pathRule('Read', tool === 'Read' ? file : `${file}/`, home);
    return { rule: tool, tool, subject: str('pattern') ?? tool, allowable: true };
  }
  if (tool === 'WebFetch') {
    const url = str('url');
    try {
      const host = url ? new URL(url).hostname : undefined;
      if (host) return { rule: `WebFetch(domain:${host})`, tool, subject: url!, allowable: true };
    } catch {
      // fall through
    }
    return { rule: 'WebFetch', tool, subject: url ?? tool, allowable: true };
  }
  if (tool.startsWith('mcp__')) return { rule: tool, tool, subject: tool, allowable: true };
  return { rule: tool, tool, subject: tool, allowable: true };
}

// ---- Matching existing rules ----

type ParsedRule = { tool: string; content?: string };

export function parseRule(rule: string): ParsedRule {
  const m = /^([^()]+)\((.*)\)$/s.exec(rule.trim());
  return m ? { tool: m[1]!.trim(), content: m[2]! } : { tool: rule.trim() };
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function globRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (ch === '*') out += '[^/]*';
    else out += escape(ch);
  }
  return new RegExp(`^${out}$`);
}

/** A path rule's pattern as an absolute glob. */
function absolutePattern(pattern: string, home: string, folder: string): string {
  if (pattern.startsWith('//')) return pattern.slice(1);
  if (pattern === '~' || pattern.startsWith('~/'))
    return home.replace(/\/+$/, '') + pattern.slice(1);
  if (pattern.startsWith('/')) return folder.replace(/\/+$/, '') + pattern;
  return `${folder.replace(/\/+$/, '')}/**/${pattern.replace(/^\.\//, '')}`;
}

const TOOL_GROUP: Record<string, string> = {
  Write: 'Edit',
  MultiEdit: 'Edit',
  NotebookEdit: 'Edit',
  Glob: 'Read',
  Grep: 'Read',
  LS: 'Read',
};
const group = (tool: string) => TOOL_GROUP[tool] ?? tool;

/** A Bash rule's content matches a command (or a rule's prefix taken as a command). */
function bashMatches(content: string, command: string): boolean {
  const cmd = command.trim();
  if (content.endsWith(':*')) {
    const prefix = content.slice(0, -2).trim();
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  if (content.includes('*')) {
    const re = new RegExp(`^${content.split('*').map(escape).join('.*')}$`, 's');
    return re.test(cmd) || re.test(`${cmd} x`);
  }
  return cmd === content.trim();
}

/**
 * Whether an existing rule decides a suggestion: the same tool and a pattern covering the
 * suggested one (`Bash(git:*)` covers `Bash(git log:*)`, `mcp__pharos` covers `mcp__pharos__apply`,
 * `Read(~/notes/**)` covers `Read(~/notes/a/**)`).
 */
export function covers(
  existing: string,
  suggestion: Suggested,
  where: { home: string; folder: string },
): boolean {
  if (existing.trim() === suggestion.rule) return true;
  const have = parseRule(existing);
  const want = parseRule(suggestion.rule);
  if (want.tool.startsWith('mcp__')) {
    if (have.content !== undefined) return false;
    const t = have.tool.replace(/__\*$/, '');
    return want.tool === t || want.tool.startsWith(`${t}__`);
  }
  if (group(have.tool) !== group(want.tool)) return false;
  if (have.content === undefined || have.content === '*' || have.content === '**') return true;
  if (want.content === undefined) return false;
  if (want.tool === 'Bash') {
    const prefix = want.content.endsWith(':*') ? want.content.slice(0, -2) : want.content;
    return bashMatches(have.content, prefix) || bashMatches(have.content, suggestion.subject);
  }
  if (want.tool === 'WebFetch') return have.content === want.content;
  if (want.tool === 'Read' || want.tool === 'Edit') {
    const wanted = absolutePattern(want.content, where.home, where.folder).replace(/\/\*\*$/, '');
    const re = globRegex(absolutePattern(have.content, where.home, where.folder));
    return re.test(`${wanted}/x`) && (re.test(wanted) || re.test(`${wanted}/a/b`));
  }
  return false;
}

// ---- Examples ----

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  // Long base64-like runs with letters and digits (paths and words don't qualify: no `/`).
  /(?<![\w/.-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{36,}={0,2}/g,
];
const SECRET_ASSIGNMENT =
  /((?:[A-Za-z0-9_]*(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|key|credential)[A-Za-z0-9_]*)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER =
  /(authorization:\s*(?:bearer\s+|basic\s+|token\s+)?|bearer\s+|x-api-key:\s*)[^\s"']+/gi;
const URL_CREDENTIALS = /(\/\/)[^/\s:@]+:[^/\s@]+@/g;

export const MASK = '•••';

/** Hides anything that looks like a token, key or password. */
export function maskSecrets(text: string): string {
  let out = text.replace(BEARER, (_, lead: string) => `${lead}${MASK}`);
  out = out.replace(SECRET_ASSIGNMENT, (whole: string, name: string, value: string) =>
    value === MASK ? whole : `${name}${MASK}`,
  );
  out = out.replace(URL_CREDENTIALS, `$1${MASK}@`);
  for (const re of SECRET_PATTERNS) out = out.replace(re, MASK);
  return out;
}

/** One line, secrets masked, at most 120 characters. */
export function example(text: string, home: string, max = 120): string {
  const h = home.replace(/\/+$/, '');
  let line = text.replace(/\s+/g, ' ').trim();
  if (h && h !== '/') line = line.split(h).join('~');
  line = maskSecrets(line);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
