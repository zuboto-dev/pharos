import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type PharosNotification,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceNotification } from '../lib/events';
import { NotificationSettings } from '../pages/settings-notifications';
import { NotificationsProvider, TOAST_MS, type BrowserNotify } from './model';
import { NotificationBell, NotificationModal, ToastStack } from './ui';

class FakeEventSource {
  addEventListener() {}
  close() {}
}

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let list: PharosNotification[];
let prefs: NotificationPrefs;

const note = (id: number, over: Partial<PharosNotification> = {}): PharosNotification => ({
  id,
  kind: 'desk',
  title: `Item ${id}`,
  project: 'Garden',
  href: `/projects/p1?entity=d${id}`,
  action: 'Answer',
  gate: false,
  modal: false,
  at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  calls = [];
  list = [];
  prefs = structuredClone(DEFAULT_NOTIFICATION_PREFS);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.startsWith('/api/notifications?'))
      return Response.json({
        items: list,
        unread: list.filter((n) => !n.readAt).length,
        latest: list[0]?.id ?? 0,
      });
    if (url === '/api/notifications/read') return Response.json({ changed: 1, unread: 0 });
    if (url === '/api/settings/notifications' && method === 'PUT') {
      prefs = body as NotificationPrefs;
      return Response.json(prefs);
    }
    if (url === '/api/settings/notifications') return Response.json(prefs);
    return Response.json({});
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderShell(notify: BrowserNotify = () => false) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NotificationsProvider notify={notify} now={() => new Date('2026-10-23T12:00:00')}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <ToastStack />
        <NotificationModal />
      </NotificationsProvider>
    </MemoryRouter>,
  );
}

const send = (n: PharosNotification) => act(() => announceNotification(n));

describe('toast stack', () => {
  it('shows a toast with its icon, one line and its action; the action goes there and marks it read', async () => {
    renderShell();
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/notifications?'))).toBe(true),
    );
    send(note(1, { title: 'Which seeds?' }));
    const toast = await screen.findByRole('status');
    expect(toast.getAttribute('data-toast')).toBe('desk');
    expect(toast.querySelector('[data-icon="desk"]')).not.toBeNull();
    expect(within(toast).getByText('Which seeds?')).toBeTruthy();
    fireEvent.click(within(toast).getByRole('button', { name: 'Answer' }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?entity=d1');
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/notifications/read')?.body).toEqual({ ids: [1] }),
    );
  });

  it('an agent that answered in an unwatched panel shows as a toast; Open goes to its panel', async () => {
    renderShell();
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/notifications?'))).toBe(true),
    );
    send(
      note(7, {
        kind: 'agent-answered',
        title: 'Claude Code answered in Tutti',
        project: 'Tutti',
        href: '/projects/p1?terminal=1',
        action: 'Open',
      }),
    );
    const toast = await screen.findByRole('status');
    expect(toast.getAttribute('data-toast')).toBe('agent-answered');
    expect(toast.querySelector('[data-icon="agent-answered"]')).not.toBeNull();
    expect(within(toast).getByText('Claude Code answered in Tutti')).toBeTruthy();
    fireEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?terminal=1');
  });

  it('a gate shows the lock; dismiss closes it; it goes by itself after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderShell();
    send(note(2, { gate: true, title: 'Pay the fee' }));
    const toast = await screen.findByRole('status');
    expect(toast.querySelector('[data-icon="gate"]')).not.toBeNull();
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    send(note(3));
    expect(await screen.findByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(TOAST_MS + 50));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bell-only kinds, kinds turned off, quiet hours and "only gates" make no toast', async () => {
    prefs.kinds.desk.on = false;
    prefs.onlyGates = true;
    renderShell();
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/settings/notifications')).toBe(true),
    );
    await act(async () => {});
    send(note(4, { kind: 'stale' })); // bell only by default
    send(note(5)); // desk is off
    send(note(6, { kind: 'run' })); // not a gate
    expect(screen.queryByRole('status')).toBeNull();
    send(note(7, { kind: 'run', gate: true }));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('browser delivery: a system notification while the tab is hidden, a toast while it shows', async () => {
    prefs.kinds.run.delivery = 'browser';
    const shown: string[] = [];
    renderShell((n) => {
      shown.push(n.title);
      return true;
    });
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/settings/notifications')).toBe(true),
    );
    await act(async () => {});
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    send(note(8, { kind: 'run', title: 'Night run: failed' }));
    expect(shown).toEqual(['Night run: failed']);
    expect(screen.queryByRole('status')).toBeNull();
    visibility.mockReturnValue('visible');
    send(note(9, { kind: 'run', title: 'Morning: partly done' }));
    expect(shown).toHaveLength(1);
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});

