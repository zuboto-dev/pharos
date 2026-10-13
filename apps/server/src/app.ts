import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ApplyInput, Author, EntityType, agentLabel, type HealthResponse } from '@pharos/schema';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentRunner, AgentStatus } from './agent-runner.js';
import { RevisionFeed } from './feed.js';
import { artifactFileRoutes, linkArtifacts, watchArtifactLinks } from './files/artifact-file.js';
import { folderRequestRoutes } from './files/requests.js';
import { fileRoutes } from './files/routes.js';
import { FileService } from './files/service.js';
import { z } from 'zod';
import { folderRoutes, type FolderRouteOptions } from './files/folders.js';
import { createMcpServer } from './mcp.js';
import { Presence, watchAgentRevisions } from './presence.js';
import { AgentFiles } from './store/agent-files.js';
import { PharosError, formatPath } from './store/errors.js';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { VERSION } from './version.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocal(value: string | undefined, parse: (v: string) => string): boolean {
  if (!value) return true;
  try {
    return LOCAL_HOSTS.has(parse(value));
  } catch {
    return false;
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
  /** Who is working where (v0.2 B5); shared with the answering agent. Made here when absent. */
  presence?: Presence;
};

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

  // Pharos is local-only: refuse requests that didn't come from a localhost page or client,
  // which also blocks DNS-rebinding attacks from websites.
  app.use(async (c, next) => {
    // The node adapter builds the request URL from the Host header.
    const hostOk = LOCAL_HOSTS.has(new URL(c.req.url).hostname);
    const originOk = isLocal(c.req.header('origin'), (o) => new URL(o).hostname);
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

  // Live updates: one `revision` event per new revision, with the projects it touched.
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      // A write fails once the browser has gone (a closed tab, a reload); that rejection must not
      // escape from a feed callback, and the abort handler below cleans up.
      const send = (message: Parameters<typeof stream.writeSSE>[0]) =>
        stream.writeSSE(message).catch(() => {});
      const unsubscribe = feed.subscribe((event) => {
        void send({ event: 'revision', data: JSON.stringify(event), id: String(event.id) });
      });
      // The question-answering agent's status (when one is configured).
      const unwatchAgent = agent?.onChange((status) => {
        void send({ event: 'agent', data: JSON.stringify(status) });
      });
      // Which agent works where right now (v0.2 B5): the whole state, on every change.
      const unwatchPresence = presence.subscribe((state) => {
        void send({ event: 'presence', data: JSON.stringify(state) });
      });
      stream.onAbort(() => {
        unsubscribe();
        unwatchAgent?.();
        unwatchPresence();
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
      unwatchAgent?.();
      unwatchPresence();
    }),
  );

  // Which agent works where right now (also sent on the feed as `presence`).
  api.get('/presence', (c) => c.json(presence.state()));

  // Whether questions asked here are answered automatically (PHAROS_AGENT_COMMAND).
  const agentStatus = (): AgentStatus =>
    agent?.status() ?? {
      configured: false,
      enabled: true,
      mode: 'unavailable',
      running: false,
      answering: [],
      queued: [],
    };
  api.get('/agent', (c) => c.json(agentStatus()));

  // Settings: what this server uses, and the few things the web app can change. The answering
  // command itself only comes from the environment; Settings can only pause or resume it.
  api.get('/settings', (c) => {
    const port = info.port ?? 4300;
    return c.json({
      version: VERSION,
      dataPath: info.dataPath ?? null,
      port,
      mcpUrl: `http://localhost:${port}/mcp`,
      projects: store.list('project').length,
      revisions: store.latestRevisionId(),
      agent: agentStatus(),
    });
  });

  api.put('/settings/agent', async (c) => {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    if (!agent?.configured)
      throw new PharosError('invalid', 'No answering agent is set up on this server');
    agent.setEnabled(body.enabled);
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

  // Project files (R7.2): scan, serve read-only, reveal and open.
  const files = info.files ?? new FileService(store);

  api.post('/apply', async (c) => {
    const input = ApplyInput.parse(await c.req.json()) as ApplyInput;
    const author = authorOf(c);
    // A person moves a file only to a scanned path in an approved folder (R7.9); the store
    // refuses agents any change to where a file is.
    return c.json(
      store.apply(author, author.kind === 'agent' ? input : await files.checkPersonEdits(input)),
    );
  });

  api.get('/projects/:id/data', (c) => {
    const dataset = store.dataset(c.req.param('id'));
    return c.json(declaresAgent(c) ? new AgentFiles(store).dataset(dataset) : dataset);
  });

  api.get('/projects/:id/snapshot', (c) => c.json(projectSnapshot(store, c.req.param('id'))));

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
    return transport.handleRequest(c.req.raw);
  });

  // The built web app, so one process can serve the whole thing (see `pnpm service`). Files are
  // served as they are; any other page path gets index.html for the client-side router.
  if (info.webDir) {
    const files = serveStatic({ root: info.webDir });
    const page = serveStatic({ root: info.webDir, path: 'index.html' });
    app.use('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : files(c, next)));
    app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : page(c, next)));
  }

  return app;
}
