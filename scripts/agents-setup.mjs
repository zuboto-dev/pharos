#!/usr/bin/env node
// Teaches the agents on this computer to use Pharos for reports, reviews and details:
//   pnpm agents install   Claude Code skill (~/.claude/skills/pharos-report) and a marked block
//                         in Codex's global instructions (~/.codex/AGENTS.md)
//   pnpm agents status    what is installed, and whether it is current
//   pnpm agents remove    takes both out again (only what Pharos wrote)
// Safe to run again. A skill of that name that Pharos didn't write is left alone. Override the
// homes with CLAUDE_CONFIG_DIR and CODEX_HOME (tests use made-up ones).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'agents');
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
