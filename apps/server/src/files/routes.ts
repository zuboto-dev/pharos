import { Author, FileAction } from '@pharos/schema';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { FileError, type FileService } from './service.js';

/** Whether `Origin` names this very origin: the same scheme, host and effective port. */
export function originMatches(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;
  try {
    // URL normalizes default ports ("http://localhost:80" is "http://localhost").
    return new URL(origin).origin === new URL(c.req.url).origin;
  } catch {
    return false;
  }
}

/**
 * Whether a request carries the proof a browser gives for the Pharos page itself (R7.2, R7.9):
 * - an `Origin` naming this very origin (scheme, host and effective port), or
 * - for GET and HEAD without `Origin` (an <img>, <iframe> or link), `Sec-Fetch-Site:
 *   same-origin` or `none` (typed in the address bar).
 * Any other `Sec-Fetch-Site` fails. Writes and actions always need the matching `Origin`;
 * clients outside a browser send it too.
 */
export function fromPharosPage(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  if (c.req.header('origin') !== undefined) return originMatches(c);
  return (c.req.method === 'GET' || c.req.method === 'HEAD') && site !== undefined;
}

/**
 * The browser guard of the file routes (R7.2, FILE_ROUTES in @pharos/schema), the folder routes
 * and the source-file route. The app already refuses non-local hosts and origins; these also need
 * proof the request comes from the Pharos page itself (`fromPharosPage`), so another site or
 * another local port can't embed, download or act on the owner's files.
 */
export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  if (!fromPharosPage(c))
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
    files
      .contents(c.req.param('fileId'), 'content', c.req.header('range'))
      .catch((e: unknown) => fileError(c, e)),
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
