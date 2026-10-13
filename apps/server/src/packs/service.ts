import {
  PACKS,
  findPack,
  localToday,
  packOperations,
  packSummary,
  type Author,
  type Entity,
} from '@pharos/schema';
import { z } from 'zod';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { viewUrl } from '../views/service.js';

/** Packs a project can start from (R8): record types, pages and a guide, as data. */
export function listPacks() {
  return PACKS.map(packSummary);
}

export const PackApplyInput = z.object({
  pack: z.string().min(1).describe('Pack key from pack_list, e.g. "car" or "money"'),
  name: z.string().trim().min(1).optional().describe('Start a new project with this name'),
  projectId: z.string().optional().describe('Or add the pack to this existing project'),
  examples: z
    .boolean()
    .optional()
    .describe("Also add the pack's made-up example records (default false)"),
});
export type PackApplyInput = z.infer<typeof PackApplyInput>;

/**
 * Applies a pack in one revision: a new project (or the record types of an existing one), its
 * pages, and with `examples` its made-up records. Reverting that revision undoes all of it.
 */
export function applyPack(
  store: Store,
  author: Author,
  input: PackApplyInput,
  today = localToday(),
) {
  const pack = findPack(input.pack);
  if (!pack)
    throw new PharosError(
      'not_found',
      `No pack "${input.pack}" (packs: ${PACKS.map((p) => p.key).join(', ')})`,
    );
  if (!input.name === !input.projectId)
    throw new PharosError('invalid', 'Give a name for a new project, or the projectId of one');
  const project = input.projectId ? store.getOfType('project', input.projectId) : undefined;
  let operations;
  try {
    operations = packOperations(
      pack,
      project
        ? {
            projectId: project.id,
            recordTypes: project.data.recordTypes ?? [],
            options: project.data.options,
          }
        : { name: input.name! },
      { examples: input.examples, today },
    );
  } catch (err) {
    throw new PharosError('invalid', (err as Error).message);
  }
  const result = store.apply(author, {
    message: project
      ? `Add the ${pack.name} pack`
      : `Start "${input.name}" from the ${pack.name} pack${input.examples ? ' with made-up examples' : ''}`,
    operations,
  });
  const projectId = project?.id ?? result.created.project!;
  const created = new Set(Object.values(result.created));
  const views = store
    .list('view', { projectId })
    .filter((v) => created.has(v.id))
    .map((v: Entity<'view'>) => ({ id: v.id, name: v.data.name, url: viewUrl(v) }));
  return {
    revision: result.revision?.id ?? null,
    projectId,
    views,
    records: [...created].filter((id) => id.startsWith('rec_')).length,
    warnings: result.warnings,
    guide: pack.guide,
    undo: `history_revert ${result.revision?.id} undoes the whole pack`,
  };
}
