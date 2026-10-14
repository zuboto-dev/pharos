// v0.2 B2: "Visual system" (tokens, one of each chart and picture block, the presence mark).
// Adapted from v02/B2/patch-visual-system.mjs: the made-up work (one apply) is skipped when its
// stages are there, and its ids are found again by name, so a run that stopped before the view
// finishes it. The board is previewed before the work is added (with placeholder ids) and again
// with the real ones.
import { StepError, day, ensureView, previewOrStop, viewNamed } from '../lib.mjs';

export const key = 'B2';
export const title = 'Visual system (tokens, charts, pictures, presence)';

const VIEW = 'Visual system';
const TAG = 'visual-system';
const STAGES = {
  s5: 'V1.5 Presence (sample)',
  s6: 'V1.6 Visual system (sample)',
  s7: 'V1.7 Charts (sample)',
};
const TASKS = [
  ['s5', 'Presence signal on the feed', 'done'],
  ['s5', 'Marks on blocks and tabs', 'done'],
  ['s6', 'Colour, type, spacing and radius tokens', 'done'],
  ['s6', 'Dark mode pass on every block', 'done'],
  ['s6', 'Light mode pass on faint text', 'todo'],
  ['s7', 'One chart palette', 'done'],
  ['s7', 'Shared labels, values and legends', 'done'],
  ['s7', 'Axes for time charts', 'todo'],
];
const CLAIMS = {
  dark: 'Every catalog block now reads in dark mode.',
  before: 'Before the pass, 23 of 35 blocks read well in dark mode.',
  after: 'After the pass, 35 of 35 blocks read well in dark mode.',
  change: 'One token now stands for each light and dark pair.',
  was: 'A block named a light and a dark grey.',
  now: 'A block names one token.',
};
const PICTURE = 'Company seal, highlighted';
const SOURCE = 'Dark-mode contrast check (made-up record)';

function operations(projectId, sealId, status, today) {
  const reading = (statement, assumption, extra = {}) => ({
    projectId,
    statement,
    certainty: 'reading',
    assumption,
    checkedOn: today,
    sourceIds: ['$src'],
    ...extra,
  });
  return [
    {
      op: 'create',
      type: 'artifact',
      ref: 'src',
      data: {
        projectId,
        title: SOURCE,
        uri: 'https://example.com/pharos/visual-system-check',
        tags: [TAG],
      },
    },
    ...Object.entries(STAGES).map(([ref, name], i) => ({
      op: 'create',
      type: 'stage',
      ref,
      data: { projectId, name, order: 101 + i },
    })),
    ...TASKS.map(([stage, title, meaning], i) => ({
      op: 'create',
      type: 'task',
      ref: `t${i}`,
      data: { projectId, stageId: `$${stage}`, title, status: status(meaning) },
    })),
    {
      op: 'create',
      type: 'claim',
      ref: 'dark',
      data: reading(
        CLAIMS.dark,
        'The made-up count: blocks whose text passes WCAG AA on a dark block.',
        {
          tags: [TAG],
        },
      ),
    },
    {
      op: 'create',
      type: 'claim',
      ref: 'before',
      data: reading(CLAIMS.before, 'A sample count, made up for this page.', {
        tags: [TAG, `${TAG}-bars`],
        figure: { value: 23, unit: 'blocks', label: 'Before the pass' },
        order: 1,
      }),
    },
    {
      op: 'create',
      type: 'claim',
      ref: 'after',
      data: reading(CLAIMS.after, 'Checked by the dark-mode contrast test.', {
        tags: [TAG, `${TAG}-bars`],
        figure: { value: 35, unit: 'blocks', label: 'After the pass' },
        order: 2,
      }),
    },
    {
      op: 'create',
      type: 'claim',
      ref: 'change',
      data: reading(CLAIMS.change, 'The class names a block writes.', { tags: [TAG] }),
    },
    {
      op: 'create',
      type: 'claim',
      ref: 'was',
      data: reading(CLAIMS.was, 'A typical class list before.', {
        tags: [TAG],
        quote: 'text-neutral-500 dark:text-neutral-400',
        locator: 'a block, before',
      }),
    },
    {
      op: 'create',
      type: 'claim',
      ref: 'now',
      data: reading(CLAIMS.now, 'The same class list after.', {
        tags: [TAG],
        quote: 'text-muted',
        locator: 'the same block, after',
      }),
    },
    {
      op: 'create',
      type: 'artifact',
      ref: 'pic',
      data: {
        projectId,
        title: PICTURE,
        image: sealId,
        alt: "Example Co's made-up company seal, shown with the highlight ring.",
        tags: [TAG],
      },
    },
  ];
}

