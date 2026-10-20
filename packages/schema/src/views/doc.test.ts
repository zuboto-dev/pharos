import { describe, expect, it } from 'vitest';
import {
  DOC_LIMITS,
  FIGURE_MEDIA,
  ReportDoc,
  docBlocks,
  docLeaves,
  figureMedia,
  type DocBlock,
} from './doc.js';
import { docReads, readsNothing } from './reads.js';

// R14: report documents, blocks in reading order that Pharos draws itself.

const SPEND = { type: 'record' as const, filter: { where: { recordType: 'spending' } } };

const text = (id: string, content = 'Hello') => ({
  kind: 'block' as const,
  id,
  node: { component: 'Text', content },
});

const VALID = {
  summary: 'Groceries rose every month.',
  data: { spend: SPEND },
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content: 'We spent **${total}** in the quarter.',
        values: {
          total: { sum: { query: { type: 'record', ...SPEND.filter }, field: 'fields.amount' } },
        },
      },
    },
    {
      kind: 'columns',
      id: 'numbers',
      width: 'wide',
      widths: [1, 1],
      columns: [
        [
          {
            kind: 'block',
            id: 'n1',
            node: { component: 'Stat', label: 'Receipts', query: { type: 'record' } },
          },
        ],
        [
          {
            kind: 'block',
            id: 'n2',
            node: { component: 'Stat', label: 'Tasks', query: { type: 'task' } },
          },
        ],
      ],
    },
    {
      kind: 'drawing',
      id: 'map',
      html: '<svg></svg>',
      reads: ['spend'],
      height: 240,
      caption: 'A drawing',
    },
    { kind: 'embed', id: 'ref', url: 'https://example.com/', caption: 'Reference' },
  ],
};

const messages = (input: unknown) => {
  const result = ReportDoc.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('ReportDoc (R14)', () => {
  it('accepts a document with prose, columns, a drawing and an embed', () => {
    const result = ReportDoc.safeParse(VALID);
    expect(result.success).toBe(true);
    expect(docLeaves(result.data!.blocks).map((b) => b.id)).toEqual([
      'lead',
      'n1',
      'n2',
      'map',
      'ref',
    ]);
  });

  it('refuses duplicate block ids, also inside columns', () => {
    expect(messages({ blocks: [text('a'), text('a')] })).toContain('Duplicate block id "a"');
    expect(
      messages({
        blocks: [text('a'), { kind: 'columns', id: 'c', columns: [[text('a')], [text('b')]] }],
      }),
    ).toContain('Duplicate block id "a"');
    expect(
      messages({
        blocks: [{ kind: 'columns', id: 'c', columns: [[text('c')], [text('b')]] }],
      }),
    ).toContain('Duplicate block id "c"');
  });

  it('refuses nested columns, one column and more than four', () => {
    const inner = { kind: 'columns', id: 'in', columns: [[text('x')], [text('y')]] };
    expect(
      messages({ blocks: [{ kind: 'columns', id: 'c', columns: [[inner], [text('b')]] }] }),
    ).not.toEqual([]);
    expect(
      messages({ blocks: [{ kind: 'columns', id: 'c', columns: [[text('a')]] }] }),
    ).not.toEqual([]);
    const five = [1, 2, 3, 4, 5].map((i) => [text(`t${i}`)]);
    expect(messages({ blocks: [{ kind: 'columns', id: 'c', columns: five }] })).not.toEqual([]);
  });

  it('keeps to the limits: blocks, drawings, embeds, drawing size and named reads', () => {
    const many = Array.from({ length: DOC_LIMITS.blocks + 1 }, (_, i) => text(`t${i}`));
    expect(messages({ blocks: many })).toContain(`At most ${DOC_LIMITS.blocks} blocks`);
    const drawing = (i: number) => ({
      kind: 'drawing',
      id: `d${i}`,
      html: '<p>x</p>',
      height: 100,
    });
    expect(
      messages({ blocks: Array.from({ length: DOC_LIMITS.drawings + 1 }, (_, i) => drawing(i)) }),
    ).toContain(`At most ${DOC_LIMITS.drawings} drawings`);
    const embed = (i: number) => ({ kind: 'embed', id: `e${i}`, url: 'https://example.com/' });
    expect(
      messages({ blocks: Array.from({ length: DOC_LIMITS.embeds + 1 }, (_, i) => embed(i)) }),
    ).toContain(`At most ${DOC_LIMITS.embeds} embeds`);
    expect(
      messages({
        blocks: [{ ...drawing(0), html: 'x'.repeat(DOC_LIMITS.drawingChars + 1) }],
      }),
    ).not.toEqual([]);
    const reads = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`r${i}`, SPEND]));
    expect(messages({ blocks: [text('a')], data: reads })).toContain('At most 30 named reads');
    expect(messages({ blocks: [] })).not.toEqual([]);
  });

  it('refuses a drawing that reads a name missing from data', () => {
    const doc = {
      blocks: [{ kind: 'drawing', id: 'd', html: '<p>x</p>', height: 100, reads: ['nope'] }],
    };
    expect(messages(doc)).toContain('Drawing "d" reads "nope", which is not in data');
    const inColumns = {
      data: { spend: SPEND },
      blocks: [
        {
          kind: 'columns',
          id: 'c',
          columns: [
            [{ kind: 'drawing', id: 'd', html: '<p>x</p>', height: 100, reads: ['spend', 'gone'] }],
            [text('b')],
          ],
        },
      ],
    };
    expect(messages(inColumns)).toEqual(['Drawing "d" reads "gone", which is not in data']);
  });

  it('refuses an embed that is not https', () => {
    for (const url of [
      'http://example.com/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://x',
    ])
      expect(messages({ blocks: [{ kind: 'embed', id: 'e', url }] })).not.toEqual([]);
  });

  it('refuses unknown fields and bad ids', () => {
    expect(messages({ blocks: [{ ...text('a'), extra: 1 }] })).not.toEqual([]);
    expect(messages({ blocks: [text('1a')] })).not.toEqual([]);
    expect(messages({ blocks: [text('a')], spec: {} })).not.toEqual([]);
  });
});

