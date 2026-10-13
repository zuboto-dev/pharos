import { z } from 'zod';
import type { Entity } from './entities.js';
import {
  FieldValue,
  RecordKey,
  findRecordType,
  isMoney,
  type FieldKind,
  type Interval,
  type RecordFieldDef,
  type RecordType,
} from './records.js';
import type { Operation } from './revisions.js';

/**
 * Record-form actions (R10): "Log a service", "Mark paid". An action is a button on a page and a
 * short form built from a record type's fields. Its definition lives in the page (the props of an
 * Action block, so packs ship it as data and agents add it with the view tools); a submission
 * names the block it came from, and the server reads the definition from the saved page, never
 * from the request. docs/reframe/r10-notes.md has the contract, the error table and examples.
 *
 * Three kinds of state, kept apart:
 * - local form state (what the person typed, pending, the field errors shown) stays in the page;
 * - a submission is one store write: one revision through Store.apply, attributed to its author,
 *   undone by reverting that revision;
 * - nothing in an action asks an agent to reason. Asking about a block is a request instead.
 */

export const ACTION_VERSION = 1;

/** What an action does. */
export const ACTION_KINDS = ['create', 'done'] as const;

/** Done actions: also add a record of another type, e.g. a spending when a bill is paid. */
export const ActionLog = z.strictObject({
  recordType: RecordKey.describe('The record type to add, e.g. "spending"'),
  fields: z
    .record(RecordKey, z.string().min(1))
    .describe(
      'Its fields by key: "$date" (the date entered), "$title" (the title of the record marked done) or "fields.<key>" (a field of it), e.g. {"date": "$date", "amount": "fields.amount"}',
    ),
  ask: z
    .array(RecordKey)
    .max(4)
    .optional()
    .describe('Of those fields, the ones the form shows to change, e.g. ["amount"]'),
});
export type ActionLog = z.infer<typeof ActionLog>;

/** Create actions: mark matching repeating records done, e.g. the oil reminder after an oil change. */
export const ActionRoll = z.strictObject({
  recordType: RecordKey.describe('A repeating record type, e.g. "reminder"'),
  match: z
    .array(RecordKey)
    .min(1)
    .max(3)
    .describe('Fields both records share that must be equal, e.g. ["vehicle", "kind"]'),
  date: RecordKey.optional().describe('The new record\'s date field (default "date")'),
  meter: RecordKey.optional().describe('The new record\'s reading, for lastMeter, e.g. "odometer"'),
});
export type ActionRoll = z.infer<typeof ActionRoll>;

/** Create actions: raise a reading on the record it points at, e.g. the car's odometer. */
export const ActionRaise = z.strictObject({
  via: RecordKey.describe('A reference field of the new record, e.g. "vehicle"'),
  field: RecordKey.describe(
    'The number or meter field on the record it points at, e.g. "odometer"',
  ),
  from: RecordKey.describe('The new record\'s value, e.g. "odometer"; only ever raises it'),
});
export type ActionRaise = z.infer<typeof ActionRaise>;

/** The Action block's props that define the action (spread into the catalog's ActionNode). */
export const ACTION_FIELDS = {
  label: z.string().min(1).max(40).describe('The button, a verb first, e.g. "Log a service"'),
  recordType: RecordKey.describe(
    'create: the record type the form adds; done: the repeating record type it marks done',
  ),
  does: z
    .enum(ACTION_KINDS)
    .optional()
    .describe(
      '"create" (default) adds a record; "done" marks a repeating record done on a date (sets interval.lastDate), e.g. "Mark paid"',
    ),
  fields: z
    .array(RecordKey)
    .min(1)
    .max(10)
    .optional()
    .describe('create: the fields the form asks for, in order (default all of the type)'),
  log: ActionLog.optional(),
  roll: ActionRoll.optional(),
  raise: ActionRaise.optional(),
  description: z.string().max(120).optional().describe('One short line under the button'),
};

export const ActionDef = z.strictObject(ACTION_FIELDS);
export type ActionDef = z.infer<typeof ActionDef>;

// ------------------------------------------------------------------ the submission (v1)

/** An idempotency key: the form makes one when it opens and sends it with every retry. */
export const IdempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,100}$/, '8–100 letters, digits, "_", ".", ":" or "-"');

/**
 * One submission of an action, independent of transport (REST and MCP send the same object).
 * The project, page and block give the context; the server reads the action from that block.
 */
