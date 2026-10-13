import { z } from 'zod';
import { OPTION_COLORS, OptionValue } from './options.js';
import { isCalendarDate } from './views/dates.js';

/**
 * Records (R8): a project keeps its own kinds of records (a car service, a bill) with typed
 * fields. The types are data in `project.data.recordTypes`, never code, so any kind of project
 * works without a release. docs/reframe/r8-notes.md has the design.
 */

export const FIELD_KINDS = [
  'text',
  'number',
  'money',
  'date',
  'option',
  'reference',
  'file',
  'meter',
] as const;
export const FieldKind = z.enum(FIELD_KINDS);
export type FieldKind = z.infer<typeof FieldKind>;

/** A record type's or field's key: stable, lowercase, used in queries as `fields.<key>`. */
export const RecordKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores')
  .max(40);

export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'An ISO 4217 code, e.g. EUR')
  .describe('e.g. EUR, USD, KRW');

/** An amount of money: minor units (cents) plus currency. Pharos never converts currencies. */
export const Money = z.strictObject({
  amount: z.number().int().describe('Minor units, e.g. cents: 1250 is 12.50'),
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

export const RecordFieldDef = z.strictObject({
  key: RecordKey,
  label: z.string().min(1).max(40),
  kind: FieldKind,
  required: z.boolean().optional(),
  unit: z.string().min(1).max(12).optional().describe('number, meter: e.g. "km", "L"'),
  currency: Currency.optional().describe('money: the usual currency'),
  options: z
    .array(
      z.strictObject({
        value: OptionValue,
        label: z.string().min(1).max(40),
        color: z.enum(OPTION_COLORS).optional(),
      }),
    )
    .optional()
    .describe('option: the values'),
  to: RecordKey.optional().describe('reference: the record type it points at'),
});
export type RecordFieldDef = z.infer<typeof RecordFieldDef>;

export const RecordType = z.strictObject({
  key: RecordKey,
  name: z.string().min(1).max(40).describe('Singular, e.g. "Service"'),
  plural: z.string().min(1).max(40).optional(),
  fields: z.array(RecordFieldDef).max(30),
  interval: z.boolean().optional().describe('Records of this type repeat (have an interval)'),
});
export type RecordType = z.infer<typeof RecordType>;

// Shared once in the apply tool's JSON schema ($defs), not repeated per operation (C1).
export const RecordTypes = z.array(RecordType).max(30).meta({ id: 'RecordTypes' });

export const TIME_UNITS = ['days', 'weeks', 'months', 'years'] as const;

/** The four bands of what's due, least urgent first (LubeLogger's). */
export const DUE_BANDS = ['not_urgent', 'urgent', 'very_urgent', 'past_due'] as const;
export type DueBand = (typeof DUE_BANDS)[number];
export const DUE_BAND_LABELS: Record<DueBand, string> = {
  not_urgent: 'Not urgent',
  urgent: 'Urgent',
  very_urgent: 'Very urgent',
  past_due: 'Past due',
};

/** Default band limits: urgent within 30 days or 1,000 units, very urgent within 7 or 250. */
export const DUE_SOON = {
  urgentDays: 30,
  veryUrgentDays: 7,
  urgentMeter: 1000,
  veryUrgentMeter: 250,
};

const IsoDate = z.iso.date();

/**
 * Repeats every N days/weeks/months/years and/or every N meter units, whichever comes first.
 * Rolling counts from when it was last done; fixed keeps a schedule from its start.
 */
export const Interval = z
  .strictObject({
    every: z
      .strictObject({ n: z.number().int().min(1), unit: z.enum(TIME_UNITS) })
      .optional()
      .describe('e.g. {n: 12, unit: "months"}'),
    meter: z
      .strictObject({
        n: z.number().positive(),
        from: z
          .string()
          .min(1)
          .describe('Where the reading is, e.g. "fields.vehicle.fields.odometer"'),
      })
      .optional(),
    mode: z.enum(['rolling', 'fixed']).optional().describe('Default rolling'),
    lastDate: IsoDate.optional().describe('Last done'),
    lastMeter: z.number().optional().describe('Reading when last done'),
    startDate: IsoDate.optional().describe('fixed: schedule start; rolling: first due date'),
    startMeter: z.number().optional(),
    soon: z
      .strictObject({
        urgentDays: z.number().int().min(0).optional(),
        veryUrgentDays: z.number().int().min(0).optional(),
        urgentMeter: z.number().min(0).optional(),
        veryUrgentMeter: z.number().min(0).optional(),
      })
      .optional()
      .describe('Band limits (default 30 / 7 days, 1000 / 250 units)'),
  })
  .meta({ id: 'Interval' });
export type Interval = z.infer<typeof Interval>;

export const FieldValue = z.union([z.string(), z.number(), Money]);
export type FieldValue = z.infer<typeof FieldValue>;

export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Money).amount === 'number' &&
    typeof (value as Money).currency === 'string'
  );
}

