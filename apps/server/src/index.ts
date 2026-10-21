import { serve } from '@hono/node-server';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRunner, agentMcpConfig, agentSetup, shellRunner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { FileService } from './files/service.js';
import { answerBrief } from './guidance.js';
import { Presence } from './presence.js';
import { defaultDatabasePath, openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { seenMarks } from './views/freshness.js';
import { scheduleAssetPurge } from './views/report.js';
import { webBuildId } from './version.js';

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
const installed = (name: string) =>
  spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;
const setup = agentSetup(process.env.PHAROS_AGENT_COMMAND, {
  hasClaude: installed('claude'),
  hasCodex: installed('codex'),
  mcpConfigPath,
  serverUrl,
});
if (setup.mode === 'default' && setup.commands.claude) {
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
});

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
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
  }, 3000);
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
