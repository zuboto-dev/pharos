import { docLeaves, type ReportDoc } from '@pharos/schema';

/**
 * What a reader-first report needs (PRODUCT's glance test, REVIEW.md), checked on every report
 * document an agent previews or saves, whichever agent wrote it: the claim leads, key numbers are
 * shown, headings are claims, no walls of text, links work wherever Pharos is hosted, and a
 * drawing's lines don't run through its words. Warnings with the fix in them: an agent that
 * follows them reaches the bar the owner set, not only the strongest model.
 */

const TOPIC_HEADINGS =
  /^(overview|summary|background|details|status|introduction|intro|context|notes?|next steps|conclusion|results?|findings|update|updates)$/i;
const LOCAL_LINK = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/[^\s)\]"'>]*)?/i;
const NUMBER_COMPONENTS = new Set([
  'Stat',
  'StatCards',
  'ProgressRing',
  'CountChart',
  'CategoryBreakdown',
  'FindingChart',
  'DataTable',
  'DueTracker',
]);
const PICTURE_COMPONENTS = new Set([
  'Gallery',
  'BeforeAfter',
  'Layers',
  'FindingChart',
  'CountChart',
]);
/** One paragraph longer than this is a wall of text. */
const PARAGRAPH_CHARS = 600;
/** This much prose with nothing to see is a pile of words. */
const PROSE_CHARS = 3500;

type Leaf = ReturnType<typeof docLeaves>[number];

const textOf = (b: Leaf): string | undefined => {
  if (b.kind !== 'block') return undefined;
  const node = b.node as { component: string; content?: unknown; body?: unknown };
  if (node.component === 'Text' || node.component === 'Markdown')
    return typeof node.content === 'string' ? node.content : undefined;
  if (node.component === 'Callout') return typeof node.body === 'string' ? node.body : undefined;
  return undefined;
};

