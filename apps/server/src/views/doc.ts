import {
  REPORT_ASSET_TYPES,
  ReportAssetPath,
  ReportDoc,
  checkReadQueries,
  decisionState,
  docLeaves,
  docReads,
  figureMedia,
  readsNothing,
  runQuery,
  sheetTasks,
  type Board,
  type DocBlock,
  type DocLeafBlock,
  type Entity,
} from '@pharos/schema';
import { AgentFiles } from '../store/agent-files.js';
import { PharosError, formatPath } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { previewBoard } from './preview.js';
import { readerChecks } from './reader-checks.js';
import {
  ReportAssets,
  blockedExternals,
  formatReadFinding,
  navigationWarnings,
  referencedPaths,
} from './report.js';

/**
 * Report documents (R14): blocks in reading order that Pharos draws in its own style. The checks
 * an agent sees before the reader does, and the lookups the routes use.
 * docs/reframe/r14-report-documents.md has the contract.
 */

export type DrawingBlock = Extract<DocLeafBlock, { kind: 'drawing' }>;
export type EmbedBlock = Extract<DocLeafBlock, { kind: 'embed' }>;
export type FigureBlock = Extract<DocLeafBlock, { kind: 'figure' }>;
export type SheetBlock = Extract<DocBlock, { kind: 'sheet' }>;

/**
 * The same blocks with each leaf replaced by what `leaf` returns (none, to drop it), inside
 * columns, details and sheets too (R15).
 */
export function mapDocLeaves(
  blocks: DocBlock[],
  leaf: (b: DocLeafBlock) => DocLeafBlock[],
): DocBlock[] {
  return blocks.flatMap((b): DocBlock[] => {
    if (b.kind === 'columns') return [{ ...b, columns: b.columns.map((c) => c.flatMap(leaf)) }];
    if (b.kind === 'details' || b.kind === 'sheet')
      return [{ ...b, blocks: mapDocLeaves(b.blocks as DocBlock[], leaf) } as DocBlock];
    return leaf(b);
  });
}

/** The document of a view, or null for a board or a report page. */
export function docOf(view: Entity<'view'>): ReportDoc | null {
  return view.data.doc ?? null;
}

/** A block of a view's document by id (inside columns too), or null. */
export function docBlock(view: Entity<'view'>, blockId: string): DocLeafBlock | null {
  const doc = docOf(view);
  return doc ? (docLeaves(doc.blocks).find((b) => b.id === blockId) ?? null) : null;
}

