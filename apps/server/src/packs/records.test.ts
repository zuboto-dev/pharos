import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Board,
  CaseFile,
  ENTITIES,
  caseBoard,
  checkFacts,
  findPack,
  toBoard,
  type Entity,
  type ViewSpec,
} from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { PharosError } from '../store/errors.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { createView, previewView, updateView } from '../views/service.js';
import { applyPack } from './service.js';

const agent = { kind: 'agent', name: 'Opus 5.5' } as const;
const human = { kind: 'human', name: 'owner' } as const;
const TODAY = '2026-10-13';
const here = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/schema/src/packs');
const caseFile = (name: string) =>
  CaseFile.parse(JSON.parse(readFileSync(join(here, 'cases', name), 'utf8')));

function store() {
  return new Store(openDatabase(':memory:'));
}

function carProject(s: Store, examples = false) {
  return applyPack(s, agent, { pack: 'car', name: 'Car', examples }, TODAY);
}

function refusal(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (err) {
    if (err instanceof PharosError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('packs', () => {
  it('start a project in one revision, with its page and no project-management Overview', () => {
    const s = store();
    const result = carProject(s, true);
    expect(result.views.map((v) => v.name)).toEqual(["What's due"]);
    const views = s.list('view', { projectId: result.projectId });
    expect(views.map((v) => v.data.name)).toEqual(["What's due"]);
    expect(result.records).toBe(12);
    expect(result.warnings).toEqual([]);
    expect(result.guide).toMatch(/reminder/);
    expect(s.history({ projectId: result.projectId })).toHaveLength(1);
    // The examples' references were resolved to the vehicle created in the same apply.
    const oil = s
      .list('record', { projectId: result.projectId })
      .find((r) => r.data.title === 'Oil change')!;
    const car = s.get(oil.data.fields.vehicle as string)!;
    expect(car).toMatchObject({ type: 'record', data: { title: 'Blue hatchback' } });
  });

  it('are undone by reverting that one revision', () => {
    const s = store();
    const { projectId, revision } = carProject(s, true);
    s.revert(revision!, human);
    expect(s.get(projectId)).toBeNull();
    expect(s.list('record')).toEqual([]);
    expect(s.list('view')).toEqual([]);
  });

  it('add to an existing project, but never twice', () => {
    const s = store();
    const projectId = s.apply(human, {
      message: 'p',
      operations: [{ op: 'create', type: 'project', data: { name: 'Life' } }],
    }).created['0']!;
    applyPack(s, agent, { pack: 'money', projectId }, TODAY);
    expect(s.getOfType('project', projectId).data.recordTypes?.map((t) => t.key)).toEqual([
      'category',
      'spending',
      'bill',
      'goal',
    ]);
    // The default Overview stays; the pack's page is added beside it.
    expect(s.list('view', { projectId }).map((v) => v.data.name)).toEqual([
      'Overview',
      'This month',
    ]);
    expect(refusal(() => applyPack(s, agent, { pack: 'money', projectId }, TODAY)).message).toMatch(
      /already has record types "category"/,
    );
    expect(refusal(() => applyPack(s, agent, { pack: 'boat', name: 'B' }, TODAY)).message).toMatch(
      /No pack "boat" \(packs: car, money\)/,
    );
  });

  it('are listed and applied over REST', async () => {
    const s = store();
    const app = createApp(s);
    const packs = (await (await app.request('/api/packs')).json()) as { key: string }[];
    expect(packs.map((p) => p.key)).toEqual(['car', 'money']);
    const res = await app.request('/api/packs/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:owner' },
      body: JSON.stringify({ pack: 'money', name: 'Money', examples: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectId: string; views: { name: string }[] };
    expect(body.views.map((v) => v.name)).toEqual(['This month']);
    const data = (await (await app.request(`/api/projects/${body.projectId}/data`)).json()) as {
      records: unknown[];
    };
    expect(data.records.length).toBeGreaterThan(10);
  });
});

describe('records', () => {
  it('must fit their record type', () => {
    const s = store();
    const { projectId } = carProject(s);
    const bad = refusal(() =>
      s.apply(agent, {
        message: 'log',
        operations: [
          {
            op: 'create',
            type: 'record',
            data: {
              projectId,
              recordType: 'service',
              title: 'Wash',
              fields: { date: 'yesterday', cost: 12, kind: 'wash' },
            },
          },
          {
            op: 'create',
            type: 'record',
            data: { projectId, recordType: 'boat', title: 'Dinghy', fields: {} },
          },
        ],
      }),
    );
    expect(bad.issues).toEqual([
      expect.stringMatching(/fields\.date: expected YYYY-MM-DD$/),
      expect.stringMatching(/fields\.cost: expected \{amount \(minor units\), currency\}$/),
      expect.stringMatching(/fields\.kind: "wash" isn't one of oil, /),
      expect.stringMatching(/fields\.vehicle is required for Service$/),
      expect.stringMatching(
        /recordType "boat" isn't one of this project's record types \(vehicle, service, fuel, reminder\)$/,
      ),
    ]);
  });

  it('point only at records of the right type in the same project', () => {
    const s = store();
    const { projectId } = carProject(s);
    const other = carProject(s).projectId;
    const ids = s.apply(agent, {
      message: 'cars',
      operations: [
        {
          op: 'create',
          type: 'record',
          ref: 'v',
          data: { projectId, recordType: 'vehicle', title: 'Mine', fields: {} },
        },
        {
          op: 'create',
          type: 'record',
          ref: 'w',
          data: { projectId: other, recordType: 'vehicle', title: 'Theirs', fields: {} },
        },
        {
          op: 'create',
          type: 'record',
          ref: 'f',
          data: {
            projectId,
            recordType: 'fuel',
            title: 'Fill',
            fields: { vehicle: '$v', date: TODAY },
          },
        },
      ],
    }).created;
    const issues = refusal(() =>
      s.apply(agent, {
        message: 'bad links',
        operations: [
          {
            op: 'create',
            type: 'record',
            data: {
              projectId,
              recordType: 'service',
              title: 'A',
              fields: { vehicle: ids.w!, date: TODAY },
            },
          },
          {
            op: 'create',
            type: 'record',
            data: {
              projectId,
              recordType: 'service',
              title: 'B',
              fields: { vehicle: ids.f!, date: TODAY },
            },
          },
        ],
      }),
    ).issues;
    expect(issues).toEqual([
      expect.stringMatching(/fields\.vehicle → rec_\w+ belongs to another project$/),
      expect.stringMatching(/fields\.vehicle must point at a vehicle record, not a fuel$/),
    ]);
  });

  it('merge fields on update, and lose a reference when its record is deleted', () => {
    const s = store();
    const { projectId } = carProject(s, true);
    const car = s.list('record', { projectId }).find((r) => r.data.recordType === 'vehicle')!;
    s.apply(agent, {
      message: 'Read the dashboard',
      operations: [
        { op: 'update', type: 'record', id: car.id, data: { fields: { odometer: 62000 } } },
      ],
    });
    expect(s.getOfType('record', car.id).data.fields).toMatchObject({
      odometer: 62000,
      make: 'Example Motors',
    });
    // Fill-ups need their vehicle, so the car can't go while they point at it.
    expect(
      refusal(() =>
        s.apply(human, {
          message: 'sold',
          operations: [{ op: 'delete', type: 'record', id: car.id }],
        }),
      ).issues.some((i) => i.includes('fields.vehicle is required for Fuel')),
    ).toBe(true);
    // An optional reference is unset instead: spending keeps its amount, without a category.
    const money = applyPack(s, agent, { pack: 'money', name: 'Money', examples: true }, TODAY);
    const fun = s
      .list('record', { projectId: money.projectId })
      .find((r) => r.data.title === 'Fun')!;
    s.apply(human, {
      message: 'no fun',
      operations: [{ op: 'delete', type: 'record', id: fun.id }],
    });
    const game = s
      .list('record', { projectId: money.projectId })
      .find((r) => r.data.title === 'Game on sale')!;
    expect(game.data.fields).toEqual({
      date: expect.any(String),
      amount: { amount: 2500, currency: 'USD' },
      payee: 'Online store',
    });
  });

  it("keep their project's record types in use", () => {
    const s = store();
    const { projectId } = carProject(s, true);
    const issues = refusal(() =>
      s.apply(human, {
        message: 'drop fuel',
        operations: [
          {
            op: 'update',
            type: 'project',
            id: projectId,
            data: {
              recordTypes: findPack('car')!.recordTypes.filter((t) => t.key !== 'fuel'),
            },
          },
        ],
      }),
    ).issues;
    expect(issues.filter((i) => i.includes('recordType "fuel" isn\'t one of'))).toHaveLength(2);
  });

  it('are in the snapshot, with when the repeating ones are due', () => {
    const s = store();
    const { projectId } = carProject(s, true);
    const snap = projectSnapshot(s, projectId);
    expect(snap.recordTypes?.find((t) => t.key === 'reminder')).toMatchObject({
      repeats: true,
      fields: [
        'vehicle: reference → vehicle',
        expect.stringMatching(/^kind: option \[oil, /),
        'estimate: money (EUR)',
      ],
    });
    const oil = snap.records?.find((r) => r.title === 'Oil change');
    expect(oil?.due).toMatchObject({ meter: 62400, band: expect.any(String) });
  });
});

describe('query checks on every view write path', () => {
  const typo = [
    {
      id: 'log',
      node: {
        component: 'DataTable',
        query: { type: 'record', where: { recordType: 'service' } },
        columns: [{ field: 'title' }, { field: 'fields.cots' }],
      },
    },
  ];

  it('refuse view_create, view_update, view_answer and REST apply, committing nothing', async () => {
    const s = store();
    const { projectId } = carProject(s);
    const before = s.latestRevisionId();
    const created = refusal(() =>
      createView(s, agent, { projectId, name: 'Log', widgets: typo, message: 'log' }),
    );
    expect(created.issues[0]).toMatch(
      /widgets\[0\]\.node\.columns\[1\]\.field \(widget "log"\): "fields\.cots" isn't a field of Service \(service\) \(did you mean "fields\.cost"\?\)\. Allowed: .*Example: \{"field":"fields\.cost"\}/,
    );
    const view = s.list('view', { projectId })[0]!;
    expect(() => updateView(s, agent, { viewId: view.id, message: 'typo', widgets: typo })).toThrow(
      /fields\.cots/,
    );
    const app = createApp(s);
    const res = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:owner' },
      body: JSON.stringify({
        message: 'by hand',
        operations: [
          {
            op: 'create',
            type: 'view',
            data: {
              projectId,
              name: 'Log',
              pinned: false,
              spec: { component: 'Board', widgets: typo },
            },
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(s.latestRevisionId()).toBe(before);
    // view_preview reports the same finding, from the same code.
    expect(previewView(s, { projectId, widgets: typo }).findings).toMatchObject([
      { code: 'unknown-column', suggestion: 'fields.cost' },
    ]);
  });

  it('let an old finding stay through an unrelated edit, and return warnings with the save', () => {
    const s = store();
    const { projectId } = carProject(s);
    const view = s.list('view', { projectId })[0]!;
    // A view saved before the checks existed, with a typo in it (written straight to the table).
    const board = toBoard(view.data.spec as ViewSpec);
    const broken = {
      ...board,
      widgets: [...board.widgets, { id: 'old', node: typo[0]!.node }],
    } as Board;
    s.database
      .prepare('UPDATE entities SET data = ? WHERE id = ?')
      .run(JSON.stringify({ ...view.data, spec: broken }), view.id);
    const moved = updateView(s, agent, {
      viewId: view.id,
      message: 'narrower',
      ops: [{ op: 'update', id: 'due', w: 6 }],
    });
    expect(moved.revision).not.toBeNull();
    const warned = createView(s, agent, {
      projectId,
      name: 'Everything',
      message: 'all records',
      widgets: [{ id: 'all', node: { component: 'DataList', query: { type: 'record' } } }],
    });
    expect(warned.preview.findings).toMatchObject([{ level: 'warn', code: 'no-record-type' }]);
  });

  it('keep every saved spec in the fixtures and both packs loading and passing', () => {
    const s = store();
    for (const pack of ['car', 'money']) {
      const { projectId } = applyPack(s, agent, { pack, name: pack, examples: true }, TODAY);
      for (const view of s.list('view', { projectId }))
        expect(
          previewView(s, { viewId: view.id }).findings.filter((f) => f.level === 'reject'),
        ).toEqual([]);
    }
    // The evaluation fixtures still load through the checked store, saved views included.
    const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../eval/fixtures');
    for (const name of ['workshop-renovation.json', 'catalog-delivery.json']) {
      const raw = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as {
        operations: Parameters<Store['apply']>[1]['operations'];
      };
      const fresh = store();
      const result = fresh.apply(
        { kind: 'system', name: 'fixture' },
        { message: name, operations: raw.operations },
      );
      expect(result.revision).not.toBeNull();
      for (const view of fresh.list('view'))
        expect(
          previewView(fresh, { viewId: view.id }).findings.filter((f) => f.level === 'reject'),
        ).toEqual([]);
    }
  });
});

describe('pack cases through the store', () => {
  for (const name of ['car.json', 'money.json']) {
    const file = caseFile(name);
    for (const c of file.cases ?? []) {
      it(`${c.id}: the facts hold for records saved through the store`, () => {
        const s = store();
        const pack = findPack(c.pack)!;
        const { projectId } = applyPack(s, agent, { pack: c.pack, name: pack.name }, c.today);
        const records = file.fixtures![c.fixture]!;
        if (records.length)
          s.apply(agent, {
            message: 'fixture',
            operations: records.map((r) => ({
              op: 'create' as const,
              type: 'record' as const,
              ref: r.ref,
              data: {
                projectId,
                recordType: r.recordType,
                title: r.title,
                fields: r.fields,
                ...(r.interval ? { interval: r.interval } : {}),
              },
            })),
          });
        const report = checkFacts(caseBoard(pack, c), s.dataset(projectId), c.facts, c.today);
        expect(report.results.filter((r) => !r.pass)).toEqual([]);
      });
    }
    for (const c of file.queryChecks ?? []) {
      it(`${c.id}: the store ${c.expect === 'reject' ? 'refuses' : 'saves'} it`, () => {
        const s = store();
        const { projectId } = applyPack(s, agent, { pack: c.pack, name: c.pack }, TODAY);
        const save = () =>
          createView(s, agent, {
            projectId,
            name: c.id.slice(0, 40),
            widgets: c.widgets,
            message: c.description,
          });
        if (c.expect === 'reject') expect(save).toThrow(PharosError);
        else expect(save().revision).not.toBeNull();
      });
    }
  }
});

it('record is a full entity type', () => {
  expect(ENTITIES.record.label).toBe('title');
  const e: Entity<'record'>['data'] = {
    projectId: 'p',
    recordType: 'x',
    title: 't',
    fields: {},
    order: 0,
  };
  expect(e.title).toBe('t');
});
