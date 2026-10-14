import type { Board, ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

// v0.2 polish: on a phone the Ask button always shows; on a block without a frame (plain text)
// it used to sit on top of the words. Those blocks keep room for it on touch screens.

const data = dataset as unknown as ProjectDataset;
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const board: Board = {
  component: 'Board',
  widgets: [
    { id: 'lead', node: { component: 'Text', content: 'One past due and two due soon.' } },
    { id: 'goals', node: { component: 'GoalTree', title: 'Goals' } },
  ],
};

function renderBoard(ask: boolean) {
  render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: vi.fn(), open: vi.fn(), ...(ask ? { ask: vi.fn() } : {}) }}
    >
      <ViewRenderer spec={board} editing={false} />
    </ViewDataProvider>,
  );
  const widget = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`)!;
  return { lead: widget('lead'), goals: widget('goals') };
}

describe('Ask on plain text blocks', () => {
  it('keeps room beside the text on touch screens, only where Ask shows', () => {
    const { lead, goals } = renderBoard(true);
    expect(screen.getAllByRole('button', { name: /Ask about/ })).toHaveLength(2);
    expect(lead.className).toContain('pointer-coarse:pr-9');
    // Framed blocks put Ask in their title bar's corner.
    expect(goals.className).not.toContain('pointer-coarse:pr-9');
    cleanup();
    expect(renderBoard(false).lead.className).not.toContain('pointer-coarse:pr-9');
  });
});
