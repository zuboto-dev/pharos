import type { ProjectDataset } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { plainExcerpt } from './components/outputs';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

const base = dataset as unknown as ProjectDataset;
vi.stubGlobal('fetch', async () => Response.json([]));
afterEach(cleanup);

describe('decision excerpts', () => {
  it('turns Markdown into one line of plain text', () => {
    expect(
      plainExcerpt(
        '## Why\n\n**Context.** We used _two_ stores; see [the plan](https://example.com) and `apply`.\n\n- One\n- Two\n> Quoted',
      ),
    ).toBe('Why Context. We used two stores; see the plan and apply. One Two Quoted');
    expect(plainExcerpt('Keep snake_case_names and 2 * 3 * 4 as they are.')).toBe(
      'Keep snake_case_names and 2 * 3 * 4 as they are.',
    );
    expect(plainExcerpt('1. First\n2. Second ![chart](c.png)')).toBe('First Second');
  });

  it('shows the excerpt in the log without Markdown marks', () => {
    const [first, ...rest] = base.decisions;
    const data: ProjectDataset = {
      ...base,
      decisions: [
        { ...first!, data: { ...first!.data, body: '**Context.** The *old* store was slow.' } },
        ...rest,
      ],
    };
    render(
      <ViewDataProvider data={data} version={1}>
        <ViewRenderer spec={{ component: 'DecisionLog', title: 'Decisions' }} />
      </ViewDataProvider>,
    );
    const row = screen.getByText(first!.data.title).closest('li')!;
    expect(row.textContent).toContain('Context. The old store was slow.');
    expect(row.textContent).not.toContain('*');
  });
});
