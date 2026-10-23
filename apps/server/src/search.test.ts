// Search everything (⌘K). Every project, item and word here is made up.
import { FOLDERS_SETTING, type Author, type SearchResult } from '@pharos/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { hrefOf, scoreOf, search, snippetOf } from './search.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const human: Author = { kind: 'human', name: 'me' };

let store: Store;
let ids: Record<string, string>;

beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  store.setSetting(FOLDERS_SETTING, [
    {
      id: 'root_vault0001',
      path: '/made/up/Vault',
      label: 'Vault',
      level: 'hidden',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'root_shared01',
      path: '/made/up/Shared',
      label: 'Shared',
      level: 'details',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
  ]);
  const setup = store.apply(human, {
    message: 'Seed',
    operations: [
      { op: 'create', type: 'project', ref: 'g', data: { name: 'Garden', status: 'active' } },
      { op: 'create', type: 'project', ref: 'old', data: { name: 'Old shed', status: 'archived' } },
      {
        op: 'create',
        type: 'task',
        ref: 'water',
        data: { projectId: '$g', title: 'Water tomatoes' },
      },
      {
        op: 'create',
        type: 'task',
        ref: 'fence',
        data: {
          projectId: '$g',
          title: 'Fix the fence',
          description: 'The east side leans; buy posts before the tomatoes go in.',
        },
      },
      { op: 'create', type: 'goal', ref: 'tom', data: { projectId: '$g', title: 'Tomatoes' } },
      {
        op: 'create',
        type: 'decision',
        ref: 'soil',
        data: { projectId: '$g', title: 'Soil mix', body: 'Two parts compost to one part sand.' },
      },
      {
        op: 'create',
        type: 'task',
        ref: 'shed',
        data: { projectId: '$old', title: 'Paint tomatoes sign' },
      },
      {
        op: 'create',
        type: 'view',
        ref: 'report',
        data: {
          projectId: '$g',
          name: 'Season report',
          pinned: false,
          doc: {
            blocks: [
              {
                kind: 'block',
                id: 'intro',
                node: { component: 'Markdown', content: 'The **zucchini** did best this year.' },
              },
              {
                kind: 'drawing',
                id: 'pic',
                html: '<p>pumpkin</p>',
                height: 120,
              },
            ],
          },
        },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'secret',
        data: {
          projectId: '$g',
          title: 'Seed receipts',
          rootId: 'root_vault0001',
          path: 'receipts.pdf',
          size: 10,
          modifiedAt: '2026-09-01T10:00:00.000Z',
          notes: 'Paid for tomatoes in cash',
        },
      },
      {
        op: 'create',
        type: 'artifact',
        ref: 'copy',
        data: { projectId: '$g', title: 'Receipt summary', fileId: '$secret' },
      },
    ],
  });
  ids = setup.created as Record<string, string>;
});

const titles = (r: SearchResult) => r.hits.map((h) => h.title);