describe('docReads (R14)', () => {
  it("reads its components' queries and its named reads", () => {
    const doc = ReportDoc.parse(VALID);
    const reads = docReads(doc);
    expect(reads.queries).toEqual(
      expect.arrayContaining([
        { type: 'record', filter: { where: { recordType: 'spending' } } },
        { type: 'record' },
        { type: 'task' },
      ]),
    );
    expect(readsNothing(reads)).toBe(false);
  });

  it('finds components inside columns, and nothing in drawings without reads or embeds', () => {
    const blocks: DocBlock[] = [
      { kind: 'drawing', id: 'd', html: '<p>x</p>', height: 100 },
      { kind: 'embed', id: 'e', url: 'https://example.com/' },
      { kind: 'block', id: 't', node: { component: 'Markdown', content: 'Plain' } },
    ];
    expect(readsNothing(docReads({ blocks }))).toBe(true);
    const cols: DocBlock[] = [
      {
        kind: 'columns',
        id: 'c',
        columns: [
          [{ kind: 'block', id: 'a', node: { component: 'TaskTable' } }],
          [{ kind: 'block', id: 'b', node: { component: 'Markdown', content: 'x' } }],
        ],
      },
    ];
    expect(docReads({ blocks: cols }).queries.map((q) => q.type)).toEqual(['task']);
  });
});

// R15: rich documents and the review desk: figure, steps, details, sheet.

const figure = (id: string, srcs: string[] = ['shots/a.png'], layout?: string) => ({
  kind: 'figure' as const,
  id,
  ...(layout ? { layout } : {}),
  items: srcs.map((src) => ({ src, alt: `Shot ${src}` })),
});
const steps = (id: string) => ({
  kind: 'steps' as const,
  id,
  items: [{ text: 'Open the app', command: 'pnpm dev', expect: 'It starts' }],
});
const details = (id: string, blocks: unknown[] = [text(`${id}-t`)]) => ({
  kind: 'details',
  id,
  summary: 'Why',
  blocks,
});
const sheet = (id: string, blocks: unknown[] = [text(`${id}-t`)], extra = {}) => ({
  kind: 'sheet',
  id,
  title: `Sheet ${id}`,
  blocks,
  ...extra,
});
const cols = (id: string, a: unknown, b: unknown = text(`${id}-b`)) => ({
  kind: 'columns',
  id,
  columns: [[a], [b]],
});

