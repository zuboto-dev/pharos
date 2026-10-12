import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { NO_OPENING } from './preview.js';
import { createView, previewView, updateView } from './service.js';

// R3.1: the start-here opening of report pages (docs/reframe/start-here.md).

const agent = { kind: 'agent', name: 'test' } as const;
let db: ReturnType<typeof openDatabase>;
let store: Store;
let ids: Record<string, string>;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new Store(db);
  ids = store.apply(agent, {
    message: 'Fixtures',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Pharos' } },
      { op: 'create', type: 'stage', ref: 'stage', data: { projectId: '$p', name: 'R3' } },
      { op: 'create', type: 'goal', ref: 'goal', data: { projectId: '$p', title: 'Readers' } },
      {
        op: 'create',
        type: 'artifact',
        ref: 'tests',
        data: { projectId: '$p', title: 'Test run', kind: 'link', uri: 'https://example.com/t' },
      },
      {
        op: 'create',
        type: 'claim',
        ref: 'finding',
        data: {
          projectId: '$p',
          statement: 'Readers find the point faster when it comes first.',
          checkedOn: '2026-10-12',
          sourceIds: ['$tests'],
          assumption: 'The test readers are like the owner.',
        },
      },
    ],
  }).created;
});
afterEach(() => db.close());

const start = (extra: Record<string, unknown> = {}) => ({
  component: 'StartHere',
  purpose: 'done',
  headline: 'Report pages now open with a start-here block.',
  evidence: [ids.tests!],
  stageId: ids.stage!,
  date: '2026-10-12',
  path: [
    { label: 'What changed', target: 'changed' },
    { label: 'How it was checked', target: 'checked' },
  ],
  ...extra,
});
type Widget = { id: string; node: unknown };
const text = (id: string): Widget => ({
  id,
  node: { component: 'Text', content: `The ${id} part.` },
});
const preview = (startNode: unknown, rest: Widget[] = [text('changed'), text('checked')]) =>
  previewView(store, {
    projectId: ids.p!,
    widgets: [{ id: 'start', node: startNode }, ...rest],
  });
const startWarnings = (node: unknown, rest?: { id: string; node: unknown }[]) =>
  preview(node, rest).widgets[0]!.warnings;

