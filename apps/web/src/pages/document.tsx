import {
  docLeaves,
  type BlockChange,
  type DiffPart,
  type DocComparison,
  type DocBlock,
  type DocLeafBlock,
  type Entity,
  type Widget,
} from '@pharos/schema';
import clsx from 'clsx';
import { ArrowUpRight, CircleCheck, ExternalLink, Minus, PenLine, Plus } from 'lucide-react';
import { Link } from 'react-router';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BoardActionsProvider } from '../catalog/action-board';
import { BoardFilesProvider, WidgetIdProvider } from '../catalog/board-files';
import { Node } from '../catalog/renderer';
import { Loading, SkeletonShape } from '../catalog/skeleton';
import { VariantProvider } from '../catalog/variant';
import { FileViewerProvider } from '../files/FileViewer';
import {
  FrameStopped,
  FrameUnavailable,
  LinkConfirm,
  REPORT_SANDBOX,
  useAssetReloads,
  useBridgeFrame,
  type FrameReads,
} from './frame-bridge';
import {
  FigureView,
  figureLayout,
  ReviewDeskHeader,
  SheetHead,
  StepsView,
  deskSheets,
  sheetAnchor,
  sheetState,
  SheetRelated,
  useSheetAnsweredAt,
  useDecisions,
  useSheetTasks,
  type Sheet,
} from './document-rich';
import { DiffView } from './document-diff';
import { MediaPanel, SheetShows } from './document-media';
import { Markdown } from '../catalog/ui';
import { HandBackPrompt } from './hand-back';

// Report documents (R14, docs/reframe/r14-report-documents.md): blocks in reading order that
// Pharos lays out as an article in its own style. Components come from the board renderer with
// live data, drawn plain under the `document` variant (no cards, title bars, handles or grid);
// drawings are agent HTML in the locked report frame; embeds show another site in place.

type Drawing = Extract<DocLeafBlock, { kind: 'drawing' }>;
type Embed = Extract<DocLeafBlock, { kind: 'embed' }>;
type Columns = Extract<DocBlock, { kind: 'columns' }>;
type Details = Extract<DocBlock, { kind: 'details' }>;
export type DocWidth = 'text' | 'wide' | 'full';

/** Whether a view is a report document. */
export const isDocument = (view: Entity<'view'> | undefined): boolean => Boolean(view?.data.doc);

/** Components that are text: they sit in the reading column unless the block says otherwise. */
const TEXT_COMPONENTS: ReadonlySet<string> = new Set(['Text', 'Markdown', 'Callout']);
/** Running prose: consecutive prose blocks read as one text (closer together). */
const PROSE_COMPONENTS: ReadonlySet<string> = new Set(['Text', 'Markdown']);

/** A block's width: its own, else `text` for Text, Markdown and Callout and `wide` for the rest. */
export function docWidth(block: DocBlock): DocWidth {
  if (block.width) return block.width;
  return block.kind === 'block' && TEXT_COMPONENTS.has(block.node.component) ? 'text' : 'wide';
}

const isProse = (block: DocBlock) =>
  block.kind === 'block' && PROSE_COMPONENTS.has(block.node.component) && !block.node.title;

/** The grid columns of a columns block: its shares as fractions, else equal. */
export function columnTemplate(columns: number, widths?: number[]): string {
  const shares = widths?.length === columns ? widths : Array.from({ length: columns }, () => 1);
  return shares.map((w) => `minmax(0, ${w}fr)`).join(' ');
}

/** Where the server serves a drawing; a new version of the view (or `reload`) loads it fresh. */
export function drawingUrl(view: Entity<'view'>, blockId: string, reload = 0): string {
  const version = reload ? `${view.updatedAt}-${reload}` : view.updatedAt;
  return `/api/views/${encodeURIComponent(view.id)}/doc/${encodeURIComponent(blockId)}/?v=${encodeURIComponent(version)}`;
}

/**
 * Where the server serves an embed's wrapper page (a frame of the site, no script of its own); a
 * new version of the view loads it fresh, so an embed whose site changed under the same block id
 * isn't left showing the old one.
 */
