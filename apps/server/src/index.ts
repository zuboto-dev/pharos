import { serve } from '@hono/node-server';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRunner, agentMcpConfig, agentSetup, shellRunner } from './agent-runner.js';
import { createApp } from './app.js';
import { RevisionFeed } from './feed.js';
import { answerBrief } from './guidance.js';
import { defaultDatabasePath, openDatabase } from './store/database.js';
import { Store } from './store/store.js';
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
const feed = new RevisionFeed(store);
// Answer questions asked in the web app by running an agent: PHAROS_AGENT_COMMAND, or Claude Code
// when it is installed. PHAROS_AGENT_COMMAND=off turns it off.
const serverUrl = `http://localhost:${port}`;
// The built server (dist/) also serves the built web app, so a background service is the whole
// app at one address. The dev server leaves that to Vite.
const here = fileURLToPath(import.meta.url);
const webDir = resolve(dirname(here), '../../web/dist');
const serveWeb = /[\\/]dist[\\/]/.test(here) && existsSync(join(webDir, 'index.html'));
if (serveWeb) process.env.PHAROS_WEB_URL ??= serverUrl;
const agentLog = process.env.PHAROS_AGENT_LOG ?? join(homedir(), '.pharos', 'agent.log');
const mcpConfigPath = join(dirname(agentLog), 'agent-mcp.json');
const setup = agentSetup(process.env.PHAROS_AGENT_COMMAND, {
  hasClaude: spawnSync('sh', ['-c', 'command -v claude'], { stdio: 'ignore' }).status === 0,
  mcpConfigPath,
});
if (setup.mode === 'default') {
  mkdirSync(dirname(mcpConfigPath), { recursive: true });
  writeFileSync(mcpConfigPath, agentMcpConfig(serverUrl));
}
const agent = new AgentRunner(store, {
  command: setup.command,
  runner: shellRunner(agentLog),
  serverUrl,
  mode: setup.mode,
  logPath: agentLog,
  prompt: (projectIds) => answerBrief(store, projectIds),
});
if (agent.configured) agent.watch(feed);
const app = createApp(store, feed, agent, {
  dataPath: dbPath,
  port,
  ...(serveWeb ? { webDir, buildId: webBuildId(webDir) } : {}),
});

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(
    `${new Date().toISOString()} Pharos server listening on http://localhost:${info.port} (db: ${dbPath})`,
  );
  console.log(`MCP endpoint: http://localhost:${info.port}/mcp`);
  if (serveWeb) console.log(`Web app: http://localhost:${info.port}`);
  console.log(
    {
      default: `Answering questions with Claude Code; each answer counts toward its usage (log: ${agentLog}; PHAROS_AGENT_COMMAND=off to stop)`,
      custom: `Answering questions with: ${setup.command} (log: ${agentLog})`,
      off: 'Not answering questions automatically (PHAROS_AGENT_COMMAND=off)',
      unavailable:
        'Not answering questions automatically: install Claude Code or set PHAROS_AGENT_COMMAND',
    }[setup.mode],
  );
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
