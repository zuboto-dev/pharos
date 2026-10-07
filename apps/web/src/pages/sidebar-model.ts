import type { Entity, Operation } from '@pharos/schema';

type Project = Entity<'project'>;
type Repository = Entity<'repository'>;
type Section = Entity<'section'>;
type Ordered = Project | Repository | Section;

export type Folder = { kind: 'folder'; repository: Repository; projects: Project[] };
export type Item = Folder | { kind: 'project'; project: Project };
export type SidebarTree = {
  /** Pinned projects, shown together at the top (and not repeated in their folders). */
  pinned: Project[];
  /** Folders and loose projects outside any section. */
  root: Item[];
  sections: { section: Section; items: Item[] }[];
};

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
  const unpinned = projects.filter((p) => !p.data.pinned);
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
  return {
    pinned: projects.filter((p) => p.data.pinned).sort(byOrder),
    root: itemsIn(undefined),
    sections: [...sections]
      .sort(byOrder)
      .map((section) => ({ section, items: itemsIn(section.id) })),
  };
}

/** The projects sharing a container (pinned ones included, since pinning doesn't change their place). */
export function projectSiblings(
  projects: Project[],
  repositories: Repository[],
  container: Container,
): Project[] {
  const repositoryIds = new Set(repositories.map((r) => r.id));
  return projects
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
