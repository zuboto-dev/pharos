import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  ACTION_HTTP_STATUS,
  ApplyInput,
  AskOwner,
  RunReport,
  Author,
  EntityType,
  agentLabel,
  NotificationPrefs,
  type HealthResponse,
} from '@pharos/schema';
import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import { upgradeWebSocket } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ActionService } from './actions/service.js';
import {
  AGENT_PRESETS,
  PRESET_LABELS,
  type AgentRunner,
  type AgentStatus,
} from './agent-runner.js';
import { RevisionFeed } from './feed.js';
import { search } from './search.js';
import { Notifications } from './notifications.js';
import { artifactFileRoutes, linkArtifacts, watchArtifactLinks } from './files/artifact-file.js';
import { folderRequestRoutes } from './files/requests.js';
import { fileRoutes } from './files/routes.js';
import { FileService } from './files/service.js';
import { z } from 'zod';
import { folderRoutes, type FolderRouteOptions } from './files/folders.js';
import { MCP_ASSET_NOTE } from './guidance.js';
import { createMcpServer } from './mcp.js';
import { RunLog, askOwner, deskAnswer, deskOf } from './desk.js';
import { landedSince, markDeskSeen } from './landed.js';
import { folderBriefs, projectBrief } from './brief.js';
import { updatesOf } from './updates.js';
import { Presence, watchAgentRevisions } from './presence.js';
import { PackApplyInput, applyPack, listPacks } from './packs/service.js';
import { agentViewOpsIssue } from './views/block-ask.js';
import { changedViews, markSeen, projectFreshness } from './views/freshness.js';
import {
  APP_PAGE_HEADERS,
  isPageRead,
  lockPageResponses,
  reportRoutes,
} from './views/report-routes.js';
import { AgentFiles } from './store/agent-files.js';
import { PharosError, formatPath } from './store/errors.js';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { VERSION } from './version.js';
import { PermissionAsks } from './permissions/asks.js';
import { permissionAskRoutes, permissionRoutes } from './permissions/routes.js';
import type { PermissionAsk } from '@pharos/schema';
import { PermissionService } from './permissions/service.js';
import { LOCAL_HOSTS, terminalPlaceRefusal, terminalSocketRefusal } from './terminal/guard.js';
import type { TerminalService, TerminalStatus } from './terminal/service.js';
import type { TerminalClient } from './terminal/sessions.js';

/** What the panel sends: typed input, its size, or a restart. Never a command. */
const TerminalClientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('i'), d: z.string().max(65_536) }),
  z.object({ t: z.literal('r'), cols: z.number(), rows: z.number() }),
  z.object({ t: z.literal('restart') }),
  // The panel checks the connection is alive (a laptop asleep can leave it dead without a word).
  z.object({ t: z.literal('ping') }),
  z.object({ t: z.literal('stop') }),
]);

function terminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  return { cols: clamp(cols, 20, 500, 100), rows: clamp(rows, 5, 200, 30) };
}

function isLocal(value: string | undefined, parse: (v: string) => string): boolean {
  if (!value) return true;
  try {
    return LOCAL_HOSTS.has(parse(value));
  } catch {
    return false;
  }
}

