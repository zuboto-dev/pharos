import type { Entity } from '@pharos/schema';
import { useEffect } from 'react';
import { useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { buildTree, type SidebarTree } from './sidebar-model';

const CHANGED = 'pharos:projects-changed';

/** Tells project lists (sidebar, home) to refetch, e.g. after creating a project. */
export function notifyProjectsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

export type Workspace = {
  projects: Entity<'project'>[];
  repositories: Entity<'repository'>[];
  sections: Entity<'section'>[];
  tree: SidebarTree;
};

/** All projects, folders (repositories), and sections, kept live. */
export function useWorkspace():
  | { status: 'loading' | 'error'; workspace?: undefined; reload: () => void }
  | { status: 'ok'; workspace: Workspace; reload: () => void } {
  const projects = useResource<Entity<'project'>[]>('/api/entities/project');
  const repositories = useResource<Entity<'repository'>[]>('/api/entities/repository');
  const sections = useResource<Entity<'section'>[]>('/api/entities/section');
  const reloadProjects = projects.reload;
  const reloadRepositories = repositories.reload;
  const reloadSections = sections.reload;
  const reload = () => {
    reloadProjects();
    reloadRepositories();
    reloadSections();
  };
  useEffect(() => {
    const onChange = () => {
      reloadProjects();
      reloadRepositories();
      reloadSections();
    };
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [reloadProjects, reloadRepositories, reloadSections]);
  // Any revision may add, rename, move, or remove projects (e.g. an agent creating one).
  useRevisionEvents(reload);

  if (!projects.data || !repositories.data || !sections.data) {
    const failed = [projects, repositories, sections].some((r) => r.status === 'error');
    return { status: failed ? 'error' : 'loading', reload };
  }
  return {
    status: 'ok',
    reload,
    workspace: {
      projects: projects.data,
      repositories: repositories.data,
      sections: sections.data,
      tree: buildTree(projects.data, repositories.data, sections.data),
    },
  };
}
