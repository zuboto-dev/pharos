import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Board,
  CaseFile,
  PACKS,
  Pack,
  caseBoard,
  caseHash,
  checkBoardQueries,
  checkFacts,
  findPack,
  packDataset,
  packOperations,
  type Entity,
  type FactCase,
} from '@pharos/schema';
import { describe, expect, it } from 'vitest';

/** The pack cases live with the packs, in @pharos/schema (made-up data only). */
const here = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/schema/src/packs');
const FILES = ['car.json', 'money.json', 'music.json', 'study.json', 'company.json'];
const files = FILES.map((name) => ({
  name,
  file: CaseFile.parse(JSON.parse(readFileSync(join(here, 'cases', name), 'utf8'))),
}));
const LOCK_PATH = join(here, 'cases', 'versions.json');
const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as Record<
  string,
  { version: number; hash: string }
>;

function projectOf(pack: Pack): Entity<'project'> {
  return packDataset(pack, [], '2026-10-13').project;
}

describe('packs', () => {
  it('are valid data with pages that pass the query checks cleanly', () => {
    for (const pack of PACKS) {
      expect(Pack.parse(pack)).toBeTruthy();
      for (const view of pack.views) {
        const board = Board.parse({ component: 'Board', widgets: view.widgets });
        expect(checkBoardQueries(board, projectOf(pack)), `${pack.key} "${view.name}"`).toEqual([]);
      }
    }
  });

  it('apply in one list of operations: the project, its pages and the examples', () => {
    const ops = packOperations(
      findPack('car')!,
      { name: 'Car' },
      {
        examples: true,
        today: '2026-10-13',
      },
    );
    expect(ops[0]).toMatchObject({ op: 'create', type: 'project', ref: 'project' });
    expect(ops.filter((o) => o.type === 'view')).toHaveLength(1);
    const oil = ops.find((o) => o.op === 'create' && o.data.title === 'Oil change');
    // Relative dates are resolved on the day it's applied; references stay "$ref" for the store.
    expect(oil).toMatchObject({
      data: { fields: { vehicle: '$car' }, interval: { lastDate: '2025-12-17' } },
    });
    expect(() =>
      packOperations(
        findPack('car')!,
        { projectId: 'prj_1', recordTypes: findPack('car')!.recordTypes },
        { today: '2026-10-13' },
      ),
    ).toThrow(/already has record types "vehicle"/);
  });

  it("examples look right on the page the day they're applied", () => {
    for (const pack of PACKS) {
      const data = packDataset(pack, pack.examples ?? [], '2026-10-13');
      const board = Board.parse({ component: 'Board', widgets: pack.views[0]!.widgets });
      // The page states no number in prose: everything shown comes from the records.
      expect(checkFacts(board, data, [], '2026-10-13').unverifiable).toEqual([]);
    }
  });
});

describe('pack cases', () => {
  const all = files.flatMap(({ file }) => [...(file.cases ?? []), ...(file.queryChecks ?? [])]);

  it('have unique ids and every fixture they name', () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { file } of files)
      for (const c of file.cases ?? []) expect(file.fixtures?.[c.fixture], c.id).toBeDefined();
  });

  it('are versioned: changing a case means bumping its version', () => {
    const next: typeof lock = {};
    for (const { file } of files) {
      for (const c of [...(file.cases ?? []), ...(file.queryChecks ?? [])]) {
        const fixture = 'fixture' in c ? file.fixtures?.[c.fixture] : undefined;
        const files = 'fixture' in c ? file.files?.[c.fixture] : undefined;
        next[c.id] = { version: c.version, hash: caseHash(c, fixture, files) };
      }
    }
    if (process.env.UPDATE_PACK_CASES) {
      writeFileSync(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
      return;
    }
    for (const [id, { version, hash }] of Object.entries(next)) {
      const locked = lock[id];
      expect(locked, `${id} is new: run with UPDATE_PACK_CASES=1 to lock it`).toBeDefined();
      if (locked!.hash !== hash)
        expect(
          version,
          `${id} changed: bump its version, then run with UPDATE_PACK_CASES=1`,
        ).toBeGreaterThan(locked!.version);
      else expect(version, `${id}: version changed without a change`).toBe(locked!.version);
    }
    expect(Object.keys(lock).sort()).toEqual(Object.keys(next).sort());
  });

  for (const { file } of files) {
    for (const c of file.cases ?? []) {
      it(`${c.id}: every fact on the pack page matches the records`, () => {
        const pack = findPack(c.pack)!;
        const data = packDataset(
          pack,
          file.fixtures![c.fixture]!,
          c.today,
          file.files?.[c.fixture],
        );
        const report = checkFacts(caseBoard(pack, c), data, c.facts, c.today);
        expect(report.results.filter((r) => !r.pass)).toEqual([]);
        expect(report.passed).toBe(true);
      });
    }
    for (const c of file.queryChecks ?? []) {
      it(`${c.id}: the query checks ${c.expect} it`, () => {
        const pack = findPack(c.pack)!;
        const findings = checkBoardQueries(
          Board.parse({ component: 'Board', widgets: c.widgets }),
          projectOf(pack),
        );
        const rejects = findings.filter((f) => f.level === 'reject');
        expect(rejects.length > 0, JSON.stringify(findings)).toBe(c.expect === 'reject');
        for (const code of c.codes ?? []) expect(findings.map((f) => f.code)).toContain(code);
      });
    }
  }
});

