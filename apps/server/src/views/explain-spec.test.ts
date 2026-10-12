// Explanation warning specification tests · 2026-10-11 · GPT-6-Astra · 75c8964
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { NO_OPENING } from './preview.js';
import { createView, previewView as previewWithOpening, updateView } from './service.js';

const agent = { kind: 'agent', name: 'spec-test' } as const;
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
let db: ReturnType<typeof openDatabase>;
let store: Store;
let ids: Record<string, string>;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = new Store(db);
  ids = store.apply(
    { kind: 'human', name: 'owner' },
    {
      message: 'Synthetic warning fixtures',
      operations: [
        {
          op: 'create',
          type: 'project',
          ref: 'p',
          data: { name: 'Example', description: words(31) },
        },
        { op: 'create', type: 'project', ref: 'other', data: { name: 'Other' } },
        {
          op: 'create',
          type: 'artifact',
          ref: 'source',
          data: { projectId: '$p', title: 'Source', uri: 'https://example.com' },
        },
        {
          op: 'create',
          type: 'decision',
          ref: 'decision',
          data: { projectId: '$p', title: 'Keep it', status: 'accepted' },
        },
        ...[
          {
            ref: 'reading',
            statement: 'An interpretation.',
            certainty: 'reading',
            sourceIds: [],
            assumption: 'Nothing changed since.',
          },
          {
            ref: 'linked',
            statement: 'Linked interpretation.',
            certainty: 'reading',
            sourceIds: ['$source'],
            assumption: 'The source is current.',
          },
          {
            ref: 'verified',
            statement: 'A sourced fact.',
            certainty: 'verified',
            sourceIds: ['$source'],
            quote: 'The fact, in the words of the source.',
          },
          {
            ref: 'confirmed',
            statement: 'An accepted choice.',
            certainty: 'confirmed',
            confirmedById: '$decision',
            sourceIds: [],
          },
          {
            ref: 'long',
            statement: 'x'.repeat(80),
            certainty: 'reading',
            sourceIds: [],
            assumption: 'Long statements stay readable.',
          },
        ].map(({ ref, ...data }) => ({
          op: 'create' as const,
          type: 'claim' as const,
          ref,
          data: { projectId: '$p', checkedOn: '2026-01-01', ...data },
        })),
        {
          op: 'create',
          type: 'claim',
          ref: 'foreign',
          data: { projectId: '$other', statement: 'Elsewhere.', checkedOn: '2026-01-01' },
        },
      ],
    },
  ).created;
});
afterEach(() => db.close());

const card = (claim = ids.linked!) => ({ component: 'ClaimCard', claim });
const layers = (claim = ids.linked!, pill?: string) => ({
  component: 'Layers',
  layers: ['1', '2'].map((key) => ({
    key,
    title: 'Layer',
    items: { where: { id: claim } },
    ...(pill ? { pill: { label: 'Here', tone: 'own', claim: pill } } : {}),
  })),
});
// These views have no StartHere opening; that rule (R3.1) is tested in start-here.test.ts, so its
// warning is left out here to keep these tests about slice 1 §5.
const previewView: typeof previewWithOpening = (...args) => {
  const result = previewWithOpening(...args);
  return { ...result, warnings: result.warnings.filter((w) => !w.startsWith(NO_OPENING)) };
};
const preview = (nodes: unknown[]) =>
  previewView(store, {
    projectId: ids.p!,
    widgets: nodes.map((node, i) => ({ id: `w${i}`, node })),
  });
const sourceWarning = (id: string, statement: string) =>
  `claim ${id} "${statement.slice(0, 60)}" has no source: add sourceIds so the reader can check it`;

