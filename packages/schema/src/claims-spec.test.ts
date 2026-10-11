// Claim schema and certainty tests · 2026-10-11 · GPT-6-Astra · 75c8964
import { describe, expect, it } from 'vitest';
import type { Entity, EntityDataMap, EntityType } from './entities.js';
import { ClaimData, Certainty, ENTITIES } from './entities.js';
import { defaultOptions, RANKED_MEANINGS, type ProjectOptions } from './options.js';
import type { ProjectDataset } from './views/query.js';
import { runQuery } from './views/run-query.js';

let revision = 0;
function entity<T extends EntityType>(type: T, id: string, data: EntityDataMap[T]): Entity<T> {
  revision++;
  return {
    id,
    type,
    data,
    createdAt: '',
    updatedAt: '',
    createdRev: revision,
    updatedRev: revision,
  };
}

const certaintyOptions: NonNullable<ProjectOptions['claim.certainty']> = [
  { value: 'owner_ok', label: 'Owner settled', meaning: 'confirmed' },
  { value: 'source_checked', label: 'Evidence checked', meaning: 'verified' },
  { value: 'analysis', label: 'Our analysis', meaning: 'reading' },
];

describe('claim schema from the slice spec', () => {
  const validClaim = {
    projectId: 'prj_example',
    statement: 'The format can describe a useful interface.',
    certainty: 'reading',
    checkedOn: '2026-10-11',
    sourceIds: [],
    tags: [],
    order: 0,
  };

  it('keeps the certainty meanings, labels, colors, and meaning defaults', () => {
    expect(Certainty.options).toEqual(['reading', 'verified', 'confirmed']);
    expect(
      defaultOptions('claim.certainty').map(({ value, label, meaning, color }) => [
        value,
        label,
        meaning,
        color,
      ]),
    ).toEqual([
      ['reading', 'Our reading', 'reading', 'amber'],
      ['verified', 'From source', 'verified', 'green'],
      ['confirmed', 'Confirmed by you', 'confirmed', 'violet'],
    ]);
    expect(ENTITIES.claim.defaults).toEqual({ certainty: 'reading', sourceIds: [], tags: [] });
    expect(RANKED_MEANINGS['claim.certainty']).toEqual(['reading', 'verified', 'confirmed']);
  });

  it('requires the specified claim fields and enforces text and date limits', () => {
    expect(ClaimData.safeParse(validClaim).success).toBe(true);
    expect(ClaimData.safeParse({ ...validClaim, checkedOn: undefined }).success).toBe(false);
    expect(
      ClaimData.safeParse({ ...validClaim, statement: 's'.repeat(200), detail: 'd'.repeat(400) })
        .success,
    ).toBe(true);
    expect(ClaimData.safeParse({ ...validClaim, statement: 's'.repeat(201) }).success).toBe(false);
    expect(ClaimData.safeParse({ ...validClaim, detail: 'd'.repeat(401) }).success).toBe(false);
    expect(ClaimData.safeParse({ ...validClaim, checkedOn: '2026-02-30' }).success).toBe(false);
    expect(ClaimData.safeParse({ ...validClaim, uncheckedFact: true }).success).toBe(false);
  });
});

describe('certainty queries with owner-renamed options', () => {
  const project = entity('project', 'prj_example', {
    name: 'Map',
    status: 'active',
    order: 0,
    options: { 'claim.certainty': certaintyOptions },
  });
  const claim = (id: string, certainty: string, order: number) =>
    entity('claim', id, {
      projectId: project.id,
      statement: `Finding ${id}`,
      certainty,
      checkedOn: '2026-10-11',
      sourceIds: [],
      tags: [],
      order,
    });
  const claims = [
    claim('analysis', 'analysis', 0),
    claim('evidence', 'source_checked', 1),
    claim('owner', 'owner_ok', 2),
  ];
  const data: ProjectDataset = {
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
    claims,
    terms: [],
  };
  const ids = (rows: { id: string }[]) => rows.map(({ id }) => id);

  it('filters ranges by certainty meaning, independent of display order and labels', () => {
    expect(ids(runQuery(data, 'claim', { where: { certainty: { gte: 'verified' } } }))).toEqual([
      'evidence',
      'owner',
    ]);
    expect(ids(runQuery(data, 'claim', { where: { certainty: { lt: 'verified' } } }))).toEqual([
      'analysis',
    ]);
    expect(ids(runQuery(data, 'claim', { where: { certainty: 'verified' } }))).toEqual([
      'evidence',
    ]);
  });

  it('sorts weakest to strongest by meaning even when strongest is listed first', () => {
    expect(ids(runQuery(data, 'claim', { sort: [{ field: 'certainty' }] }))).toEqual([
      'analysis',
      'evidence',
      'owner',
    ]);
    expect(ids(runQuery(data, 'claim', { sort: [{ field: 'certainty', dir: 'desc' }] }))).toEqual([
      'owner',
      'evidence',
      'analysis',
    ]);
  });
});
