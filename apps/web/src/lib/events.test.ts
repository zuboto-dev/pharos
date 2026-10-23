import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRevisionEvents, type RevisionEvent } from './events';

/** A stand-in EventSource the test drives: `emit` sends a named event to the page. */
class FakeSource {
  static last: FakeSource | undefined;
  handlers = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor() {
    FakeSource.last = this;
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  close() {}
  emit(name: string, data: object) {
    for (const fn of this.handlers.get(name) ?? [])
      fn({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('the revision feed', () => {
  it('after a reconnect, revisions saved while it was down reload everything shown', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const seen: RevisionEvent[] = [];
    const { unmount } = renderHook(() => useRevisionEvents((e) => seen.push(e)));
    const source = FakeSource.last!;
    // First connect: the page starts from the server's latest; nothing is missed.
    source.emit('ready', { latest: 10 });
    source.emit('revision', { id: 11, projectIds: ['p1'] });
    // The server restarted (an update) and two revisions landed meanwhile.
    source.emit('ready', { latest: 13 });
    // Reconnecting with nothing new says nothing.
    source.emit('ready', { latest: 13 });
    expect(seen).toEqual([
      { id: 11, projectIds: ['p1'] },
      { id: 13, projectIds: [], missed: true },
    ]);
    unmount();
  });
});