export const ActionSubmission = z.strictObject({
  v: z.literal(ACTION_VERSION).describe('Contract version (1)'),
  projectId: z.string().min(1),
  viewId: z.string().min(1).describe('The page (view) the Action block is on'),
  widgetId: z.string().min(1).describe('The id of the Action block on that page'),
  recordId: z
    .string()
    .min(1)
    .optional()
    .describe('done: the repeating record marked done, e.g. the bill paid'),
  title: z.string().trim().max(200).optional().describe("create: the new record's title"),
  values: z
    .record(z.string(), z.union([FieldValue, z.null()]))
    .describe(
      'By field key: money {amount in cents, currency}, dates YYYY-MM-DD, option values, record ids for references. done: "date" (required) and "meter" (a reading), plus the log fields the form asks for',
    ),
  idempotencyKey: IdempotencyKey.describe(
    'Made once per form; a retry with the same key returns the first result and writes nothing',
  ),
  expectedRevision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "done: the record's updatedRev when the form was filled (required); a newer one means someone changed it: stale",
    ),
});
export type ActionSubmission = z.infer<typeof ActionSubmission>;

// ------------------------------------------------------------------ results

export const ACTION_STATUSES = [
  'done',
  'duplicate',
  'invalid',
  'stale',
  'not_found',
  'failed',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** The HTTP status each result is sent with over REST. */
export const ACTION_HTTP_STATUS: Record<ActionStatus, 200 | 400 | 404 | 409 | 500> = {
  done: 200,
  duplicate: 200,
  invalid: 400,
  not_found: 404,
  stale: 409,
  failed: 500,
};

export type ActionDone = {
  v: typeof ACTION_VERSION;
  /** "duplicate": the same submission (same idempotency key) was saved before; nothing new. */
  status: 'done' | 'duplicate';
  /** The revision it made; null when it changed nothing. Reverting it undoes the action. */
  revision: number | null;
  /** The record created (create) or marked done (done). */
  recordId: string;
  created: string[];
  updated: string[];
  message: string;
  /** duplicate: the revision was undone since (revert it again by submitting a new form). */
  undone?: boolean;
};

export type ActionResult =
  | ActionDone
  | {
      v: typeof ACTION_VERSION;
      status: 'invalid';
      message: string;
      /** By form field: "title", "recordId", a value key, or "form" for the whole submission. */
      fieldErrors: Record<string, string>;
    }
  | {
      v: typeof ACTION_VERSION;
      status: 'stale';
      message: string;
      /** The record as it is now, to show and to submit again with. */
      current: { recordId: string; revision: number; title: string; lastDate?: string };
    }
  | { v: typeof ACTION_VERSION; status: 'not_found' | 'failed'; message: string };

// ------------------------------------------------------------------ the form

/** One field of an action's form, generated from the record type. */
export type ActionFormField = {
  /** "title", "recordId", or the key in `values`. */
  key: string;
  label: string;
  kind: FieldKind | 'record';
  required: boolean;
  unit?: string;
  currency?: string;
  options?: { value: string; label: string }[];
  /** reference: the record type it points at; record: the type picked from. */
  to?: string;
};

export type ActionForm = { kind: 'create' | 'done'; type: RecordType; fields: ActionFormField[] };

function formField(def: RecordFieldDef, required = def.required ?? false): ActionFormField {
  return {
    key: def.key,
    label: def.label,
    kind: def.kind,
    required,
    ...(def.unit ? { unit: def.unit } : {}),
    ...(def.currency ? { currency: def.currency } : {}),
    ...(def.options ? { options: def.options.map(({ value, label }) => ({ value, label })) } : {}),
    ...(def.to ? { to: def.to } : {}),
  };
}

type ProjectLike = { data: { recordTypes?: RecordType[] } } | null | undefined;

/**
 * The form an action shows, from its record type's fields, or why it can't be shown (a record type
 * or field the project doesn't have). Also checks an Action block before it is saved.
 */
export function actionForm(
  def: ActionDef,
  project: ProjectLike,
): { form?: ActionForm; problems: string[] } {
  const problems: string[] = [];
  const type = findRecordType(project, def.recordType);
  const keys = (project?.data.recordTypes ?? []).map((t) => t.key).join(', ') || 'none';
  if (!type)
    return { problems: [`recordType "${def.recordType}" isn't a record type here (${keys})`] };
  const fieldOf = (t: RecordType, key: string, what: string) => {
    const f = t.fields.find((x) => x.key === key);
    if (!f)
      problems.push(
        `${what} "${key}" isn't a field of ${t.name} (${t.fields.map((x) => x.key).join(', ')})`,
      );
    return f;
  };
  const does = def.does ?? 'create';
  const fields: ActionFormField[] = [];
  if (does === 'create') {
    if (def.log) problems.push('log is for done actions; a create action adds one record');
    fields.push({ key: 'title', label: 'Title', kind: 'text', required: false });
    const keys = def.fields ?? type.fields.map((f) => f.key);
    for (const key of keys) {
      const f = fieldOf(type, key, 'fields:');
      if (f) fields.push(formField(f));
    }
    // A required field the form leaves out can never be filled.
    for (const f of type.fields)
      if (f.required && !keys.includes(f.key))
        problems.push(`fields leaves out "${f.key}", which ${type.name} requires`);
    if (def.roll) {
      const roll = findRecordType(project, def.roll.recordType);
      if (!roll) problems.push(`roll.recordType "${def.roll.recordType}" isn't a record type here`);
      else {
        if (!roll.interval) problems.push(`roll.recordType "${roll.key}" doesn't repeat`);
        for (const key of def.roll.match) {
          fieldOf(type, key, 'roll.match');
          fieldOf(roll, key, 'roll.match');
        }
      }
      const date = fieldOf(type, def.roll.date ?? 'date', 'roll.date');
      if (date && date.kind !== 'date') problems.push(`roll.date "${date.key}" isn't a date field`);
      if (def.roll.meter) {
        const meter = fieldOf(type, def.roll.meter, 'roll.meter');
        if (meter && meter.kind !== 'meter' && meter.kind !== 'number')
          problems.push(`roll.meter "${meter.key}" isn't a number or meter field`);
      }
    }
    if (def.raise) {
      const via = fieldOf(type, def.raise.via, 'raise.via');
      const from = fieldOf(type, def.raise.from, 'raise.from');
      if (via && via.kind !== 'reference')
        problems.push(`raise.via "${via.key}" isn't a reference field`);
      const target = via?.to ? findRecordType(project, via.to) : undefined;
      if (target) {
        const field = fieldOf(target, def.raise.field, 'raise.field');
        if (field && field.kind !== 'meter' && field.kind !== 'number')
          problems.push(`raise.field "${field.key}" isn't a number or meter field`);
      }
      if (from && from.kind !== 'meter' && from.kind !== 'number')
        problems.push(`raise.from "${from.key}" isn't a number or meter field`);
    }
  } else {
    if (!type.interval)
      problems.push(`${type.name} records don't repeat, so they can't be marked done`);
    if (def.fields || def.roll || def.raise)
      problems.push('fields, roll and raise are for create actions; a done action uses log');
    fields.push({
      key: 'recordId',
      label: type.name,
      kind: 'record',
      required: true,
      to: type.key,
    });
    fields.push({ key: 'date', label: 'Date', kind: 'date', required: true });
    if (def.log) {
      const log = findRecordType(project, def.log.recordType);
      if (!log) problems.push(`log.recordType "${def.log.recordType}" isn't a record type here`);
      else {
        for (const [key, source] of Object.entries(def.log.fields)) {
          fieldOf(log, key, 'log.fields');
          if (source.startsWith('fields.')) fieldOf(type, source.slice(7), 'log.fields source');
          else if (source !== '$date' && source !== '$title')
            problems.push(`log.fields.${key}: use "$date", "$title" or "fields.<key>"`);
        }
        for (const f of log.fields)
          if (f.required && !(f.key in def.log.fields))
            problems.push(`log.fields leaves out "${f.key}", which ${log.name} requires`);
        for (const key of def.log.ask ?? []) {
          if (key === 'date' || key === 'meter' || key === 'recordId')
            problems.push(`log.ask can't use "${key}"; the form already asks for it`);
          else if (!(key in def.log.fields)) problems.push(`log.ask "${key}" isn't in log.fields`);
          // Filled from log.fields when left empty, so never required in the form.
          const f = fieldOf(log, key, 'log.ask');
          if (f) fields.push(formField(f, false));
        }
      }
    }
  }
  return problems.length ? { problems } : { form: { kind: does, type, fields }, problems };
}

/** The field shown for a done record's reading, when its interval counts a meter. */
export function meterField(interval: Interval | undefined, type: RecordType): ActionFormField[] {
  if (!interval?.meter) return [];
  const unit = type.fields.find((f) => f.kind === 'meter')?.unit;
  return [
    { key: 'meter', label: 'Reading', kind: 'meter', required: false, ...(unit ? { unit } : {}) },
  ];
}

// ------------------------------------------------------------------ checks

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** What the form shows under a field when its value doesn't fit (undefined when it does). */
export function fieldError(field: ActionFormField, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '')
    return field.required ? `${field.label} is required` : undefined;
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' && value.length <= 200
        ? undefined
        : `${field.label}: up to 200 characters`;
    case 'number':
    case 'meter':
      return typeof value === 'number' && Number.isFinite(value)
        ? value < 0 && field.kind === 'meter'
          ? `${field.label} can't be negative`
          : undefined
        : `${field.label} must be a number`;
    case 'money':
      if (!isMoney(value) || !Number.isInteger(value.amount) || !/^[A-Z]{3}$/.test(value.currency))
        return `${field.label} must be an amount, e.g. 12.50`;
      return value.amount < 0 ? `${field.label} can't be negative` : undefined;
    case 'date':
      return typeof value === 'string' && validDate(value)
        ? undefined
        : `${field.label} must be a date (YYYY-MM-DD)`;
    case 'option':
      return typeof value === 'string' && (field.options ?? []).some((o) => o.value === value)
        ? undefined
        : `${field.label}: pick one of ${(field.options ?? []).map((o) => o.label).join(', ')}`;
    case 'reference':
    case 'file':
    case 'record':
      return typeof value === 'string' && value.length > 0 ? undefined : `${field.label}: pick one`;
  }
}

