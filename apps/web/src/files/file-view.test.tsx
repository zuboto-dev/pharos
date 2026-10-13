// R7.11 files as widgets in any view: FileView, and a FileList that shows files in it · Opus 5.5
// Every file here is made up (the catalog fixture); no request leaves the test.
import type { FileInfo, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewRenderer } from '../catalog/renderer';

const data = dataset as unknown as ProjectDataset;
const cert = data.files![0]!;

// The PDF frame must not try to load anything in tests.
(
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM!.settings.disableIframePageLoading = true;

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const INFO: FileInfo = {
  id: 'file_fixture2',
  available: true,
  missing: null,
  movedTo: null,
  folder: { id: 'root_fixture1', label: 'Company', level: 'details' },
  type: { mime: 'application/pdf', preview: 'pdf', open: true },
  absolutePath: '/Users/owner/Documents/Company/office-lease.pdf',
};

let open: ReturnType<typeof vi.fn<ViewActions['open']>>;
const apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));

beforeEach(() => {
  open = vi.fn<ViewActions['open']>();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A board as Chrome shows it; every file info request answers with INFO for that id. */
function renderBoard(widgets: unknown[], info: Partial<FileInfo> = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA);
  vi.stubGlobal('fetch', async (url: string) => {
    const id = decodeURIComponent(url.split('/')[3]!.split('?')[0]!);
    return Response.json(url.startsWith('/api/files/') ? { ...INFO, id, ...info } : []);
  });
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
      <ViewRenderer spec={{ component: 'Board', widgets } as never} />
    </ViewDataProvider>,
  );
}

const row = (title: string) =>
  screen.getByText(title, { selector: 'span' }).closest('[role="button"]')!;

describe('FileView', () => {
  it('shows one file inline: a glance, the actions as icons, and its preview', async () => {
    renderBoard([
      {
        id: 'lease',
        node: { component: 'FileView', title: 'Lease', file: 'file_fixture2', size: 'compact' },
      },
    ]);
    const frame = await screen.findByTitle('Preview of Office lease');
    expect(frame.hasAttribute('sandbox')).toBe(false); // Chrome frames a PDF only without it
    expect(frame.getAttribute('src')).toBe('/api/files/file_fixture2/content');
    expect(frame.className).toContain('h-80');
    // The glance (v0.2 B2): the one date that matters (expiry wins over issued); the issuer,
    // the path and the folder wait in the details.
    expect(screen.getByText(/^Expire[sd] /)).toBeTruthy();
    expect(screen.queryByText(/^Issued /)).toBeNull();
    expect(screen.queryByText('Sample Properties LLC')).toBeNull();
    expect(document.body.textContent).not.toContain('/');
    const actions = screen.getByRole('group', { name: 'File actions' });
    for (const name of ['Open in its app', 'Reveal in Finder', 'Copy path'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    // Icons only, each with a tooltip saying what it does.
    expect(actions.textContent).toBe(
      ['Download', 'Open in its app', 'Reveal in Finder', 'Copy path', 'Open in a new tab'].join(
        '',
      ),
    );
    for (const tip of actions.querySelectorAll('[data-tip]'))
      expect(tip.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/files/file_fixture2/download',
    );
    fireEvent.click(row('Office lease'));
    expect(open).toHaveBeenCalledWith({ entity: 'file_fixture2' });
  });

  it('gives a full FileView a taller preview', async () => {
    renderBoard([{ id: 'v', node: { component: 'FileView', file: cert.id } }]);
    const frame = await screen.findByTitle(`Preview of ${cert.data.title}`);
    expect(frame.className).toContain('h-[75vh]');
  });

  it('says when its file is missing on disk, keeps the details and turns the actions off', async () => {
    renderBoard([{ id: 'v', node: { component: 'FileView', file: 'file_fixture2' } }], {
      available: false,
      missing: 'folder-removed',
      absolutePath: null,
    });
    await screen.findByText('This file can’t be opened now.');
    expect(screen.getByText(/Its folder was removed in Settings/)).toBeTruthy();
    expect(screen.getByText('Office lease')).toBeTruthy();
    for (const name of ['Download', 'Reveal in Finder', 'Copy path'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTitle(/Preview of/)).toBeNull();
  });

  it('says when its file isn’t in the project, and asks for a pick when it has none', () => {
    renderBoard([
      { id: 'v', node: { component: 'FileView', file: 'file_unknown' } },
      { id: 'w', node: { component: 'FileView' } },
    ]);
    expect(screen.getByText(/This file isn’t in the project/)).toBeTruthy();
    expect(screen.getByText('Pick a file in the list to show it here.')).toBeTruthy();
  });
});

describe('FileList with showIn', () => {
  it('shows the tapped file in the FileView instead of opening the drawer', async () => {
    renderBoard([
      {
        id: 'papers',
        w: 6,
        node: { component: 'FileList', filter: { where: { tags: 'company' } }, showIn: 'doc' },
      },
      { id: 'doc', w: 6, node: { component: 'FileView', file: cert.id, size: 'compact' } },
    ]);
    await screen.findByTitle(`Preview of ${cert.data.title}`);
    const listRow = (title: string) =>
      screen
        .getAllByRole('listitem')
        .map((li) => li.querySelector('[role="button"]')!)
        .find((r) => r.textContent?.includes(title))!;
    expect(listRow(cert.data.title).getAttribute('aria-pressed')).toBe('true');
    expect(listRow('Office lease').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(listRow('Office lease'));
    await screen.findByTitle('Preview of Office lease');
    expect(open).not.toHaveBeenCalled();
    expect(listRow(cert.data.title).getAttribute('aria-pressed')).toBe('false');
    expect(listRow('Office lease').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps opening the drawer when showIn names no FileView', () => {
    renderBoard([{ id: 'papers', node: { component: 'FileList', showIn: 'nowhere' } }]);
    fireEvent.click(row('Office lease'));
    expect(open).toHaveBeenCalledWith({ entity: 'file_fixture2' });
    expect(row('Office lease').hasAttribute('aria-pressed')).toBe(false);
  });
});
