import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { REPORT_GUIDE } from '../guidance.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { BRIDGE_SCRIPT } from './bridge.js';
import { REPORT_CSP, ReportAssets } from './report.js';
import { createView } from './service.js';

// R13: serving report pages and their assets, uploads over REST, and the MCP tools.

const me = { kind: 'human' as const, name: 'me' };
const agent = { kind: 'agent' as const, name: 'Opus 5.5' };
const PAGE =
  '<!DOCTYPE html><html><head><script>window.first = 1</script></head><body>Hi</body></html>';

let store: Store;
let app: ReturnType<typeof createApp>;
let projectId: string;
let pageView: string;
let otherPage: string;
let board: string;

beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  app = createApp(store);
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Money' } }],
  });
  projectId = created.p!;
  const page = (html: string) =>
    createView(store, agent, { projectId, name: 'Story', message: 'm', page: { html } }).view.id;
  pageView = page(PAGE);
  otherPage = page('<p>Other</p>');
  board = createView(store, me, {
    projectId,
    name: 'Board',
    message: 'm',
    widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
  }).view.id;
  new ReportAssets(store).put(agent, pageView, 'img/a.png', new Uint8Array([1, 2, 3]));
  new ReportAssets(store).put(agent, pageView, 'fonts/a.woff2', new Uint8Array([4]));
});

const EXACT_CSP =
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals; default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";

