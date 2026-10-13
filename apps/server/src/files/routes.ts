import { Author, FileAction } from '@pharos/schema';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { FileError, type FileService } from './service.js';

/**
 * The file routes (R7.2, FILE_ROUTES in @pharos/schema). The app already refuses non-local hosts
 * and origins; these also need proof the request comes from the Pharos page itself, so another
 * site (or another local port) can't embed, download or act on the owner's files:
 * - an `Origin` naming this very host and port, or
 * - for GET without `Origin` (an <img>, <iframe> or link), `Sec-Fetch-Site: same-origin` or
 *   `none` (typed in the address bar).
 * Writes and actions always need the matching `Origin`. Clients outside a browser send it too.
 */
export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  const host = new URL(c.req.url).host;
  const origin = c.req.header('origin');
  const site = c.req.header('sec-fetch-site');
  let ok: boolean;
  if (origin) {
    try {
      ok = new URL(origin).host === host;
    } catch {
      ok = false;
    }
  } else {
    ok =
      (c.req.method === 'GET' || c.req.method === 'HEAD') &&
      (site === 'same-origin' || site === 'none');
  }
  if (site && site !== 'same-origin' && site !== 'none') ok = false;
  if (!ok)
    return c.json(
      { error: { code: 'forbidden', message: 'File routes only answer the Pharos page' } },
      403,
    );
  await next();
};

/** The acting author: `X-Pharos-Author`, default the owner. The store refuses agents adding files. */
function authorOf(c: Context): Author {
  const header = c.req.header('x-pharos-author');
  if (!header) return { kind: 'human', name: 'me' };
  const [kind, ...name] = header.split(':');
  return Author.parse({ kind, name: name.join(':') });
}

function fileError(c: Context, error: unknown) {
  if (error instanceof FileError)
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  throw error;
}

const Limit = z.coerce.number().int().min(1).max(500).default(100);

/** Mounted under `/api`. */
export function fileRoutes(files: FileService): Hono {
  const api = new Hono();
  for (const path of [
    '/settings/folders/:folderId/scan',
    '/projects/:projectId/scanned-files',
    '/projects/:projectId/files',
    '/files/:fileId',
    '/files/:fileId/*',
  ])
    api.use(path, sameOriginOnly);

  api.post('/settings/folders/:folderId/scan', (c) => c.json(files.scan(c.req.param('folderId'))));

  api.get('/projects/:projectId/scanned-files', (c) =>
    c.json(
      files.scanned(
        c.req.param('projectId'),
        c.req.query('q') ?? '',
        Limit.parse(c.req.query('limit')),
      ),
    ),
  );

  api.post('/projects/:projectId/files', async (c) =>
    c.json(await files.add(c.req.param('projectId'), await c.req.json(), authorOf(c))),
  );

  api.get('/files/:fileId', async (c) => c.json(await files.info(c.req.param('fileId'))));

  api.get('/files/:fileId/content', (c) =>
    files.contents(c.req.param('fileId'), 'content').catch((e: unknown) => fileError(c, e)),
  );

  api.get('/files/:fileId/download', (c) =>
    files.contents(c.req.param('fileId'), 'download').catch((e: unknown) => fileError(c, e)),
  );

  api.post('/files/:fileId/actions/:action', async (c) => {
    const action = FileAction.safeParse(c.req.param('action'));
    if (!action.success)
      return c.json({ error: { code: 'invalid', message: 'Unknown action' } }, 400);
    try {
      await files.action(c.req.param('fileId'), action.data);
    } catch (error) {
      return fileError(c, error);
    }
    return c.json({ ok: true });
  });

  return api;
}
