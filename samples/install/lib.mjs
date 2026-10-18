// Shared helpers for install-samples.mjs and its steps · Opus 5.5
//
// - connect(): a tiny MCP client that works as the named agent against a local Pharos only;
// - guarded(): wraps it so every write names a project the installer may change ("Pharos samples"
//   or a sample project it made or found by name), and refuses any other write or tool;
// - small helpers the steps share (dates, preview warnings, finding views by name).

export const AGENT = 'Opus 5.5';
export const SAMPLES_PROJECT = 'Pharos samples';

export class StepError extends Error {
  /** `code` is the exit code: 1 a step failed, 2 waiting for the owner, 3 query findings. */
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function localBase(url) {
  const base = (url ?? '').replace(/\/$/, '');
  if (!base) throw new StepError('Pass --url http://127.0.0.1:<port>', 64);
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new StepError(`Not a URL: ${base}`, 64);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
    throw new StepError(`Refusing ${base}: Pharos answers only on this computer (127.0.0.1).`, 64);
  return base;
}

export async function connect(base, name = AGENT) {
  const url = `${base}/mcp`;
  let session;
  let id = 0;
  async function rpc(method, params, notify = false) {
    const body = notify
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: ++id, method, params };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify(body),
    });
    session = res.headers.get('mcp-session-id') ?? session;
    if (notify) return undefined;
    const text = await res.text();
    const msg = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? JSON.parse(
          text
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .at(-1)
            .slice(5),
        )
      : JSON.parse(text);
    if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
    return msg.result;
  }
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name, version: '1' },
  });
  await rpc('notifications/initialized', {}, true);
  const call = async (tool, input) => {
    const r = await rpc('tools/call', { name: tool, arguments: input });
    const text = r.content?.map((c) => c.text).join('\n') ?? '';
    if (r.isError) throw new Error(`${tool} failed: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  call.tools = async () => (await rpc('tools/list', {})).tools ?? [];
  return call;
}

/** Tools that change nothing: always allowed. */
const READ_ONLY = new Set([
  'list',
  'get',
  'project_snapshot',
  'view_list',
  'view_get',
  'view_preview',
  'catalog_list',
  'catalog_describe',
  'pack_list',
  'files_unadded',
  'folder_request_status',
  'report_guide',
  'report_asset_list',
]);

/**
 * The installer's call: reads pass; every write is checked first. `scope.ids` are the projects it
 * may change; `scope.names` the sample project names it may create (only when no project has that
 * name yet). Revisions it made may be reverted, nothing else.
 */
export function guarded(raw, scope) {
  const revisions = new Set();
  const projectOf = async (id) => {
    const e = await raw('get', { id });
    return e.type === 'project' ? e.id : e.data?.projectId;
  };
  const own = (projectId, what) => {
    if (!scope.ids.has(projectId))
      throw new StepError(
        `Refused: ${what} would change project ${projectId}, which isn't a sample project. Nothing was sent.`,
      );
  };
  const newName = async (name) => {
    if (!scope.names.has(name))
      throw new StepError(`Refused: "${name}" isn't one of the sample project names.`);
    const projects = await raw('list', { type: 'project' });
    if (projects.some((p) => p.name === name))
      throw new StepError(`Refused: a project named "${name}" exists already; it would be reused.`);
  };
  const note = (result) => {
    const rev = result?.revision?.id ?? result?.revision;
    if (rev !== undefined && rev !== null) revisions.add(String(rev));
    return result;
  };
  const call = async (tool, input = {}) => {
    if (READ_ONLY.has(tool)) return raw(tool, input);
    switch (tool) {
      case 'folder_request':
        if (input.projectId) own(input.projectId, 'folder_request');
        return raw(tool, input);
      case 'apply':
        for (const op of input.operations ?? []) {
          if (op.op === 'create') {
            if (op.type === 'project') await newName(op.data?.name);
            else own(op.data?.projectId, `apply (${op.type})`);
          } else if (typeof op.id === 'string' && !op.id.startsWith('$')) {
            own(await projectOf(op.id), `apply (${op.op} ${op.id})`);
          }
        }
        return note(await raw(tool, input));
      case 'view_create':
        own(input.projectId, 'view_create');
        return note(await raw(tool, input));
      case 'view_answer':
        own(input.projectId, 'view_answer');
        return note(await raw(tool, input));
      case 'view_update':
        own(await projectOf(input.viewId), 'view_update');
        return note(await raw(tool, input));
      case 'report_asset_put':
        own(await projectOf(input.viewId), 'report_asset_put');
        return raw(tool, input);
      case 'pack_apply': {
        if (input.projectId) own(input.projectId, 'pack_apply');
        else await newName(input.name);
        const result = await raw(tool, input);
        scope.ids.add(result.projectId);
        return note(result);
      }
      case 'history_revert':
        if (!revisions.has(String(input.revision)))
          throw new StepError(`Refused: revision ${input.revision} wasn't made by this installer.`);
        return raw(tool, input);
      default:
        throw new StepError(`Refused: the installer doesn't use the tool ${tool}.`);
    }
  };
  call.tools = raw.tools;
  return call;
}

