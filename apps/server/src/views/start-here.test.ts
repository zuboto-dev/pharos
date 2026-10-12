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
  why: 'So a reader knows what a page is for.',
  headline: 'Report pages now open with a start-here block.',
  yourPart: 'Nothing now.',
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
      'done: why: So a reader knows what a page is for.; “Report pages now open with a start-here block.” (Pharos › R3 › 2026-10-12); your part: Nothing now.; path: 1 What changed → 2 How it was checked',
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

// R3.6: why first, the reader's part said once, and a word budget for report pages.
describe('why and the reader’s part', () => {
  it('wants a short why', () => {
    expect(startWarnings(start({ why: undefined }))).toEqual([
      'no why: add why, one line under 100 characters on what the work is for or the question it answers, so the reader knows why it exists before what it produced',
    ]);
    expect(startWarnings(start({ why: 'x'.repeat(100) }))).toEqual([]);
    expect(startWarnings(start({ why: 'x'.repeat(101) }))).toEqual([
      'why is 101 characters; keep it under 100: what the work is for, in one line',
    ]);
  });

  it('wants the reader’s part in one line', () => {
    expect(startWarnings(start({ yourPart: undefined }))).toEqual([
      'no yourPart: say in one line what the reader has to do, even "Nothing now", e.g. "Nothing now. When G1 resumes: approve the 3 test cases and targets."',
    ]);
    expect(startWarnings(start({ yourPart: 'x'.repeat(120) }))).toEqual([]);
    expect(startWarnings(start({ yourPart: 'x'.repeat(121) }))).toEqual([
      'yourPart is 121 characters; keep it under 120: one line, with the detail in a step below',
    ]);
  });

  it('keeps existing views valid: both are optional in the schema', () => {
    const saved = createView(store, agent, {
      projectId: ids.p!,
      name: 'Old report',
      message: 'A report from before R3.6',
      widgets: [
        { id: 'start', node: start({ why: undefined, yourPart: undefined }) },
        text('changed'),
        text('checked'),
      ],
    });
    expect(saved.preview.widgets[0]!.warnings).toEqual([
      expect.stringMatching(/^no why: /),
      expect.stringMatching(/^no yourPart: /),
    ]);
  });

  it('warns when another widget also tells the reader their part', () => {
    const card = (kicker: string) => ({
      id: 'part',
      node: { component: 'ClaimCard', claim: ids.finding, kicker },
    });
    expect(
      preview(start(), [text('changed'), text('checked'), card('Your part')]).warnings,
    ).toEqual([
      'widget "part" also tells the reader their part ("Your part"); say it once, in the StartHere\'s yourPart, and take it out here so the page can\'t contradict itself',
    ]);
    expect(
      preview(start(), [
        text('changed'),
        { id: 'checked', node: { component: 'Markdown', content: 'So nothing needs you now.' } },
      ]).warnings,
    ).toEqual([
      expect.stringMatching(
        /^widget "checked" also tells the reader their part \("nothing needs you"\)/,
      ),
    ]);
    expect(preview(start(), [text('changed'), text('checked'), card('Keep')]).warnings).toEqual([]);
  });
});

