import { dirname } from 'node:path';
import type { PermissionRisk, PermissionScope } from '@pharos/schema';
import { mainSegment, parseRule, rulePath, words, type Suggested } from './rules.js';

/**
 * "How far" a rule reaches, for the owner's choice before Allow or Deny:
 * - narrower variants made from the actual asks: a longer command prefix every ask shared
 *   (`Bash(git commit -m:*)`), the one file an agent edited (`Edit(~/x/src/a.ts)`);
 * - this folder: the suggested rule in the folder's `.claude/settings.local.json` (the default);
 * - a wider place inside the folder for path rules (`Edit(~/x/src/**)`), never one that holds
 *   settings, keys or git hooks;
 * - all my projects: `~/.claude/settings.json`, only for low-risk rules that aren't about paths.
 * Every variant keeps the suggestion's allowability: a Deny-only rule stays Deny-only, however
 * narrow.
 */

const PROTECTED_PATH = /(^|\/)(\.claude|\.ssh|\.gnupg|\.aws|\.git|\.config|\.env[^/]*)(\/|$)/;

const code = (s: string) => `\`${s}\``;

/** What a rule lets agents do, in a few words ("run `git commit …`"). */
export function rulePhrase(rule: string): string {
  const { tool, content } = parseRule(rule);
  if (tool === 'Bash' && content !== undefined)
    return content.endsWith(':*')
      ? `run ${code(`${content.slice(0, -2)} …`)}`
      : `run exactly ${code(content)}`;
  if (tool === 'Bash') return 'run any command';
  if (tool === 'Edit')
    return content?.endsWith('/**')
      ? `edit files in ${code(content.slice(0, -3))}`
      : `edit ${code(content ?? 'any file')}`;
  if (tool === 'Read')
    return content?.endsWith('/**')
      ? `read files in ${code(content.slice(0, -3))}`
      : `read ${code(content ?? 'any file')}`;
  if (tool === 'WebFetch')
    return `open pages on ${code(content?.replace(/^domain:/, '') ?? 'any site')}`;
  if (tool.startsWith('mcp__')) return `use ${code(tool)}`;
  return `use ${code(tool)}`;
}

function commonPrefix(lists: string[][]): string[] {
  if (!lists.length) return [];
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const w = lists[0]![i];
    if (w === undefined || lists.some((l) => l[i] !== w)) return out;
    // Stop at a quoted message, a long word or anything that isn't plain.
    if (!/^[\w@.:/=+,-]+$/.test(w) || w.length > 60) return out;
    out.push(w);
  }
}

export function scopesFor(input: {
  suggested: Suggested;
  /** The commands or paths agents actually asked with (unmasked; never returned as such). */
  raws: string[];
  folder: { path: string; name: string };
  home: string;
  risk: PermissionRisk;
}): PermissionScope[] {
  const { suggested: s, raws, folder, home, risk } = input;
  const only = `Only in ${folder.name}`;
  const scope = (
    id: string,
    kind: PermissionScope['kind'],
    rule: string,
    label: string,
    target: PermissionScope['target'] = 'local',
  ): PermissionScope => ({
    id,
    kind,
    rule,
    target,
    label,
    where: target === 'user' ? 'In all your projects' : only,
    phrase: rulePhrase(rule),
  });
  const out: PermissionScope[] = [];
  const { tool, content } = parseRule(s.rule);

  // Variants only for rules that can be allowed: a Deny-only rule is denied as suggested.
  if (s.allowable && tool === 'Bash' && content?.endsWith(':*')) {
    const base = words(content.slice(0, -2));
    const asked = raws.map((r) => words(mainSegment(r))).filter((w) => w.length);
    // Drop leading env assignments like the rule did.
    const trimmed = asked.map((w) => {
      let i = 0;
      while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!)) i++;
      return w.slice(i);
    });
    const common = commonPrefix(trimmed);
    const startsWithBase = base.every((w, i) => common[i] === w);
    if (startsWithBase && common.length > base.length) {
      const narrow = `Bash(${common.join(' ')}:*)`;
      out.push(scope('narrow', 'narrow', narrow, `Only ${code(`${common.join(' ')} …`)}`));
    }
  }

  if (s.allowable && (tool === 'Edit' || tool === 'Read') && content?.endsWith('/**')) {
    const files = [...new Set(raws.filter((r) => r.startsWith('/') && !r.endsWith('/')))];
    if (files.length === 1) {
      const file = files[0]!;
      out.push(
        scope(
          'file',
          'narrow',
          `${tool}(${rulePath(file, home)})`,
          `Only ${code(rulePath(file, home))}`,
        ),
      );
    }
  }

  out.push(scope('folder', 'folder', s.rule, 'As suggested'));

  if (s.allowable && (tool === 'Edit' || tool === 'Read') && content?.endsWith('/**')) {
    // One folder up inside the project, as long as it stays inside and holds nothing protected.
    const dirs = [...new Set(raws.map((r) => (r.endsWith('/') ? r.slice(0, -1) : dirname(r))))];
    const dir = dirs[0];
    if (dir && dir.startsWith(`${folder.path}/`)) {
      const top = `${folder.path}/${dir.slice(folder.path.length + 1).split('/')[0]}`;
      if (top !== dir && !PROTECTED_PATH.test(top.slice(folder.path.length)))
        out.push(
          scope(
            'wider',
            'wider',
            `${tool}(${rulePath(top, home)}/**)`,
            `All of ${code(rulePath(top, home))}`,
          ),
        );
    }
  }

  const aboutPaths = tool === 'Edit' || tool === 'Read';
  if (s.allowable && risk === 'low' && !aboutPaths)
    out.push(scope('user', 'user', s.rule, 'All my projects', 'user'));
  return out;
}
