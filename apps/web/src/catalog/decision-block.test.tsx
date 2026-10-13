import { addUnits, type Entity, type ProjectDataset, type ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../lib/format';
import { ExpiryNotice, expiringFiles } from '../files/expiry-notice';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { ViewRenderer } from './renderer';
import { choose } from '../test/choose';

// v0.2 A2: the decision block (R10.19), the artifact picture in the drawer and expiry reminders
// (R7.15). Every name and file here is made up.

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const ALEX = base.assignees.find((a) => a.data.kind === 'human')!;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 9,
  updatedRev: 9,
};

function proposal(extra: Partial<Entity<'decision'>['data']> = {}): Entity<'decision'> {
  return {
    id: 'dec_empty',
    type: 'decision',
    data: {
      projectId: P,
      title: 'Which empty state should pages use?',
      status: 'proposed',
      options: [
        {
          id: 'a',
          label: 'Picture and one line',
          summary: 'A friendly page that says what to add first',
          pros: ['Warm', 'Explains the next step'],
          cons: ['A picture per page'],
          claimIds: [base.claims[0]?.id ?? 'clm_none'],
        },
        { id: 'b', label: 'Checklist', summary: 'Three steps', pros: ['Clear'], cons: ['Busier'] },
      ],
      recommendedOptionId: 'a',
      recommendationReason: 'Readers found the next step faster',
      ...extra,
    },
    ...meta,
  };
}

function setup(decision: Entity<'decision'>, node?: ViewNode, data: Partial<ProjectDataset> = {}) {
  const apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 10, created: {} }));
  const actions: ViewActions = { apply, open: vi.fn() };
  const view = render(
    <ViewDataProvider
      data={{ ...base, decisions: [...base.decisions, decision], ...data }}
      version={1}
      actions={actions}
    >
      <ViewRenderer
        spec={{
          component: 'Board',
          widgets: [
            { id: 'choice', node: node ?? { component: 'DecisionBlock', decision: decision.id } },
          ],
        }}
      />
    </ViewDataProvider>,
  );
  return { ...view, apply, actions };
}

