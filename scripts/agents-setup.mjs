#!/usr/bin/env node
// Teaches the agents on this computer to use Pharos for reports, reviews and details:
//   pnpm agents install   Claude Code skill (~/.claude/skills/pharos-report), the Claude Code
//                         PermissionRequest hook (agents/claude/hooks/permission-ask.mjs, added
//                         to ~/.claude/settings.json after a backup next to it), and a marked
//                         block in Codex's global instructions (~/.codex/AGENTS.md)
//   pnpm agents status    what is installed, and whether it is current
//   pnpm agents remove    takes both out again (only what Pharos wrote)
// Safe to run again. A skill of that name that Pharos didn't write is left alone. Override the
// homes with CLAUDE_CONFIG_DIR and CODEX_HOME (tests use made-up ones).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Run from the service's deploy copy (~/.pharos/slots/a|b), point at ~/.pharos/app, the link that
// always names the deployed version: a slot is rebuilt with the next update.
const deployed = here.match(/^(.*\/\.pharos)\/slots\/[^/]+\/scripts$/);
const source = deployed ? join(deployed[1], 'app', 'agents') : join(here, '..', 'agents');
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');

const skillFrom = join(source, 'claude', 'pharos-report', 'SKILL.md');
const skillTo = join(claudeHome, 'skills', 'pharos-report', 'SKILL.md');
const agentsFrom = join(source, 'codex', 'AGENTS.md');
const agentsTo = join(codexHome, 'AGENTS.md');
const SKILL_MARK = 'Installed by Pharos';
const START =
  '<!-- pharos:start (written by pnpm agents install; pnpm agents remove takes it out) -->';
const END = '<!-- pharos:end -->';

// The permission hook: Claude Code runs it when an agent is about to ask for permission; it tells
// Pharos and waits up to 55 s for the owner's answer there (see the script). Only the owner
// installs it, with this command; agents never do.
const hookScript = join(source, 'claude', 'hooks', 'permission-ask.mjs');
const settingsPath = join(claudeHome, 'settings.json');
const HOOK_MARK = 'permission-ask.mjs';
const HOOK_EVENT = 'PermissionRequest';
const hookCommand = `node "${hookScript}"`;

// The session-note hook: Claude Code runs it when a session finishes a turn; it posts the
// session's last message to Pharos so other sessions see it in the project brief.
const noteScript = join(source, 'claude', 'hooks', 'session-note.mjs');
const NOTE_MARK = 'session-note.mjs';
const NOTE_EVENT = 'Stop';
const noteCommand = `node "${noteScript}"`;

const hasMark = (group, mark) =>
  Array.isArray(group?.hooks) &&
  group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(mark));

function readSettings() {
  const text = read(settingsPath);
  if (text === undefined || !text.trim()) return { text, json: {} };
  return { text, json: JSON.parse(text) };
}

/** Copies settings.json next to itself before Pharos changes it; keeps the last five. */
function backupSettings(text) {
  if (text === undefined) return undefined;
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const backup = `${settingsPath}.pharos-backup-${stamp}`;
  copyFileSync(settingsPath, backup);
  const prefix = 'settings.json.pharos-backup-';
  const all = readdirSync(claudeHome)
    .filter((n) => n.startsWith(prefix))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) rmSync(join(claudeHome, old));
  return backup;
}

