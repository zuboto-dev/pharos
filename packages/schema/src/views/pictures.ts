import { z } from 'zod';

/**
 * Pictures in views (R7.13): where an artifact's `image` points and whether the web app may load
 * it. An image is either a project file (its id; served by the file routes, never a path) or an
 * external address. External pictures load over https only, from a public host, without a
 * referrer; anything else is shown as a link, never as an <img>.
 */

/** A project file's id as an artifact's `image` (`newId`: `file_` and 12 hex digits). */
export const IMAGE_FILE_ID = /^file_[A-Za-z0-9]{1,64}$/;

/** Longest image address stored. */
export const IMAGE_URL_MAX = 2048;

/** Gallery limits, checked by the preview's warnings. */
export const GALLERY = {
  /** Pictures a Gallery shows when `max` is not set. */
  defaultMax: 12,
  /** Most pictures a Gallery may show. */
  maxItems: 24,
  /** A `compare` gallery sets exactly this many pictures side by side. */
  compareItems: 2,
  /** Longest alt text, in characters. */
  altChars: 300,
} as const;

/** Hosts a picture never loads from: this computer and private networks. */
function privateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h.includes(':'))
    return (
      h === '::1' ||
      h === '::' ||
      h.startsWith('fc') ||
      h.startsWith('fd') ||
      h.startsWith('fe80') ||
      h.startsWith('::ffff:')
    );
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** The WHATWG URL parser (Node and browsers have it; this package's lib settings don't name it). */
type ParsedUrl = {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  href: string;
};
const UrlParser = (globalThis as unknown as { URL: new (value: string) => ParsedUrl }).URL;

function parseUrl(value: string): ParsedUrl | null {
  try {
    return new UrlParser(value);
  } catch {
    return null;
  }
}

/** Where an artifact's `image` points. */
export type ImageSource =
  | { kind: 'file'; fileId: string }
  /** `safe`: https, a public host, no user name or password: the web app may load it. */
  | { kind: 'url'; url: string; host: string; safe: boolean; problem?: string }
  | { kind: 'invalid' };

/** Reads an `image` value: a project file id, an http(s) address, or nothing usable. */
export function imageSource(value: unknown): ImageSource {
  if (typeof value !== 'string' || !value.trim() || value.length > IMAGE_URL_MAX)
    return { kind: 'invalid' };
  const v = value.trim();
  if (IMAGE_FILE_ID.test(v)) return { kind: 'file', fileId: v };
  if (!/^https?:\/\/\S+$/i.test(v)) return { kind: 'invalid' };
  const url = parseUrl(v);
  if (!url?.hostname) return { kind: 'invalid' };
  const host = url.hostname.replace(/^www\./, '');
  const problem =
    url.protocol !== 'https:'
      ? "it isn't https"
      : url.username || url.password
        ? 'it carries a user name or password'
        : privateHost(url.hostname)
          ? 'it points at this computer or a private network'
          : undefined;
  return { kind: 'url', url: url.href, host, safe: !problem, ...(problem ? { problem } : {}) };
}

/** The address the web app may load as a picture, or null (not https, private host, a file id). */
export function safeImageUrl(value: unknown): string | null {
  const source = imageSource(value);
  return source.kind === 'url' && source.safe ? source.url : null;
}

/** The host a reader sees under a picture ("example.com"), or null for anything but http(s). */
export function hostOf(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  const url = parseUrl(value);
  return url?.hostname ? url.hostname.replace(/^www\./, '') : null;
}

/** An artifact's `image`: an http(s) address of the picture, or a project file id. */
export const ImageRef = z
  .string()
  .min(1)
  .max(IMAGE_URL_MAX)
  .refine((v) => imageSource(v).kind !== 'invalid', {
    message: 'Use an https address of the picture, or the id of a project image file (file_…)',
  });
