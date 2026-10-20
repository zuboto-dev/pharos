import { figureMedia, type DocBlock, type DocLeafBlock, type Entity } from '@pharos/schema';
import clsx from 'clsx';
import { Check, CircleCheck, Clock, Maximize2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useViewData } from '../catalog/context';
import { CopyButton } from '../catalog/copy';
import { Markdown } from '../catalog/ui';
import { useAssetReloads } from './frame-bridge';

// Rich report documents and the review desk (R15, docs/reframe/r15-review-documents.md):
// figures (pictures, clips and sounds the agent uploaded), numbered steps with commands to copy,
// and the review desk: sheets (one item to review each, with its state from its decisions) and
// the header above them with the time it needs, the progress and a chip per sheet.

export type Figure = Extract<DocLeafBlock, { kind: 'figure' }>;
export type Steps = Extract<DocLeafBlock, { kind: 'steps' }>;
export type Sheet = Extract<DocBlock, { kind: 'sheet' }>;
type FigureItem = Figure['items'][number];
export type FigureLayout = NonNullable<Figure['layout']>;

/** Where the app loads a document's uploaded file; `reload` (an upload since) loads it fresh. */
export function assetUrl(viewId: string, src: string, reload = 0): string {
  const path = src.split('/').map(encodeURIComponent).join('/');
  return `/api/views/${encodeURIComponent(viewId)}/assets/${path}${reload ? `?r=${reload}` : ''}`;
}

/** A figure's layout: its own, else single for one item, pair for two and grid for more. */
export function figureLayout(block: Figure): FigureLayout {
  const layout =
    block.layout ??
    (block.items.length === 1 ? 'single' : block.items.length === 2 ? 'pair' : 'grid');
  // A compare needs two pictures; anything else is shown side by side.
  if (
    layout === 'compare' &&
    (block.items.length !== 2 || block.items.some((i) => figureMedia(i.src) !== 'image'))
  )
    return block.items.length === 1 ? 'single' : 'pair';
  return layout;
}

// ---------------------------------------------------------------------------------------------
// Copy