/** The project's record types (none by default). */
export function recordTypesOf(
  project: { data: { recordTypes?: RecordType[] } } | null | undefined,
) {
  return project?.data.recordTypes ?? [];
}

export function findRecordType(
  project: { data: { recordTypes?: RecordType[] } } | null | undefined,
  key: string,
): RecordType | undefined {
  return recordTypesOf(project).find((t) => t.key === key);
}

/**
 * Problems with one record's fields against its type (empty when it fits). References and files
 * are checked by the store, which can see other entities.
 */
export function recordFieldIssues(
  type: RecordType,
  fields: Record<string, unknown>,
  hasInterval: boolean,
): string[] {
  const issues: string[] = [];
  const defs = new Map(type.fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(fields)) {
    const def = defs.get(key);
    if (!def) {
      issues.push(
        `fields.${key} isn't a field of ${type.name} (fields: ${type.fields.map((f) => f.key).join(', ') || 'none'})`,
      );
      continue;
    }
    const problem = valueProblem(def, value);
    if (problem) issues.push(`fields.${key}: ${problem}`);
  }
  for (const def of type.fields)
    if (def.required && fields[def.key] === undefined)
      issues.push(`fields.${def.key} is required for ${type.name}`);
  if (hasInterval && !type.interval)
    issues.push(`${type.name} records don't repeat; set interval: true on the record type first`);
  return issues;
}

function valueProblem(def: RecordFieldDef, value: unknown): string | undefined {
  switch (def.kind) {
    case 'text':
      return typeof value === 'string' ? undefined : 'expected text';
    case 'number':
    case 'meter':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'expected a number';
    case 'money':
      return isMoney(value) ? undefined : 'expected {amount (minor units), currency}';
    case 'date':
      if (isCalendarDate(value)) return undefined;
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value} isn't a date on the calendar`
        : 'expected YYYY-MM-DD';
    case 'option': {
      const values = (def.options ?? []).map((o) => o.value);
      return typeof value === 'string' && values.includes(value)
        ? undefined
        : `"${String(value)}" isn't one of ${values.join(', ') || '(no options)'}`;
    }
    case 'reference':
    case 'file':
      return typeof value === 'string' && value.length > 0 ? undefined : 'expected an id';
  }
}

/** Problems with a project's record types themselves: duplicate keys, references to nowhere. */
export function recordTypeIssues(types: RecordType[]): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const t of types) {
    if (keys.has(t.key)) issues.push(`record type "${t.key}" is defined twice`);
    keys.add(t.key);
  }
  for (const t of types) {
    const fieldKeys = new Set<string>();
    for (const f of t.fields) {
      if (fieldKeys.has(f.key)) issues.push(`${t.key}.${f.key} is defined twice`);
      fieldKeys.add(f.key);
      if (f.kind === 'reference' && (!f.to || !keys.has(f.to)))
        issues.push(
          `${t.key}.${f.key} is a reference, so "to" must name a record type (${[...keys].join(', ')})`,
        );
      if (f.kind === 'option' && !f.options?.length)
        issues.push(`${t.key}.${f.key} is an option field without options`);
    }
  }
  return issues;
}