describe('bell', () => {
  it('counts unread, lists recent ones, opens one, and marks all read', async () => {
    list = [
      note(12, { title: 'Newest', kind: 'run' }),
      note(11, { title: 'Read one', readAt: new Date().toISOString() }),
      note(10, { title: 'Oldest' }),
    ];
    renderShell();
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    send(note(13, { kind: 'stale', title: 'Page out of date' }));
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBe(bell);
    fireEvent.click(bell);
    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.split('Garden')[0])).toEqual([
      'Page out of date',
      'Newest',
      'Read one',
      'Oldest',
    ]);
    expect(panel.querySelectorAll('[data-unread]')).toHaveLength(3);
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/notifications/read')?.body).toEqual({});
    fireEvent.click(within(panel).getByRole('button', { name: /^Oldest/ }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?entity=d10');
  });

  it('says so when there is nothing yet', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});

describe('modal', () => {
  it('a blocking notification that came while away opens as a modal; Reopen goes there', async () => {
    list = [
      note(20, {
        kind: 'system',
        modal: true,
        title: 'Pharos restarted; your agent stopped',
        detail: 'Claude Code was running in Garden.',
        href: '/projects/p1?terminal=1',
        action: 'Reopen',
      }),
    ];
    renderShell();
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Pharos restarted; your agent stopped',
    });
    expect(within(dialog).getByText(/Claude Code was running/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen' }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?terminal=1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Close marks it read and closes it; ordinary ones never open a modal', async () => {
    renderShell();
    send(note(21));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    send(note(22, { kind: 'system', modal: true, title: 'Restarted' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Restarted' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/notifications/read')?.body).toEqual({ ids: [22] }),
    );
  });
});

describe('settings form', () => {
  const renderSettings = (ask = vi.fn(async () => 'granted' as const)) => {
    render(
      <MemoryRouter>
        <NotificationSettings askPermission={ask} />
      </MemoryRouter>,
    );
    return ask;
  };
  const lastPut = () =>
    calls.filter((c) => c.url === '/api/settings/notifications' && c.method === 'PUT').at(-1)
      ?.body as NotificationPrefs;

  it('shows the defaults: desk and runs as toasts, the rest bell only, all on', async () => {
    renderSettings();
    const kinds = await screen.findByRole('list', { name: 'Kinds of notification' });
    for (const [label, delivery] of [
      ['Needs you', 'Toast'],
      ['Run failed', 'Toast'],
      ['Agent finished', 'Bell only'],
      ['Agent answered', 'Toast'],
      ['Page out of date', 'Bell only'],
      ['Hand-back waiting', 'Bell only'],
    ]) {
      expect(within(kinds).getByRole('switch', { name: label }).getAttribute('aria-checked')).toBe(
        'true',
      );
      const group = within(kinds).getByRole('radiogroup', { name: `How “${label}” reaches you` });
      expect(
        within(group).getByRole('radio', { name: delivery! }).getAttribute('aria-checked'),
      ).toBe('true');
    }
    expect(screen.getByRole('switch', { name: 'Quiet hours' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('saves each change: a kind off, a delivery, only gates, quiet hours and the hand-back hours', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: 'Page out of date' }));
    await waitFor(() => expect(lastPut()?.kinds.stale.on).toBe(false));
    const group = screen.getByRole('radiogroup', { name: 'How “Agent finished” reaches you' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Toast' }));
    await waitFor(() => expect(lastPut()?.kinds.terminal.delivery).toBe('toast'));
    fireEvent.click(screen.getByRole('switch', { name: 'Only what only I can do' }));
    await waitFor(() => expect(lastPut()?.onlyGates).toBe(true));
    fireEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    await waitFor(() => expect(lastPut()?.quiet.on).toBe(true));
    fireEvent.change(screen.getByLabelText('Quiet from'), { target: { value: '21:30' } });
    await waitFor(() => expect(lastPut()?.quiet).toEqual({ on: true, from: '21:30', to: '07:00' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Hours before it notifies' }), {
      target: { value: '8' },
    });
    await waitFor(() => expect(lastPut()?.handbackHours).toBe(8));
    // The earlier changes are kept in each save.
    expect(lastPut()?.kinds.stale.on).toBe(false);
    expect(lastPut()?.onlyGates).toBe(true);
  });

  it('asks the browser only when a kind is set to browser notifications', async () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    const ask = renderSettings();
    await screen.findByRole('list', { name: 'Kinds of notification' });
    expect(ask).not.toHaveBeenCalled();
    const group = screen.getByRole('radiogroup', { name: 'How “Needs you” reaches you' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Browser notification' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Allowed in this browser')).toBeTruthy();
    await waitFor(() => expect(lastPut()?.kinds.desk.delivery).toBe('browser'));
  });
});