describe('figure, steps, details and sheet blocks (R15)', () => {
  it('accepts each new block with its options', () => {
    expect(
      messages({
        blocks: [
          {
            ...figure('f', ['shots/before.png', 'shots/after.png'], 'compare'),
            caption: '**Before** and after',
            width: 'wide',
          },
          figure('clip', ['rec/tour.mp4', 'rec/voice.m4a', 'img/x.svg']),
          { ...steps('s'), title: 'How to check' },
          { ...details('d'), open: true },
          sheet('sh', [text('a')], { time: '10 min', tags: ['review'], decisions: ['dec_1'] }),
        ],
      }),
    ).toEqual([]);
    for (const layout of ['single', 'pair', 'grid', 'phone', 'compare'])
      expect(messages({ blocks: [figure('f', ['a.png'], layout)] }), layout).toEqual([]);
  });

  it('refuses bad figures: unknown layouts, no items, files that are no picture, sound or clip', () => {
    expect(messages({ blocks: [figure('f', ['a.png'], 'carousel')] })).not.toEqual([]);
    expect(messages({ blocks: [figure('f', [])] })).not.toEqual([]);
    for (const src of [
      'a.js',
      'a.pdf',
      '/abs.png',
      '../up.png',
      'a/../b.png',
      'https://x.com/a.png',
    ])
      expect(messages({ blocks: [figure('f', [src])] }), src).not.toEqual([]);
    const noAlt = { kind: 'figure', id: 'f', items: [{ src: 'a.png', alt: '' }] };
    expect(messages({ blocks: [noAlt] })).not.toEqual([]);
    const many = Array.from({ length: 13 }, (_, i) => `s${i}.png`);
    expect(messages({ blocks: [figure('f', many)] })).not.toEqual([]);
  });

  it('refuses bad steps: none, empty text, unknown fields', () => {
    expect(messages({ blocks: [{ kind: 'steps', id: 's', items: [] }] })).not.toEqual([]);
    expect(messages({ blocks: [{ kind: 'steps', id: 's', items: [{ text: '' }] }] })).not.toEqual(
      [],
    );
    expect(
      messages({ blocks: [{ kind: 'steps', id: 's', items: [{ text: 'x', run: 'ls' }] }] }),
    ).not.toEqual([]);
  });

  it('refuses a details or sheet without a summary, title or blocks, and too many tags or decisions', () => {
    expect(messages({ blocks: [{ ...details('d'), summary: '' }] })).not.toEqual([]);
    expect(messages({ blocks: [details('d', [])] })).not.toEqual([]);
    expect(messages({ blocks: [{ ...sheet('s'), title: '' }] })).not.toEqual([]);
    expect(messages({ blocks: [sheet('s', [])] })).not.toEqual([]);
    expect(
      messages({ blocks: [sheet('s', [text('a')], { tags: ['a', 'b', 'c', 'd', 'e'] })] }),
    ).not.toEqual([]);
    const six = ['1', '2', '3', '4', '5', '6'];
    expect(messages({ blocks: [sheet('s', [text('a')], { decisions: six })] })).not.toEqual([]);
  });

  it('keeps the nesting rules: columns hold leaves, no details in details, sheets at the top only', () => {
    // Leaves go in columns, details and sheets; columns in details and sheets; details in sheets.
    expect(
      messages({
        blocks: [
          cols('c', figure('f'), steps('s')),
          details('d', [figure('f2'), steps('s2'), cols('c2', text('x'))]),
          sheet('sh', [figure('f3'), cols('c3', steps('s3')), details('d3', [text('y')])]),
        ],
      }),
    ).toEqual([]);
    // Columns hold leaves only.
    expect(messages({ blocks: [cols('c', details('d'))] })).not.toEqual([]);
    expect(messages({ blocks: [cols('c', sheet('s'))] })).not.toEqual([]);
    // No details inside details.
    expect(messages({ blocks: [details('d', [details('d2')])] })).not.toEqual([]);
    // No sheet inside a sheet, details or columns.
    expect(messages({ blocks: [sheet('s', [sheet('s2')])] })).not.toEqual([]);
    expect(messages({ blocks: [details('d', [sheet('s2')])] })).not.toEqual([]);
    // Details inside a sheet hold no sheet or details either.
    expect(messages({ blocks: [sheet('s', [details('d', [sheet('s2')])])] })).not.toEqual([]);
    expect(messages({ blocks: [sheet('s', [details('d', [details('d2')])])] })).not.toEqual([]);
  });

  it('opens every container at depth: docBlocks and docLeaves in reading order', () => {
    const doc = ReportDoc.parse({
      blocks: [
        text('a'),
        sheet('sh', [
          text('b'),
          { kind: 'columns', id: 'c', columns: [[figure('f')], [steps('st')]] },
          details('d', [
            text('e'),
            { kind: 'columns', id: 'c2', columns: [[text('g')], [text('h')]] },
          ]),
        ]),
        details('d2', [text('i')]),
      ],
    });
    expect(docBlocks(doc.blocks).map((b) => b.id)).toEqual([
      'a',
      'sh',
      'b',
      'c',
      'f',
      'st',
      'd',
      'e',
      'c2',
      'g',
      'h',
      'd2',
      'i',
    ]);
    expect(docLeaves(doc.blocks).map((b) => b.id)).toEqual([
      'a',
      'b',
      'f',
      'st',
      'e',
      'g',
      'h',
      'i',
    ]);
  });

  it('refuses duplicate ids at any depth', () => {
    expect(messages({ blocks: [text('a'), sheet('s', [details('d', [text('a')])])] })).toContain(
      'Duplicate block id "a"',
    );
    expect(messages({ blocks: [sheet('s', [text('s')])] })).toContain('Duplicate block id "s"');
  });

  it('keeps to the limits: sheets, pictures in all, and blocks, drawings counted at depth', () => {
    const sheets = Array.from({ length: DOC_LIMITS.sheets + 1 }, (_, i) => sheet(`s${i}`));
    expect(messages({ blocks: sheets })).toContain(`At most ${DOC_LIMITS.sheets} sheets`);
    const figures = Array.from({ length: Math.ceil((DOC_LIMITS.figureItems + 1) / 12) }, (_, i) =>
      figure(
        `f${i}`,
        Array.from({ length: 12 }, (_, j) => `shots/${i}-${j}.png`),
      ),
    );
    expect(messages({ blocks: [sheet('s', figures)] })).toContain(
      `At most ${DOC_LIMITS.figureItems} pictures, clips and sounds`,
    );
    // Blocks inside sheets and details count toward the 200.
    const deep = Array.from({ length: 5 }, (_, i) =>
      sheet(`s${i}`, [
        details(
          `d${i}`,
          Array.from({ length: 40 }, (_, j) => text(`t${i}-${j}`)),
        ),
      ]),
    );
    expect(messages({ blocks: deep })).toContain(`At most ${DOC_LIMITS.blocks} blocks`);
    const drawings = Array.from({ length: DOC_LIMITS.drawings + 1 }, (_, i) => ({
      kind: 'drawing',
      id: `dr${i}`,
      html: '<p>x</p>',
      height: 100,
    }));
    expect(messages({ blocks: [details('d', drawings)] })).toContain(
      `At most ${DOC_LIMITS.drawings} drawings`,
    );
  });

  it('tells pictures, clips and sounds apart by their extension', () => {
    expect(figureMedia('shots/a.PNG')).toBe('image');
    expect(figureMedia('a.svg')).toBe('image');
    expect(figureMedia('rec/a.webm')).toBe('video');
    expect(figureMedia('voice.m4a')).toBe('audio');
    expect(figureMedia('a.wav')).toBe('audio');
    expect(figureMedia('a.js')).toBeUndefined();
    expect(figureMedia('noext')).toBeUndefined();
    expect(Object.values(FIGURE_MEDIA).flat()).toContain('mp3');
  });
});

