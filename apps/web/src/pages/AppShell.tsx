import clsx from 'clsx';
import { Settings } from 'lucide-react';
import type { FocusEvent } from 'react';
import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { Tooltip } from '../catalog/tooltip';
import { FolderRequestNotice } from '../files/FolderRequests';
import { useAgentStatus } from '../lib/events';
import { useTheme } from '../lib/theme';
import { PharosLogo } from './Logo';
import { Sidebar } from './Sidebar';
import { SIDEBAR_ID, SidebarToggle, usePeek, useSidebarPinned } from './sidebar-toggle';
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
          'flex items-center gap-2 rounded-tile px-2.5 py-1.5 text-sm',
          isActive ? 'bg-subtle font-medium text-ink' : 'text-muted hover:bg-subtle hover:text-ink',
        )
      }
    >
      <Settings className="size-4" /> Settings
      {paused && (
        <Tooltip label="Answering questions is paused" className="ml-auto">
          <span aria-label="Answering paused" className="size-2 rounded-full bg-amber-500" />
        </Tooltip>
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
  // Wide screens: a slim rail that slides the sidebar out on hover or focus, unless kept open.
  // Phones keep the sidebar above the page.
  const { pinned, toggle } = useSidebarPinned();
  const { peek, show, hide, setPeek } = usePeek();
  const open = pinned || peek;
  const peekHandlers = pinned
    ? {}
    : {
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: (e: FocusEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
        },
      };
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {!pinned && (
        // The rail: the logo in the exact spot it has in the sidebar, no buttons. Hovering or
        // focusing it slides the sidebar out over the page.
        <div
          data-sidebar-rail=""
          className="hidden shrink-0 flex-col items-center border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-screen"
          {...peekHandlers}
          onClick={() => setPeek(true)}
        >
          <Link to="/" aria-label="Pharos home" className="flex px-4 pt-4 pb-2">
            <span className="flex h-6 items-center">
              <PharosLogo className="size-5 text-amber-500" />
            </span>
          </Link>
        </div>
      )}
      <aside
        id={SIDEBAR_ID}
        data-sidebar={pinned ? 'open' : peek ? 'peek' : 'collapsed'}
        {...peekHandlers}
        className={clsx(
          'flex max-h-[60vh] shrink-0 flex-col border-b border-line bg-surface md:h-screen md:max-h-none md:w-64 md:border-r md:border-b-0',
          pinned ? 'md:sticky md:top-0' : 'md:fixed md:top-0 md:left-0 md:z-30 md:shadow-overlay',
          !open && 'md:hidden',
          peek && !pinned && 'md:animate-side-in',
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
          <SidebarToggle
            pinned={pinned}
            onToggle={() => {
              toggle();
              setPeek(false);
            }}
          />
        </div>
        <Sidebar />
        <div className="border-t border-line-soft p-3">
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