describe('slice 1 §5: the point in reading order', () => {
  it.each(['Markdown', 'Text', 'Callout'])(
    'allows exactly 30 words and warns at 31 in %s',
    (component) => {
      for (const count of [0, 29, 30, 31]) {
        const lead = { component, [component === 'Callout' ? 'body' : 'content']: words(count) };
        const warnings = preview([lead, card()]).warnings;
        if (count <= 30) expect(warnings).toEqual([]);
        else
          expect(warnings).toEqual([
            expect.stringContaining('31 words before the first ClaimCard'),
          ]);
      }
    },
  );

  it('counts titles, section descriptions, filled Text values and Markdown words together', () => {
    const lead = (extra: string) => ({
      component: 'Section',
      title: 'Start here',
      description: words(20),
      children: [
        {
          component: 'Text',
          title: 'A title',
          content: '${name}',
          values: { name: { project: 'name' } },
        },
        {
          component: 'Markdown',
          content: `## **one** [two](https://example.com) _three_ four five${extra}`,
        },
        { component: 'Grid', children: [card()] },
      ],
    });
    expect(preview([lead('')]).warnings).toEqual([]);
    expect(preview([lead(' six')]).warnings).toEqual([expect.stringContaining('31 words')]);
  });

  it('counts the project description when Markdown reads it', () => {
    expect(
      preview([{ component: 'Markdown', source: 'project.description' }, card()]).warnings,
    ).toEqual([expect.stringContaining('31 words')]);
  });

  it('warns for a table before the point, including inside Grid and Section', () => {
    const table = {
      component: 'DataTable',
      query: { type: 'claim' },
      columns: [{ field: 'statement' }],
    };
    for (const lead of [
      table,
      {
        component: 'Grid',
        children: [{ component: 'Section', title: 'Details', children: [table] }],
      },
    ]) {
      expect(preview([lead, card()]).warnings).toEqual([expect.stringContaining('DataTable')]);
    }
    expect(preview([card(), table]).warnings).toEqual([]);
  });

  it('uses widget array order and ignores long content after the point', () => {
    expect(
      preview([card(), { component: 'Markdown', content: words(100) }, layers()]).warnings,
    ).toEqual([]);
    expect(preview([layers(), card()]).warnings).toEqual([expect.stringContaining('Layers')]);
  });

  it('requires a point for Layers but leaves ordinary views alone', () => {
    expect(preview([layers()]).warnings).toEqual([expect.stringContaining('no ClaimCard')]);
    expect(preview([{ component: 'Markdown', content: words(100) }]).warnings).toEqual([]);
  });

  it('only follows the first tab when locating the point', () => {
    const tabs = (first: unknown[], second: unknown[]) => ({
      component: 'Tabs',
      tabs: [
        { label: 'First', children: first },
        { label: 'Second', children: second },
      ],
    });
    expect(
      preview([tabs([card()], [{ component: 'Markdown', content: words(100) }, layers()])])
        .warnings,
    ).toEqual([]);
    expect(preview([tabs([layers()], [card()])]).warnings).toEqual([
      expect.stringContaining('no ClaimCard'),
    ]);
    expect(
      preview([
        tabs(
          [{ component: 'Markdown', content: words(30) }],
          [{ component: 'Markdown', content: words(100) }],
        ),
        card(),
      ]).warnings,
    ).toEqual([]);
  });

  // §5 (resolved): the first ClaimCard's own title is read before its statement, so it counts.
  it('counts the first ClaimCard title as lead-in', () => {
    expect(
      preview([
        { component: 'Markdown', content: words(30) },
        { ...card(), title: 'The point' },
      ]).warnings,
    ).toHaveLength(1);
  });
});

