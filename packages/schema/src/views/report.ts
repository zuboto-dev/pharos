import { z } from 'zod';
import { Filter, QueryableType } from './query.js';

/**
 * Report pages (R13): the agent writes the whole page as HTML; Pharos serves it in a locked
 * frame and gives it live data through named reads. docs/reframe/r13-report-pages.md has the
 * contract.
 */
export const REPORT_LIMITS = {
  htmlChars: 2_000_000,
  reads: 30,
  assetBytes: 10 * 1024 * 1024,
  viewAssetBytes: 64 * 1024 * 1024,
  /** All report pages' files together, including those of deleted pages still kept (R13.6). */
  totalAssetBytes: 1024 * 1024 * 1024,
} as const;

/** Asset file types a report page may ship (by extension). */
export const REPORT_ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** A named read: rows the page gets through `pharos.data(name)`. */
export const ReportRead = z.strictObject({
  type: QueryableType,
  filter: Filter.optional(),
});
export type ReportRead = z.infer<typeof ReportRead>;

export const ReportPage = z.strictObject({
  html: z
    .string()
    .min(1)
    .max(REPORT_LIMITS.htmlChars)
    .describe('The whole page as an HTML document, written by the agent'),
  data: z
    .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/), ReportRead)
    .refine((d) => Object.keys(d).length <= REPORT_LIMITS.reads, {
      message: `At most ${REPORT_LIMITS.reads} named reads`,
    })
    .optional()
    .describe('Named reads the page gets live through pharos.data(name)'),
  summary: z.string().max(400).optional().describe('One or two sentences: what the page says'),
});
export type ReportPage = z.infer<typeof ReportPage>;

/** An asset path inside a report page: relative, no "..", a known file type. */
export const ReportAssetPath = z
  .string()
  .max(200)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/)
  .refine((p) => (p.split('.').pop() ?? '').toLowerCase() in REPORT_ASSET_TYPES, {
    message: `File type must be one of ${Object.keys(REPORT_ASSET_TYPES).join(', ')}`,
  });
