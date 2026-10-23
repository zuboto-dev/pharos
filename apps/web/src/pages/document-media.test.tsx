import type { DocBlock, Entity } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaPanel, SheetShows, docMedia } from './document-media';
import type { Sheet } from './document-rich';

afterEach(cleanup);

const view = {
  id: 'view_1',
  type: 'view',
  data: { projectId: 'p', name: 'Review' },
} as unknown as Entity<'view'>;

const blocks = [
  { kind: 'block', id: 'h1', node: { component: 'Text', content: '## Tempo\nWhat we tried.' } },
  {
    kind: 'figure',
    id: 'tempo-shots',
    items: [
      { src: 'shots/before.png', alt: 'Before', caption: '**Before.** Off by an octave.' },
      { src: 'shots/after.png', alt: 'After' },
    ],
  },
  { kind: 'block', id: 'h2', node: { component: 'Text', content: '## Sound\nListen.' } },
  { kind: 'figure', id: 'clip', items: [{ src: 'rec/take.mp3', alt: 'Take one' }] },
  {
    kind: 'sheet',
    id: 'q16',
    title: 'Tempo check on or off?',
    shows: ['tempo-shots'],
    blocks: [{ kind: 'block', id: 'ask', node: { component: 'Text', content: 'Choose.' } }],
  },
] as unknown as DocBlock[];

describe('pictures beside the page', () => {
  it('lists every picture and clip in reading order under its section', () => {
    expect(docMedia(blocks).map((m) => [m.section, m.kind, m.alt])).toEqual([
      ['Tempo', 'image', 'Before'],
      ['Tempo', 'image', 'After'],
      ['Sound', 'audio', 'Take one'],
    ]);
  });

  it('puts what a sheet asks about inside it, and opens a picture full size', () => {
    render(<SheetShows view={view} sheet={blocks[4] as Sheet} blocks={blocks} />);
    const strip = document.querySelector('[data-sheet-shows]') as HTMLElement;
    expect(within(strip).getByText('What this asks about')).toBeTruthy();
    expect(
      within(strip)
        .getAllByRole('img')
        .map((i) => i.getAttribute('alt')),
    ).toEqual(['Before', 'After']);
    fireEvent.click(within(strip).getByRole('button', { name: 'Before: open full size' }));
    expect(screen.getByRole('dialog', { name: 'Before' })).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('opens the Pictures panel from its button, grouped by section, and closes it', () => {
    render(<MediaPanel view={view} blocks={blocks} />);
    fireEvent.click(screen.getByRole('button', { name: /Pictures/ }));
    const panel = screen.getByRole('complementary', { name: 'Pictures and clips' });
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Tempo', 'Sound']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close pictures' }));
    expect(screen.queryByRole('complementary', { name: 'Pictures and clips' })).toBeNull();
  });

  it('stays out of the way on a page with few pictures', () => {
    render(<MediaPanel view={view} blocks={blocks.slice(0, 2)} />);
    expect(screen.queryByRole('button', { name: /Pictures/ })).toBeNull();
  });
});
