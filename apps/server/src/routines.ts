import {
  ROUTINE_FILES,
  ROUTINE_LOG,
  RoutinesRun,
  RunnerAction,
  type RunnersView,
  RoutinesSave,
  currentRoutinesValue,
  describeRoutinesChange,
  routinesOf,
  type RoutinesChange,
  type RoutinesConfig,
  type RoutinesFolder,
  type RoutinesPharos,
  type RoutineProposalView,
  type RoutinesState,
} from '@pharos/schema';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import type { Store } from './store/store.js';
import { folderProjects } from './terminal/command.js';

// The Routines page's server side: Pharos proxies the Routines app (the engine behind the
// evening wrap-up, night run and morning report; its own server, README in its folder) so the
// owner manages it from Pharos. Owner only: agents are refused, and writes and runs need an
// explicit `X-Pharos-Author: human:…`. Nothing is stored here; every answer comes from Routines.

export const DEFAULT_ROUTINES_URL = 'http://127.0.0.1:4777';

/** How to start the Routines server, for the page when it isn't reachable. */
export const ROUTINES_START_HINT =
  'Start it with `python3 server.py` in the Routines folder (its launchd job `page` keeps it up; see its README).';
/** What to check when the Routines folder's bin/api.py doesn't answer. */
export const ROUTINES_COMMAND_HINT =
  'Check that the Routines folder is there (PHAROS_ROUTINES_DIR) and `python3 bin/api.py GET /api/state` answers in it.';

/**
 * One request to Routines answered by `bin/api.py` in its folder: the same API as server.py, one
 * process per request, nothing left running. Its envelope ({status, type, body}) becomes a Response.
 */
