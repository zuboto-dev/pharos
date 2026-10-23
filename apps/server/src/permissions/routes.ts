import { PermissionChangeInput, PermissionUndoInput, PermissionWriteInput } from '@pharos/schema';
import { Hono, type MiddlewareHandler } from 'hono';
import { sameOriginOnly } from '../files/routes.js';
import type { PermissionService } from './service.js';

/**
 * `/api/permissions*`: the owner's Claude Code permissions (Settings → Agent permissions).
 *
 * Agents never write their own permissions. Every route needs `X-Pharos-Author: human:…` (a
 * missing header is refused too, unlike most routes) and proof the request comes from the Pharos
 * page itself (`sameOriginOnly`). No MCP tool reaches any of this.
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

/** Mounted at `/api/permissions`. */
export function permissionRoutes(service: PermissionService) {
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
  return api;
}
