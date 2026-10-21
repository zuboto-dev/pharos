import type { Entity } from '../entities.js';
import { meaningOf } from '../options.js';
import { docLeaves, type DocBlock, type ReportDoc } from './doc.js';
import type { Filter, ProjectDataset } from './query.js';
import { runQuery } from './run-query.js';

/**
 * What a document asks the reader (R15), shared by the web app (the sheet pills and the desk) and
 * the server (view_get's sheets, freshness): the tasks a sheet's TaskChecklists show and the
 * decisions a document asks to be answered.
 */

/** A task a sheet's TaskChecklists show; finished once done or cancelled, as the list counts it. */
export type SheetTask = { task: Entity<'task'>; done: boolean; finished: boolean };

/**
 * The tasks a sheet's TaskChecklists show, once each, with the list's own `assigneeKind` applied.
 * A checklist whose filter can't run shows none.
 */
export function sheetTasks(data: ProjectDataset, sheet: { blocks: DocBlock[] }): SheetTask[] {
  const assignees = new Map(data.assignees.map((a) => [a.id, a]));
  const seen = new Map<string, SheetTask>();
  for (const b of docLeaves(sheet.blocks)) {
    if (b.kind !== 'block' || b.node.component !== 'TaskChecklist') continue;
    const node = b.node as { filter?: Filter; assigneeKind?: string };
    let tasks: Entity<'task'>[];
    try {
      tasks = runQuery(data, 'task', node.filter ?? {});
    } catch {
      tasks = [];
    }
    for (const task of tasks) {
      if (seen.has(task.id)) continue;
      if (
        node.assigneeKind &&
        assignees.get(task.data.assigneeId ?? '')?.data.kind !== node.assigneeKind
      )
        continue;
      const meaning = meaningOf(data.project, 'task.status', task.data.status);
      seen.set(task.id, {
        task,
        done: meaning === 'done',
        finished: meaning === 'done' || meaning === 'cancelled',
      });
    }
  }
  return [...seen.values()];
}

/** The decisions a document asks the reader to answer: its sheets' and its DecisionBlocks'. */
export function docDecisionIds(doc: ReportDoc): Set<string> {
  const ids = new Set<string>();
  for (const b of doc.blocks)
    if (b.kind === 'sheet') for (const id of b.decisions ?? []) ids.add(id);
  for (const b of docLeaves(doc.blocks))
    if (b.kind === 'block' && b.node.component === 'DecisionBlock') {
      const id = (b.node as { decision?: unknown }).decision;
      if (typeof id === 'string') ids.add(id);
    }
  return ids;
}
