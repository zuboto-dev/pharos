import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PartBoundary } from './part-boundary';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Boom({ fail }: { fail: boolean }): null {
  if (fail) throw new Error('kaboom');
  return null;
}

describe('a part that fails', () => {
  it('shows a message in its place, logs it, and can try again', () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <div>
        <p>Rest of the page</p>
        <PartBoundary part="agent panel">
          <Boom fail />
        </PartBoundary>
      </div>,
    );
    expect(screen.getByText('Rest of the page')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The agent panel hit an error');
    expect(posts).toMatchObject([{ part: 'agent panel', message: 'kaboom' }]);
    rerender(
      <div>
        <p>Rest of the page</p>
        <PartBoundary part="agent panel">
          <Boom fail={false} />
        </PartBoundary>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