/** The owner's address for Pharos when it isn't a local one (see `ServerInfo.webUrl`). */
function webAddress(webUrl: string | undefined): URL | undefined {
  if (!webUrl) return undefined;
  try {
    const url = new URL(webUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return LOCAL_HOSTS.has(url.hostname) ? undefined : url;
  } catch {
    return undefined;
  }
}

/**
 * The acting author for REST writes: `X-Pharos-Author: human:me` or `agent:<name>` (only Pharos
 * itself writes as `system`).
 */
function authorOf(c: Context): Author {
  const header = c.req.header('x-pharos-author');
  if (!header) return { kind: 'human', name: 'me' };
  const [kind, ...name] = header.split(':');
  const author = Author.parse({ kind, name: name.join(':') });
  if (author.kind === 'system')
    throw new PharosError('invalid', 'X-Pharos-Author: use human:<name> or agent:<name>');
  return author;
}

/**
 * Whether a request declares an agent (R7.9): any `X-Pharos-Author` that isn't `human:…`, so a
 * malformed one gets the agent's view rather than the owner's. Agents then see over REST exactly
 * what MCP shows them (AgentFiles) and are refused the owner's file and folder routes.
 *
 * The header is a declared role, not authentication: a local process that leaves it out is
 * served as the owner. It keeps well-behaved agents (the answering agent, scripts following
 * CLAUDE.md) to what the owner shares; a guarantee against an agent impersonating the owner
 * needs separately authenticated owner and agent access.
 */
function declaresAgent(c: Context): boolean {
  const header = c.req.header('x-pharos-author');
  return header !== undefined && header.split(':')[0] !== 'human';
}

const forbidden = (c: Context, message: string) =>
  c.json({ error: { code: 'forbidden', message } }, 403);

const notFound = (c: Context, message: string) =>
  c.json({ error: { code: 'not_found', message } }, 404);

function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Owner-only routes (files on disk, folders, scans, adding files): what an agent gets instead. */
function agentRefusal(c: Context, store: Store): Response | undefined {
  const path = c.req.path.replace(/^\/api/, '');
  const owner = 'Only the owner uses this in Pharos; agents see project files with MCP tools';
  const file = /^\/files\/([^/]+)(\/.*)?$/.exec(path);
  if (file) {
    // A file agents can't see doesn't exist for them; the rest is the owner's (paths, contents).
    const entity = store.get(decoded(file[1]!));
    const seen = entity?.type === 'file' && new AgentFiles(store).visible(entity.id);
    return seen ? forbidden(c, owner) : notFound(c, 'file not found');
  }
  const artifact = /^\/artifacts\/([^/]+)\/file$/.exec(path);
  if (artifact) {
    const entity = store.get(decoded(artifact[1]!));
    const seen = entity?.type === 'artifact' && new AgentFiles(store).visible(entity.id);
    return seen ? forbidden(c, owner) : notFound(c, 'artifact not found');
  }
  if (
    (path === '/settings/folders' && (c.req.method === 'GET' || c.req.method === 'HEAD')) ||
    // Folder requests are answered by the owner only; agents check theirs over MCP (R7.12).
    /^\/settings\/folder-requests(\/.*)?$/.test(path) ||
    /^\/projects\/[^/]+\/mentioned-files$/.test(path) ||
    /^\/settings\/folders\/[^/]+\/scan$/.test(path) ||
    /^\/projects\/[^/]+\/scanned-files$/.test(path) ||
    (/^\/projects\/[^/]+\/files$/.test(path) && c.req.method === 'POST')
  )
    return forbidden(c, owner);
  return undefined;
}

const STATUS = { invalid: 400, not_found: 404, conflict: 409 } as const;

const IntParam = z.coerce.number().int();

/** Where this server keeps its data and listens, shown in Settings. */
export type ServerInfo = {
  dataPath?: string;
  port?: number;
  /** A built web app to serve from this process (its index.html answers every page route). */
  webDir?: string;
  /** Identifies the web app build being served (see `webBuildId`), sent to tabs on connect. */
  buildId?: string;
  /** Folders on the Settings page (R7.3): the home folder to guard (tests pass a temp dir). */
  folders?: Pick<FolderRouteOptions, 'home'>;
  /** Project files on disk (R7.2); tests pass one with a fake `open`. */
  files?: FileService;
  /** Running as the launchd background service (`pnpm service`), for Settings (W7.10). */
  service?: boolean;
  /** Who is working where (v0.2 B5); shared with the answering agent. Made here when absent. */
  presence?: Presence;
  /**
   * The address the owner opens Pharos at (`PHAROS_WEB_URL`). When it isn't a local one (Pharos
   * behind a tunnel with a login in front, e.g. https://pharos.example.com), the local-only guard also
   * accepts that host and that exact origin.
   */
  webUrl?: string;
  /** The agent terminal (R17); without it the panel says it is unavailable. */
  terminal?: TerminalService;
  /** What Pharos tells the owner (index.ts starts its sources); made here, idle, when absent. */
  notifications?: Notifications;
  /** Claude Code permissions (Settings): tests pass one with a temp home; never the real one. */
  permissions?: PermissionService;
  /** Live permission asks (the hook); tests make one with a short wait. */
  permissionAsks?: (
    service: PermissionService,
    onAsk: (ask: PermissionAsk) => void,
  ) => PermissionAsks;
};

/** Responses that stream and must never be held back for compression. */
const STREAMED = /^\/(?:mcp|api\/events|api\/projects\/[^/]+\/terminal\/socket)(?:\/|$)/;

export function createApp(
  store: Store,
  feed = new RevisionFeed(store),
  agent?: AgentRunner,
  info: ServerInfo = {},
) {
  const app = new Hono();
  // Agents' presence marks (v0.2 B5): from the view tools, from agents' revisions (any process),
  // and from the answering run. Not project data; sent on the change feed as `presence`.
  const presence = info.presence ?? new Presence();
  watchAgentRevisions(store, feed, presence);
  const notifications = info.notifications ?? new Notifications(store, new RunLog(store));

  // Text goes compressed when the browser accepts it (project data, the app's scripts and styles:
  // about a fifth of the size over the network, to a phone). Never the live feed, the terminal
  // socket or MCP, which stream; `compress` leaves pictures and other binary types alone.
  const squeeze = compress();
  app.use('*', (c, next) =>
    STREAMED.test(c.req.path) || c.req.header('upgrade') ? next() : squeeze(c, next),
  );

  // Every response under /api/views/:id/page carries the report page's locked headers (R13.6),
  // the refusals below included.
  const web = webAddress(info.webUrl);
  app.use(lockPageResponses(web));

  // Pharos is local-only: refuse requests that didn't come from a localhost page or client,
  // which also blocks DNS-rebinding attacks from websites.
  app.use(async (c, next) => {
    // The node adapter builds the request URL from the Host header.
    const url = new URL(c.req.url);
    const hostOk = LOCAL_HOSTS.has(url.hostname) || url.hostname === web?.hostname;
    // A report page runs in a sandboxed frame with an opaque origin: its fonts and module scripts
    // come with "Origin: null" (R13). Only reads of the page and its assets accept it.
    const origin = c.req.header('origin');
    const originOk =
      isLocal(origin, (o) => new URL(o).hostname) ||
      (web !== undefined && origin === web.origin) ||
      (origin === 'null' && isPageRead(c.req.method, url.pathname));
    if (!hostOk || !originOk)
      return c.json({ error: { code: 'forbidden', message: 'Non-local request' } }, 403);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof PharosError) {
      return c.json(
        { error: { code: err.code, message: err.message, issues: err.issues } },
        STATUS[err.code],
      );
    }
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${formatPath(i.path)}: ${i.message}`);
      return c.json({ error: { code: 'invalid', message: 'Invalid request', issues } }, 400);
    }
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  const api = new Hono();

  // Agents (by their declared author) never reach the owner's file and folder routes (R7.9).
  api.use(async (c, next) => {
    const refusal = declaresAgent(c) ? agentRefusal(c, store) : undefined;
    if (refusal) return refusal;
    await next();
  });

  api.get('/health', (c) =>
    c.json({
      status: 'ok',
      name: 'pharos',
      version: VERSION,
      time: new Date().toISOString(),
    } satisfies HealthResponse),
  );

  // Live updates: one `revision` event per new revision, with the projects it touched, and
  // `report-assets` when files of a report page are uploaded.
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      // A write fails once the browser has gone (a closed tab, a reload); that rejection must not
      // escape from a feed callback, and the abort handler below cleans up.
      const send = (message: Parameters<typeof stream.writeSSE>[0]) =>
        stream.writeSSE(message).catch(() => {});
      const unsubscribe = feed.subscribe((event) => {
        void send({ event: 'revision', data: JSON.stringify(event), id: String(event.id) });
      });
      // New files on a report page (not revisions): an open frame of that view reloads (R13.5).
      const unwatchAssets = feed.subscribeAssets((event) => {
        void send({ event: 'report-assets', data: JSON.stringify(event) });
      });
      // The question-answering agent's status (when one is configured).
      const unwatchAgent = agent?.onChange((status) => {
        void send({ event: 'agent', data: JSON.stringify(status) });
      });
      // Which agent works where right now (v0.2 B5): the whole state, on every change.
      const unwatchPresence = presence.subscribe((state) => {
        void send({ event: 'presence', data: JSON.stringify(state) });
      });
      // What Pharos tells the owner (a desk item, a failed run, …): the bell and the toasts.
      const unwatchNotifications = notifications.subscribe((n) => {
        void send({ event: 'notification', data: JSON.stringify(n) });
      });
      stream.onAbort(() => {
        unsubscribe();
        unwatchAssets();
        unwatchAgent?.();
        unwatchPresence();
        unwatchNotifications();
      });
      await stream.writeSSE({
        event: 'ready',
        // `version` and `build` let an open tab notice, on reconnecting after an update, that
        // it is running old code.
        data: JSON.stringify({
          latest: store.latestRevisionId(),
          version: VERSION,
          ...(info.buildId ? { build: info.buildId } : {}),
        }),
      });
      await stream.writeSSE({ event: 'presence', data: JSON.stringify(presence.state()) });
      // Keep the connection alive through proxies until the client goes away.
      while (!stream.aborted) {
        await stream.sleep(25_000);
        if (!stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
      unwatchAssets();
      unwatchAgent?.();
      unwatchPresence();
      unwatchNotifications();
    }),
  );

  // Notifications and how they reach the owner: the owner's own (app settings and an operational
  // log, never revisions, never over MCP); agents are refused.
  const ownerOnly = 'Notifications are the owner’s own';
  api.get('/notifications', (c) => {
    if (declaresAgent(c)) return forbidden(c, ownerOnly);
    const q = c.req.query();
    return c.json(
      notifications.list({
        since: q.since !== undefined ? IntParam.parse(q.since) : undefined,
        limit: q.limit !== undefined ? IntParam.parse(q.limit) : undefined,
      }),
    );
  });
  api.post('/notifications/read', async (c) => {
    if (declaresAgent(c)) return forbidden(c, ownerOnly);
    const body = z
      .object({ ids: z.array(z.number().int()).max(500).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const changed = notifications.markRead(body.ids);
    return c.json({ changed, unread: notifications.list({ limit: 1 }).unread });
  });
  api.get('/settings/notifications', (c) => {
    if (declaresAgent(c)) return forbidden(c, ownerOnly);
    return c.json(notifications.prefs());
  });
  api.put('/settings/notifications', async (c) => {
    if (declaresAgent(c)) return forbidden(c, ownerOnly);
    return c.json(notifications.setPrefs(NotificationPrefs.parse(await c.req.json())));
  });

  // Which agent works where right now (also sent on the feed as `presence`).
  api.get('/presence', (c) => c.json(presence.state()));

  // Whether questions asked here are answered automatically (PHAROS_AGENT_COMMAND).
  const agentStatus = (): AgentStatus =>
    agent?.status() ?? {
      configured: false,
      enabled: false,
      paused: false,
      state: 'unavailable',
      mode: 'unavailable',
      presets: AGENT_PRESETS.map((id) => ({ id, label: PRESET_LABELS[id], installed: false })),
      running: false,
      answering: [],
      queued: [],
    };
  api.get('/agent', (c) => c.json(agentStatus()));

  // Settings: what this server uses, and the few things the web app can change. The answering
  // command itself only comes from the environment; Settings can pause or resume it and pick one
  // of the installed built-in agents (`preset`), unless PHAROS_AGENT_COMMAND decides.
  api.get('/settings', (c) => {
    const port = info.port ?? 4300;
    return c.json({
      version: VERSION,
      dataPath: info.dataPath ?? null,
      port,
      mcpUrl: `http://localhost:${port}/mcp`,
      projects: store.list('project').length,
      revisions: store.latestRevisionId(),
      service: info.service ?? false,
      agent: agentStatus(),
    });
  });

  api.put('/settings/agent', async (c) => {
    const body = z
      .object({ enabled: z.boolean().optional(), preset: z.string().optional() })
      .refine((b) => b.enabled !== undefined || b.preset !== undefined, 'Send enabled or preset')
      .parse(await c.req.json());
    // Which agent answers is the owner's choice, never an agent's.
    if (body.preset !== undefined && declaresAgent(c))
      return forbidden(c, 'Only the owner chooses which agent answers questions');
    if (!agent?.configured)
      throw new PharosError('invalid', 'No answering agent is set up on this server');
    if (body.preset !== undefined) agent.setPreset(body.preset);
    if (body.enabled !== undefined) agent.setEnabled(body.enabled);
    return c.json(agent.status());
  });

  api.post('/agent/answer-waiting', (c) => {
    if (!agent?.configured || !agent.enabled) throw new PharosError('invalid', 'Answering is off');
    return c.json({ questions: agent.answerWaiting() });
  });

  api.get('/entities/:type', (c) => {
    const type = EntityType.parse(c.req.param('type'));
    const { projectId, ...where } = c.req.query();
    if (declaresAgent(c)) return c.json(new AgentFiles(store).list(type, { projectId, where }));
    return c.json(store.list(type, { projectId, where }));
  });

  api.get('/entities/:type/:id', (c) => {
    const type = EntityType.parse(c.req.param('type'));
    const id = c.req.param('id');
    if (!declaresAgent(c)) return c.json(store.getOfType(type, id));
    // Hidden and missing read the same to an agent.
    const entity = store.get(id);
    const seen = entity?.type === type ? new AgentFiles(store).entity(entity) : null;
    if (!seen) throw new PharosError('not_found', `${type} not found`);
    return c.json(seen);
  });

  // Search everything (⌘K): projects and their items by their words, never files' contents.
  // Agents see what AgentFiles shows them (no files at all).
  api.get('/search', (c) => {
    const q = c.req.query();
    return c.json(
      search(store, q.q ?? '', {
        limit: q.limit !== undefined ? IntParam.parse(q.limit) : undefined,
        forAgent: declaresAgent(c),
      }),
    );
  });

  // Project files (R7.2): scan, serve read-only, reveal and open.
  const files = info.files ?? new FileService(store);

  api.post('/apply', async (c) => {
    const input = ApplyInput.parse(await c.req.json()) as ApplyInput;
    const author = authorOf(c);
    // An agent answering "ask about this block" changes only that block (R10.8), here as in
    // view_update.
    const blockIssue = author.kind === 'agent' ? agentViewOpsIssue(store, input.operations) : null;
    if (blockIssue) throw new PharosError('invalid', blockIssue);
    // A person moves a file only to a scanned path in an approved folder (R7.9); the store
    // refuses agents any change to where a file is.
    return c.json(
      store.apply(author, author.kind === 'agent' ? input : await files.checkPersonEdits(input)),
    );
  });

  // Packs (R8): start a project for a car, money, … from data, in one revision.
  api.get('/packs', (c) => c.json(listPacks()));
  api.post('/packs/apply', async (c) =>
    c.json(applyPack(store, authorOf(c), PackApplyInput.parse(await c.req.json()))),
  );

  // Record-form actions (R10): "Log a service", "Mark paid". One submission, one revision; the
  // result says done, duplicate, invalid, stale, not_found or failed (with its HTTP status).
  const actions = new ActionService(store);
  api.post('/projects/:id/actions', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const projectId = c.req.param('id');
    const raw =
      body && typeof body === 'object' && !Array.isArray(body)
        ? { projectId, ...(body as Record<string, unknown>) }
        : body;
    if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).projectId !== projectId)
      return c.json(
        {
          v: 1,
          status: 'invalid',
          message: 'The form belongs to another project',
          fieldErrors: { form: 'projectId does not match the address' },
        },
        400,
      );
    const result = actions.run(authorOf(c), raw);
    return c.json(result, ACTION_HTTP_STATUS[result.status]);
  });

  api.get('/projects/:id/data', (c) => {
    const dataset = store.dataset(c.req.param('id'));
    return c.json(declaresAgent(c) ? new AgentFiles(store).dataset(dataset) : dataset);
  });

  api.get('/projects/:id/snapshot', (c) => c.json(projectSnapshot(store, c.req.param('id'))));

  // The agent terminal (R17): the owner's own agent CLI in a panel beside the project, only on
  // this computer (terminal/guard.ts). Agents, the hosted address and other sites are refused.
  const header = (c: Context) => (name: string) =>
    c.req.header(name) ?? (name === 'host' ? new URL(c.req.url).host : undefined);
  const terminalStatus = (c: Context, projectId: string): TerminalStatus => {
    const place = terminalPlaceRefusal(header(c));
    if (place)
      return { available: false, reason: 'hosted', message: place.message, running: false };
    return (
      info.terminal?.status(projectId) ?? {
        available: false,
        reason: 'unsupported',
        message: 'This server has no agent terminal',
        running: false,
      }
    );
  };
  const projectOrThrow = (id: string) => {
    if (store.get(id)?.type !== 'project') throw new PharosError('not_found', 'project not found');
  };
  // The owner stops a project's agent from anywhere (the rail's list); local pages only.
  api.post('/projects/:id/terminal/stop', (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Agents can’t stop the owner’s terminal');
    const refusal = terminalSocketRefusal(header(c));
    if (refusal) return c.json({ error: { code: 'forbidden', message: refusal.message } }, 403);
    projectOrThrow(c.req.param('id'));
    return c.json({ stopped: info.terminal?.stopAgent(c.req.param('id')) ?? false });
  });
  // Which agents run now, so the app can show where one was opened (local panels only).
  api.get('/terminal/running', (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Agents can’t see the owner’s terminals');
    if (terminalPlaceRefusal(header(c))) return c.json([]);
    return c.json(info.terminal?.runningSessions() ?? []);
  });
  api.get('/projects/:id/terminal', (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Agents can’t open the owner’s terminal');
    projectOrThrow(c.req.param('id'));
    return c.json(terminalStatus(c, c.req.param('id')));
  });
  api.get(
    '/projects/:id/terminal/socket',
    async (c, next) => {
      const refusal = terminalSocketRefusal(header(c));
      if (refusal) return forbidden(c, refusal.message);
      projectOrThrow(c.req.param('id'));
      const status = terminalStatus(c, c.req.param('id'));
      if (!status.available)
        return c.json({ error: { code: 'unavailable', message: status.message } }, 409);
      await next();
    },
    upgradeWebSocket((c) => {
      const projectId = c.req.param('id')!;
      const terminal = info.terminal!;
      let size = terminalSize(c.req.query('cols'), c.req.query('rows'));
      let client: TerminalClient | undefined;
      // The session this panel is on (its project's folder), set when it attaches.
      let key: string | undefined;
      return {
        onOpen(_event, ws) {
          client = {
            send: (message) => {
              try {
                ws.send(JSON.stringify(message));
              } catch (error) {
                console.error('[pharos] Could not write to a terminal panel:', error);
              }
            },
            close: (code, reason) => ws.close(code, reason),
          };
          try {
            key = terminal.attach(projectId, client, size).key;
          } catch (error) {
            console.error('[pharos] Could not start the agent terminal:', error);
            client.send({ t: 'error', message: 'The agent could not start' });
            ws.close(1011, 'could not start');
          }
        },
        onMessage(event, ws) {
          try {
            const message = TerminalClientMessage.parse(JSON.parse(String(event.data)));
            if (message.t === 'ping') client?.send({ t: 'pong' });
            else if (message.t === 'stop') terminal.stopAgent(projectId);
            else if (message.t === 'i') {
              if (key) terminal.sessions?.input(key, message.d);
            } else if (message.t === 'r') {
              size = terminalSize(message.cols, message.rows);
              if (key) terminal.sessions?.resize(key, size);
            } else if (message.t === 'restart' && client) {
              const session = terminal.restart(projectId, size);
              // The project's folder changed since this panel attached: move it to the new one.
              if (session.key !== key) {
                if (key) terminal.sessions?.detach(key, client);
                key = terminal.attach(projectId, client, size).key;
              }
            }
          } catch (error) {
            console.error('[pharos] A terminal message failed:', error);
            if (error instanceof SyntaxError || error instanceof z.ZodError)
              ws.close(1003, 'bad message');
          }
        },
        onClose() {
          try {
            if (client && key) terminal.sessions?.detach(key, client);
          } catch (error) {
            console.error('[pharos] Could not detach a terminal panel:', error);
          }
        },
        onError(error) {
          console.error('[pharos] A terminal connection failed:', error);
        },
      };
    }),
  );

  // Freshness (R11): what changed on each page since the reader last looked, and which agent-built
  // pages are stale. The reader's own marks (app settings, never revisions): not for agents.
  const readerOnly = 'Seen marks and what changed since are the reader’s own; agents use history';
  api.get('/projects/:id/freshness', (c) => {
    if (declaresAgent(c)) return forbidden(c, readerOnly);
    const q = c.req.query();
    return c.json(
      projectFreshness(store, c.req.param('id'), {
        view: q.view,
        since: q.since !== undefined ? IntParam.parse(q.since) : undefined,
      }),
    );
  });
  api.get('/freshness', (c) => {
    if (declaresAgent(c)) return forbidden(c, readerOnly);
    return c.json(changedViews(store));
  });
  api.put('/views/:id/seen', async (c) => {
    if (declaresAgent(c)) return forbidden(c, readerOnly);
    // An empty body marks the latest revision; a body that isn't JSON is refused, never read as
    // "seen everything" (R11 review, gap 10).
    const text = await c.req.text();
    let json: unknown = {};
    try {
      if (text.trim()) json = JSON.parse(text);
    } catch {
      throw new PharosError('invalid', 'The body must be JSON: {"revision"?: number}');
    }
    const body = z.object({ revision: z.number().int().nonnegative().optional() }).parse(json);
    const viewId = c.req.param('id');
    return c.json({ viewId, seen: markSeen(store, viewId, body.revision) });
  });

  // Report pages (R13): the page and its assets for the frame; asset uploads and the asset list.
  api.route('/', reportRoutes(store, authorOf));

  // R16: the owner's desk across projects, and the runs it shows. Agents use the MCP tools; a
  // routine without MCP may report its run here. Only a person marks a run seen.
  const runs = new RunLog(store);
  api.get('/desk', (c) => c.json(deskOf(store, runs, { projectId: c.req.query('projectId') })));
  // A project's brief (or every project's in a folder: a session's start hook), as text.
  api.get('/projects/:id/brief', (c) => {
    if (store.get(c.req.param('id'))?.type !== 'project')
      throw new PharosError('not_found', 'project not found');
    return c.text(projectBrief(store, c.req.param('id'), { presence, runs }));
  });
  api.get('/brief', (c) => {
    const folder = c.req.query('folder');
    if (!folder) throw new PharosError('invalid', 'folder is required');
    return c.text(folderBriefs(store, folder, { presence, runs }).join('\n\n---\n\n'));
  });
  // What MCP ask_owner does, for runners without MCP (the routines): one call puts a decision
  // (with options) or a task on the owner's desk. projectId may be a project's id or its name.
  api.post('/desk/ask', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ref = typeof raw.projectId === 'string' ? raw.projectId : '';
    const byName = store.list('project').find((p) => p.data.name === ref);
    const input = AskOwner.parse({ ...raw, projectId: byName?.id ?? ref });
    return c.json(askOwner(store, authorOf(c), input));
  });
  api.post('/desk/answer', async (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Only the owner answers from the desk');
    const body = z
      .object({
        id: z.string(),
        chosenOptionId: z.string().optional(),
        note: z.string().max(2000).optional(),
        done: z.boolean().optional(),
        wontDo: z.boolean().optional(),
        later: z.string().optional(),
        reply: z.string().max(4000).optional(),
        decline: z.boolean().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(deskAnswer(store, authorOf(c), body));
  });
  // What agents landed since the owner last looked at the desk; opening the desk moves the mark.
  api.get('/desk/landed', (c) => c.json(landedSince(store)));
  api.put('/desk/seen', async (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Only the owner marks the desk seen');
    // The revision the desk showed (GET /desk/landed's `until`); an empty body marks the latest.
    const text = await c.req.text();
    let json: unknown = {};
    try {
      if (text.trim()) json = JSON.parse(text);
    } catch {
      throw new PharosError('invalid', 'The body must be JSON: {"revision"?: number}');
    }
    const body = z.object({ revision: z.number().int().nonnegative().optional() }).parse(json);
    return c.json({ seen: markDeskSeen(store, body.revision) });
  });
  // The Updates page: work sessions from revisions and agents' read calls (lookups), with a
  // week of counts for the tiles and timeline. Bounded: one page of revisions, older with `before`.
  api.get('/updates', (c) => {
    const q = c.req.query();
    return c.json(
      updatesOf(store, {
        since: q.since || undefined,
        before: q.before || undefined,
        projectId: q.projectId || undefined,
        author: q.author || undefined,
      }),
    );
  });
  api.get('/runs', (c) => {
    const q = c.req.query();
    return c.json(
      runs.list({ limit: q.limit ? IntParam.parse(q.limit) : undefined, projectId: q.projectId }),
    );
  });
  api.post('/runs', async (c) =>
    c.json(runs.report(authorOf(c), RunReport.parse(await c.req.json().catch(() => ({}))))),
  );
  api.post('/runs/:id/seen', (c) => {
    if (declaresAgent(c)) return forbidden(c, 'Only the owner marks a run seen');
    return c.json(runs.markSeen(c.req.param('id')));
  });

  api.get('/history', (c) => {
    const q = c.req.query();
    const files = declaresAgent(c) ? new AgentFiles(store) : null;
    if (files && q.entityId && !files.visible(q.entityId)) return c.json([]);
    const history = store.history({
      projectId: q.projectId,
      entityId: q.entityId,
      limit: q.limit ? IntParam.parse(q.limit) : undefined,
      before: q.before ? IntParam.parse(q.before) : undefined,
      after: q.after ? IntParam.parse(q.after) : undefined,
      authorKind: q.authorKind ? Author.shape.kind.parse(q.authorKind) : undefined,
    });
    return c.json(files ? files.revisions(history) : history);
  });

  api.get('/revisions/:id', (c) => {
    const id = IntParam.parse(c.req.param('id'));
    const found = store.revision(id);
    const [revision] = !found
      ? []
      : declaresAgent(c)
        ? new AgentFiles(store).revisions([found])
        : [found];
    if (!revision) throw new PharosError('not_found', `Revision ${id} not found`);
    return c.json(revision);
  });

  api.post('/revisions/:id/revert', async (c) => {
    const id = IntParam.parse(c.req.param('id'));
    const body = z
      .object({ message: z.string().optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(store.revert(id, authorOf(c), body.message));
  });

  api.get('/diff', (c) => {
    const q = c.req.query();
    const diffs = store.diff({
      from: IntParam.parse(q.from ?? 0),
      to: q.to ? IntParam.parse(q.to) : undefined,
      projectId: q.projectId,
    });
    return c.json(declaresAgent(c) ? new AgentFiles(store).diffs(diffs) : diffs);
  });

  // Claim sources on disk (R7.6): where an artifact's local path is among the project files.
  api.route('/', artifactFileRoutes(store));
  watchArtifactLinks(store, feed);
  api.route('/', fileRoutes(files));
  // Folders the owner shares with Pharos (R7.3): app settings, never reachable over MCP.
  api.route('/settings/folders', folderRoutes(store, { ...info.folders, scanner: files.scanner }));
  // Agents' folder requests (R7.12): the owner approves or declines them on the Pharos page.
  api.route(
    '/settings/folder-requests',
    folderRequestRoutes(store, {
      ...info.folders,
      scanner: files.scanner,
      // Once the new folder is scanned, the project's sources that point into it are linked. In
      // the background; it catches its own errors (a callback never stops the server).
      onApproved: (request, folder) => {
        if (!request.projectId) return;
        const projectId = request.projectId;
        void files.scanner
          .idle(folder.id)
          .then(() => linkArtifacts(store, projectId))
          .catch((error: unknown) =>
            console.error('[pharos] Could not link sources after a folder approval:', error),
          );
      },
    }),
  );

  // Claude Code permissions (Settings → Agent permissions): what agents keep asking for, and the
  // owner's Allow / Deny written to the folder's settings. Owner only, never over MCP.
  const permissions =
    info.permissions ?? new PermissionService(store, { home: info.folders?.home });
  // Live asks from the Claude Code hook: a notification for the owner (a gate: only they answer),
  // answered on the Permissions section of Settings.
  const permissionAsks =
    info.permissionAsks?.(permissions, notifyAsk) ??
    new PermissionAsks(permissions, { onAsk: notifyAsk });
  function notifyAsk(ask: PermissionAsk) {
    const where = ask.projects[0] ?? ask.displayFolder;
    notifications.add({
      key: `permission-ask:${ask.id}`,
      kind: 'desk',
      gate: true,
      title: `${where}: an agent asks permission. ${ask.summary}`,
      detail: `${ask.example} · ${ask.risk} risk · from ${ask.agent}`,
      ...(ask.projectId ? { projectId: ask.projectId } : {}),
      href: '/settings#permissions',
      action: 'Answer',
    });
  }
  api.route('/permissions', permissionRoutes(permissions, permissionAsks));
  api.route('/permission-asks', permissionAskRoutes(permissionAsks));

  app.route('/api', api);

  // MCP over streamable HTTP, one session per connected client.
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  app.all('/mcp', async (c) => {
    const sessionId = c.req.header('mcp-session-id');
    let transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      if (sessionId) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          404,
        );
      }
      // The session's presence marks go when it closes: the agent stopped (v0.2 B5).
      const presenceSource = `mcp:${randomUUID()}`;
      const mcp = createMcpServer(store, { home: info.folders?.home, presence, presenceSource });
      const stopped = () => {
        presence.clearSource(presenceSource);
        const name = mcp.server.getClientVersion()?.name;
        if (name) presence.clearSource(`revisions:${agentLabel(name)}`);
      };
      const created = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => void sessions.set(id, created),
        onsessionclosed: (id) => {
          sessions.delete(id);
          stopped();
        },
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
        stopped();
      };
      await mcp.connect(created);
      transport = created;
    }
    const res = await transport.handleRequest(c.req.raw);
    // The transport refuses bodies over 4 MB; say what to do instead (R13.6). Not raised: the
    // limit keeps one request from holding the server's memory.
    if (res.status === 413)
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `This MCP request is over 4 MB, more than Pharos takes over HTTP. ${MCP_ASSET_NOTE}`,
          },
          id: null,
        },
        413,
      );
    return res;
  });

  // The built web app, so one process can serve the whole thing (see `pnpm service`). Files are
  // served as they are; any other page path gets index.html for the client-side router.
  if (info.webDir) {
    // The app's pages carry APP_PAGE_HEADERS (R13.6): its frames may only show Pharos addresses,
    // so a report page that navigates its frame elsewhere is refused before anything is sent.
    app.use('*', async (c, next) => {
      await next();
      if (c.req.path.startsWith('/api/')) return;
      if (!(c.res.headers.get('content-type') ?? '').startsWith('text/html')) return;
      for (const [name, value] of Object.entries(APP_PAGE_HEADERS)) c.header(name, value);
    });
    // Vite names the app's scripts and styles by their content (/assets/name-hash.js): a new build
    // gets new names, so the browser keeps these for good; index.html is asked for each time.
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    const files = serveStatic({ root: info.webDir });
    const page = serveStatic({ root: info.webDir, path: 'index.html' });
    app.use('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : files(c, next)));
    app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : page(c, next)));
  }

  return app;
}
