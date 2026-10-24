import {
  DEFAULT_NOTIFICATION_PREFS,
  deliveryOf,
  notificationPrefsOf,
  type NotificationKind,
  type NotificationList,
  type NotificationPrefs,
  type PharosNotification,
} from '@pharos/schema';
import {
  AlertTriangle,
  Bot,
  Cog,
  Inbox,
  Lock,
  RefreshCw,
  Send,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { getJson, postJson } from '../lib/api';
import { useNotificationEvents } from '../lib/events';

/**
 * Notifications in the web app: the bell's list and count (from GET /api/notifications, kept on
 * the server so what came while no tab was open is there), toasts for new ones as they arrive on
 * the feed, a browser notification when the owner chose one and the tab is in the background, and
 * a modal for the rare one that blocks. How each kind arrives is the owner's choice in Settings.
 */

export const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  desk: Inbox,
  run: AlertTriangle,
  terminal: Bot,
  'agent-answered': SquareTerminal,
  stale: RefreshCw,
  handback: Send,
  system: Cog,
};

export const KIND_TONE: Record<NotificationKind, string> = {
  desk: 'text-sky-600 dark:text-sky-400',
  run: 'text-danger',
  terminal: 'text-ok',
  'agent-answered': 'text-accent',
  stale: 'text-warn',
  handback: 'text-violet-600 dark:text-violet-400',
  system: 'text-muted',
};

export const toneOf = (n: Pick<PharosNotification, 'kind' | 'gate'>): string =>
  n.gate ? 'text-warn' : KIND_TONE[n.kind];

/** A notification's symbol in its colour; a gate shows the lock (only the owner can do it). */
export function NoticeIcon({
  n,
  className,
}: {
  n: Pick<PharosNotification, 'kind' | 'gate'>;
  className?: string;
}) {
  const Icon = n.gate ? Lock : KIND_ICON[n.kind];
  return (
    <Icon
      aria-hidden
      data-icon={n.gate ? 'gate' : n.kind}
      className={[className, toneOf(n)].filter(Boolean).join(' ')}
    />
  );
}

/** How long a toast stays (it waits while hovered or focused). */
export const TOAST_MS = 7000;
/** At most this many toasts at once; older ones go to the bell only. */
export const MAX_TOASTS = 3;

const localMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes();

// Settings saves preferences; the open app takes them at once.
const prefsListeners = new Set<(prefs: NotificationPrefs) => void>();
export function announcePrefs(prefs: NotificationPrefs): void {
  for (const listener of prefsListeners) listener(prefs);
}

export type BrowserNotify = (n: PharosNotification, open: () => void) => boolean;

/** A system notification, when this browser has allowed them; false when it couldn't. */
export const browserNotify: BrowserNotify = (n, open) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const shown = new Notification(n.title, {
      body: [n.project, n.detail].filter(Boolean).join(' · '),
      tag: `pharos-${n.id}`,
    });
    shown.onclick = () => {
      window.focus();
      open();
      shown.close();
    };
    return true;
  } catch {
    return false;
  }
};

type State = {
  items: PharosNotification[];
  unread: number;
  prefs: NotificationPrefs;
  toasts: PharosNotification[];
  modal: PharosNotification | null;
  /** Goes where a notification points and marks it read. */
  open: (n: PharosNotification) => void;
  markRead: (ids?: number[]) => void;
  dismissToast: (id: number) => void;
  reload: () => void;
};

const Ctx = createContext<State | null>(null);

export function useNotifications(): State | null {
  return useContext(Ctx);
}

export function NotificationsProvider({
  children,
  notify = browserNotify,
  now = () => new Date(),
}: {
  children: ReactNode;
  /** Shows a browser notification (tests pass a fake). */
  notify?: BrowserNotify;
  now?: () => Date;
}) {
  const [items, setItems] = useState<PharosNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [toasts, setToasts] = useState<PharosNotification[]>([]);
  const [modal, setModal] = useState<PharosNotification | null>(null);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const navigate = useNavigate();

  const reload = useCallback(() => {
    getJson<NotificationList>('/api/notifications?limit=50')
      .then((list) => {
        if (!Array.isArray(list?.items)) return;
        setItems(list.items);
        setUnread(list.unread ?? 0);
        // A modal that came while no tab was open still blocks until read.
        const blocking = list.items.find((n) => n.modal && !n.readAt);
        if (blocking) setModal((m) => m ?? blocking);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    getJson<unknown>('/api/settings/notifications')
      .then((p) => setPrefs(notificationPrefsOf(p)))
      .catch(() => {});
    prefsListeners.add(setPrefs);
    return () => {
      prefsListeners.delete(setPrefs);
    };
  }, [reload]);

  const markRead = useCallback((ids?: number[]) => {
    const at = new Date().toISOString();
    setItems((list) =>
      list.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: at } : n)),
    );
    if (!ids) setUnread(0);
    postJson<{ unread: number }>('/api/notifications/read', ids ? { ids } : {})
      .then((r) => typeof r?.unread === 'number' && setUnread(r.unread))
      .catch(() => {});
  }, []);

  const dismissToast = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );

  const open = useCallback(
    (n: PharosNotification) => {
      if (!n.readAt) markRead([n.id]);
      setToasts((list) => list.filter((t) => t.id !== n.id));
      if (modal?.id === n.id) setModal(null);
      if (n.href) navigate(n.href);
    },
    [markRead, modal, navigate],
  );
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useNotificationEvents((n) => {
    setItems((list) => (list.some((i) => i.id === n.id) ? list : [n, ...list].slice(0, 50)));
    if (!n.readAt) setUnread((u) => u + 1);
    const how = deliveryOf(prefsRef.current, n, localMinutes(now()));
    if (how === 'modal') {
      setModal((m) => m ?? n);
      return;
    }
    if (how === 'none' || how === 'bell') return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (how === 'browser' && hidden && notify(n, () => openRef.current(n))) return;
    setToasts((list) => [...list.filter((t) => t.id !== n.id), n].slice(-MAX_TOASTS));
  }, reload);

  const value = useMemo(
    () => ({
      items,
      unread,
      prefs,
      toasts,
      modal,
      open,
      markRead: (ids?: number[]) => {
        markRead(ids);
        if (!ids || (modal && ids.includes(modal.id))) setModal(null);
      },
      dismissToast,
      reload,
    }),
    [items, unread, prefs, toasts, modal, open, markRead, dismissToast, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
