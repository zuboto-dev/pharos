import type {
  Entity,
  FileInfo,
  FolderStatus,
  ProjectDataset,
  ScannedFile,
  ViewNode,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { DetailDrawer } from '../catalog/drawer';
import { ViewRenderer } from '../catalog/renderer';
import { ProjectPage } from '../pages/ProjectPage';
import { choose } from '../test/choose';
import { localToday } from '../lib/format';
import { AddFilesDialog } from './AddFilesDialog';
import { FilePreview } from './FilePreview';
import {
  pdfFrame,
  expiryOf,
  fileActionUrl,
  formatSize,
  readTextLimited,
  scannedUrl,
} from './files';

const base = dataset as unknown as ProjectDataset;

// The PDF frame must not try to load anything in tests.
(
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM!.settings.disableIframePageLoading = true;
/** Many interactions; slow when the whole suite runs in parallel. */
const SLOW = 20_000;
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** YYYY-MM-DD `days` from today, so expiry tests don't age. */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localToday(d);
}

function file(id: string, data: Partial<Entity<'file'>['data']>): Entity<'file'> {
  const template = base.files![0]!;
  return { ...template, id, data: { ...template.data, tags: [], ...data } };
}

const files: Entity<'file'>[] = [
  ...base.files!,
  file('file_passport', {
    title: 'Passport scan',
    path: 'Personal/passport.jpg',
    kind: 'certificate',
    issuer: 'Passport Office',
    expiryDate: inDays(20),
    tags: ['travel'],
  }),
  file('file_insurance', {
    title: 'Old car insurance',
    path: 'Car/insurance-2025.pdf',
    kind: 'contract',
    issuer: 'Sample Insurance',
    expiryDate: inDays(-3),
  }),
  file('file_notes', {
    title: 'Meeting notes',
    path: 'Notes/meeting.md',
    kind: 'other',
    issuer: undefined,
    issuedDate: undefined,
  }),
];
const data: ProjectDataset = { ...base, files };
const byTitle = (title: string) => files.find((f) => f.data.title === title)!;

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
let open: ReturnType<typeof vi.fn<ViewActions['open']>>;
let requests: { url: string; init?: RequestInit }[];

/** Answers each request from `routes` (first matching prefix), else an empty list. */
function mockFetch(routes: Record<string, unknown | ((url: string) => Response)>) {
  requests = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const answer = key ? routes[key] : [];
    return typeof answer === 'function'
      ? (answer as (u: string) => Response)(url)
      : Response.json(answer);
  });
}

beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
  open = vi.fn<ViewActions['open']>();
  mockFetch({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderList(node: Partial<Extract<ViewNode, { component: 'FileList' }>> = {}) {
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
      <ViewRenderer spec={{ component: 'FileList', title: 'Files', ...node } as ViewNode} />
    </ViewDataProvider>,
  );
}

const rowTitles = () =>
  screen
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('[role="button"] span')?.textContent);

