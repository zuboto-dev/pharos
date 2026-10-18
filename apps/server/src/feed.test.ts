import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { RevisionFeed, type ReportAssetsEvent, type RevisionEvent } from './feed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { VERSION, webBuildId } from './version.js';
import { ReportAssets } from './views/report.js';
import { createView } from './views/service.js';

const agent: Author = { kind: 'agent', name: 'test' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function createProject(store: Store, name: string) {
  return store.apply(agent, {
    message: `Create ${name}`,
    operations: [{ op: 'create', type: 'project', data: { name } }],
  }).created['0']!;
}

describe('RevisionFeed', () => {
  it('announces revisions committed in this process right away, with their projects', () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const events: RevisionEvent[] = [];
    feed.subscribe((e) => events.push(e));
    const id = createProject(store, 'A');
    expect(events).toEqual([{ id: 1, projectIds: [id] }]);
  });

  it('picks up revisions written by another process sharing the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pharos-feed-'));
    dirs.push(dir);
    const file = join(dir, 'db.sqlite');
    const server = new Store(openDatabase(file));
    const other = new Store(openDatabase(file)); // e.g. the stdio MCP server
    const feed = new RevisionFeed(server, 20);
    const events: RevisionEvent[] = [];
    const unsubscribe = feed.subscribe((e) => events.push(e));
    const id = createProject(other, 'From stdio');
    await vi.waitFor(() => expect(events).toEqual([{ id: 1, projectIds: [id] }]), {
      timeout: 1000,
    });
    unsubscribe();
  });
});

describe('RevisionFeed resilience', () => {
  it('keeps announcing to other subscribers when one throws', () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events: RevisionEvent[] = [];
    feed.subscribe(() => {
      throw new Error('stream closed');
    });
    feed.subscribe((e) => events.push(e));
    createProject(store, 'A');
    createProject(store, 'B');
    expect(events.map((e) => e.id)).toEqual([1, 2]);
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('tries again after a failed read instead of giving up', () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(store, 'revisionsSince').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    const events: RevisionEvent[] = [];
    feed.subscribe((e) => events.push(e));
    const id = createProject(store, 'A'); // the commit hook's read fails and is logged
    expect(events).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    feed.check(); // the next poll catches up
    expect(events).toEqual([{ id: 1, projectIds: [id] }]);
    errors.mockRestore();
  });
});

