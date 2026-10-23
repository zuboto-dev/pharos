import type { Entity, Operation } from '@pharos/schema';

type Project = Entity<'project'>;
type Repository = Entity<'repository'>;
type Section = Entity<'section'>;
type Ordered = Project | Repository | Section;

export type Folder = { kind: 'folder'; repository: Repository; projects: Project[] };
export type Item = Folder | { kind: 'project'; project: Project };
/** A section with what it holds: folders and projects, then the sections inside it. */
export type SectionNode = { section: Section; items: Item[]; children: SectionNode[] };

export type SidebarTree = {
  /** Pinned projects, shown together at the top (and not repeated in their folders). */
  pinned: Project[];
  /** Folders and loose projects outside any section. */
  root: Item[];
  /** Top-level sections, each with the sections inside it. */
  sections: SectionNode[];
  /** Archived projects, out of every list above and kept together at the bottom, by name. */
  archived: Project[];
};

/** Archived projects leave the sidebar's lists, the home page and pickers; they still open. */
export const isArchived = (project: Project): boolean => project.data.status === 'archived';

/** The status a restored project gets back (archiving doesn't keep the one it had). */
const RESTORED_STATUS = 'active';

/** One revision archiving or restoring a project, as the sidebar and the project page send it. */
export function archiveChange(
  project: Project,
  archive: boolean,
): { message: string; operations: Operation[] } {
  return {
    message: `${archive ? 'Archive' : 'Restore'} project “${project.data.name}”`,
    operations: [
      {
        op: 'update',
        type: 'project',
        id: project.id,
        data: { status: archive ? 'archived' : RESTORED_STATUS },
      },
    ],
  };
}

/** Where an item lives: a folder (projects only), a section, or the top level. */
export type Container = { repositoryId?: string; sectionId?: string };

const byOrder = (a: Ordered, b: Ordered) =>
  (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name);

export function buildTree(
  projects: Project[],
  repositories: Repository[],
  sections: Section[],
): SidebarTree {
  const sectionIds = new Set(sections.map((s) => s.id));
  const repositoryIds = new Set(repositories.map((r) => r.id));
  const sectionOf = (e: Project | Repository) =>
    e.data.sectionId && sectionIds.has(e.data.sectionId) ? e.data.sectionId : undefined;
  const live = projects.filter((p) => !isArchived(p));
  const unpinned = live.filter((p) => !p.data.pinned);
  const loose = unpinned.filter(
    (p) => !p.data.repositoryId || !repositoryIds.has(p.data.repositoryId),
  );
  const itemsIn = (sectionId: string | undefined): Item[] => [
    ...repositories
      .filter((r) => sectionOf(r) === sectionId)
      .sort(byOrder)
      .map((repository) => ({
        kind: 'folder' as const,
        repository,
        projects: unpinned.filter((p) => p.data.repositoryId === repository.id).sort(byOrder),
      })),
    ...loose
      .filter((p) => sectionOf(p) === sectionId)
      .sort(byOrder)
      .map((project) => ({ kind: 'project' as const, project })),
  ];
  const parent = sectionParents(sections);
  const nodesIn = (parentId: string | undefined): SectionNode[] =>
    sections
      .filter((s) => parent.get(s.id) === parentId)
      .sort(byOrder)
      .map((section) => ({
        section,
        items: itemsIn(section.id),
        children: nodesIn(section.id),
      }));
  return {
    pinned: live.filter((p) => p.data.pinned).sort(byOrder),
    root: itemsIn(undefined),
    sections: nodesIn(undefined),
    archived: projects.filter(isArchived).sort((a, b) => a.data.name.localeCompare(b.data.name)),
  };
}

/**
 * Each section's parent as the sidebar shows it: its `parentId` when that section exists and
 * doesn't lead back to itself; else none (the top level), so a loop never hides a section.
 */
export function sectionParents(sections: Section[]): Map<string, string | undefined> {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const parent = new Map<string, string | undefined>();
  for (const s of sections) {
    let p = s.data.parentId && byId.has(s.data.parentId) ? s.data.parentId : undefined;
    const seen = new Set([s.id]);
    for (let at = p; at; at = byId.get(at)?.data.parentId)
      if (seen.has(at)) {
        p = undefined;
        break;
      } else seen.add(at);
    parent.set(s.id, p);
  }
  return parent;
}

