import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Stands in for the browser's EventSource so the test can play the server's events. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  private handlers = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {}
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    act(() => this.handlers.get(type)?.forEach((fn) => fn(event)));
  }
}

// events.ts keeps its connection and the loaded build per page, so each test gets a fresh copy.
async function renderNotice() {
  vi.resetModules();
  const { UpdateNotice } = await import('./UpdateNotice');
  const reload = vi.fn();
  render(<UpdateNotice reload={reload} />);
  return { reload, server: FakeEventSource.last! };
}

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UpdateNotice', () => {
  it('stays quiet while the server keeps the build the page loaded with', async () => {
    const { server } = await renderNotice();
    expect(server.url).toBe('/api/events');
    server.emit('ready', { latest: 3, version: '0.1.0', build: 'aaa' });
    server.emit('ready', { latest: 4, version: '0.1.0', build: 'aaa' }); // a plain restart
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a reload after an update, and reloads only when asked', async () => {
    const { server, reload } = await renderNotice();
    server.emit('ready', { latest: 3, version: '0.1.0', build: 'aaa' });
    server.emit('ready', { latest: 3, version: '0.1.0', build: 'bbb' });
    expect(screen.getByRole('status').textContent).toContain('Pharos has been updated');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('hides on "Later" until the next update', async () => {
    const { server } = await renderNotice();
    server.emit('ready', { version: '0.1.0', build: 'aaa' });
    server.emit('ready', { version: '0.1.0', build: 'bbb' });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status')).toBeNull();
    server.emit('ready', { version: '0.1.0', build: 'bbb' });
    expect(screen.queryByRole('status')).toBeNull();
    server.emit('ready', { version: '0.1.0', build: 'ccc' });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('falls back to the version when the server sends no build (the dev server)', async () => {
    const { server } = await renderNotice();
    server.emit('ready', { version: '0.1.0' });
    server.emit('ready', { version: '0.1.0' });
    expect(screen.queryByRole('status')).toBeNull();
    server.emit('ready', { version: '0.2.0' });
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
