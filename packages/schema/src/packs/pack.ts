import { z } from 'zod';
import { ProjectOptions } from '../options.js';
import {
  FieldValue,
  Interval,
  RecordKey,
  RecordTypes,
  findRecordType,
  type RecordType,
} from '../records.js';
import type { Operation } from '../revisions.js';
import { Widget } from '../views/board.js';
import { relativeDate } from '../views/dates.js';

/**
 * A pack (R8) is data that sets up a project for one kind of life admin: its record types, option
 * lists, hand-made pages, a short guide for agents and made-up examples. Applying it is one
 * `apply`, so one revert undoes it.
 */

export const PackView = z.strictObject({
  name: z.string().min(1).max(40),
  description: z.string().optional(),
  pinned: z.boolean().optional(),
  widgets: z.array(Widget).min(1),
});

/**
 * A made-up record. Date fields and interval dates may be relative ("$today-40d"), so a sample
 * started any day looks right; reference fields name another example as "$<ref>".
 */
export const PackRecord = z.strictObject({
  ref: z.string().regex(/^[A-Za-z0-9_-]+$/),
  recordType: RecordKey,
  title: z.string().min(1).max(200),
  fields: z.record(z.string(), FieldValue),
  interval: Interval.extend({
    lastDate: z.string().optional(),
    startDate: z.string().optional(),
  }).optional(),
});
export type PackRecord = z.infer<typeof PackRecord>;

export const Pack = z.strictObject({
  key: RecordKey,
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(200),
  /** What a project started from it is about, as its summary. */
  summary: z.string().min(1).max(200),
  /** For agents: what the record types are for and how to keep them current. */
  guide: z.string().min(1).max(1500),
  recordTypes: RecordTypes,
  options: ProjectOptions.optional(),
  views: z.array(PackView).min(1),
  examples: z.array(PackRecord).optional(),
});
export type Pack = z.infer<typeof Pack>;

/** What a pack list shows (REST, MCP, the New project dialog). */
export function packSummary(pack: Pack) {
  return {
    key: pack.key,
    name: pack.name,
    description: pack.description,
    recordTypes: pack.recordTypes.map((t) => t.name),
    views: pack.views.map((v) => v.name),
    examples: pack.examples?.length ?? 0,
  };
}

function resolveDate(value: string | undefined, today: string): string | undefined {
  if (value === undefined || !value.startsWith('$')) return value;
  return relativeDate(value, today) ?? value;
}

/** An example's data with relative dates resolved; "$ref" references stay for the store. */
export function exampleData(
  example: PackRecord,
  type: RecordType | undefined,
  projectId: string,
  today: string,
) {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(example.fields)) {
    const kind = type?.fields.find((f) => f.key === key)?.kind;
    fields[key] = kind === 'date' && typeof value === 'string' ? resolveDate(value, today) : value;
  }
  const interval = example.interval && {
    ...example.interval,
    ...(example.interval.lastDate
      ? { lastDate: resolveDate(example.interval.lastDate, today) }
      : {}),
    ...(example.interval.startDate
      ? { startDate: resolveDate(example.interval.startDate, today) }
      : {}),
  };
  return {
    projectId,
    recordType: example.recordType,
    title: example.title,
    fields,
    ...(interval ? { interval } : {}),
  };
}

export type PackTarget =
  /** A new project with this name. */
  | { name: string }
  /**
   * An existing project: the pack's record types are added to the ones it has (`recordTypes`),
   * and its option lists replace the project's for the same fields.
   */
  | { projectId: string; recordTypes: RecordType[]; options?: ProjectOptions };

/**
 * The operations that apply a pack, in one apply: the project (or its record types), the pages,
 * and with `examples` the made-up records. Throws when a record type already exists.
 */
export function packOperations(
  pack: Pack,
  target: PackTarget,
  options: { examples?: boolean; today: string },
): Operation[] {
  const ops: Operation[] = [];
  let projectId: string;
  if ('name' in target) {
    projectId = '$project';
    ops.push({
      op: 'create',
      type: 'project',
      ref: 'project',
      data: {
        name: target.name,
        status: 'active',
        summary: pack.summary,
        recordTypes: pack.recordTypes,
        ...(pack.options ? { options: pack.options } : {}),
      },
    });
  } else {
    projectId = target.projectId;
    const taken = pack.recordTypes.filter((t) => target.recordTypes.some((x) => x.key === t.key));
    if (taken.length)
      throw new Error(
        `This project already has record types ${taken.map((t) => `"${t.key}"`).join(', ')}`,
      );
    ops.push({
      op: 'update',
      type: 'project',
      id: projectId,
      data: {
        recordTypes: [...target.recordTypes, ...pack.recordTypes],
        ...(pack.options ? { options: { ...target.options, ...pack.options } } : {}),
      },
    });
  }
  pack.views.forEach((view, i) =>
    ops.push({
      op: 'create',
      type: 'view',
      data: {
        projectId,
        name: view.name,
        ...(view.description ? { description: view.description } : {}),
        pinned: view.pinned ?? i === 0,
        spec: { component: 'Board', widgets: view.widgets },
      },
    }),
  );
  if (options.examples) {
    const project = { data: { recordTypes: pack.recordTypes } };
    for (const example of pack.examples ?? []) {
      ops.push({
        op: 'create',
        type: 'record',
        ref: example.ref,
        data: exampleData(
          example,
          findRecordType(project, example.recordType),
          projectId,
          options.today,
        ),
      });
    }
  }
  return ops;
}