/** A section and every section inside it, at any depth. */
export function sectionAndInside(sections: Section[], sectionId: string): Set<string> {
  const parent = sectionParents(sections);
  const out = new Set([sectionId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sections) {
      const p = parent.get(s.id);
      if (p && out.has(p) && !out.has(s.id)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "business › g-do": a section's name after those of the sections it sits in. */
export function sectionPath(sections: Section[], sectionId: string): string {
  const parent = sectionParents(sections);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const names: string[] = [];
  for (let at: string | undefined = sectionId; at; at = parent.get(at))
    names.unshift(byId.get(at)?.data.name ?? at);
  return names.join(' › ');
}

/** The sections sharing a parent, in order. */
export function sectionSiblings(sections: Section[], parentId: string | undefined): Section[] {
  const parent = sectionParents(sections);
  return sections.filter((s) => parent.get(s.id) === parentId).sort(byOrder);
}

/**
 * Removing a section keeps what it held: its folders, projects and sections move up to where the
 * section was (its parent, or the top level), then it goes.
 */
export function removeSectionOps(
  section: Section,
  sections: Section[],
  repositories: Repository[],
  projects: Project[],
): Operation[] {
  const up = sectionParents(sections).get(section.id) ?? null;
  const ops: Operation[] = [];
  for (const r of repositories)
    if (r.data.sectionId === section.id)
      ops.push({ op: 'update', type: 'repository', id: r.id, data: { sectionId: up } });
  for (const p of projects)
    if (p.data.sectionId === section.id)
      ops.push({ op: 'update', type: 'project', id: p.id, data: { sectionId: up } });
  for (const s of sections)
    if (s.data.parentId === section.id)
      ops.push({ op: 'update', type: 'section', id: s.id, data: { parentId: up } });
  ops.push({ op: 'delete', type: 'section', id: section.id });
  return ops;
}

/**
 * The projects sharing a container (pinned ones included, since pinning doesn't change their place;
 * archived ones left out, since they aren't shown there).
 */
export function projectSiblings(
  projects: Project[],
  repositories: Repository[],
  container: Container,
): Project[] {
  const repositoryIds = new Set(repositories.map((r) => r.id));
  return projects
    .filter((p) => !isArchived(p))
    .filter((p) =>
      container.repositoryId
        ? p.data.repositoryId === container.repositoryId
        : (!p.data.repositoryId || !repositoryIds.has(p.data.repositoryId)) &&
          (p.data.sectionId ?? undefined) === container.sectionId,
    )
    .sort(byOrder);
}

export function folderSiblings(
  repositories: Repository[],
  sectionId: string | undefined,
): Repository[] {
  return repositories.filter((r) => (r.data.sectionId ?? undefined) === sectionId).sort(byOrder);
}

export function containerOf(project: Project): Container {
  return project.data.repositoryId
    ? { repositoryId: project.data.repositoryId }
    : { sectionId: project.data.sectionId };
}

/**
 * Updates that put `entity` at `index` among `siblings` (which may or may not already include it),
 * renumbering orders 0…n and applying `data` (e.g. a new container) to the moved entity.
 */
export function placeOps(
  entity: Ordered,
  siblings: Ordered[],
  index: number,
  data: Record<string, unknown> = {},
): Operation[] {
  const others = siblings.filter((s) => s.id !== entity.id);
  const at = Math.max(0, Math.min(index, others.length));
  const next = [...others.slice(0, at), entity, ...others.slice(at)];
  const ops: Operation[] = [];
  next.forEach((item, order) => {
    const patch: Record<string, unknown> = item.id === entity.id ? { ...data } : {};
    if (item.data.order !== order) patch.order = order;
    if (Object.keys(patch).length)
      ops.push({ op: 'update', type: item.type, id: item.id, data: patch });
  });
  return ops;
}

/** Updates that move `entity` one place up or down among its siblings (nothing at the ends). */
export function nudgeOps(entity: Ordered, siblings: Ordered[], by: -1 | 1): Operation[] {
  const index = siblings.findIndex((s) => s.id === entity.id);
  const target = index + by;
  if (index === -1 || target < 0 || target >= siblings.length) return [];
  return placeOps(entity, siblings, target);
}

/** Updates that move a project into a container, at the end. */
export function moveProjectOps(
  project: Project,
  projects: Project[],
  repositories: Repository[],
  to: Container,
): Operation[] {
  const siblings = projectSiblings(projects, repositories, to);
  return placeOps(project, siblings, siblings.length, {
    repositoryId: to.repositoryId ?? null,
    sectionId: to.repositoryId ? null : (to.sectionId ?? null),
  });
}

/** Updates that move a folder into a section (or the top level), at the end. */
export function moveFolderOps(
  repository: Repository,
  repositories: Repository[],
  sectionId: string | undefined,
): Operation[] {
  const siblings = folderSiblings(repositories, sectionId);
  return placeOps(repository, siblings, siblings.length, { sectionId: sectionId ?? null });
}
