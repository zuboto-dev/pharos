import { FolderGit2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { BUTTON, StatusBadge } from '../catalog/ui';
import { ConnectAgent, useMcpUrl } from './ConnectAgent';
import { NewProjectDialog } from './NewProjectDialog';
import { HomeSkeleton, LoadError } from './onboarding';
import { useWorkspace } from './projects';
import type { Item } from './sidebar-model';
import type { Entity } from '@pharos/schema';

type Group = { key: string; label: string; folder: boolean; projects: Entity<'project'>[] };

/** The sidebar's structure as flat groups: pinned, then each folder or loose list, section by section. */
function homeGroups(tree: import('./sidebar-model').SidebarTree): Group[] {
  const groups: Group[] = [];
  if (tree.pinned.length)
    groups.push({ key: 'pinned', label: 'Pinned', folder: false, projects: tree.pinned });
  const add = (items: Item[], section?: string) => {
    const loose = items.flatMap((i) => (i.kind === 'project' ? [i.project] : []));
    for (const i of items) {
      if (i.kind === 'folder' && i.projects.length) {
        const label = section ? `${section} · ${i.repository.data.name}` : i.repository.data.name;
        groups.push({ key: i.repository.id, label, folder: true, projects: i.projects });
      }
    }
    if (loose.length)
      groups.push({
        key: `loose:${section ?? ''}`,
        label: section ?? 'No folder',
        folder: false,
        projects: loose,
      });
  };
  add(tree.root);
  for (const { section, items } of tree.sections) add(items, section.data.name);
  return groups;
}

function NoProjectsConnect() {
  const mcpUrl = useMcpUrl();
  return (
    <section aria-label="Connect an agent" className="space-y-2 pt-2">
      <h2 className="text-sm font-medium">Connect an agent</h2>
      <ConnectAgent mcpUrl={mcpUrl} compact />
    </section>
  );
}

export function HomePage() {
  const ws = useWorkspace();
  const status = ws.status;
  const groups = ws.workspace ? homeGroups(ws.workspace.tree) : [];
  const [creating, setCreating] = useState(false);
  const dialog = creating && <NewProjectDialog onClose={() => setCreating(false)} />;
  const newButton = (
    <button type="button" onClick={() => setCreating(true)} className={BUTTON.primary}>
      <Plus className="size-3.5" /> New project
    </button>
  );
  if (status === 'loading') return <HomeSkeleton />;
  if (status === 'error') return <LoadError notFound={false} what="Workspace" />;
  if (!groups.length) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">No projects yet</h1>
        <p className="text-muted">
          Create one yourself, or connect your AI agent over MCP and ask it to set one up.
        </p>
        {newButton}
        <NoProjectsConnect />
        {dialog}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        {newButton}
      </div>
      {dialog}
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted">
            {group.folder && <FolderGit2 className="size-4" />}
            {group.label}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.projects.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="space-y-2 rounded-block border border-line bg-surface p-4 transition hover:border-neutral-300 hover:shadow-sm dark:hover:border-neutral-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{project.data.name}</span>
                  <StatusBadge value={project.data.status} />
                </div>
                {project.data.summary && (
                  <p className="line-clamp-2 text-sm text-muted">{project.data.summary}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
