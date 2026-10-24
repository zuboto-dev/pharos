import {
  NOTIFICATION_PREF_KINDS,
  notificationPrefsOf,
  type NotificationDelivery,
  type NotificationPrefKind,
  type NotificationPrefs,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  AlertTriangle,
  AppWindow,
  Bell,
  BellOff,
  Check,
  Lock,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '../catalog/skeleton';
import { InfoTip, Tooltip } from '../catalog/tooltip';
import { ApiError, useResource } from '../lib/api';
import { KIND_ICON, announcePrefs } from '../notifications/model';
import { Section, Switch } from './settings-ui';

const KINDS: Record<NotificationPrefKind, { label: string; info: string }> = {
  desk: {
    label: 'Needs you',
    info: 'A decision, review sheet or task lands on your desk (or comes back from later).',
  },
  run: {
    label: 'Run failed',
    info: 'A night run or routine failed or was partly done, or the answering agent failed.',
  },
  terminal: {
    label: 'Agent finished',
    info: 'An agent in a panel exited, or was stopped after a while with no panel open.',
  },
  'agent-answered': {
    label: 'Agent answered',
    info: 'An agent in a panel finished its turn and waits for you, while the panel was closed or its tab in the background.',
  },
  stale: {
    label: 'Page out of date',
    info: 'An agent’s change made a page an agent wrote out of date.',
  },
  handback: {
    label: 'Hand-back waiting',
    info: 'A review you handed back has not been picked up by an agent.',
  },
};

const DELIVERIES: { value: NotificationDelivery; label: string; icon: LucideIcon }[] = [
  { value: 'bell', label: 'Bell only', icon: Bell },
  { value: 'toast', label: 'Toast', icon: MessageSquare },
  { value: 'browser', label: 'Browser notification', icon: AppWindow },
];

const HANDBACK_HOURS = [1, 2, 4, 8, 24];

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';
const permissionNow = (): Permission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

async function savePrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const res = await fetch('/api/settings/notifications', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`);
  return notificationPrefsOf(body);
}

function DeliveryChoice({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: string;
  value: NotificationDelivery;
  disabled: boolean;
  onChange: (value: NotificationDelivery) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`How “${kind}” reaches you`}
      className={clsx(
        'inline-flex rounded-control border border-line-strong p-0.5',
        disabled && 'opacity-40',
      )}
    >
      {DELIVERIES.map(({ value: v, label, icon: Icon }) => (
        <Tooltip key={v} label={label}>
          <button
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={clsx(
              'flex size-7 items-center justify-center rounded-[5px] pointer-coarse:size-9',
              value === v
                ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                : 'text-muted hover:bg-subtle hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** This browser's answer to "may Pharos show notifications", once one kind asks for them. */
function PermissionState({ permission, onAsk }: { permission: Permission; onAsk: () => void }) {
  if (permission === 'granted')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ok">
        <Check aria-hidden className="size-3.5" /> Allowed in this browser
      </span>
    );
  if (permission === 'denied' || permission === 'unsupported')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <AlertTriangle aria-hidden className="size-3.5" />
        {permission === 'denied' ? 'Blocked in this browser' : 'Not in this browser'}
        <InfoTip
          label="About browser notifications"
          detail={
            permission === 'denied'
              ? 'Allow notifications for this site in the browser’s site settings; until then they show as toasts.'
              : 'This browser has no notifications; they show as toasts.'
          }
        />
      </span>
    );
  return (
    <button
      type="button"
      onClick={onAsk}
      className="inline-flex items-center gap-1 rounded-control border border-line-strong px-2 py-1 text-xs text-ink-soft hover:bg-subtle"
    >
      <Bell aria-hidden className="size-3.5" /> Allow
    </button>
  );
}

/**
 * Settings → Notifications: per kind on or off and how it arrives (the bell only, a toast, or a
 * browser notification, asked for only when chosen), quiet hours, and "only what only I can do".
 * Saved on the server as an app setting (never a revision), so every browser shares them.
 */
export function NotificationSettings({
  askPermission = () =>
    typeof Notification === 'undefined'
      ? Promise.resolve<Permission>('unsupported')
      : Notification.requestPermission(),
}: {
  /** Asks the browser (tests pass a fake). */
  askPermission?: () => Promise<Permission>;
}) {
  const saved = useResource<unknown>('/api/settings/notifications');
  // What this page changed wins over a refetch (on focus), which mustn't undo a change being saved.
  const [local, setPrefs] = useState<NotificationPrefs | null>(null);
  const prefs = local ?? (saved.data !== undefined ? notificationPrefsOf(saved.data) : null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<Permission>(permissionNow);
  // The bell's settings button links here.
  const loaded = prefs !== null;
  useEffect(() => {
    if (loaded && window.location.hash === '#notifications')
      document.getElementById('notifications')?.scrollIntoView?.({ block: 'start' });
  }, [loaded]);

  const change = (next: NotificationPrefs) => {
    const before = prefs;
    setPrefs(next);
    setError(null);
    announcePrefs(next);
    savePrefs(next).then(
      (p) => {
        setPrefs(p);
        announcePrefs(p);
      },
      (err: unknown) => {
        setPrefs(before);
        if (before) announcePrefs(before);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };
  const ask = () =>
    void askPermission()
      .then(setPermission)
      .catch(() => setPermission(permissionNow()));

  const usesBrowser =
    prefs &&
    NOTIFICATION_PREF_KINDS.some((k) => prefs.kinds[k].on && prefs.kinds[k].delivery === 'browser');

  return (
    <Section
      id="notifications"
      title="Notifications"
      icon={Bell}
      description="What Pharos tells you while agents work: in the bell, as a toast, or as a browser notification. Saved on this server, for every browser."
    >
      {!prefs ? (
        <Skeleton lines={5} label="Loading notification settings" />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-line-soft" aria-label="Kinds of notification">
            {NOTIFICATION_PREF_KINDS.map((kind) => {
              const { label, info } = KINDS[kind];
              const Icon = KIND_ICON[kind];
              const pref = prefs.kinds[kind];
              const set = (p: Partial<typeof pref>) =>
                change({ ...prefs, kinds: { ...prefs.kinds, [kind]: { ...pref, ...p } } });
              return (
                <li
                  key={kind}
                  data-kind={kind}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm"
                >
                  <span className="flex min-w-[8.5rem] flex-1 items-center gap-2">
                    <Icon aria-hidden className="size-4 shrink-0 text-faint" />
                    <span className="text-ink">{label}</span>
                    <InfoTip
                      label={`About ${label.toLowerCase()}`}
                      detail={
                        kind === 'handback'
                          ? `${info} Notifies after ${prefs.handbackHours} h.`
                          : info
                      }
                    />
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {kind === 'handback' && (
                      <Tooltip label="Hours before it notifies">
                        <select
                          aria-label="Hours before it notifies"
                          value={prefs.handbackHours}
                          disabled={!pref.on}
                          onChange={(e) =>
                            change({ ...prefs, handbackHours: Number(e.target.value) })
                          }
                          className="rounded-control border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums disabled:opacity-40"
                        >
                          {HANDBACK_HOURS.map((h) => (
                            <option key={h} value={h}>
                              {h} h
                            </option>
                          ))}
                        </select>
                      </Tooltip>
                    )}
                    <DeliveryChoice
                      kind={label}
                      value={pref.delivery}
                      disabled={!pref.on}
                      onChange={(delivery) => {
                        set({ delivery });
                        if (delivery === 'browser' && permission === 'default') ask();
                      }}
                    />
                    <Switch label={label} checked={pref.on} onChange={(on) => set({ on })} />
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 border-t border-line-soft pt-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex flex-1 items-center gap-2">
                <Lock aria-hidden className="size-4 text-faint" />
                <span className="text-ink">Only what only I can do</span>
                <InfoTip
                  label="About only what only I can do"
                  detail="Toasts and browser notifications only for gates (a secret, a payment, a push); everything else waits in the bell."
                />
              </span>
              <Switch
                label="Only what only I can do"
                checked={prefs.onlyGates}
                onChange={(onlyGates) => change({ ...prefs, onlyGates })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex flex-1 items-center gap-2">
                <BellOff aria-hidden className="size-4 text-faint" />
                <span className="text-ink">Quiet hours</span>
                <InfoTip
                  label="About quiet hours"
                  detail="No toasts or browser notifications between these times (this computer’s clock); the bell still counts them."
                />
              </span>
              <span className={clsx('flex items-center gap-1', !prefs.quiet.on && 'opacity-40')}>
                <input
                  type="time"
                  aria-label="Quiet from"
                  value={prefs.quiet.from}
                  disabled={!prefs.quiet.on}
                  onChange={(e) =>
                    e.target.value &&
                    change({ ...prefs, quiet: { ...prefs.quiet, from: e.target.value } })
                  }
                  className="rounded-control border border-line-strong bg-surface px-1.5 py-0.5 text-xs tabular-nums"
                />
                <span aria-hidden className="text-faint">
                  –
                </span>
                <input
                  type="time"
                  aria-label="Quiet until"
                  value={prefs.quiet.to}
                  disabled={!prefs.quiet.on}
                  onChange={(e) =>
                    e.target.value &&
                    change({ ...prefs, quiet: { ...prefs.quiet, to: e.target.value } })
                  }
                  className="rounded-control border border-line-strong bg-surface px-1.5 py-0.5 text-xs tabular-nums"
                />
              </span>
              <Switch
                label="Quiet hours"
                checked={prefs.quiet.on}
                onChange={(on) => change({ ...prefs, quiet: { ...prefs.quiet, on } })}
              />
            </div>
            {usesBrowser && (
              <div className="flex items-center gap-2 pl-6" data-permission={permission}>
                <PermissionState permission={permission} onAsk={ask} />
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
