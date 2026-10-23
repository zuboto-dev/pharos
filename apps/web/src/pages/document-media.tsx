import { figureMedia, type DocBlock, type Entity } from '@pharos/schema';
import { Film, Images, LocateFixed, Music, PenTool, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '../catalog/ui';
import { useAssetReloads } from './frame-bridge';
import { ZoomDialog, assetUrl, type Sheet } from './document-rich';

// A long document's pictures, clips and drawings, one click away from wherever the reader is
// (Chaeeon, 10-23: "hard to go up and down to check the media for each decision"). The Pictures
// panel lists them all by section beside the page; a sheet's `shows` puts the ones it asks about
// inside the sheet, above its decision.

export type MediaItem = {
  /** The figure or drawing block it belongs to. */
  blockId: string;
  /** The heading it sits under: the nearest "#…" line of a Text block, or its sheet's title. */
  section: string;
  kind: 'image' | 'video' | 'audio' | 'drawing';
  src?: string;
  alt: string;
  caption?: string;
};

/** The first Markdown heading of a text, without its #s. */
function headingOf(text: string): string | undefined {
  const line = text.split('\n').find((l) => /^#{1,4}\s/.test(l));
  return line?.replace(/^#+\s*/, '').trim();
}

/** Every picture, clip, sound and drawing of a document, in reading order, with its section. */
export function docMedia(blocks: DocBlock[]): MediaItem[] {
  const out: MediaItem[] = [];
  let section = '';
  const walk = (list: DocBlock[], inSheet?: string) => {
    for (const b of list) {
      if (b.kind === 'sheet') {
        walk(b.blocks as DocBlock[], b.title);
        continue;
      }
      if (b.kind === 'details') {
        walk(b.blocks as DocBlock[], inSheet);
        continue;
      }
      if (b.kind === 'columns') {
        walk(b.columns.flat() as DocBlock[], inSheet);
        continue;
      }
      if (b.kind === 'block' && (b.node.component === 'Text' || b.node.component === 'Markdown')) {
        const h = headingOf((b.node as { content?: string }).content ?? '');
        if (h) section = h;
        continue;
      }
      const where = inSheet ?? section;
      if (b.kind === 'figure')
        for (const item of b.items) {
          const media = figureMedia(item.src) ?? 'image';
          out.push({
            blockId: b.id,
            section: where,
            kind: media,
            src: item.src,
            alt: item.alt,
            ...(item.caption ? { caption: item.caption } : {}),
          });
        }
      else if (b.kind === 'drawing')
        out.push({
          blockId: b.id,
          section: where,
          kind: 'drawing',
          alt: b.caption ?? 'A drawing',
          ...(b.caption ? { caption: b.caption } : {}),
        });
    }
  };
  walk(blocks);
  return out;
}

/** Scrolls the page to a block and flashes it, so the reader sees where it lives. */
function showInPage(blockId: string) {
  const el = document.querySelector<HTMLElement>(`[data-doc-block="${CSS.escape(blockId)}"]`);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  el.setAttribute('data-flash', '');
  setTimeout(() => el.removeAttribute('data-flash'), 1600);
}

/** Thumbnails of media items; pictures open full size, paging through the pictures given. */
function Thumbs({
  view,
  items,
  compact = false,
}: {
  view: Entity<'view'>;
  items: MediaItem[];
  compact?: boolean;
}) {
  const reload = useAssetReloads(view.id);
  const pictures = items.filter((i) => i.kind === 'image');
  const [zoomed, setZoomed] = useState<number | null>(null);
  const shown = zoomed === null ? undefined : pictures[zoomed];
  return (
    <>
      <ul className={compact ? 'doc-thumbs is-compact' : 'doc-thumbs'}>
        {items.map((item, i) => {
          const url = item.src ? assetUrl(view.id, item.src, reload) : '';
          return (
            <li key={`${item.blockId}-${i}`} data-media={item.kind} className="doc-thumb">
              {item.kind === 'image' ? (
                <button
                  type="button"
                  aria-label={`${item.alt}: open full size`}
                  onClick={() => setZoomed(pictures.indexOf(item))}
                  className="doc-thumb-button"
                >
                  <img src={url} alt={item.alt} loading="lazy" decoding="async" />
                </button>
              ) : item.kind === 'video' ? (
                <video src={url} controls preload="metadata" playsInline aria-label={item.alt} />
              ) : item.kind === 'audio' ? (
                <div className="doc-thumb-audio">
                  <Music aria-hidden className="size-4 shrink-0 text-muted" />
                  <audio src={url} controls preload="metadata" aria-label={item.alt} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => showInPage(item.blockId)}
                  className="doc-thumb-drawing"
                >
                  <PenTool aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{item.alt}</span>
                </button>
              )}
              {!compact && item.caption && item.kind !== 'drawing' && (
                <div className="doc-thumb-caption">
                  <Markdown>{item.caption}</Markdown>
                </div>
              )}
              {compact && item.kind === 'video' && (
                <Film aria-hidden className="doc-thumb-kind size-3.5" />
              )}
            </li>
          );
        })}
      </ul>
      {shown && zoomed !== null && (
        <ZoomDialog
          shown={{
            src: assetUrl(view.id, shown.src!, reload),
            alt: shown.alt,
            ...(shown.caption ? { caption: shown.caption } : {}),
          }}
          onClose={() => setZoomed(null)}
          {...(pictures.length > 1
            ? {
                paging: {
                  at: zoomed,
                  of: pictures.length,
                  onStep: (d: 1 | -1) =>
                    setZoomed((z) => Math.max(0, Math.min(pictures.length - 1, (z ?? 0) + d))),
                },
              }
            : {})}
        />
      )}
    </>
  );
}

/** What a sheet asks about, shown inside it: the figures and drawings named in its `shows`. */
export function SheetShows({
  view,
  sheet,
  blocks,
}: {
  view: Entity<'view'>;
  sheet: Sheet;
  blocks: DocBlock[];
}) {
  const items = useMemo(() => {
    const wanted = new Set(sheet.shows ?? []);
    return wanted.size ? docMedia(blocks).filter((m) => wanted.has(m.blockId)) : [];
  }, [sheet.shows, blocks]);
  if (!items.length) return null;
  return (
    <div data-sheet-shows="" className="doc-sheet-shows">
      <p className="doc-sheet-shows-label">What this asks about</p>
      <Thumbs view={view} items={items} compact />
    </div>
  );
}

/** Where the reader last left the Pictures window. */
// v2: the window opens at the bottom right by default (owner's review, 10-23); a place saved by
// the first version is dropped.
const PLACE_KEY = 'pharos.picturesWindow.v2';

/** Documents with at least this many media items get the Pictures button. */
export const MEDIA_PANEL_MIN = 3;

/**
 * The Pictures button (bottom right) and its floating window: every picture, clip, sound and
 * drawing of the document by section, beside the page, so the reader looks while they decide.
 */
export function MediaPanel({ view, blocks }: { view: Entity<'view'>; blocks: DocBlock[] }) {
  const items = useMemo(() => docMedia(blocks), [blocks]);
  const [open, setOpen] = useState(false);
  // A floating window the reader drags by its title bar; the page under it stays usable, and the
  // window comes back where they left it (this browser only).
  const [at, setAt] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as {
        x: number;
        y: number;
      } | null;
      return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
    } catch {
      return null;
    }
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDragStart = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setAt({
      x: Math.max(0, Math.min(window.innerWidth - box.width, e.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy)),
    });
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      if (at) localStorage.setItem(PLACE_KEY, JSON.stringify(at));
    } catch {
      // Not remembered: it opens in its default corner next time.
    }
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A picture open full size closes first (its own Escape).
      if (e.key === 'Escape' && !document.querySelector('[data-doc-zoom]')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const groups = useMemo(() => {
    const out: { section: string; items: MediaItem[] }[] = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (last && last.section === item.section) last.items.push(item);
      else out.push({ section: item.section, items: [item] });
    }
    return out;
  }, [items]);
  if (items.length < MEDIA_PANEL_MIN) return null;
  return createPortal(
    <>
      {!open && (
        <button
          type="button"
          data-media-button=""
          onClick={() => setOpen(true)}
          className="doc-media-button"
        >
          <Images aria-hidden className="size-4" />
          Pictures <span className="tabular-nums opacity-70">{items.length}</span>
        </button>
      )}
      {open && (
        <aside
          data-media-panel=""
          aria-label="Pictures and clips"
          className="doc-media-panel"
          style={at ? { left: at.x, top: at.y, right: 'auto', bottom: 'auto' } : undefined}
        >
          <header
            className="doc-media-panel-head"
            title="Drag to move"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <Images aria-hidden className="size-4 text-muted" />
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              Pictures and clips <span className="font-normal text-muted">{items.length}</span>
            </h2>
            <button
              type="button"
              aria-label="Close pictures"
              onClick={() => setOpen(false)}
              className="rounded-control p-1 text-faint hover:bg-sunken hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </header>
          <div className="doc-media-panel-body">
            {groups.map((g, i) => (
              <section key={`${g.section}-${i}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted uppercase">
                    {g.section || 'Top of the page'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => showInPage(g.items[0]!.blockId)}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <LocateFixed aria-hidden className="size-3" /> Show in page
                  </button>
                </div>
                <Thumbs view={view} items={g.items} />
              </section>
            ))}
          </div>
        </aside>
      )}
    </>,
    document.body,
  );
}