/** Looks up an entity by id (the store, or the page's data). */
export type Lookup = (id: string) => Entity | null | undefined;

/**
 * Every problem with a submission, by form field, against the action's form and the project's
 * records: kinds, required fields, and references to records and files of this project.
 */
export function submissionErrors(
  form: ActionForm,
  submission: Pick<ActionSubmission, 'projectId' | 'recordId' | 'title' | 'values'>,
  lookup: Lookup,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const target =
    form.kind === 'done' && submission.recordId ? lookup(submission.recordId) : undefined;
  const fields = [
    ...form.fields,
    ...(form.kind === 'done' && target?.type === 'record'
      ? meterField((target as Entity<'record'>).data.interval, form.type)
      : []),
  ];
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(submission.values))
    if (!known.has(key) || key === 'title' || key === 'recordId')
      errors[key] = `"${key}" isn't asked by this form (${[...known].join(', ')})`;
  for (const field of fields) {
    const value =
      field.key === 'title'
        ? submission.title
        : field.key === 'recordId'
          ? submission.recordId
          : submission.values[field.key];
    const problem = fieldError(field, value);
    if (problem) {
      errors[field.key] = problem;
      continue;
    }
    if (typeof value !== 'string' || !['reference', 'file', 'record'].includes(field.kind))
      continue;
    const found = lookup(value);
    const data = found?.data as { projectId?: string; recordType?: string } | undefined;
    const want = field.kind === 'file' ? 'file' : 'record';
    if (!found || found.type !== want || data?.projectId !== submission.projectId)
      errors[field.key] = `${field.label}: that ${want} isn't in this project`;
    else if (field.to && data?.recordType !== field.to)
      errors[field.key] = `${field.label}: pick a ${field.to} record`;
    else if (field.kind === 'record' && !(found as Entity<'record'>).data.interval)
      errors[field.key] = `${field.label}: that record doesn't repeat`;
  }
  return errors;
}