export function parseDoc(doc: unknown): ReportDoc {
  const result = ReportDoc.safeParse(doc);
  if (!result.success) {
    throw new PharosError(
      'invalid',
      'Invalid doc',
      result.error.issues.map(
        (i) => `doc${i.path.length ? `.${formatPath(i.path)}` : ''}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

/** The node blocks of a document as a board, so the board's checks and previews apply to them. */
export function docBoard(doc: ReportDoc): Board {
  return {
    component: 'Board',
    widgets: docLeaves(doc.blocks).flatMap((b) =>
      b.kind === 'block' ? [{ id: b.id, node: b.node }] : [],
    ),
  };
}

/** Whether a document reads nothing from the project (nothing could mark it out of date). */
export function docReadsNothing(doc: ReportDoc): boolean {
  return readsNothing(docReads(doc));
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A draft document for view_preview: embeds that are not https and drawing reads missing from
 * `data` become warnings (the save refuses them) and are set aside, so the rest still gets
 * checked. Anything else wrong is refused as on save.
 */
export function lenientDoc(raw: unknown): { doc: ReportDoc; warnings: string[] } {
  const warnings: string[] = [];
  if (!isObject(raw) || !Array.isArray(raw.blocks)) return { doc: parseDoc(raw), warnings };
  const names = new Set(isObject(raw.data) ? Object.keys(raw.data) : []);
  const leaf = (block: unknown): unknown[] => {
    if (!isObject(block)) return [block];
    if (
      block.kind === 'embed' &&
      typeof block.url === 'string' &&
      !/^https:\/\//i.test(block.url)
    ) {
      warnings.push(
        `Embed "${String(block.id)}" (${block.url.slice(0, 120)}) is not https: only https sites can be shown; the save refuses it`,
      );
      return [];
    }
    if (block.kind === 'drawing' && Array.isArray(block.reads)) {
      const missing = block.reads.filter((n) => typeof n === 'string' && !names.has(n));
      for (const name of missing)
        warnings.push(
          `Drawing "${String(block.id)}" reads "${String(name)}", which is not in doc.data: add it there (the save refuses it)`,
        );
      if (missing.length)
        return [{ ...block, reads: block.reads.filter((n) => !missing.includes(n)) }];
    }
    return [block];
  };
  // Inside columns, details and sheets too (R15); the schema refuses wrong nesting after.
  const walk = (list: unknown[]): unknown[] =>
    list.flatMap((block) => {
      if (isObject(block) && block.kind === 'columns' && Array.isArray(block.columns))
        return [
          {
            ...block,
            columns: block.columns.map((col) => (Array.isArray(col) ? col.flatMap(leaf) : col)),
          },
        ];
      if (
        isObject(block) &&
        (block.kind === 'details' || block.kind === 'sheet') &&
        Array.isArray(block.blocks)
      )
        return [{ ...block, blocks: walk(block.blocks) }];
      return leaf(block);
    });
  return { doc: parseDoc({ ...raw, blocks: walk(raw.blocks) }), warnings };
}

/** The checks of one drawing: its files, hosts the frame blocks, navigation, and its reads. */
function drawingWarnings(drawing: DrawingBlock, have: Set<string>, saved: boolean): string[] {
  const out: string[] = [];
  for (const path of referencedPaths(drawing.html)) {
    if (have.has(path)) continue;
    out.push(
      ReportAssetPath.safeParse(path).success
        ? `it refers to "${path}", which isn't an asset of this view yet: upload it with report_asset_put${saved ? '' : ' after saving'}`
        : `it refers to "${path}", which can't be an asset (relative path, no "..", file types ${Object.keys(REPORT_ASSET_TYPES).join(' ')}): it won't load`,
    );
  }
  out.push(...blockedExternals(drawing.html), ...navigationWarnings(drawing.html));
  const listed = new Set(drawing.reads ?? []);
  const used = new Set<string>();
  for (const m of drawing.html.matchAll(/pharos\.data\(\s*["'`]([^"'`]+)["'`]\s*\)/g))
    used.add(m[1]!);
  for (const name of used)
    if (!listed.has(name))
      out.push(
        `it asks pharos.data("${name}"), which isn't in its reads: list it there (and in doc.data), or the drawing gets no rows`,
      );
  for (const name of listed)
    if (!used.has(name) && !drawing.html.includes(name))
      out.push(`it lists the read "${name}" but never uses it`);
  if (!/data-theme|prefers-color-scheme|pharos\.theme|onTheme/.test(drawing.html))
    out.push(
      'no dark colours: use colour tokens on :root with a dark set under [data-theme=dark] (the document has a dark mode)',
    );
  return out.map((w) => `Drawing "${drawing.id}": ${w}`);
}

/** Sheets (R15) at the top of a document, in reading order. */
export function docSheets(doc: ReportDoc): SheetBlock[] {
  return doc.blocks.filter((b): b is SheetBlock => b.kind === 'sheet');
}

/** The leaves of one sheet (inside its columns and details too). */
const sheetLeaves = (sheet: SheetBlock) => docLeaves(sheet.blocks as DocBlock[]);

const isPicture = (src: string) => figureMedia(src) === 'image';

/** Whether an entity is a decision of this project. */
const isDecisionOf = (found: Entity | null, projectId: string): found is Entity<'decision'> =>
  found?.type === 'decision' && (found as Entity<'decision'>).data.projectId === projectId;

/**
 * The review-desk checks (R15): figure files not uploaded yet, compare figures that aren't two
 * pictures, sheet decisions that aren't in the project, have no options or aren't shown in their
 * sheet, and sheets with no time on any of them.
 */
function reviewWarnings(
  store: Store,
  projectId: string,
  doc: ReportDoc,
  have: Set<string>,
  saved: boolean,
): string[] {
  const out: string[] = [];
  const figures = docLeaves(doc.blocks).filter((b): b is FigureBlock => b.kind === 'figure');
  for (const f of figures) {
    const missing = [...new Set(f.items.map((i) => i.src).filter((src) => !have.has(src)))];
    if (missing.length)
      out.push(
        `Figure "${f.id}": ${missing.map((m) => `"${m}"`).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} uploaded yet: upload ${missing.length === 1 ? 'it' : 'them'} with report_asset_put${saved ? '' : ' after saving'}, then preview again`,
      );
    if (f.layout === 'compare' && (f.items.length !== 2 || !f.items.every((i) => isPicture(i.src))))
      out.push(
        `Figure "${f.id}": a compare figure needs exactly two pictures of the same size (it has ${f.items.length} item${f.items.length === 1 ? '' : 's'}${f.items.every((i) => isPicture(i.src)) ? '' : ', not all pictures'}); use pair or grid otherwise`,
      );
  }
  const sheets = docSheets(doc);
  for (const sheet of sheets) {
    const shown = new Set(
      sheetLeaves(sheet).flatMap((b) =>
        b.kind === 'block' && b.node.component === 'DecisionBlock' ? [b.node.decision] : [],
      ),
    );
    for (const id of sheet.decisions ?? []) {
      const found = store.get(id);
      const at = `Sheet "${sheet.id}": decision "${id}"`;
      if (!isDecisionOf(found, projectId)) {
        out.push(
          `${at} isn't a decision in this project: create it (with options) first, or remove it from decisions`,
        );
        continue;
      }
      const decision = found as Entity<'decision'>;
      if (!decision.data.options?.length)
        out.push(
          `${at} ("${decision.data.title}") has no options: give it 2–5 options so the reader can answer`,
        );
      if (!shown.has(id))
        out.push(
          `${at} has no DecisionBlock inside this sheet: add {"kind": "block", "id": …, "node": {"component": "DecisionBlock", "decision": "${id}"}} to its blocks so the reader can answer there`,
        );
    }
  }
  if (sheets.length && !sheets.some((s) => s.time))
    out.push(
      'No sheet has a time: give each sheet a time ("5 min") so the reader knows how long the review takes',
    );
  return out;
}

/** Where a sheet's decision stands, for agents reading the owner's answers (R15). */
export type SheetDecision = {
  id: string;
  title?: string;
  /** missing: not a decision in this project. */
  state: 'chosen' | 'answered' | 'deferred' | 'open' | 'missing';
  /** The option chosen: its id and label. */
  chosen?: { id: string; label: string };
  /** The owner's note with that choice, in their words. */
  note?: string;
  /** The owner's own answer, in their words. */
  answer?: string;
  /** Decide later: the day it comes back. */
  deferredUntil?: string;
  decidedOn?: string;
};

export type SheetSummary = {
  id: string;
  title: string;
  time?: string;
  tags?: string[];
  /**
   * Open until each decision has a choice or an answer and each checklist task is finished (done
   * or cancelled); none for a sheet with neither.
   */
  state?: 'open' | 'answered';
  decisions: SheetDecision[];
  /** Tasks its TaskChecklists show, with their status (the reader ticks them). */
  tasks?: { id: string; title: string; status: string; done: boolean }[];
};

/**
 * Each sheet of a document with its state and the owner's answers (R15), so an agent reads them
 * in one call (view_get). A sheet is answered once each of its decisions has a choice or an
 * answer and each task its TaskChecklists show is done; a deferral keeps it open.
 */
export function sheetSummaries(store: Store, projectId: string, doc: ReportDoc): SheetSummary[] {
  const sheets = docSheets(doc);
  if (!sheets.length) return [];
  const data = new AgentFiles(store).dataset(store.dataset(projectId));
  return sheets.map((sheet) => {
    const decisions = (sheet.decisions ?? []).map((id): SheetDecision => {
      const found = store.get(id);
      if (!isDecisionOf(found, projectId)) return { id, state: 'missing' };
      const d = (found as Entity<'decision'>).data;
      const state = decisionState(d);
      return {
        id,
        title: d.title,
        state: state.kind,
        ...(state.kind === 'chosen'
          ? {
              chosen: { id: state.option.id, label: state.option.label },
              ...(state.note ? { note: state.note } : {}),
            }
          : {}),
        ...(state.kind === 'answered' ? { answer: state.answer } : {}),
        ...(state.kind === 'deferred' ? { deferredUntil: state.until } : {}),
        ...((state.kind === 'chosen' || state.kind === 'answered') && d.decisionDate
          ? { decidedOn: d.decisionDate }
          : {}),
      };
    });
    const hasChecklist = sheetLeaves(sheet).some(
      (b) => b.kind === 'block' && b.node.component === 'TaskChecklist',
    );
    const shown = sheetTasks(data, sheet as { blocks: DocBlock[] });
    const tasks = shown.map(({ task, done }) => ({
      id: task.id,
      title: task.data.title,
      status: task.data.status,
      done,
    }));
    return {
      id: sheet.id,
      title: sheet.title,
      ...(sheet.time ? { time: sheet.time } : {}),
      ...(sheet.tags?.length ? { tags: sheet.tags } : {}),
      ...(decisions.length || tasks.length
        ? {
            state:
              decisions.every((d) => d.state === 'chosen' || d.state === 'answered') &&
              shown.every((t) => t.finished)
                ? ('answered' as const)
                : ('open' as const),
          }
        : {}),
      decisions,
      ...(hasChecklist ? { tasks: tasks.slice(0, 50) } : {}),
    };
  });
}

/**
 * What an agent should check on a document before the reader sees it: what each component shows
 * now (the board preview of its blocks, with the same query findings), each drawing's checks, its
 * embeds and its named reads. `extra` carries the draft warnings of lenientDoc.
 */
export function previewDoc(
  store: Store,
  projectId: string,
  doc: ReportDoc,
  viewId?: string,
  extra: string[] = [],
) {
  const board = previewBoard(store, projectId, docBoard(doc));
  const data = new AgentFiles(store).dataset(store.dataset(projectId));
  const readFindings = checkReadQueries(doc.data, data.project);
  const reads = Object.entries(doc.data ?? {}).map(([name, read]) => {
    let rows: number | undefined;
    try {
      rows = runQuery(data, read.type, read.filter ?? {}).length;
    } catch {
      rows = undefined;
    }
    return {
      name,
      type: read.type,
      ...(rows !== undefined ? { rows } : {}),
      ...(rows === 0 ? { empty: true } : {}),
      warnings: readFindings.filter((f) => f.widget === name).map(formatReadFinding),
    };
  });
  const leaves = docLeaves(doc.blocks);
  const drawings = leaves.filter((b): b is DrawingBlock => b.kind === 'drawing');
  const embeds = leaves.filter((b): b is EmbedBlock => b.kind === 'embed');
  const assets = viewId ? new ReportAssets(store).list(viewId) : [];
  const have = new Set(assets.map((a) => a.path));
  const warnings = [...extra];
  if (!doc.summary)
    warnings.push(
      'No summary: add one or two sentences saying what the document says (shown in lists)',
    );
  const drawingChecks = drawings.map((d) => ({
    id: d.id,
    chars: d.html.length,
    height: d.height,
    reads: d.reads ?? [],
    warnings: drawingWarnings(d, have, !!viewId),
  }));
  warnings.push(...drawingChecks.flatMap((d) => d.warnings));
  warnings.push(...reviewWarnings(store, projectId, doc, have, !!viewId));
  // The reader's bar, whichever agent wrote it (REVIEW.md, PRODUCT's glance test).
  warnings.push(...readerChecks(doc));
  const readByDrawings = new Set(drawings.flatMap((d) => d.reads ?? []));
  for (const name of Object.keys(doc.data ?? {}))
    if (!readByDrawings.has(name))
      warnings.push(
        `The named read "${name}" isn't listed by any drawing: doc.data is for drawings (components read with their own queries)`,
      );
  for (const r of reads) warnings.push(...r.warnings);
  if (!board.widgets.length)
    warnings.push(
      'No component blocks: a document tells its story in Text, Callout, Stat and chart blocks; drawings are for one visual each',
    );
  const widgetWarnings = board.widgets.reduce((n, w) => n + w.warnings.length, 0);
  const empty = board.widgets.filter((w) => w.empty).map((w) => w.id);
  const rejects = [...board.findings, ...readFindings].filter((f) => f.level === 'reject').length;
  const sheetCount = docSheets(doc).length;
  const figureCount = leaves.filter((b) => b.kind === 'figure').length;
  return {
    kind: 'report document' as const,
    widgets: board.widgets,
    layout: [] as string[],
    warnings,
    findings: [...board.findings, ...readFindings],
    blocks: leaves.length,
    drawings: drawingChecks,
    embeds: embeds.map((e) => ({ id: e.id, url: e.url, origin: new URL(e.url).origin })),
    figures: leaves
      .filter((b): b is FigureBlock => b.kind === 'figure')
      .map((f) => ({
        id: f.id,
        layout:
          f.layout ?? (f.items.length === 1 ? 'single' : f.items.length === 2 ? 'pair' : 'grid'),
        items: f.items.map((i) => ({
          src: i.src,
          media: figureMedia(i.src),
          uploaded: have.has(i.src),
        })),
      })),
    sheets: docSheets(doc).map((sh) => ({
      id: sh.id,
      title: sh.title,
      ...(sh.time ? { time: sh.time } : {}),
      decisions: sh.decisions ?? [],
    })),
    reads,
    assets: { count: assets.length, bytes: assets.reduce((n, a) => n + a.size, 0) },
    summary:
      `report document, ${leaves.length} block${leaves.length === 1 ? '' : 's'} (${board.widgets.length} component${board.widgets.length === 1 ? '' : 's'}, ${drawings.length} drawing${drawings.length === 1 ? '' : 's'}, ${embeds.length} embed${embeds.length === 1 ? '' : 's'})` +
      (sheetCount ? `, ${sheetCount} sheet${sheetCount === 1 ? '' : 's'}` : '') +
      (figureCount ? `, ${figureCount} figure${figureCount === 1 ? '' : 's'}` : '') +
      (empty.length ? `; ${empty.length} show an empty state (${empty.join(', ')})` : '') +
      (rejects
        ? `; ${rejects} query problem${rejects === 1 ? '' : 's'} would refuse the save`
        : '') +
      (warnings.length || widgetWarnings ? '; see warnings' : ''),
  };
}

/** Every warning of a document preview, the per-block ones included (for agents and the eval). */
export function allDocWarnings(preview: ReturnType<typeof previewDoc>): string[] {
  return [
    ...preview.warnings,
    ...preview.widgets.flatMap((w) => w.warnings.map((x) => `Block "${w.id}": ${x}`)),
  ];
}
