import type { ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { fillTemplate, pathLabel } from './components/generic';
import { ViewDataProvider, useViewData } from './context';
import { ViewRenderer } from './renderer';

const data = dataset as unknown as ProjectDataset;
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);
afterEach(cleanup);

function renderNode(spec: Parameters<typeof ViewRenderer>[0]['spec']) {
  return render(
    <ViewDataProvider data={data} version={1}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

describe('generic data components', () => {
  it('DataTable shows chosen columns, following references and showing options as badges', () => {
    renderNode({
      component: 'DataTable',
      query: { type: 'artifact' },
      columns: [
        { field: 'title' },
        { field: 'kind' },
        { field: 'status' },
        { field: 'stage.name', label: 'Stage' },
      ],
    });
    const row = screen.getByText('MCP server').closest('tr')!;
    expect(within(row).getByText('File')).toBeTruthy();
    expect(within(row).getByText('Delivered')).toBeTruthy();
    expect(within(row).getByText('M1 Data + MCP')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Stage' })).toBeTruthy();
    expect(pathLabel('assignee.kind')).toBe('Assignee kind');
    expect(pathLabel('dueDate')).toBe('Due date');
  });

  it('CountChart counts by a field in its natural order, with a None group', () => {
    renderNode({ component: 'CountChart', query: { type: 'task' }, by: 'status' });
    const bars = screen.getByRole('list', { name: 'Count by Status' });
    expect([...bars.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Todo3',
      'In progress2',
      'Blocked1',
      'Done3',
    ]);
    cleanup();
    renderNode({
      component: 'CountChart',
      query: { type: 'task' },
      by: 'assigneeId',
      sort: 'count',
    });
    const items = [...screen.getByRole('list').querySelectorAll('li')].map((li) => li.textContent);
    expect(items[0]).toBe('Claude Code5');
    expect(items).toContain('None3');
  });

  it('Stat shows a count, a percentage, and keeps a zero "bad" number calm', () => {
    renderNode({
      component: 'Grid',
      columns: 3,
      children: [
        {
          component: 'Stat',
          label: 'Blocked',
          tone: 'bad',
          query: { type: 'task', where: { status: 'blocked' } },
        },
        {
          component: 'Stat',
          label: 'Done',
          query: { type: 'task', where: { status: 'done' } },
          of: { type: 'task' },
        },
        {
          component: 'Stat',
          label: 'Overdue',
          tone: 'bad',
          query: { type: 'task', where: { dueDate: { lt: '$today' } } },
        },
      ],
    });
    expect(screen.getByText('Blocked').nextElementSibling!.textContent).toBe('1');
    expect(screen.getByText('Blocked').nextElementSibling!.className).toContain('text-rose-600');
    expect(screen.getByText('Done').nextElementSibling!.textContent).toBe('33%');
    expect(screen.getByText('Overdue').nextElementSibling!.className).not.toContain(
      'text-rose-600',
    );
  });

  it('Text fills in live values and leaves unknown names visible', () => {
    let filled = '';
    function Probe() {
      const d = useViewData();
      filled = fillTemplate(
        {
          component: 'Text',
          content: '${open} open in ${stage} (${done} done), ${typo}',
          values: {
            open: { count: { type: 'task', where: { status: { not: ['done', 'cancelled'] } } } },
            done: {
              percent: { query: { type: 'task', where: { status: 'done' } }, of: { type: 'task' } },
            },
            stage: { project: 'currentStage' },
          },
        },
        d,
      );
      return null;
    }
    render(
      <ViewDataProvider data={data} version={1}>
        <Probe />
      </ViewDataProvider>,
    );
    expect(filled).toBe('6 open in M2 Catalog + renderer (33% done), ${typo}');
  });
});
