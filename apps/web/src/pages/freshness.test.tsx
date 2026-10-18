import type { Entity, ProjectDataset, ViewFreshness } from '@pharos/schema';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import type { AgentStatus } from '../lib/events';
import { announceChangedViews, reloadChangedViews, useChangedViews } from '../lib/freshness';
import {
  EvidenceNote,
  WhatChanged,
  authorName,
  changesSentence,
  refreshRequest,
  staleSentence,
} from './freshness';
import { requestRunState } from './requests';
import { agentSummary, lastRunText } from './SettingsPage';
import { ViewTabs } from './ViewTabs';

const data = dataset as unknown as ProjectDataset;
const [first, second] = data.views as Entity<'view'>[];
const answer: Entity<'view'> = {
  ...first!,
  id: 'view_answer',
  data: { ...first!.data, name: 'Blocked?', kind: 'answer', question: 'What is blocked?' },
};
const agent = { kind: 'agent' as const, name: 'Opus 5.5' };

// No server here: every load answers 404, so only what a test announces is shown.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  announceChangedViews({ latest: 0, projects: {} });
});

function renderWith(node: React.ReactNode, apply = vi.fn<ViewActions['apply']>(), extra = {}) {
  const open = vi.fn();
  render(
    <MemoryRouter>
      <ViewDataProvider data={{ ...data, ...extra }} version={1} actions={{ apply, open }}>
        {node}
      </ViewDataProvider>
    </MemoryRouter>,
  );
  return { apply, open };
}

const changes = {
  since: 10,
  total: 2,
  recent: [
    {
      revision: 12,
      at: new Date().toISOString(),
      author: agent,
      message: 'Log oil change',
      items: [{ type: 'record' as const, id: 'rec_1', label: 'Oil change', op: 'create' as const }],
      page: false,
    },
    {
      revision: 11,
      at: new Date().toISOString(),
      author: agent,
      message: 'Retitle',
      items: [],
      page: true,
    },
  ],
};

