import type { Entity, EntityType } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import {
  buildTree,
  moveFolderOps,
  moveProjectOps,
  nudgeOps,
  placeOps,
  projectSiblings,
} from './sidebar-model';

let rev = 0;
function e<T extends EntityType>(type: T, id: string, data: Record<string, unknown>): Entity<T> {
  rev++;
  return {
    id,
    type,
    data: data as Entity<T>['data'],
    createdAt: '',
    updatedAt: '',
    createdRev: rev,
    updatedRev: rev,
  };
}

const work = e('section', 'sec_work', { name: 'Work', order: 0 });
const repoA = e('repository', 'repo_a', { name: 'a', order: 1 });
const repoB = e('repository', 'repo_b', { name: 'b', order: 0, sectionId: 'sec_work' });
const p1 = e('project', 'p1', { name: 'One', status: 'active', order: 1, repositoryId: 'repo_a' });
const p2 = e('project', 'p2', { name: 'Two', status: 'active', order: 0, repositoryId: 'repo_a' });
const p3 = e('project', 'p3', { name: 'Loose', status: 'active', order: 0 });
const p4 = e('project', 'p4', {
  name: 'Pinned',
  status: 'active',
  order: 0,
  repositoryId: 'repo_b',
  pinned: true,
});
const p5 = e('project', 'p5', {
  name: 'In section',
  status: 'active',
  order: 0,
  sectionId: 'sec_work',
});
const projects = [p1, p2, p3, p4, p5];
const repositories = [repoA, repoB];

describe('buildTree', () => {
  it('groups pinned projects, folders, loose projects, and sections in order', () => {
    const tree = buildTree(projects, repositories, [work]);
    expect(tree.pinned.map((p) => p.id)).toEqual(['p4']);
    expect(
      tree.root.map((i) =>
        i.kind === 'folder'
          ? `folder:${i.repository.id}:${i.projects.map((p) => p.id)}`
          : i.project.id,
      ),
    ).toEqual(['folder:repo_a:p2,p1', 'p3']);
    expect(
      tree.sections[0]!.items.map((i) =>
        i.kind === 'folder' ? `folder:${i.repository.id}:${i.projects.length}` : i.project.id,
      ),
    ).toEqual([
      'folder:repo_b:0', // its only project is pinned
      'p5',
    ]);
  });

  it('treats references to deleted sections or folders as top level', () => {
    const orphan = e('project', 'p6', {
      name: 'Orphan',
      status: 'active',
      order: 5,
      repositoryId: 'repo_gone',
      sectionId: 'sec_gone',
    });
    expect(buildTree([orphan], [], []).root).toEqual([{ kind: 'project', project: orphan }]);
  });
});

describe('ordering ops', () => {
  it('moves an item up, renumbering only what changed', () => {
    const siblings = projectSiblings(projects, repositories, { repositoryId: 'repo_a' });
    expect(siblings.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(nudgeOps(p1, siblings, -1)).toEqual([
      { op: 'update', type: 'project', id: 'p1', data: { order: 0 } },
      { op: 'update', type: 'project', id: 'p2', data: { order: 1 } },
    ]);
    expect(nudgeOps(p2, siblings, -1)).toEqual([]);
  });

  it('moves a project into a folder or section, at the end', () => {
    expect(moveProjectOps(p3, projects, repositories, { repositoryId: 'repo_a' })).toEqual([
      {
        op: 'update',
        type: 'project',
        id: 'p3',
        data: { repositoryId: 'repo_a', sectionId: null, order: 2 },
      },
    ]);
    expect(moveProjectOps(p1, projects, repositories, { sectionId: 'sec_work' })).toEqual([
      {
        op: 'update',
        type: 'project',
        id: 'p1',
        data: { repositoryId: null, sectionId: 'sec_work' },
      }, // already order 1
    ]);
  });

  it('moves a folder between sections and places items by index', () => {
    expect(moveFolderOps(repoA, repositories, 'sec_work')).toEqual([
      { op: 'update', type: 'repository', id: 'repo_a', data: { sectionId: 'sec_work' } }, // already order 1
    ]);
    expect(placeOps(p3, [p1, p2], 0, { repositoryId: 'repo_a' })).toEqual([
      { op: 'update', type: 'project', id: 'p3', data: { repositoryId: 'repo_a' } },
      // p1 is already at order 1
      { op: 'update', type: 'project', id: 'p2', data: { order: 2 } },
    ]);
  });
});
