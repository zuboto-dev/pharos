import { z } from 'zod';
import type { Entity } from '../entities.js';
import { findRecordType } from '../records.js';
import { Board, Widget } from '../views/board.js';
import { relativeDate } from '../views/dates.js';
import { FINDING_LEVELS, type FindingCode } from '../views/check-queries.js';
import type { ProjectDataset } from '../views/query.js';
import { Fact } from './fact-check.js';
import { PackRecord, exampleData, type Pack } from './pack.js';

/**
 * Pack cases (R8.2, R8.10): made-up records with the facts their pack page must show, and specs
 * the query checks must refuse or accept. Versioned: changing a case means bumping its version
 * (versions.json locks each case's content).
 */

const Common = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().min(1),
  pack: z.enum(['car', 'money', 'music', 'study', 'company']),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
};

export const FactCase = z.strictObject({
  ...Common,
  /** The day the page is read on, so due dates and "this month" are fixed. */
  today: z.iso.date(),
  /** Name of a fixture in the same file. */
  fixture: z.string().min(1),
  /** Widget-for-widget page to check; default: the pack's first page. */
  page: z.array(Widget).optional(),
  facts: z.array(Fact).min(1),
});
export type FactCase = z.infer<typeof FactCase>;

const CODES = Object.keys(FINDING_LEVELS) as [FindingCode, ...FindingCode[]];

export const QueryCheckCase = z.strictObject({
  ...Common,
  widgets: z.array(Widget).min(1),
  /** reject: the store refuses the save; accept: it saves (warnings allowed). */
  expect: z.enum(['reject', 'accept']),
  /** Findings it must report (reject or warn). */
  codes: z.array(z.enum(CODES)).optional(),
});
export type QueryCheckCase = z.infer<typeof QueryCheckCase>;

/**
 * A made-up project file for a case (R9): its details only, as an agent would set them. Records
 * point at it with "$<ref>" in a file field; its id is "file_<ref>".
 */
export const PackFile = z.strictObject({
  ref: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().min(1).max(200),
  path: z.string().min(1),
  kind: z.string().min(1).optional(),
  issuer: z.string().min(1).optional(),
  issuedDate: z.string().optional().describe('YYYY-MM-DD or relative, e.g. "$today-300d"'),
  expiryDate: z.string().optional().describe('YYYY-MM-DD or relative, e.g. "$today+40d"'),
  tags: z.array(z.string().min(1)).optional(),
});
export type PackFile = z.infer<typeof PackFile>;

export const CaseFile = z.strictObject({
  fixtures: z.record(z.string(), z.array(PackRecord)).optional(),
  /** Project files for the fixture of the same name (R9). */
  files: z.record(z.string(), z.array(PackFile)).optional(),
  cases: z.array(FactCase).optional(),
  queryChecks: z.array(QueryCheckCase).optional(),
});
export type CaseFile = z.infer<typeof CaseFile>;

/** cyrb53: a small string hash that runs anywhere (no node:crypto in the shared schema). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A case's content hash, without its version, for the version lock. */
export function caseHash(
  c: FactCase | QueryCheckCase,
  fixture?: unknown,
  files?: unknown,
): string {
  const rest: Record<string, unknown> = { ...c };
  delete rest.version;
  // Cases without files hash as before, so R8's locked versions stay valid.
  return hash53(
    JSON.stringify({ case: rest, fixture: fixture ?? null, ...(files ? { files } : {}) }),
  );
}

const AT = '2026-01-01T00:00:00.000Z';

function entity<T extends Entity['type']>(
  type: T,
  id: string,
  data: unknown,
  rev: number,
): Entity<T> {
  return {
    id,
    type,
    data,
    createdAt: AT,
    updatedAt: AT,
    createdRev: rev,
    updatedRev: rev,
  } as Entity<T>;
}

/**
 * A dataset for a pack project holding these records, without a store: ids are "rec_<ref>" and
 * "$ref" references point at them. The server's tests run the same records through the store.
 */
export function packDataset(
  pack: Pack,
  records: PackRecord[],
  today: string,
  files: PackFile[] = [],
): ProjectDataset {
  const project = entity(
    'project',
    'prj_case',
    {
      name: pack.name,
      status: 'active',
      order: 0,
      recordTypes: pack.recordTypes,
      ...(pack.options ? { options: pack.options } : {}),
    },
    1,
  );
  const ids = new Map([
    ...records.map((r) => [r.ref, `rec_${r.ref}`] as const),
    ...files.map((f) => [f.ref, `file_${f.ref}`] as const),
  ]);
  const date = (v: string | undefined) =>
    v === undefined ? undefined : v.startsWith('$') ? (relativeDate(v, today) ?? v) : v;
  const fileEntities = files.map((f, i) => {
    const issuedDate = date(f.issuedDate);
    const expiryDate = date(f.expiryDate);
    return entity(
      'file',
      `file_${f.ref}`,
      {
        projectId: project.id,
        title: f.title,
        rootId: 'root_case',
        path: f.path,
        size: 1000,
        modifiedAt: AT,
        kind: f.kind ?? 'other',
        ...(f.issuer ? { issuer: f.issuer } : {}),
        ...(issuedDate ? { issuedDate } : {}),
        ...(expiryDate ? { expiryDate } : {}),
        tags: f.tags ?? [],
        taskIds: [],
      },
      records.length + i + 2,
    );
  });
  const resolved = records.map((r, i) => {
    const data = exampleData(r, findRecordType(project, r.recordType), project.id, today);
    for (const [key, value] of Object.entries(data.fields))
      if (typeof value === 'string' && value.startsWith('$') && ids.has(value.slice(1)))
        data.fields[key] = ids.get(value.slice(1));
    return entity('record', ids.get(r.ref)!, { ...data, order: i }, i + 2);
  });
  return {
    project,
    repository: null,
    assignees: [],
    goals: [],
    scopeItems: [],
    stages: [],
    tasks: [],
    artifacts: [],
    decisions: [],
    views: [],
    requests: [],
    claims: [],
    terms: [],
    files: fileEntities,
    records: resolved,
  };
}

/** The board a fact case checks. */
export function caseBoard(pack: Pack, c: FactCase): Board {
  return Board.parse({ component: 'Board', widgets: c.page ?? pack.views[0]!.widgets });
}