describe('DecisionBlock', () => {
  it('shows the question, the options side by side and the recommendation with its reason', () => {
    setup(proposal());
    expect(
      screen.getByRole('heading', { name: 'Which empty state should pages use?' }),
    ).toBeTruthy();
    const options = within(screen.getByRole('list', { name: 'Options' })).getAllByRole('listitem', {
      name: /Picture and one line|Checklist/,
    });
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText('Recommended')).toBeTruthy();
    expect(within(options[0]!).getByRole('list', { name: 'For' }).textContent).toContain('Warm');
    expect(within(options[1]!).getByRole('list', { name: 'Against' }).textContent).toBe('Busier');
    expect(screen.getByText(/Why “Picture and one line”:/).parentElement!.textContent).toContain(
      'Readers found the next step faster',
    );
  });

  it('records the choice as the person’s decision in one undoable revision', async () => {
    const { apply } = setup(proposal());
    fireEvent.click(screen.getByRole('button', { name: 'Choose “Checklist”' }));
    expect(apply).toHaveBeenCalledWith(
      'Choose “Checklist”: Which empty state should pages use?',
      [
        {
          op: 'update',
          type: 'decision',
          id: 'dec_empty',
          data: {
            chosenOptionId: 'b',
            answer: null,
            deferredUntil: null,
            status: 'accepted',
            decidedById: ALEX.id,
            decisionDate: localToday(),
          },
        },
      ],
      { undoable: true },
    );
  });

  it('adds the person as an assignee when there is none yet', () => {
    const { apply } = setup(proposal(), undefined, { assignees: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Choose “Picture and one line”' }));
    const [, operations] = apply.mock.calls[0]!;
    expect(operations[0]).toEqual({
      op: 'create',
      type: 'assignee',
      ref: 'me',
      data: { name: 'me', kind: 'human' },
    });
    expect(operations[1]).toMatchObject({ data: { decidedById: '$me' } });
  });

  it('writes another answer by keyboard, and Escape cancels', () => {
    const { apply } = setup(proposal());
    fireEvent.click(screen.getByRole('button', { name: /Write another answer/ }));
    const box = screen.getByLabelText('Your answer');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Write another answer/ }));
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'Neither: plain text' },
    });
    fireEvent.keyDown(screen.getByLabelText('Your answer'), { key: 'Enter', metaKey: true });
    expect(apply.mock.calls[0]![1][0]).toMatchObject({
      data: { answer: 'Neither: plain text', chosenOptionId: null, status: 'accepted' },
    });
  });

  it('defers to a date the person picks', () => {
    const { apply } = setup(proposal());
    fireEvent.click(screen.getByRole('button', { name: /Decide later/ }));
    fireEvent.click(screen.getByRole('button', { name: 'In a month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remind me then' }));
    const until = addUnits(localToday(), 1, 'months');
    expect(apply).toHaveBeenCalledWith(
      `Decide “Which empty state should pages use?” later, by ${until}`,
      [{ op: 'update', type: 'decision', id: 'dec_empty', data: { deferredUntil: until } }],
      { undoable: true },
    );
  });

  it('shows a choice compactly, with the options one tap away and a way to change it', () => {
    const { apply } = setup(
      proposal({
        status: 'accepted',
        chosenOptionId: 'a',
        decidedById: ALEX.id,
        decisionDate: '2026-10-12',
      }),
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /Chosen: Picture and one line.*Alex · Oct 12, 2026/,
    );
    expect(screen.queryByRole('list', { name: 'Options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'See options' }));
    expect(screen.getByText('Chosen', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Change/ }));
    expect(apply.mock.calls[0]![1][0]).toMatchObject({
      data: { chosenOptionId: null, answer: null, status: 'proposed', decidedById: null },
    });
  });

  it('says when a decision was deferred, and when it is missing', () => {
    setup(proposal({ deferredUntil: '2026-10-20' }));
    expect(screen.getByText(/Later: Oct 20/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose “Checklist”' })).toBeTruthy();
    cleanup();
    setup(proposal(), { component: 'DecisionBlock', decision: 'dec_gone' });
    expect(screen.getByText(/This decision was deleted/)).toBeTruthy();
  });

  it('DecisionLog lists the answer and StartHere points the reader at the block', () => {
    const chosen = proposal({ status: 'accepted', chosenOptionId: 'b' });
    setup(chosen, { component: 'DecisionLog' });
    expect(screen.getByText('Chose: Checklist')).toBeTruthy();
    cleanup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <ViewDataProvider data={{ ...base, decisions: [proposal()] }} version={1}>
        <ViewRenderer
          spec={{
            component: 'Board',
            widgets: [
              {
                id: 'start',
                node: {
                  component: 'StartHere',
                  purpose: 'needs-you',
                  headline: 'Pick the empty state every page will use.',
                  yourPart: 'Choose one of two empty states by Friday.',
                  yourPartTarget: 'choice',
                  date: '2026-10-13',
                  path: [{ label: 'The choice', target: 'choice' }],
                },
              },
              { id: 'choice', node: { component: 'DecisionBlock', decision: 'dec_empty' } },
            ],
          }}
        />
      </ViewDataProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Answer it/ }));
    expect(scroll).toHaveBeenCalled();
  });
});

