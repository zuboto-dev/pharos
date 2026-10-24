import type { PermissionRisk } from '@pharos/schema';
import { parseRule, type Suggested } from './rules.js';

/**
 * A rule in plain words, and how risky allowing it is, for the owner who doesn't read
 * `Bash(git -C /x log:*)` fluently. Deny-only rules are always high risk (their reason says why).
 */

export type Explained = { summary: string; risk: PermissionRisk; riskWhy: string };

const LOW = 'Only reads; it changes nothing.';
const MEDIUM_LOCAL = 'Changes files in this folder, but nothing outside this computer.';

type Entry = [RegExp, string, PermissionRisk, string?];

/** First words of a command → what it does. Checked in order; the first match wins. */
const COMMANDS: Entry[] = [
  [/^(rm|rmdir)\b/, 'Deletes files or folders', 'high'],
  [
    /^(bash|sh|zsh|fish|dash|eval|exec|source|\.)( |$)/,
    'Starts a shell that can run anything',
    'high',
  ],
  [/^(sudo|su|doas)\b/, 'Runs a command as the administrator', 'high'],
  [
    /^(xargs|env|nohup|timeout|time|nice|watch|command)\b/,
    'Runs another command given to it',
    'high',
  ],
  [
    /^(python3?|node|ruby|perl|php|deno|bun|tsx)$/,
    'Runs code written inline (not a saved script)',
    'high',
  ],
  [/^(curl|wget)\b/, 'Fetches from or sends to the internet', 'high'],
  [/^(ssh|scp|rsync|nc)\b/, 'Connects to another computer', 'high'],
  [/^(kill|pkill|killall)\b/, 'Stops running programs', 'high'],
  [/^(chmod|chown)\b/, 'Changes who can read or run files', 'high'],
  [/^(find)\b/, 'Searches for files (and can run commands on them)', 'high'],
  [/^(for|while|until|if|case)\b|^\$/, 'Runs a shell loop or a command held in a variable', 'high'],
  [
    /^git (-C \S+ )?(status|log|diff|show|branch|worktree list|rev-parse|ls-files|ls-tree|blame|remote -v|describe|shortlog|check-ignore|grep)\b/,
    'Reads git history and status',
    'low',
    LOW,
  ],
  [
    /^git (-C \S+ )?worktree\b/,
    'Lists or manages git worktrees (separate checkouts)',
    'medium',
    MEDIUM_LOCAL,
  ],
  [
    /^git (-C \S+ )?(commit|add|stash|merge|rebase|cherry-pick|checkout|switch|restore|tag|mv|rm|fetch|pull|apply|am|update-index)\b/,
    'Changes this repository’s files or history on this computer',
    'medium',
    'Changes the local repository; nothing is published until a push.',
  ],
  [/^git (-C \S+ )?push\b/, 'Publishes commits to a shared remote', 'high'],
  [
    /^(npx |bunx )?(pnpm|npm|yarn|bun)(@\S+)? (--filter \S+ |-F \S+ |-C \S+ |-w )*(run )?(test|vitest|jest)\b/,
    'Runs the project’s tests',
    'low',
    'Runs the project’s own test scripts; they could change files, but rarely do.',
  ],
  [
    /^(npx |bunx )?(pnpm|npm|yarn|bun)(@\S+)? (--filter \S+ |-F \S+ |-C \S+ |-w )*(run )?(lint|typecheck|format|check|prettier|eslint)\b/,
    'Checks the code (lint, types, formatting)',
    'low',
    'Runs the project’s check scripts; formatting may rewrite files.',
  ],
  [
    /^(npx |bunx )?(pnpm|npm|yarn|bun)(@\S+)? (--filter \S+ |-F \S+ |-C \S+ |-w )*(run )?(build|dev|start|preview)\b/,
    'Builds or starts the project',
    'medium',
    'Runs the project’s own scripts, which can do anything they’re written to.',
  ],
  [
    /^(npx |bunx )?(pnpm|npm|yarn|bun)(@\S+)? (--filter \S+ |-F \S+ )*(install|i|add|remove|update|up)\b/,
    'Installs or changes the project’s packages',
    'medium',
    'Downloads packages, whose install scripts run on this computer.',
  ],
  [
    /^(npx |bunx )?(pnpm|npm|yarn|bun)(@\S+)? /,
    'Runs one of the project’s package scripts',
    'medium',
    'Runs the project’s own scripts, which can do anything they’re written to.',
  ],
  [
    /^(npx|bunx|uvx) \S+/,
    'Downloads (if needed) and runs a package’s command',
    'medium',
    'Runs code from a package, maybe downloaded from the internet.',
  ],
  [
    /^(ls|cat|head|tail|wc|grep|rg|sed -n|awk|sort|uniq|cut|tr|diff|file|stat|du|df|tree|jq|which|pwd|echo|printf|date|env)\b/,
    'Reads files or prints text',
    'low',
    LOW,
  ],
  [/^sed\b/, 'Reads or edits text in files', 'medium', 'With -i it rewrites files.'],
  [/^(mkdir|touch|cp|mv|ln)\b/, 'Creates, copies or moves files', 'medium', MEDIUM_LOCAL],
  [
    /^(make|cargo|go|swift|xcodebuild|tsc|vitest|jest|pytest|ruff|eslint|prettier)\b/,
    'Builds or checks the code',
    'medium',
    'Runs the project’s build or check tools.',
  ],
  [
    /^(python3?|node|ruby|perl|deno|bun|tsx) \S+/,
    'Runs a script in this project',
    'medium',
    'Runs whatever that script does.',
  ],
  [
    /^gh (pr|issue|run) (view|list|status|checks|diff)\b/,
    'Reads pull requests, issues or CI runs on GitHub',
    'low',
    'Reads from GitHub; changes nothing.',
  ],
  [/^gh\b/, 'Uses GitHub', 'medium', 'Can change pull requests and issues on GitHub.'],
  [/^(sleep|true|false)\b/, 'Waits or does nothing', 'low', LOW],
];