describe('what changed since you looked (R11.5)', () => {
  it('says who changed what, in one sentence', () => {
    expect(changesSentence(changes)).toBe('Opus 5.5 changed “Oil change” and this page');
    expect(
      changesSentence({
        ...changes,
        total: 5,
        recent: [{ ...changes.recent[0]!, author: { kind: 'human', name: 'me' } }],
      }),
    ).toBe('You changed “Oil change” (and 4 earlier changes)');
  });

  it('says "you" in lower case unless it starts the sentence (R13.5)', () => {
    const me = { kind: 'human' as const, name: 'me' };
    expect(authorName(me)).toBe('You');
    expect(authorName(me, false)).toBe('you');
    expect(authorName({ kind: 'human', name: 'Ana' }, false)).toBe('Ana');
    const mine = {
      ...changes,
      total: 1,
      recent: [{ ...changes.recent[0]!, author: me }],
    };
    expect(staleSentence(mine)).toBe('you changed “Oil change”');
    // A second clause is inside the sentence too; the same author keeps one clause.
    const both = {
      ...changes,
      total: 3,
      recent: [
        changes.recent[0]!,
        { ...changes.recent[0]!, revision: 11, author: me },
        { ...changes.recent[0]!, revision: 10, author: me },
      ],
    };
    expect(changesSentence(both)).toBe('Opus 5.5 changed “Oil change”; you changed “Oil change”');
    expect(changesSentence({ ...both, recent: both.recent.slice(1) })).toBe(
      'You changed “Oil change” (and 1 earlier change)',
    );
  });

  it('shows the line with a link to history, and hides it on request', () => {
    const freshness: ViewFreshness = {
      viewId: first!.id,
      seen: 10,
      changed: changes,
      evidence: null,
    };
    const { open } = renderWith(<WhatChanged freshness={freshness} />);
    expect(screen.getByRole('status').textContent).toContain(
      'Since you last looked: Opus 5.5 changed “Oil change” and this page.',
    );
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(open).toHaveBeenCalledWith({ history: true });
    fireEvent.click(screen.getByRole('button', { name: 'Hide what changed' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing when nothing changed', () => {
    renderWith(
      <WhatChanged freshness={{ viewId: first!.id, seen: 10, changed: null, evidence: null }} />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('stale answers (R11.5)', () => {
  const at = '2026-10-10T09:00:00.000Z';
  it('fresh: as of a date, nothing to do', () => {
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: { revision: 9, at, stale: null },
        }}
      />,
    );
    expect(document.querySelector('[data-evidence="fresh"]')?.textContent).toMatch(
      /^Written as of .*nothing it was written from has changed since\.$/,
    );
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  });

  it('stale: names what changed and refreshes by asking the agent (keyboard too)', async () => {
    const apply = vi.fn<ViewActions['apply']>(async () => ({
      ok: true,
      revision: 20,
      created: {},
    }));
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: { revision: 9, at, stale: changes },
        }}
      />,
      apply,
    );
    const note = document.querySelector('[data-evidence="stale"]')!;
    expect(note.textContent).toContain('May be out of date.');
    expect(note.textContent).toContain('since then Opus 5.5 changed “Oil change”');
    const button = screen.getByRole('button', { name: /Refresh/ });
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => fireEvent.click(button));
    const { message, operations } = refreshRequest(answer);
    expect(apply).toHaveBeenCalledWith(message, operations);
    expect(operations[0]!.data).toMatchObject({
      mode: 'refresh',
      viewId: answer.id,
      question: 'What is blocked?',
    });
  });

  it('a refresh of a report page says it is about that page', () => {
    const page: Entity<'view'> = {
      ...first!,
      id: 'view_page',
      data: { ...first!.data, name: 'Spending story', page: { html: '<p>Hi</p>' } },
    };
    expect(refreshRequest(page).operations[0]!.data).toMatchObject({
      mode: 'refresh',
      viewId: 'view_page',
      about: 'Report page “Spending story”',
    });
    expect(refreshRequest(answer).operations[0]!.data.about).toBe('Answer “Blocked?”');
  });

  it('a saved page an agent built says it calmly, in one line', () => {
    renderWith(
      <EvidenceNote
        view={first!}
        freshness={{
          viewId: first!.id,
          seen: 1,
          changed: null,
          evidence: { revision: 9, at, stale: changes },
        }}
      />,
    );
    const note = document.querySelector('[data-evidence="stale"]')!;
    expect(note.textContent).toContain('its text may be out of date');
    expect(note.textContent).not.toContain('May be out of date.');
    cleanup();
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: {
            revision: 9,
            at,
            stale: {
              ...changes,
              recent: [{ ...changes.recent[0]!, author: { kind: 'human', name: 'me' } }],
            },
          },
        }}
      />,
    );
    expect(document.querySelector('[data-evidence="stale"]')!.textContent).toContain(
      'since then you changed “Oil change”',
    );
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy();
  });

  it('a refresh already asked waits for the agent', () => {
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: { revision: 9, at, stale: changes },
        }}
      />,
      undefined,
      {
        requests: [
          {
            id: 'req_1',
            type: 'request',
            data: {
              projectId: answer.data.projectId,
              question: 'What is blocked?',
              status: 'open',
              mode: 'refresh',
              viewId: answer.id,
            },
          },
        ],
      },
    );
    expect(screen.getByText('Refresh asked: waiting for your agent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
  });

  it('unknown: written before Pharos kept track', () => {
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{ viewId: answer.id, seen: 1, changed: null, evidence: { unknown: true } }}
      />,
    );
    expect(document.querySelector('[data-evidence="unknown"]')?.textContent).toContain(
      'Evidence unknown',
    );
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy();
  });

  it('unknown: nothing on the page reads data (R11 fix round)', () => {
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: { unknown: true, reason: 'no_data' },
        }}
      />,
    );
    expect(document.querySelector('[data-evidence="unknown"]')?.textContent).toContain(
      'nothing on this page reads the project’s data',
    );
  });

  it('stale because the date moved on, with no revision (R11 fix round)', () => {
    renderWith(
      <EvidenceNote
        view={answer}
        freshness={{
          viewId: answer.id,
          seen: 1,
          changed: null,
          evidence: {
            revision: 1,
            at: '2026-10-12T12:00:00Z',
            stale: {
              since: 1,
              total: 0,
              recent: [],
              calendar: { from: '2026-10-12', to: '2026-10-13' },
            },
          },
        }}
      />,
    );
    const note = document.querySelector('[data-evidence="stale"]')?.textContent ?? '';
    expect(note).toContain('May be out of date');
    expect(note).toContain('the date moved on from');
    expect(note).toContain('its date-based blocks show other items');
  });
});

describe('the changed dot (R11.5)', () => {
  it('marks other tabs that changed, never the open one', () => {
    renderWith(
      <ViewTabs projectId="p" views={[first!, second!]} active={first} onCreated={vi.fn()} />,
    );
    act(() => announceChangedViews({ latest: 5, projects: { p: [first!.id, second!.id] } }));
    const dots = document.querySelectorAll('[data-changed-dot]');
    expect(dots).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: `${second!.data.name} (changed since you looked)` }),
    ).toBeTruthy();
    // Opening it (here: the server says it was seen) clears it.
    act(() => announceChangedViews({ latest: 6, projects: {} }));
    expect(document.querySelectorAll('[data-changed-dot]')).toHaveLength(0);
  });
});

