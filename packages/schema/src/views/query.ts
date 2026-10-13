import { z } from 'zod';
import type { Entity } from '../entities.js';

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
export type Scalar = z.infer<typeof Scalar>;

const Comparison = z
  .strictObject({
    gt: Scalar.optional(),
    gte: Scalar.optional(),
    lt: Scalar.optional(),
    lte: Scalar.optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Give at least one of gt, gte, lt, lte')
  .describe(
    'Range: numbers, dates (YYYY-MM-DD or "$today+7d"), or option order (e.g. priority gte "high")',
  );

export const Condition = z.union([
  Scalar,
  z.array(Scalar).describe('Matches any of these values'),
  z.strictObject({ not: z.union([Scalar, z.array(Scalar)]) }),
  z.strictObject({ exists: z.boolean().describe('Whether the field has a value') }),
  z.strictObject({ contains: z.string().describe('Case-insensitive text search') }),
  Comparison,
]);
export type Condition = z.infer<typeof Condition>;

export const Where = z
  .record(z.string(), Condition)
  .describe(
    'Field conditions, all must match. Fields can follow one reference: "stage.status", "stage.targetDate", ' +
      '"assignee.kind", "task.status", "parent.status"; also "id", "createdAt", "updatedAt". ' +
      'Conditions: exact value, array (any of), {not: value|array}, {exists: bool}, {contains: text}, ' +
      'or a range {gt|gte|lt|lte: value}. Special values: "$currentStage", "$project", and dates relative to ' +
      'today: "$today", "$today+7d", "$today-2w". Array fields such as dependsOn match when they contain the value.',
  );
export type Where = z.infer<typeof Where>;

export const Sort = z.array(
  z.strictObject({ field: z.string(), dir: z.enum(['asc', 'desc']).optional() }),
);

/** Filter for components that already know which entity type they show. */
export const Filter = z.strictObject({
  where: Where.optional(),
  anyOf: z
    .array(Where)
    .min(1)
    .optional()
    .describe('At least one of these must also match (an "or"), e.g. overdue OR blocked'),
  sort: Sort.optional().describe('Default: manual order, then creation'),
  limit: z.number().int().min(1).optional(),
});
export type Filter = z.infer<typeof Filter>;

export const QueryableType = z.enum([
  'goal',
  'scope_item',
  'stage',
  'task',
  'artifact',
  'decision',
  'claim',
  'term',
  'file',
]);
export type QueryableType = z.infer<typeof QueryableType>;

export const Query = Filter.extend({ type: QueryableType });
export type Query = z.infer<typeof Query>;

/** Everything a view needs to render one project. */
export type ProjectDataset = {
  project: Entity<'project'>;
  repository: Entity<'repository'> | null;
  assignees: Entity<'assignee'>[];
  goals: Entity<'goal'>[];
  scopeItems: Entity<'scope_item'>[];
  stages: Entity<'stage'>[];
  tasks: Entity<'task'>[];
  artifacts: Entity<'artifact'>[];
  decisions: Entity<'decision'>[];
  views: Entity<'view'>[];
  requests: Entity<'request'>[];
  claims: Entity<'claim'>[];
  terms: Entity<'term'>[];
  /** Project files (R7). For agents, R7.5 leaves out hidden folders and scan-only fields. */
  files: Entity<'file'>[];
};
