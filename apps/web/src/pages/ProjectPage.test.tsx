import {
  CaseFile,
  MONEY_PACK,
  packDataset,
  type Entity,
  type ProjectDataset,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import moneyCases from '../../../../packages/schema/src/packs/cases/money.json';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ProjectPage } from './ProjectPage';

const base = dataset as unknown as ProjectDataset;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectPage', () => {
  it('announces an answer that an agent adds while the page is open', async () => {
    const answer: Entity<'view'> = {
      ...base.views[0]!,
      id: 'view_new_answer',
      createdRev: 999,
      data: {
        ...base.views[0]!.data,
        name: "What's overdue?",
        kind: 'answer',
        question: "What's overdue?",
        expiresAt: '2099-01-01T00:00:00.000Z',
        pinned: false,
      },
    };
    let current: ProjectDataset = base;
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(url.includes('/data') ? current : []),
    );
    render(
      <MemoryRouter initialEntries={[`/projects/${base.project.id}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/views/:viewId" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /Overview/ });
    expect(screen.queryByText(/New answer/)).toBeNull();

    current = { ...base, views: [...base.views, answer] };
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByText("New answer: What's overdue?")).toBeTruthy());
    act(() => screen.getByRole('button', { name: 'Open' }).click());
    await screen.findByText('Keep as a view');
  });

  it('shows an archived project with a small notice that restores it', async () => {
    const archived: ProjectDataset = {
      ...base,
      project: { ...base.project, data: { ...base.project.data, status: 'archived' } },
    };
    const posted: { message: string; operations: unknown[] }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(init.body as string));
        return Response.json({ revision: { id: 7 }, created: {} });
      }
      return Response.json(url.includes('/data') ? archived : []);
    });
    render(
      <MemoryRouter initialEntries={[`/projects/${base.project.id}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // It still opens and shows its views.
    await screen.findByRole('link', { name: /Overview/ });
    const notice = screen.getByText(/Archived ·/);
    await act(async () => fireEvent.click(within(notice).getByRole('button', { name: 'Restore' })));
    expect(posted).toEqual([
      {
        message: `Restore project “${base.project.data.name}”`,
        operations: [
          { op: 'update', type: 'project', id: base.project.id, data: { status: 'active' } },
        ],
      },
    ]);
    expect(await screen.findByRole('button', { name: /Undo/ })).toBeTruthy();
  });

  describe('acting in place (R10.13)', () => {
    const TODAY = '2026-10-13';

    function moneyPage() {
      const data = packDataset(MONEY_PACK, CaseFile.parse(moneyCases).fixtures!.october!, TODAY);
      const view = {
        id: 'view_month',
        type: 'view',
        data: {
          projectId: data.project.id,
          name: 'This month',
          pinned: true,
          order: 0,
          spec: { component: 'Board', widgets: MONEY_PACK.views[0]!.widgets },
        },
        createdAt: '',
        updatedAt: '',
        createdRev: 1,
        updatedRev: 1,
      } as unknown as Entity<'view'>;
      return { ...data, views: [view] } as ProjectDataset;
    }

    function route(id: string) {
      return render(
        <MemoryRouter initialEntries={[`/projects/${id}`]}>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectPage />} />
            <Route path="/projects/:projectId/views/:viewId" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it('every block updates after Mark paid, and the toast undoes it', async () => {
      let current = moneyPage();
      const posts: { url: string; body: unknown }[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          if (url.endsWith('/actions')) {
            // The server marks Rent paid: its next date moves a month on.
            current = {
              ...current,
              records: current.records!.map((r) =>
                r.id === 'rec_b_rent'
                  ? {
                      ...r,
                      updatedRev: 99,
                      data: { ...r.data, interval: { ...r.data.interval!, lastDate: TODAY } },
                    }
                  : r,
              ),
            };
            return Response.json({
              v: 1,
              status: 'done',
              revision: 99,
              recordId: 'rec_b_rent',
              created: ['rec_new'],
              updated: ['rec_b_rent'],
              message: 'Mark paid: Rent (2026-10-13)',
            });
          }
          return Response.json(
            { error: { code: 'conflict', message: 'Revision 99 conflicts with revision 100' } },
            { status: 409 },
          );
        }
        return Response.json(url.includes('/data') ? current : []);
      });
      route(current.project.id);
      const bills = await screen.findByRole('heading', { name: 'Upcoming bills' });
      const block = bills.closest('section')!;
      const rentBefore = within(block).getByText('Rent').closest('li')!.textContent;
      fireEvent.click(within(block).getByRole('button', { name: 'Mark paid: Rent' }));
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Mark paid' })).getByRole('button', {
          name: 'Save',
        }),
      );
      // The page reloads its data: the Rent row moves on, without a page reload.
      await waitFor(() =>
        expect(within(block).getByText('Rent').closest('li')!.textContent).not.toBe(rentBefore),
      );
      expect(posts[0]!.url).toBe(`/api/projects/${current.project.id}/actions`);
      const toast = screen.getByRole('status');
      expect(toast.textContent).toMatch(/Mark paid: Rent/);
      // Undo after someone changed it again: a plain conflict note pointing at History.
      fireEvent.click(within(toast).getByRole('button', { name: /Undo/ }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Can’t undo/));
      expect(posts[1]!.url).toBe('/api/revisions/99/revert');
      expect(
        within(screen.getByRole('status')).getByRole('button', { name: /History/ }),
      ).toBeTruthy();
    });

    it('says when the agent changed the block it was asked about, with Undo', async () => {
      const request = {
        id: 'req_block',
        type: 'request',
        data: {
          projectId: 'prj_case',
          question: 'Only bills due this month',
          about: 'Upcoming bills in This month',
          viewId: 'view_month',
          widgetId: 'bills',
          mode: 'block',
          status: 'open',
        },
        createdAt: '',
        updatedAt: '',
        createdRev: 50,
        updatedRev: 50,
      } as unknown as Entity<'request'>;
      let current: ProjectDataset = { ...moneyPage(), requests: [request] };
      vi.stubGlobal('fetch', async (url: string) =>
        Response.json(
          url.includes('/data')
            ? current
            : url.includes('/history')
              ? [
                  {
                    id: 51,
                    author: { kind: 'agent', name: 'Claude Code' },
                    message: 'Bills due this month',
                    createdAt: '2026-10-13T10:00:00.000Z',
                    revertOf: null,
                    revertedBy: null,
                    changes: [],
                  },
                ]
              : [],
        ),
      );
      route('prj_case');
      await screen.findByRole('heading', { name: 'Upcoming bills' });
      current = {
        ...current,
        requests: [
          {
            ...request,
            updatedRev: 51,
            data: { ...request.data, status: 'answered', reply: 'It shows this month only.' },
          },
        ],
      };
      await act(async () => window.dispatchEvent(new Event('focus')));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toMatch(
          /Your agent changed Upcoming bills in This month: It shows this month only\./,
        ),
      );
      expect(within(screen.getByRole('status')).getByRole('button', { name: /Undo/ })).toBeTruthy();
    });
  });
});
