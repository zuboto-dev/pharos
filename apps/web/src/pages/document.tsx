import {
  docLeaves,
  type DocBlock,
  type DocLeafBlock,
  type Entity,
  type Widget,
} from '@pharos/schema';
import { ExternalLink } from 'lucide-react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
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
  useDecisions,
  useSheetTasks,
  type Sheet,
} from './document-rich';
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

/** Where the server serves an embed's wrapper page (a frame of the site, no script of its own). */
export function embedUrl(view: Entity<'view'>, blockId: string): string {
  return `/api/views/${encodeURIComponent(view.id)}/embed/${encodeURIComponent(blockId)}`;
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
              {doc.blocks.map((block) => (
                <DocTopBlock
                  key={block.id}
                  view={view}
                  block={block}
                  // The review desk (R15) sits above the first sheet.
                  desk={sheets[0] === block ? sheets : undefined}
                />
              ))}
            </article>
            {allSheets.length > 0 && <HandBackPrompt view={view} sheets={allSheets} />}
          </BoardActionsProvider>
        </BoardFilesProvider>
      </FileViewerProvider>
    </VariantProvider>
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
  return (
    <section
      id={sheetAnchor(block.id)}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-doc-block={block.id}
      data-doc-sheet=""
      data-state={state}
      data-width={docWidth(block)}
      className="doc-block doc-sheet"
    >
      <SheetHead sheet={block} state={state} titleId={titleId} />
      <div className="doc-stack">
        {block.blocks.map((inner) => (
          <DocBlockView key={inner.id} view={view} block={inner} />
        ))}
      </div>
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
    'data-width': width,
    'data-prose': isProse(block) ? '' : undefined,
    className: 'doc-block',
  };
  if (block.kind === 'drawing')
    return (
      <figure {...common} data-doc-drawing="">
        <DrawingFrame view={view} block={block} />
        {block.caption && <figcaption className="doc-caption">{block.caption}</figcaption>}
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