export function readerChecks(doc: ReportDoc): string[] {
  const warnings: string[] = [];
  const leaves = docLeaves(doc.blocks);
  const first = leaves[0];
  const lead = first && textOf(first);
  if (!lead || !/^\s*#\s+\S/.test(lead))
    warnings.push(
      'Reader check: open with the claim as a "# " heading in a Text block (what is true now, in one line), then the key numbers',
    );

  let prose = 0;
  let seeable = false;
  let numbers = /\*\*[^*]*\d[^*]*\*\*/.test(lead ?? '');
  for (const b of leaves) {
    if (b.kind === 'figure' || b.kind === 'drawing' || b.kind === 'embed') seeable = true;
    if (b.kind === 'block') {
      const component = (b.node as { component: string }).component;
      if (NUMBER_COMPONENTS.has(component)) numbers = true;
      if (PICTURE_COMPONENTS.has(component)) seeable = true;
    }
    const text = textOf(b);
    if (text) {
      prose += text.length;
      for (const line of text.split('\n')) {
        const heading = /^#{2,3}\s+(.+)$/.exec(line.trim());
        if (heading && TOPIC_HEADINGS.test(heading[1]!.trim().replace(/[:.]$/, '')))
          warnings.push(
            `Reader check: block "${b.id}" has the heading "${heading[1]!.trim()}", a topic; write the claim it makes instead`,
          );
      }
      // Prose only: table rows, list items and headings are their own units.
      const long = text
        .split(/\n\s*\n/)
        .flatMap((p) =>
          /^\s*([|#>-]|\d+\.|\*\s)/m.test(p)
            ? p.split('\n').filter((l) => !/^\s*([|#]|-{3})/.test(l))
            : [p],
        )
        .find((p) => p.length > PARAGRAPH_CHARS);
      if (long)
        warnings.push(
          `Reader check: block "${b.id}" has a ${long.length}-character paragraph; cut it to a sentence or two, or move detail into a details block, a table or a picture`,
        );
      const local = LOCAL_LINK.exec(text);
      if (local)
        warnings.push(
          `Reader check: block "${b.id}" links to ${local[0].slice(0, 60)}, which breaks wherever Pharos is hosted; link to "${local[1] ?? '/'}" instead`,
        );
    }
    if (b.kind === 'drawing') warnings.push(...drawingOverlaps(b.id, b.html));
  }
  // A review desk leads with its asks; its header already counts them and their time.
  const desk = doc.blocks.some((b) => b.kind === 'sheet');
  if (!numbers && !desk)
    warnings.push(
      'Reader check: no key numbers: put 3–5 in the lead (bold) or as Stat/StatCards blocks, each with its source',
    );
  const wordy = wordOnlySections(doc);
  if (wordy.length)
    warnings.push(
      `Reader check: ${wordy.length === 1 ? 'section' : 'sections'} ${wordy
        .slice(0, 4)
        .map((h) => `"${h}"`)
        .join(', ')} ${wordy.length === 1 ? 'is' : 'are'} words only; show ${
        wordy.length === 1 ? 'it' : 'each'
      } with Stats or a chart, a table, a figure, or a drawing (interactive where the reader would explore)`,
    );
  if (prose > PROSE_CHARS && !seeable)
    warnings.push(
      `Reader check: ${prose} characters of text and nothing to see; show it with a chart, a table, a figure or a drawing`,
    );
  return warnings;
}

type Box = { x1: number; x2: number; y1: number; y2: number; label: string };

const num = (attrs: string, name: string, fallback = 0) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"(-?[\\d.]+)`).exec(attrs);
  return m ? Number(m[1]) : fallback;
};

/**
 * Horizontal and vertical lines in a drawing's SVG that run through a text label (a
 * diagram of 2026-10-21: connectors drawn across a box struck through its words). Reads simple
 * `<path d="M… H… V… L…">` and `<line>`; text boxes are estimated from x, y, size and anchor.
 */
export function drawingOverlaps(id: string, html: string): string[] {
  const texts: Box[] = [];
  const baseSize = num(/font[^;]*?(\d+)px/.exec(html)?.[0] ?? '', '', 16) || 16;
  const groupAnchor = /<g[^>]*text-anchor="middle"/.test(html);
  for (const m of html.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1]!;
    const label = m[2]!.trim();
    if (!label) continue;
    const size = num(attrs, 'font-size', baseSize);
    const x = num(attrs, 'x');
    const y = num(attrs, 'y');
    // An average glyph is about half the font size wide; err on the narrow side.
    const width = label.length * size * 0.48;
    const middle =
      /text-anchor="middle"/.test(attrs) || (groupAnchor && !/text-anchor=/.test(attrs));
    const x1 = middle ? x - width / 2 : /text-anchor="end"/.test(attrs) ? x - width : x;
    texts.push({ x1, x2: x1 + width, y1: y - size * 0.8, y2: y + size * 0.2, label });
  }
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const m of html.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) {
    let x = 0;
    let y = 0;
    for (const [, cmd, args] of m[1]!.matchAll(/([MLHV])\s*([-\d.,\s]+)/gi)) {
      const n = args!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const c = cmd!.toUpperCase();
      if (c === 'M') {
        [x, y] = [n[0]!, n[1]!];
      } else if (c === 'H') {
        segments.push({ x1: x, y1: y, x2: n[0]!, y2: y });
        x = n[0]!;
      } else if (c === 'V') {
        segments.push({ x1: x, y1: y, x2: x, y2: n[0]! });
        y = n[0]!;
      } else if (c === 'L') {
        // Only straight across or down: a slanted line's box would cover far more than the line.
        if (n[0] === x || n[1] === y) segments.push({ x1: x, y1: y, x2: n[0]!, y2: n[1]! });
        [x, y] = [n[0]!, n[1]!];
      }
    }
  }
  for (const m of html.matchAll(/<line\b([^>]*)>/g)) {
    const l = {
      x1: num(m[1]!, 'x1'),
      y1: num(m[1]!, 'y1'),
      x2: num(m[1]!, 'x2'),
      y2: num(m[1]!, 'y2'),
    };
    if (l.x1 === l.x2 || l.y1 === l.y2) segments.push(l);
  }
  const hits = new Set<string>();
  for (const s of segments) {
    const [lx, hx] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
    const [ly, hy] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
    for (const t of texts) if (lx < t.x2 && hx > t.x1 && ly < t.y2 && hy > t.y1) hits.add(t.label);
  }
  return hits.size
    ? [
        `Reader check: drawing "${id}" has lines running through its text (${[...hits]
          .slice(0, 3)
          .map((l) => `"${l}"`)
          .join(', ')}); route them around the labels or between the boxes`,
      ]
    : [];
}

/** Text that is itself something to see: a Markdown table. */
const TABLE = /^\s*\|.*\|\s*$\n^\s*\|?\s*:?-{3,}/m;

/**
 * The "## " sections of a document (outside review sheets, which hold asks) with nothing to see
 * before the next heading: only Text, Markdown and Callouts. The lead ("# ") is the claim and
 * its numbers, checked on its own.
 */
export function wordOnlySections(doc: ReportDoc): string[] {
  const out: string[] = [];
  let current: { heading: string; seen: boolean } | null = null;
  const close = () => {
    if (current && !current.seen) out.push(current.heading);
    current = null;
  };
  const visit = (b: {
    kind: string;
    node?: unknown;
    blocks?: unknown[];
    columns?: unknown[][];
  }) => {
    // A heading that introduces review sheets has them to look at.
    if (b.kind === 'sheet') {
      if (current) current.seen = true;
      return close();
    }
    if (b.kind === 'columns') return (b.columns ?? []).flat().forEach((c) => visit(c as never));
    if (b.kind === 'details') return;
    if (b.kind === 'block') {
      const node = b.node as { component: string; content?: unknown };
      const text =
        node.component === 'Text' || node.component === 'Markdown'
          ? typeof node.content === 'string'
            ? node.content
            : ''
          : undefined;
      if (node.component === 'Callout') return;
      if (text !== undefined) {
        for (const line of text.split('\n')) {
          const h = /^##\s+(.+)$/.exec(line.trim());
          if (h) {
            close();
            const heading = h[1]!.trim();
            // A number set as a heading ("## 10 / 10") is a stat card itself.
            const stat = heading.length <= 16 && /\d/.test(heading) && !/[a-z]{4,}/i.test(heading);
            current = { heading: heading.slice(0, 60), seen: stat };
          }
        }
        if (current && TABLE.test(text)) current.seen = true;
        return;
      }
    }
    if (current) current.seen = true;
  };
  for (const b of doc.blocks) visit(b as never);
  close();
  return out;
}