/** Settings with Pharos's hook for one event added (or taken out); other hooks stay as they are. */
function withEventHook(json, event, mark, command, timeout, add) {
  const hooks = { ...(json.hooks ?? {}) };
  const groups = (Array.isArray(hooks[event]) ? hooks[event] : []).filter((g) => !hasMark(g, mark));
  if (add) groups.push({ matcher: '*', hooks: [{ type: 'command', command, timeout }] });
  if (groups.length) hooks[event] = groups;
  else delete hooks[event];
  const next = { ...json, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}

function withHook(json, add) {
  const once = withEventHook(json, HOOK_EVENT, HOOK_MARK, hookCommand, 120, add);
  return withEventHook(once, NOTE_EVENT, NOTE_MARK, noteCommand, 10, add);
}

function installHook() {
  let settings;
  try {
    settings = readSettings();
  } catch {
    console.log(`Claude Code: ${settingsPath} isn't valid JSON; permission hook not added.`);
    return;
  }
  const next = withHook(settings.json, true);
  if (settings.text !== undefined && JSON.stringify(next) === JSON.stringify(settings.json)) {
    console.log(`Claude Code: permission and session-note hooks already current (${settingsPath})`);
    return;
  }
  const backup = backupSettings(settings.text);
  mkdirSync(claudeHome, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `Claude Code: permission and session-note hooks added to ${settingsPath}${backup ? ` (backup: ${backup})` : ''}`,
  );
}

function removeHook() {
  let settings;
  try {
    settings = readSettings();
  } catch {
    console.log(`Claude Code: ${settingsPath} isn't valid JSON; left alone.`);
    return;
  }
  const ours = [HOOK_EVENT, NOTE_EVENT].some((e) =>
    (settings.json.hooks?.[e] ?? []).some((g) =>
      hasMark(g, e === HOOK_EVENT ? HOOK_MARK : NOTE_MARK),
    ),
  );
  if (!ours) {
    console.log('Claude Code: no Pharos hooks to remove');
    return;
  }
  const backup = backupSettings(settings.text);
  writeFileSync(settingsPath, `${JSON.stringify(withHook(settings.json, false), null, 2)}\n`);
  console.log(`Claude Code: permission and session-note hooks removed (backup: ${backup})`);
}

function hookStatus(event = HOOK_EVENT, mark = HOOK_MARK, command = hookCommand) {
  try {
    const ours = (readSettings().json.hooks?.[event] ?? []).find((g) => hasMark(g, mark));
    if (!ours) return 'not installed';
    return ours.hooks.some((h) => h.command === command)
      ? 'installed, current'
      : 'installed from another folder (pnpm agents install)';
  } catch {
    return `unknown (${settingsPath} isn't valid JSON)`;
  }
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

function withoutBlock(text) {
  const start = text.indexOf('<!-- pharos:start');
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return (
    (text.slice(0, start).trimEnd() + '\n' + text.slice(end + END.length).trimStart()).trimEnd() +
    '\n'
  );
}

function install() {
  const skill = readFileSync(skillFrom, 'utf8');
  const current = read(skillTo);
  if (current !== undefined && !current.includes(SKILL_MARK)) {
    console.log(`Claude Code: ${skillTo} exists and wasn't written by Pharos; left alone.`);
  } else {
    mkdirSync(dirname(skillTo), { recursive: true });
    writeFileSync(skillTo, skill);
    console.log(
      `Claude Code: skill ${current === skill ? 'already current' : 'installed'} (${skillTo})`,
    );
  }
  installHook();
  const block = `${START}\n${readFileSync(agentsFrom, 'utf8').trim()}\n${END}\n`;
  const agents = read(agentsTo) ?? '';
  const next = `${withoutBlock(agents).trimEnd()}${agents.trim() ? '\n\n' : ''}${block}`;
  if (next === agents) console.log(`Codex: block already current (${agentsTo})`);
  else {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(agentsTo, next);
    console.log(
      `Codex: block ${agents.includes('<!-- pharos:start') ? 'updated' : 'added'} (${agentsTo})`,
    );
  }
}

function status() {
  const current = read(skillTo);
  const skill = readFileSync(skillFrom, 'utf8');
  console.log(
    `Claude Code skill: ${current === undefined ? 'not installed' : current === skill ? 'installed, current' : current.includes(SKILL_MARK) ? 'installed, older version (pnpm agents install)' : 'a skill of that name not from Pharos'}`,
  );
  console.log(`Claude Code permission hook: ${hookStatus()}`);
  console.log(`Claude Code session-note hook: ${hookStatus(NOTE_EVENT, NOTE_MARK, noteCommand)}`);
  const agents = read(agentsTo) ?? '';
  const block = readFileSync(agentsFrom, 'utf8').trim();
  console.log(
    `Codex block: ${!agents.includes('<!-- pharos:start') ? 'not installed' : agents.includes(block) ? 'installed, current' : 'installed, older version (pnpm agents install)'}`,
  );
}

function remove() {
  const current = read(skillTo);
  if (current?.includes(SKILL_MARK)) {
    rmSync(dirname(skillTo), { recursive: true, force: true });
    console.log('Claude Code: skill removed');
  } else console.log('Claude Code: no Pharos skill to remove');
  removeHook();
  const agents = read(agentsTo);
  if (agents?.includes('<!-- pharos:start')) {
    writeFileSync(agentsTo, withoutBlock(agents));
    console.log('Codex: block removed');
  } else console.log('Codex: no Pharos block to remove');
}

const command = process.argv[2] ?? 'status';
if (command === 'install') install();
else if (command === 'remove') remove();
else if (command === 'status') status();
else {
  console.error('Usage: pnpm agents install|status|remove');
  process.exit(2);
}
