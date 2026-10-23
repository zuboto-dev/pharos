import { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  AGENT_PRESETS,
  PRESET_LABELS,
  PRESET_SETTING,
  isAgentPreset,
  type AgentPreset,
} from '../agent-runner.js';
import type { Entity } from '@pharos/schema';
import type { Store } from '../store/store.js';

/** A fixed command for the terminal: a program and its arguments, never run through a shell. */
export type TerminalCommand = { file: string; args: string[] };

/**
 * The interactive agent for the panel (R17), connected to this server's Pharos over MCP. Only
 * these two exist; the client can't send a command. PHAROS_AGENT_COMMAND doesn't apply here: it
 * is for headless answering.
 * - Claude Code: the MCP config Pharos writes (`agentMcpConfig`), and only it
 *   (`--strict-mcp-config`), so a "pharos" server in the owner's own config can't point the
 *   panel at another Pharos.
 * - Codex: this server as `mcp_servers.pharos`, overriding a "pharos" entry of the owner's own.
 *
 * `brief` (terminalBrief) tells the agent which project its panel belongs to: Claude Code as an
 * appended system prompt, Codex as its developer instructions.
 */
export function terminalCommand(
  preset: AgentPreset,
  options: {
    mcpConfigPath: string;
    serverUrl: string;
    brief?: string;
    /** Claude Code's conversation: a new one with this id, or the one to resume after a restart. */
    conversation?: { id: string; resume: boolean };
  },
): TerminalCommand {
  if (preset === 'codex')
    return {
      file: 'codex',
      args: [
        '-c',
        `mcp_servers.pharos.url="${options.serverUrl}/mcp"`,
        // A JSON string is a valid TOML string.
        ...(options.brief ? ['-c', `developer_instructions=${JSON.stringify(options.brief)}`] : []),
      ],
    };
  return {
    file: 'claude',
    args: [
      '--mcp-config',
      options.mcpConfigPath,
      '--strict-mcp-config',
      ...(options.brief ? ['--append-system-prompt', options.brief] : []),
      ...(options.conversation
        ? [options.conversation.resume ? '--resume' : '--session-id', options.conversation.id]
        : []),
    ],
  };
}

/** The app setting keeping each folder's panel conversation, so a restart resumes it. */
export const CONVERSATIONS_SETTING = 'terminal.conversations';

/**
 * Whether Claude Code kept a conversation's transcript (~/.claude/projects/<folder>/<id>.jsonl,
 * the folder's path with every other character than letters and digits as "-"): only then can
 * `--resume` pick it up; otherwise a new one starts.
 */
export function conversationKept(home: string, cwd: string, id: string): boolean {
  const folder = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return existsSync(join(home, '.claude', 'projects', folder, `${id}.jsonl`));
}

/** A project the panel's agent works for. */
export type TerminalProject = { id: string; name: string };

/**
 * The projects whose repository is this folder: they share one panel session (two agents in one
 * checkout would overwrite each other's edits). Empty for a folder of the agent's own.
 */
export function folderProjects(store: Store, cwd: string): TerminalProject[] {
  const repositories = new Set(
    store
      .list('repository')
      .filter(
        (r) => r.data.path && isAbsolute(r.data.path) && resolve(r.data.path) === resolve(cwd),
      )
      .map((r) => r.id),
  );
  if (!repositories.size) return [];
  return store
    .list('project')
    .filter((p) => p.data.repositoryId && repositories.has(p.data.repositoryId))
    .map((p) => ({ id: p.id, name: p.data.name }));
}

/**
 * Which project the panel's agent works for, or, in a folder several projects share, which ones
 * share it and how to tell them apart: the agent can't tell from the folder alone.
 */
export function terminalBrief(projects: TerminalProject[], serverUrl: string): string {
  const named = (p: TerminalProject) => `${JSON.stringify(p.name)} (${p.id})`;
  if (projects.length === 1)
    return (
      `You are running in the agent panel of the Pharos project ${named(projects[0]!)}, at ` +
      `${serverUrl}. "This project" means that Pharos project unless the user names another one.`
    );
  return (
    `You are running in the agent panel that the Pharos projects ${projects.map(named).join(', ')} ` +
    `share, at ${serverUrl}: their code is in this folder. The user may talk about any of them. ` +
    `A reference they paste from a page ("[Pharos: …]") names a view, block or task, which ` +
    `belongs to one project; when it isn't clear which project they mean, ask before changing ` +
    `anything in Pharos.`
  );
}

/** The agent the panel runs: the one chosen for answering in Settings while installed, else the first installed. */
export function terminalPreset(store: Store, installed: AgentPreset[]): AgentPreset | undefined {
  const saved = store.setting<string>(PRESET_SETTING);
  if (isAgentPreset(saved) && installed.includes(saved)) return saved;
  return AGENT_PRESETS.find((p) => installed.includes(p));
}

export function presetLabel(preset: AgentPreset): string {
  return PRESET_LABELS[preset];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where the agent starts: the project's repository folder when its repository records a local
 * path that is an existing folder, else a folder of its own under the Pharos home
 * (`<home>/agent-home/<projectId>`), made on demand (unless `make` is false). Never a folder
 * from the client.
 */
export function terminalCwd(
  store: Store,
  projectId: string,
  home: string,
  make = true,
): { cwd: string; kind: 'repository' | 'home' } {
  const project = store.get(projectId);
  const repositoryId =
    project?.type === 'project' ? (project as Entity<'project'>).data.repositoryId : undefined;
  const repository = repositoryId ? store.get(repositoryId) : null;
  const path =
    repository?.type === 'repository' ? (repository as Entity<'repository'>).data.path : undefined;
  // resolve: "/x/app/" and "/x/app" are one folder, so one session.
  if (path && isAbsolute(path) && isDirectory(path))
    return { cwd: resolve(path), kind: 'repository' };
  const cwd = join(home, 'agent-home', projectId.replace(/[^A-Za-z0-9_-]/g, '_'));
  if (make) mkdirSync(cwd, { recursive: true });
  return { cwd, kind: 'home' };
}

/**
 * The environment of the agent: PATH and HOME of the server (and the few variables a terminal
 * program expects from the login), the terminal type, and where Pharos is and which projects
 * (`PHAROS_PROJECT_IDS`, comma-separated, as for answering). Nothing from the client.
 */
export function terminalEnv(
  serverEnv: NodeJS.ProcessEnv,
  serverUrl: string,
  projectIds: string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) {
    const value = serverEnv[name];
    if (value) env[name] = value;
  }
  env.LANG ??= 'en_US.UTF-8';
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.PHAROS_URL = serverUrl;
  if (projectIds.length) env.PHAROS_PROJECT_IDS = projectIds.join(',');
  return env;
}
