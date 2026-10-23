import clsx from 'clsx';
import { Menu as MenuIcon, Settings } from 'lucide-react';
import { useState, type FocusEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router';
import { RunningAgentsButton } from '../agent/RunningAgents';
import { RunningTerminalsProvider } from '../agent/running';
import { Tooltip } from '../catalog/tooltip';
import { FolderRequestNotice } from '../files/FolderRequests';
import { useAgentStatus } from '../lib/events';
import { useTheme } from '../lib/theme';
import { NotificationsProvider } from '../notifications/model';
import { NotificationBell, NotificationModal, ToastStack } from '../notifications/ui';
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
  // Phones: a bar with the logo and a button that opens the sidebar over the page (it closes
  // when you go somewhere), so the page starts on the first screen.
  const { pinned, toggle } = useSidebarPinned();
  const { peek, show, hide, setPeek } = usePeek();
  const open = pinned || peek;
  // Open on the page it was opened on: going to another page closes it.
  const { pathname } = useLocation();
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawer = drawerAt === pathname;
  const setDrawer = (on: boolean) => setDrawerAt(on ? pathname : null);
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
    <RunningTerminalsProvider>
      <NotificationsProvider>
        <div className="flex min-h-screen flex-col md:flex-row">
          <div
            data-phone-bar=""
            className="sticky top-0 z-20 flex items-center border-b border-line bg-surface pr-2 md:hidden"
          >
            <Link
              to="/"
              className="flex items-center gap-2 px-4 py-2.5 font-semibold tracking-tight"
            >
              <PharosLogo className="size-5 text-amber-500" /> Pharos
            </Link>
            <span className="flex-1" />
            <NotificationBell />
            <RunningAgentsButton />
            <button
              type="button"
              aria-label="Open the sidebar"
              aria-controls={SIDEBAR_ID}
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
              className="flex size-9 items-center justify-center rounded-control text-muted hover:bg-sunken"
            >
              <MenuIcon aria-hidden className="size-5" />
            </button>
          </div>
          {drawer && (
            <div
              aria-hidden
              className="fixed inset-0 z-30 bg-black/30 md:hidden"
              onClick={() => setDrawer(false)}
            />
          )}
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
              {/* What happened, and where agents run, visible with the sidebar collapsed (R17). */}
              <div
                className="mt-2 flex flex-col items-center gap-1"
                onMouseEnter={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
              >
                <NotificationBell />
                <RunningAgentsButton />
              </div>
            </div>
          )}
          <aside
            id={SIDEBAR_ID}
            data-sidebar={pinned ? 'open' : peek ? 'peek' : 'collapsed'}
            {...peekHandlers}
            onKeyDown={(e) => drawer && e.key === 'Escape' && setDrawer(false)}
            className={clsx(
              'shrink-0 flex-col border-line bg-surface md:h-screen md:w-64 md:border-r',
              // Phones: hidden until the bar's button opens it over the page.
              drawer
                ? 'fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] border-r shadow-overlay'
                : 'hidden',
              pinned
                ? 'md:sticky md:top-0 md:bottom-auto md:shadow-none'
                : 'md:fixed md:top-0 md:left-0 md:z-30 md:shadow-overlay',
              open ? 'md:flex' : 'md:hidden',
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
              <span className="flex-1" />
              <NotificationBell className="pt-2" />
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
          <ToastStack>
            <UpdateNotice />
          </ToastStack>
          <NotificationModal />
        </div>
      </NotificationsProvider>
    </RunningTerminalsProvider>
  );
}
