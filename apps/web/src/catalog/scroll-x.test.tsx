import type { ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { DetailDrawer } from './drawer';
import { ScrollX } from './scroll-x';

afterEach(cleanup);
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

function sized(scrollWidth: number, clientWidth: number) {
  const proto = HTMLElement.prototype;
  const saved = [
    Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
    Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
  ];
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => clientWidth });
  return () => {
    for (const [key, d] of [
      ['scrollWidth', saved[0]],
      ['clientWidth', saved[1]],
    ] as const)
      if (d) Object.defineProperty(proto, key, d);
      else delete (proto as unknown as Record<string, unknown>)[key];
  };
}

describe('wide tables on phones (v0.2 B9)', () => {
  it('scroll inside the block and say so when wider than it', () => {
    const restore = sized(700, 358);
    try {
      render(
        <ScrollX label="Tasks">
          <table />
        </ScrollX>,
      );
      expect(screen.getByText('Scroll sideways for more')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Tasks (scrolls sideways)' }).tabIndex).toBe(0);
    } finally {
      restore();
    }
  });

  it('say nothing when the table fits', () => {
    const restore = sized(300, 358);
    try {
      render(
        <ScrollX label="Tasks">
          <table />
        </ScrollX>,
      );
      expect(screen.queryByText('Scroll sideways for more')).toBeNull();
      expect(screen.queryByRole('region')).toBeNull();
    } finally {
      restore();
    }
  });

  it('show the drawer as a bottom sheet on phones, with a handle', () => {
    const data = dataset as unknown as ProjectDataset;
    const { container } = render(
      <ViewDataProvider data={data} version={1}>
        <DetailDrawer target={{ entity: data.tasks[0]!.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    const sheet = container.ownerDocument.querySelector('[data-drawer]')!;
    for (const cls of ['h-[92dvh]', 'rounded-t-2xl', 'animate-sheet-in', 'sm:animate-drawer-in'])
      expect(sheet.classList.contains(cls), cls).toBe(true);
    expect(sheet.querySelector('.sm\\:hidden .rounded-full')).toBeTruthy();
  });
});
