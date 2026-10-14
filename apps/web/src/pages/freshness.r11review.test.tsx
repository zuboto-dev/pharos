import type { ProjectFreshness } from '@pharos/schema';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RevisionEvent } from '../lib/events';
import { usePageFreshness } from './freshness';
import { requestRunState } from './requests';

const mocks = vi.hoisted(() => ({
  handler: undefined as ((event: RevisionEvent) => void) | undefined,
  viewFreshness: vi.fn(),
  markViewSeen: vi.fn(),
}));
vi.mock('../lib/events', () => ({
  useRevisionEvents: (handler: (event: RevisionEvent) => void) => {
    mocks.handler = handler;
  },
  useAgentStatus: vi.fn(),
}));
vi.mock('../lib/freshness', () => ({
  viewFreshness: mocks.viewFreshness,
  markViewSeen: mocks.markViewSeen,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function response(latest: number, stale = false): ProjectFreshness {
  return {
    projectId: 'synthetic-project',
    latest,
    views: {
      'synthetic-view': {
        viewId: 'synthetic-view',
        seen: 10,
        changed: null,
        evidence: {
          revision: 10,
          at: '2026-10-13T12:00:00Z',
          stale: stale
            ? {
                since: 10,
                total: 1,
                recent: [
                  {
                    revision: latest,
                    at: '2026-10-13T12:01:00Z',
                    author: { kind: 'agent', name: 'Synthetic agent' },
                    message: 'Synthetic change',
                    page: false,
                    items: [],
                  },
                ],
              }
            : null,
        },
      },
    },
  };
}

describe('freshness display review', () => {
  it('does not replace a newer stale result with an older fresh response', async () => {
    mocks.viewFreshness.mockResolvedValueOnce(response(10));
    mocks.markViewSeen.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePageFreshness('synthetic-project', 'synthetic-view'));
    await act(async () => {});
    let older!: (value: ProjectFreshness) => void;
    let newer!: (value: ProjectFreshness) => void;
    mocks.viewFreshness.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          older = resolve;
        }),
    );
    mocks.viewFreshness.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newer = resolve;
        }),
    );
    act(() => {
      mocks.handler!({ id: 11, projectIds: ['synthetic-project'] } as RevisionEvent);
      mocks.handler!({ id: 12, projectIds: ['synthetic-project'] } as RevisionEvent);
    });
    await act(async () => newer(response(12, true)));
    expect(result.current?.evidence).toMatchObject({ stale: { total: 1 } });
    await act(async () => older(response(11)));
    expect(result.current?.evidence).toMatchObject({ stale: { total: 1 } });
  });

  it('does not label an idle unqueued request as scheduled after a restart', () => {
    // A new runner has not called answerWaiting yet. A previous in-memory outcome is gone.
    expect(
      requestRunState('synthetic-request', {
        configured: true,
        enabled: true,
        paused: false,
        state: 'idle',
        mode: 'custom',
        running: false,
        answering: [],
        queued: [],
      }).kind,
    ).toBe('waiting');
  });
});
