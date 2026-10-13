import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ApplyInput, Author, EntityType, type HealthResponse } from '@pharos/schema';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentRunner, AgentStatus } from './agent-runner.js';
import { RevisionFeed } from './feed.js';
import { fileRoutes } from './files/routes.js';
import { FileService } from './files/service.js';
import { z } from 'zod';
import { createMcpServer } from './mcp.js';
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

/** The acting author for REST writes: `X-Pharos-Author: human:me` or `agent:<name>`. */
function authorOf(c: Context): Author {
  const header = c.req.header('x-pharos-author');
  if (!header) return { kind: 'human', name: 'me' };
  const [kind, ...name] = header.split(':');
  return Author.parse({ kind, name: name.join(':') });
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
  /** Project files on disk (R7.2); tests pass one with a fake `open`. */
  files?: FileService;
};

export function createApp(
  store: Store,
  feed = new RevisionFeed(store),
  agent?: AgentRunner,
  info: ServerInfo = {},
) {
  const app = new Hono();

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
      stream.onAbort(() => {
        unsubscribe();
        unwatchAgent?.();
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
      // Keep the connection alive through proxies until the client goes away.
      while (!stream.aborted) {
        await stream.sleep(25_000);
        if (!stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
      unwatchAgent?.();
    }),
  );

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
    return c.json(store.list(type, { projectId, where }));
  });

  api.get('/entities/:type/:id', (c) => {
    const type = EntityType.parse(c.req.param('type'));
    return c.json(store.getOfType(type, c.req.param('id')));
  });

  api.post('/apply', async (c) => {
    const input = ApplyInput.parse(await c.req.json()) as ApplyInput;
    return c.json(store.apply(authorOf(c), input));
  });

  api.get('/projects/:id/data', (c) => c.json(store.dataset(c.req.param('id'))));

  api.get('/projects/:id/snapshot', (c) => c.json(projectSnapshot(store, c.req.param('id'))));

  api.get('/history', (c) => {
    const q = c.req.query();
    return c.json(
      store.history({
        projectId: q.projectId,
        entityId: q.entityId,
        limit: q.limit ? IntParam.parse(q.limit) : undefined,
        before: q.before ? IntParam.parse(q.before) : undefined,
        after: q.after ? IntParam.parse(q.after) : undefined,
        authorKind: q.authorKind ? Author.shape.kind.parse(q.authorKind) : undefined,
      }),
    );
  });

  api.get('/revisions/:id', (c) => {
    const id = IntParam.parse(c.req.param('id'));
    const revision = store.revision(id);
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
    return c.json(
      store.diff({
        from: IntParam.parse(q.from ?? 0),
        to: q.to ? IntParam.parse(q.to) : undefined,
        projectId: q.projectId,
      }),
    );
  });

  // Project files: scan, serve read-only, reveal and open (R7.2).
  const files = info.files ?? new FileService(store);
  api.route('/', fileRoutes(files));

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
      const created = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => void sessions.set(id, created),
        onsessionclosed: (id) => void sessions.delete(id),
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
      };
      await createMcpServer(store).connect(created);
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