// ------------------------------------------------------------------ the write

function sameValue(a: unknown, b: unknown): boolean {
  if (isMoney(a) && isMoney(b)) return a.amount === b.amount && a.currency === b.currency;
  return a === b;
}

function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

/** The default title of a created record: its first option's label, else the type and date. */
function defaultTitle(form: ActionForm, values: Record<string, unknown>): string {
  for (const f of form.fields)
    if (f.kind === 'option' && typeof values[f.key] === 'string')
      return f.options?.find((o) => o.value === values[f.key])?.label ?? String(values[f.key]);
  const date = form.fields.find((f) => f.kind === 'date' && typeof values[f.key] === 'string');
  return date ? `${form.type.name} ${String(values[date.key])}` : form.type.name;
}

/** The value a done action's log field starts with, from the record marked done. */
export function logValue(
  source: string,
  record: Entity<'record'>,
  date: string | undefined,
): unknown {
  if (source === '$date') return date;
  if (source === '$title') return record.data.title;
  if (source.startsWith('fields.')) return record.data.fields[source.slice(7)];
  return undefined;
}

/**
 * The operations one submission makes, as one revision: the record created (with the repeating
 * records it marks done and the reading it raises), or the record marked done (with its log).
 * Expects a submission without errors (`submissionErrors`).
 */
