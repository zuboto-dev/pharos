import type { Entity, EntityType } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import {
  removeSectionOps,
  sectionAndInside,
  sectionPath,
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

  it('keeps archived projects out of every list and together at the bottom', () => {
    const old = e('project', 'p7', {
      name: 'Old',
      status: 'archived',
      order: 0,
      repositoryId: 'repo_a',
      pinned: true,
    });
    const older = e('project', 'p8', { name: 'Ancient', status: 'archived', order: 1 });
    const tree = buildTree([...projects, old, older], repositories, [work]);
    expect(tree.pinned.map((p) => p.id)).toEqual(['p4']);
    expect(tree.root.map((i) => (i.kind === 'folder' ? i.projects.length : i.project.id))).toEqual([
      2,
      'p3',
    ]);
    expect(tree.archived.map((p) => p.id)).toEqual(['p8', 'p7']);
    expect(projectSiblings([...projects, old], repositories, { repositoryId: 'repo_a' })).toEqual([
      p2,
      p1,
    ]);
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

describe('sections inside sections', () => {
  const business = e('section', 'sec_b', { name: 'business', order: 0 });
  const gdo = e('section', 'sec_g', { name: 'g-do', order: 0, parentId: 'sec_b' });
  const deep = e('section', 'sec_d', { name: 'engine', order: 0, parentId: 'sec_g' });
  const repoG = e('repository', 'repo_g', { name: 'g-do', order: 0, sectionId: 'sec_g' });
  const all = [business, gdo, deep];

  it('nests them in the tree, each holding its own folders', () => {
    const tree = buildTree([], [repoG], all);
    expect(tree.sections.map((n) => n.section.id)).toEqual(['sec_b']);
    const [b] = tree.sections;
    expect(b!.items).toEqual([]);
    expect(b!.children.map((n) => n.section.id)).toEqual(['sec_g']);
    expect(b!.children[0]!.items.map((i) => i.kind === 'folder' && i.repository.id)).toEqual([
      'repo_g',
    ]);
    expect(b!.children[0]!.children.map((n) => n.section.id)).toEqual(['sec_d']);
    expect(sectionPath(all, 'sec_d')).toBe('business › g-do › engine');
    expect([...sectionAndInside(all, 'sec_b')].sort()).toEqual(['sec_b', 'sec_d', 'sec_g']);
  });

  it('a loop or a missing parent shows the section at the top level, never hides it', () => {
    const a = e('section', 'sec_a', { name: 'a', order: 0, parentId: 'sec_c' });
    const c = e('section', 'sec_c', { name: 'c', order: 1, parentId: 'sec_a' });
    const lost = e('section', 'sec_l', { name: 'lost', order: 2, parentId: 'sec_gone' });
    const tree = buildTree([], [], [a, c, lost]);
    expect(tree.sections.map((n) => n.section.id)).toEqual(['sec_a', 'sec_c', 'sec_l']);
  });

  it('removing one moves what it held up a level', () => {
    const p = e('project', 'p_g', { name: 'G', status: 'active', order: 0, sectionId: 'sec_g' });
    expect(removeSectionOps(gdo, all, [repoG], [p])).toEqual([
      { op: 'update', type: 'repository', id: 'repo_g', data: { sectionId: 'sec_b' } },
      { op: 'update', type: 'project', id: 'p_g', data: { sectionId: 'sec_b' } },
      { op: 'update', type: 'section', id: 'sec_d', data: { parentId: 'sec_b' } },
      { op: 'delete', type: 'section', id: 'sec_g' },
    ]);
  });
});
