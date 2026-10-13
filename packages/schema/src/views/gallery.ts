import type { Entity } from '../entities.js';
import { fileTypeOf } from '../files.js';
import type { NodeOf } from './catalog.js';
import { GALLERY, hostOf, imageSource, type ImageSource } from './pictures.js';
import type { ProjectDataset } from './query.js';
import { runQuery, type QueryContext } from './run-query.js';

/**
 * The pictures a Gallery shows (R7.13), shared by the web component and the view preview so both
 * count the same pictures: artifacts with an `image` first, in the filter's order, then project
 * image files, up to `max`. Nothing is copied into the spec; it all comes from the dataset.
 */

export type GalleryPicture = {
  /** The artifact's or the file's id. */
  id: string;
  type: 'artifact' | 'file';
  title: string;
  /** What the caption setting picks: the title, the description, or nothing. */
  caption?: string;
  /** The alt text: an artifact's `alt`, else its title (`altMissing` says so). */
  alt: string;
  altMissing: boolean;
  /** Where the picture is: a project file, or a web address. */
  image: ImageSource & { kind: 'file' | 'url' };
  /** The page it comes from (an artifact's http(s) `uri`), shown as its host. */
  sourceUrl?: string;
  /** The host a reader sees under the picture: the source page's, else the image's. */
  sourceHost?: string;
};

export type GalleryContents = {
  pictures: GalleryPicture[];
  /** Matching artifacts left out because they have no (usable) image. */
  withoutImage: Entity<'artifact'>[];
  /** Matching files left out because they aren't pictures Pharos previews. */
  notPictures: Entity<'file'>[];
  /** Pictures left out by `max`. */
  overMax: number;
};

/** Whether a file is a picture the file routes show inline (png, jpg, gif, webp). */
export function isPictureFile(path: string | undefined): boolean {
  return typeof path === 'string' && fileTypeOf(path).preview === 'image';
}

export function galleryContents(
  data: ProjectDataset,
  node: NodeOf<'Gallery'>,
  options: QueryContext & {
    /** Whether a file is a picture; defaults to its path's type (agents' data has no path). */
    isPicture?: (file: Entity<'file'>) => boolean;
  } = {},
): GalleryContents {
  const isPicture = options.isPicture ?? ((f: Entity<'file'>) => isPictureFile(f.data.path));
  const captionOf = (title: string, description?: string) =>
    node.caption === 'none'
      ? undefined
      : node.caption === 'description'
        ? description?.trim() || title
        : title;
  const pictures: GalleryPicture[] = [];
  const withoutImage: Entity<'artifact'>[] = [];
  const notPictures: Entity<'file'>[] = [];
  if (node.artifacts)
    for (const a of runQuery(data, 'artifact', node.artifacts, options)) {
      const image = imageSource(a.data.image);
      if (image.kind === 'invalid') {
        withoutImage.push(a);
        continue;
      }
      const sourceUrl = hostOf(a.data.uri) ? a.data.uri : undefined;
      const sourceHost =
        hostOf(sourceUrl) ?? (image.kind === 'url' ? image.host : undefined) ?? undefined;
      pictures.push({
        id: a.id,
        type: 'artifact',
        title: a.data.title,
        caption: captionOf(a.data.title, a.data.description),
        alt: a.data.alt?.trim() || a.data.title,
        altMissing: !a.data.alt?.trim(),
        image,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(sourceHost ? { sourceHost } : {}),
      });
    }
  if (node.files)
    for (const f of runQuery(data, 'file', node.files, options)) {
      if (!isPicture(f)) {
        notPictures.push(f);
        continue;
      }
      pictures.push({
        id: f.id,
        type: 'file',
        title: f.data.title,
        caption: captionOf(f.data.title),
        alt: f.data.title,
        altMissing: false,
        image: { kind: 'file', fileId: f.id },
      });
    }
  const max = node.max ?? GALLERY.defaultMax;
  return {
    pictures: pictures.slice(0, max),
    withoutImage,
    notPictures,
    overMax: Math.max(0, pictures.length - max),
  };
}
