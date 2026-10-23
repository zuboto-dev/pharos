import type { PharosNotification } from '@pharos/schema';
import clsx from 'clsx';
import { Bell, BellOff, CheckCheck, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Popover, usePopover } from '../catalog/popover';
import { ICON_GHOST, Tooltip } from '../catalog/tooltip';
import { timeAgo } from '../lib/format';
import { NoticeIcon, TOAST_MS, useNotifications } from './model';

/** Where it's from and when, after the title. */
function whereWhen(n: PharosNotification): string {
  return [n.project, timeAgo(n.at)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- toasts

function Toast({ n }: { n: PharosNotification }) {
  const state = useNotifications()!;
  const [held, setHeld] = useState(false);
  const { dismissToast } = state;
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => dismissToast(n.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, n.id, dismissToast]);
  return (
    <div
      role="status"
      data-toast={n.kind}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHeld(false)}
      className="pointer-events-auto flex w-full animate-rise-in items-center gap-2.5 rounded-tile border border-line-strong bg-surface py-2 pr-1.5 pl-3 text-sm shadow-popover"
    >
      <NoticeIcon n={n} className="size-4 shrink-0" />
      <Tooltip
        label={n.title}
        detail={[n.project, n.detail].filter(Boolean).join(' · ') || undefined}
        className="min-w-0 flex-1"
      >
        <p className="truncate text-ink">{n.title}</p>
      </Tooltip>
      {n.href && (
        <button
          type="button"
          onClick={() => state.open(n)}
          className="shrink-0 rounded-control bg-inverse px-2.5 py-1 text-xs font-medium text-on-inverse hover:bg-neutral-700 dark:hover:bg-neutral-300"
        >
          {n.action ?? 'Open'}
        </button>
      )}
      <Tooltip label="Dismiss">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissToast(n.id)}
          className={ICON_GHOST}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * New notifications as they come: bottom right on wide screens, under the bar on a phone. Other
 * notices of the shell (the update notice) stack with them.
 */
export function ToastStack({ children }: { children?: ReactNode }) {
  const state = useNotifications();
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      data-toast-stack=""
      className="pointer-events-none fixed inset-x-4 top-14 z-50 flex flex-col gap-2 empty:hidden md:top-auto md:right-4 md:bottom-4 md:left-auto md:w-96 md:flex-col-reverse"
    >
      {children}
      {state?.toasts.map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the bell

function Row({ n, onOpen }: { n: PharosNotification; onOpen: () => void }) {
  const unread = !n.readAt;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-unread={unread ? '' : undefined}
        aria-label={`${n.title}${n.project ? `, ${n.project}` : ''}${unread ? ', unread' : ''}`}
        className="flex w-full items-start gap-2.5 rounded-control px-2 py-1.5 text-left hover:bg-subtle"
      >
        <NoticeIcon n={n} className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span
            className={clsx('block truncate', unread ? 'font-medium text-ink' : 'text-ink-soft')}
          >
            {n.title}
          </span>
          <span className="block truncate text-xs text-muted">{whereWhen(n)}</span>
        </span>
        {unread && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
      </button>
    </li>
  );
}

/** The bell: how many are unread, and a list of the recent ones. */
export function NotificationBell({ className }: { className?: string }) {
  const state = useNotifications();
  const popover = usePopover();
  if (!state) return null;
  const { unread, items } = state;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <>
      <Tooltip label={label} className={className}>
        <button
          type="button"
          aria-label={label}
          data-bell={unread}
          {...popover.trigger}
          className="relative flex size-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink"
        >
          <Bell aria-hidden className="size-4" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-surface"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </Tooltip>
      {popover.anchor && (
        <Popover anchor={popover.anchor} label="Notifications" onClose={popover.close}>
          <div className="flex items-center gap-1">
            <h2 className="flex-1 text-sm font-semibold text-ink">Notifications</h2>
            <Tooltip label="Mark all read">
              <button
                type="button"
                aria-label="Mark all read"
                disabled={!unread}
                onClick={() => state.markRead()}
                className={clsx(ICON_GHOST, 'disabled:opacity-40')}
              >
                <CheckCheck aria-hidden className="size-4" />
              </button>
            </Tooltip>
            <Tooltip label="Notification settings">
              <Link
                to="/settings#notifications"
                aria-label="Notification settings"
                onClick={() => popover.close(false)}
                className={ICON_GHOST}
              >
                <Settings aria-hidden className="size-4" />
              </Link>
            </Tooltip>
          </div>
          {items.length ? (
            <ul className="-mx-1 max-h-96 space-y-0.5 overflow-y-auto">
              {items.slice(0, 30).map((n) => (
                <Row
                  key={n.id}
                  n={n}
                  onOpen={() => {
                    popover.close(false);
                    state.open(n);
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 py-3 text-muted">
              <BellOff aria-hidden className="size-4" /> Nothing yet
            </p>
          )}
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the modal

/** The one kind that blocks until read (Pharos restarted under a running agent): rare by design. */
export function NotificationModal() {
  const state = useNotifications();
  const n = state?.modal;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (n) button.current?.focus();
  }, [n]);
  if (!state || !n) return null;
  const close = () => state.markRead([n.id]);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`notification-${n.id}`}
      aria-describedby={n.detail ? `notification-${n.id}-detail` : undefined}
      onKeyDown={(e) => e.key === 'Escape' && close()}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={close} />
      <div className="relative w-full max-w-sm animate-pop-in space-y-3 rounded-block bg-surface p-5 shadow-overlay">
        <h2 id={`notification-${n.id}`} className="flex items-center gap-2 text-base font-semibold">
          <NoticeIcon n={n} className="size-4" />
          {n.title}
        </h2>
        {n.detail && (
          <p id={`notification-${n.id}-detail`} className="text-sm text-ink-soft">
            {n.detail}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            ref={n.href ? undefined : button}
            type="button"
            onClick={close}
            className="rounded-control px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-ink"
          >
            Close
          </button>
          {n.href && (
            <button
              ref={button}
              type="button"
              onClick={() => state.open(n)}
              className="rounded-control bg-inverse px-3 py-1.5 text-sm font-medium text-on-inverse hover:bg-neutral-700 dark:hover:bg-neutral-300"
            >
              {n.action ?? 'Open'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
