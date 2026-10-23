import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewFolderDialog } from './folder-picker';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HOME = {
  path: '/Users/me',
  display: '~',
  parent: null,
  folders: [{ name: 'code', path: '/Users/me/code', repo: false }],
};
const CODE = {
  path: '/Users/me/code',
  display: '~/code',
  parent: '/Users/me',
  folders: [{ name: 'shop', path: '/Users/me/code/shop', repo: true }],
};

describe('New folder', () => {
  it('finds a folder on this computer, makes one there, and fills the path and name', async () => {
    const calls: { url: string; author: string | null; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        author: new Headers(init?.headers).get('x-pharos-author'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (init?.method === 'POST')
        return Response.json({
          ...CODE,
          path: '/Users/me/code/garden',
          display: '~/code/garden',
          folders: [],
        });
      return Response.json(url.includes('code') ? CODE : HOME);
    });
    const onSubmit = vi.fn();
    render(<NewFolderDialog onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Find/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'code' }));
    await screen.findByRole('button', { name: /shop/ });
    fireEvent.click(screen.getByRole('button', { name: /New folder here/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New folder name' }), {
      target: { value: 'garden' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Make' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use “garden”' }));
    expect((screen.getByLabelText(/Local path/) as HTMLInputElement).value).toBe('~/code/garden');
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: 'garden', path: '~/code/garden' }),
    );
    expect(calls.every((c) => c.author === 'human:me')).toBe(true);
    expect(calls.find((c) => c.body)?.body).toEqual({ parent: '/Users/me/code', name: 'garden' });
  });
});
