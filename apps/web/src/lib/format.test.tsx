import type { ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, useViewData } from '../catalog/context';
import { RecordValue } from '../catalog/components/records';
import { fileTitle } from '../files/files';
import { dateTime, formatDate } from './format';

afterEach(cleanup);

describe('dates and links in tables (v0.2 B10)', () => {
  const now = new Date(2026, 9, 13);
  it('leave the year out of a short date only in the current year', () => {
    expect(formatDate('2026-10-20', true, now)).not.toMatch(/2026/);
    expect(formatDate('2024-03-01', true, now)).toMatch(/2024/);
    expect(formatDate('2027-01-05', true, now)).toMatch(/2027/);
  });

  it('call a file by its title, not its raw file name', () => {
    const file = (title: string) => ({
      id: 'file_a',
      data: { title, path: 'ui-examples/empty-state-a.png' },
    });
    expect(fileTitle(file('Company seal'))).toBe('Company seal');
    expect(fileTitle(file('empty-state-a.png'))).toBe('Empty state a');
    const shownBy = [
      { type: 'artifact', data: { title: 'Empty state A: just a line', fileId: 'file_a' } },
    ];
    expect(fileTitle(file('empty-state-a.png'), shownBy)).toBe('Empty state A: just a line');
  });

  it('show a web address as its glance, with the full address in the tooltip', () => {
    function Cell() {
      const data = useViewData();
      return (
        <RecordValue
          at={{ value: 'https://apps.ankiweb.net', type: 'record', field: 'fields.link' }}
          data={data}
        />
      );
    }
    render(
      <ViewDataProvider data={dataset as unknown as ProjectDataset} version={1}>
        <Cell />
      </ViewDataProvider>,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://apps.ankiweb.net');
    expect(link.getAttribute('title')).toBe('https://apps.ankiweb.net');
    expect(link.textContent).not.toContain('https://');
  });
});

describe('dateTime', () => {
  const now = new Date(2026, 9, 24, 17, 45);
  it('says today and yesterday, and the date otherwise', () => {
    expect(dateTime(new Date(2026, 9, 24, 1, 19).toISOString(), now)).toMatch(/^today 1:19/);
    expect(dateTime(new Date(2026, 9, 23, 21, 2).toISOString(), now)).toMatch(/^yesterday 9:02/);
    expect(dateTime(new Date(2026, 9, 20, 1, 19).toISOString(), now)).toMatch(/^Oct 20, 1:19/);
    expect(dateTime(new Date(2025, 2, 1, 8, 0).toISOString(), now)).toMatch(/^Mar 1, 2025, 8:00/);
  });
});