describe('StartHere preview', () => {
  it('is quiet when every rule is kept, and says what the opening shows', () => {
    const result = preview(start());
    expect(result.warnings).toEqual([]);
    expect(result.widgets.flatMap((w) => w.warnings)).toEqual([]);
    expect(result.widgets[0]!.shows).toBe(
      'done: “Report pages now open with a start-here block.” (Pharos › R3 › 2026-10-12); path: 1 What changed → 2 How it was checked',
    );
  });

  it('shows the claim as the headline on a found page, with the claim warnings', () => {
    const result = preview(start({ purpose: 'found', claim: ids.finding, evidence: undefined }));
    expect(result.widgets[0]!.warnings).toEqual([]);
    expect(result.widgets[0]!.shows).toContain('“Readers find the point faster');
    expect(startWarnings(start({ claim: 'clm_missing', headline: undefined }))).toEqual([
      'claim clm_missing not found in this project',
      'no headline: set headline to the outcome in one sentence, or claim on a found page',
    ]);
  });

  it('warns at 161 characters but not at 160', () => {
    expect(startWarnings(start({ headline: 'x'.repeat(160) }))).toEqual([]);
    expect(startWarnings(start({ headline: 'x'.repeat(161) }))).toEqual([
      'headline is 161 characters; keep it under 160: one sentence with a verb, details below',
    ]);
  });

  it('wants evidence that exists', () => {
    expect(startWarnings(start({ evidence: undefined }))).toEqual([
      'the headline has no evidence: list what backs it in evidence (artifact, task or decision ids), or set claim on a found page',
    ]);
    expect(startWarnings(start({ evidence: ['art_gone'] }))).toEqual([
      'evidence art_gone not found in this project',
      expect.stringMatching(/^the headline has no evidence/),
    ]);
  });

  it('checks where it sits', () => {
    expect(startWarnings(start({ stageId: undefined, goalId: ids.goal }))).toEqual([]);
    expect(startWarnings(start({ stageId: ids.goal }))).toEqual([
      `stageId ${ids.goal} is not a stage in this project`,
    ]);
    expect(startWarnings(start({ stageId: undefined }))).toEqual([
      'where it sits: set stageId or goalId so the reader knows which part of the project this is about',
    ]);
  });

  it('wants 2–4 steps, each pointing at a widget on the board', () => {
    const steps = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1}`, target: 'changed' }));
    expect(startWarnings(start({ path: steps(4) }))).toEqual([]);
    expect(startWarnings(start({ path: steps(1) }))).toEqual([
      'the reading path has 1 step; use 2–4, and put more detail behind them',
    ]);
    expect(startWarnings(start({ path: steps(5) }))).toEqual([
      'the reading path has 5 steps; use 2–4, and put more detail behind them',
    ]);
    expect(
      startWarnings(
        start({ path: [{ label: 'What changed', target: 'changed' }, { label: 'Left' }] }),
      ),
    ).toEqual([]);
    expect(
      startWarnings(
        start({
          path: [
            { label: 'Here', target: 'changed' },
            { label: 'Gone', target: 'nope' },
          ],
        }),
      ),
    ).toEqual(['step 2 "Gone" points at widget "nope", which isn\'t on this board']);
  });

  it('asks needs-you pages to say by when', () => {
    expect(startWarnings(start({ purpose: 'needs-you' }))).toEqual([
      'a needs-you page says by when: set due',
    ]);
    expect(startWarnings(start({ purpose: 'needs-you', due: '2026-10-20' }))).toEqual([]);
  });
});

describe('report page opening', () => {
  const card = { id: 'card', node: { component: 'ClaimCard', claim: '' } };

  it('warns when a report page has no StartHere, and leaves ordinary views alone', () => {
    card.node.claim = ids.finding!;
    const result = previewView(store, { projectId: ids.p!, widgets: [card] });
    expect(result.warnings).toEqual([
      `${NO_OPENING}: open a report page with a StartHere (its purpose, a headline, where it sits, and a reading path of 2–4 steps)`,
    ]);
    expect(previewView(store, { projectId: ids.p!, widgets: [text('a')] }).warnings).toEqual([]);
  });

  it('wants the StartHere first, and only one', () => {
    card.node.claim = ids.finding!;
    expect(preview(start(), [text('changed'), text('checked'), card]).warnings).toEqual([]);
    expect(
      previewView(store, {
        projectId: ids.p!,
        widgets: [text('changed'), { id: 'start', node: start() }, text('checked')],
      }).warnings,
    ).toEqual([
      'the StartHere is not first: a Text comes before it; move it to the top so the reader starts there',
    ]);
    expect(
      preview(start(), [text('changed'), text('checked'), { id: 'again', node: start() }]).warnings,
    ).toEqual([
      '2 StartHere blocks: a report page has one purpose and one opening; keep one and split the rest into their own views',
    ]);
  });

  it('counts a StartHere as the point of an explanation view', () => {
    card.node.claim = ids.finding!;
    const layers = {
      id: 'layers',
      node: {
        component: 'Layers',
        layers: ['1', '2'].map((key) => ({
          key,
          title: 'Layer',
          items: { where: { id: ids.finding } },
        })),
      },
    };
    expect(preview(start(), [text('changed'), text('checked'), layers]).warnings).toEqual([]);
    expect(
      previewView(store, {
        projectId: ids.p!,
        widgets: [
          { id: 'lead', node: { component: 'Markdown', content: 'word '.repeat(31) } },
          { id: 'start', node: start() },
          layers,
        ],
      }).warnings,
    ).toEqual([
      expect.stringMatching(/^the StartHere is not first: a Markdown/),
      expect.stringMatching(/^the point comes too late: 31 words before the first StartHere/),
    ]);
  });

  it('saves with warnings and clears them once fixed', () => {
    const saved = createView(store, agent, {
      projectId: ids.p!,
      name: 'Report',
      message: 'Draft report',
      widgets: [
        { id: 'start', node: start({ path: [{ label: 'Only', target: 'missing' }] }) },
        text('changed'),
      ],
    });
    expect(saved.preview.widgets[0]!.warnings).toEqual([
      'the reading path has 1 step; use 2–4, and put more detail behind them',
      'step 1 "Only" points at widget "missing", which isn\'t on this board',
    ]);
    const fixed = updateView(store, agent, {
      viewId: saved.view.id,
      message: 'Fix the path',
      ops: [
        {
          op: 'update',
          id: 'start',
          set: {
            path: [
              { label: 'What changed', target: 'changed' },
              { label: 'What is left', says: 'Nothing yet' },
            ],
          },
        },
      ],
    });
    expect(fixed.preview.widgets[0]!.warnings).toEqual([]);
    expect(fixed.preview.warnings).toEqual([]);
  });
});
