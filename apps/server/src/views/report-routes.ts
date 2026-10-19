import { REPORT_LIMITS, type Author, type Entity } from '@pharos/schema';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { injectBridge, type PageTheme } from './bridge.js';
import { docBlock } from './doc.js';
import {
  EMBED_SANDBOX,
  ReportAssets,
  assetPath,
  embedCsp,
  pageOf,
  pageSource,
  reportCsp,
} from './report.js';

/**
 * Report pages over HTTP (R13): the page and its assets, served for a sandboxed frame with the
 * contract's headers, and assets uploaded by the owner or an agent. Report documents (R14): each
 * drawing served the same way at /api/views/:id/doc/:blockId/, and each embed's wrapper page at
 * /api/views/:id/embed/:blockId. Mounted under /api.
 */

/**
 * Headers on every response under /api/views/:id/page: the page, its assets, the 404s, the
 * redirect, refusals and errors, whatever the method (R13.6). The CSP names the view's own page
 * path, from the request's Host (checked: local hosts only).
 */
export function lockedHeaders(
  host: string | undefined,
  viewId: string | undefined,
  /** A drawing of a report document (R14): its own path is the frame's own source. */
  blockId?: string,
) {
  return {
    'Content-Security-Policy': reportCsp(pageSource(host, viewId, blockId)),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/** The request target as the client sent it (before URL parsing resolves "..", "%2e%2e"). */
function rawTarget(c: Context): string | undefined {
  const incoming = (c.env as { incoming?: { url?: unknown } } | undefined)?.incoming;
  return typeof incoming?.url === 'string' ? incoming.url.split('?')[0] : undefined;
}

function decoded(part: string | undefined): string | undefined {
  if (part === undefined) return undefined;
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** Headers on every response for an embed's wrapper (R14): its own CSP, or one framing nothing. */
function embedHeaders(current: string | null): Record<string, string> {
  return {
    'Content-Security-Policy': current?.startsWith(`sandbox ${EMBED_SANDBOX};`)
      ? current
      : embedCsp(null),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
  };
}

/**
 * Sets the locked headers on every response to a request for /api/views/:id/page…, a drawing
 * (/api/views/:id/doc/:blockId…) or an embed wrapper (/api/views/:id/embed…), by the path as
 * parsed or as sent. Mounted first on the app, so it covers the local-only refusal too.
 */
export const lockPageResponses: MiddlewareHandler = async (c, next) => {
  const paths = [new URL(c.req.url).pathname, rawTarget(c) ?? ''];
  const find = (re: RegExp) => paths.map((p) => re.exec(p)).find(Boolean) ?? null;
  const page = find(PAGE_PREFIX);
  const drawing = page ? null : find(DOC_PREFIX);
  const embed = page || drawing ? null : find(EMBED_PREFIX);
  await next();
  if (!page && !drawing && !embed) return;
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  const headers = page
    ? lockedHeaders(host, decoded(page[1]))
    : drawing
      ? lockedHeaders(host, decoded(drawing[1]), decoded(drawing[2]) ?? '')
      : embedHeaders(c.res.headers.get('content-security-policy'));
  try {
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
  } catch {
    // A response with immutable headers: answer with a copy that carries them.
    const res = c.res;
    const copy = new Headers(res.headers);
    for (const [name, value] of Object.entries(headers)) copy.set(name, value);
    c.res = undefined;
    c.res = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copy,
    });
  }
};

/**
 * Headers on the web app's own pages (R13.6). `frame-src 'self'`: a frame in the app may only
 * show Pharos addresses. The browser checks it on every navigation of the frame, including one
 * the report page starts itself (`location.href = 'https://elsewhere/?d=…'`), and refuses it
 * before any request is made; the frame then loads an error page, which the app notices (a
 * second load) and stops the frame. `frame-ancestors 'self'` and X-Frame-Options: no other
 * site may frame the app (R13.6 finding 6).
 */
export const APP_PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "frame-src 'self'; frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
};

/** Fonts and module scripts load in CORS mode from the frame's opaque origin ("null"). */
const CORS_TYPES = /^(font\/|text\/javascript)/;

const PAGE_PREFIX = /^\/api\/views\/([^/]+)\/page(\/.*)?$/;
/** A drawing of a report document (R14) and its files: /api/views/:id/doc/:blockId/… */
const DOC_PREFIX = /^\/api\/views\/([^/]+)\/doc\/([^/]*)(\/.*)?$/;
const EMBED_PREFIX = /^\/api\/views\/([^/]+)\/embed(\/.*)?$/;

