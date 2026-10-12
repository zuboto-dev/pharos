import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { RevisionFeed, type RevisionEvent } from './feed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { VERSION, webBuildId } from './version.js';

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
