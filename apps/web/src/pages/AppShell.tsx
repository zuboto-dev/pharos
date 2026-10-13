import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { FolderRequestNotice } from '../files/FolderRequests';
import { useAgentStatus } from '../lib/events';
import { useTheme } from '../lib/theme';
import { PharosLogo } from './Logo';
import { Sidebar } from './Sidebar';
import { UpdateNotice } from './UpdateNotice';

/** Opens Settings; a dot shows when automatic answering is paused. */
function SettingsLink() {
  const agent = useAgentStatus();
  const paused = agent.configured && !agent.enabled;
  return (
    <NavLink
      to="/settings"
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm',
          isActive
            ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
            : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
        )
      }
    >
      <Settings className="size-4" /> Settings
      {paused && (
        <span
          title="Answering questions is paused"
          aria-label="Answering paused"
          className="ml-auto size-2 rounded-full bg-amber-500"
        />
      )}
    </NavLink>
  );
}

/**
 * Agents waiting for a folder (R7.12), on every page; a project's page shows its own requests,
 * so they aren't shown twice there. Settings lists them all.
 */
function ShellFolderRequests() {
  const project = useMatch('/projects/:projectId/*');
  const settings = useMatch('/settings');
  if (settings) return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 empty:hidden md:px-8">
      <FolderRequestNotice exceptProjectId={project?.params.projectId} />
    </div>
  );
}

export function AppShell() {
  // Keeps the chosen theme applied (and "system" following the OS) on every page.
  useTheme();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex max-h-[60vh] shrink-0 flex-col border-b border-neutral-200 bg-white md:sticky md:top-0 md:h-screen md:max-h-none md:w-64 md:border-r md:border-b-0 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          to="/"
          className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold tracking-tight"
        >
          <PharosLogo className="size-5 text-amber-500" /> Pharos
        </Link>
        <Sidebar />
        <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
          <SettingsLink />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <ShellFolderRequests />
        <Outlet />
      </main>
      <UpdateNotice />
    </div>
  );
}