/**
 * Whether a request is a read of a report page or a drawing, or one of their assets (the frame
 * sends Origin: null).
 */
export function isPageRead(method: string, path: string): boolean {
  return (
    (method === 'GET' || method === 'HEAD') && (PAGE_PREFIX.test(path) || DOC_PREFIX.test(path))
  );
}

function notFoundPage(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font:14px system-ui;color:#666;padding:24px">${message}</p>`,
    {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}

/**
 * The asset path after /page/, from the raw URL: percent-decoded once, then checked, so an
 * encoded "..", slash or absolute path is refused rather than resolved. Null when it can't be
 * decoded (`%ZZ`): no such file.
 */
function rawAssetPath(c: Context): string | null {
  const pathname = new URL(c.req.url).pathname;
  const page = PAGE_PREFIX.exec(pathname);
  const rest = (page ? page[2] : DOC_PREFIX.exec(pathname)?.[3]) ?? '';
  const raw = rest.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
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

const escapeAttr = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The wrapper page of an embed: one frame of the site filling the page, nothing else. */
export function embedWrapper(url: string, caption?: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeAttr(caption ?? 'Embedded site')}</title>`,
    '<style>html,body{margin:0;height:100%;background:transparent}iframe{display:block;border:0;width:100%;height:100%}</style>',
    '</head><body>',
    `<iframe src="${escapeAttr(url)}" sandbox="${EMBED_SANDBOX}" referrerpolicy="no-referrer" title="${escapeAttr(caption ?? url)}"></iframe>`,
    '</body></html>',
  ].join('');
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

  /** The HTML with the bridge (limited to `reads` for a drawing), or one of the view's assets. */
  const serve = (c: Context, view: Entity<'view'>, html: string, reads?: string[]) => {
    const raw = rawAssetPath(c);
    if (raw === null) return notFoundPage('No such file in this page.');
    if (!raw) {
      const theme = c.req.query('theme');
      return new Response(
        injectBridge(
          html,
          theme === 'dark' || theme === 'light' ? (theme as PageTheme) : undefined,
          reads,
        ),
        {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      );
    }
    let path: string;
    try {
      path = assetPath(raw);
    } catch {
      return notFoundPage('No such file in this page.');
    }
    const asset = assets.get(view.id, path);
    if (!asset) return notFoundPage('No such file in this page.');
    return new Response(asset.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': asset.mime,
        'Content-Length': String(asset.bytes.byteLength),
        'Cache-Control': 'no-cache',
        ...(CORS_TYPES.test(asset.mime) ? { 'Access-Control-Allow-Origin': '*' } : {}),
      },
    });
  };

  routes.get('/views/:id/page/*', (c) => {
    const view = viewWithPage(c.req.param('id'));
    const page = view && pageOf(view);
    if (!view || !page) return notFoundPage('This view has no report page.');
    return serve(c, view, page.html);
  });

  // A drawing of a report document (R14): its HTML in the same locked frame, with the bridge
  // limited to the named reads it lists; its relative URLs resolve to the view's assets.
  routes.get('/views/:id/doc/:blockId', (c) => {
    const query = new URL(c.req.url).search;
    return c.redirect(
      `/api/views/${encodeURIComponent(c.req.param('id'))}/doc/${encodeURIComponent(c.req.param('blockId'))}/${query}`,
      308,
    );
  });

  routes.get('/views/:id/doc/:blockId/*', (c) => {
    const view = viewWithPage(c.req.param('id'));
    const block = view && docBlock(view, c.req.param('blockId'));
    if (!view || block?.kind !== 'drawing') return notFoundPage('This view has no such drawing.');
    return serve(c, view, block.html, block.reads ?? []);
  });

  // An embed of a report document (R14): a wrapper page with no script that frames the site,
  // and only that site's origin (its CSP), sandboxed so the site runs as itself but can never
  // navigate Pharos. The web app frames this wrapper (a Pharos address, so its frame-src 'self'
  // still holds) and always shows a link to open the site.
  routes.get('/views/:id/embed/:blockId', (c) => {
    const view = viewWithPage(c.req.param('id'));
    const block = view && docBlock(view, c.req.param('blockId'));
    if (!view || block?.kind !== 'embed') return notFoundPage('This view has no such embed.');
    return new Response(embedWrapper(block.url, block.caption), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': embedCsp(new URL(block.url).origin),
      },
    });
  });

  // Upload one asset: the raw body is the file (owner or agent, by X-Pharos-Author).
  routes.put('/views/:id/page/*', async (c) => {
    const raw = rawAssetPath(c);
    if (raw === null) throw new PharosError('invalid', 'Asset path is not valid');
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
