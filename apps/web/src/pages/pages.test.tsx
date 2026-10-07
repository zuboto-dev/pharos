import { choose } from '../test/choose';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUTTON } from '../catalog/ui';
import { useTheme } from '../lib/theme';
import { NewProjectDialog } from './NewProjectDialog';

const repositories = [{ id: 'repo_1', type: 'repository', data: { name: 'pharos' } }];
let posted: { url: string; body: { message: string; operations: unknown[] } }[];

beforeEach(() => {
  posted = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(init.body as string) });
      return new Response(
        JSON.stringify({ revision: { id: 9 }, created: { project: 'prj_new' } }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify(repositories), {
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog() {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NewProjectDialog onClose={onClose} />} />
        <Route path="/projects/:id" element={<p>Project page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return onClose;
}

describe('new project', () => {
  it('creates a project in an existing repository and opens it', async () => {
    const onClose = renderDialog();
    await act(async () => {}); // let the repository list load
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docs site' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Public docs' } });
    choose('Repository', 'pharos');
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posted[0]).toEqual({
      url: '/api/apply',
      body: {
        message: 'Create project “Docs site”',
        operations: [
          {
            op: 'create',
            type: 'project',
            ref: 'project',
            data: {
              name: 'Docs site',
              status: 'planning',
              summary: 'Public docs',
              repositoryId: 'repo_1',
            },
          },
        ],
      },
    });
  });

  it('can create a new repository with it, and needs a name', async () => {
    renderDialog();
    const create = screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'App' } });
    choose('Repository', 'New repository');
    expect(create.disabled).toBe(true); // repository name still missing
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'app' } });
    fireEvent.change(screen.getByLabelText('Local path'), { target: { value: '~/code/app' } });
    fireEvent.click(create);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body.operations).toEqual([
      { op: 'create', type: 'repository', ref: 'repo', data: { name: 'app', path: '~/code/app' } },
      {
        op: 'create',
        type: 'project',
        ref: 'project',
        data: { name: 'App', status: 'planning', repositoryId: '$repo' },
      },
    ]);
  });
});

describe('theme', () => {
  it('switches the dark class and remembers the choice', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('pharos-theme')).toBe('dark');
    act(() => result.current[1]('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => result.current[1]('system'));
    expect(localStorage.getItem('pharos-theme')).toBeNull();
  });
});

describe('buttons', () => {
  it('gives each variant exactly one text colour per mode', () => {
    for (const classes of Object.values(BUTTON)) {
      const tokens = classes.split(/\s+/);
      expect(tokens.filter((t) => /^text-([a-z]+-\d+|white)$/.test(t))).toHaveLength(1);
      expect(tokens.filter((t) => /^dark:text-([a-z]+-\d+|white)$/.test(t))).toHaveLength(1);
    }
  });
});
