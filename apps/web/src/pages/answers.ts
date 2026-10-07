import type { Entity, Operation } from '@pharos/schema';

/** Keeping an answer makes it a regular tab that doesn't expire; the question becomes its description. */
export function keepAnswer(view: Entity<'view'>): { message: string; operations: Operation[] } {
  return {
    message: `Keep answer “${view.data.question ?? view.data.name}” as a view`,
    operations: [
      {
        op: 'update',
        type: 'view',
        id: view.id,
        data: {
          kind: null,
          expiresAt: null,
          archived: null,
          ...(view.data.description ? {} : { description: view.data.question ?? null }),
        },
      },
    ],
  };
}

/** Dismissing hides an answer now (it stays in the history and the Archived menu). */
export function dismissAnswer(view: Entity<'view'>): { message: string; operations: Operation[] } {
  return {
    message: `Dismiss answer “${view.data.question ?? view.data.name}”`,
    operations: [{ op: 'update', type: 'view', id: view.id, data: { archived: true } }],
  };
}
