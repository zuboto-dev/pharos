import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { quoteHasNumber, Store } from '../store/store.js';
import { previewView } from './service.js';

// R4.2: the contract for the picture blocks (docs/reframe/r4-plan.md): Layers flow and progress,
// BeforeAfter, FindingChart, mini bars, evidence labels, hidden work codes, and the claim fields.

const agent = { kind: 'agent', name: 'test' } as const;
let db: ReturnType<typeof openDatabase>;
let store: Store;
let ids: Record<string, string>;

const claim = (ref: string, data: Record<string, unknown>) => ({
  op: 'create' as const,
  type: 'claim' as const,
  ref,
  data: {
    projectId: '$p',
    checkedOn: '2026-10-12',
    sourceIds: ['$src'],
    certainty: 'verified',
    ...data,
  },
});

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new Store(db);
  ids = store.apply(agent, {
    message: 'Fixtures',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Pharos' } },
      { op: 'create', type: 'stage', ref: 's1', data: { projectId: '$p', name: 'Agree' } },
      { op: 'create', type: 'stage', ref: 's2', data: { projectId: '$p', name: 'Measure' } },
      ...['done', 'done', 'todo', 'cancelled'].map((status, i) => ({
        op: 'create' as const,
        type: 'task' as const,
        data: { projectId: '$p', stageId: '$s1', title: `W1.${i} · Task ${i}`, status },
      })),
      {
        op: 'create',
        type: 'artifact',
        ref: 'src',
        data: { projectId: '$p', title: 'Report', kind: 'link', uri: 'https://example.com/r' },
      },
      claim('change', {
        statement: 'The guide now says how to start the service.',
        certainty: 'reading',
        assumption: 'Readers start from the README.',
      }),
      claim('before', {
        statement: 'The README said to run pnpm dev.',
        quote: 'Run pnpm dev to start.',
        locator: 'README line 12, 8bb6b32',
      }),
      claim('after', {
        statement: 'The README says to install the service.',
        quote: 'Run pnpm service install to start.',
        locator: 'README line 12, main',
      }),
      claim('headline', {
        statement: 'OpenUI says its format needs half the tokens.',
        quote: 'OpenUI used 4,800 tokens against 10,180.',
        tags: [],
      }),
      claim('openui', {
        statement: 'OpenUI used 4,800 tokens.',
        quote: 'OpenUI used 4,800 tokens against 10,180.',
        figure: { value: 4800, unit: 'tokens', label: 'OpenUI' },
        tags: ['bench'],
        order: 0,
      }),
      claim('json', {
        statement: 'JSON used 10,180 tokens.',
        quote: 'OpenUI used 4,800 tokens against 10,180.',
        figure: { value: 10180, unit: 'tokens', label: 'JSON' },
        tags: ['bench'],
        order: 1,
      }),
      claim('step', {
        statement: 'The AI picks blocks from a closed catalog.',
        quote: 'Agents compose views from a component catalog.',
        tags: ['step-2'],
      }),
    ],
  }).created;
});
afterEach(() => db.close());

type Widget = { id: string; node: unknown };
const preview = (widgets: Widget[]) => previewView(store, { projectId: ids.p!, widgets });
const one = (node: unknown) => preview([{ id: 'w', node }]).widgets[0]!;

describe('claim fields', () => {
  it('finds a figure in its quote however the thousands are written', () => {
    expect(quoteHasNumber('used 4,800 tokens', 4800)).toBe(true);
    expect(quoteHasNumber('used 4 800 tokens', 4800)).toBe(true);
    expect(quoteHasNumber('used 4800 tokens', 4800)).toBe(true);
    expect(quoteHasNumber('scored 82.8%', 82.8)).toBe(true);
    expect(quoteHasNumber('used 48,000 tokens', 4800)).toBe(false);
    expect(quoteHasNumber('scored 82.85%', 82.8)).toBe(false);
    expect(quoteHasNumber('version 1.4800', 4800)).toBe(false);
  });

  it('warns when a "From source" figure is not in its quote, and when weakBecause disagrees with the sources', () => {
    const result = store.apply(agent, {
      message: 'Bad figure',
      operations: [
        {
          op: 'update',
          type: 'claim',
          id: ids.openui!,
          data: { figure: { value: 4900, unit: 'tokens', label: 'OpenUI' } },
        },
        { op: 'update', type: 'claim', id: ids.json!, data: { weakBecause: 'one-source' } },
        {
          op: 'update',
          type: 'claim',
          id: ids.step!,
          data: { weakBecause: 'one-source', sourceIds: [], certainty: 'reading', assumption: 'x' },
        },
      ],
    });
    expect(result.warnings).toEqual([
      `claim ${ids.openui} "OpenUI used 4,800 tokens." is "From source" but its figure 4900 isn't in its quote: quote the passage that gives the number, or correct the figure`,
      `claim ${ids.step} "The AI picks blocks from a closed catalog." has no source: add sourceIds so the reader can check it`,
      `claim ${ids.step} "The AI picks blocks from a closed catalog." says its evidence is weak because of one source, but it has 0: fix sourceIds or weakBecause`,
    ]);
  });

  it('shows the weak reason in the preview', () => {
    store.apply(agent, {
      message: 'Weak',
      operations: [
        { op: 'update', type: 'claim', id: ids.json!, data: { weakBecause: 'indirect' } },
      ],
    });
    expect(one({ component: 'ClaimCard', claim: ids.json }).shows).toBe(
      '“JSON used 10,180 tokens.” (From source, 2026-10-12, 1 source, weak: indirect)',
    );
  });
});

