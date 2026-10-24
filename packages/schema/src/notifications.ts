import { z } from 'zod';

/**
 * Notifications: what Pharos tells the owner happened while they were away. They come from what
 * the server already knows (the desk, the run log, the agent terminals, R11 freshness, hand-backs)
 * and are kept in the `notifications` table, an operational log like `runs`: not project data,
 * never revisions, never over MCP. How each kind reaches the owner is an app setting.
 */

export const NOTIFICATION_KINDS = [
  'desk',
  'run',
  'terminal',
  'agent-answered',
  'stale',
  'handback',
  'system',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The kinds the owner can tune in Settings (`system` is Pharos itself: always on, a modal). */
export const NOTIFICATION_PREF_KINDS = [
  'desk',
  'run',
  'terminal',
  'agent-answered',
  'stale',
  'handback',
] as const;
export type NotificationPrefKind = (typeof NOTIFICATION_PREF_KINDS)[number];

/** Where a notification shows: only in the bell's list, as a toast too, or as a system banner. */
export const NOTIFICATION_DELIVERIES = ['bell', 'toast', 'browser'] as const;
export type NotificationDelivery = (typeof NOTIFICATION_DELIVERIES)[number];

export type PharosNotification = {
  id: number;
  kind: NotificationKind;
  /** One line: what happened. */
  title: string;
  /** A second line, shown in the bell's list and the toast's tooltip. */
  detail?: string;
  projectId?: string;
  project?: string;
  /** Where its action goes in the web app. */
  href?: string;
  /** The action's label: Open, Answer, Reopen. */
  action?: string;
  /** Only the owner can do it (a gate on the desk). */
  gate: boolean;
  /** Blocks until read: shown as a modal (rare: Pharos restarted under a running agent). */
  modal: boolean;
  at: string;
  readAt?: string;
};

export type NotificationList = {
  items: PharosNotification[];
  unread: number;
  /** The newest id, for `?since=`. */
  latest: number;
};

const Delivery = z.enum(NOTIFICATION_DELIVERIES);
const KindPref = z.strictObject({ on: z.boolean(), delivery: Delivery });
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const NotificationPrefs = z.strictObject({
  kinds: z.strictObject({
    desk: KindPref,
    run: KindPref,
    terminal: KindPref,
    /** An agent in a panel finished its turn while no one looked at the panel. */
    'agent-answered': KindPref,
    stale: KindPref,
    handback: KindPref,
  }),
  /** No toasts or browser notifications between these local times (the bell still counts). */
  quiet: z.strictObject({ on: z.boolean(), from: Time, to: Time }),
  /** Interrupt (toast, browser) only for gates; everything else goes to the bell. */
  onlyGates: z.boolean(),
  /** A hand-back nobody picked up for this many hours notifies (`handback`). */
  handbackHours: z.number().int().min(1).max(168),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

/** The app setting key the preferences are saved under (Store.setSetting). */
export const NOTIFICATION_PREFS_SETTING = 'notifications.prefs';

/** Desk items, failed runs and answers in an unwatched panel as toasts, the rest in the bell only; browser notifications off. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  kinds: {
    desk: { on: true, delivery: 'toast' },
    run: { on: true, delivery: 'toast' },
    terminal: { on: true, delivery: 'bell' },
    'agent-answered': { on: true, delivery: 'toast' },
    stale: { on: true, delivery: 'bell' },
    handback: { on: true, delivery: 'bell' },
  },
  quiet: { on: false, from: '22:00', to: '07:00' },
  onlyGates: false,
  handbackHours: 4,
};

/** Saved preferences over the defaults, so a kind added later starts at its default. */
export function notificationPrefsOf(saved: unknown): NotificationPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<NotificationPrefs>;
  const merged = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...s,
    kinds: { ...DEFAULT_NOTIFICATION_PREFS.kinds, ...(s.kinds ?? {}) },
    quiet: { ...DEFAULT_NOTIFICATION_PREFS.quiet, ...(s.quiet ?? {}) },
  };
  const parsed = NotificationPrefs.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether a local time ("HH:MM" or minutes past midnight) falls in quiet hours (may wrap midnight). */
export function inQuietHours(prefs: NotificationPrefs, minutes: number): boolean {
  if (!prefs.quiet.on) return false;
  const from = minutesOf(prefs.quiet.from);
  const to = minutesOf(prefs.quiet.to);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * How one notification reaches the owner now: `none` (kind off: not even the bell), `bell` (the
 * list and its count only), `toast`, or `browser` (a system notification; a toast when the tab is
 * in front). A modal is always shown. Quiet hours and "only gates" keep the rest in the bell.
 */
export function deliveryOf(
  prefs: NotificationPrefs,
  n: Pick<PharosNotification, 'kind' | 'gate' | 'modal'>,
  localMinutes: number,
): 'none' | 'bell' | 'toast' | 'browser' | 'modal' {
  if (n.modal || n.kind === 'system') return 'modal';
  const pref = prefs.kinds[n.kind];
  if (!pref.on) return 'none';
  if (pref.delivery === 'bell') return 'bell';
  if (prefs.onlyGates && !n.gate) return 'bell';
  if (inQuietHours(prefs, localMinutes)) return 'bell';
  return pref.delivery;
}