export function embedUrl(view: Entity<'view'>, blockId: string): string {
  return `/api/views/${encodeURIComponent(view.id)}/embed/${encodeURIComponent(blockId)}?v=${encodeURIComponent(view.updatedAt)}`;
}

/**
 * What an embed's frame lets the site do: run as itself (its scripts, its own origin, forms and
 * popups of its own), never navigate the app (no `allow-top-navigation`). The frame holds only
 * the server's wrapper page, which has no script (`default-src 'none'`); the site is framed
 * inside it, limited by the wrapper's `frame-src` to the embed's origin.
 */
export const EMBED_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

/** Embeds without a height are this tall. */
export const EMBED_HEIGHT = 480;

/** The document of a view with `doc`, under the bar that ProjectPage draws above it. */
export function DocumentView({ view }: { view: Entity<'view'> }) {
  const doc = view.data.doc;
  // The components of the document, as board widgets: FileLists show files in a FileView of the
  // same document, and Action blocks find their page, as on a board.
  const widgets = useMemo<Widget[]>(
    () =>
      doc
        ? docLeaves(doc.blocks).flatMap((b) =>
            b.kind === 'block' ? [{ id: b.id, node: b.node }] : [],
          )
        : [],
    [doc],
  );
  const sheets = useMemo(() => (doc ? deskSheets(doc.blocks) : []), [doc]);
  // Every top-level sheet, for the hand-back once all that ask something are answered.
  const allSheets = useMemo(
    () => (doc ? doc.blocks.filter((b): b is Sheet => b.kind === 'sheet') : []),
    [doc],
  );
  // Sheets answered before the agent last updated the page are handled: they leave the flow for
  // an "Earlier answers" fold at the end, so the desk shows this round only.
  const decisions = useDecisions();
  const tasksOf = useSheetTasks();
  const answeredAt = useSheetAnsweredAt();
  const cleared = new Set(
    allSheets
      .filter((s) => {
        if (sheetState(s, decisions, tasksOf(s)) !== 'answered') return false;
        const at = answeredAt(s);
        return !!at && at < view.updatedAt;
      })
      .map((s) => s.id),
  );
  const flow = doc ? doc.blocks.filter((b) => !(b.kind === 'sheet' && cleared.has(b.id))) : [];
  // A link to a sheet or block (#sheet-…) lands on it once the document has drawn, not at the top.
  const landed = useRef<string | null>(null);
  useEffect(() => {
    const hash = typeof location === 'undefined' ? '' : decodeURIComponent(location.hash.slice(1));
    if (!doc || !hash || landed.current === `${view.id}#${hash}`) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      landed.current = `${view.id}#${hash}`;
      el.scrollIntoView?.({ block: 'start' });
      el.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, view.id]);
  const firstSheet = flow.find((b) => b.kind === 'sheet');
  if (!doc) return null;
  return (
    <VariantProvider variant="document">
      <FileViewerProvider>
        <BoardFilesProvider widgets={widgets}>
          <BoardActionsProvider viewId={view.id} widgets={widgets}>
            <article
              data-document={view.id}
              aria-label={view.data.name}
              className="doc doc-flow pt-2 pb-16"
            >
              {flow.map((block) => (
                <DocTopBlock
                  key={block.id}
                  view={view}
                  block={block}
                  // The review desk (R15) sits above the first sheet still in the flow.
                  desk={sheets.length && firstSheet === block ? sheets : undefined}
                />
              ))}
              {/* Everything was answered before the last update: the desk still says so. */}
              {sheets.length > 0 && !firstSheet && <ReviewDeskHeader sheets={sheets} />}
              {cleared.size > 0 && (
                <details data-earlier-answers="" className="doc-earlier">
                  <summary className="doc-earlier-summary">
                    <CircleCheck aria-hidden className="size-4 text-ok" />
                    Earlier answers <span className="tabular-nums">({cleared.size})</span>
                  </summary>
                  {allSheets
                    .filter((s) => cleared.has(s.id))
                    .map((s) => (
                      <SheetView key={s.id} view={view} block={s} />
                    ))}
                </details>
              )}
            </article>
            {allSheets.length > 0 && <HandBackPrompt view={view} sheets={allSheets} />}
            <MediaPanel view={view} blocks={doc.blocks} />
          </BoardActionsProvider>
        </BoardFilesProvider>
      </FileViewerProvider>
    </VariantProvider>
  );
}