const MCP_WORDS: Record<string, string> = {
  apply: 'change project data',
  list: 'list items',
  get: 'read an item',
  search: 'search',
  execute: 'run code',
};

/** A path rule's folder as people write it: `//Volumes/x/**` → `/Volumes/x`. */
const plainPath = (body: string) => body.replace(/\/\*\*$/, '').replace(/^\/\//, '/');

/** The plain-words summary and risk of a suggested rule. */
export function explain(s: Pick<Suggested, 'rule' | 'tool' | 'allowable' | 'reason'>): Explained {
  const { content } = parseRule(s.rule);
  const body = content?.replace(/:\*$/, '') ?? '';
  let found: Explained | undefined;
  if (s.tool === 'Bash') {
    for (const [re, summary, risk, why] of COMMANDS)
      if (re.test(body)) {
        found = { summary, risk, riskWhy: why ?? summary };
        break;
      }
    found ??= {
      summary: `Runs the command “${body.split(' ')[0]}”`,
      risk: 'medium',
      riskWhy: 'Pharos doesn’t know this command; check what it does first.',
    };
  } else if (s.tool.startsWith('mcp__')) {
    const [, server = '', ...rest] = s.tool.split('__');
    const tool = rest.join('__');
    const verb = MCP_WORDS[tool.split('_').pop() ?? ''] ?? `use “${tool}”`;
    const pharos = server === 'pharos';
    found = {
      summary: pharos
        ? `Uses Pharos to ${tool === 'apply' ? 'change project data (tasks, decisions, pages)' : verb}`
        : `Uses the ${server} connection to ${verb}`,
      risk: /apply|execute|write|create|update|delete|send|post|deploy/.test(tool)
        ? 'medium'
        : 'low',
      riskWhy: pharos
        ? 'Every change in Pharos is a revision you can undo.'
        : 'An outside service the agent is connected to (MCP).',
    };
  } else if (s.tool === 'Edit') {
    found = {
      summary: `Edits files in ${plainPath(body)}`,
      risk: 'medium',
      riskWhy: 'Can change any file in that folder.',
    };
  } else if (s.tool === 'Read' || s.tool === 'Glob' || s.tool === 'Grep') {
    found = {
      summary: `Reads files in ${plainPath(body) || 'any folder'}`,
      risk: 'low',
      riskWhy: LOW,
    };
  } else if (s.tool === 'WebFetch') {
    found = {
      summary: `Opens web pages on ${body.replace(/^domain:/, '') || 'any site'}`,
      risk: 'low',
      riskWhy: 'Reads the web; the address it opens can carry data out.',
    };
  } else if (s.tool === 'WebSearch') {
    found = { summary: 'Searches the web', risk: 'low', riskWhy: LOW };
  } else {
    found = {
      summary: `Uses the ${s.tool} tool`,
      risk: 'medium',
      riskWhy: 'A Claude Code tool Pharos has no description for.',
    };
  }
  if (!s.allowable)
    return { summary: found.summary, risk: 'high', riskWhy: s.reason ?? 'Can only be denied.' };
  return found;
}
