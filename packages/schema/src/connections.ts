import { ENTITIES, type Entity, type EntityType } from './entities.js';

/**
 * How an object hangs together with the rest of its project (the owner, 2026-10-23: "objects
 * living in Pharos better be organically connected"): what points at it through a reference
 * field, the pages that show it, and the text that mentions it. What it points at itself is
 * already in its own fields.
 */
export type Connection = {
  /** Why they're connected, from this object's side: "Tasks serving it", "Shown on". */
  label: string;
  id: string;
  type: EntityType;
};

/** Phrases for incoming references, by the referring type and field. */
const INCOMING: Partial<Record<string, string>> = {
  'task.stageId': 'Tasks in this stage',
  'task.goalIds': 'Tasks serving it',
  'task.dependsOn': 'Tasks waiting on it',
  'task.assigneeId': 'Assigned tasks',
  'goal.parentId': 'Sub-goals',
  'artifact.taskId': 'Its deliverables',
  'artifact.stageId': 'Deliverables',
  'decision.dependsOn': 'Decisions building on it',
  'decision.decidedById': 'Decisions made',
  'claim.sourceIds': 'Findings from it',
  'claim.quoteSourceId': 'Findings quoting it',
  'claim.aboutId': 'Findings about it',
  'claim.confirmedById': 'Findings it confirms',
  'claim.authorId': 'Findings written',
  'term.sourceId': 'Terms explained by it',
  'term.taskIds': 'Terms used in',
};

const typeLabel = (type: EntityType) =>
  type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ');

/** The text fields an entity carries (where mentions are looked for). */
const TEXT_FIELDS = ['description', 'body', 'detail', 'notes', 'content', 'rationale'];

export function connectionsOf(entity: Entity, all: Entity[]): Connection[] {
  const out: Connection[] = [];
  const seen = new Set<string>();
  const add = (label: string, other: Entity) => {
    const key = `${label}:${other.id}`;
    if (other.id === entity.id || seen.has(key)) return;
    seen.add(key);
    out.push({ label, id: other.id, type: other.type });
  };
  for (const other of all) {
    if (other.id === entity.id) continue;
    const refs = ENTITIES[other.type]?.refs ?? {};
    const data = other.data as Record<string, unknown>;
    for (const [field, spec] of Object.entries(refs)) {
      if (field === 'projectId' || spec.type !== entity.type) continue;
      const value = data[field];
      const hit = Array.isArray(value) ? value.includes(entity.id) : value === entity.id;
      if (hit)
        add(INCOMING[`${other.type}.${field}`] ?? `${typeLabel(other.type)}s (${field})`, other);
    }
    if (other.type === 'view') {
      // A page (board, document or report page) that shows it by id.
      const page = JSON.stringify([data.spec, data.doc, data.page]);
      if (page.includes(`"${entity.id}"`)) add('Shown on', other);
      continue;
    }
    for (const field of TEXT_FIELDS) {
      const text = data[field];
      if (typeof text === 'string' && text.includes(entity.id)) {
        add('Mentioned in', other);
        break;
      }
    }
  }
  return out;
}

/** Connections grouped by label, in the order they first appear. */
export function groupConnections(list: Connection[]): { label: string; ids: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const c of list) groups.set(c.label, [...(groups.get(c.label) ?? []), c.id]);
  return [...groups].map(([label, ids]) => ({ label, ids }));
}