describe('fact checks', () => {
  const car = files.find((f) => f.name === 'car.json')!.file;
  const money = files.find((f) => f.name === 'money.json')!.file;
  const caseOf = (file: CaseFile, id: string) => file.cases!.find((c) => c.id === id)!;

  function run(file: CaseFile, c: FactCase, widgets: Board['widgets']) {
    const pack = findPack(c.pack)!;
    const data = packDataset(pack, file.fixtures![c.fixture]!, c.today);
    return checkFacts(Board.parse({ component: 'Board', widgets }), data, c.facts, c.today);
  }

  it('fail a car page that adds up the wrong field or misses a band', () => {
    const c = caseOf(car, 'car-cost-per-year');
    const widgets = structuredClone(findPack('car')!.views[0]!.widgets);
    const perYear = widgets.find((w) => w.id === 'per-year')!.node as { sum?: string };
    perYear.sum = 'fields.odometer';
    const report = run(car, c, widgets);
    expect(report.passed).toBe(false);
    expect(report.results.filter((r) => !r.pass).map((r) => r.id)).toEqual([
      'y2024',
      'y2025',
      'y2026',
    ]);

    const due = caseOf(car, 'car-due-bands');
    const narrowed = structuredClone(findPack('car')!.views[0]!.widgets);
    (narrowed.find((w) => w.id === 'due')!.node as { bands?: string[] }).bands = ['past_due'];
    expect(run(car, due, narrowed).results.find((r) => r.id === 'oil-km-first')!.pass).toBe(false);
  });

  it('fail a money page that counts last month too', () => {
    const c = caseOf(money, 'money-planned-vs-spent');
    const widgets = structuredClone(findPack('money')!.views[0]!.widgets);
    const node = widgets.find((w) => w.id === 'categories')!.node as {
      spent: { query: { where: Record<string, unknown> } };
    };
    delete node.spent.query.where['fields.date'];
    const report = run(money, c, widgets);
    expect(report.passed).toBe(false);
    expect(report.results.find((r) => r.id === 'groceries')).toMatchObject({
      pass: false,
      actual: { spent: [{ amount: 33975, currency: 'EUR' }] },
    });
    // The rest of the page still reads this month and passes.
    expect(report.results.find((r) => r.id === 'rows')!.pass).toBe(true);
  });

  it('fail a music page that lists every mix instead of the latest per song', () => {
    const music = files.find((f) => f.name === 'music.json')!.file;
    const c = caseOf(music, 'music-latest-mix');
    const widgets = structuredClone(findPack('music')!.views[0]!.widgets);
    delete (widgets.find((w) => w.id === 'latest')!.node as { query: { onePer?: string } }).query
      .onePer;
    const data = packDataset(
      findPack('music')!,
      music.fixtures!.studio!,
      c.today,
      music.files!.studio,
    );
    const report = checkFacts(Board.parse({ component: 'Board', widgets }), data, c.facts, c.today);
    expect(report.passed).toBe(false);
    expect(report.results.find((r) => r.id === 'rows')).toMatchObject({ pass: false, actual: 5 });
  });

  it('fail a study page whose next exams include past ones', () => {
    const study = files.find((f) => f.name === 'study.json')!.file;
    const c = caseOf(study, 'study-next-exams');
    const widgets = structuredClone(findPack('study')!.views[0]!.widgets);
    const exams = widgets.find((w) => w.id === 'exams')!.node as {
      query: { where: Record<string, unknown> };
    };
    delete exams.query.where['fields.date'];
    const report = run(study, c, widgets);
    expect(report.results.find((r) => r.id === 'rows')).toMatchObject({ pass: false, actual: 4 });
  });

  it('flag prose that states a number no query backs, never passing it', () => {
    const c = caseOf(money, 'money-savings');
    const widgets = [
      ...findPack('money')!.views[0]!.widgets,
      { id: 'prose', node: { component: 'Markdown' as const, content: 'You saved 3,500 euros.' } },
    ];
    const report = run(money, c, widgets);
    expect(report.results.every((r) => r.pass)).toBe(true);
    expect(report.unverifiable).toEqual([{ widget: 'prose', text: 'You saved 3,500 euros.' }]);
    expect(report.passed).toBe(false);
  });
});