describe('FileList', () => {
  it('groups files by kind with counts', () => {
    renderList();
    const contracts = screen.getByRole('region', { name: 'Contract' });
    expect(within(contracts).getByText('Office lease')).toBeTruthy();
    expect(within(contracts).getByText('Old car insurance')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Certificate' })).getByText('2')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Statement' })).toBeTruthy();
  });

  it('finds a file by any words of its name, issuer or tag, and Enter opens the first match', () => {
    renderList();
    const search = screen.getByRole('searchbox', { name: 'Find a file' });
    fireEvent.change(search, { target: { value: 'lease sample' } });
    expect(rowTitles()).toEqual(['Office lease']);
    expect(screen.getByRole('status').textContent).toBe('1 of 6 files');
    fireEvent.change(search, { target: { value: 'travel' } });
    expect(rowTitles()).toEqual(['Passport scan']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(open).toHaveBeenCalledWith({ entity: 'file_passport' });
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText(/No files match/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowTitles()).toHaveLength(6);
  });

  it('filters by kind, tag, issuer and expiry', { timeout: SLOW }, () => {
    renderList();
    choose('Kind', 'Contract');
    expect(rowTitles()).toEqual(['Office lease', 'Old car insurance']);
    choose('Kind', 'All kinds');
    choose('Tag', '#company');
    expect(rowTitles().sort()).toEqual(['Example Co certificate of incorporation', 'Office lease']);
    choose('Tag', 'All tags');
    choose('Issuer', 'Demo Bank');
    expect(rowTitles()).toEqual(['September bank statement']);
    choose('Issuer', 'All issuers');
    choose('Expiry', 'Expired');
    expect(rowTitles()).toEqual(['Old car insurance']);
    choose('Expiry', 'Expires within 60 days');
    expect(rowTitles()).toEqual(['Passport scan']);
    choose('Expiry', 'No expiry date');
    expect(rowTitles()).toHaveLength(3);
  });

  it('marks expired and soon-expiring files', () => {
    renderList();
    const expired = screen.getByText(/^Expired /);
    expect(expired.className).toMatch(/rose/);
    const soon = within(screen.getByRole('region', { name: 'Certificate' })).getByText(/^Expires /);
    expect(soon.className).toMatch(/amber/);
  });

  it('moves between files with the arrow keys and opens one with Enter', () => {
    renderList();
    const search = screen.getByRole('searchbox', { name: 'Find a file' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const rows = screen.getAllByRole('listitem').map((li) => li.firstElementChild as HTMLElement);
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows.at(-1));
    fireEvent.keyDown(rows.at(-1)!, { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('hides the controls when asked, shows the chosen details, and lists without groups', () => {
    renderList({ controls: [], groupBy: 'none', details: ['issuer', 'size', 'tags'] });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Contract' })).toBeNull();
    expect(screen.getByText('Sample Properties LLC · 1.6 KB')).toBeTruthy();
    expect(screen.getByText('#lease')).toBeTruthy();
    // Without groups, each row shows its kind.
    expect(screen.getAllByText('Contract').length).toBeGreaterThan(0);
  });

  it('says when the project has no files', () => {
    render(
      <ViewDataProvider data={{ ...base, files: [] }} version={1}>
        <ViewRenderer spec={{ component: 'FileList' }} />
      </ViewDataProvider>,
    );
    expect(screen.getByText('No files in this project yet')).toBeTruthy();
    // The next step (v0.2 B8): add files, from the Files page's picker.
    expect(screen.getByRole('link', { name: 'Add files' }).getAttribute('href')).toMatch(
      /\/files\?add=1$/,
    );
  });
});

const INFO: FileInfo = {
  id: 'file_fixture2',
  available: true,
  missing: null,
  movedTo: null,
  folder: { id: 'root_fixture1', label: 'Company', level: 'details' },
  type: { mime: 'application/pdf', preview: 'pdf', open: true },
  absolutePath: '/Users/owner/Documents/Company/office-lease.pdf',
};

/** The drawer as Chrome shows it: a PDF opens in a new tab, never a blocked frame. */
function renderDrawer(id: string, info: Partial<FileInfo> = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA);
  mockFetch({ [`/api/files/${id}?`]: { ...INFO, id, ...info } });
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
      <DetailDrawer target={{ entity: id }} onClose={() => {}} />
    </ViewDataProvider>,
  );
}

describe('file drawer', () => {
  it('shows the details, linked tasks, folder and the actions', async () => {
    renderDrawer('file_fixture2');
    await screen.findByText('Company');
    expect(screen.getByText('Office lease')).toBeTruthy();
    expect(screen.getByText('Sample Properties LLC')).toBeTruthy();
    expect(screen.getByText('Company/office-lease.pdf')).toBeTruthy();
    expect(screen.getByText(/never their contents/)).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download.getAttribute('href')).toBe('/api/files/file_fixture2/download');
    expect(download.hasAttribute('download')).toBe(true);
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open (it|the PDF) in a new tab/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('reveals in Finder, opens in the default app, and copies the path', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDrawer('file_fixture2');
    await screen.findByText('Company');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }));
    await screen.findByText('Shown in Finder');
    const post = requests.find((r) => r.init?.method === 'POST')!;
    expect(post.url).toBe('/api/files/file_fixture2/actions/reveal');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByText('Opened in its app');
    expect(requests.at(-1)!.url).toBe(fileActionUrl('file_fixture2', 'open'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    await screen.findByText('Path copied');
    expect(writeText).toHaveBeenCalledWith(INFO.absolutePath);
  });

  it('says why a missing file can’t be opened and turns the actions off', async () => {
    renderDrawer('file_fixture2', {
      available: false,
      missing: 'folder-unavailable',
      absolutePath: null,
    });
    await screen.findByText('This file can’t be opened now.');
    expect(screen.getByText(/disk that isn’t connected/)).toBeTruthy();
    for (const name of ['Download', 'Open', 'Reveal in Finder', 'Copy path'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link', { name: /Open the PDF/ })).toBeNull();
    expect(screen.getByText('Office lease')).toBeTruthy(); // details stay
  });

  it('offers the new path of a moved file', async () => {
    renderDrawer('file_fixture2', {
      available: false,
      missing: 'file-gone',
      movedTo: 'Company/2025/office-lease.pdf',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use the new path' }));
    expect(apply.mock.calls[0]![1]).toEqual([
      {
        op: 'update',
        type: 'file',
        id: 'file_fixture2',
        data: { path: 'Company/2025/office-lease.pdf' },
      },
    ]);
  });

  it('never offers Open for a type outside the allowlist, and has no preview for it', async () => {
    const odd = file('file_odd', { title: 'Odd archive', path: 'Misc/thing.zip' });
    mockFetch({
      '/api/files/file_odd?': {
        ...INFO,
        id: 'file_odd',
        type: { mime: 'application/octet-stream', preview: 'none', open: false },
      },
    });
    render(
      <ViewDataProvider data={{ ...data, files: [...files, odd] }} version={1}>
        <DetailDrawer target={{ entity: 'file_odd' }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    await screen.findByText('No preview for ZIP files. Download it to open it.');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('link', { name: /new tab/ })).toBeNull();
  });

  it('previews Markdown without loading images from the web', async () => {
    const md = byTitle('Meeting notes');
    mockFetch({
      [`/api/files/${md.id}/content`]: () =>
        new Response('# Agenda\n\n- Budget\n\n![chart](https://example.com/x.png)'),
      [`/api/files/${md.id}?`]: {
        ...INFO,
        id: md.id,
        type: { mime: 'text/markdown', preview: 'markdown', open: true },
      },
    });
    const { container } = render(
      <ViewDataProvider data={data} version={1}>
        <DetailDrawer target={{ entity: md.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    await screen.findByRole('heading', { name: 'Agenda' });
    expect(screen.getByText('[image: chart]')).toBeTruthy();
    expect(container.ownerDocument.querySelector('img')).toBeNull();
  });
});

describe('FilePreview', () => {
  const pdf = base.files![0]!;
  const renderPreview = (node: React.ReactNode) =>
    render(
      <ViewDataProvider data={data} version={1}>
        {node}
      </ViewDataProvider>,
    );

  it('shows a PDF in a sandboxed frame, with a new-tab link in case it stays blank', () => {
    renderPreview(<FilePreview file={pdf} available pdf="sandboxed" />);
    const frame = screen.getByTitle(`Preview of ${pdf.data.title}`);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe(`/api/files/${pdf.id}/content`);
    expect(screen.getByRole('link', { name: /Open it in a new tab/ })).toBeTruthy();
  });

  it('frames a PDF without the sandbox attribute where Chromium needs it', () => {
    renderPreview(<FilePreview file={pdf} available pdf="unsandboxed" />);
    const frame = screen.getByTitle(`Preview of ${pdf.data.title}`);
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('src')).toBe(`/api/files/${pdf.id}/content`);
    expect(screen.getByRole('link', { name: /Open it in a new tab/ })).toBeTruthy();
  });

  it('opens a PDF in a new tab where the browser won’t frame it', () => {
    renderPreview(<FilePreview file={pdf} available pdf="new-tab" />);
    const link = screen.getByRole('link', { name: /Open the PDF in a new tab/ });
    expect(link.getAttribute('href')).toBe(`/api/files/${pdf.id}/content`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByTitle(/Preview of/)).toBeNull();
  });

  it('shows images inline', () => {
    renderPreview(<FilePreview file={byTitle('Passport scan')} available />);
    expect(screen.getByRole('img', { name: 'Passport scan' }).getAttribute('src')).toBe(
      '/api/files/file_passport/content',
    );
  });

  it('shows nothing when the file is unavailable', () => {
    const { container } = renderPreview(<FilePreview file={pdf} available={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('file helpers', () => {
  it('frames PDFs unsandboxed only in Chromium, and not at all without a viewer', () => {
    const chrome = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    } as Navigator;
    const safari = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
      pdfViewerEnabled: true,
    } as Navigator;
    expect(pdfFrame(chrome)).toBe('unsandboxed');
    expect(pdfFrame(safari)).toBe('sandboxed');
    expect(pdfFrame({ ...safari, pdfViewerEnabled: false } as Navigator)).toBe('new-tab');
    expect(pdfFrame({ ...chrome, pdfViewerEnabled: false } as Navigator)).toBe('new-tab');
    expect(
      pdfFrame({ userAgent: 'x', userAgentData: { brands: [{ brand: 'Chromium' }] } } as never),
    ).toBe('unsandboxed');
  });

  it('formats sizes and expiry', () => {
    expect(formatSize(830)).toBe('830 bytes');
    expect(formatSize(1634)).toBe('1.6 KB');
    expect(formatSize(3_500_000)).toBe('3.3 MB');
    expect(expiryOf('2026-01-01', '2026-01-02')).toBe('expired');
    expect(expiryOf('2026-03-02', '2026-01-02')).toBe('soon');
    expect(expiryOf('2026-03-04', '2026-01-02')).toBe('later');
    expect(expiryOf(undefined)).toBeNull();
    expect(scannedUrl('prj_1', ' tax ', 50)).toBe(
      '/api/projects/prj_1/scanned-files?limit=50&q=tax',
    );
  });

  it('reads text only up to the limit', async () => {
    vi.stubGlobal('fetch', async () => new Response('a'.repeat(5000)));
    expect(await readTextLimited('/x', 100)).toEqual({ text: 'a'.repeat(100), truncated: true });
    vi.stubGlobal('fetch', async () => new Response('short'));
    expect(await readTextLimited('/x', 100)).toEqual({ text: 'short', truncated: false });
  });
});

const FOLDERS: FolderStatus[] = [
  {
    id: 'root_company1',
    path: '/Users/owner/Documents/Company',
    label: 'Company',
    level: 'details',
    addedAt: '2026-10-01T00:00:00.000Z',
    available: true,
    files: 3,
    scannedAt: '2026-10-01T00:00:00.000Z',
    scanning: false,
    error: null,
    denyRules: [],
  },
];
const scannedFile = (path: string, addedAs: string[] = []): ScannedFile => ({
  rootId: 'root_company1',
  path,
  size: 2048,
  modifiedAt: '2026-09-01T00:00:00.000Z',
  mimeType: 'application/pdf',
  addedAs,
});

describe('Add files', () => {
  function renderDialog(folders = FOLDERS) {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    mockFetch({
      '/api/settings/folders': folders,
      '/api/projects/prj_3155a488397b/scanned-files': [
        scannedFile('Tax/2025-return.pdf'),
        scannedFile('Company/office-lease.pdf', ['file_fixture2']),
        scannedFile('Bank/2026-10.pdf'),
      ],
      '/api/projects/prj_3155a488397b/files': { revision: { id: 9 }, created: {} },
    });
    render(
      <MemoryRouter>
        <ViewDataProvider data={data} version={1}>
          <AddFilesDialog projectId={base.project.id} onClose={onClose} onAdded={onAdded} />
        </ViewDataProvider>
      </MemoryRouter>,
    );
    return { onAdded, onClose };
  }

  it('adds the ticked files from the scan cache in one request', { timeout: SLOW }, async () => {
    const { onAdded, onClose } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Add files from your folders' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    await within(dialog).findByText('2025-return.pdf');
    const lease = screen.getByRole('checkbox', { name: /office-lease\.pdf/ }) as HTMLInputElement;
    expect(lease.disabled && lease.checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /2025-return\.pdf/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /2026-10\.pdf/ }));
    choose('Kind for the added files', 'Statement');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(2));
    expect(onClose).toHaveBeenCalled();
    const post = requests.find((r) => r.init?.method === 'POST')!;
    expect(post.url).toBe('/api/projects/prj_3155a488397b/files');
    expect(JSON.parse(post.init!.body as string)).toEqual({
      message: 'Add 2 files from Company',
      files: [
        { rootId: 'root_company1', path: 'Tax/2025-return.pdf', kind: 'statement' },
        { rootId: 'root_company1', path: 'Bank/2026-10.pdf', kind: 'statement' },
      ],
    });
  });

  it('searches the scan cache and closes with Escape', async () => {
    const { onClose } = renderDialog();
    await screen.findByText('2025-return.pdf');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tax' } });
    await waitFor(() => expect(requests.some((r) => r.url.includes('q=tax'))).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('points to Settings when there are no folders yet', async () => {
    renderDialog([]);
    await screen.findByText(/No folders yet/);
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    );
  });
});

describe('Files page', () => {
  it('lists the project’s files and opens the add dialog', { timeout: SLOW }, async () => {
    mockFetch({
      [`/api/projects/${base.project.id}/data`]: data,
      '/api/settings/folders': FOLDERS,
    });
    render(
      <MemoryRouter initialEntries={[`/projects/${base.project.id}/files`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/files" element={<ProjectPage page="files" />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Files' });
    expect(screen.getByText(/6 files from your folders/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Files/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: /Customize/ })).toBeNull();
    expect(screen.getByText('Office lease')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Add files/ })));
    expect(await screen.findByRole('dialog', { name: 'Add files from your folders' })).toBeTruthy();
  });
});
