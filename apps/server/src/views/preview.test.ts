import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { previewView } from './service.js';

const agent = { kind: 'agent', name: 'test' } as const;

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(agent, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'App' } },
      {
        op: 'create',
        type: 'stage',
        ref: 's',
        data: { projectId: '$p', name: 'Build', targetDate: '2026-10-01' },
      },
      { op: 'update', type: 'project', id: '$p', data: { currentStageId: '$s' } },
      {
        op: 'create',
        type: 'task',
        ref: 'a',
        data: { projectId: '$p', stageId: '$s', title: 'Design', status: 'done' },
      },
      {
        op: 'create',
        type: 'task',
        data: {
          projectId: '$p',
          stageId: '$s',
          title: 'Build it',
          dueDate: '2026-10-03',
          dependsOn: ['$a'],
        },
      },
      { op: 'create', type: 'task', data: { projectId: '$p', title: 'Ship', priority: 'high' } },
    ],
  });
  return { store, projectId: created.p! };
}

describe('view_preview', () => {
  it('says what each widget shows, and flags typos, narrow widths, missing values, and gaps', () => {
    const { store, projectId } = setup();
    const result = previewView(store, {
      projectId,
      widgets: [
        {
          id: 'headline',
          node: {
            component: 'Text',
            content: '${open} open, ${late} late, ${typo}',
            values: {
              open: { count: { type: 'task', where: { status: { not: 'done' } } } },
              late: {
                count: {
                  type: 'task',
                  where: { dueDate: { lt: '2026-10-06' }, status: { not: 'done' } },
                },
              },
            },
          },
        },
        {
          id: 'oops',
          w: 4,
          node: {
            component: 'DataTable',
            query: { type: 'task', where: { dueDat: { exists: true } } },
            columns: [{ field: 'title' }, { field: 'stage.nam' }],
          },
        },
        { id: 'thin', w: 2, node: { component: 'KanbanBoard' } },
        { id: 'deps', w: 4, node: { component: 'DependencyGraph' } },
        { id: 'by', node: { component: 'CountChart', query: { type: 'task' }, by: 'priority' } },
        { id: 'nothing', node: { component: 'DecisionLog' } },
        { id: 'scope', node: { component: 'ScopeBoard', kinds: ['out'] } },
      ],
    });
    const w = Object.fromEntries(result.widgets.map((x) => [x.id, x]));
    expect(w.headline!.shows).toBe('2 open, 1 late, ${typo}');
    expect(w.headline!.warnings).toEqual(['${typo} has no value in "values"']);
    expect(w.oops!.empty).toBe(true);
    expect(w.oops!.warnings).toEqual([
      expect.stringMatching(/^"dueDat" isn't a field of task/),
      expect.stringMatching(/^"stage.nam" isn't a field of stage/),
    ]);
    expect(w.thin!.warnings).toEqual(['width 2 is below the minimum of 4 columns for KanbanBoard']);
    expect(w.deps!.shows).toBe('3 tasks, 1 dependency');
    expect(
      previewView(store, {
        projectId,
        widgets: [{ id: 'g', node: { component: 'DependencyGraph' } }],
      }).widgets[0]!.shows,
    ).toBe('3 tasks, 1 dependency');
    expect(w.by!.shows).toBe('Medium 2 · High 1'); // option labels, as people see them
    expect(w.nothing).toMatchObject({ empty: true, shows: 'nothing' });
    expect(w.scope).toMatchObject({ empty: true, shows: 'nothing' }); // only the "out" group, which is empty
    expect(result.layout).toEqual(['row 2 uses 10 of 12 columns before "by" wraps']);
    expect(result.summary).toBe(
      '7 widgets; 3 show an empty state (oops, nothing, scope); see warnings',
    );
  });

  it('lists decisions newest first, like the decision log does', () => {
    const { store, projectId } = setup();
    for (const title of ['First', 'Second', 'Third']) {
      store.apply(agent, {
        message: title,
        operations: [{ op: 'create', type: 'decision', data: { projectId, title } }],
      });
    }
    const result = previewView(store, {
      projectId,
      widgets: [{ id: 'd', node: { component: 'DecisionLog', filter: { limit: 2 } } }],
    });
    expect(result.widgets[0]!.shows).toBe('2 decisions, newest first: “Third”, “Second”');
  });

  it('previews a saved view, including its template', () => {
    const { store, projectId } = setup();
    const [overview] = store.list('view', { projectId });
    const result = previewView(store, { viewId: overview!.id });
    expect(result.view).toBe('Overview');
    expect(result.widgets.find((x) => x.id === 'header')!.shows).toBe('App, 33% done (1/3 tasks)');
    expect(result.widgets.find((x) => x.id === 'stages')!.shows).toBe('Build 50%');
    expect(result.widgets.every((x) => x.warnings.length === 0)).toBe(true);
  });
});

/** A project with a source link and a few claims, for explanation views. */
function knowledge() {
  const store = new Store(openDatabase(':memory:'));
  const claim = (ref: string, statement: string, extra: Record<string, unknown> = {}) => ({
    op: 'create' as const,
    type: 'claim' as const,
    ref,
    data: { projectId: '$p', statement, checkedOn: '2026-10-01', ...extra },
  });
  const { created } = store.apply(agent, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Map' } },
      {
        op: 'create',
        type: 'artifact',
        ref: 'src',
        data: { projectId: '$p', title: 'Report', kind: 'link', uri: 'https://example.com/r' },
      },
      { op: 'create', type: 'task', data: { projectId: '$p', title: 'Read the report' } },
      claim('point', 'Three layers; we have two.', { sourceIds: ['$src'] }),
      claim('top', 'The top layer is ours.', {
        certainty: 'verified',
        sourceIds: ['$src'],
        tags: ['layer-1'],
      }),
      claim('mid', 'Nobody offers the middle layer.', { sourceIds: ['$src'], tags: ['layer-2'] }),
      claim('guess', 'The middle layer is the hard one.', { tags: ['layer-3'] }),
    ],
  });
  return { store, projectId: created.p!, ids: created };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('view_preview on explanation views', () => {
  it('warns about nothing when the point comes first and every claim has a source', () => {
    const { store, projectId, ids } = knowledge();
    const result = previewView(store, {
      projectId,
      widgets: [
        { id: 'lead', node: { component: 'Markdown', content: words(30) } },
        { id: 'point', node: { component: 'ClaimCard', claim: ids.point!, size: 'headline' } },
        {
          id: 'layers',
          node: {
            component: 'Layers',
            layers: [
              {
                key: '1',
                title: 'Top',
                items: { where: { tags: 'layer-1' } },
                pill: { label: 'Ours', tone: 'own', claim: ids.top! },
              },
              { key: '2', title: 'Middle', items: { where: { tags: 'layer-2' } } },
            ],
          },
        },
      ],
    });
    expect(result.warnings).toEqual([]);
    expect(result.widgets.flatMap((w) => w.warnings)).toEqual([]);
    expect(result.summary).toBe('3 widgets; none empty');
    const w = Object.fromEntries(result.widgets.map((x) => [x.id, x]));
    expect(w.point!.shows).toBe('“Three layers; we have two.” (Our reading, 2026-10-01, 1 source)');
    expect(w.layers!.shows).toMatch(
      /^1 Top: 1 claim \(pill: “The top layer is ours\.” \(From source/,
    );
  });

  it('warns when the point comes after more than 30 words, after another block, or not at all', () => {
    const { store, projectId, ids } = knowledge();
    const point = { id: 'point', node: { component: 'ClaimCard', claim: ids.point! } };
    const layers = {
      id: 'layers',
      node: {
        component: 'Layers',
        layers: [
          { key: '1', title: 'Top', items: { where: { tags: 'layer-1' } } },
          { key: '2', title: 'Middle', items: { where: { tags: 'layer-2' } } },
        ],
      },
    };
    const warningsOf = (widgets: unknown[]) => previewView(store, { projectId, widgets }).warnings;
    const tooLate = (what: string) => [
      `the point comes too late: ${what} before the first ClaimCard; put a ClaimCard with size "headline" first and keep what comes before it to 30 words or fewer`,
    ];

    // Words count from titles, filled Text values, Callout bodies and Section descriptions, without
    // Markdown symbols or link targets: 3 + 5 + 22 = 30, then one more.
    const lead = (extra: string) => [
      {
        id: 'a',
        node: {
          component: 'Text',
          title: 'Where we stand',
          content: '**${n}** tasks [to read](https://example.com/x) first',
          values: { n: { count: { type: 'task' } } },
        },
      },
      { id: 'b', node: { component: 'Callout', body: `## ${words(22)}${extra}` } },
    ];
    expect(warningsOf([...lead(''), point, layers])).toEqual([]);
    expect(warningsOf([...lead(' more'), point, layers])).toEqual(tooLate('31 words'));

    // Any other block before the point, even inside a Grid.
    expect(
      warningsOf([
        {
          id: 'table',
          node: { component: 'DataTable', query: { type: 'task' }, columns: [{ field: 'title' }] },
        },
        point,
      ]),
    ).toEqual(tooLate('a DataTable comes'));
    expect(
      warningsOf([
        {
          id: 'g',
          node: {
            component: 'Grid',
            children: [layers.node, { component: 'ClaimCard', claim: ids.point! }],
          },
        },
      ]),
    ).toEqual(tooLate('a Layers comes'));
    // A ClaimCard first inside a Section is fine; one in a later tab is hidden at first.
    expect(
      warningsOf([
        {
          id: 's',
          node: {
            component: 'Section',
            title: 'The map',
            description: words(5),
            children: [point.node],
          },
        },
        layers,
      ]),
    ).toEqual([]);
    const noPoint = [
      'the point comes too late: no ClaimCard states it where the reader starts; put a ClaimCard with size "headline" first and keep what comes before it to 30 words or fewer',
    ];
    expect(
      warningsOf([
        {
          id: 't',
          node: {
            component: 'Tabs',
            tabs: [
              { label: 'Picture', children: [layers.node] },
              { label: 'Point', children: [point.node] },
            ],
          },
        },
      ]),
    ).toEqual(noPoint);
    expect(warningsOf([layers])).toEqual(noPoint);
    expect(
      warningsOf([{ id: 'm', node: { component: 'Markdown', content: 'Hi' } }, layers]),
    ).toEqual(noPoint);
  });

  it('warns about claims shown without a source, missing claims and empty layers', () => {
    const { store, projectId, ids } = knowledge();
    const noSource = `claim ${ids.guess} "The middle layer is the hard one." has no source: add sourceIds so the reader can check it`;
    const result = previewView(store, {
      projectId,
      widgets: [
        { id: 'point', node: { component: 'ClaimCard', claim: ids.guess!, size: 'headline' } },
        { id: 'gone', w: 6, node: { component: 'ClaimCard', claim: 'clm_gone' } },
        { id: 'fine', w: 6, node: { component: 'ClaimCard', claim: ids.mid! } },
        {
          id: 'layers',
          node: {
            component: 'Layers',
            layers: [
              {
                key: '1',
                title: 'Top',
                items: { where: { tags: 'layer-1' } },
                pill: { label: 'Gone', tone: 'gap', claim: 'clm_gone' },
              },
              {
                key: '2',
                title: 'Middle',
                items: { where: { tags: 'layer-2' } },
                pill: { label: 'Hard', tone: 'watch', claim: ids.guess! },
              },
              { key: '3', title: 'Guess', items: { where: { tags: 'layer-3' } } },
              { key: '4', title: 'Bottom', items: { where: { tags: 'layer-4' } } },
            ],
          },
        },
      ],
    });
    const w = Object.fromEntries(result.widgets.map((x) => [x.id, x]));
    expect(result.warnings).toEqual([]);
    expect(w.point!.warnings).toEqual([noSource]);
    expect(w.gone).toMatchObject({
      empty: true,
      warnings: ['claim clm_gone not found in this project'],
    });
    expect(w.fine!.warnings).toEqual([]);
    // Each problem once, even when a claim is shown twice (as a pill and in a layer).
    expect(w.layers!.warnings).toEqual([
      'claim clm_gone not found in this project',
      'layer "4" shows nothing',
      noSource,
    ]);
    expect(w.layers!.empty).toBe(false);
  });

  it('leaves ordinary project views alone', () => {
    const { store, projectId } = knowledge();
    const result = previewView(store, {
      projectId,
      widgets: [
        { id: 'intro', node: { component: 'Markdown', content: words(80) } },
        { id: 'board', node: { component: 'KanbanBoard' } },
        { id: 'claims', node: { component: 'DataList', query: { type: 'claim' } } },
      ],
    });
    expect(result.warnings).toEqual([]);
    expect(result.widgets.flatMap((x) => x.warnings)).toEqual([]);
    const [overview] = store.list('view', { projectId });
    expect(previewView(store, { viewId: overview!.id }).warnings).toEqual([]);
  });
});