function widgets(ids, sealId, DONE, today) {
  const { s5, s6, s7, dark, after, change, was, now, pic, t2 } = ids;
  const TOKENS = [
    '| Token | For |',
    '| --- | --- |',
    '| `surface` `line` | block, edge |',
    '| `ink` `muted` `faint` | text |',
    '| `chart-highlight` | the one |',
    '| `chart-rest` `chart-track` | the rest, the whole |',
    '| `ok` `warn` `danger` `presence` | status, agent |',
    '',
    'Type: `figure` 24 · `heading` 16 · `body` 14 · `caption` 12',
  ].join('\n');
  const stages = [s5, s6, s7];
  return [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'done',
        why: 'So all blocks look like one product',
        headline:
          'Blocks now share one set of colours, sizes and chart styles, and read in dark mode.',
        yourPart: 'Nothing now. Switch the theme in Settings to see both looks.',
        evidence: [{ id: t2, label: 'Tokens task' }],
        stageId: s6,
        date: today,
        path: [
          { label: 'Tokens', says: 'Colour and size names', target: 'tokens' },
          { label: 'Charts', says: 'One palette', target: 'chart' },
          { label: 'Live mark', says: 'An agent editing', target: 'live' },
        ],
      },
    },
    { id: 'tokens', w: 6, node: { component: 'Markdown', title: 'Tokens', content: TOKENS } },
    {
      id: 'live',
      w: 6,
      node: {
        component: 'Text',
        title: 'Edited live',
        content: 'An agent edits this note: watch for “is editing…”.',
      },
    },
    {
      id: 'stats',
      w: 6,
      node: {
        component: 'StatCards',
        stats: [
          {
            label: 'Done',
            query: { type: 'task', where: { stageId: stages, status: DONE } },
            of: { type: 'task', where: { stageId: stages } },
            tone: 'good',
          },
          {
            label: 'Open',
            query: { type: 'task', where: { stageId: stages, status: { not: DONE } } },
          },
          {
            label: 'Blocked',
            query: { type: 'task', where: { stageId: stages, status: 'blocked' } },
            tone: 'bad',
          },
        ],
      },
    },
    {
      id: 'ring',
      w: 3,
      node: { component: 'ProgressRing', label: 'Visual system', where: { stageId: s6 } },
    },
    {
      id: 'share',
      w: 3,
      node: {
        component: 'Text',
        title: 'Mini bar',
        content: 'Charts done: ${bar}',
        values: {
          bar: {
            bar: {
              query: { type: 'task', where: { stageId: s7, status: DONE } },
              of: { type: 'task', where: { stageId: s7 } },
            },
          },
        },
      },
    },
    {
      id: 'chart',
      w: 6,
      node: {
        component: 'FindingChart',
        claim: dark,
        bars: { where: { tags: `${TAG}-bars` } },
        highlight: after,
        max: 35,
      },
    },
    {
      id: 'count',
      w: 6,
      node: {
        component: 'CountChart',
        title: 'Tasks by stage',
        query: { type: 'task', where: { stageId: stages } },
        by: 'stageId',
      },
    },
    {
      id: 'flow',
      node: {
        component: 'Layers',
        orientation: 'flow',
        layers: [
          {
            key: '5',
            title: 'Presence',
            pill: { label: 'Done', tone: 'own' },
            progress: { stageId: s5 },
          },
          {
            key: '6',
            title: 'Visual system',
            pill: { label: 'Open', tone: 'watch' },
            progress: { stageId: s6 },
          },
          {
            key: '7',
            title: 'Charts',
            pill: { label: 'Open', tone: 'watch' },
            progress: { stageId: s7 },
          },
        ],
      },
    },
    {
      id: 'pictures',
      w: 6,
      node: {
        component: 'Gallery',
        title: 'Pictures',
        layout: 'compare',
        files: { where: { id: [sealId] } },
        artifacts: { where: { id: [pic] } },
        highlight: [pic],
      },
    },
    {
      id: 'change',
      w: 6,
      node: {
        component: 'BeforeAfter',
        claim: change,
        before: was,
        after: now,
        beforeLabel: 'before',
        afterLabel: 'after',
      },
    },
  ];
}

