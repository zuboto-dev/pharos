import {
  fileUrl,
  galleryContents,
  isPictureFile,
  runQuery,
  type Entity,
  type GalleryPicture,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { ExternalLink, ImageOff, Images } from 'lucide-react';
import { useRef, useState } from 'react';
import { FileViewer, type ViewerItem } from '../../files/FileViewer';
import { useExit } from '../../lib/motion';
import { CHART } from '../chart';
import { useViewData, type ViewData } from '../context';
import { AddFilesActions, EmptyState } from '../empty-state';
import { GlanceDate } from '../../files/glance';
import { FileTypeIcon } from './file-list';
import { CertaintyMark } from './knowledge';

/**
 * Gallery (R7.13): pictures, not words, for anything visual. Pictures come from artifacts with an
 * `image` (an https address, or a project image file) and from project image files, never from
 * the spec. External pictures load lazily, over https only, without a referrer, and show the host
 * they come from; a picture that can't be shown is a quiet placeholder with its link. A tapped
 * picture opens large in the file viewer (v0.2 A6; Esc closes, arrows step, focus stays inside,
 * swipe on phones) with its caption, source and, for project files, the file actions and Details.
 */

type Node = NodeOf<'Gallery'>;

/** What an <img> may load for a picture, or why it can't be shown. */
type Resolved =
  | { src: string; file?: Entity<'file'> }
  | { src: null; reason: string; href?: string; file?: Entity<'file'> };

function resolve(data: ViewData, picture: GalleryPicture): Resolved {
  const { image } = picture;
  if (image.kind === 'url')
    return image.safe
      ? { src: image.url }
      : {
          src: null,
          reason: `Not shown: ${image.problem ?? 'the address is not safe to load'}.`,
          ...(/^https?:\/\//.test(image.url) ? { href: image.url } : {}),
        };
  const file = data.files?.find((f) => f.id === image.fileId);
  if (!file) return { src: null, reason: 'This picture’s file isn’t in the project.' };
  if (!isPictureFile(file.data.path))
    return { src: null, reason: 'This file isn’t a picture Pharos shows.', file };
  return { src: fileUrl('content', file.id), file };
}

/**
 * A picture, or a quiet placeholder with its link when it can't be shown or fails to load. With
 * `onOpen`, a shown picture is a button that opens it large (a placeholder isn't: its link is
 * the way on, and a link can't sit inside a button).
 */
function Picture({
  picture,
  resolved,
  large = false,
  frame,
  label,
  onOpen,
}: {
  picture: GalleryPicture;
  resolved: Resolved;
  large?: boolean;
  /** Classes for the tile around the picture or placeholder. */
  frame?: string;
  /** The open button's accessible name. */
  label?: string;
  onOpen?: (opener: HTMLElement) => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = resolved.src;
  if (!src || broken) {
    const href = resolved.src ?? resolved.href;
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <div
        role="group"
        aria-label={`${picture.alt} (picture not shown)`}
        data-placeholder
        className={clsx(
          'flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-muted',
          CHART.picture,
          large ? 'min-h-48 w-full max-w-lg rounded-tile' : 'aspect-[4/3] w-full',
          frame,
        )}
      >
        <ImageOff className="size-6 text-faint" aria-hidden />
        <span>{resolved.src === null ? resolved.reason : 'Couldn’t load the picture.'}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex max-w-full items-center gap-1 text-accent hover:underline"
          >
            <span className="truncate">
              {external ? href.replace(/^https?:\/\//, '') : 'Open the file'}
            </span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
    );
  }
  const img = (
    <img
      src={src}
      alt={picture.alt}
      loading={large ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setBroken(true)}
      className={clsx(
        'block object-contain',
        CHART.picture,
        large
          ? 'max-h-[62dvh] w-auto max-w-full rounded-control sm:max-h-[64vh]'
          : 'aspect-[4/3] w-full',
      )}
    />
  );
  if (!onOpen) return img;
  return (
    <button
      type="button"
      data-picture={picture.id}
      aria-label={label}
      onClick={(e) => onOpen(e.currentTarget)}
      className={clsx(
        'block w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
        frame,
      )}
    >
      {img}
    </button>
  );
}

/** Where a picture comes from: its source page's host as a link, else the image's host. */
function Source({ picture, className }: { picture: GalleryPicture; className?: string }) {
  if (picture.type === 'file' || (picture.image.kind === 'file' && !picture.sourceUrl))
    return <span className={className}>Project file</span>;
  const href = picture.sourceUrl ?? (picture.image.kind === 'url' ? picture.image.url : undefined);
  if (!picture.sourceHost) return null;
  if (!href || !/^https?:\/\//.test(href))
    return <span className={className}>{picture.sourceHost}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      title={href}
      className={clsx(
        'inline-flex min-w-0 items-center gap-1 text-accent hover:underline',
        className,
      )}
    >
      <span className="truncate">{picture.sourceHost}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Where a picture comes from, at a glance under it (v0.2 B2): a project file's one date that
 * matters, or "Source" linking to its web page (the host is in the tooltip and the lightbox).
 */
function CaptionSource({ picture, className }: { picture: GalleryPicture; className?: string }) {
  const data = useViewData();
  if (picture.type === 'file' || (picture.image.kind === 'file' && !picture.sourceUrl)) {
    const id = picture.type === 'file' ? picture.id : (picture.image as { fileId: string }).fileId;
    const file = data.files?.find((f) => f.id === id);
    return file ? (
      <span className={clsx('inline-flex items-center gap-1.5', className)}>
        <FileTypeIcon path={file.data.path} className="size-3.5 text-faint" />
        <GlanceDate file={file.data} />
      </span>
    ) : null;
  }
  const href = picture.sourceUrl ?? (picture.image.kind === 'url' ? picture.image.url : undefined);
  if (!href || !/^https?:\/\//.test(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      title={picture.sourceHost ?? href}
      className={clsx(
        'inline-flex min-w-0 items-center gap-1 text-accent hover:underline',
        className,
      )}
    >
      <span className="truncate">Source</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Under a picture in the viewer: its description, where it comes from, and the item it belongs
 * to (an artifact's details open in the drawer).
 */
function PictureCaption({
  picture,
  description,
  onClose,
}: {
  picture: GalleryPicture;
  description?: string;
  onClose: () => void;
}) {
  const data = useViewData();
  return (
    <div className="space-y-1">
      {picture.caption && picture.caption !== picture.title && (
        <p className="font-medium">{picture.caption}</p>
      )}
      {description && <p className="text-ink-soft">{description}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <Source picture={picture} />
        {picture.type === 'artifact' && (
          <button
            type="button"
            onClick={() => {
              onClose();
              data.actions.open({ entity: picture.id });
            }}
            className="rounded-sm underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            Item details
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The large view (v0.2 A6): the file viewer, with each picture large. A picture that is a
 * project file gets the file's actions and Details too; one from the web, its source.
 */
function viewerItems(data: ViewData, pictures: GalleryPicture[]): ViewerItem[] {
  return pictures.map((picture) => {
    const resolved = resolve(data, picture);
    const file =
      resolved.file && resolved.src
        ? resolved.file
        : picture.type === 'file'
          ? data.files?.find((f) => f.id === picture.id)
          : undefined;
    const description =
      picture.type === 'artifact'
        ? (data.entityById.get(picture.id) as Entity<'artifact'> | undefined)?.data.description
        : undefined;
    return {
      key: picture.id,
      title: picture.title,
      label: picture.caption ?? picture.title,
      ...(file ? { file } : {}),
      preview: (
        <div className="flex min-h-0 justify-center">
          <Picture picture={picture} resolved={resolved} large />
        </div>
      ),
      caption: (close: () => void) => (
        <PictureCaption picture={picture} description={description} onClose={close} />
      ),
    };
  });
}

const GRID_COLUMNS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

export function Gallery({ node }: { node: Node }) {
  const data = useViewData();
  const [open, setOpen] = useState<number | null>(null);
  // The lightbox stays a moment after closing, to fade out.
  const lightbox = useExit(open);
  const opener = useRef<HTMLElement | null>(null);
  const claim = node.claim ? runQuery(data, 'claim', { where: { id: node.claim } })[0] : undefined;
  const { pictures } = galleryContents(data, node);
  // Whether the project has pictures of the kinds this block shows, just none its filter matches.
  const anyPictures =
    !pictures.length &&
    galleryContents(data, {
      ...node,
      ...(node.artifacts ? { artifacts: {} } : {}),
      ...(node.files ? { files: {} } : {}),
    }).pictures.length > 0;
  const lit = new Set(node.highlight ?? []);
  const layout = node.layout ?? 'grid';
  const close = () => {
    setOpen(null);
    // Back to the picture the reader opened.
    requestAnimationFrame(() => opener.current?.focus());
  };

  const items = pictures.map((p, i) => {
    const highlighted = lit.has(p.id);
    return (
      <li
        key={p.id}
        className={clsx('min-w-0', layout === 'strip' && 'w-56 shrink-0 snap-start sm:w-64')}
      >
        <figure className="space-y-1.5">
          <Picture
            picture={p}
            resolved={resolve(data, p)}
            label={`${p.alt}${highlighted ? ' (highlighted)' : ''}: open large`}
            onOpen={(button) => {
              opener.current = button;
              setOpen(i);
            }}
            frame={clsx(
              'overflow-hidden rounded-tile border transition hover:shadow-sm',
              CHART.frame[highlighted ? 'lit' : 'rest'],
            )}
          />
          {(p.caption || p.sourceHost || p.type === 'file' || p.image.kind === 'file') && (
            <figcaption className="min-w-0 space-y-0.5 px-0.5">
              {p.caption && (
                <p
                  className={clsx(
                    'line-clamp-2 break-words',
                    CHART.caption,
                    highlighted && 'font-semibold',
                  )}
                >
                  {p.caption}
                </p>
              )}
              <p className={clsx('flex min-w-0', CHART.source)}>
                <CaptionSource picture={p} className="min-w-0 truncate" />
              </p>
            </figcaption>
          )}
        </figure>
      </li>
    );
  });

  return (
    <figure className="min-w-0 space-y-3">
      {claim && (
        <figcaption className="space-y-1">
          <p className={CHART.title}>{claim.data.statement}</p>
          <CertaintyMark claim={claim} />
        </figcaption>
      )}
      {pictures.length ? (
        <ul
          aria-label={claim?.data.statement ?? node.title ?? 'Pictures'}
          className={clsx(
            layout === 'strip'
              ? '-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2'
              : layout === 'compare'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
                : clsx('grid grid-cols-1 gap-3', GRID_COLUMNS[node.columns ?? 3]),
          )}
        >
          {items}
        </ul>
      ) : (
        <EmptyState
          icon={Images}
          title={anyPictures ? 'No pictures match this list' : 'No pictures yet'}
          hint={
            anyPictures
              ? 'Pictures that match its filter show up here.'
              : 'Photos and scans from this project’s files show up here.'
          }
        >
          {!anyPictures && <AddFilesActions />}
        </EmptyState>
      )}
      {lightbox.shown !== null && pictures[lightbox.shown] && (
        <FileViewer
          items={viewerItems(data, pictures)}
          index={lightbox.shown}
          onIndex={setOpen}
          onClose={close}
          leaving={lightbox.leaving}
          noun="picture"
        />
      )}
    </figure>
  );
}
