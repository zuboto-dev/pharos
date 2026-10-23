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
  figureItems: 80,
  sheets: 20,
  diffChars: 200_000,
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
  caption: z
    .string()
    .max(300)
    .optional()
    .describe('Markdown under the drawing, e.g. "**Before.**"'),
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

/** Report asset paths a figure may show, by what they are (R15). */
export const FIGURE_MEDIA = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'],
  video: ['mp4', 'webm'],
  audio: ['mp3', 'm4a', 'ogg', 'wav'],
} as const;

/** What a figure item is, from its file extension. */
export function figureMedia(src: string): keyof typeof FIGURE_MEDIA | undefined {
  const ext = (src.split('.').pop() ?? '').toLowerCase();
  for (const [kind, exts] of Object.entries(FIGURE_MEDIA))
    if ((exts as readonly string[]).includes(ext)) return kind as keyof typeof FIGURE_MEDIA;
  return undefined;
}

const AssetSrc = z
  .string()
  .max(200)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/)
  .refine((p) => figureMedia(p) !== undefined, {
    message: `A picture, video or sound: ${Object.values(FIGURE_MEDIA).flat().join(', ')}`,
  })
  .describe('Path of a file uploaded to this view with report_asset_put, e.g. "shots/offline.png"');

/**
 * Pictures, clips or sounds the agent uploaded (R15): screenshots before and after, a phone
 * shot, a recording to listen to. Pictures open full size when clicked.
 */
export const DocFigureBlock = z.strictObject({
  kind: z.literal('figure'),
  id: BlockId,
  width,
  layout: z
    .enum(['single', 'pair', 'grid', 'phone', 'compare'])
    .optional()
    .describe(
      'single (default for one item); pair (two side by side, e.g. before and after); grid (three or more); phone (narrow phone-sized shots side by side); compare (two pictures of the same size with a slider between them)',
    ),
  items: z
    .array(
      z.strictObject({
        src: AssetSrc,
        alt: z.string().min(1).max(300).describe('What the picture shows, for screen readers'),
        caption: z
          .string()
          .max(400)
          .optional()
          .describe('Markdown under the item, e.g. "**Before.** The list scrolled sideways."'),
      }),
    )
    .min(1)
    .max(12),
  caption: z.string().max(600).optional().describe('Markdown under the whole figure'),
});

/** Numbered steps the reader follows; a step can carry a command with a copy button (R15). */
export const DocStepsBlock = z.strictObject({
  kind: z.literal('steps'),
  id: BlockId,
  width,
  title: z.string().max(200).optional(),
  items: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(2000).describe('Markdown: what to do'),
        command: z
          .string()
          .max(2000)
          .optional()
          .describe('A command to paste in a terminal, shown with a copy button'),
        expect: z
          .string()
          .max(600)
          .optional()
          .describe('Markdown: what the reader should see when it worked'),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * A code change shown as a diff: one card per file, removed and added lines marked, the words
 * changed inside an edited line marked too. For "what changed" in an update or a review of code.
 */
export const DocDiffBlock = z.strictObject({
  kind: z.literal('diff'),
  id: BlockId,
  width,
  title: z.string().max(200).optional(),
  ref: z
    .string()
    .max(60)
    .optional()
    .describe('What it compares, e.g. "main..feat/notifications" or a commit "9f983f5"'),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(300).describe('The file, e.g. "apps/web/src/Bell.tsx"'),
        patch: z
          .string()
          .min(1)
          .max(40_000)
          .describe(
            'Its change in unified diff form: `git diff` output for this file (the "diff --git", "---" and "+++" lines may stay; hunks start at "@@"). Keep only the hunks that tell the story',
          ),
        note: z.string().max(400).optional().describe('Markdown: why this file changed'),
      }),
    )
    .min(1)
    .max(20),
  caption: z.string().max(600).optional().describe('Markdown under the whole diff'),
});

