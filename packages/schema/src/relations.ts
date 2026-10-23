import { decisionState } from './decisions.js';
import type { Entity } from './entities.js';

/**
 * What an object's relations say about it, for the owner (2026-10-23: "tell the user when they
 * skipped some decisions and made other decisions which were depending on the skipped ones, or
 * that this is maybe stale or outdated"):
 * - waiting: a decision it builds on is still open or put off;
 * - assumed: (on an open decision) another was decided that builds on this one;
 * - changed: something it rests on changed after it was settled (a decision it builds on, a
 *   finding behind the chosen option, a finding's source).
 * Changes are compared by revision: one made after the object's own last change counts.
 */
export type RelationNote = {
  kind: 'waiting' | 'assumed' | 'changed';
  id: string;
  title: string;
};

type Lookup = (id: string) => Entity | undefined;

const titleOf = (e: Entity): string => {
  const d = e.data as Record<string, unknown>;
  return String(d.title ?? d.statement ?? d.name ?? e.id);
};

const settled = (d: Entity<'decision'>) => {
  const kind = decisionState(d.data).kind;
  // A decision with options is settled by its answer; one without by being recorded.
  return d.data.options?.length ? kind === 'chosen' || kind === 'answered' : true;
};

export function relationNotes(
  entity: Entity,
  lookup: Lookup,
  /** Every decision of the project, to find the ones that build on this one. */
  decisions: Entity<'decision'>[] = [],
): RelationNote[] {
  const notes: RelationNote[] = [];
  const note = (kind: RelationNote['kind'], other: Entity) =>
    notes.push({ kind, id: other.id, title: titleOf(other) });
  if (entity.type === 'decision') {
    const decision = entity as Entity<'decision'>;
    const done = settled(decision);
    for (const id of decision.data.dependsOn ?? []) {
      const dep = lookup(id);
      if (!dep || dep.id === entity.id || dep.type !== 'decision') continue;
      if (!settled(dep as Entity<'decision'>)) note('waiting', dep);
      else if (done && dep.updatedRev > decision.updatedRev) note('changed', dep);
    }
    if (done) {
      const state = decisionState(decision.data);
      for (const id of state.kind === 'chosen' ? (state.option.claimIds ?? []) : []) {
        const claim = lookup(id);
        if (claim && claim.updatedRev > decision.updatedRev) note('changed', claim);
      }
    } else
      for (const other of decisions)
        if (other.id !== entity.id && other.data.dependsOn?.includes(entity.id) && settled(other))
          note('assumed', other);
  }
  if (entity.type === 'claim') {
    const claim = entity as Entity<'claim'>;
    for (const id of claim.data.sourceIds ?? []) {
      const source = lookup(id);
      if (source && source.updatedRev > claim.updatedRev) note('changed', source);
    }
  }
  return notes;
}

/** One line for a note, as the desk and the decision show it. */
export function relationLine(note: RelationNote): string {
  if (note.kind === 'waiting') return `Builds on “${note.title}”, which isn't answered yet`;
  if (note.kind === 'assumed') return `“${note.title}” was decided assuming this one`;
  return `May be outdated: “${note.title}” changed after this was settled`;
}
