// R7.13 Gallery: pictures from artifacts and files, safe image loading, and the lightbox · Opus 5.5
// Every address, file and name here is made up; nothing is fetched.
import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ViewRenderer } from './renderer';

beforeEach(() => {
  // The lightbox's file actions ask for the file's info; answer that it is there.
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          available: true,
          type: { mime: 'image/png', preview: 'image', open: true },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const meta = {
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};

const artifact = (id: string, data: Partial<Entity<'artifact'>['data']>) =>
  ({
    id,
    type: 'artifact',
    data: { projectId: P, title: id, kind: 'link', status: 'delivered', tags: ['ui'], ...data },
    ...meta,
  }) as Entity<'artifact'>;

const file = (id: string, title: string, path: string) =>
  ({
    id,
    type: 'file',
    data: {
      projectId: P,
      title,
      rootId: 'root_fixture1',
      path,
      size: 2048,
      modifiedAt: '2026-10-01T10:00:00.000Z',
      kind: 'other',
      tags: ['shots'],
      taskIds: [],
    },
    ...meta,
  }) as Entity<'file'>;

const data: ProjectDataset = {
  ...base,
  artifacts: [
    ...base.artifacts,
    artifact('art_cards', {
      title: 'Card layout',
      description: 'Three cards in a row',
      image: 'https://images.example.com/cards.png',
      uri: 'https://www.example.org/patterns/cards',
      alt: 'Three cards with a picture and a title each',
    }),
    artifact('art_stepper', {
      title: 'Stepper',
      image: 'file_shot1',
      alt: 'Four numbered steps joined by a line',
    }),
    artifact('art_plain', { title: 'Plain http', image: 'http://images.example.com/plain.png' }),
  ],
  claims: [
    ...base.claims,
    {
      id: 'clm_cards',
      type: 'claim',
      data: {
        projectId: P,
        statement: 'Cards read faster than tables on phones.',
        certainty: 'reading',
        checkedOn: '2026-10-13',
        assumption: 'Five people tried both',
        sourceIds: [],
        tags: [],
        order: 0,
      },
      ...meta,
    } as Entity<'claim'>,
  ],
  files: [
    ...(base.files ?? []),
    file('file_shot1', 'Stepper screenshot', 'Shots/stepper.png'),
    file('file_shot2', 'Empty state screenshot', 'Shots/empty-state.webp'),
    file('file_doc1', 'Brief', 'Shots/brief.pdf'),
  ],
};

function show(node: ViewNode, actions?: Partial<ViewActions>) {
  const all: ViewActions = { apply: async () => ({ ok: false }), open: vi.fn(), ...actions };
  render(
    <ViewDataProvider data={data} version={1} actions={all}>
      <ViewRenderer spec={node} />
    </ViewDataProvider>,
  );
  return all;
}

const gallery = (extra: Partial<Extract<ViewNode, { component: 'Gallery' }>> = {}): ViewNode => ({
  component: 'Gallery',
  artifacts: { where: { tags: 'ui' } },
  ...extra,
});

describe('Gallery', () => {
  it('shows https pictures lazily, without a referrer, with a caption and its source', () => {
    show(gallery({ highlight: ['art_cards'] }));
    const img = screen.getByAltText('Three cards with a picture and a title each');
    expect(img.getAttribute('src')).toBe('https://images.example.com/cards.png');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('Card layout')).toBeTruthy();
    // At a glance (v0.2 B2) the caption says "Source"; the host is in its tooltip.
    const source = screen.getAllByRole('link', { name: /^Source/ })[0]!;
    expect(source.getAttribute('href')).toBe('https://www.example.org/patterns/cards');
    expect(source.getAttribute('title')).toMatch(/example\.org/);
    expect(screen.queryByText(/example\.org/)).toBeNull();
    expect(source.getAttribute('rel')).toContain('noreferrer');
    expect(screen.getByRole('button', { name: /Three cards .*\(highlighted\): open large/ }));
    // A project file is served by the file routes, by id.
    const shot = screen.getByAltText('Four numbered steps joined by a line');
    expect(shot.getAttribute('src')).toBe('/api/files/file_shot1/content');
    // A project file's caption is its glance: the one date that matters, never its path.
    expect(screen.getAllByText('Changed Oct 1, 2026').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Shots\//)).toBeNull();
  });

  it('never loads a picture that is not https; it shows a quiet placeholder with the link', () => {
    show(gallery());
    expect(document.querySelector('img[src^="http:"]')).toBeNull();
    const placeholder = screen.getByRole('group', { name: /Plain http \(picture not shown\)/ });
    expect(within(placeholder).getByText(/isn't https/)).toBeTruthy();
    const link = within(placeholder).getByRole('link');
    expect(link.getAttribute('href')).toBe('http://images.example.com/plain.png');
    expect(link.getAttribute('target')).toBe('_blank');
    // A placeholder is not a button: a link can't sit inside one.
    expect(placeholder.closest('button')).toBeNull();
  });

  it('turns a picture that fails to load into the placeholder', () => {
    show(gallery());
    const img = screen.getByAltText('Three cards with a picture and a title each');
    fireEvent.error(img);
    const placeholder = screen.getByRole('group', { name: /Three cards .*\(picture not shown\)/ });
    expect(within(placeholder).getByText('Couldn’t load the picture.')).toBeTruthy();
    expect(within(placeholder).getByRole('link').getAttribute('href')).toBe(
      'https://images.example.com/cards.png',
    );
  });

  it('shows image files only, and the layouts as grid, side by side, or a strip', () => {
    show(gallery({ artifacts: undefined, files: { where: { tags: 'shots' } }, layout: 'strip' }));
    expect(screen.getByAltText('Stepper screenshot')).toBeTruthy();
    expect(screen.getByAltText('Empty state screenshot')).toBeTruthy();
    expect(screen.queryByAltText('Brief')).toBeNull();
    expect(screen.getByRole('list').className).toContain('overflow-x-auto');
    cleanup();
    show(
      gallery({ artifacts: { where: { id: ['art_cards', 'art_stepper'] } }, layout: 'compare' }),
    );
    expect(screen.getByRole('list').className).toContain('sm:grid-cols-2');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    cleanup();
    show(gallery({ artifacts: { where: { tags: 'nothing' } } }));
    // The project has pictures; this block's filter just matches none of them.
    expect(screen.getByText('No pictures match this list')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Add files' })).toBeNull();
  });

  it('says "No pictures yet" and offers Add files when the project has none', () => {
    render(
      <ViewDataProvider
        data={{ ...data, artifacts: [], files: [] }}
        version={1}
        actions={{ apply: async () => ({ ok: false }), open: vi.fn() }}
      >
        <ViewRenderer spec={gallery()} />
      </ViewDataProvider>,
    );
    expect(screen.getByText('No pictures yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add files' })).toBeTruthy();
  });

  it('heads the pictures with a stored claim', () => {
    show(gallery({ claim: 'clm_cards' }));
    expect(screen.getByText('Cards read faster than tables on phones.')).toBeTruthy();
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe(
      'Cards read faster than tables on phones.',
    );
  });
});

describe('Gallery lightbox', () => {
  const openFirst = () => {
    show(gallery({ artifacts: { where: { id: ['art_cards', 'art_stepper'] } } }));
    const opener = screen.getByRole('button', { name: /Three cards .*open large/ });
    opener.focus();
    fireEvent.click(opener);
    return { opener, dialog: screen.getByRole('dialog') };
  };

  it('opens large with the caption and source, focus on Close', () => {
    const { dialog } = openFirst();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Card layout');
    expect(within(dialog).getByText('1 of 2')).toBeTruthy();
    expect(within(dialog).getByText('Three cards in a row')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /example\.org/ })).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('steps with the arrow keys and wraps around', () => {
    const { dialog } = openFirst();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Stepper');
    expect(within(screen.getByRole('dialog')).getByText('2 of 2')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Card layout');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Stepper');
  });

  it('keeps focus inside on Tab and Shift+Tab', () => {
    const { dialog } = openFirst();
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and gives focus back to the picture', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { opener, dialog } = openFirst();
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('shows the file actions for a picture that is a project file, and swipes on phones', async () => {
    const { dialog } = openFirst();
    fireEvent.touchStart(dialog.children[1]!, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(dialog.children[1]!, { changedTouches: [{ clientX: 100 }] });
    const now = screen.getByRole('dialog');
    expect(now.getAttribute('aria-label')).toBe('Stepper');
    expect(await within(now).findByRole('link', { name: /Download/ })).toBeTruthy();
  });

  it('closes when swiped down on a phone (v0.2 B9)', async () => {
    const { dialog } = openFirst();
    fireEvent.touchStart(dialog.children[1]!, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchEnd(dialog.children[1]!, { changedTouches: [{ clientX: 210, clientY: 340 }] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the item details from the lightbox', () => {
    const open = vi.fn();
    show(gallery({ artifacts: { where: { id: ['art_cards'] } } }), { open });
    fireEvent.click(screen.getByRole('button', { name: /open large/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Details' }));
    expect(open).toHaveBeenCalledWith({ entity: 'art_cards' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
