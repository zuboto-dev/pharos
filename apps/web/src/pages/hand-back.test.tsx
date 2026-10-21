import {
  ReportDoc,
  type Entity,
  type Operation,
  type ProjectDataset,
  type ReportDoc as Doc,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { DocumentView } from './document';
import { ArchivedNotice, canArchive, handBack, handBackMessage, restoreView } from './hand-back';
import { ViewTabs } from './ViewTabs';

// Handing a finished review document back: the dialog shows the moment the owner's last answer
// completes it (never on opening a finished one, never for a document that asks nothing); the
// hand-back is one revision; archived views leave the tabs and can be restored. Made-up data.

const base = dataset as unknown as ProjectDataset;
const [overview, delivery] = [...base.views].sort(
  (a, b) => Number(b.data.pinned) - Number(a.data.pinned),
) as Entity<'view'>[];
const TASK = 'task_d41c6c6d6408'; // "Answer views", to do
const meta = {
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  createdRev: 3,
  updatedRev: 3,
};

const decision: Entity<'decision'> = {
  id: 'dec_path',
  type: 'decision',
  data: {
    projectId: base.project.id,
    title: 'Which path through the garden?',
    status: 'proposed',
    options: [
      { id: 'gravel', label: 'Gravel', summary: 'Cheap and quick' },
      { id: 'stone', label: 'Stone', summary: 'Lasts longer' },
    ],
  },
  ...meta,
};

const reviewDoc = ReportDoc.parse({
  blocks: [
    {
      kind: 'sheet',
      id: 'path',
      title: 'Garden path',
      time: '5 min',
      decisions: ['dec_path'],
      blocks: [
        { kind: 'block', id: 'choice', node: { component: 'DecisionBlock', decision: 'dec_path' } },
      ],
    },
    {
      kind: 'sheet',
      id: 'chores',
      title: 'Chores',
      time: '2 min',
      blocks: [
        {
          kind: 'block',
          id: 'ticks',
          node: {
            component: 'TaskChecklist',
            hideDone: false,
            filter: { where: { title: ['Answer views'] } },
          },
        },
      ],
    },
  ],
});

const plainDoc = ReportDoc.parse({
  blocks: [
    {
      kind: 'sheet',
      id: 'a',
      title: 'Read this',
      blocks: [{ kind: 'block', id: 'a1', node: { component: 'Markdown', content: 'Notes.' } }],
    },
    {
      kind: 'sheet',
      id: 'b',
      title: 'And this',
      blocks: [{ kind: 'block', id: 'b1', node: { component: 'Markdown', content: 'More.' } }],
    },
  ],
});

const docView = (doc: Doc, extra: Partial<Entity<'view'>['data']> = {}): Entity<'view'> => ({
  ...delivery!,
  id: 'view_garden',
  data: { ...delivery!.data, name: 'Garden review', spec: undefined, doc, ...extra },
});

const withData = (
  view: Entity<'view'>,
  { chosen = false, done = false }: { chosen?: boolean; done?: boolean } = {},
): ProjectDataset => ({
  ...base,
  decisions: [
    ...base.decisions,
    chosen ? { ...decision, data: { ...decision.data, chosenOptionId: 'stone' } } : decision,
  ],
  tasks: base.tasks.map((t) =>
    t.id === TASK && done ? { ...t, data: { ...t.data, status: 'done' } } : t,
  ),
  views: [view, ...base.views],
});

/** Applies the owner's decision and task changes to the data, as a reload after apply would. */
function applyOps(data: ProjectDataset, ops: Operation[]): ProjectDataset {
  const merge = <T extends { id: string; data: object }>(list: T[], op: Operation): T[] =>
    list.map((e) =>
      op.op === 'update' && e.id === op.id
        ? {
            ...e,
            data: Object.fromEntries(
              Object.entries({ ...e.data, ...op.data }).filter(([, v]) => v !== null),
            ),
          }
        : e,
    );
  return ops.reduce(
    (d, op) => ({
      ...d,
      decisions: op.type === 'decision' ? merge(d.decisions, op) : d.decisions,
      tasks: op.type === 'task' ? merge(d.tasks, op) : d.tasks,
    }),
    data,
  );
}

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 10, created: {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = String(url).includes('authorKind=agent')
        ? [{ id: 4, author: { kind: 'agent', name: 'Opus 5.5' } }]
        : [];
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The document with live data: answering in it changes the data, as in the app. */
function Live({ view, initial }: { view: Entity<'view'>; initial: ProjectDataset }) {
  const [state, setState] = useState({ data: initial, version: 1 });
  // Saved as the app saves it, then the data reloads with the change.
  const live: ViewActions['apply'] = (message, ops, options) => {
    setState((s) => ({ data: applyOps(s.data, ops), version: s.version + 1 }));
    return apply(message, ops, options);
  };
  return (
    <MemoryRouter>
      <ViewDataProvider
        data={state.data}
        version={state.version}
        actions={{ apply: live, open: vi.fn() }}
      >
        <DocumentView view={view} />
      </ViewDataProvider>
    </MemoryRouter>
  );
}

const dialog = () => screen.queryByRole('dialog');
const tick = () =>
  fireEvent.click(
    document
      .querySelector('[data-doc-block="ticks"]')!
      .querySelector<HTMLButtonElement>('button[aria-label^="Mark “"]')!,
  );
const choose = () => fireEvent.click(screen.getByRole('button', { name: 'Choose Stone' }));

describe('the hand-back prompt', () => {
  it('appears when a choice is the last answer, names the agent, and archives in one revision', async () => {
    const view = docView(reviewDoc);
    render(<Live view={view} initial={withData(view, { done: true })} />);
    expect(dialog()).toBeNull();
    act(choose);
    const shown = await screen.findByRole('dialog');
    expect(within(shown).getByText('All 2 answered.')).toBeTruthy();
    await within(shown).findByText('Archive this report and tell Opus 5.5?');
    fireEvent.click(within(shown).getByRole('button', { name: 'Archive and tell the agent' }));
    expect(dialog()).toBeNull();
    expect(apply).toHaveBeenLastCalledWith(
      'Archive “Garden review”: all 2 answered — over to Opus 5.5',
      [
        {
          op: 'update',
          type: 'view',
          id: 'view_garden',
          data: { archived: true, handedBack: { to: 'Opus 5.5', answered: 2 } },
        },
      ],
      { undoable: true },
    );
  });

  it('appears when a checklist tick is the last answer; "Keep it open" closes it', async () => {
    const view = docView(reviewDoc);
    render(<Live view={view} initial={withData(view)} />);
    act(choose);
    expect(dialog()).toBeNull(); // the chores are still to do
    act(tick);
    const shown = await screen.findByRole('dialog');
    const calls = apply.mock.calls.length;
    fireEvent.click(within(shown).getByRole('button', { name: 'Keep it open' }));
    expect(dialog()).toBeNull();
    expect(apply.mock.calls.length).toBe(calls);
  });

  it('never on opening a finished report, nor for one that asks nothing, nor a pinned one', async () => {
    const view = docView(reviewDoc);
    const { unmount } = render(
      <Live view={view} initial={withData(view, { chosen: true, done: true })} />,
    );
    await act(async () => {});
    expect(dialog()).toBeNull();
    unmount();

    const plain = docView(plainDoc);
    const second = render(<Live view={plain} initial={withData(plain)} />);
    await act(async () => {});
    expect(dialog()).toBeNull();
    second.unmount();

    const pinned = docView(reviewDoc, { pinned: true });
    render(<Live view={pinned} initial={withData(pinned, { done: true })} />);
    act(choose);
    await act(async () => {});
    expect(dialog()).toBeNull();
  });

  it('falls back to "the agent" when no agent wrote it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })),
    );
    const view = docView(reviewDoc);
    render(<Live view={view} initial={withData(view, { done: true })} />);
    act(choose);
    const shown = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(shown).getByText('Archive this report and tell the agent?')).toBeTruthy(),
    );
    expect(handBack(view, 2, undefined)).toEqual({
      message: 'Archive “Garden review”: all 2 answered — over to the agent',
      operations: [
        {
          op: 'update',
          type: 'view',
          id: 'view_garden',
          data: { archived: true, handedBack: { answered: 2 } },
        },
      ],
    });
  });

  it('pinned and template views are never archived', () => {
    expect(canArchive(overview!)).toBe(false);
    expect(canArchive({ ...delivery!, data: { ...delivery!.data, pinned: true } })).toBe(false);
    expect(canArchive(delivery!)).toBe(true);
    expect(handBackMessage('R', 4, 'Codex')).toBe('Archive “R”: all 4 answered — over to Codex');
  });
});

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