export const DocLeafBlock = z.discriminatedUnion('kind', [
  DocNodeBlock,
  DocDrawingBlock,
  DocEmbedBlock,
  DocFigureBlock,
  DocStepsBlock,
  DocDiffBlock,
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

/** Closed by default: the reasoning, the full list, the raw numbers (R15). */
export const DocDetailsBlock = z.strictObject({
  kind: z.literal('details'),
  id: BlockId,
  width,
  summary: z.string().min(1).max(200).describe('The line the reader clicks to open it'),
  open: z.boolean().optional().describe('Open at first (default closed)'),
  blocks: z
    .array(z.discriminatedUnion('kind', [...DocLeafBlock.options, DocColumnsBlock]))
    .min(1)
    .max(40),
});

/**
 * One thing for the reader to review or act on (R15): a titled sheet with its time, its
 * pictures, how to check it and the answer. When it names decisions, its state comes from them
 * (answered once each has a choice or an answer), and the document shows a list of sheets with
 * progress at the top.
 */
export const DocSheetBlock = z.strictObject({
  kind: z.literal('sheet'),
  id: BlockId,
  width,
  title: z.string().min(1).max(200),
  time: z.string().max(40).optional().describe('How long it takes the reader, e.g. "10 min"'),
  tags: z.array(z.string().min(1).max(40)).max(4).optional().describe('e.g. ["review"]'),
  decisions: z
    .array(z.string().min(1))
    .max(5)
    .optional()
    .describe(
      'Ids of decisions with options this sheet asks the reader to answer (show each with a DecisionBlock inside); the sheet counts as answered once all have an answer',
    ),
  related: z
    .array(z.string().min(1))
    .max(6)
    .optional()
    .describe(
      'Ids of earlier decisions, tasks or views this sheet follows up on (e.g. the decision it builds on); shown as links under its title',
    ),
  shows: z
    .array(BlockId)
    .max(12)
    .optional()
    .describe(
      'Ids of figure or drawing blocks elsewhere in the document that this sheet asks about: shown as thumbnails inside the sheet, above its decision, so the reader never scrolls back to find them',
    ),
  blocks: z
    .array(
      z.discriminatedUnion('kind', [...DocLeafBlock.options, DocColumnsBlock, DocDetailsBlock]),
    )
    .min(1)
    .max(60),
});

export const DocBlock = z.discriminatedUnion('kind', [
  ...DocLeafBlock.options,
  DocColumnsBlock,
  DocDetailsBlock,
  DocSheetBlock,
]);
export type DocBlock = z.infer<typeof DocBlock>;

type AnyDocBlock = DocBlock;

/** Every block at every depth, containers included, in reading order. */
export function docBlocks(blocks: AnyDocBlock[]): AnyDocBlock[] {
  return blocks.flatMap((b): AnyDocBlock[] => {
    if (b.kind === 'columns') return [b, ...b.columns.flat()];
    if (b.kind === 'details' || b.kind === 'sheet')
      return [b, ...docBlocks(b.blocks as AnyDocBlock[])];
    return [b];
  });
}

/** Every leaf block in reading order, containers opened up. */
export function docLeaves(blocks: AnyDocBlock[]): DocLeafBlock[] {
  return docBlocks(blocks).filter(
    (b): b is DocLeafBlock => b.kind !== 'columns' && b.kind !== 'details' && b.kind !== 'sheet',
  );
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
    const all = docBlocks(doc.blocks);
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
    const items = leaves.reduce((n, b) => n + (b.kind === 'figure' ? b.items.length : 0), 0);
    if (items > DOC_LIMITS.figureItems)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.figureItems} pictures, clips and sounds`,
        path: ['blocks'],
      });
    if (doc.blocks.filter((b) => b.kind === 'sheet').length > DOC_LIMITS.sheets)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.sheets} sheets`,
        path: ['blocks'],
      });
    const diffChars = leaves.reduce(
      (n, b) => n + (b.kind === 'diff' ? b.files.reduce((m, f) => m + f.patch.length, 0) : 0),
      0,
    );
    if (diffChars > DOC_LIMITS.diffChars)
      ctx.addIssue({
        code: 'custom',
        message: `At most ${DOC_LIMITS.diffChars} characters of diffs: keep the hunks that tell the story`,
        path: ['blocks'],
      });
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
    const visual = new Set(
      leaves.filter((b) => b.kind === 'figure' || b.kind === 'drawing').map((b) => b.id),
    );
    for (const b of all)
      for (const id of b.kind === 'sheet' ? (b.shows ?? []) : [])
        if (!visual.has(id))
          ctx.addIssue({
            code: 'custom',
            message: `Sheet "${b.id}" shows "${id}", which is not a figure or drawing block in this document`,
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
