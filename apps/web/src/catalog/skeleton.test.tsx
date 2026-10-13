import type { ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeSkeleton, ProjectSkeleton } from '../pages/onboarding';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ProjectHistory } from './history';
import { ViewRenderer } from './renderer';
import { SkeletonLines, SkeletonRows } from './skeleton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = '../index.css';
const css = readFileSync(new URL(file, import.meta.url), 'utf8');

describe('loading skeletons (v0.2 B8)', () => {
  it('announce what is loading once and hide the shapes from screen readers', () => {
    render(<SkeletonRows rows={3} label="Loading history" />);
    const region = screen.getByRole('status', { name: 'Loading history' });
    expect(region.getAttribute('aria-busy')).toBe('true');
    const shapes = region.querySelectorAll('[data-skeleton]');
    expect(shapes.length).toBe(9);
    for (const s of shapes) expect(s.getAttribute('aria-hidden')).toBe('true');
  });

  it('never say "Loading…" as the only content', () => {
    for (const ui of [<ProjectSkeleton />, <ProjectSkeleton files />, <HomeSkeleton />]) {
      const { container, unmount } = render(ui);
      expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(3);
      unmount();
    }
    render(<SkeletonLines lines={4} />);
    expect(screen.getByRole('status').querySelectorAll('[data-skeleton]').length).toBe(4);
  });

  it('shimmer with tokens, and stand still under reduced motion', () => {
    expect(css).toMatch(/\.ph-skeleton \{[^}]*var\(--ph-skeleton\)[^}]*var\(--animate-shimmer\)/s);
    const reduced = css.slice(css.indexOf('.ph-skeleton {'));
    expect(reduced).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ph-skeleton \{\s*animation: none;/,
    );
  });

  it('stand in for history and activity while they load', () => {
    // A fetch that never answers: the blocks stay in their loading state.
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const data = dataset as unknown as ProjectDataset;
    const { container } = render(
      <ViewDataProvider data={data} version={1}>
        <ProjectHistory />
        <ViewRenderer spec={{ component: 'ActivityFeed' }} />
      </ViewDataProvider>,
    );
    expect(screen.getByRole('status', { name: 'Loading history' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading activity' })).toBeTruthy();
    expect(container.textContent).not.toContain('Loading…');
  });
});