export function actionOperations(
  def: ActionDef,
  form: ActionForm,
  submission: ActionSubmission,
  records: Entity<'record'>[],
  lookup: Lookup,
): { message: string; operations: Operation[]; recordId: string } {
  const values = defined(submission.values);
  const operations: Operation[] = [];
  if (form.kind === 'create') {
    const fields = Object.fromEntries(
      Object.entries(values).filter(([k]) => form.fields.some((f) => f.key === k)),
    );
    const title = submission.title?.trim() || defaultTitle(form, fields);
    operations.push({
      op: 'create',
      type: 'record',
      ref: 'action',
      data: { projectId: submission.projectId, recordType: form.type.key, title, fields },
    });
    if (def.roll) {
      const date = fields[def.roll.date ?? 'date'];
      const meter = def.roll.meter ? fields[def.roll.meter] : undefined;
      const match = def.roll.match;
      for (const r of records) {
        if (r.data.recordType !== def.roll.recordType || !r.data.interval) continue;
        if (!match.every((k) => fields[k] !== undefined && sameValue(r.data.fields[k], fields[k])))
          continue;
        const interval: Interval = { ...r.data.interval };
        if (typeof date === 'string' && (!interval.lastDate || date >= interval.lastDate))
          interval.lastDate = date;
        if (
          typeof meter === 'number' &&
          interval.meter &&
          (interval.lastMeter === undefined || meter >= interval.lastMeter)
        )
          interval.lastMeter = meter;
        if (
          interval.lastDate !== r.data.interval.lastDate ||
          interval.lastMeter !== r.data.interval.lastMeter
        )
          operations.push({ op: 'update', type: 'record', id: r.id, data: { interval } });
      }
    }
    if (def.raise) {
      const id = fields[def.raise.via];
      const value = fields[def.raise.from];
      const target = typeof id === 'string' ? lookup(id) : undefined;
      if (target?.type === 'record' && typeof value === 'number') {
        const now = (target as Entity<'record'>).data.fields[def.raise.field];
        if (typeof now !== 'number' || value > now)
          operations.push({
            op: 'update',
            type: 'record',
            id: target.id,
            data: { fields: { [def.raise.field]: value } },
          });
      }
    }
    return { message: `${def.label}: ${title}`, operations, recordId: '$action' };
  }
  const record = lookup(submission.recordId!) as Entity<'record'>;
  const date = values.date as string;
  const interval: Interval = { ...record.data.interval!, lastDate: date };
  if (typeof values.meter === 'number' && interval.meter) interval.lastMeter = values.meter;
  operations.push({ op: 'update', type: 'record', id: record.id, data: { interval } });
  if (def.log) {
    const fields: Record<string, unknown> = {};
    for (const [key, source] of Object.entries(def.log.fields)) {
      const asked = def.log.ask?.includes(key) ? values[key] : undefined;
      const value = asked ?? logValue(source, record, date);
      if (value !== undefined) fields[key] = value;
    }
    operations.push({
      op: 'create',
      type: 'record',
      ref: 'log',
      data: {
        projectId: submission.projectId,
        recordType: def.log.recordType,
        title: record.data.title,
        fields,
      },
    });
  }
  return {
    message: `${def.label}: ${record.data.title} (${date})`,
    operations,
    recordId: record.id,
  };
}

/** A stable fingerprint of a submission, apart from its key: a reused key must send the same. */
export function submissionFingerprint(submission: ActionSubmission): string {
  const { idempotencyKey: _key, ...rest } = submission;
  void _key;
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sort((value as Record<string, unknown>)[k])]),
          )
        : value;
  return JSON.stringify(sort(rest));
}
