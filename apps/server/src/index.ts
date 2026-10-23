import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRunner, agentMcpConfig, agentSetup, shellRunner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { RunLog } from './desk.js';
import { FileService } from './files/service.js';
import { Notifications } from './notifications.js';
import { answerBrief } from './guidance.js';
import { Presence } from './presence.js';
import { defaultDatabasePath, openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { seenMarks } from './views/freshness.js';
import { scheduleAssetPurge } from './views/report.js';
import { webBuildId } from './version.js';
import { loadPty } from './terminal/pty.js';
import { TerminalService } from './terminal/service.js';
import { PermissionService } from './permissions/service.js';

// Whatever ends this process should say why in its log first (a background service restarts it;
// `pnpm dev` waits for a file change). A stray rejection is logged and doesn't end it.
process.on('uncaughtException', (error) => {
  console.error(`[pharos] ${new Date().toISOString()} Uncaught exception, exiting:`, error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[pharos] ${new Date().toISOString()} Unhandled rejection:`, reason);
});

const port = Number(process.env.PORT ?? 4300);
const dbPath = defaultDatabasePath();
const store = new Store(openDatabase(dbPath));
store.ensureDefaultViews();
// R11: Pharos starts keeping track of what the reader has seen when it first runs with it, so
// what agents change from then on is marked even before the owner opens the app.
seenMarks(store);
// R13.5: assets of report pages deleted 30+ days ago go, at start and once a day.
scheduleAssetPurge(store);
const feed = new RevisionFeed(store);
// Who is working where (v0.2 B5): shared by the MCP tools, the answering run and the feed.
const presence = new Presence();
// Answer questions asked in the web app by running an agent: PHAROS_AGENT_COMMAND, or the
// installed built-in agent chosen in Settings (Claude Code or Codex; Claude Code by default).
// PHAROS_AGENT_COMMAND=off turns it off.
const serverUrl = `http://localhost:${port}`;
// The built server (dist/) also serves the built web app, so a background service is the whole
// app at one address. The dev server leaves that to Vite.
const here = fileURLToPath(import.meta.url);
const webDir = resolve(dirname(here), '../../web/dist');
const serveWeb = /[\\/]dist[\\/]/.test(here) && existsSync(join(webDir, 'index.html'));
if (serveWeb) process.env.PHAROS_WEB_URL ??= serverUrl;
const agentLog = process.env.PHAROS_AGENT_LOG ?? join(homedir(), '.pharos', 'agent.log');
const mcpConfigPath = join(dirname(agentLog), 'agent-mcp.json');
/** Where an agent CLI is installed (its absolute path), or '' when it isn't. */
const whereIs = (name: string) => {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : '';
};
const cli = { claude: whereIs('claude'), codex: whereIs('codex') };
const setup = agentSetup(process.env.PHAROS_AGENT_COMMAND, {
  hasClaude: Boolean(cli.claude),
  hasCodex: Boolean(cli.codex),
  mcpConfigPath,
  serverUrl,
});
// The answering agent and the agent terminal (R17) both use it.
if (cli.claude) {
  mkdirSync(dirname(mcpConfigPath), { recursive: true });
  writeFileSync(mcpConfigPath, agentMcpConfig(serverUrl));
}
const agent = new AgentRunner(store, {
  command: setup.command,
  ...(setup.mode === 'default' ? { presets: setup.commands } : {}),
  runner: shellRunner(agentLog),
  serverUrl,
  mode: setup.mode,
  logPath: agentLog,
  // Which earlier answers were offered for reuse, and which were stale (R11.6), go to the log.
  prompt: (projectIds) =>
    answerBrief(store, projectIds, (line) => {
      try {
        mkdirSync(dirname(agentLog), { recursive: true });
        appendFileSync(agentLog, `${line}\n`);
      } catch (error) {
        console.error('[pharos] Could not write to the agent log:', error);
      }
    }),
  presence,
});
if (agent.configured) agent.watch(feed);
const files = new FileService(store);
// The agent terminal (R17): the owner's agent CLI in a panel beside a project, on this computer.
const terminal = new TerminalService({
  store,
  installed: cli,
  mcpConfigPath,
  serverUrl,
  home: process.env.PHAROS_HOME ?? join(homedir(), '.pharos'),
  pty: await loadPty(),
});
terminal.startSweeping();
// What Pharos tells the owner: the desk, runs, terminals that ended, pages out of date,
// hand-backs nobody picked up; and, after a restart, the agents it had to stop (a modal).
const notifications = new Notifications(store, new RunLog(store));
notifications.watch(feed, {
  agent,
  ...(terminal.sessions ? { terminal: terminal.sessions } : {}),
});
// No agent outlives the server: its sessions go (whole process groups) when it stops.
process.on('exit', () => terminal.stop());
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
  process.on(signal, () => {
    // An update restart ends the owner's agent terminals: the next start says so.
    notifications.noteInterrupted(terminal.runningSessions());
    terminal.stop();
    process.exit(0);
  });
// Claude Code permissions (Settings): its transcripts and settings live in ~/.claude, or in
// PHAROS_CLAUDE_HOME (for a test server with fixture transcripts). Read-only until the owner clicks.
const permissions = new PermissionService(store, {
  ...(process.env.PHAROS_CLAUDE_HOME ? { claudeHome: process.env.PHAROS_CLAUDE_HOME } : {}),
});
const app = createApp(store, feed, agent, {
  dataPath: dbPath,
  port,
  files,
  presence,
  // Set by scripts/pharos-service.sh; launchd also names the job in XPC_SERVICE_NAME.
  service:
    process.env.PHAROS_SERVICE === '1' || process.env.XPC_SERVICE_NAME === 'dev.pharos.server',
  ...(serveWeb ? { webDir, buildId: webBuildId(webDir) } : {}),
  // Behind a tunnel with a login in front, the browser's host and origin are this address.
  webUrl: process.env.PHAROS_WEB_URL,
  terminal,
  notifications,
  permissions,
});

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
    // The agent terminal's socket; small messages only (typed input, a size).
    websocket: { server: new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 }) },
  },
  (info) => {
    console.log(
      `${new Date().toISOString()} Pharos server listening on http://localhost:${info.port} (db: ${dbPath})`,
    );
    console.log(`MCP endpoint: http://localhost:${info.port}/mcp`);
    if (serveWeb) console.log(`Web app: http://localhost:${info.port}`);
    console.log(
      {
        default: `Answering questions with ${agent.agentName} (change it in Settings); each answer counts toward its usage (log: ${agentLog}; PHAROS_AGENT_COMMAND=off to stop)`,
        custom: `Answering questions with: ${setup.command} (log: ${agentLog})`,
        off: 'Not answering questions automatically (PHAROS_AGENT_COMMAND=off)',
        unavailable:
          'Not answering questions automatically: install Claude Code or Codex, or set PHAROS_AGENT_COMMAND',
      }[setup.mode],
    );
    // Find files moved while Pharos was off: rescan the folders in Settings in the background, a
    // moment after start, one at a time (R7.9). It logs its own errors and never stops the server.
    setTimeout(() => {
      files.rescanAll().catch((error: unknown) => console.error('[pharos] rescan failed:', error));
      // And read Claude Code's transcripts once, so Settings → Agent permissions opens fast.
      permissions.warm();
    }, 3000);
  },
);
// A socket handed to the 'upgrade' listener has no error listener of Node's left, and
// @hono/node-server writes its refusal (403, 409) to it: a client that resets first would end the
// server with an uncaught EPIPE. Ours stays on every connection, so that write fails quietly.
server.on('connection', (socket) => {
  socket.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET')
      console.error('[pharos] socket error:', error);
  });
});
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[pharos] Port ${port} is already in use. Is Pharos already running, maybe as a background ` +
        'service (pnpm service status)? Stop it, or start this one with another PORT.',
    );
    process.exit(1);
  }
  throw error;
});
