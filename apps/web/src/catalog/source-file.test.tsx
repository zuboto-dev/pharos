// R7.6 claim sources on disk open · Opus 5.5 (made-up paths and documents)
import type { ArtifactFileMatch, Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';
import { findSourceFile } from './source-file';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('asks the server by artifact id', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ state: 'none' })));
  vi.stubGlobal('fetch', fetch);
  expect(await findSourceFile('art_lease')).toEqual({ state: 'none' });
  expect(fetch).toHaveBeenCalledWith('/api/artifacts/art_lease/file');
});

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};
const LEASE_PATH = '/Users/someone/Company/Leases/office-lease.pdf';

const lease = (fileId?: string) =>
  ({
    id: 'art_lease',
    type: 'artifact',
    data: {
      projectId: P,
      title: 'Office lease',
      kind: 'link',
      status: 'delivered',
      uri: LEASE_PATH,
      ...(fileId ? { fileId } : {}),
    },
    ...meta,
  }) as Entity<'artifact'>;

const file = {
  id: 'file_lease',
  type: 'file',
  data: {
    projectId: P,
    title: 'Office lease',
    rootId: 'root_fixture1',
    path: 'Leases/office-lease.pdf',
    size: 2048,
    modifiedAt: '2026-10-01T00:00:00.000Z',
    kind: 'contract',
    tags: [],
    taskIds: [],
  },
  ...meta,
} as Entity<'file'>;

const claim = {
  id: 'clm_rent',
  type: 'claim',
  data: {
    projectId: P,
    statement: 'Rent is 1,000 a month.',
    certainty: 'verified',
    checkedOn: '2026-10-11',
    sourceIds: ['art_lease'],
    quote: 'Rent: 1,000 a month.',
    tags: [],
    order: 0,
  },
  ...meta,
} as Entity<'claim'>;

function renderCard(
  artifact: Entity<'artifact'>,
  files: Entity<'file'>[] = [],
  match: ArtifactFileMatch = { state: 'none' },
) {
  const open = vi.fn();
  const findSourceFile = vi.fn(async () => match);
  const data = { ...base, artifacts: [artifact], claims: [claim], files } as ProjectDataset;
  render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open, findSourceFile }}
    >
      <ViewRenderer spec={{ component: 'ClaimCard', claim: 'clm_rent' }} />
    </ViewDataProvider>,
  );
  return { open, findSourceFile };
}

describe('a claim source on disk', () => {
  it('opens the linked file from the certainty popover and the quote caption', () => {
    const { open, findSourceFile } = renderCard(lease('file_lease'), [file]);
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText(LEASE_PATH).tagName).toBe('CODE');
    fireEvent.click(within(popover).getByRole('button', { name: 'Office lease' }));
    expect(open).toHaveBeenCalledWith({ entity: 'file_lease' });

    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    fireEvent.click(screen.getByRole('button', { name: 'Office lease' }));
    expect(open).toHaveBeenLastCalledWith({ entity: 'file_lease' });
    // Linked already: nothing to ask the server.
    expect(findSourceFile).not.toHaveBeenCalled();
  });

  it('offers "Open file" when the server matched it (moved, found by contents)', async () => {
    const { open, findSourceFile } = renderCard(lease(), [file], {
      state: 'linked',
      fileId: 'file_lease',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const popover = screen.getByRole('dialog');
    fireEvent.click(await within(popover).findByRole('button', { name: 'Open file' }));
    expect(open).toHaveBeenCalledWith({ entity: 'file_lease' });
    expect(findSourceFile).toHaveBeenCalledWith('art_lease');
  });

  it('keeps the path as text and says how to make it open when unmatched', async () => {
    const { open } = renderCard(lease(), [], { state: 'not-in-folder' });
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText(LEASE_PATH).tagName).toBe('CODE');
    expect(await within(popover).findByText(/Not in a Pharos folder/)).toBeTruthy();
    expect(within(popover).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/settings',
    );
    expect(within(popover).queryByRole('button', { name: 'Open file' })).toBeNull();
    // The title still opens the source itself.
    fireEvent.click(within(popover).getByRole('button', { name: 'Office lease' }));
    expect(open).toHaveBeenCalledWith({ entity: 'art_lease' });
    cleanup();

    renderCard(lease(), [], {
      state: 'in-folder',
      rootId: 'root_fixture1',
      path: 'Leases/office-lease.pdf',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(await screen.findByText(/not added to this project yet/)).toBeTruthy();
  });
});