/** A command in a mono box with its copy button. */
export function CodeBox({ text }: { text: string }) {
  return (
    <div data-doc-code="" className="doc-code">
      <pre>
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label="Copy command" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Figures

/** The picture open full size: one at a time, in a dark dialog over the page. */
type Zoomed = { src: string; alt: string; caption?: string };

/**
 * A picture full size in a dark dialog with its caption. Escape, the close button or a click
 * anywhere closes it, and focus goes back to the picture the reader opened.
 */
export function ZoomDialog({ shown, onClose }: { shown: Zoomed; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const captionId = useId();
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        // One thing to focus: the close button.
        e.preventDefault();
        close.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shown.alt}
      aria-describedby={shown.caption ? captionId : undefined}
      data-doc-zoom=""
      onClick={onClose}
      className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-neutral-950/90 p-4 sm:p-8"
    >
      <button
        ref={close}
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <X aria-hidden className="size-5" />
      </button>
      <img
        src={shown.src}
        alt={shown.alt}
        className="max-h-[82dvh] max-w-full rounded-tile object-contain shadow-overlay"
      />
      {shown.caption && (
        <div id={captionId} className="doc-zoom-caption">
          <Markdown>{shown.caption}</Markdown>
        </div>
      )}
    </div>,
    document.body,
  );
}

function ItemCaption({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <figcaption className="doc-caption doc-caption-md">
      <Markdown>{text}</Markdown>
    </figcaption>
  );
}

/** One picture, clip or sound of a figure, with its caption under it. */
function FigureMedia({
  item,
  url,
  onZoom,
}: {
  item: FigureItem;
  url: string;
  onZoom: (opener: HTMLElement) => void;
}) {
  const media = figureMedia(item.src);
  if (media === 'video')
    return (
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label={item.alt}
        className="doc-media"
      />
    );
  if (media === 'audio')
    return (
      <audio src={url} controls preload="metadata" aria-label={item.alt} className="doc-audio" />
    );
  return (
    <button
      type="button"
      data-zoom=""
      aria-label={`${item.alt}: open full size`}
      onClick={(e: MouseEvent<HTMLButtonElement>) => onZoom(e.currentTarget)}
      className="doc-zoomable group"
    >
      <img src={url} alt={item.alt} loading="lazy" decoding="async" className="doc-media" />
      <span aria-hidden className="doc-zoom-hint">
        <Maximize2 className="size-3.5" />
      </span>
    </button>
  );
}

/** Compare: the after picture over the before one, cut at a slider the reader moves. */
function CompareFigure({
  items,
  urls,
  onZoom,
}: {
  items: [FigureItem, FigureItem];
  urls: [string, string];
  onZoom: (index: number, opener: HTMLElement) => void;
}) {
  const [at, setAt] = useState(50);
  const [before, after] = items;
  const name = (i: FigureItem, fallback: string) =>
    i.caption?.replace(/[*_`]/g, '') || i.alt || fallback;
  return (
    <div data-doc-compare="" className="space-y-2.5">
      <div className="doc-compare" style={{ '--at': `${at}%` } as CSSProperties}>
        <img src={urls[0]} alt={before.alt} loading="lazy" decoding="async" className="doc-media" />
        <img
          src={urls[1]}
          alt={after.alt}
          loading="lazy"
          decoding="async"
          className="doc-media doc-compare-top"
        />
        <span aria-hidden className="doc-compare-line" />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-label="Compare the two pictures"
          aria-valuetext={`${at}% ${name(before, 'first')}, ${100 - at}% ${name(after, 'second')}`}
          className="doc-compare-range"
        />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        {items.map((item, i) => (
          <div key={i} className={clsx('min-w-0 flex-1', i === 1 && 'text-right')}>
            <ItemCaption text={item.caption} />
            <button
              type="button"
              data-zoom=""
              aria-label={`${item.alt}: open full size`}
              onClick={(e) => onZoom(i, e.currentTarget)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <Maximize2 aria-hidden className="size-3" /> Full size
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pictures, clips or sounds: one, a pair side by side, a grid, narrow phone shots, or two to
 * compare with a slider. Pictures load lazily and open full size; clips and sounds have their
 * controls and never play by themselves.
 */
export function FigureView({ view, block }: { view: Entity<'view'>; block: Figure }) {
  const reload = useAssetReloads(view.id);
  const layout = figureLayout(block);
  const urls = block.items.map((i) => assetUrl(view.id, i.src, reload));
  const [zoomed, setZoomed] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const zoom = (index: number, from: HTMLElement) => {
    opener.current = from;
    setZoomed(index);
  };
  const closeZoom = () => {
    setZoomed(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const shown = zoomed !== null ? block.items[zoomed] : undefined;
  return (
    <>
      {layout === 'compare' ? (
        <CompareFigure
          items={block.items as [FigureItem, FigureItem]}
          urls={urls as [string, string]}
          onZoom={zoom}
        />
      ) : (
        <ul data-figure-items="" className="doc-figure-items">
          {block.items.map((item, i) => (
            <li key={`${i}-${item.src}`} data-media={figureMedia(item.src)} className="min-w-0">
              <figure className="m-0">
                <FigureMedia item={item} url={urls[i]!} onZoom={(from) => zoom(i, from)} />
                <ItemCaption text={item.caption} />
              </figure>
            </li>
          ))}
        </ul>
      )}
      {block.caption && (
        <div className="doc-caption doc-caption-md doc-figure-caption">
          <Markdown>{block.caption}</Markdown>
        </div>
      )}
      {shown && zoomed !== null && (
        <ZoomDialog
          shown={{ src: urls[zoomed]!, alt: shown.alt, caption: shown.caption }}
          onClose={closeZoom}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Steps

/** Numbered steps: what to do (markdown), a command to copy, and what the reader should see. */
export function StepsView({ block }: { block: Steps }) {
  return (
    <>
      {block.title && <h3 className="doc-block-title">{block.title}</h3>}
      <ol className="doc-steps">
        {block.items.map((step, i) => (
          <li key={i} data-step={i + 1} className="doc-step">
            <span aria-hidden className="doc-step-number">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <Markdown>{step.text}</Markdown>
              {step.command && <CodeBox text={step.command} />}
              {step.expect && (
                <div data-step-expect="" className="doc-step-expect">
                  <CircleCheck aria-hidden className="mt-[0.2em] size-4 shrink-0 text-ok" />
                  <div className="min-w-0">
                    <span className="sr-only">You should see: </span>
                    <Markdown>{step.expect}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The review desk

/** How a sheet stands: answered once every decision it names has a choice or an answer. */
export type SheetState = 'answered' | 'open' | 'none';

type DecisionLike = Pick<Entity<'decision'>, 'id'> & {
  data: { chosenOptionId?: string | null; answer?: string | null };
};

export function sheetState(sheet: Sheet, decisions: readonly DecisionLike[]): SheetState {
  if (!sheet.decisions?.length) return 'none';
  const byId = new Map(decisions.map((d) => [d.id, d]));
  return sheet.decisions.every((id) => {
    const d = byId.get(id);
    return Boolean(d && (d.data.chosenOptionId || d.data.answer));
  })
    ? 'answered'
    : 'open';
}

const TIME_PART = /(\d+(?:[.,]\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)(?![a-z])/gi;

/**
 * Minutes in a sheet's time ("10 min", "1 h", "1.5 hours", "1 h 30 min"); undefined when none of
 * it can be read as minutes or hours ("a while").
 */
export function parseMinutes(time: string | undefined): number | undefined {
  if (!time) return undefined;
  let total = 0;
  let found = false;
  for (const m of time.matchAll(TIME_PART)) {
    const n = Number(m[1]!.replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    total += m[2]!.toLowerCase().startsWith('h') ? n * 60 : n;
    found = true;
  }
  return found ? Math.round(total) : undefined;
}

/** "25 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export type DeskSummary = {
  /** Every sheet: an item that needs the reader. */
  items: number;
  /** The sheets' times summed, when any could be read. */
  minutes: number | undefined;
  /** Sheets with decisions: the ones the progress counts. */
  asked: number;
  answered: number;
  states: { sheet: Sheet; state: SheetState }[];
};

export function deskSummary(sheets: Sheet[], decisions: readonly DecisionLike[]): DeskSummary {
  const states = sheets.map((sheet) => ({ sheet, state: sheetState(sheet, decisions) }));
  const times = sheets.map((s) => parseMinutes(s.time)).filter((m) => m !== undefined);
  return {
    items: sheets.length,
    minutes: times.length ? times.reduce((a, b) => a + b, 0) : undefined,
    asked: states.filter((s) => s.state !== 'none').length,
    answered: states.filter((s) => s.state === 'answered').length,
    states,
  };
}

/** The sheets of a document (top level only), when there are enough for a review desk. */
export function deskSheets(blocks: DocBlock[]): Sheet[] {
  const sheets = blocks.filter((b): b is Sheet => b.kind === 'sheet');
  return sheets.length >= 2 ? sheets : [];
}

/** A sheet's anchor in the page. */
export const sheetAnchor = (id: string) => `sheet-${id}`;

/** The decisions a document asks about anywhere: what the sheet states read. */
export function useDecisions() {
  return useViewData().decisions;
}

function scrollToSheet(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(sheetAnchor(id));
  if (!target) return;
  e.preventDefault();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

/**
 * Above the first sheet when a document has two or more: what it needs from the reader (items and
 * about how long), the progress over the sheets with decisions, and a chip per sheet.
 */
export function ReviewDeskHeader({ sheets }: { sheets: Sheet[] }) {
  const decisions = useDecisions();
  const desk = deskSummary(sheets, decisions);
  const share = desk.asked ? desk.answered / desk.asked : 0;
  const done = desk.asked > 0 && desk.answered === desk.asked;
  return (
    <header data-review-desk="" className="doc-desk" aria-label="Review desk">
      <p className="doc-eyebrow">Review desk</p>
      <p data-needs-you="" className="doc-needs-you">
        Needs you:{' '}
        <strong className="text-accent">
          {desk.items} {desk.items === 1 ? 'item' : 'items'}
        </strong>
        {desk.minutes !== undefined && <>, about {formatMinutes(desk.minutes)}</>}
      </p>
      {desk.asked > 0 && (
        <div className="doc-desk-progress">
          <div
            role="progressbar"
            aria-label="Answered"
            aria-valuemin={0}
            aria-valuemax={desk.asked}
            aria-valuenow={desk.answered}
            aria-valuetext={`${desk.answered} of ${desk.asked} answered`}
            className="doc-desk-track"
          >
            <span
              className={clsx('doc-desk-fill', done && 'is-done')}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
          <p data-progress="" className="doc-desk-count" aria-live="polite">
            {desk.answered} of {desk.asked} answered
          </p>
        </div>
      )}
      <nav aria-label="Items">
        <ul className="doc-chips">
          {desk.states.map(({ sheet, state }) => (
            <li key={sheet.id}>
              <a
                href={`#${sheetAnchor(sheet.id)}`}
                data-chip={sheet.id}
                data-state={state}
                onClick={(e) => scrollToSheet(e, sheet.id)}
                className="doc-chip"
              >
                <span aria-hidden className="doc-chip-dot" />
                <span className="truncate">{sheet.title}</span>
                {state !== 'none' && (
                  <span className="sr-only">{state === 'answered' ? ', answered' : ', open'}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/** A sheet's title line: its title and pills (time, tags, state). */
export function SheetHead({
  sheet,
  state,
  titleId,
}: {
  sheet: Sheet;
  state: SheetState;
  titleId: string;
}) {
  return (
    <header className="doc-sheet-head">
      <h2 id={titleId} className="doc-sheet-title">
        {sheet.title}
      </h2>
      <div className="doc-pills">
        {sheet.time && (
          <span data-pill="time" className="doc-pill doc-pill-time">
            <Clock aria-hidden className="size-3" />
            {sheet.time}
          </span>
        )}
        {sheet.tags?.map((tag) => (
          <span key={tag} data-pill="tag" className="doc-pill">
            {tag}
          </span>
        ))}
        {state !== 'none' && (
          <span
            data-pill="state"
            className={clsx('doc-pill', state === 'answered' ? 'doc-pill-done' : 'doc-pill-open')}
          >
            {state === 'answered' && <Check aria-hidden className="size-3" />}
            {state === 'answered' ? 'Answered' : 'Open'}
          </span>
        )}
      </div>
    </header>
  );
}
