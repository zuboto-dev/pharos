import {
  ROUTINE_FILES,
  ROUTINE_LOG,
  RoutinesRun,
  RoutinesSave,
  currentRoutinesValue,
  describeRoutinesChange,
  routinesOf,
  type RoutinesChange,
  type RoutinesConfig,
  type RoutinesPharos,
  type RoutinesState,
} from '@pharos/schema';
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

export type RoutinesOptions = {
  /** The Routines server (`PHAROS_ROUTINES_URL`); default http://127.0.0.1:4777. */
  url?: string;
  /** Tests pass a stub. */
  fetch?: typeof fetch;
  /** Per request; Routines answers locally, so a slow answer means it's stuck. */
  timeoutMs?: number;
};

class Unreachable extends Error {}

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

export function routinesRoutes(options: RoutinesOptions = {}, store?: Store) {
  const base = (options.url || DEFAULT_ROUTINES_URL).replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;
  const app = new Hono();

  /** One call to Routines; network failures and timeouts become `Unreachable` with a reason. */
  async function call(path: string, init?: RequestInit): Promise<Response> {
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

  const unreachable = (c: Context, err: unknown) => {
    if (err instanceof Unreachable)
      return fail(c, 503, 'unavailable', `${err.message} ${ROUTINES_START_HINT}`);
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
        url: base,
      } as RoutinesState);
    } catch (err) {
      if (!(err instanceof Unreachable)) throw err;
      return c.json({
        available: false,
        reason: `${err.message} ${ROUTINES_START_HINT}`,
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

  // Saves the page's edits into routines.json: each edit names the value it changes, and the
  // save is refused when routines.json no longer holds it (changed on disk or in another tab).
  app.post('/save', async (c) => {
    const { changes } = RoutinesSave.parse(await c.req.json().catch(() => ({})));
    try {
      const conf = await config();
      const stale = changes.filter((ch) => !sameValue(currentRoutinesValue(conf, ch), ch.from));
      const missing = changes.filter(
        (ch) => 'project' in ch && !conf.projects.some((p) => p.name === ch.project),
      );
      const routineChanges = changes.filter((ch) => ch.field === 'routine');
      if (routineChanges.length && !Array.isArray(conf.routines))
        return fail(
          c,
          400,
          'invalid',
          'This Routines app keeps only the three built-in routines: update it to add or change routines.',
        );
      const badId = routineChanges.find((ch) => ch.to && ch.to.id !== ch.id);
      if (badId) return fail(c, 400, 'invalid', `A routine's id can't change (${badId.id})`);
      if (missing.length)
        return fail(
          c,
          400,
          'invalid',
          `No project named ${missing.map((m) => 'project' in m && m.project).join(', ')}`,
        );
      if (stale.length)
        return fail(
          c,
          409,
          'conflict',
          `routines.json changed since the page loaded (${stale.map(describeRoutinesChange).join('; ')}). Reload and try again.`,
        );
      const next = applyChanges(conf, changes);
      const res = await call('/api/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projects: next.projects,
          schedule: next.schedule,
          dispatch: next.dispatch,
          ...(routineChanges.length ? { routines: next.routines } : {}),
        }),
      });
      if (!res.ok) return fail(c, 502, 'upstream', `Routines didn't save (HTTP ${res.status})`);
      return c.json({ ok: true, saved: changes.map(describeRoutinesChange) });
    } catch (err) {
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
    }
  }
  return next;
}