export async function run({ call, samples, log }) {
  const projectId = samples.id;
  const existing = await viewNamed(call, projectId, VIEW);
  if (existing)
    return [{ project: samples.name, projectId, view: VIEW, viewId: existing.id, made: false }];

  const seal = (await call('list', { type: 'file', projectId })).find(
    (f) => f.title === 'Company seal',
  );
  if (!seal)
    throw new StepError(
      'The Company seal picture isn’t in "Pharos samples"; the R7.12 step adds it.',
    );
  const project = await call('get', { id: projectId });
  const status = (meaning) =>
    project.data?.options?.['task.status']?.find((o) => o.meaning === meaning)?.value ?? meaning;
  const DONE = status('done');
  const today = day(0);

  const find = async () => {
    const [stages, tasks, claims, artifacts] = await Promise.all(
      ['stage', 'task', 'claim', 'artifact'].map((type) => call('list', { type, projectId })),
    );
    const ids = {};
    for (const [ref, name] of Object.entries(STAGES))
      ids[ref] = stages.find((s) => s.name === name)?.id;
    for (const [ref, statement] of Object.entries(CLAIMS))
      ids[ref] = claims.find((c) => c.statement === statement)?.id;
    ids.pic = artifacts.find((a) => a.title === PICTURE)?.id;
    ids.t2 = tasks.find((t) => t.title === TASKS[2][1] && t.stageId === ids.s6)?.id;
    return ids;
  };
  let ids = await find();
  if (!ids.s6) {
    const fake = Object.fromEntries(Object.keys(ids).map((k) => [k, `x_${k}`]));
    // Placeholder ids can't be checked against data; only the board's shape is checked here.
    const draft = await call('view_preview', {
      projectId,
      widgets: widgets(fake, seal.id, DONE, today),
    });
    if (!draft.widgets?.length)
      throw new StepError(`view_preview couldn't read the "${VIEW}" board.`);
    const made = await call('apply', {
      message:
        'Made-up work for the Visual system sample: three stages, their tasks, findings and a picture (v0.2 B2)',
      operations: operations(projectId, seal.id, status, today),
    });
    log(`added the made-up work (revision ${made.revision?.id ?? made.revision})`);
    ids = await find();
  }
  const missing = Object.entries(ids).filter(([, v]) => !v);
  if (missing.length)
    throw new StepError(
      `The Visual system work is incomplete (missing ${missing.map(([k]) => k).join(', ')}).`,
    );
  const board = widgets(ids, seal.id, DONE, today);
  await previewOrStop(call, projectId, VIEW, board);
  const view = await ensureView(
    call,
    projectId,
    VIEW,
    'v0.2 B2 sample: tokens, one of each chart and picture block, and a live presence mark (made-up data)',
    board,
    'A view showing the v0.2 visual system: tokens, shared chart styles and the agent presence mark (v0.2 B2 sample)',
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made: view.made }];
}