describe('slice 1 §5: finding warnings', () => {
  it('uses the certainty meaning after its value and label are customized', () => {
    store.apply(agent, {
      message: 'Rename the reading option',
      operations: [
        {
          op: 'update',
          type: 'project',
          id: ids.p!,
          data: {
            options: {
              'claim.certainty': [
                { value: 'confirmed', label: 'Accepted', meaning: 'confirmed' },
                { value: 'interpretation', label: 'Working theory', meaning: 'reading' },
                { value: 'verified', label: 'Checked', meaning: 'verified' },
              ],
            },
          },
        },
        ...['reading', 'linked', 'long'].map((key) => ({
          op: 'update' as const,
          type: 'claim' as const,
          id: ids[key]!,
          data: { certainty: 'interpretation' },
        })),
      ],
    });
    expect(preview([card(ids.reading!)]).widgets[0]!.warnings).toEqual([
      sourceWarning(ids.reading!, 'An interpretation.'),
    ]);
    expect(preview([card(ids.linked!)]).widgets[0]!.warnings).toEqual([]);
  });

  it('returns source warnings for created and updated claims, not untouched claims', () => {
    const created = store.apply(agent, {
      message: 'Add a finding',
      operations: [
        {
          op: 'create',
          type: 'claim',
          ref: 'new',
          data: {
            projectId: ids.p!,
            statement: 'New interpretation.',
            checkedOn: '2026-01-01',
            assumption: 'It still holds.',
          },
        },
      ],
    });
    expect(created.warnings).toEqual([sourceWarning(created.created.new!, 'New interpretation.')]);
    const updated = store.apply(agent, {
      message: 'Revise a finding',
      operations: [
        {
          op: 'update',
          type: 'claim',
          id: ids.reading!,
          data: { statement: 'Revised interpretation.' },
        },
      ],
    });
    expect(updated.warnings).toEqual([sourceWarning(ids.reading!, 'Revised interpretation.')]);
    const unrelated = store.apply(agent, {
      message: 'Rename the project',
      operations: [{ op: 'update', type: 'project', id: ids.p!, data: { name: 'Renamed' } }],
    });
    expect(unrelated.warnings).toEqual([]);
  });

  it.each(['reading', 'linked', 'verified', 'confirmed'])(
    'warns only for a sourceless reading: %s',
    (key) => {
      const warnings = preview([card(ids[key]!)]).widgets[0]!.warnings;
      expect(warnings).toEqual(
        key === 'reading' ? [sourceWarning(ids.reading!, 'An interpretation.')] : [],
      );
    },
  );

  // §5 (resolved): the excerpt is the first 60 characters, with "…" when the statement is longer.
  it('shortens long statements in the source warning to 60 characters and an ellipsis', () => {
    expect(preview([card(ids.long!)]).widgets[0]!.warnings).toEqual([
      `claim ${ids.long!} "${'x'.repeat(60)}…" has no source: add sourceIds so the reader can check it`,
    ]);
  });

  it('warns for layer items and pill findings, but not filtered-out findings', () => {
    expect(preview([card(), layers()]).widgets[1]!.warnings).toEqual([]);
    for (const node of [layers(ids.reading!), layers(ids.linked!, ids.reading!)]) {
      expect(preview([card(), node]).widgets[1]!.warnings).toEqual([
        sourceWarning(ids.reading!, 'An interpretation.'),
      ]);
    }
  });

  it.each(['clm_missing', 'foreign', 'source'])(
    'rejects missing, foreign and wrong-type claim references in previews: %s',
    (key) => {
      const id = ids[key] ?? key;
      expect(preview([card(id)]).widgets[0]!.warnings).toEqual([
        `claim ${id} not found in this project`,
      ]);
      expect(preview([card(), layers(ids.linked!, id)]).widgets[1]!.warnings).toEqual([
        `claim ${id} not found in this project`,
        `claim ${id} not found in this project`,
      ]);
    },
  );

  it('warns when items match nothing even when a pill finding exists', () => {
    expect(preview([card(), layers('clm_absent', ids.linked!)]).widgets[1]!.warnings).toEqual([
      'layer "1" shows nothing',
      'layer "2" shows nothing',
    ]);
  });

  it('returns warnings on save and update without preventing either write', () => {
    const saved = createView(store, agent, {
      projectId: ids.p!,
      name: 'Explanation',
      message: 'Save draft',
      widgets: [{ id: 'point', node: card(ids.reading!) }],
    });
    expect(saved.preview.widgets[0]!.warnings).toEqual([
      sourceWarning(ids.reading!, 'An interpretation.'),
    ]);
    const updated = updateView(store, agent, {
      viewId: saved.view.id,
      message: 'Use linked finding',
      ops: [{ op: 'update', id: 'point', set: { claim: ids.linked! } }],
    });
    expect(updated.preview.widgets[0]!.warnings).toEqual([]);
    expect(previewView(store, { viewId: saved.view.id }).widgets[0]!.warnings).toEqual([]);
  });
});
