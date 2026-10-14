// v0.2 B2: files at a glance in blocks (icon, name, the one date that matters); where a file is
// and what to do with it wait in its details. Every file here is made up.
import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewRenderer } from '../catalog/renderer';
import { Uri } from '../catalog/ui';
import { glanceName } from './files';
import { glanceDateOf } from './glance';

const base = dataset as unknown as ProjectDataset;
const [cert, lease] = base.files! as Entity<'file'>[];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('glanceDateOf', () => {
  const file = { modifiedAt: '2026-09-30T12:00:00.000Z' };
  it('picks expiry over issued over changed', () => {
    expect(
      glanceDateOf({ ...file, issuedDate: '2024-03-01', expiryDate: '2026-12-31' }, '2026-10-13'),
    ).toMatchObject({ kind: 'expiry', date: '2026-12-31', text: 'Expires Dec 31, 2026' });
    expect(glanceDateOf({ ...file, issuedDate: '2024-03-01' })).toMatchObject({
      kind: 'issued',
      text: 'Issued Mar 1, 2024',
    });
    expect(glanceDateOf(file)).toMatchObject({ kind: 'modified', text: 'Changed Sep 30, 2026' });
  });

  it('says "Expired" once the date has passed', () => {
    expect(glanceDateOf({ ...file, expiryDate: '2026-01-31' }, '2026-10-13')?.text).toBe(
      'Expired Jan 31, 2026',
    );
  });
});

describe('glanceName', () => {
  it('is the last part of a path or address, never its folders', () => {
    expect(glanceName('business-registration/company-seal.png')).toBe('company-seal.png');
    expect(glanceName('/Users/someone/Company/Leases/office%20lease.pdf?x=1')).toBe(
      'office lease.pdf',
    );
    expect(glanceName('notes.md')).toBe('notes.md');
  });
});

describe('Uri at a glance', () => {
  it('writes "Web page" for a web address, with the address only in the tooltip', () => {
    render(<Uri uri="https://www.example.org/registry/page" />);
    const link = screen.getByRole('link', { name: /^Web page/ });
    expect(link.getAttribute('href')).toBe('https://www.example.org/registry/page');
    expect(link.getAttribute('title')).toBe('https://www.example.org/registry/page');
    expect(document.body.textContent).not.toContain('example.org');
  });

  it('writes a local document’s file name, not its folders', () => {
    render(<Uri uri="/Users/someone/Company/Leases/office-lease.pdf" />);
    expect(document.body.textContent).toBe('office-lease.pdf');
  });
});

describe('FileList at a glance', () => {
  function renderList(node: Record<string, unknown>) {
    vi.stubGlobal('fetch', async () => Response.json([]));
    const open = vi.fn<ViewActions['open']>();
    render(
      <ViewDataProvider
        data={base}
        version={1}
        actions={{ apply: async () => ({ ok: false }), open }}
      >
        <ViewRenderer spec={{ component: 'FileList', ...node } as never} />
      </ViewDataProvider>,
    );
    return open;
  }

  it('shows each file’s icon, name and one date by default, and opens it in the viewer', () => {
    const open = renderList({});
    const row = screen.getByText(cert!.data.title).closest<HTMLElement>('[role="button"]')!;
    const expected = glanceDateOf(cert!.data)!.text;
    expect(within(row).getByText(expected)).toBeTruthy();
    // No path, folder or issuer in the row.
    expect(row.textContent).not.toContain('/');
    if (cert!.data.issuer) expect(row.textContent).not.toContain(cert!.data.issuer);
    expect(row.querySelector('svg')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByRole('dialog', { name: cert!.data.title })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it('still shows the details an agent asked for', () => {
    renderList({ details: ['issuer'] });
    const row = screen.getByText(lease!.data.title).closest<HTMLElement>('[role="button"]')!;
    expect(row.textContent).toContain(lease!.data.issuer!);
    expect(row.textContent).not.toMatch(/Expire[sd] |Issued |Changed /);
  });

  it('lays a row out by the block’s width, not the window’s, so details never squeeze the name', () => {
    renderList({ details: ['issuer', 'expiryDate'] });
    const name = screen.getByText(lease!.data.title);
    // The name and its details share a line only once the row itself is wide enough (32rem).
    expect(name.parentElement!.className).toContain('@lg:flex-row');
    expect(name.parentElement!.parentElement!.className).toContain('@container');
    expect(name.parentElement!.className).not.toContain('sm:flex-row');
    cleanup();
    renderList({});
    const glance = screen.getByText(lease!.data.title);
    expect(glance.parentElement!.className).toContain('@md:flex-row');
  });
});

describe('linked file chips', () => {
  it('carry the one date that matters in their tooltip', () => {
    vi.stubGlobal('fetch', async () => Response.json([]));
    const task = base.tasks[0]!;
    const data: ProjectDataset = {
      ...base,
      tasks: [{ ...task, data: { ...task.data, fileIds: [lease!.id] } }, ...base.tasks.slice(1)],
    };
    render(
      <ViewDataProvider data={data} version={1}>
        <ViewRenderer
          spec={{ component: 'TaskTable', filter: { where: { id: task.id } } } as never}
        />
      </ViewDataProvider>,
    );
    const chip = screen.getByRole('button', { name: lease!.data.title });
    expect(chip.getAttribute('title')).toBe(
      `Open “${lease!.data.title}” · ${glanceDateOf(lease!.data)!.text}`,
    );
  });
});
