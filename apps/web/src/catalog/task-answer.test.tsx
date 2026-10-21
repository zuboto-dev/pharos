import { addDays, nextMonday, type Entity, type ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../lib/format';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { Node as CatalogNode } from './renderer';
import { VariantProvider } from './variant';

// The owner's other answers on a checklist task in a report (won't do, later, a reply), and how
// an answered row reads. Made-up tasks only.

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const today = localToday();
const later = addDays(today, 6);

function task(id: string, title: string, extra: Partial<Entity<'task'>['data']> = {}) {
  return {
    id,
    type: 'task',
    data: {
      projectId: P,
      title,
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      order: 0,
      ...extra,
    },
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    createdRev: 1,
    updatedRev: 1,
  } as Entity<'task'>;
}

const TASKS = [
  task('task_send', 'Send the licence request'),
  task('task_wont', 'Book the venue', { status: 'cancelled' }),
  task('task_reply', 'Call the printer', { reply: 'Ana calls them on Friday; wait for her' }),
  task('task_later', 'Renew the domain', { deferredUntil: later }),
  task('task_done', 'Order the paper', { status: 'done' }),
];

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 10, created: {} }));
});
afterEach(cleanup);

function show(variant: 'document' | 'board' = 'document') {
  return render(
    <MemoryRouter>
      <ViewDataProvider
        data={{ ...base, tasks: TASKS }}
        version={1}
        actions={{ apply, open: vi.fn() }}
      >
        <VariantProvider variant={variant}>
          <CatalogNode node={{ component: 'TaskChecklist' }} />
        </VariantProvider>
      </ViewDataProvider>
    </MemoryRouter>,
  );
}

const row = (title: string) => screen.getByText(title).closest('li')!;
const lastCall = () => apply.mock.calls.at(-1)!;

describe('TaskChecklist: other answers in a report', () => {
  it('offers one icon button beside Mark done, with a name and a tooltip', () => {
    show();
    const open = row('Send the licence request');
    const button = within(open).getByRole('button', {
      name: 'Other answer for “Send the licence request”',
    });
    expect(button.getAttribute('title')).toBe('Other answer');
    expect(within(open).getByText(/Mark done/)).toBeTruthy();
  });

  it("is a board's: no other answer button outside a report", () => {
    show('board');
    expect(screen.queryByRole('button', { name: /^Other answer for/ })).toBeNull();
  });

  it("won't do: one revision that cancels it", async () => {
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Other answer for “Send the licence request”' }),
    );
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Won’t do', 'Later…', 'Reply…']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Won’t do' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(lastCall()).toEqual([
      "Won't do “Send the licence request”",
      [
        {
          op: 'update',
          type: 'task',
          id: 'task_send',
          data: { status: 'cancelled', reply: null, deferredUntil: null },
        },
      ],
      { undoable: true },
    ]);
  });

  it('later: a day, next Monday by default', async () => {
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Other answer for “Send the licence request”' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Later…' }));
    const dialog = screen.getByRole('dialog', { name: 'Later: “Send the licence request”' });
    const date = within(dialog).getByLabelText(/Later, on/) as HTMLInputElement;
    expect(date.value).toBe(nextMonday(today));
    fireEvent.change(date, { target: { value: later } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(lastCall()[0]).toBe(`Later (${later}): “Send the licence request”`);
    expect(lastCall()[1][0]).toMatchObject({ data: { deferredUntil: later, reply: null } });
  });

  it('reply: needs words, then saves them', async () => {
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Other answer for “Send the licence request”' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reply on “Send the licence request”' });
    const send = within(dialog).getByRole('button', { name: 'Reply' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '  Wait for counsel first  ' },
    });
    fireEvent.click(send);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(lastCall()[0]).toBe('Reply on “Send the licence request”: Wait for counsel first');
    expect(lastCall()[1][0]).toMatchObject({
      data: { reply: 'Wait for counsel first', deferredUntil: null },
    });
  });

  it('answered rows say how, compactly, with no Mark done; done ones fold away', () => {
    show();
    const wont = row('Book the venue');
    expect(wont.querySelector('[data-task-answer="wontDo"]')?.textContent).toContain('Won’t do');
    const replied = row('Call the printer');
    const reply = replied.querySelector('[data-task-answer="replied"] [title]')!;
    expect(reply.getAttribute('title')).toBe('Your reply: Ana calls them on Friday; wait for her');
    const deferred = row('Renew the domain');
    expect(deferred.querySelector('[data-task-answer="later"]')?.textContent).toMatch(/^Later · /);
    for (const r of [wont, replied, deferred]) {
      expect(within(r).queryByText(/Mark done/)).toBeNull();
      expect(within(r).queryByRole('button', { name: /^Other answer/ })).toBeNull();
    }
    expect(screen.queryByText('Order the paper')).toBeNull();
  });

  it('Change reopens: clears the reply and the day, and won’t do is open again', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Change answer on “Book the venue”' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(lastCall()).toEqual([
      'Reopen “Book the venue”',
      [
        {
          op: 'update',
          type: 'task',
          id: 'task_wont',
          data: { status: 'todo', reply: null, deferredUntil: null },
        },
      ],
      { undoable: true },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Change answer on “Call the printer”' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(lastCall()[1][0]).toMatchObject({
      id: 'task_reply',
      data: { reply: null, deferredUntil: null },
    });
    expect((lastCall()[1][0] as { data: object }).data).not.toHaveProperty('status');
  });
});
