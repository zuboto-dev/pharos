import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { createView } from './service.js';
import { restoreVersion, viewAt, viewVersions } from './versions.js';
import { AgentFiles, HIDDEN_REVISION_MESSAGE } from '../store/agent-files.js';

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

  it('warns when it shows more than 200 words before its details', () => {
    const { store, p } = setup();
    const main = store.list('view', { projectId: p }).find((v) => v.data.kind === 'main')!;
    store.apply(me, {
      message: 'make room',
      operations: [{ op: 'update', type: 'view', id: main.id, data: { kind: null } }],
    });
    const long = createView(store, agent, {
      projectId: p,
      name: 'Wordy',
      main: true,
      doc: { ...doc('word '.repeat(250)), summary: 'Wordy' },
      message: 'too many words',
    });
    expect(long.preview.warnings.join('\n')).toMatch(/shows 250 words before any details/);
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
    expect(versions[0]!.changes).toEqual({ added: 0, changed: 1, removed: 0, of: 'blocks' });
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

describe('restoring a version', () => {
  it('brings back the content and the evidence it was written from, as a new change', () => {
    const { store, mainId, p } = setup();
    const first = store.get(mainId)!.data as { evidenceRevision?: number };
    expect(first.evidenceRevision).toBeGreaterThan(0);
    // Later work, then the agent rewrites the page from the newer data.
    store.apply(agent, {
      message: 'work',
      operations: [{ op: 'create', type: 'task', data: { projectId: p, title: 'Dig' } }],
    });
    store.apply(
      agent,
      {
        message: 'Rewrite',
        operations: [{ op: 'update', type: 'view', id: mainId, data: { doc: doc('New text') } }],
      },
      { evidence: true },
    );
    const original = viewVersions(store, mainId).at(-1)!.revision;
    restoreVersion(store, me, mainId, original);
    const now = store.get(mainId)!.data as { doc?: unknown; evidenceRevision?: number };
    expect(JSON.stringify(now.doc)).toContain('Grow food for the family.');
    expect(now.evidenceRevision).toBe(first.evidenceRevision);
    expect(viewVersions(store, mainId)[0]!.message).toMatch(
      /^Restore “About the garden” to its version of/,
    );
  });

  it('refuses to put a board version onto the main page', () => {
    const { store, p } = setup();
    const { created } = store.apply(me, {
      message: 'a board',
      operations: [
        {
          op: 'create',
          type: 'view',
          ref: 'b',
          data: { projectId: p, name: 'Plan', spec: { component: 'Board', widgets: [] } },
        },
      ],
    });
    const boardRev = viewVersions(store, created.b!)[0]!.revision;
    const main = store.list('view', { projectId: p }).find((v) => v.data.kind === 'main')!;
    store.apply(me, {
      message: 'swap',
      operations: [
        { op: 'update', type: 'view', id: main.id, data: { kind: null } },
        {
          op: 'update',
          type: 'view',
          id: created.b!,
          data: { kind: 'main', doc: doc('Plan'), spec: null },
        },
      ],
    });
    expect(() => restoreVersion(store, me, created.b!, boardRev)).toThrow(
      /main page is a document/,
    );
  });
});

describe('versions as agents see them', () => {
  it('a version whose revision also changed a hidden file gets a neutral message', () => {
    const { store, mainId, p } = setup();
    const files = { visible: (id: string) => !id.startsWith('task_') } as unknown as AgentFiles;
    const { revision } = store.apply(me, {
      message: 'Passport scan noted; page updated',
      operations: [
        {
          op: 'create',
          type: 'task',
          data: { projectId: p, title: 'x' },
        },
        { op: 'update', type: 'view', id: mainId, data: { doc: doc('Changed') } },
      ],
    });
    expect(viewVersions(store, mainId, 10, files)[0]!.message).toBe(HIDDEN_REVISION_MESSAGE);
    expect(viewAt(store, mainId, revision!.id, files).version.message).toBe(
      HIDDEN_REVISION_MESSAGE,
    );
    expect(viewVersions(store, mainId)[0]!.message).toBe('Passport scan noted; page updated');
  });
});
