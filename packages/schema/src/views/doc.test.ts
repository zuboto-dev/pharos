import { describe, expect, it } from 'vitest';
import { DOC_LIMITS, ReportDoc, docLeaves, type DocBlock } from './doc.js';
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