async function callCommand(
  dir: string,
  python: string,
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const input = typeof init?.body === 'string' ? init.body : '';
  const out = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      python,
      ['-I', join(dir, 'bin', 'api.py'), method, path],
      { cwd: dir, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
  const envelope = JSON.parse(out) as { status: number; type: string; body: unknown };
  const text =
    typeof envelope.body === 'string' && !envelope.type.startsWith('application/json')
      ? envelope.body
      : JSON.stringify(envelope.body);
  return new Response(text, {
    status: envelope.status,
    headers: { 'content-type': `${envelope.type}; charset=utf-8` },
  });
}

export type RoutinesOptions = {
  /** The Routines server (`PHAROS_ROUTINES_URL`); default http://127.0.0.1:4777. */
  url?: string;
  /**
   * The Routines folder whose `bin/api.py` answers each request (no server to keep running).
   * Used instead of `url` when given; index.ts passes it when the folder has bin/api.py and no
   * PHAROS_ROUTINES_URL is set.
   */
  dir?: string;
  /** The Python that runs bin/api.py (default python3). */
  python?: string;
  /** Tests pass a stub. */
  fetch?: typeof fetch;
  /** Per request; Routines answers locally, so a slow answer means it's stuck. */
  timeoutMs?: number;
};

/** Routines didn't answer (not running, timed out, or sent something unreadable). */
export class Unreachable extends Error {}

/** Routines (or Pharos's checks before it) refused a save. */
export class SaveRefused extends Error {
  constructor(
    readonly status: 400 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RoutinesClient = ReturnType<typeof createRoutinesClient>;

/** Talks to the Routines app: reads routines.json and saves checked edits into it. */
export function createRoutinesClient(options: RoutinesOptions = {}) {
  const dir = options.dir;
  const base = dir
    ? `bin/api.py in ${dir}`
    : (options.url || DEFAULT_ROUTINES_URL).replace(/\/+$/, '');
  const hint = dir ? ROUTINES_COMMAND_HINT : ROUTINES_START_HINT;
  const doFetch = options.fetch ?? fetch;
  // A command starts Python each time and reads git in every project: a little more time.
  const timeoutMs = options.timeoutMs ?? (dir ? 15000 : 4000);

  /** One call to Routines; network failures and timeouts become `Unreachable` with a reason. */
  async function call(path: string, init?: RequestInit): Promise<Response> {
    if (dir) {
      try {
        return await callCommand(dir, options.python ?? 'python3', path, init, timeoutMs);
      } catch (err) {
        const killed = (err as { killed?: boolean })?.killed;
        throw new Unreachable(
          killed
            ? `Routines (${base}) didn't answer within ${Math.round(timeoutMs / 1000)} s.`
            : `Routines (${base}) didn't answer: ${String((err as Error)?.message ?? err)
                .split('\n')[0]
                ?.slice(0, 200)}.`,
        );
      }
    }
    try {
      return await doFetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const name = (err as Error)?.name;
      const reason =
        name === 'TimeoutError' || name === 'AbortError'
          ? `Routines at ${base} didn't answer within ${Math.round(timeoutMs / 1000)} s.`
          : `Routines isn't running at ${base}.`;
      throw new Unreachable(reason);
    }
  }

  async function config(): Promise<RoutinesConfig> {
    const res = await call('/api/state');
    if (!res.ok) throw new Unreachable(`Routines at ${base} answered HTTP ${res.status}.`);
    const body = (await res.json().catch(() => null)) as { config?: RoutinesConfig } | null;
    if (!body?.config || !Array.isArray(body.config.projects))
      throw new Unreachable(`Routines at ${base} sent no routines.json.`);
    return body.config;
  }

  /**
   * Saves edits into routines.json: each edit names the value it changes, and the save is refused
   * when routines.json no longer holds it (changed on disk or in another tab). Returns what was
   * saved, in words; throws `SaveRefused` or `Unreachable`.
   */
  async function save(changes: RoutinesChange[]): Promise<string[]> {
    const conf = await config();
    const stale = changes.filter((ch) => !sameValue(currentRoutinesValue(conf, ch), ch.from));
    const missing = changes.filter(
      (ch) => 'project' in ch && !conf.projects.some((p) => p.name === ch.project),
    );
    const routineChanges = changes.filter((ch) => ch.field === 'routine');
    if (routineChanges.length && !Array.isArray(conf.routines))
      throw new SaveRefused(
        400,
        'invalid',
        'This Routines app keeps only the three built-in routines: update it to add or change routines.',
      );
    const badName = changes.find((ch) => ch.field === 'project' && ch.to && ch.to.name !== ch.name);
    if (badName && badName.field === 'project')
      throw new SaveRefused(400, 'invalid', `A project's name can't change (${badName.name})`);
    const badId = routineChanges.find((ch) => ch.to && ch.to.id !== ch.id);
    if (badId) throw new SaveRefused(400, 'invalid', `A routine's id can't change (${badId.id})`);
    if (missing.length)
      throw new SaveRefused(
        400,
        'invalid',
        `No project named ${missing.map((m) => 'project' in m && m.project).join(', ')}`,
      );
    if (stale.length)
      throw new SaveRefused(
        409,
        'conflict',
        `routines.json changed since the page loaded (${stale.map(describeRoutinesChange).join('; ')}). Reload and try again.`,
      );
    const next = applyChanges(conf, changes);
    // A removed project also leaves the routines that named it (the engine refuses unknown names).
    const routinesChanged =
      routineChanges.length > 0 ||
      (Array.isArray(conf.routines) && canonical(conf.routines) !== canonical(next.routines));
    const res = await call('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projects: next.projects,
        schedule: next.schedule,
        dispatch: next.dispatch,
        ...(routinesChanged ? { routines: next.routines } : {}),
      }),
    });
    if (!res.ok) {
      const answer = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        problems?: unknown;
      };
      const problems = Array.isArray(answer.problems) ? `: ${answer.problems.join('; ')}` : '';
      throw new SaveRefused(
        res.status === 400 ? 400 : 502,
        'upstream',
        `Routines didn't save (${typeof answer.error === 'string' ? answer.error : `HTTP ${res.status}`}${problems})`,
      );
    }
    return changes.map(describeRoutinesChange);
  }

  return { base, hint, call, config, save };
}

/** A request that declares an agent (any author that isn't `human:…`): never served here. */
function declaresAgent(c: Context): boolean {
  const header = c.req.header('x-pharos-author');
  return header !== undefined && header.split(':')[0] !== 'human';
}

/** Writes and runs change the owner's routines.json or start paid work: the owner must say so. */
function declaresOwner(c: Context): boolean {
  return /^human:./.test(c.req.header('x-pharos-author') ?? '');
}

const fail = (
  c: Context,
  status: 400 | 403 | 404 | 409 | 502 | 503,
  code: string,
  message: string,
) => c.json({ error: { code, message } }, status);

/**
 * Each Routines project's Pharos projects (by repository folder: one folder can hold several,
 * a project and its sub-projects; the `pm` project when no folder matches) and their report views
 * named after a routine ("Night run"), the newest when there are several.
 */
/**
 * Pharos's folders with a path (repositories), each with its main project: the one named like
 * the folder, else the first by order. The Routines page lists these, so new folders show up.
 */
export function foldersOf(store: Store): RoutinesFolder[] {
  const projects = store.list('project');
  return store
    .list('repository')
    .filter((r) => typeof r.data.path === 'string' && r.data.path.trim())
    .map((r) => {
      const own = projects
        .filter((p) => p.data.repositoryId === r.id)
        .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
      const main =
        own.find((p) => p.data.name.trim().toLowerCase() === r.data.name.trim().toLowerCase()) ??
        own[0];
      return {
        id: r.id,
        name: r.data.name,
        path: r.data.path!,
        ...(main ? { project: { id: main.id, name: main.data.name } } : {}),
      };
    });
}

