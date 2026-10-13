// R7.12 links to files, every artifact opens, folder requests and mentioned documents · Opus 5.5
// Every file, path and request here is made up (the catalog fixture); no request leaves the test.
import type {
  ArtifactFileMatch,
  Entity,
  FolderRequest,
  MentionedFile,
  ProjectDataset,
} from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDetails } from '../files/FileDetails';
import { FilesPage } from '../files/FilesPage';
import { FolderRequestCard } from '../files/FolderRequests';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ArtifactSourcePanel } from './source-file';
import { ViewRenderer } from './renderer';

const base = dataset as unknown as ProjectDataset;
const [cert, lease] = base.files!;
const task = base.tasks[0]!;
const decision = base.decisions[0]!;

(
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM!.settings.disableIframePageLoading = true;

/** The fixture with the first task and decision linking files, and three kinds of artifact. */
const data: ProjectDataset = {
  ...base,
  tasks: base.tasks.map((t) =>
    t.id === task.id ? { ...t, data: { ...t.data, fileIds: [lease!.id] } } : t,
  ),
  decisions: base.decisions.map((d) =>
    d.id === decision.id ? { ...d, data: { ...d.data, fileIds: [cert!.id] } } : d,
  ),
  artifacts: [
    ...base.artifacts,
    artifact('art_web000000001', 'Registry page', { uri: 'https://example.com/registry' }),
    artifact('art_linked000001', 'Lease source', {
      uri: 'Company/office-lease.pdf',
      fileId: lease!.id,
    }),
    artifact('art_local0000001', 'Company seal', { uri: 'brand/company-seal.png' }),
  ],
};

function artifact(id: string, title: string, extra: Record<string, string>): Entity<'artifact'> {
  return {
    id,
    type: 'artifact',
    data: { projectId: base.project.id, title, kind: 'other', status: 'done', ...extra },
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    createdRev: 1,
    updatedRev: 1,
  } as Entity<'artifact'>;
}

const REQUEST: FolderRequest = {
  id: 'freq_made0up01',
  path: '/Users/owner/Made-up Co',
  level: 'details',
  reason: 'To keep the made-up company papers',
  projectId: base.project.id,
  requestedBy: 'Opus 5.5',
  requestedAt: '2026-10-13T09:00:00.000Z',
  status: 'pending',
};

let open: ReturnType<typeof vi.fn<ViewActions['open']>>;
let calls: { url: string; method: string }[];
const apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));

beforeEach(() => {
  open = vi.fn<ViewActions['open']>();
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.endsWith('/approve')) return Response.json({ ...REQUEST, status: 'approved' });
    if (url.endsWith('/decline')) return Response.json({ ...REQUEST, status: 'declined' });
    if (url.startsWith('/api/projects/') && url.includes('/mentioned-files'))
      return Response.json(MENTIONED);
    if (url.startsWith('/api/files/'))
      return Response.json({
        id: lease!.id,
        available: true,
        missing: null,
        movedTo: null,
        folder: { id: 'root_fixture1', label: 'Company', level: 'details' },
        type: { mime: 'application/pdf', preview: 'pdf', open: true },
        absolutePath: '/Users/owner/Company/office-lease.pdf',
      });
    return Response.json([]);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderBoard(widgets: unknown[], actions: Partial<ViewActions> = {}) {
  return render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open, ...actions }}>
      <ViewRenderer spec={{ component: 'Board', widgets } as never} />
    </ViewDataProvider>,
  );
}

describe('linked files', () => {
  it('shows a task’s and a decision’s files as small links that open them', () => {
    renderBoard([
      { id: 'work', node: { component: 'TaskTable', filter: { where: { id: task.id } } } },
      {
        id: 'decisions',
        node: { component: 'DecisionLog', filter: { where: { id: decision.id } } },
      },
    ]);
    const taskFiles = screen.getAllByLabelText('Linked files');
    expect(taskFiles).toHaveLength(2);
    fireEvent.click(within(taskFiles[0]!).getByRole('button', { name: /Office lease/ }));
    // No FileView on this board: the file's drawer (its preview) opens.
    expect(open).toHaveBeenCalledWith({ entity: lease!.id });
    fireEvent.click(within(taskFiles[1]!).getByRole('button', { name: /certificate/ }));
    expect(open).toHaveBeenLastCalledWith({ entity: cert!.id });
  });

  it('opens a linked file in the board’s FileView when there is one', async () => {
    renderBoard([
      { id: 'work', w: 6, node: { component: 'TaskTable', filter: { where: { id: task.id } } } },
      { id: 'doc', w: 6, node: { component: 'FileView', file: cert!.id, size: 'compact' } },
    ]);
    expect(await screen.findByTitle(`Preview of ${cert!.data.title}`)).toBeTruthy();
    fireEvent.click(
      within(screen.getByLabelText('Linked files')).getByRole('button', { name: /Office lease/ }),
    );
    expect(await screen.findByTitle('Preview of Office lease')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it('lists what links a file in its details, each opening its own drawer', () => {
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
        <FileDetails file={lease as Entity<'file'>} />
      </ViewDataProvider>,
    );
    const linked = screen.getByRole('list', { name: 'Linked from' });
    fireEvent.click(within(linked).getByRole('button', { name: task.data.title }));
    expect(open).toHaveBeenCalledWith({ entity: task.id });
    expect(within(linked).getByRole('button', { name: 'Lease source' })).toBeTruthy();
  });
});

describe('every artifact opens', () => {
  it('opens a web page in a new tab, a linked file, or the artifact’s panel', () => {
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    renderBoard([
      {
        id: 'docs',
        node: {
          component: 'DataTable',
          query: {
            type: 'artifact',
            where: { id: ['art_web000000001', 'art_linked000001', 'art_local0000001'] },
          },
          columns: [{ field: 'title' }, { field: 'uri' }],
        },
      },
    ]);
    fireEvent.click(screen.getByText('Registry page'));
    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com/registry',
      '_blank',
      'noopener,noreferrer',
    );
    fireEvent.click(screen.getByText('Lease source'));
    expect(open).toHaveBeenCalledWith({ entity: lease!.id });
    fireEvent.click(screen.getByText('Company seal'));
    expect(open).toHaveBeenLastCalledWith({ entity: 'art_local0000001' });
    // The uri column opens the same way.
    // At a glance (v0.2 B2): the file name, and "Web page" for a web address.
    fireEvent.click(screen.getByRole('button', { name: 'company-seal.png' }));
    expect(open).toHaveBeenLastCalledWith({ entity: 'art_local0000001' });
    expect(screen.getByRole('link', { name: /^Web page/ }).getAttribute('href')).toBe(
      'https://example.com/registry',
    );
  });

  it('opens list items too (DataList)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderBoard([
      {
        id: 'docs',
        node: {
          component: 'DataList',
          query: { type: 'artifact', where: { id: 'art_linked000001' } },
        },
      },
    ]);
    fireEvent.click(screen.getByText('Lease source'));
    expect(open).toHaveBeenCalledWith({ entity: lease!.id });
  });
});

