import { REPORT_LIMITS, type Author, type Entity } from '@pharos/schema';
import { Hono, type Context } from 'hono';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { injectBridge, type PageTheme } from './bridge.js';
import { ReportAssets, assetPath, pageOf, pageSource, reportCsp } from './report.js';

/**
 * Report pages over HTTP (R13): the page and its assets, served for a sandboxed frame with the
 * contract's headers, and assets uploaded by the owner or an agent. Mounted under /api.
 */

/**
 * Headers on everything served from /views/:id/page/: the page, its assets and the 404s. The
 * CSP names the view's own page path, from the request's Host (checked: local hosts only).
 */
function locked(c: Context): Record<string, string> {
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  return {
    'Content-Security-Policy': reportCsp(pageSource(host, c.req.param('id'))),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/**
 * Headers on the web app's own pages (R13.6). `frame-src 'self'`: a frame in the app may only
 * show Pharos addresses. The browser checks it on every navigation of the frame, including one
 * the report page starts itself (`location.href = 'https://elsewhere/?d=…'`), and refuses it
 * before any request is made; the frame then loads an error page, which the app notices (a
 * second load) and stops the frame.
 */
export const APP_PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "frame-src 'self'",
};

/** Fonts and module scripts load in CORS mode from the frame's opaque origin ("null"). */
const CORS_TYPES = /^(font\/|text\/javascript)/;

const PAGE_PREFIX = /^\/api\/views\/([^/]+)\/page(\/.*)?$/;

/** Whether a request is a read of a report page or asset (the frame sends Origin: null). */
export function isPageRead(method: string, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && PAGE_PREFIX.test(path);
}

function notFoundPage(c: Context, message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font:14px system-ui;color:#666;padding:24px">${message}</p>`,
    {
      status: 404,
      headers: {
        ...locked(c),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * The asset path after /page/, from the raw URL: percent-decoded once, then checked, so an
 * encoded "..", slash or absolute path is refused rather than resolved.
 */
function rawAssetPath(c: Context): string {
  const pathname = new URL(c.req.url).pathname;
  const rest = PAGE_PREFIX.exec(pathname)?.[2] ?? '';
  const raw = rest.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new PharosError('invalid', 'Asset path is not valid');
  }
}

/**
 * The request body, read as a stream and refused as soon as it passes `limit` bytes, whether or
 * not it said its length (R13.6): never more than the limit and one chunk is held.
 */
export async function readLimited(req: Request, limit: number): Promise<Uint8Array> {
  const tooBig = () =>
    new PharosError('invalid', `One asset may be at most ${limit / 1024 / 1024} MB`);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit) throw tooBig();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

export function reportRoutes(store: Store, authorOf: (c: Context) => Author) {
  const routes = new Hono();
  const assets = new ReportAssets(store);

  const viewWithPage = (id: string) => {
    const view = store.get(id);
    if (view?.type !== 'view') return null;
    return view as Entity<'view'>;
  };

  // Relative URLs resolve against /page/, so the page itself lives there.
  routes.get('/views/:id/page', (c) => {
    const query = new URL(c.req.url).search;
    return c.redirect(`/api/views/${encodeURIComponent(c.req.param('id'))}/page/${query}`, 308);
  });

  routes.get('/views/:id/page/*', (c) => {
    const view = viewWithPage(c.req.param('id'));
    const page = view && pageOf(view);
    if (!view || !page) return notFoundPage(c, 'This view has no report page.');
    const raw = rawAssetPath(c);
    if (!raw) {
      const theme = c.req.query('theme');
      const html = injectBridge(
        page.html,
        theme === 'dark' || theme === 'light' ? (theme as PageTheme) : undefined,
      );
      return new Response(html, {
        headers: {
          ...locked(c),
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    let path: string;
    try {
      path = assetPath(raw);
    } catch {
      return notFoundPage(c, 'No such file in this page.');
    }
    const asset = assets.get(view.id, path);
    if (!asset) return notFoundPage(c, 'No such file in this page.');
    return new Response(asset.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        ...locked(c),
        'Content-Type': asset.mime,
        'Content-Length': String(asset.bytes.byteLength),
        'Cache-Control': 'no-cache',
        ...(CORS_TYPES.test(asset.mime) ? { 'Access-Control-Allow-Origin': '*' } : {}),
      },
    });
  });

  // Upload one asset: the raw body is the file (owner or agent, by X-Pharos-Author).
  routes.put('/views/:id/page/*', async (c) => {
    const raw = rawAssetPath(c);
    if (!raw) throw new PharosError('invalid', 'Name the asset: PUT /api/views/:id/page/<path>');
    const body = await readLimited(c.req.raw, REPORT_LIMITS.assetBytes);
    return c.json(assets.put(authorOf(c), c.req.param('id'), raw, body));
  });

  routes.get('/views/:id/assets', (c) => {
    const view = viewWithPage(c.req.param('id'));
    if (!view) throw new PharosError('not_found', `view ${c.req.param('id')} not found`);
    return c.json(assets.list(view.id));
  });

  return routes;
}