const CHANGE_LOOK: Record<
  Exclude<BlockChange, 'same'>,
  { label: string; icon: typeof Plus; box: string; tag: string }
> = {
  added: {
    label: 'Added',
    icon: Plus,
    box: 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30',
    tag: 'text-emerald-700 dark:text-emerald-300',
  },
  changed: {
    label: 'Changed',
    icon: PenLine,
    box: 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
    tag: 'text-amber-700 dark:text-amber-300',
  },
  removed: {
    label: 'Removed',
    icon: Minus,
    box: 'border-rose-500 bg-rose-50/50 opacity-75 dark:bg-rose-950/20',
    tag: 'text-rose-700 dark:text-rose-300',
  },
};

const ADDED_HREF = '#pharos-added';
/** Markdown symbols a marker around a changed word could break. */
const MARKUP = /[*_`#[\]<>|~]/;

/** Wraps each run of words in a part (spaces and line breaks stay outside the marker). */
function marked(text: string, wrap: (words: string) => string) {
  return text.replace(/[^\s]+(?:[ \t]+[^\s]+)*/g, (words) => wrap(words));
}

/**
 * A changed text block's words, drawn as the text reads (headings, bold, lists), the words
 * taken out struck through and the words put in marked. When a change touches markdown symbols,
 * the words are shown as plain text instead, so a marker never breaks the formatting.
 */
function WordChanges({ words }: { words: DiffPart[] }) {
  const plain = words.some((w) => w.op !== 'same' && MARKUP.test(w.text));
  if (plain)
    return (
      <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">
        {words.map((w, i) =>
          w.op === 'removed' ? (
            <del key={i} className={DEL}>
              {w.text}
            </del>
          ) : w.op === 'added' ? (
            <ins key={i} className={INS}>
              {w.text}
            </ins>
          ) : (
            <span key={i}>{w.text}</span>
          ),
        )}
      </p>
    );
  const source = words
    .map((w) =>
      w.op === 'removed'
        ? marked(w.text, (x) => `~~${x}~~`)
        : w.op === 'added'
          ? marked(w.text, (x) => `[${x}](${ADDED_HREF})`)
          : w.text,
    )
    .join('');
  return (
    <Markdown
      components={{
        del: ({ children }) => <del className={DEL}>{children}</del>,
        a: ({ href, children }) =>
          href === ADDED_HREF ? (
            <ins className={INS}>{children}</ins>
          ) : (
            <a href={href}>{children}</a>
          ),
      }}
    >
      {source}
    </Markdown>
  );
}

const DEL = 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200';
const INS =
  'bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-950/60 dark:text-emerald-100';

/**
 * One version of a document compared with the one before (the page's version history): every
 * block as that version left it, those added, changed or removed marked on the left edge with a
 * word and a symbol (never colour alone); a changed text shows its words taken out and put in.
 * A drawing that changed is named, not drawn: its frame only serves the page as it is now.
 */
export function DocumentCompare({
  view,
  comparison,
}: {
  view: Entity<'view'>;
  comparison: DocComparison;
}) {
  return (
    <VariantProvider variant="document">
      <FileViewerProvider>
        <article aria-label={`${view.data.name}, compared`} className="doc doc-flow pt-2 pb-16">
          {comparison.blocks.map(({ block, change, words }) => {
            const drawn =
              block.kind === 'drawing' && change !== 'same' ? (
                <p className="text-sm text-muted">
                  A drawing{change === 'removed' ? ' was here' : ''}.
                </p>
              ) : words ? (
                <WordChanges words={words} />
              ) : (
                <DocTopBlock view={view} block={block} />
              );
            if (change === 'same') return <div key={block.id}>{drawn}</div>;
            const look = CHANGE_LOOK[change];
            return (
              <div
                key={`${change}:${block.id}`}
                data-change={change}
                className={clsx('rounded-r-tile border-l-4 py-2 pr-3 pl-4', look.box)}
              >
                <p className={clsx('mb-1 flex items-center gap-1 text-xs font-medium', look.tag)}>
                  <look.icon className="size-3.5" aria-hidden /> {look.label}
                </p>
                {drawn}
              </div>
            );
          })}
        </article>
      </FileViewerProvider>
    </VariantProvider>
  );
}

/** The page and sheet that ask a decision (R15), if a document asks it. */
export function findDecisionSheet(
  views: Entity<'view'>[],
  decisionId: string,
): { view: Entity<'view'>; sheet: Sheet } | undefined {
  for (const view of views) {
    if (view.data.archived) continue;
    for (const block of view.data.doc?.blocks ?? []) {
      if (block.kind !== 'sheet') continue;
      const asks =
        block.decisions?.includes(decisionId) ||
        docLeaves(block.blocks).some(
          (leaf) =>
            leaf.kind === 'block' &&
            leaf.node.component === 'DecisionBlock' &&
            leaf.node.decision === decisionId,
        );
      if (asks) return { view, sheet: block };
    }
  }
  return undefined;
}

/**
 * What the page says around a decision, for its details panel: the sheet's own blocks (its
 * text, pictures, clips and drawings), without the decision forms, and the way to the page. The
 * decision itself only holds the question and the options; the reasons are on the page.
 */
export function DecisionPageContext({
  views,
  decisionId,
}: {
  views: Entity<'view'>[];
  decisionId: string;
}) {
  const found = useMemo(() => findDecisionSheet(views, decisionId), [views, decisionId]);
  const [all, setAll] = useState(false);
  const bodyId = useId();
  // Whether it runs past its first screen (then "Show all" is offered).
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && !all) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [all, found]);
  if (!found) return null;
  const { view, sheet } = found;
  const blocks = sheet.blocks.filter(
    (b) => !(b.kind === 'block' && b.node.component === 'DecisionBlock'),
  );
  if (!blocks.length) return null;
  return (
    <section data-decision-context={sheet.id} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">On the page</h3>
        <Link
          to={`/projects/${view.data.projectId}/views/${view.id}#${sheetAnchor(sheet.id)}`}
          className="inline-flex min-w-0 items-center gap-0.5 text-xs text-accent hover:underline"
        >
          <span className="truncate">{view.data.name}</span>
          <ArrowUpRight aria-hidden className="size-3 shrink-0" />
        </Link>
      </div>
      <div className="rounded-tile border border-line bg-surface">
        <VariantProvider variant="document">
          <div
            ref={body}
            id={bodyId}
            className={clsx(
              'doc doc-stack p-4 text-[0.95rem]',
              // The first screen of it, so the options stay near; the rest on request.
              !all &&
                'max-h-80 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]',
            )}
          >
            {blocks.map((block) => (
              <DocBlockView key={block.id} view={view} block={block} />
            ))}
          </div>
        </VariantProvider>
        {(long || all) && (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={bodyId}
            onClick={() => setAll((v) => !v)}
            className="w-full border-t border-line-soft px-4 py-2 text-left text-xs text-muted hover:bg-sunken"
          >
            {all ? 'Show less' : 'Show all of it'}
          </button>
        )}
      </div>
    </section>
  );
}