describe('Layers flow and progress', () => {
  const flow = (extra: Record<string, unknown> = {}, layers?: unknown[]) => ({
    component: 'Layers',
    orientation: 'flow',
    layers: layers ?? [
      { key: '1', title: 'Your question', progress: { stageId: ids.s1 } },
      { key: '2', title: 'AI arranges blocks', items: { where: { tags: 'step-2' } } },
      { key: '3', title: 'Pharos draws the screen' },
    ],
    ...extra,
  });

  it('allows label-only steps in a flow and counts progress by meaning, cancelled left out', () => {
    const w = one(flow());
    expect(w.warnings).toEqual([]);
    expect(w.shows).toBe(
      '1 Your question: label only, 2 of 3 done · 2 AI arranges blocks: 1 claim · 3 Pharos draws the screen: label only',
    );
  });

  it('warns about too many steps, long labels, an axis, and progress that counts nothing', () => {
    const steps = ['A', 'B', 'C', 'D', 'E', 'F'].map((key) => ({ key, title: key }));
    expect(one(flow({}, steps)).warnings).toEqual([
      'a flow has 6 steps; use 2–5 boxes, or a stack for more',
    ]);
    expect(
      one(
        flow({ axis: { from: 'a', to: 'b' } }, [
          { key: '1', title: 'A label that is far too long for a box' },
          { key: '2', title: 'Short', progress: { stageId: ids.s2 } },
        ]),
      ).warnings,
    ).toEqual([
      'flow step "1" label is 38 characters; keep a box label under 30, and put the rest in its claims',
      'axis shows only in a row; leave it out of a flow',
      'layer "2" progress counts no tasks: check its where, or leave progress out',
    ]);
  });

  it('still wants items outside a flow', () => {
    expect(
      one({
        component: 'Layers',
        layers: [
          { key: '1', title: 'A' },
          { key: '2', title: 'B', items: { where: { tags: 'step-2' } } },
        ],
      }).warnings,
    ).toEqual([
      'layer "1" has no items: pick its claims with items (only a flow step may be a label alone)',
    ]);
  });

  it('counts box labels and progress but not closed claims, and underlines nothing unless asked', () => {
    store.apply(agent, {
      message: 'Term',
      operations: [
        {
          op: 'create',
          type: 'term',
          data: { projectId: ids.p, word: 'blocks', explanation: 'Parts of a view.' },
        },
      ],
    });
    const page = (node: unknown, n: number) =>
      preview(Array.from({ length: n }, (_, i) => ({ id: `f${i}`, node }))).warnings;
    // Each flow shows 9 words of labels and 3 of progress ("2 of 3"); its closed claims don't count.
    expect(page(flow(), 13).find((x) => x.startsWith('the page shows'))).toMatch(
      /^the page shows 156 words/,
    );
    const marks = (node: unknown) => page(node, 6).find((x) => x.startsWith('the page underlines'));
    expect(marks(flow())).toBeUndefined();
    expect(marks(flow({ terms: true }))).toMatch(/^the page underlines 6 terms/);
  });
});

describe('BeforeAfter', () => {
  const node = (extra: Record<string, unknown> = {}) => ({
    component: 'BeforeAfter',
    claim: ids.change,
    before: ids.before,
    after: ids.after,
    beforeLabel: '8bb6b32',
    afterLabel: 'main',
    ...extra,
  });

  it('shows the stated change and what was removed and added', () => {
    const w = one(node());
    expect(w.warnings).toEqual([]);
    expect(w.shows).toBe(
      '“The guide now says how to start the service.” (Our reading, 2026-10-12, 1 source); Before · 8bb6b32 → After · main: removed “dev”, added “service install”',
    );
  });

  it('warns about a missing statement, a claim without a quote, and unknown claims', () => {
    expect(one(node({ claim: undefined, after: ids.change })).warnings).toEqual([
      'no claim states the change: set claim to a claim saying what changed, in one line above the panes',
      `the after claim ${ids.change} has no quote: store the passage after the change, word for word, as its quote (with locator and source)`,
    ]);
    expect(one(node({ before: 'clm_gone' })).warnings).toEqual([
      'claim clm_gone not found in this project',
    ]);
  });

  it('warns when nothing changed and when it shows too many words', () => {
    expect(one(node({ after: ids.before })).warnings).toEqual([
      'before and after quote the same passage, so nothing shows as changed',
    ]);
    const long = 'word '.repeat(30).trim();
    store.apply(agent, {
      message: 'Long quotes',
      operations: [
        { op: 'update', type: 'claim', id: ids.before!, data: { quote: `${long} old.` } },
        { op: 'update', type: 'claim', id: ids.after!, data: { quote: `${long} new.` } },
      ],
    });
    expect(one(node()).warnings).toEqual([
      'this BeforeAfter shows 73 words; keep the stated change and the changed lines to 40: quote only the lines that changed',
    ]);
  });
});