export const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A date `offset` days from today, as YYYY-MM-DD. */
export function day(offset = 0) {
  const t = new Date();
  return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset));
}

export const warningsOf = (p) => [
  ...(p.warnings ?? []),
  ...(p.layout ?? []),
  ...(p.widgets ?? []).flatMap((w) => (w.warnings ?? []).map((m) => `${w.id}: ${m}`)),
];

export const viewPath = (projectId, viewId) => `/projects/${projectId}/views/${viewId}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The project with this exact name, if exactly one has it (two is an error: which one?). */
export async function projectNamed(call, name) {
  const found = (await call('list', { type: 'project' })).filter((p) => p.name === name);
  if (found.length > 1)
    throw new StepError(
      `${found.length} projects are named "${name}" (${found.map((p) => p.id).join(', ')}); rename the extra ones, then run this again.`,
    );
  return found[0];
}

/** The view with this name in the project (archived ones too), if any. */
export async function viewNamed(call, projectId, name) {
  const views = await call('view_list', { projectId, includeArchived: true });
  return views.find((v) => v.name === name);
}

/** Previews a board and throws on any warning (or any the filter keeps). */
export async function previewOrStop(call, projectId, name, widgets, keep = () => true) {
  const draft = await call('view_preview', { projectId, widgets });
  const warnings = warningsOf(draft).filter(keep);
  if (warnings.length)
    throw new StepError(
      `view_preview warns for "${name}", so it wasn't saved:\n- ${warnings.join('\n- ')}`,
    );
  return draft;
}

/**
 * Makes the view unless one with that name is there already (then it's left as it is: the owner
 * may have changed it). Returns { id, made }.
 */
export async function ensureView(call, projectId, name, description, widgets, message, keep) {
  const existing = await viewNamed(call, projectId, name);
  if (existing) return { id: existing.id, made: false };
  await previewOrStop(call, projectId, name, widgets, keep);
  const made = await call('view_create', { projectId, name, description, widgets, message });
  const after = warningsOf(made.preview ?? {}).filter(keep ?? (() => true));
  if (after.length)
    throw new StepError(`Saved "${name}", but its preview warns:\n- ${after.join('\n- ')}`);
  return { id: made.view.id, made: true };
}

/** An option value for a meaning in a project's option lists (falls back to the meaning). */
export function optionValue(project, key, meaning) {
  return project.data?.options?.[key]?.find((o) => o.meaning === meaning)?.value ?? meaning;
}

/**
 * The files of the shared folder not yet in the project, matching `query`. Right after the owner
 * approves, the folder's scan may still be running, so it waits (up to ~15 s) for `paths`.
 */
export async function unaddedFiles(call, projectId, folderId, query, paths = []) {
  let files = [];
  for (let i = 0; i < 75; i++) {
    files = await call('files_unadded', { projectId, folderId, query, limit: 500 });
    if (paths.every((p) => files.some((f) => f.path === p))) break;
    await sleep(200);
  }
  return new Map(files.map((f) => [f.path, f]));
}