describe('word budget', () => {
  const md = (id: string, n: number) => ({
    id,
    node: { component: 'Markdown', content: Array(n).fill('word').join(' ') },
  });
  const claim = (statement: string, detail?: string) =>
    store.apply(agent, {
      message: 'A finding',
      operations: [
        {
          op: 'create',
          type: 'claim',
          ref: 'c',
          data: {
            projectId: ids.p,
            statement,
            ...(detail ? { detail } : {}),
            checkedOn: '2026-10-12',
            sourceIds: [ids.tests],
            assumption: 'The run is current.',
          },
        },
      ],
    }).created.c!;
  const words = (n: number) => Array(n).fill('word').join(' ');

  it('counts the visible words of a report page, leaving out data tables', () => {
    // The opening has 25 words: why 9, headline 8, your part 2, steps 6.
    const fits = preview(start(), [md('changed', 64), md('checked', 61)]);
    expect(fits.warnings).toEqual([]);
    const over = preview(start(), [md('changed', 64), md('checked', 62)]);
    expect(over.warnings).toEqual([
      'the page shows 151 words before the reader opens anything; keep it to about 150. Most words: "changed" 64, "checked" 62, "start" 25. Cut repeats and background, and move the rest into details on tap (a Layers stack, a claim\'s quote or assumption, a later tab); data tables don\'t count',
    ]);
    const table = {
      id: 'table',
      node: { component: 'TaskTable' },
    };
    expect(preview(start(), [md('changed', 64), md('checked', 61), table]).warnings).toEqual([]);
  });

  it('counts only the first tab and the open layer', () => {
    const hidden = {
      id: 'checked',
      node: {
        component: 'Tabs',
        tabs: [
          { label: 'Short', children: [{ component: 'Markdown', content: 'A short part.' }] },
          { label: 'Long', children: [{ component: 'Markdown', content: words(300) }] },
        ],
      },
    };
    expect(preview(start(), [text('changed'), hidden]).warnings).toEqual([]);
    const long = claim(words(30), words(79));
    const layers = (open?: string) => ({
      id: 'layers',
      node: {
        component: 'Layers',
        ...(open ? { open } : {}),
        layers: ['1', '2'].map((key) => ({ key, title: 'Layer', items: { where: { id: long } } })),
      },
    });
    // 25 (opening) + 3 + 20 + 2 layer titles, and 109 more once layer 1 is open.
    expect(preview(start(), [text('changed'), md('checked', 20), layers()]).warnings).toEqual([]);
    expect(preview(start(), [text('changed'), md('checked', 20), layers('1')]).warnings).toEqual([
      expect.stringMatching(/^the page shows 159 words before the reader opens anything/),
    ]);
  });

  it('warns about a card over 25 words', () => {
    const card = (id: string) => ({ id: 'card', node: { component: 'ClaimCard', claim: id } });
    const ok = claim(words(15), words(10));
    expect(
      preview(start(), [text('changed'), text('checked'), card(ok)]).widgets[3]!.warnings,
    ).toEqual([]);
    const long = claim(words(15), words(11));
    expect(
      preview(start(), [text('changed'), text('checked'), card(long)]).widgets[3]!.warnings,
    ).toEqual([
      "this card shows 26 words; keep a card to 25 or fewer: shorten the claim's statement to one short line and drop its detail, or move the finding into a Layers stack the reader opens",
    ]);
  });

  it('warns when a row puts 3 wordy claim cards side by side, but not short ones', () => {
    const row = (statement: string) => {
      const id = claim(statement);
      return ['a', 'b', 'c'].map((key) => ({
        id: key,
        w: 4,
        node: { component: 'ClaimCard', claim: id },
      }));
    };
    expect(
      preview(start(), [text('changed'), text('checked'), ...row(words(12))]).warnings,
    ).toEqual([]);
    expect(
      preview(start(), [text('changed'), text('checked'), ...row(words(13))]).warnings,
    ).toEqual([
      'row 4 puts 3 claim cards with long statements side by side ("a", "b", "c"); wordy findings read better one per line: give each the full width or list them in a Layers stack, one short line each with details on tap. Keep side-by-side cards for short items such as numbers and labels',
    ]);
    const id = claim(words(13));
    const grid = {
      id: 'grid',
      node: {
        component: 'Grid',
        columns: 3,
        children: [1, 2, 3].map(() => ({ component: 'ClaimCard', claim: id })),
      },
    };
    expect(preview(start(), [text('changed'), text('checked'), grid]).warnings).toEqual([
      expect.stringMatching(/^a 3-column Grid in "grid" puts 3 claim cards with long statements/),
    ]);
  });

  it('warns when a page underlines more than 5 terms, counting each widget’s first uses', () => {
    const terms = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    store.apply(agent, {
      message: 'Terms',
      operations: terms.map((word) => ({
        op: 'create' as const,
        type: 'term' as const,
        data: { projectId: ids.p, word, explanation: `What ${word} means.` },
      })),
    });
    const say = (id: string, content: string, off = false) => ({
      id,
      node: { component: 'Markdown', content, ...(off ? { terms: false } : {}) },
    });
    expect(
      preview(start(), [say('changed', 'alpha bravo charlie alpha'), say('checked', 'delta echo')])
        .warnings,
    ).toEqual([]);
    expect(
      preview(start(), [say('changed', 'alpha bravo charlie'), say('checked', 'alpha delta echo')])
        .warnings,
    ).toEqual([
      'the page underlines 6 terms ("alpha", "bravo", "charlie", "delta", "echo"); keep it to 5 or fewer: keep a term only for a word a non-specialist wouldn\'t know, and delete it or set terms: false where the word is everyday',
    ]);
    expect(
      preview(start(), [
        say('changed', 'alpha bravo charlie'),
        say('checked', 'alpha delta echo foxtrot', true),
      ]).warnings,
    ).toEqual([]);
  });

  it('leaves ordinary views alone', () => {
    expect(
      previewView(store, {
        projectId: ids.p!,
        widgets: [
          md('a', 400),
          { id: 'b', node: { component: 'Markdown', content: 'Your part: none.' } },
        ],
      }).warnings,
    ).toEqual([]);
  });
});