describe('FindingChart', () => {
  const chart = (extra: Record<string, unknown> = {}) => ({
    component: 'FindingChart',
    claim: ids.headline,
    bars: { where: { tags: 'bench' } },
    highlight: ids.openui,
    ...extra,
  });

  it('draws one bar per claim figure, with the highlighted one marked', () => {
    const w = one(chart());
    expect(w.warnings).toEqual([]);
    expect(w.shows).toBe(
      '“OpenUI says its format needs half the tokens.” (From source, 2026-10-12, 1 source): OpenUI 4800 tokens (highlighted) · JSON 10180 tokens',
    );
  });

  it('wants its title to be a stored claim', () => {
    expect(one(chart({ claim: undefined, title: 'OpenUI wins' })).warnings).toEqual([
      "the chart's title isn't a stored claim: set claim to the claim that states the finding, so the title carries its certainty and source",
      'title is free text: the claim is the title, so leave title out and keep the finding in the claim',
    ]);
  });

  it('warns about missing figures, mixed units, one bar, and a highlight that matches nothing', () => {
    store.apply(agent, {
      message: 'Mixed',
      operations: [
        {
          op: 'update',
          type: 'claim',
          id: ids.json!,
          data: { figure: { value: 10180, unit: 'chars', label: 'JSON' } },
        },
        { op: 'update', type: 'claim', id: ids.step!, data: { tags: ['bench'] } },
      ],
    });
    expect(one(chart({ highlight: 'clm_nope' })).warnings).toEqual([
      `claim ${ids.step} has no figure, so it draws no bar: add figure {value, label}`,
      'the bars mix units ("tokens", "chars"): one chart compares one unit, so split it or fix the figures',
      'highlight "clm_nope" matches no bar: use the id of a claim with a figure',
    ]);
    expect(
      one(chart({ bars: { where: { id: ids.openui } }, highlight: undefined })).warnings,
    ).toEqual(['the chart has 1 bar; a finding chart compares, so it needs at least 2']);
    expect(one(chart({ bars: undefined })).warnings).toEqual([
      'no bars: set bars (a claim filter) or count ({query, by})',
      'highlight "' + ids.openui + '" matches no bar: use a group value or label',
    ]);
  });

  it('counts project items by a field, highlighting by value or label', () => {
    const w = one(
      chart({
        bars: undefined,
        count: { query: { type: 'task' }, by: 'status', sort: 'count' },
        highlight: 'done',
      }),
    );
    expect(w.warnings).toEqual([]);
    expect(w.shows).toMatch(/: Done 2 \(highlighted\) · /);
  });
});

describe('small fixes', () => {
  it('draws mini bars in StatCards and Text', () => {
    const done = { type: 'task', where: { status: 'done' } };
    const all = { type: 'task', where: { status: { not: 'cancelled' } } };
    expect(
      one({ component: 'StatCards', stats: [{ label: 'Done', query: done, of: all }] }).shows,
    ).toBe('Done ▰▰▰▱▱ 2/3');
    expect(
      one({
        component: 'Text',
        content: 'Agree ${bar}',
        values: { bar: { bar: { query: done, of: all } } },
      }).shows,
    ).toBe('Agree ▰▰▰▱▱ 2/3');
  });

  it('hides work codes in TaskTable and DataList rows when asked', () => {
    expect(one({ component: 'TaskTable', hideCodes: true }).shows).toBe(
      '4 tasks: “Task 0”, “Task 1”, “Task 2”, …',
    );
    expect(one({ component: 'DataList', query: { type: 'task' } }).shows).toMatch(
      /“W1\.0 · Task 0”/,
    );
  });

  it('accepts StartHere evidence with short labels', () => {
    const w = one({
      component: 'StartHere',
      purpose: 'done',
      why: 'So readers can start the service.',
      headline: 'The guide now says how to start the service.',
      yourPart: 'Nothing now.',
      evidence: [{ id: ids.src, label: 'Report' }, 'art_gone'],
      stageId: ids.s1,
      date: '2026-10-12',
      path: [{ label: 'What changed' }, { label: 'How it was checked' }],
    });
    expect(w.warnings).toEqual(['evidence art_gone not found in this project']);
  });
});
