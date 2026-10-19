import { z } from 'zod';
import { ENTITIES, type Entity, type EntityType, type RefSpec } from '../entities.js';
import { OPTION_FIELDS, OPTION_KEYS, optionsFor, type OptionKey } from '../options.js';
import { DUE_BANDS, recordTypesOf, type FieldKind, type RecordType } from '../records.js';
import { QUERY_HOPS } from './run-query.js';

/**
 * Field metadata (R8.6): what a query may name, derived from ENTITIES and from each project's
 * record types, never from a hand-kept list. The query checks (check-queries.ts) and the blocks
 * that format values read it.
 */

/** Record field kinds, plus the shapes entity fields have. */
export type QueryFieldKind = FieldKind | 'datetime' | 'boolean' | 'list' | 'object' | 'id';

export type FieldInfo = {
  kind: QueryFieldKind;
  /** A project option field (statuses, priorities, …): values are the project's options. */
  optionKey?: OptionKey;
  /** Fixed values: an enum, a record option field or the due bands. */
  options?: string[];
  /** A reference (or list of references) to this entity type. */
  to?: EntityType;
  /** A record reference field: the record type it points at. */
  toRecord?: string;
  /** A list of values; `kind` describes one of them. */
  many?: boolean;
  unit?: string;
  currency?: string;
  /** Different on every row (ids, names): a poor thing to group by. */
  unique?: boolean;
};

const META: Record<string, FieldInfo> = {
  id: { kind: 'id', unique: true },
  createdAt: { kind: 'datetime' },
  updatedAt: { kind: 'datetime' },
};

type Def = { type?: string; format?: string | null };

function zodKind(schema: z.ZodType): { kind: QueryFieldKind; many?: boolean; options?: string[] } {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap() as z.ZodType;
  if (s instanceof z.ZodArray) return { ...zodKind(s.element as z.ZodType), many: true };
  if (s instanceof z.ZodEnum) return { kind: 'option', options: s.options as string[] };
  const def = (s as unknown as { _zod: { def: Def } })._zod.def;
  const format = (s as unknown as { format?: string | null }).format;
  if (def.type === 'string')
    return { kind: format === 'date' ? 'date' : format === 'datetime' ? 'datetime' : 'text' };
  if (def.type === 'number') return { kind: 'number' };
  if (def.type === 'boolean') return { kind: 'boolean' };
  return { kind: 'object' };
}

const ENTITY_FIELD_CACHE = new Map<EntityType, Record<string, FieldInfo>>();

/** Every field of an entity type with its kind, option key, reference target and so on. */
export function entityFields(type: EntityType): Record<string, FieldInfo> {
  const cached = ENTITY_FIELD_CACHE.get(type);
  if (cached) return cached;
  const shape = ENTITIES[type].data.shape as Record<string, z.ZodType>;
  const refs = ENTITIES[type].refs as Record<string, RefSpec>;
  const optionKeys = new Map(
    OPTION_KEYS.filter((k) => OPTION_FIELDS[k].type === type).map((k) => [
      OPTION_FIELDS[k].field as string,
      k,
    ]),
  );
  const out: Record<string, FieldInfo> = { ...META };
  for (const [field, schema] of Object.entries(shape)) {
    const z = zodKind(schema);
    const optionKey = optionKeys.get(field);
    const ref = refs[field];
    const info: FieldInfo = ref
      ? { kind: 'reference', to: ref.type, ...(ref.many ? { many: true } : {}) }
      : optionKey
        ? { kind: 'option', optionKey }
        : {
            kind: z.kind,
            ...(z.many ? { many: true } : {}),
            ...(z.options ? { options: z.options } : {}),
          };
    if (field === ENTITIES[type].label) info.unique = true;
    out[field] = info;
  }
  ENTITY_FIELD_CACHE.set(type, out);
  return out;
}

/** The paths a record of this type has: its own fields, "fields.<key>" and "due.*". */
export function recordFields(recordType: RecordType): Record<string, FieldInfo> {
  const base = entityFields('record');
  const out: Record<string, FieldInfo> = {};
  for (const [k, v] of Object.entries(base)) if (k !== 'fields') out[k] = v;
  out.recordType = { kind: 'option', options: [recordType.key] };
  for (const f of recordType.fields) {
    out[`fields.${f.key}`] = {
      kind: f.kind,
      ...(f.kind === 'option' ? { options: (f.options ?? []).map((o) => o.value) } : {}),
      ...(f.kind === 'reference' && f.to ? { toRecord: f.to } : {}),
      ...(f.kind === 'file' ? { to: 'file' as const } : {}),
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.currency ? { currency: f.currency } : {}),
    };
  }
  if (recordType.interval) {
    out['due.date'] = { kind: 'date' };
    out['due.days'] = { kind: 'number', unit: 'days' };
    out['due.meter'] = { kind: 'meter' };
    out['due.reading'] = { kind: 'meter' };
    out['due.left'] = { kind: 'meter' };
    out['due.band'] = { kind: 'option', options: [...DUE_BANDS] };
  }
  return out;
}

/** Where a path is read from: an entity type, or a record of one record type. */
export type FieldScope = { type: EntityType; recordType?: RecordType };

export type PathResult =
  | { ok: true; info: FieldInfo; scope: FieldScope; field: string }
  | {
      ok: false;
      code: 'unknown-field' | 'unknown-hop';
      message: string;
      allowed: string[];
    };

