import type { Desk, DeskItem } from '@pharos/schema';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AsksBadge, openAsksOf, viewOfItem } from './open-asks';

afterEach(cleanup);

const item = (d: Partial<DeskItem> & Pick<DeskItem, 'id' | 'kind'>): DeskItem =>
  ({
    title: 't',
    since: '2026-10-23T00:00:00Z',
    gate: false,
    href: '',
    overdue: false,
    old: false,
    ...d,
  }) as DeskItem;

describe('what still waits for the owner, per view and project', () => {
  it('counts open sheets and decisions as the desk does, by view and by project', () => {
    const desk = {
      items: [
        item({
          id: 'view_a#s1',
          kind: 'sheet',
          projectId: 'p1',
          href: '/projects/p1/views/view_a#sheet-s1',
        }),
        item({
          id: 'view_a#s2',
          kind: 'sheet',
          projectId: 'p1',
          href: '/projects/p1/views/view_a#sheet-s2',
        }),
        item({ id: 'dec_1', kind: 'decision', projectId: 'p1', href: '/projects/p1?entity=dec_1' }),
        item({
          id: 'view_b#s',
          kind: 'sheet',
          projectId: 'p2',
          href: '/projects/p2/views/view_b#sheet-s',
          old: true,
        }),
        item({ id: 'run_1', kind: 'run', href: '/desk#run_1' }),
      ],
    } as unknown as Desk;
    const { byView, byProject } = openAsksOf(desk);
    expect([...byView]).toEqual([['view_a', 2]]);
    expect([...byProject]).toEqual([['p1', 3]]);
    expect(viewOfItem({ href: '/projects/p/views/view_x9#sheet-q' })).toBe('view_x9');
  });

  it('shows a count only when something waits', () => {
    const { container, rerender } = render(<AsksBadge n={0} />);
    expect(container.textContent).toBe('');
    rerender(<AsksBadge n={2} />);
    expect(container.querySelector('[data-open-asks="2"]')?.textContent).toBe(
      '2 waiting for your answer',
    );
  });
});