describe('search', () => {
  it('ranks the whole title, then title words, then the text', () => {
    const result = search(store, 'tomatoes');
    expect(titles(result)).toEqual([
      'Tomatoes',
      'Water tomatoes',
      'Seed receipts', // owner: a file's notes count
      'Fix the fence',
    ]);
    const fence = result.hits.find((h) => h.title === 'Fix the fence')!;
    expect(fence.snippet).toContain('tomatoes');
    expect(result.hits[0]!.snippet).toBeUndefined();
  });

  it('needs every word, in any order, and finds words in the text', () => {
    expect(titles(search(store, 'fence posts'))).toEqual(['Fix the fence']);
    expect(titles(search(store, 'sand compost'))).toEqual(['Soil mix']);
    expect(titles(search(store, 'fence compost'))).toEqual([]);
  });

  it('is case-insensitive and treats LIKE characters as text', () => {
    expect(titles(search(store, 'SOIL'))).toEqual(['Soil mix']);
    expect(search(store, '%').hits).toEqual([]);
    expect(search(store, '_').hits).toEqual([]);
  });

  it('leaves out archived projects and their items', () => {
    expect(titles(search(store, 'shed'))).toEqual([]);
    expect(titles(search(store, 'paint'))).toEqual([]);
  });

  it('finds projects and views, with the hrefs the web app opens', () => {
    const [project] = search(store, 'garden').hits;
    expect(project).toMatchObject({
      type: 'project',
      href: `/projects/${ids.g}`,
      project: 'Garden',
    });
    const [view] = search(store, 'season').hits;
    expect(view).toMatchObject({ type: 'view', href: `/projects/${ids.g}/views/${ids.report}` });
    const [task] = search(store, 'water').hits;
    expect(task!.href).toBe(`/projects/${ids.g}?entity=${ids.water}`);
    expect(hrefOf('claim', 'clm_1', 'prj_1')).toBe('/projects/prj_1?entity=clm_1');
  });

  it("reads a document's text blocks, never a drawing's HTML", () => {
    const [hit] = search(store, 'zucchini').hits;
    expect(hit).toMatchObject({ title: 'Season report' });
    expect(hit!.snippet).toBe('The zucchini did best this year.');
    expect(search(store, 'pumpkin').hits).toEqual([]);
  });

  it('breaks ties by the newest change', () => {
    store.apply(human, {
      message: 'Another',
      operations: [{ op: 'create', type: 'task', data: { projectId: ids.g!, title: 'Weed beds' } }],
    });
    store.apply(human, {
      message: 'Touch',
      operations: [{ op: 'update', type: 'task', id: ids.water!, data: { title: 'Water beds' } }],
    });
    expect(titles(search(store, 'beds'))).toEqual(['Water beds', 'Weed beds']);
  });

  it('keeps to the limit', () => {
    expect(search(store, 'e', { limit: 2 }).hits).toHaveLength(2);
    expect(search(store, '   ').hits).toEqual([]);
  });

  it('shows agents no files and nothing copied from a hidden one', () => {
    expect(titles(search(store, 'receipt'))).toEqual(['Receipt summary', 'Seed receipts']);
    expect(titles(search(store, 'receipt', { forAgent: true }))).toEqual([]);
    expect(titles(search(store, 'tomatoes', { forAgent: true }))).not.toContain('Seed receipts');
  });
});

describe('scoring', () => {
  it('orders title kinds', () => {
    const s = (title: string, text = '') => scoreOf(title, [text], ['soil', 'mix'])!;
    expect(s('soil mix')).toBeGreaterThan(s('Soil mix for beds'));
    expect(s('Soil mix for beds')).toBeGreaterThan(s('Beds: mix the soil'));
    expect(s('Beds: mix the soil')).toBeGreaterThan(s('Admixture of topsoil'));
    expect(s('Admixture of topsoil')).toBeGreaterThan(s('Soil', 'a mix'));
    expect(s('Soil', 'a mix')).toBeGreaterThan(s('Beds', 'soil mix'));
    expect(scoreOf('Beds', ['soil'], ['soil', 'mix'])).toBeNull();
  });

  it('cuts a snippet around the match', () => {
    const long = `${'word '.repeat(60)}needle ${'more '.repeat(60)}`.trim();
    const snippet = snippetOf('Title', [long], ['needle'])!;
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(150);
  });
});

describe('GET /api/search', () => {
  it('answers the owner and agents differently', async () => {
    const app = createApp(store);
    const owner = (await (await app.request('/api/search?q=receipt')).json()) as SearchResult;
    expect(titles(owner)).toEqual(['Receipt summary', 'Seed receipts']);
    const agent = (await (
      await app.request('/api/search?q=receipt', { headers: { 'x-pharos-author': 'agent:test' } })
    ).json()) as SearchResult;
    expect(agent.hits).toEqual([]);
    const limited = (await (await app.request('/api/search?q=e&limit=1')).json()) as SearchResult;
    expect(limited.hits).toHaveLength(1);
    expect((await app.request('/api/search?q=e&limit=x')).status).toBe(400);
  });
});