const base: AgentStatus = {
  configured: true,
  enabled: true,
  paused: false,
  state: 'idle',
  mode: 'default',
  running: false,
  answering: [],
  queued: [],
};

describe('true run states (W7.5)', () => {
  it('Settings says what really happens, pause included', () => {
    expect(agentSummary(base).text).toBe('On: new questions are answered automatically');
    expect(
      agentSummary({
        ...base,
        state: 'running',
        running: true,
        run: { projectIds: ['p'], requestIds: ['r1', 'r2'], startedAt: new Date().toISOString() },
      }).text,
    ).toMatch(/^Answering 2 questions now, started /);
    expect(
      agentSummary({
        ...base,
        state: 'stopping',
        running: true,
        enabled: false,
        paused: true,
        run: { projectIds: ['p'], requestIds: ['r1'], startedAt: new Date().toISOString() },
      }).text,
    ).toBe(
      'Pausing: the run answering 1 question was told to stop and is ending; its questions stay open',
    );
    expect(
      agentSummary({
        ...base,
        state: 'paused',
        enabled: false,
        paused: true,
        lastRun: {
          projectIds: ['p'],
          requestIds: ['r1'],
          startedAt: '',
          finishedAt: '',
          durationMs: 1,
          exitCode: null,
          timedOut: false,
          stopped: true,
          outcome: 'stopped',
        },
      }).text,
    ).toMatch(/^Paused: the last run was stopped and nothing is running/);
    expect(agentSummary({ ...base, mode: 'off', configured: false, enabled: false }).text).toMatch(
      /^Off/,
    );
  });

  it('says how the last run ended', () => {
    const run = {
      projectIds: ['p'],
      requestIds: ['r1'],
      startedAt: '',
      durationMs: 1,
      exitCode: 1,
      timedOut: false,
    };
    expect(lastRunText({ ...run, outcome: 'failed' })).toBe(
      'failed (exit 1) (1 question); unanswered questions stay open, see the log',
    );
    expect(lastRunText({ ...run, outcome: 'timed_out' })).toMatch(/^timed out/);
    expect(lastRunText({ ...run, exitCode: 0 })).toBe('finished (1 question)');
  });

  it('each question shows running, queued, failed with retry, or waiting', () => {
    const now = new Date().toISOString();
    expect(
      requestRunState('r1', {
        ...base,
        state: 'running',
        running: true,
        run: { projectIds: ['p'], requestIds: ['r1'], startedAt: now },
      }),
    ).toMatchObject({ kind: 'running' });
    // Queued only when the agent really queued its project (R11 review, gap 8).
    expect(requestRunState('r2', { ...base, state: 'queued', queued: ['p'] }, 'p')).toMatchObject({
      kind: 'queued',
    });
    expect(requestRunState('r2', base, 'p')).toMatchObject({ kind: 'waiting', retry: true });
    expect(
      requestRunState('r1', {
        ...base,
        lastRun: {
          projectIds: ['p'],
          requestIds: ['r1'],
          startedAt: now,
          durationMs: 1,
          exitCode: null,
          timedOut: true,
          outcome: 'timed_out',
        },
      }),
    ).toEqual({ kind: 'failed', text: 'The run timed out before answering it', retry: true });
    expect(
      requestRunState('r1', { ...base, state: 'paused', enabled: false, paused: true }),
    ).toMatchObject({ kind: 'waiting', text: 'Answering is paused: waits for you or your agent' });
  });
});

describe('shared changed-dot loads (R11 fix round, gap 7)', () => {
  it('an older load finishing last never replaces a newer one', async () => {
    vi.useFakeTimers();
    try {
      const pending: ((body: unknown) => void)[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolve) =>
              pending.push((body) => resolve(new Response(JSON.stringify(body)))),
            ),
        ),
      );
      const seen: string[][] = [];
      const { result } = renderHook(() => useChangedViews());
      await act(async () => vi.advanceTimersByTimeAsync(0));
      act(() => reloadChangedViews(0));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(pending).toHaveLength(2);
      await act(async () => pending[1]!({ latest: 12, projects: { p: ['new'] } }));
      seen.push(result.current.projects.p ?? []);
      await act(async () => pending[0]!({ latest: 11, projects: { p: ['old'] } }));
      seen.push(result.current.projects.p ?? []);
      expect(seen).toEqual([['new'], ['new']]);
    } finally {
      vi.useRealTimers();
    }
  });
});
