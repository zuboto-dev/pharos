// Shared checks for the agent-compatibility scenarios (eval/compat). Pure functions over a state
// the runner collects through the REST API of an isolated server: no network, no agent, so the
// unit tests feed them hand-made states.
//
// A state is:
//   before / after   every entity (all types) before the agent ran and after it stopped
//   revisions        revisions made while the agent ran (oldest first), with author and changes
//   folderRequests   the server's folder requests after the run (app settings, not entities)
//   previews         view_preview results by view id, for the views a scenario asks to check
//   finalMessage     the agent's last message (may be empty)

/** One check result. */
export const check = (id, pass, note = '') => ({ id, pass: Boolean(pass), note });

const byId = (entities) => new Map(entities.map((e) => [e.id, e]));

/** The built-in meaning of an option value: the project's own options, else the value itself. */
export function meaningOf(project, key, value) {
  const custom = project?.data?.options?.[key];
  return custom?.find((o) => o.value === value)?.meaning ?? value;
}

/** Entities created, updated or deleted between before and after. */
export function changedEntities(state) {
  const before = byId(state.before);
  const after = byId(state.after);
  const changed = [];
  for (const [id, entity] of after) {
    const old = before.get(id);
    if (!old) changed.push({ op: 'create', entity });
    else if (JSON.stringify(old.data) !== JSON.stringify(entity.data))
      changed.push({ op: 'update', entity, before: old });
  }
  for (const [id, entity] of before) if (!after.has(id)) changed.push({ op: 'delete', entity });
  return changed;
}

/** Which project an entity belongs to (a project belongs to itself; assignees to none). */
const projectOf = (entity) => (entity.type === 'project' ? entity.id : entity.data?.projectId);

/** Entities of a type in a project, after the run. */
export const inProject = (state, type, projectId) =>
  state.after.filter((e) => e.type === type && e.data.projectId === projectId);

/** Finds the one project with this name that the run created. */
export function createdProject(state, name) {
  const before = new Set(state.before.map((e) => e.id));
  const found = state.after.filter(
    (e) => e.type === 'project' && !before.has(e.id) && e.data.name.trim() === name,
  );
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Checks every scenario shares: revisions were written by an agent (never a person) with a
 * message, and nothing outside the scenario's project changed. An agent creating an assignee for
 * itself (kind "agent") is the one change allowed outside a project, as the MCP guidance asks it
 * to when it claims a task.
 */
export function commonChecks(state, projectId, { expectRevisions = true } = {}) {
  const results = [];
  const byAgent = state.revisions.filter((r) => r.author?.kind === 'agent').length;
  if (expectRevisions)
    results.push(
      check('agent-wrote', byAgent > 0, byAgent ? `${byAgent} revision(s)` : 'no agent revisions'),
    );
  const notAgent = state.revisions.filter((r) => r.author?.kind !== 'agent');
  results.push(
    check(
      'author-is-agent',
      notAgent.length === 0,
      notAgent.length
        ? `revisions by ${notAgent.map((r) => `${r.author?.kind}:${r.author?.name}`).join(', ')}`
        : [...new Set(state.revisions.map((r) => r.author.name))].join(', '),
    ),
  );
  const unexplained = state.revisions.filter((r) => !r.message || !r.message.trim());
  results.push(
    check(
      'revision-messages',
      unexplained.length === 0,
      unexplained.length ? `revisions ${unexplained.map((r) => r.id).join(', ')}` : '',
    ),
  );
  const outside = changedEntities(state).filter(({ op, entity }) => {
    if (projectId && projectOf(entity) === projectId) return false;
    if (op === 'create' && entity.type === 'assignee' && entity.data.kind === 'agent') return false;
    return true;
  });
  results.push(
    check(
      'nothing-outside-changed',
      outside.length === 0,
      outside.map(({ op, entity }) => `${op} ${entity.type} ${entity.id}`).join(', '),
    ),
  );
  return results;
}

/** Every catalog component named anywhere in a view's spec (a board or a component tree). */
export function componentsOf(view) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      if (typeof node.component === 'string') found.push(node.component);
      Object.values(node).forEach(walk);
    }
  };
  walk(view?.data?.spec);
  return found;
}

/**
 * What a report document (R14, `view.data.doc`) reads live from the project: its named reads
 * (doc.data) and each component block with a query, a filter or live Text values, inside columns
 * too. Empty when it reads nothing (every number typed in by hand) or there is no document.
 */
export function docLiveReads(doc) {
  if (!doc || !Array.isArray(doc.blocks)) return [];
  const leaves = doc.blocks.flatMap((b) =>
    b?.kind === 'columns' && Array.isArray(b.columns) ? b.columns.flat() : [b],
  );
  const reads = Object.keys(doc.data ?? {}).map((name) => `data.${name}`);
  for (const block of leaves) {
    const node = block?.kind === 'block' ? block.node : undefined;
    if (!node || typeof node !== 'object') continue;
    const live = [
      ...['query', 'filter'].filter((key) => node[key] && typeof node[key] === 'object'),
      ...(node.values && Object.keys(node.values).length ? ['values'] : []),
    ];
    if (live.length) reads.push(`${block.id}: ${node.component} ${live.join('+')}`);
  }
  return reads;
}

/**
 * Whether a view_preview result passes the view checks: no query finding that would refuse a
 * save, and no view-level warning (report-page opening, point, word budget). Widget warnings are
 * reported but don't fail it.
 */
export function previewProblems(preview) {
  if (!preview) return ['no preview'];
  const rejects = (preview.findings ?? []).filter((f) => f.level === 'reject');
  return [
    ...rejects.map((f) => `query: ${f.message ?? JSON.stringify(f)}`),
    ...(preview.warnings ?? []),
  ];
}
