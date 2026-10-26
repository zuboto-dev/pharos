import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { projectBrief } from './brief.js';
import { pageUpkeep } from './page-upkeep.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { createView } from './views/service.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };
const doc = (content: string) => ({
  summary: 'About',
  blocks: [{ kind: 'block', id: 'lead', node: { component: 'Text', content } }],
});

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      {
        op: 'create',
        type: 'stage',
        ref: 's',
        data: { projectId: '$p', name: 'Dig beds', status: 'active', order: 1 },
      },
    ],
  });
  return { store, p: created.p!, s: created.s! };
}

describe('pages to bring up to date (the brief)', () => {
  it('asks for a main page when there is none, with what changed in Pharos', () => {
    const { store, p } = setup();
    const up = pageUpkeep(store, p);
    expect(up.todo).toEqual([expect.stringMatching(/^No main page yet/)]);
    const brief = projectBrief(store, p);
    expect(brief).toContain('## Pages to bring up to date');
    expect(brief).toContain('## What changed in how Pharos pages work');
  });

  it('asks to revise the main page once the project passes an anchor point, and not before', () => {
    const { store, p, s } = setup();
    const main = createView(store, agent, {
      projectId: p,
      name: 'About the garden',
      main: true,
      doc: doc('# Garden\n\nGrow food.'),
      message: 'Main page',
    });
    expect(pageUpkeep(store, p).todo).toEqual([]);
    expect(projectBrief(store, p)).not.toContain('Pages to bring up to date');
    store.apply(agent, {
      message: 'Beds dug',
      operations: [{ op: 'update', type: 'stage', id: s, data: { status: 'done' } }],
    });
    expect(pageUpkeep(store, p).todo).toEqual([
      expect.stringContaining(`(${main.view.id}) was last revised`),
    ]);
    expect(pageUpkeep(store, p).todo[0]).toContain('stage “Dig beds” finished');
    store.apply(agent, {
      message: 'Main page: beds are dug',
      operations: [
        {
          op: 'update',
          type: 'view',
          id: main.view.id,
          data: { doc: doc('# Garden\n\nGrow food. Beds dug.') },
        },
      ],
    });
    expect(pageUpkeep(store, p).todo).toEqual([]);
  });
});