describe('artifact picture in the drawer (R7.15)', () => {
  const picture = {
    id: 'file_picture1',
    type: 'file',
    data: {
      projectId: P,
      title: 'Empty state A',
      rootId: 'root_fixture1',
      path: 'UI/empty-state-a.png',
      size: 2740,
      modifiedAt: '2026-09-02T10:00:00.000Z',
      kind: 'other',
      tags: [],
      taskIds: [],
    },
    ...meta,
  } as Entity<'file'>;

  function drawer(artifact: Partial<Entity<'artifact'>['data']> = {}) {
    const apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 3, created: {} }));
    const art = base.artifacts[1]!;
    render(
      <ViewDataProvider
        data={{
          ...base,
          files: [...base.files, picture],
          artifacts: [{ ...art, data: { ...art.data, ...artifact } }],
        }}
        version={1}
        actions={{ apply, open: vi.fn() }}
      >
        <DetailDrawer target={{ entity: art.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    return { apply, art };
  }

  it('sets a picture from the project’s image files, and its alt text and tags', () => {
    const { apply, art } = drawer();
    choose('Picture from the project’s files', 'Empty state A');
    expect(apply.mock.calls[0]![1]).toEqual([
      { op: 'update', type: 'artifact', id: art.id, data: { image: 'file_picture1' } },
    ]);
    // Only pictures are offered, not the PDFs.
    fireEvent.click(screen.getByRole('button', { name: 'Picture from the project’s files' }));
    expect(screen.queryByRole('option', { name: /certificate/ })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    const altRow = screen.getByText('Alt').parentElement!;
    fireEvent.click(within(altRow).getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByLabelText('Alt'), { target: { value: 'An empty page' } });
    fireEvent.keyDown(screen.getByLabelText('Alt'), { key: 'Enter' });
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({ data: { alt: 'An empty page' } });

    const tagsRow = screen.getByText('Tags').parentElement!;
    fireEvent.click(within(tagsRow).getByRole('button', { name: /Add/ }));
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'ui-examples\nempty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({
      data: { tags: ['ui-examples', 'empty'] },
    });
  });

  it('takes an https link, refuses others, and removes the picture', () => {
    const { apply } = drawer();
    fireEvent.click(screen.getByRole('button', { name: /Use a link/ }));
    const input = screen.getByLabelText('Picture address');
    fireEvent.change(input, { target: { value: 'http://localhost/x.png' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toMatch(/Can’t use this address/);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'https://example.com/a.png' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(apply.mock.calls[0]![1][0]).toMatchObject({
      data: { image: 'https://example.com/a.png' },
    });
    cleanup();
    const shown = drawer({ image: 'file_picture1', alt: 'An empty page' });
    expect(screen.getByRole('img', { name: 'An empty page' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove picture/ }));
    expect(shown.apply.mock.calls[0]![1][0]).toMatchObject({ data: { image: null } });
  });
});

describe('expiry reminders (R7.15)', () => {
  const today = localToday();
  const withExpiry = (id: string, title: string, days: number): Entity<'file'> =>
    ({
      ...base.files[0]!,
      id,
      data: { ...base.files[0]!.data, title, expiryDate: addUnits(today, days, 'days') },
    }) as Entity<'file'>;
  const files = [
    withExpiry('file_soon', 'Driving licence', 20),
    withExpiry('file_gone', 'Parking permit', -3),
    withExpiry('file_far', 'House deed', 400),
  ];

  it('lists files that expired or expire within 60 days, soonest first', () => {
    expect(expiringFiles(files, today).map((e) => e.file.data.title)).toEqual([
      'Parking permit',
      'Driving licence',
    ]);
  });

  it('shows a notice that opens the file and stays dismissed until the list changes', () => {
    const open = vi.fn();
    const ui = (list: Entity<'file'>[]) => (
      <ViewDataProvider
        data={{ ...base, files: list }}
        version={1}
        actions={{ apply: async () => ({ ok: false }), open }}
      >
        <ExpiryNotice />
      </ViewDataProvider>
    );
    window.localStorage.clear();
    render(ui(files));
    const notice = screen.getByRole('region', { name: 'Expiring files' });
    expect(notice.textContent).toMatch(/2 files expired or expire within 60 days/);
    expect(notice.textContent).toMatch(/Parking permitexpired/);
    expect(notice.textContent).toMatch(/Driving licenceexpires .* \(in 20 days\)/);
    fireEvent.click(within(notice).getByRole('button', { name: 'Driving licence' }));
    expect(open).toHaveBeenCalledWith({ entity: 'file_soon' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss until the list changes' }));
    expect(screen.queryByRole('region', { name: 'Expiring files' })).toBeNull();
    cleanup();
    render(ui(files));
    expect(screen.queryByRole('region', { name: 'Expiring files' })).toBeNull();
    cleanup();
    render(ui([...files, withExpiry('file_new', 'Insurance', 5)]));
    expect(screen.getByRole('region', { name: 'Expiring files' }).textContent).toMatch(/3 files/);
  });

  it('DueTracker shows files by expiry in the same bands', () => {
    render(
      <ViewDataProvider data={{ ...base, files }} version={1}>
        <ViewRenderer
          spec={{
            component: 'Board',
            widgets: [
              {
                id: 'due',
                node: {
                  component: 'DueTracker',
                  query: { type: 'file', where: { expiryDate: { exists: true } } },
                },
              },
            ],
          }}
        />
      </ViewDataProvider>,
    );
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toMatch(/^Past due.*Parking permit.*Expired .*3 days late/);
    expect(rows[1]).toMatch(/^Urgent.*Driving licence.*Expires .*in 20 days/);
    expect(rows[2]).toMatch(/^Not urgent.*House deed/);
  });
});
