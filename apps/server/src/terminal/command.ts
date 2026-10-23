import { mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
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
  options: { mcpConfigPath: string; serverUrl: string; brief?: string },
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
    ],
  };
}

/**
 * Which project the panel's agent works for. Several projects can share a repository folder, and
 * the agent can't tell them apart from the folder: without this it guesses, or asks.
 */
export function terminalBrief(store: Store, projectId: string, serverUrl: string): string {
  const project = store.get(projectId);
  const name = project?.type === 'project' ? (project as Entity<'project'>).data.name : undefined;
  const which = name ? `${JSON.stringify(name)} (${projectId})` : projectId;
  return (
    `You are running in the agent panel of the Pharos project ${which}, opened from its page in ` +
    `Pharos at ${serverUrl}. "This project" means that Pharos project unless the user names ` +
    `another one; other Pharos projects may share this folder, so read and update that one.`
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
 * (`<home>/agent-home/<projectId>`), made on demand. Never a folder from the client.
 */
export function terminalCwd(
  store: Store,
  projectId: string,
  home: string,
): { cwd: string; kind: 'repository' | 'home' } {
  const project = store.get(projectId);
  const repositoryId =
    project?.type === 'project' ? (project as Entity<'project'>).data.repositoryId : undefined;
  const repository = repositoryId ? store.get(repositoryId) : null;
  const path =
    repository?.type === 'repository' ? (repository as Entity<'repository'>).data.path : undefined;
  if (path && isAbsolute(path) && isDirectory(path)) return { cwd: path, kind: 'repository' };
  const cwd = join(home, 'agent-home', projectId.replace(/[^A-Za-z0-9_-]/g, '_'));
  mkdirSync(cwd, { recursive: true });
  return { cwd, kind: 'home' };
}

/**
 * The environment of the agent: PATH and HOME of the server (and the few variables a terminal
 * program expects from the login), the terminal type, and where Pharos is and which project
 * (`PHAROS_PROJECT_ID`). Nothing from the client.
 */
export function terminalEnv(
  serverEnv: NodeJS.ProcessEnv,
  serverUrl: string,
  projectId?: string,
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
  if (projectId) env.PHAROS_PROJECT_ID = projectId;
  return env;
}