describe('folder requests', () => {
  it('approves or declines with one click on the owner’s routes', async () => {
    const done = vi.fn();
    render(<FolderRequestCard request={REQUEST} onDone={done} />);
    expect(screen.getByText(/Opus 5\.5/)).toBeTruthy();
    expect(screen.getByText(/To keep the made-up company papers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ ...REQUEST, status: 'approved' }));
    expect(calls.at(-1)).toEqual({
      url: '/api/settings/folder-requests/freq_made0up01/approve',
      method: 'POST',
    });
    cleanup();
    render(<FolderRequestCard request={REQUEST} onDone={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(calls.at(-1)?.url).toMatch(/\/decline$/));
  });

  it('says which folder a local document needs, with Approve when an agent asked', async () => {
    let match: ArtifactFileMatch = {
      state: 'not-in-folder',
      path: 'brand/company-seal.png',
      folder: REQUEST.path,
      request: REQUEST,
    };
    const findSourceFile = vi.fn(async () => match);
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open, findSourceFile }}>
        <ArtifactSourcePanel artifact={data.artifacts.find((a) => a.id === 'art_local0000001')!} />
      </ViewDataProvider>,
    );
    expect(await screen.findByText('To open it here, Pharos needs this folder.')).toBeTruthy();
    match = { state: 'in-folder', rootId: 'root_made0up01', path: 'brand/company-seal.png' };
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // Asked again once approved.
    expect(await screen.findByText(/not added to this project yet/)).toBeTruthy();
    expect(findSourceFile).toHaveBeenCalledTimes(2);
  });

  it('says where to add the folder when no agent asked', async () => {
    const findSourceFile = vi.fn(async (): Promise<ArtifactFileMatch> => ({
      state: 'not-in-folder',
      path: '/Users/owner/Elsewhere/a.pdf',
      folder: '/Users/owner/Elsewhere',
      request: null,
    }));
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open, findSourceFile }}>
        <ArtifactSourcePanel artifact={data.artifacts.find((a) => a.id === 'art_local0000001')!} />
      </ViewDataProvider>,
    );
    expect(await screen.findByText('/Users/owner/Elsewhere')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

const MENTIONED: MentionedFile[] = [
  {
    artifactId: 'art_local0000001',
    title: 'Company seal',
    uri: 'brand/company-seal.png',
    match: {
      state: 'not-in-folder',
      path: 'brand/company-seal.png',
      folder: REQUEST.path,
      request: REQUEST,
    },
  },
  {
    artifactId: 'art_missing00001',
    title: 'Old certificate',
    uri: 'records/2019/certificate.pdf',
    match: { state: 'missing', rootId: 'root_made0up01', path: 'records/2019/certificate.pdf' },
  },
  {
    artifactId: 'art_refused00001',
    title: 'Bank login',
    uri: 'records/credentials.json',
    match: { state: 'refused', rootId: 'root_made0up01', path: 'records/credentials.json' },
  },
];

describe('the Files page', () => {
  it('lists documents the project mentions but Pharos can’t open yet, with why', async () => {
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
        <FilesPage onAdded={() => {}} />
      </ViewDataProvider>,
    );
    const group = await screen.findByRole('region', { name: 'Mentioned but not in Pharos yet' });
    expect(within(group).getByText('Folder not approved')).toBeTruthy();
    expect(within(group).getByText('File not found')).toBeTruthy();
    expect(within(group).getByText('Refused for safety')).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Approve' })).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Old certificate' }));
    expect(open).toHaveBeenCalledWith({ entity: 'art_missing00001' });
  });
});