describe('docReads with details and sheets (R15)', () => {
  it("finds components inside details and sheets, and reads a sheet's decisions", () => {
    const stat = {
      kind: 'block',
      id: 'st',
      node: { component: 'Stat', label: 'Stages', query: { type: 'stage' } },
    };
    const blocks = ReportDoc.parse({
      blocks: [
        sheet(
          'sh',
          [
            { kind: 'block', id: 'list', node: { component: 'TaskChecklist' } },
            details('d', [
              { kind: 'block', id: 'log', node: { component: 'DecisionLog' } },
              { kind: 'columns', id: 'c', columns: [[stat], [figure('f')]] },
            ]),
          ],
          { decisions: ['dec_0123456789ab', 'dec_fedcba987654'] },
        ),
      ],
    }).blocks;
    const reads = docReads({ blocks });
    expect(reads.queries.map((q) => q.type).sort()).toEqual(['decision', 'stage', 'task']);
    expect([...reads.ids].sort()).toEqual(['dec_0123456789ab', 'dec_fedcba987654']);
  });

  it('a sheet with a decision reads something even with no components; a figure alone reads nothing', () => {
    const asked = ReportDoc.parse({
      blocks: [sheet('sh', [figure('f'), steps('s')], { decisions: ['dec_0123456789ab'] })],
    });
    expect(readsNothing(docReads(asked))).toBe(false);
    expect(readsNothing(docReads(ReportDoc.parse({ blocks: [figure('f')] })))).toBe(true);
  });
});