describe('GET /api/views/:id/page/ (R13)', () => {
  it('serves the page with the contract headers and the bridge first', async () => {
    expect(REPORT_CSP).toBe(EXACT_CSP);
    const res = await app.request(`/api/views/${pageView}/page/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(EXACT_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html.startsWith('<!DOCTYPE html><script>(function () {')).toBe(true);
    expect(html.indexOf(BRIDGE_SCRIPT.slice(0, 40))).toBeLessThan(html.indexOf('window.first'));
    expect(html).toContain('var initial = null;');
    const dark = await (await app.request(`/api/views/${pageView}/page/?theme=dark`)).text();
    expect(dark).toContain('var initial = "dark";');
    const odd = await (await app.request(`/api/views/${pageView}/page/?theme=%22x`)).text();
    expect(odd).toContain('var initial = null;');
  });

  it('redirects /page to /page/ so relative URLs resolve to assets', async () => {
    const res = await app.request(`/api/views/${pageView}/page?theme=dark`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`/api/views/${pageView}/page/?theme=dark`);
  });

  it('answers 404 (a locked page) for a board, a missing view and another entity', async () => {
    for (const id of [board, 'view_000000000000', projectId]) {
      const res = await app.request(`/api/views/${id}/page/`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-security-policy')).toBe(EXACT_CSP);
      expect(await res.text()).toContain('no report page');
    }
  });
});

describe('GET /api/views/:id/page/<asset> (R13)', () => {
  it('serves an asset with its type and the locked headers', async () => {
    const res = await app.request(`/api/views/${pageView}/page/img/a.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe(EXACT_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    // Fonts load in CORS mode from the frame's opaque origin.
    const font = await app.request(`/api/views/${pageView}/page/fonts/a.woff2`, {
      headers: { origin: 'null' },
    });
    expect(font.status).toBe(200);
    expect(font.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('a deleted view serves nothing; undoing the delete serves its assets again (R13.5)', async () => {
    const del = store.apply(me, {
      message: 'Delete the page',
      operations: [{ op: 'delete', type: 'view', id: pageView }],
    });
    for (const path of ['', 'img/a.png'])
      expect((await app.request(`/api/views/${pageView}/page/${path}`)).status).toBe(404);
    expect((await app.request(`/api/views/${pageView}/assets`)).status).toBe(404);
    store.revert(del.revision!.id, me);
    const res = await app.request(`/api/views/${pageView}/page/img/a.png`);
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await app.request(`/api/views/${pageView}/page/`)).status).toBe(200);
  });

  it("never serves view A's asset under view B", async () => {
    const res = await app.request(`/api/views/${otherPage}/page/img/a.png`);
    expect(res.status).toBe(404);
  });

  it('refuses traversal, absolute and encoded paths, and unknown types', async () => {
    const paths = [
      '../a.png',
      '..%2fa.png',
      '%2e%2e/a.png',
      '%2e%2e%2fa.png',
      'img/..%2fimg/a.png',
      '%2fetc/a.png',
      '/img/a.png',
      'img/a.png%00.png',
      'img/a.exe',
      'img/a.html',
      'img%5ca.png',
    ];
    for (const path of paths) {
      const res = await app.request(`http://localhost/api/views/${pageView}/page/${path}`);
      expect(res.status, path).toBe(404);
      expect(new Uint8Array(await res.arrayBuffer())[0], path).not.toBe(1);
    }
  });

  it('accepts Origin: null only for reads of pages and assets', async () => {
    const put = await app.request(`/api/views/${pageView}/page/img/b.png`, {
      method: 'PUT',
      headers: { origin: 'null' },
      body: new Uint8Array([9]),
    });
    expect(put.status).toBe(403);
    const other = await app.request(`/api/projects/${projectId}/data`, {
      headers: { origin: 'null' },
    });
    expect(other.status).toBe(403);
    const foreign = await app.request(`/api/views/${pageView}/page/img/a.png`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
  });
});

describe('asset uploads over REST (R13)', () => {
  const put = (id: string, path: string, body: Uint8Array, author?: string) =>
    app.request(`/api/views/${id}/page/${path}`, {
      method: 'PUT',
      headers: author ? { 'x-pharos-author': author } : {},
      body,
    });

  it('the owner or an agent uploads; the list shows it', async () => {
    expect((await put(pageView, 'img/b.svg', new Uint8Array([60]))).status).toBe(200);
    expect((await put(pageView, 'img/c.webp', new Uint8Array([1]), 'agent:Codex')).status).toBe(
      200,
    );
    const list = (await (await app.request(`/api/views/${pageView}/assets`)).json()) as {
      path: string;
    }[];
    expect(list.map((a) => a.path)).toEqual([
      'fonts/a.woff2',
      'img/a.png',
      'img/b.svg',
      'img/c.webp',
    ]);
    const served = await app.request(`/api/views/${pageView}/page/img/b.svg`);
    expect(served.headers.get('content-type')).toBe('image/svg+xml');
  });

  it('refuses a board, a bad path, an unknown type and a body over the limit', async () => {
    expect((await put(board, 'a.png', new Uint8Array([1]), 'agent:Codex')).status).toBe(400);
    expect((await put(pageView, '..%2fa.png', new Uint8Array([1]))).status).toBe(400);
    expect((await put(pageView, 'a.exe', new Uint8Array([1]))).status).toBe(400);
    expect((await put('view_000000000000', 'a.png', new Uint8Array([1]))).status).toBe(404);
    const big = await app.request(`/api/views/${pageView}/page/big.png`, {
      method: 'PUT',
      headers: { 'content-length': String(11 * 1024 * 1024) },
      body: new Uint8Array([1]),
    });
    expect(big.status).toBe(400);
  });
});

describe('report tools over MCP (R13)', () => {
  async function connect(name = 'Opus 5.5') {
    const client = new Client({ name, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
      fetch: async (url, init) => app.fetch(new Request(url, init)),
    });
    await client.connect(transport);
    return client;
  }
  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    if (result.isError) throw new Error(text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  it('creates a page, uploads and lists assets, previews, gets the guide', async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain('report_guide');
    const guide = await call(client, 'report_guide', {});
    expect(guide).toBe(REPORT_GUIDE);
    const made = await call(client, 'view_create', {
      projectId,
      name: 'Story',
      message: 'A report page',
      page: { html: '<!doctype html><img src="img/x.svg">', summary: 'S' },
    });
    expect(made.preview.warnings.join('\n')).toContain('img/x.svg');
    const id = made.view.id as string;
    const saved = await call(client, 'report_asset_put', {
      viewId: id,
      path: 'img/x.svg',
      base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
    });
    expect(saved.saved).toMatchObject({ path: 'img/x.svg', mime: 'image/svg+xml' });
    expect(await call(client, 'report_asset_list', { viewId: id })).toHaveLength(1);
    const preview = await call(client, 'view_preview', { viewId: id });
    expect(preview.warnings.join('\n')).not.toContain('img/x.svg');
    const got = await call(client, 'view_get', { viewId: id });
    expect(got.page.html).toContain('img/x.svg');
    expect(got.assets).toHaveLength(1);
    await expect(
      call(client, 'report_asset_put', { viewId: board, path: 'a.png', base64: 'AA==' }),
    ).rejects.toThrow(/is a board/);
    await expect(
      call(client, 'report_asset_put', { viewId: id, path: '../a.png', base64: 'AA==' }),
    ).rejects.toThrow(/isn't allowed/);
    await expect(call(client, 'report_asset_list', { viewId: board })).rejects.toThrow(
      /is a board/,
    );
    const draft = await call(client, 'view_preview', {
      projectId,
      page: { html: '<script src="https://evil.example/x.js"></script>' },
    });
    expect(draft.warnings.join('\n')).toContain('evil.example');
  });
});
