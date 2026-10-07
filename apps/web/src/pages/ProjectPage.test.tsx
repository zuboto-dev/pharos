import type { Entity, ProjectDataset } from '@pharos/schema';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