/** What a scope's paths are called in messages, e.g. "task" or "record type Service". */
export function scopeName(scope: FieldScope): string {
  return scope.recordType ? `${scope.recordType.name} (${scope.recordType.key})` : scope.type;
}

function fieldsOf(scope: FieldScope): Record<string, FieldInfo> {
  return scope.recordType ? recordFields(scope.recordType) : entityFields(scope.type);
}

/** Paths a scope allows, hops included ("stage.…", "fields.vehicle.…"), for messages. */
export function allowedPaths(scope: FieldScope): string[] {
  const own = Object.keys(fieldsOf(scope));
  if (scope.recordType) {
    const hops = scope.recordType.fields
      .filter((f) => f.kind === 'reference' || f.kind === 'file')
      .map((f) => `fields.${f.key}.…`);
    const money = scope.recordType.fields
      .filter((f) => f.kind === 'money')
      .flatMap((f) => [`fields.${f.key}.amount`, `fields.${f.key}.currency`]);
    return [...own, ...money, ...hops];
  }
  const shape = ENTITIES[scope.type].data.shape as Record<string, unknown>;
  const hops = Object.entries(QUERY_HOPS)
    .filter(([, hop]) => hop.field in shape)
    .map(([name]) => `${name}.…`);
  return [...own, ...hops];
}

/**
 * Resolves a query path in a scope: a field, one reference hop ("stage.status",
 * "fields.vehicle.title"), or a money part ("fields.cost.amount"). Unknown paths come back with
 * what is allowed.
 */
export function resolvePath(
  project: Entity<'project'> | null,
  scope: FieldScope,
  path: string,
  hopped = false,
): PathResult {
  const fields = fieldsOf(scope);
  const own = fields[path];
  // Across a reference a label isn't unique any more: many tasks share one stage's name.
  if (own) {
    const info = hopped && own.unique ? { ...own, unique: false } : own;
    return { ok: true, info, scope, field: path };
  }
  const unknown = (message: string, code: 'unknown-field' | 'unknown-hop' = 'unknown-field') =>
    ({ ok: false, code, message, allowed: allowedPaths(scope) }) as const;

  if (scope.recordType && path.startsWith('fields.')) {
    const rest = path.slice(7);
    const dot = rest.indexOf('.');
    if (dot < 0) return unknown(`"${path}" isn't a field of ${scopeName(scope)}`);
    const key = rest.slice(0, dot);
    const tail = rest.slice(dot + 1);
    const def = scope.recordType.fields.find((f) => f.key === key);
    if (!def) return unknown(`"${path}" isn't a field of ${scopeName(scope)}`);
    if (def.kind === 'money') {
      if (tail === 'amount')
        return { ok: true, info: { kind: 'number', currency: def.currency }, scope, field: path };
      if (tail === 'currency') return { ok: true, info: { kind: 'text' }, scope, field: path };
      return unknown(`"${path}": a money field has only .amount and .currency`);
    }
    if (def.kind !== 'reference' && def.kind !== 'file')
      return unknown(
        `"${path}": fields.${key} is ${def.kind}, not a reference you can follow`,
        'unknown-hop',
      );
    if (hopped) return unknown(`"${path}": queries follow one reference only`, 'unknown-hop');
    const target: FieldScope =
      def.kind === 'file'
        ? { type: 'file' }
        : {
            type: 'record',
            recordType: recordTypesOf(project).find((t) => t.key === def.to),
          };
    if (def.kind === 'reference' && !target.recordType)
      return unknown(`"${path}": fields.${key} points at an unknown record type`, 'unknown-hop');
    return renamed(resolvePath(project, target, tail, true), tail, path);
  }

  const dot = path.indexOf('.');
  if (dot > 0) {
    const name = path.slice(0, dot);
    const hop = QUERY_HOPS[name];
    const shape = ENTITIES[scope.type].data.shape as Record<string, unknown>;
    if (!hop || scope.recordType) {
      const hops = Object.entries(QUERY_HOPS)
        .filter(([, h]) => h.field in shape)
        .map(([n]) => `${n}.`);
      return unknown(
        scope.recordType
          ? `"${path}" isn't a field of ${scopeName(scope)}`
          : `"${path}": "${name}" isn't a reference you can follow (use ${hops.join(', ') || 'none'})`,
        scope.recordType ? 'unknown-field' : 'unknown-hop',
      );
    }
    if (!(hop.field in shape))
      return unknown(`"${path}": ${scope.type} has no ${name}`, 'unknown-hop');
    if (hopped) return unknown(`"${path}": queries follow one reference only`, 'unknown-hop');
    const rest = path.slice(dot + 1);
    return renamed(resolvePath(project, { type: hop.type }, rest, true), rest, path);
  }
  return unknown(`"${path}" isn't a field of ${scopeName(scope)}`);
}

/** Messages name the full path the author wrote, not the part after the hop. */
function renamed(result: PathResult, rest: string, path: string): PathResult {
  if (result.ok) return result;
  const prefix = path.slice(0, path.length - rest.length);
  return {
    ...result,
    message: result.message.replace(`"${rest}"`, `"${path}"`),
    allowed: result.allowed.map((a) => `${prefix}${a}`),
  };
}

/** The values an option field takes in this project: stored values and their meanings. */
export function optionValues(project: Entity<'project'> | null, info: FieldInfo): string[] {
  if (info.optionKey) {
    const options = optionsFor(project, info.optionKey);
    return [...new Set([...options.map((o) => o.value), ...options.map((o) => o.meaning)])];
  }
  return info.options ?? [];
}
