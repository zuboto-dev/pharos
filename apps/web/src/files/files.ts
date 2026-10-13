import { FILE_ROUTES, type FileAction, type FileMissing } from '@pharos/schema';
import { localToday } from '../lib/format';

/**
 * Small helpers for project files (R7.4): route URLs built from ids only (FILE_ROUTES), sizes,
 * expiry, and a capped text read for previews.
 */

const fill = (route: string, params: Record<string, string>) =>
  route.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));

/** `POST` to run an action on the owner's Mac (reveal in Finder, open in the default app). */
export const fileActionUrl = (fileId: string, action: FileAction) =>
  fill(FILE_ROUTES.action, { fileId, action });

/** `GET` the scan cache for "Add files", optionally narrowed by a name search. */
export function scannedUrl(projectId: string, query = '', limit = 200): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set('q', query.trim());
  return `${fill(FILE_ROUTES.scanned, { projectId })}?${params}`;
}

/** `POST AddFilesInput` adds files from the scan cache as one revision. */
export const addFilesUrl = (projectId: string) => fill(FILE_ROUTES.add, { projectId });

/** The last part of a path, e.g. "2025/Tax/receipt.pdf" → "receipt.pdf". */
export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The lowercase extension without the dot, or '' when there is none. */
export function extensionOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** Bytes as people read them: "830 bytes", "12 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${shown} ${SIZE_UNITS[unit]}`;
}

/** Within this many days, an expiry date is "soon". */
export const EXPIRY_SOON_DAYS = 60;

export type Expiry = 'expired' | 'soon' | 'later';

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when it has passed. */
export const daysUntil = (date: string, today = localToday()) => dayNumber(date) - dayNumber(today);

export function expiryOf(date: string | undefined, today = localToday()): Expiry | null {
  if (!date) return null;
  const days = daysUntil(date, today);
  return days < 0 ? 'expired' : days <= EXPIRY_SOON_DAYS ? 'soon' : 'later';
}

/** Why a file can't be reached, in plain words, and what the owner can do about it. */
export const MISSING_TEXT: Record<FileMissing, string> = {
  'folder-removed':
    'Its folder was removed in Settings. Add the folder again to open this file; its details stay here.',
  'folder-unavailable':
    'Its folder can’t be read right now (a disk that isn’t connected, or a permission). Its details stay here.',
  'file-gone':
    'It isn’t at its path any more, and no file with the same contents was found in its folder. Its details stay here.',
};

type NavigatorExtras = Navigator & {
  pdfViewerEnabled?: boolean;
  userAgentData?: { brands?: { brand: string }[] };
};

/**
 * Chrome (and other Chromium browsers) won't show a PDF inside a sandboxed frame; it shows a
 * "blocked" page instead. There the drawer offers the PDF in a new tab rather than a broken frame.
 */
export function canFramePdf(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const extras = nav as NavigatorExtras;
  if (extras.pdfViewerEnabled === false) return false;
  if ((extras.userAgentData?.brands ?? []).some((b) => /Chrom/i.test(b.brand))) return false;
  return !/\b(Chrome|Chromium|CriOS|Edg)\//.test(nav.userAgent ?? '');
}

/**
 * Reads at most `max` bytes of a text file, so a big log can't freeze the drawer. Returns the
 * decoded text and whether it stopped early.
 */
export async function readTextLimited(
  url: string,
  max: number,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body?.getReader();
  let bytes: Uint8Array;
  if (!reader) bytes = new Uint8Array(await res.arrayBuffer());
  else {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
      if (length > max) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const truncated = bytes.length > max;
  // `stream: true` drops a multi-byte character cut in half at the limit.
  const text = new TextDecoder().decode(bytes.subarray(0, max), { stream: truncated });
  return { text, truncated };
}
