import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { createView } from './service.js';
import { viewAt, viewVersions } from './versions.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };
const doc = (content: string) => ({
  blocks: [{ kind: 'block', id: 'lead', node: { component: 'Text', content } }],
});

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } }],
  });
  const p = created.p!;
  const main = createView(store, agent, {
    projectId: p,
    name: 'About the garden',
    main: true,
    doc: doc('# Garden\n\nGrow food for the family.'),
    message: 'The main page',
  });
  return { store, p, mainId: main.view.id };
}

describe('the main page', () => {
  it('is made by view_create with main, pinned and first', () => {
    const { store, mainId } = setup();
    const view = store.get(mainId)!;
    expect(view.data).toMatchObject({ kind: 'main', pinned: true, order: -1 });
  });

  it('is one per project and a document', () => {
    const { store, p } = setup();
    expect(() =>
      createView(store, agent, {
        projectId: p,
        name: 'Another',
        main: true,
        doc: doc('x'),
        message: 'again',
      }),
    ).toThrow(/already has a main page/);
    expect(() =>
      store.apply(me, {
        message: 'board main',
        operations: [
          {
            op: 'create',
            type: 'view',
            data: {
              projectId: p,
              name: 'B',
              kind: 'main',
              spec: { component: 'Board', widgets: [] },
            },
          },
        ],
      }),
    ).toThrow(/main page is a document/);
  });

  it('agents revise it but never archive, delete or demote it; the owner can', () => {
    const { store, mainId } = setup();
    const update = (author: Author, data: Record<string, unknown>) =>
      store.apply(author, {
        message: 'change',
        operations: [{ op: 'update', type: 'view', id: mainId, data }],
      });
    update(agent, { doc: doc('# Garden\n\nGrow food, and teach the kids.') });
    expect(() => update(agent, { archived: true })).toThrow(/revised, not archived/);
    expect(() => update(agent, { kind: 'saved' })).toThrow(/revised, not archived/);
    expect(() =>
      store.apply(agent, {
        message: 'delete',
        operations: [{ op: 'delete', type: 'view', id: mainId }],
      }),
    ).toThrow(/revised, not archived/);
    update(me, { archived: true });
    expect((store.get(mainId)!.data as { archived?: boolean }).archived).toBe(true);
  });
});

describe('project-management views', () => {
  it('only the owner pins one; a new project’s Overview starts unpinned', () => {
    const { store, p } = setup();
    const overview = store.list('view', { projectId: p }).find((v) => v.data.template);
    expect(overview?.data.pinned).toBe(false);
    const pin = (author: Author) =>
      store.apply(author, {
        message: 'pin',
        operations: [{ op: 'update', type: 'view', id: overview!.id, data: { pinned: true } }],
      });
    expect(() => pin(agent)).toThrow(/only the owner pins a project-management view/);
    pin(me);
    expect(store.get(overview!.id)!.data).toMatchObject({ pinned: true });
  });
});

describe('view versions', () => {
  it('lists every change to a view, newest first, and the view as each one left it', async () => {
    const { store, mainId } = setup();
    store.apply(agent, {
      message: 'Teach the kids too',
      operations: [
        {
          op: 'update',
          type: 'view',
          id: mainId,
          data: { doc: doc('Grow food, teach the kids.') },
        },
      ],
    });
    const versions = viewVersions(store, mainId);
    expect(versions.map((v) => v.message)).toEqual(['Teach the kids too', 'The main page']);
    expect(versions[0]).toMatchObject({ op: 'update', author: agent });
    const at = viewAt(store, mainId, versions[0]!.revision);
    expect(JSON.stringify(at.before?.doc)).toContain('Grow food for the family.');
    expect(JSON.stringify(at.after?.doc)).toContain('teach the kids');
    store.revert(versions[0]!.revision, me);
    expect(viewVersions(store, mainId)[1]!.revertedBy).toBeGreaterThan(0);

    const app = createApp(store);
    const res = await app.request(`/api/views/${mainId}/versions`);
    expect(((await res.json()) as unknown[]).length).toBe(3);
    expect((await app.request(`/api/views/${mainId}/versions/99999`)).status).toBe(404);
  });
});