describe('archived views', () => {
  const archived = docView(reviewDoc, {
    archived: true,
    handedBack: { to: 'Opus 5.5', answered: 2 },
  });
  const tabs = (active: Entity<'view'>) => {
    render(
      <MemoryRouter initialEntries={[`/projects/p/views/${active.id}`]}>
        <ViewDataProvider data={withData(archived)} version={1} actions={{ apply, open: vi.fn() }}>
          <ViewTabs
            projectId="p"
            views={[overview!, delivery!, archived]}
            active={active}
            onCreated={vi.fn()}
          />
          <ArchivedNotice view={archived} />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </ViewDataProvider>
      </MemoryRouter>,
    );
  };

  it('leave the tab row for Archived in the menu, and restore ending the hand-back', () => {
    tabs(overview!);
    expect(screen.queryByRole('link', { name: /Garden review/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByText('Archived', { selector: '[role="menu"] *' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Restore “Garden review”/ }));
    expect(apply).toHaveBeenLastCalledWith(
      'Restore view “Garden review”',
      [
        {
          op: 'update',
          type: 'view',
          id: 'view_garden',
          data: { archived: null, handedBack: null },
        },
      ],
      { undoable: true },
    );
    expect(screen.getByTestId('path').textContent).toBe('/projects/p/views/view_garden');
  });

  it('an archived page says so, with whom it went back to, and Restore', () => {
    tabs(overview!);
    const notice = document.querySelector<HTMLElement>('[data-archived-notice]')!;
    expect(notice.textContent).toContain('Archived');
    expect(notice.textContent).toContain('all 2 answered, handed back to Opus 5.5');
    fireEvent.click(within(notice).getByRole('button', { name: 'Restore' }));
    expect(apply).toHaveBeenLastCalledWith(
      restoreView(archived).message,
      restoreView(archived).operations,
      { undoable: true },
    );
  });

  it('the Overview (pinned, template) has no Archive in its menu', () => {
    tabs(overview!);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Overview' }));
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Archive/ })).toBeNull();
  });
});
