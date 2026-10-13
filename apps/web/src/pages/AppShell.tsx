import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { FolderRequestNotice } from '../files/FolderRequests';
import { useAgentStatus } from '../lib/events';
import { useTheme } from '../lib/theme';
import { PharosLogo } from './Logo';
import { Sidebar } from './Sidebar';
import { SIDEBAR_ID, SidebarToggle, useSidebarHidden } from './sidebar-toggle';
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
  // R7.14: wide screens can hide the sidebar (a button or ⌘\); phones keep it above the page.
  const { hidden, toggle, moveFocus, toggled } = useSidebarHidden();
  const fromButton = () => toggle(true);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {hidden && (
        // The logo keeps the exact spot it has in the sidebar, so hiding the sidebar doesn't move it.
        <div
          className={clsx(
            'hidden shrink-0 flex-col items-center gap-2 border-r border-neutral-200 bg-white md:sticky md:top-0 md:flex md:h-screen dark:border-neutral-800 dark:bg-neutral-900',
            toggled && 'animate-fade-in',
          )}
        >
          <Link to="/" aria-label="Pharos home" className="flex px-4 pt-4 pb-2">
            <span className="flex h-6 items-center">
              <PharosLogo className="size-5 text-amber-500" />
            </span>
          </Link>
          <SidebarToggle hidden onToggle={fromButton} focusOnMount={moveFocus.current} />
        </div>
      )}
      <aside
        id={SIDEBAR_ID}
        className={clsx(
          'flex max-h-[60vh] shrink-0 flex-col border-b border-neutral-200 bg-white md:sticky md:top-0 md:h-screen md:max-h-none md:w-64 md:border-r md:border-b-0 dark:border-neutral-800 dark:bg-neutral-900',
          hidden && 'md:hidden',
          // Coming back after a hide: a short slide and fade (opacity only with reduced motion).
          toggled && !hidden && 'md:animate-side-in',
        )}
      >
        <div className="flex items-center justify-between gap-2 pr-2">
          <Link
            to="/"
            className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold tracking-tight"
          >
            <span className="flex h-6 items-center">
              <PharosLogo className="size-5 text-amber-500" />
            </span>{' '}
            Pharos
          </Link>
          {!hidden && (
            <SidebarToggle hidden={false} onToggle={fromButton} focusOnMount={moveFocus.current} />
          )}
        </div>
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
