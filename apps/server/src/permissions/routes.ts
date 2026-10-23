import {
  PermissionAskAnswer,
  PermissionAskInput,
  PermissionChangeInput,
  PermissionTarget,
  PermissionUndoInput,
  PermissionWriteInput,
} from '@pharos/schema';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { sameOriginOnly } from '../files/routes.js';
import type { PermissionAsks } from './asks.js';
import type { PermissionService } from './service.js';

/**
 * `/api/permissions*`: the owner's Claude Code permissions (Settings → Agent permissions).
 *
 * Agents never write their own permissions. Every route needs `X-Pharos-Author: human:…` (a
 * missing header is refused too, unlike most routes) and proof the request comes from the Pharos
 * page itself (`sameOriginOnly`). No MCP tool reaches any of this.
 *
 * `/api/permission-asks` is the Claude Code hook's: it reports a permission prompt and waits for
 * the owner's answer. It can't answer or change anything itself, and browsers are refused there
 * (a page on another site can't make asks appear).
 */

const ownerOnly: MiddlewareHandler = async (c, next) => {
  const author = c.req.header('x-pharos-author');
  if (!author || author.split(':')[0] !== 'human' || !author.slice(6).trim())
    return c.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the owner changes Claude Code permissions, from the Pharos page',
        },
      },
      403,
    );
  await next();
};

/** The hook is a local program, never a browser: no Origin, no Sec-Fetch-Site, small bodies. */
const hookOnly: MiddlewareHandler = async (c, next) => {
  const browser =
    c.req.header('origin') !== undefined || c.req.header('sec-fetch-site') !== undefined;
  const size = Number(c.req.header('content-length') ?? 0);
  if (browser)
    return c.json(
      { error: { code: 'forbidden', message: 'Only the Claude Code hook uses this' } },
      403,
    );
  if (size > 256 * 1024) return c.json({ error: { code: 'invalid', message: 'Too large' } }, 413);
  await next();
};

const MAX_WAITING = 50;

/** Mounted at `/api/permissions`. */
export function permissionRoutes(service: PermissionService, asks?: PermissionAsks) {
  const api = new Hono();
  api.use('*', sameOriginOnly, ownerOnly);
  api.get('/', async (c) => c.json(await service.overview()));
  api.post('/preview', async (c) =>
    c.json(await service.preview(PermissionChangeInput.parse(await c.req.json()))),
  );
  api.post('/write', async (c) =>
    c.json(await service.write(PermissionWriteInput.parse(await c.req.json()))),
  );
  api.post('/undo', async (c) =>
    c.json(service.undo(PermissionUndoInput.parse(await c.req.json()).id)),
  );
  if (asks) {
    api.get('/asks', (c) => c.json(asks.list()));
    api.post('/asks/:id/preview', async (c) => {
      const { target } = z
        .object({ target: PermissionTarget.default('local') })
        .parse(await c.req.json().catch(() => ({})));
      return c.json(asks.preview(c.req.param('id'), target));
    });
    api.post('/asks/:id/answer', async (c) =>
      c.json(asks.answer(c.req.param('id'), PermissionAskAnswer.parse(await c.req.json()))),
    );
  }
  return api;
}

/** Mounted at `/api/permission-asks`: the hook's side. */
export function permissionAskRoutes(asks: PermissionAsks) {
  const api = new Hono();
  api.use('*', hookOnly);
  api.post('/', async (c) => {
    const input = PermissionAskInput.parse(await c.req.json());
    if (asks.list().filter((a) => a.status === 'waiting').length >= MAX_WAITING)
      return c.json({ error: { code: 'invalid', message: 'Too many asks waiting' } }, 429);
    const ask = await asks.create(input);
    // `wait: false`: an unattended run; the hook exits at once and Claude Code goes on as usual.
    return c.json({ id: ask.id, expiresAt: ask.expiresAt, wait: ask.status === 'waiting' }, 201);
  });
  api.get('/:id/wait', async (c) => {
    const ms = z.coerce.number().int().min(0).max(120_000).catch(30_000).parse(c.req.query('ms'));
    return c.json(await asks.wait(c.req.param('id'), ms));
  });
  return api;
}