export function pharosOf(store: Store, config: RoutinesConfig): Record<string, RoutinesPharos> {
  const routines = routinesOf(config);
  const out: Record<string, RoutinesPharos> = {};
  for (const project of config.projects) {
    let projects = project.path ? folderProjects(store, project.path) : [];
    const ref = project.pm?.type === 'pharos' ? project.pm.project : undefined;
    if (!projects.length && ref) {
      const match = store.list('project').find((p) => p.id === ref || p.data.name === ref);
      if (match) projects = [{ id: match.id, name: match.data.name }];
    }
    const ids = new Set(projects.map((p) => p.id));
    const views = store
      .list('view')
      .filter((v) => ids.has(v.data.projectId) && !v.data.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const reports = routines.flatMap((r) => {
      const view = views.find(
        (v) => v.data.name.trim().toLowerCase() === r.name.trim().toLowerCase(),
      );
      return view
        ? [
            {
              routine: r.id,
              name: view.data.name,
              href: `/projects/${view.data.projectId}/views/${view.id}`,
            },
          ]
        : [];
    });
    out[project.name] = { projects, reports };
  }
  return out;
}

export function routinesRoutes(
  client: RoutinesClient,
  store?: Store,
  proposals?: { settle: (retry?: boolean) => Promise<void>; pending: () => RoutineProposalView[] },
) {
  const { base, hint, call, config } = client;
  const app = new Hono();

  const unreachable = (c: Context, err: unknown) => {
    if (err instanceof Unreachable) return fail(c, 503, 'unavailable', `${err.message} ${hint}`);
    throw err;
  };

  // Agents never reach the owner's routines, not even to read them.
  app.use(async (c, next) => {
    if (declaresAgent(c)) return fail(c, 403, 'forbidden', 'Routines are the owner’s own');
    if (c.req.method !== 'GET' && !declaresOwner(c))
      return fail(
        c,
        403,
        'forbidden',
        'Only the owner changes or runs routines (X-Pharos-Author: human:…)',
      );
    await next();
  });

  app.get('/state', async (c) => {
    // A routine the owner approved while Routines was down is added now, if it answers.
    await proposals?.settle(true).catch((err: unknown) => console.error('[pharos] routines:', err));
    try {
      const res = await call('/api/state');
      if (!res.ok) throw new Unreachable(`Routines at ${base} answered HTTP ${res.status}.`);
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.config !== 'object' || !Array.isArray(body.status))
        throw new Unreachable(`Routines at ${base} sent something Pharos doesn't read.`);
      const conf = body.config as RoutinesConfig;
      const editable = Array.isArray(conf.routines);
      return c.json({
        available: true,
        ...body,
        config: { ...conf, routines: routinesOf(conf) },
        editable,
        pharos: store && Array.isArray(conf.projects) ? pharosOf(store, conf) : {},
        ...(store ? { folders: foldersOf(store) } : {}),
        ...(proposals ? { proposals: proposals.pending() } : {}),
        url: base,
      } as RoutinesState);
    } catch (err) {
      if (!(err instanceof Unreachable)) throw err;
      return c.json({
        available: false,
        reason: `${err.message} ${hint}`,
        url: base,
      } satisfies RoutinesState);
    }
  });

  app.get('/file', async (c) => {
    const project = c.req.query('project') ?? '';
    const name = c.req.query('name') ?? '';
    if (!project || !(ROUTINE_FILES as readonly string[]).includes(name))
      return fail(c, 400, 'invalid', `name must be one of ${ROUTINE_FILES.join(', ')}`);
    try {
      const res = await call(`/api/file?${new URLSearchParams({ project, name })}`);
      if (res.status === 404) return fail(c, 404, 'not_found', 'No such project or file');
      if (!res.ok) return fail(c, 502, 'upstream', `Routines answered HTTP ${res.status}`);
      return c.json({ project, name, text: await res.text() });
    } catch (err) {
      return unreachable(c, err);
    }
  });

  app.get('/log', async (c) => {
    const file = c.req.query('file') ?? '';
    if (!ROUTINE_LOG.test(file)) return fail(c, 400, 'invalid', 'file must be a log file name');
    try {
      const res = await call(`/api/log?${new URLSearchParams({ file })}`);
      if (!res.ok) return fail(c, 502, 'upstream', `Routines answered HTTP ${res.status}`);
      return c.json({ file, text: await res.text() });
    } catch (err) {
      return unreachable(c, err);
    }
  });

  // Runners (where routines run besides this computer): listed, checked, set up and removed by the
  // Routines app; Pharos passes the owner's requests through.
  app.get('/runners', async (c) => {
    try {
      const res = await call('/api/runners');
      if (!res.ok) return fail(c, 502, 'upstream', `Routines answered HTTP ${res.status}`);
      return c.json((await res.json()) as RunnersView);
    } catch (err) {
      return unreachable(c, err);
    }
  });

  app.post('/runners/:action', async (c) => {
    const parsed = RunnerAction.safeParse({
      ...((await c.req.json().catch(() => ({}))) as object),
      action: c.req.param('action'),
    });
    if (!parsed.success)
      return fail(c, 400, 'invalid', 'Unknown runner action or a bad id or host');
    const { action, ...body } = parsed.data;
    try {
      const res = await call(`/api/runners/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok)
        return fail(
          c,
          res.status === 409 ? 409 : res.status === 404 ? 404 : res.status === 400 ? 400 : 502,
          res.status === 409 ? 'conflict' : 'upstream',
          typeof answer.error === 'string' ? answer.error : `HTTP ${res.status}`,
        );
      return c.json(answer);
    } catch (err) {
      return unreachable(c, err);
    }
  });

  // Saves the page's edits into routines.json: each edit names the value it changes, and the
  // save is refused when routines.json no longer holds it (changed on disk or in another tab).
  app.post('/save', async (c) => {
    const { changes } = RoutinesSave.parse(await c.req.json().catch(() => ({})));
    try {
      return c.json({ ok: true, saved: await client.save(changes) });
    } catch (err) {
      if (err instanceof SaveRefused) return fail(c, err.status, err.code, err.message);
      return unreachable(c, err);
    }
  });

  // Starts one routine for one project now. It is real work (a headless agent, its budget).
  app.post('/run', async (c) => {
    const body = RoutinesRun.parse(await c.req.json().catch(() => ({})));
    try {
      const conf = await config();
      if (!conf.projects.some((p) => p.name === body.project))
        return fail(c, 404, 'not_found', `No project named ${body.project} in routines.json`);
      if (!routinesOf(conf).some((r) => r.id === body.routine))
        return fail(c, 404, 'not_found', `No routine ${body.routine} in routines.json`);
      const res = await call('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        const message = typeof answer.error === 'string' ? answer.error : `HTTP ${res.status}`;
        return fail(
          c,
          res.status === 409 ? 409 : 502,
          res.status === 409 ? 'conflict' : 'upstream',
          message,
        );
      }
      return c.json({ ok: true, routine: body.routine, project: body.project });
    } catch (err) {
      return unreachable(c, err);
    }
  });

  return app;
}

/** JSON with sorted keys: two routines are the same whatever order their fields came in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return typeof a === 'object' && typeof b === 'object' && canonical(a) === canonical(b);
}

/** routines.json with the edits made; everything else stays as it was. */
export function applyChanges(conf: RoutinesConfig, changes: RoutinesChange[]): RoutinesConfig {
  const next = structuredClone(conf);
  next.schedule ??= {};
  next.dispatch ??= {};
  for (const ch of changes) {
    switch (ch.field) {
      case 'enrolled':
      case 'budget_usd':
      case 'hours': {
        const project = next.projects.find((p) => p.name === ch.project);
        if (project) Object.assign(project, { [ch.field]: ch.to });
        break;
      }
      case 'runner': {
        const project = next.projects.find((p) => p.name === ch.project);
        if (!project) break;
        if (ch.to && !(next.runners ?? []).some((r) => r.id === ch.to))
          throw new SaveRefused(400, 'invalid', `No runner "${ch.to}" in routines.json`);
        if (ch.to) project.runner = ch.to;
        else delete project.runner;
        break;
      }
      case 'schedule':
        next.schedule[ch.routine] = ch.to;
        break;
      case 'timezone':
        next.schedule.timezone = ch.to;
        break;
      case 'dispatch':
        next.dispatch[ch.kind] = { ...next.dispatch[ch.kind], [ch.level]: ch.to };
        break;
      case 'routine': {
        const list = (next.routines ?? []).filter((r) => r.id !== ch.id);
        const at = (next.routines ?? []).findIndex((r) => r.id === ch.id);
        if (ch.to) list.splice(at < 0 ? list.length : at, 0, ch.to);
        next.routines = list;
        break;
      }
      case 'project': {
        next.projects = next.projects.filter((p) => p.name !== ch.name);
        if (ch.to) next.projects.push(ch.to as RoutinesConfig['projects'][number]);
        else if (Array.isArray(next.routines))
          next.routines = next.routines.map((r) =>
            Array.isArray(r.projects)
              ? { ...r, projects: r.projects.filter((n) => n !== ch.name) }
              : r,
          );
        break;
      }
    }
  }
  return next;
}
