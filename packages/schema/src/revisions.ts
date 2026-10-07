import { z } from 'zod';
import { ENTITY_TYPES, type EntityType, Id, createSchema, patchSchema } from './entities.js';

export const Author = z.object({
  kind: z.enum(['human', 'agent', 'system']),
  name: z.string().min(1),
});
export type Author = z.infer<typeof Author>;

/**
 * Within one `apply` call, a create can name itself with `ref`, and later operations can use
 * "$<ref>" anywhere an id is expected (operation ids and reference fields like stageId).
 */
const Ref = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe(
    'Name for this new entity; later operations in the same call can use "$<ref>" as its id',
  );

function operationsFor(type: EntityType) {
  return z.discriminatedUnion('op', [
    z.strictObject({
      op: z.literal('create'),
      type: z.literal(type),
      ref: Ref.optional(),
      data: createSchema(type),
    }),
    z.strictObject({
      op: z.literal('update'),
      type: z.literal(type),
      id: Id,
      data: patchSchema(type).describe('Fields to change; null clears an optional field'),
    }),
    z.strictObject({ op: z.literal('delete'), type: z.literal(type), id: Id }),
  ]);
}

function operationUnion(types: readonly EntityType[]) {
  return z.discriminatedUnion(
    'type',
    types.map(operationsFor) as unknown as [
      ReturnType<typeof operationsFor>,
      ...ReturnType<typeof operationsFor>[],
    ],
  );
}

export const Operation = operationUnion(ENTITY_TYPES);
export type Operation =
  | { op: 'create'; type: EntityType; ref?: string; data: Record<string, unknown> }
  | { op: 'update'; type: EntityType; id: string; data: Record<string, unknown> }
  | { op: 'delete'; type: EntityType; id: string };

/** Input for applying operations on some entity types (e.g. agents edit views with view tools instead). */
export function applyInputFor(types: readonly EntityType[]) {
  return z.object({
    message: z
      .string()
      .trim()
      .min(1)
      .describe('Why these changes are being made, like a commit message'),
    operations: z.array(operationUnion(types)).min(1),
  });
}

export const ApplyInput = applyInputFor(ENTITY_TYPES);
export type ApplyInput = { message: string; operations: Operation[] };

export type ChangeOp = 'create' | 'update' | 'delete';

export type Change = {
  seq: number;
  op: ChangeOp;
  type: EntityType;
  id: string;
  projectId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type Revision = {
  id: number;
  author: Author;
  message: string;
  createdAt: string;
  revertOf: number | null;
};

export type FieldDiff = { before: unknown; after: unknown };

/** A revision with its net changes, and the revision that reverted it, if any. */
export type RevisionSummary = Revision & { changes: EntityDiff[]; revertedBy: number | null };

/** Net effect on one entity across one or more revisions. */
export type EntityDiff = {
  op: ChangeOp;
  type: EntityType;
  id: string;
  label: string | null;
  fields: Record<string, FieldDiff>;
};
