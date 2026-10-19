import { z } from 'zod';
import { ViewNode } from './catalog.js';
import { REPORT_LIMITS, ReportRead } from './report.js';

/**
 * Report documents (R14): a report Pharos draws itself. The agent writes structure (blocks in
 * reading order); Pharos lays it out as a document in its own style, so any agent gets a good
 * page. One-off visuals go in a `drawing` block (agent HTML in the locked report frame, one
 * section only) and other sites in an `embed` block. docs/reframe/r14-report-documents.md has
 * the contract.
 */
export const DOC_LIMITS = {
  blocks: 200,
  drawingChars: 300_000,
  drawings: 12,
  embeds: 6,
} as const;

const BlockId = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
  .describe('Stable id, unique within the document');

const ReadName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);

const width = z
  .enum(['text', 'wide', 'full'])
  .optional()
  .describe(
    'text: the reading column (default for text); wide: a wider band for charts and tables (default for other blocks); full: the whole page width',
  );

/** Any catalog component as a block: Text (markdown with live values), Callout, Stat, charts… */
export const DocNodeBlock = z.strictObject({
  kind: z.literal('block'),
  id: BlockId,
  width,
  node: ViewNode,
});

/** Agent HTML for one section, drawn in the locked report frame (no network, no popups). */
export const DocDrawingBlock = z.strictObject({
  kind: z.literal('drawing'),
  id: BlockId,
  width,
  html: z
    .string()
    .min(1)
    .max(DOC_LIMITS.drawingChars)
    .describe('An HTML document for this section only; pharos.data(name) gives the reads listed'),
  reads: z
    .array(ReadName)
    .max(REPORT_LIMITS.reads)
    .optional()
    .describe("Names from the document's `data` this drawing may read"),
  height: z.number().int().min(80).max(2000).describe('Height in pixels'),
  caption: z.string().max(300).optional(),
});

/** Another website shown in place, e.g. a reference page; it opens in the browser too. */
export const DocEmbedBlock = z.strictObject({
  kind: z.literal('embed'),
  id: BlockId,
  width,
  url: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .describe(
      'An https address; many sites refuse to be shown inside others, so a link is always shown',
    ),
  height: z.number().int().min(120).max(2000).optional().describe('Height in pixels (default 480)'),
  caption: z.string().max(300).optional(),
});

export const DocLeafBlock = z.discriminatedUnion('kind', [
  DocNodeBlock,
  DocDrawingBlock,
  DocEmbedBlock,
]);
export type DocLeafBlock = z.infer<typeof DocLeafBlock>;

/** Blocks side by side; each column is a list of blocks in reading order (no nested columns). */
export const DocColumnsBlock = z.strictObject({
  kind: z.literal('columns'),
  id: BlockId,
  width,
  widths: z
    .array(z.number().int().min(1).max(12))
    .optional()
    .describe('Share of each column out of their total, e.g. [2, 1]; default equal'),
  columns: z.array(z.array(DocLeafBlock).max(20)).min(2).max(4),
});

export const DocBlock = z.discriminatedUnion('kind', [
  DocNodeBlock,
  DocDrawingBlock,
  DocEmbedBlock,
  DocColumnsBlock,
]);
export type DocBlock = z.infer<typeof DocBlock>;

/** Every block in reading order, columns opened up. */
export function docLeaves(blocks: DocBlock[]): DocLeafBlock[] {
  return blocks.flatMap((b) => (b.kind === 'columns' ? b.columns.flat() : [b]));
}

export const ReportDoc = z
  .strictObject({
    blocks: z.array(DocBlock).min(1),
    data: z
      .record(ReadName, ReportRead)
      .refine((d) => Object.keys(d).length <= REPORT_LIMITS.reads, {
        message: `At most ${REPORT_LIMITS.reads} named reads`,
      })
      .optional()
      .describe('Named reads that drawing blocks get live through pharos.data(name)'),
    summary: z.string().max(400).optional().describe('One or two sentences: what the report says'),
  })
  .superRefine((doc, ctx) => {
    const all = [...doc.blocks, ...docLeaves(doc.blocks).filter((b) => !doc.blocks.includes(b))];
    if (all.length > DOC_LIMITS.blocks)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.blocks} blocks`,
        path: ['blocks'],
      });
    const seen = new Set<string>();
    for (const b of all) {
      if (seen.has(b.id))
        ctx.addIssue({ code: 'custom', message: `Duplicate block id "${b.id}"`, path: ['blocks'] });
      seen.add(b.id);
    }
    const leaves = docLeaves(doc.blocks);
    const drawings = leaves.filter((b) => b.kind === 'drawing');
    if (drawings.length > DOC_LIMITS.drawings)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.drawings} drawings`,
        path: ['blocks'],
      });
    if (leaves.filter((b) => b.kind === 'embed').length > DOC_LIMITS.embeds)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.embeds} embeds`,
        path: ['blocks'],
      });
    for (const d of drawings)
      for (const name of d.reads ?? [])
        if (!doc.data?.[name])
          ctx.addIssue({
            code: 'custom',
            message: `Drawing "${d.id}" reads "${name}", which is not in data`,
            path: ['data'],
          });
  });
export type ReportDoc = z.infer<typeof ReportDoc>;
