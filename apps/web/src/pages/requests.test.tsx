import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewRenderer } from '../catalog/renderer';
import { AskDialog, RequestsButton } from './requests';

const data = dataset as unknown as ProjectDataset;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);
let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

const request = (
  id: string,
  question: string,
  status: 'open' | 'answered' | 'dismissed',
  extra = {},
): Entity<'request'> => ({
  id,
  type: 'request',
  data: { projectId: 'p', question, status, ...extra },
  createdAt: new Date().toISOString(),
  updatedAt: '',
  createdRev: 1,
  updatedRev: 1,
});

describe('asking the agent', () => {
  it('offers Ask on widgets, saying which widget and view it is about', () => {
    const ask = vi.fn();
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn(), ask }}>
        <ViewRenderer
          view={{ id: 'view_1', name: 'Overview' }}
          spec={{
            component: 'Board',
            widgets: [{ id: 'goals', node: { component: 'GoalTree', title: 'Goals' } }],
          }}
        />
      </ViewDataProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask about Goals' }));
    expect(ask).toHaveBeenCalledWith({
      label: 'Goals in Overview',
      viewId: 'view_1',
      widgetId: 'goals',
    });
  });

  it('creates a request with its context', async () => {
    const onClose = vi.fn();
    render(
      <AskDialog
        projectId="p"
        about={{ label: 'Goals in Overview', viewId: 'view_1', widgetId: 'goals' }}
        apply={apply}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog').textContent).toContain('About: Goals in Overview');
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Which goal is most at risk?' },
    });
    // Asked from a block, it changes that block unless the person picks a separate answer.
    expect(
      (screen.getByRole('radio', { name: /Change this block/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Answer in a new view/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledWith(
      'Ask: Which goal is most at risk?',
      [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: 'p',
            question: 'Which goal is most at risk?',
            about: 'Goals in Overview',
            viewId: 'view_1',
            widgetId: 'goals',
          },
        },
      ],
      { undoable: true },
    );
  });

  it('asks to change the block in place by default (R10.6)', async () => {
    const onClose = vi.fn();
    render(
      <AskDialog
        projectId="p"
        about={{ label: 'Bills in This month', viewId: 'view_1', widgetId: 'bills' }}
        apply={apply}
        onClose={onClose}
      />,
    );
    const question = screen.getByLabelText('Question');
    expect(document.activeElement).toBe(question);
    fireEvent.change(question, { target: { value: 'Only bills due this month' } });
    // Cmd/Ctrl+Enter sends it from the keyboard.
    fireEvent.keyDown(question, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(apply).toHaveBeenLastCalledWith(
      'Ask: Only bills due this month',
      [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: 'p',
            question: 'Only bills due this month',
            about: 'Bills in This month',
            viewId: 'view_1',
            widgetId: 'bills',
            mode: 'block',
          },
        },
      ],
      { undoable: true },
    );
  });

  it('a question about the whole project has no block choice', () => {
    render(
      <AskDialog projectId="p" about={{ label: 'Project' }} apply={apply} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('lists waiting and answered questions', () => {
    render(
      <MemoryRouter>
        <RequestsButton
          projectId="p"
          apply={apply}
          requests={[
            request('r1', 'Is M4 on track?', 'open', { about: 'Stages in Overview' }),
            request('r2', "What's overdue?", 'answered', { answerViewId: 'view_ans' }),
            request('r3', 'Old', 'dismissed'),
          ]}
        />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'Questions: 1 waiting' });
    fireEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Questions' });
    expect(panel.textContent).toContain('Is M4 on track?');
    expect(panel.textContent).not.toContain('Old');
    expect(
      within(panel)
        .getByRole('link', { name: /What's overdue\?/ })
        .getAttribute('href'),
    ).toBe('/projects/p/views/view_ans');
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss “Is M4 on track?”' }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      { op: 'update', type: 'request', id: 'r1', data: { status: 'dismissed' } },
    ]);
  });

  it("shows when the server's agent is answering this project's questions", async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        url === '/api/agent'
          ? { configured: true, running: true, answering: ['p'], queued: [] }
          : [],
      ),
    );
    render(
      <MemoryRouter>
        <RequestsButton
          projectId="p"
          apply={apply}
          requests={[request('r1', 'Is M4 on track?', 'open')]}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Questions: 1 waiting' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Questions' }).textContent).toContain(
        'Your agent is answering…',
      ),
    );
  });

  it('offers an earlier answer to a similar question before asking again', () => {
    const answer = {
      id: 'view_ans',
      type: 'view',
      data: { projectId: 'p', name: 'Overdue', kind: 'answer', question: "What's overdue?" },
      createdAt: new Date().toISOString(),
      updatedAt: '',
      createdRev: 1,
      updatedRev: 1,
    } as unknown as Entity<'view'>;
    const onOpenAnswer = vi.fn();
    const onClose = vi.fn();
    render(
      <AskDialog
        projectId="p"
        about={{ label: 'Tasks in Overview' }}
        apply={apply}
        onClose={onClose}
        answers={[answer]}
        onOpenAnswer={onOpenAnswer}
      />,
    );
    const question = screen.getByLabelText('Question');
    fireEvent.change(question, { target: { value: 'Who is working on what?' } });
    expect(screen.queryByText(/Answered before/)).toBeNull();
    fireEvent.change(question, { target: { value: 'What is overdue right now?' } });
    fireEvent.click(screen.getByRole('button', { name: /What's overdue\?/ }));
    expect(onOpenAnswer).toHaveBeenCalledWith('view_ans');
    expect(onClose).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