function pageView(store: Store, name = 'Story') {
  const projectId = createProject(store, `${name} project`);
  return createView(store, agent, {
    projectId,
    name,
    message: 'A page',
    page: { html: '<img src="a.png">' },
  }).view.id;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('RevisionFeed: report asset uploads (R13.5)', () => {
  it('announces uploads once per view per check, however many files arrived', async () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const a = pageView(store, 'A');
    const b = pageView(store, 'B');
    const assets = new ReportAssets(store);
    assets.put(agent, a, 'before.png', new Uint8Array([1]));
    await tick();
    const events: ReportAssetsEvent[] = [];
    const stop = feed.subscribeAssets((e) => events.push(e));
    feed.check();
    expect(events).toEqual([]); // what came before was loaded with the page
    for (let i = 0; i < 37; i++) assets.put(agent, a, `img/${i}.png`, new Uint8Array([i + 1]));
    feed.check();
    expect(events).toEqual([{ type: 'report-assets', viewId: a, at: expect.any(String) }]);
    feed.check();
    expect(events).toHaveLength(1);
    await tick();
    assets.put(agent, b, 'x.png', new Uint8Array([1]));
    assets.put(agent, a, 'img/0.png', new Uint8Array([9])); // a replaced file counts too
    feed.check();
    expect(
      events
        .slice(1)
        .map((e) => e.viewId)
        .sort(),
    ).toEqual([a, b].sort());
    stop();
    await tick();
    assets.put(agent, b, 'y.png', new Uint8Array([1]));
    feed.check();
    expect(events).toHaveLength(3);
  });

  it('picks up uploads from another process by polling, and survives a failed read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pharos-feed-'));
    dirs.push(dir);
    const file = join(dir, 'db.sqlite');
    const server = new Store(openDatabase(file));
    const other = new Store(openDatabase(file)); // e.g. the stdio MCP server
    const id = pageView(other);
    const feed = new RevisionFeed(server, 20);
    const events: ReportAssetsEvent[] = [];
    const stop = feed.subscribeAssets((e) => events.push(e));
    await tick();
    new ReportAssets(other).put(agent, id, 'a.png', new Uint8Array([1]));
    await vi.waitFor(() => expect(events.map((e) => e.viewId)).toEqual([id]), { timeout: 1000 });
    stop();

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = new Store(openDatabase(':memory:'));
    const quiet = new RevisionFeed(local, 0);
    const seen: ReportAssetsEvent[] = [];
    quiet.subscribeAssets(() => {
      throw new Error('stream closed');
    });
    quiet.subscribeAssets((e) => seen.push(e));
    const view = pageView(local);
    new ReportAssets(local).put(agent, view, 'a.png', new Uint8Array([1]));
    vi.spyOn(local.database, 'prepare').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    expect(() => quiet.check()).not.toThrow();
    quiet.check();
    expect(seen.map((e) => e.viewId)).toEqual([view]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('GET /api/events', () => {
  it('streams a ready event, then one event per revision', async () => {
    const store = new Store(openDatabase(':memory:'));
    const app = createApp(store, new RevisionFeed(store, 0));
    const controller = new AbortController();
    const res = await app.request('/api/events', { signal: controller.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (pattern: RegExp) => {
      while (!pattern.test(text)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil(/event: ready/);
    const id = createProject(store, 'Live');
    await readUntil(/event: revision/);
    expect(text).toContain(`data: {"id":1,"projectIds":["${id}"]}`);
    controller.abort();
    await reader.cancel();
  });

  it('streams report-assets when files of a page are uploaded (R13.5)', async () => {
    const store = new Store(openDatabase(':memory:'));
    const feed = new RevisionFeed(store, 0);
    const app = createApp(store, feed);
    const view = pageView(store);
    const controller = new AbortController();
    const res = await app.request('/api/events', { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (pattern: RegExp) => {
      while (!pattern.test(text)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil(/event: ready/);
    await tick();
    const put = await app.request(`/api/views/${view}/page/img/a.png`, {
      method: 'PUT',
      body: new Uint8Array([1, 2]),
      headers: { 'x-pharos-author': 'agent:Opus 5.5' },
    });
    expect(put.status).toBe(200);
    feed.check(); // the server's poll
    await readUntil(/event: report-assets\ndata: .*\n/);
    const data = JSON.parse(
      /event: report-assets\ndata: (.*)\n/.exec(text)![1]!,
    ) as ReportAssetsEvent;
    expect(data).toMatchObject({ type: 'report-assets', viewId: view });
    controller.abort();
    await reader.cancel();
  });
});

describe('build id on the events stream', () => {
  const readReady = async (app: ReturnType<typeof createApp>) => {
    const controller = new AbortController();
    const res = await app.request('/api/events', { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!/event: ready\ndata: .*\n/.test(text))
      text += decoder.decode((await reader.read()).value);
    controller.abort();
    await reader.cancel();
    return JSON.parse(/event: ready\ndata: (.*)\n/.exec(text)![1]!) as Record<string, unknown>;
  };

  it('sends the version, and the web build when one is served', async () => {
    const store = new Store(openDatabase(':memory:'));
    expect(await readReady(createApp(store, new RevisionFeed(store, 0)))).toEqual({
      latest: 0,
      version: VERSION,
    });
    const built = createApp(store, new RevisionFeed(store, 0), undefined, { buildId: 'abc123' });
    expect(await readReady(built)).toMatchObject({ version: VERSION, build: 'abc123' });
  });

  it('changes when the built web app changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pharos-web-'));
    dirs.push(dir);
    expect(webBuildId(dir)).toBeUndefined();
    writeFileSync(join(dir, 'index.html'), '<script src="/assets/index-a1.js"></script>');
    const first = webBuildId(dir);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(webBuildId(dir)).toBe(first);
    writeFileSync(join(dir, 'index.html'), '<script src="/assets/index-b2.js"></script>');
    expect(webBuildId(dir)).not.toBe(first);
  });
});
