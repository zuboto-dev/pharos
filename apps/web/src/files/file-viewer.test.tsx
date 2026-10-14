// v0.2 A6: the file viewer, a modal that opens a file from wherever the reader taps it · Opus 5.5
// Every file here is made up (the catalog fixture); no request leaves the test.
import type { FileInfo, ProjectDataset } from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewRenderer } from '../catalog/renderer';
import { FileViewerProvider } from './FileViewer';

const data = dataset as unknown as ProjectDataset;

(
  window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }
).happyDOM!.settings.disableIframePageLoading = true;

const info = (id: string): FileInfo => ({
  id,
  available: true,
  missing: null,
  movedTo: null,
  folder: { id: 'root_fixture1', label: 'Company papers', level: 'details' },
  type: { mime: 'application/pdf', preview: 'pdf', open: true },
  absolutePath: `/Users/someone/Made-up/${id}.pdf`,
});

let open: ReturnType<typeof vi.fn<ViewActions['open']>>;
const apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));

beforeEach(() => {
  // A browser that shows PDFs in a frame.
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  );
  open = vi.fn<ViewActions['open']>();
  vi.stubGlobal('fetch', async (url: string) => {
    const id = /^\/api\/files\/([^/?]+)(\?|$)/.exec(String(url))?.[1];
    return Response.json(id ? info(id) : {});
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

function renderList(dataOverride: ProjectDataset = data) {
  const ui = (d: ProjectDataset) => (
    <ViewDataProvider data={d} version={1} actions={{ apply, open }}>
      <FileViewerProvider>
        <ViewRenderer
          spec={
            {
              component: 'Board',
              widgets: [
                {
                  id: 'papers',
                  node: { component: 'FileList', groupBy: 'none', controls: [] },
                },
              ],
            } as never
          }
        />
      </FileViewerProvider>
    </ViewDataProvider>
  );
  const result = render(ui(dataOverride));
  return { ...result, rerenderWith: (d: ProjectDataset) => result.rerender(ui(d)) };
}

const row = (title: string) =>
  screen.getByText(title, { selector: 'span' }).closest<HTMLElement>('[role="button"]')!;
const viewer = () => screen.getByRole('dialog');

describe('the file viewer', () => {
  it('opens from a list row: title, one date, actions as icons, and the preview', async () => {
    renderList();
    const lease = row('Office lease');
    lease.focus();
    fireEvent.click(lease);
    const dialog = screen.getByRole('dialog', { name: 'Office lease' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('heading', { name: 'Office lease' })).toBeTruthy();
    // The one date that matters: its expiry. Issuer and issued date wait under Details.
    expect(within(dialog).getByText(/^Expires /)).toBeTruthy();
    expect(within(dialog).queryByText('Sample Properties LLC')).toBeNull();
    expect(within(dialog).getByText('2 of 3')).toBeTruthy();
    expect(await within(dialog).findByTitle('Preview of Office lease')).toBeTruthy();
    const actions = within(dialog).getByRole('group', { name: 'File actions' });
    for (const name of ['Open in its app', 'Reveal in Finder', 'Copy path'])
      expect(within(actions).getByRole('button', { name })).toBeTruthy();
    expect(within(actions).getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/files/file_fixture2/download',
    );
    expect(within(actions).getByRole('link', { name: 'Open in a new tab' })).toBeTruthy();
    // Icons with tooltips, never words.
    for (const tip of actions.querySelectorAll('[data-tip]'))
      expect(tip.getAttribute('aria-hidden')).toBe('true');
    // Focus starts on Close; the page behind doesn't scroll.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps the details, and where the file is, closed until the reader asks', async () => {
    renderList();
    fireEvent.click(row('Office lease'));
    const dialog = viewer();
    await within(dialog).findByTitle('Preview of Office lease');
    expect(dialog.textContent).not.toContain('Company/office-lease.pdf');
    expect(dialog.textContent).not.toContain('Company papers');
    const toggle = within(dialog).getByRole('button', { name: 'Details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByText('Sample Properties LLC')).toBeTruthy();
    expect(within(dialog).getByText('Company/office-lease.pdf')).toBeTruthy();
    expect(within(dialog).getByText('Company papers')).toBeTruthy();
    expect(within(dialog).getByText('#lease')).toBeTruthy();
    // What links it: its task, which opens in the drawer (the viewer closes).
    const linked = within(dialog).getByRole('list', { name: 'Linked from' });
    fireEvent.click(within(linked).getAllByRole('button')[0]!);
    expect(open).toHaveBeenCalledWith({ entity: 'task_a9f652e80406' });
  });

  it('opens the drawer to edit details and notes', () => {
    renderList();
    fireEvent.click(row('Office lease'));
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Details' }));
    fireEvent.click(within(viewer()).getByRole('button', { name: /Edit details and notes/ }));
    expect(open).toHaveBeenCalledWith({ entity: 'file_fixture2' });
  });

  it('steps through the list it was opened from with ← → and the arrows, wrapping', () => {
    renderList();
    fireEvent.click(row('Office lease'));
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });
    expect(viewer().getAttribute('aria-label')).toBe('September bank statement');
    expect(within(viewer()).getByText('3 of 3')).toBeTruthy();
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });
    expect(viewer().getAttribute('aria-label')).toBe('Example Co certificate of incorporation');
    fireEvent.keyDown(viewer(), { key: 'ArrowLeft' });
    expect(viewer().getAttribute('aria-label')).toBe('September bank statement');
    fireEvent.click(within(viewer()).getAllByRole('button', { name: 'Previous file' })[0]!);
    expect(viewer().getAttribute('aria-label')).toBe('Office lease');
    fireEvent.click(within(viewer()).getAllByRole('button', { name: 'Next file' })[0]!);
    expect(viewer().getAttribute('aria-label')).toBe('September bank statement');
  });

  it('leaves ← → to a field that takes them', () => {
    renderList();
    fireEvent.click(row('Office lease'));
    const input = document.createElement('input');
    viewer().appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(viewer().getAttribute('aria-label')).toBe('Office lease');
  });

  it('closes on Escape, without closing what is under it, and gives focus back to the row', async () => {
    const underneath = vi.fn();
    window.addEventListener('keydown', underneath);
    renderList();
    const lease = row('Office lease');
    lease.focus();
    fireEvent.click(lease);
    await act(async () => {
      fireEvent.keyDown(viewer(), { key: 'Escape' });
    });
    window.removeEventListener('keydown', underneath);
    expect(underneath).not.toHaveBeenCalled();
    // Fading out: hidden from assistive tech at once, gone after the exit motion.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(lease);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes with its Close button and the backdrop', async () => {
    renderList();
    fireEvent.click(row('Office lease'));
    await act(async () => {
      fireEvent.click(within(viewer()).getByRole('button', { name: 'Close' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(row('Office lease'));
    const backdrop = document.querySelector<HTMLElement>('[data-file-viewer] > [aria-hidden]')!;
    await act(async () => {
      fireEvent.click(backdrop);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus inside on Tab and Shift+Tab', () => {
    renderList();
    fireEvent.click(row('Office lease'));
    const dialog = viewer();
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('is a full-screen sheet on phones and a panel from sm up, with calm motion', () => {
    renderList();
    fireEvent.click(row('Office lease'));
    const panel = viewer().querySelector('section')!;
    expect(panel.className).toMatch(/h-full w-full/);
    expect(panel.className).toMatch(/sm:max-w-5xl/);
    // index.css motion tokens: reduced motion turns them into a fade.
    expect(panel.className).toMatch(/animate-sheet-in sm:animate-pop-in/);
  });

  it('closes when its file is removed while open', () => {
    const { rerenderWith } = renderList();
    fireEvent.click(row('Office lease'));
    expect(viewer()).toBeTruthy();
    rerenderWith({ ...data, files: data.files!.filter((f) => f.id !== 'file_fixture2') });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('opening files from other blocks', () => {
  it('a linked-file chip opens the viewer, stepping only through that item’s files', () => {
    const task = data.tasks[0]!;
    const withFiles: ProjectDataset = {
      ...data,
      tasks: [
        { ...task, data: { ...task.data, fileIds: ['file_fixture3', 'file_fixture1'] } },
        ...data.tasks.slice(1),
      ],
    };
    render(
      <ViewDataProvider data={withFiles} version={1} actions={{ apply, open }}>
        <ViewRenderer
          spec={
            {
              component: 'Board',
              widgets: [
                {
                  id: 'work',
                  node: { component: 'TaskTable', filter: { where: { id: task.id } } },
                },
              ],
            } as never
          }
        />
      </ViewDataProvider>,
    );
    const chips = screen.getByLabelText('Linked files');
    fireEvent.click(within(chips).getByRole('button', { name: /September/ }));
    expect(viewer().getAttribute('aria-label')).toBe('September bank statement');
    expect(within(viewer()).getByText('1 of 2')).toBeTruthy();
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });
    expect(viewer().getAttribute('aria-label')).toBe('Example Co certificate of incorporation');
  });

  it('without a viewer (no board, no page), a file still opens its drawer', async () => {
    const { useOpenFile } = await import('./viewer-context');
    function Opener() {
      const openFile = useOpenFile();
      return (
        <button type="button" onClick={() => openFile('file_fixture2')}>
          Open it
        </button>
      );
    }
    render(
      <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
        <Opener />
      </ViewDataProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(open).toHaveBeenCalledWith({ entity: 'file_fixture2' });
  });
});