/** A top-level block, with the review desk header before it when it is the first sheet. */
function DocTopBlock({
  view,
  block,
  desk,
}: {
  view: Entity<'view'>;
  block: DocBlock;
  desk?: Sheet[];
}) {
  if (block.kind !== 'sheet') return <DocBlockView view={view} block={block} />;
  return (
    <>
      {desk && <ReviewDeskHeader sheets={desk} />}
      <SheetView view={view} block={block} />
    </>
  );
}

/** Any block but a sheet, in the flow of the document, a sheet or a details block. */
function DocBlockView({ view, block }: { view: Entity<'view'>; block: Exclude<DocBlock, Sheet> }) {
  const width = docWidth(block);
  if (block.kind === 'columns') return <ColumnsView view={view} block={block} width={width} />;
  if (block.kind === 'details') return <DetailsView view={view} block={block} width={width} />;
  return <Leaf view={view} block={block} width={width} />;
}

function ColumnsView({
  view,
  block,
  width,
}: {
  view: Entity<'view'>;
  block: Columns;
  width: DocWidth;
}) {
  return (
    <div
      data-doc-block={block.id}
      data-doc-kind="columns"
      data-doc-columns={block.columns.length}
      data-width={width}
      className="doc-block doc-columns"
      style={
        {
          '--doc-cols': columnTemplate(block.columns.length, block.widths),
        } as CSSProperties
      }
    >
      {block.columns.map((column, i) => (
        <div key={i} data-doc-column={i} className="doc-column">
          {column.map((leaf) => (
            <Leaf key={leaf.id} view={view} block={leaf} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Closed by default (R15): the reasoning, the full list, the raw numbers. */
function DetailsView({
  view,
  block,
  width,
}: {
  view: Entity<'view'>;
  block: Details;
  width: DocWidth;
}) {
  return (
    <details
      data-doc-block={block.id}
      data-doc-kind="details"
      data-doc-details=""
      data-width={width}
      open={block.open || undefined}
      className="doc-block doc-details"
    >
      <summary className="doc-details-summary">{block.summary}</summary>
      <div className="doc-stack doc-details-body">
        {block.blocks.map((inner) => (
          <DocBlockView key={inner.id} view={view} block={inner} />
        ))}
      </div>
    </details>
  );
}

/**
 * One item to review or act on (R15): a quiet frame with its title and pills, its blocks, and a
 * state from its decisions and checklist tasks that changes as the reader answers or ticks them.
 */
function SheetView({ view, block }: { view: Entity<'view'>; block: Sheet }) {
  const titleId = useId();
  const state = sheetState(block, useDecisions(), useSheetTasks()(block));
  const body = (
    <div className="doc-stack">
      {block.blocks.map((inner) => (
        <DocBlockView key={inner.id} view={view} block={inner} />
      ))}
    </div>
  );
  const common = {
    id: sheetAnchor(block.id),
    tabIndex: -1,
    'data-doc-block': block.id,
    'data-doc-kind': 'sheet',
    'data-doc-sheet': '',
    'data-state': state,
    'data-width': docWidth(block),
  };
  // Answered: one line with its state, the sheet itself behind a click (the reader is done here).
  if (state === 'answered')
    return (
      <details {...common} className="doc-block doc-sheet is-answered">
        <summary aria-labelledby={titleId} className="doc-sheet-summary">
          <SheetHead sheet={block} state={state} titleId={titleId} />
        </summary>
        <SheetRelated sheet={block} />
        {body}
      </details>
    );
  return (
    <section {...common} aria-labelledby={titleId} className="doc-block doc-sheet">
      <SheetHead sheet={block} state={state} titleId={titleId} />
      <SheetRelated sheet={block} />
      <SheetShows view={view} sheet={block} blocks={view.data.doc?.blocks ?? []} />
      {body}
    </section>
  );
}

/** One block in the flow (with its width) or in a column (filling it). */
function Leaf({
  view,
  block,
  width,
}: {
  view: Entity<'view'>;
  block: DocLeafBlock;
  width?: DocWidth;
}) {
  const common = {
    'data-doc-block': block.id,
    'data-doc-kind': block.kind === 'block' ? block.node.component : block.kind,
    'data-width': width,
    'data-prose': isProse(block) ? '' : undefined,
    className: 'doc-block',
  };
  if (block.kind === 'drawing')
    return (
      <figure {...common} data-doc-drawing="">
        <DrawingFrame view={view} block={block} />
        {block.caption && (
          <figcaption className="doc-caption doc-caption-md">
            <Markdown>{block.caption}</Markdown>
          </figcaption>
        )}
      </figure>
    );
  if (block.kind === 'embed')
    return (
      <figure {...common} data-doc-embed="">
        <EmbedFrame view={view} block={block} />
      </figure>
    );
  if (block.kind === 'figure')
    return (
      <figure {...common} data-doc-figure={figureLayout(block)}>
        <FigureView view={view} block={block} />
      </figure>
    );
  if (block.kind === 'steps')
    return (
      <div {...common} data-doc-steps="">
        <StepsView block={block} />
      </div>
    );
  if (block.kind === 'diff')
    return (
      <div {...common} data-doc-diff="">
        <DiffView block={block} />
      </div>
    );
  return (
    <div {...common}>
      <WidgetIdProvider id={block.id}>
        <Node node={block.node} />
      </WidgetIdProvider>
    </div>
  );
}

const NO_READS: FrameReads = {};

/** The document's named reads a drawing lists: all it may ask for (R14). */
export function drawingReads(view: Entity<'view'>, block: Drawing): FrameReads {
  const data = view.data.doc?.data;
  if (!data || !block.reads?.length) return NO_READS;
  return Object.fromEntries(
    block.reads.filter((name) => Object.hasOwn(data, name)).map((name) => [name, data[name]!]),
  );
}

/** A notice in place of a frame: as tall as its words, never the frame's reserved height. */
const FRAME_NOTICE = 'flex items-start gap-3 rounded-tile bg-sunken px-4 py-4 text-sm';

/**
 * A drawing: the agent's HTML for one section in the locked report frame (same sandbox, bridge
 * and guard as a report page), at the height it asked for, with no frame around it.
 */
export function DrawingFrame({ view, block }: { view: Entity<'view'>; block: Drawing }) {
  const reloads = useAssetReloads(view.id);
  // "Reload drawing" after it was stopped: a fresh frame at a fresh address.
  const [restarts, setRestarts] = useState(0);
  const src = drawingUrl(view, block.id, reloads + restarts);
  const reads = useMemo(() => drawingReads(view, block), [view, block]);
  const { frame, shown, onLoad, confirm, setConfirm } = useBridgeFrame({
    src,
    projectId: view.data.projectId,
    reads,
    what: 'drawing',
  });
  const box = { height: block.height };
  if (shown === 'stopped')
    return (
      <FrameStopped
        what="drawing"
        onReload={() => setRestarts((n) => n + 1)}
        className={FRAME_NOTICE}
      />
    );
  if (shown === 'missing' || shown === 'failed')
    return <FrameUnavailable what="drawing" status={shown} className={FRAME_NOTICE} />;
  return (
    <div className="space-y-2">
      {confirm && <LinkConfirm what="drawing" url={confirm} onDone={() => setConfirm(null)} />}
      <div className="relative" style={box}>
        {shown === 'loading' && (
          <Loading label="Loading drawing" className="absolute inset-0 space-y-3 py-2">
            <SkeletonShape className="size-full rounded-tile" />
          </Loading>
        )}
        <iframe
          key={src}
          ref={frame}
          src={src}
          title={block.caption ?? `Drawing in ${view.data.name}`}
          sandbox={REPORT_SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          className="block size-full border-0 bg-transparent transition-opacity duration-(--motion-base) ease-calm"
          style={{ opacity: shown === 'loading' ? 0 : 1, colorScheme: 'normal' }}
        />
      </div>
    </div>
  );
}

/** The site's name for the line above an embed without a caption. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * An embed: another site shown in place, with its caption and an "Open site" link above it that
 * is always there (many sites refuse to be framed; the link opens it in a new tab as any link in
 * Pharos does).
 */
export function EmbedFrame({ view, block }: { view: Entity<'view'>; block: Embed }) {
  const src = embedUrl(view, block.id);
  // When the wrapper route isn't there (or fails), say so in place of an empty frame.
  const [missing, setMissing] = useState<{ src: string; status: 'missing' | 'failed' } | null>(
    null,
  );
  const onLoad = () => {
    void fetch(src, { method: 'HEAD' })
      .then((res) => {
        if (res.status === 404) setMissing({ src, status: 'missing' });
        else if (!res.ok && res.status !== 405) setMissing({ src, status: 'failed' });
      })
      .catch(() => {});
  };
  const height = block.height ?? EMBED_HEIGHT;
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption className="doc-caption mt-0 min-w-0 flex-1">
          {block.caption ?? hostOf(block.url)}
        </figcaption>
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          data-embed-open=""
          className="inline-flex shrink-0 items-center gap-1 rounded-control text-sm font-medium text-accent hover:underline"
        >
          Open site <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {missing?.src === src ? (
        <FrameUnavailable what="embed" status={missing.status} className={FRAME_NOTICE} />
      ) : (
        <iframe
          src={src}
          title={block.caption ?? hostOf(block.url)}
          sandbox={EMBED_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={onLoad}
          className="block w-full rounded-tile border border-line bg-surface"
          style={{ height }}
        />
      )}
    </>
  );
}
