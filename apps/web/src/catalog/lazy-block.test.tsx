// W11.6: heavy blocks load on first use, with a calm skeleton until their chunk arrives.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { lazyBlock } from './lazy-block';
import { Skeleton } from './skeleton';

afterEach(cleanup);

describe('lazyBlock', () => {
  it('shows a skeleton until the block loads, then renders it with its props', async () => {
    let resolve!: (c: (p: { name: string }) => string) => void;
    const Block = lazyBlock(
      () =>
        new Promise<(p: { name: string }) => string>((r) => {
          resolve = r;
        }),
    );
    render(<Block name="Night Bus" />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    await act(async () => {
      resolve(({ name }) => `Hello ${name}`);
      await Block.preload();
    });
    expect(await screen.findByText('Hello Night Bus')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders at once when preloaded', async () => {
    const Block = lazyBlock(async () => () => 'ready');
    await Block.preload();
    render(<Block />);
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('tries again after a failed load', async () => {
    let calls = 0;
    const Block = lazyBlock(async () => {
      calls += 1;
      if (calls === 1) throw new Error('chunk gone');
      return () => 'second time';
    });
    await expect(Block.preload()).rejects.toThrow('chunk gone');
    await Block.preload();
    expect(calls).toBe(2);
  });
});

describe('Skeleton', () => {
  it('suggests lines of text and says it is loading', () => {
    const { container } = render(<Skeleton lines={2} label="Loading the gallery" />);
    expect(screen.getByRole('status', { name: 'Loading the gallery' })).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(2);
  });
});
