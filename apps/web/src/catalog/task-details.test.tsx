import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';
import { parseDeliverable } from './task-details';

const base = dataset as unknown as ProjectDataset;
const plain = base.tasks.find((t) => t.data.title === 'Catalog components')!;
const other = base.tasks.find((t) => t.id !== plain.id)!;
const detailed: Entity<'task'> = {
  ...plain,
  data: {
    ...plain.data,
    actions: ['Draft the schema', 'Wire the drawer'],
    acceptance: ['The drawer shows three sections'],
    deliverables: [
      { label: 'Schema change', kind: 'commit', ref: 'abc1234' },
      { label: 'Spec', kind: 'link', ref: 'https://example.com/spec' },
      { label: 'Related task', kind: 'record', ref: other.id },
      { label: 'Notes', kind: 'file', ref: 'docs/notes.md' },
    ],
  },
};
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(cleanup);

function openDrawer(task: Entity<'task'>) {
  const data = { ...base, tasks: base.tasks.map((t) => (t.id === task.id ? task : t)) };
  render(
    <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
      <DetailDrawer target={{ entity: task.id }} onClose={() => {}} />
    </ViewDataProvider>,
  );
  return screen.getByRole('dialog');
}

describe('task details in the drawer', () => {
  it('shows steps, done-when checks to tick, and results as short links and comments', () => {
    const open = vi.fn();
    const withComment = {
      ...base,
      tasks: base.tasks.map((t) => (t.id === detailed.id ? detailed : t)),
      comments: [
        {
          id: 'cmt_1',
          type: 'comment' as const,
          data: {
            projectId: detailed.data.projectId,
            taskId: detailed.id,
            body: 'Both pass:\n\n```\nnode run.mjs\n```',
          },
          createdAt: '2026-10-24T06:19:56.018Z',
          updatedAt: '2026-10-24T06:19:56.018Z',
          createdRev: 5,
          updatedRev: 5,
        },
      ],
    };
    render(
      <ViewDataProvider data={withComment} version={1} actions={{ apply, open }}>
        <DetailDrawer target={{ entity: detailed.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    const dialog = screen.getByRole('dialog');
    const details = dialog.querySelector('[data-task-details]') as HTMLElement;
    expect(
      within(details)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['What to do', 'Done when', 'Results and notes']);
    const steps = details.querySelector('ol')!;
    expect([...steps.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'Draft the schema',
      'Wire the drawer',
    ]);
    // Ticking the only check sends it; the server marks the task done.
    const check = within(details).getByRole('checkbox', {
      name: 'The drawer shows three sections',
    });
    expect(check.getAttribute('aria-checked')).toBe('false');
    expect(within(details).getByText(/0 of 1 checked/)).toBeTruthy();
    fireEvent.click(check);
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      {
        op: 'update',
        type: 'task',
        id: detailed.id,
        data: { acceptanceMet: ['The drawer shows three sections'] },
      },
    ]);
    // Result links are one-line chips: a URL opens in a new tab, a record opens in the panel.
    const link = within(details).getByRole('link', { name: /Spec/ });
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(within(details).getByRole('button', { name: /Related task/ }));
    expect(open).toHaveBeenCalledWith({ entity: other.id });
    expect(details.querySelector('[data-kind="commit"] svg')).toBeTruthy();
    // A comment shows its Markdown, and its code block has a copy button.
    const comment = details.querySelector('[data-comment="cmt_1"]') as HTMLElement;
    expect(comment.textContent).toContain('Both pass');
    expect(within(comment).getByRole('button', { name: 'Copy code' })).toBeTruthy();
    // Not repeated in the fields below.
    expect(within(dialog).queryByText('Acceptance')).toBeNull();
  });

  it('lets the owner add steps, edit steps with code blocks, and comment', () => {
    let dialog = openDrawer(plain);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add steps' }));
    fireEvent.change(within(dialog).getByLabelText('Actions'), {
      target: { value: 'First\n\n Second ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      { op: 'update', type: 'task', id: plain.id, data: { actions: ['First', 'Second'] } },
    ]);
    cleanup();
    const coded = {
      ...plain,
      data: { ...plain.data, actions: ['Run:\n\n```\npnpm test\n```', 'Read the summary'] },
    };
    dialog = openDrawer(coded);
    expect(within(dialog).getByRole('button', { name: 'Copy code' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit actions' }));
    const box = within(dialog).getByLabelText('Actions') as HTMLTextAreaElement;
    expect(box.value).toBe('Run:\n\n```\npnpm test\n```\n---\nRead the summary');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(apply).toHaveBeenCalledTimes(1); // unchanged: nothing saved
    fireEvent.change(within(dialog).getByLabelText('Add a comment'), {
      target: { value: 'Done: 12 tests pass' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Comment' }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      {
        op: 'create',
        type: 'comment',
        data: { projectId: plain.data.projectId, taskId: plain.id, body: 'Done: 12 tests pass' },
      },
    ]);
  });

  it('offers one button for the commands a task asks you to allow, with their risk', async () => {
    const calls: [string, unknown][] = [];
    const rows = [
      {
        command: 'npx pnpm@12.9.1 test',
        rule: 'Bash(npx pnpm@12.9.1 test:*)',
        summary: 'Runs the tests',
        risk: 'low',
        riskWhy: 'Reads and runs tests',
        allowable: true,
        unchanged: false,
      },
      {
        command: 'bash -c x',
        rule: 'Bash(bash:*)',
        summary: 'Runs any shell code',
        risk: 'high',
        riskWhy: 'Anything',
        allowable: false,
        reason: 'It runs any code',
        unchanged: false,
      },
    ];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push([url, init?.body ? JSON.parse(String(init.body)) : undefined]);
      const preview = { folder: '/x/shop', path: '/x/shop/.claude/settings.local.json', rows };
      if (url.endsWith('/commands/write'))
        return Response.json({
          ...preview,
          records: [
            {
              id: 'w1',
              rule: rows[0]!.rule,
              at: '',
              folderId: 'f',
              path: preview.path,
              action: 'allow',
            },
          ],
        });
      if (url.endsWith('/commands/preview')) return Response.json(preview);
      return Response.json([]);
    });
    const dialog = openDrawer({
      ...plain,
      data: { ...plain.data, allowCommands: ['npx pnpm@12.9.1 test', 'bash -c x'] },
    });
    expect(await within(dialog).findByText('Bash(npx pnpm@12.9.1 test:*)')).toBeTruthy();
    expect(within(dialog).getByText('Low risk')).toBeTruthy();
    expect(within(dialog).getByText('Can’t be allowed')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow 1 command' }));
    expect(await within(dialog).findByText(/Allowed 1 in this project’s folder only/)).toBeTruthy();
    expect(calls.find(([u]) => u.endsWith('/commands/write'))![1]).toEqual({
      projectId: plain.data.projectId,
      commands: ['npx pnpm@12.9.1 test', 'bash -c x'],
    });
    const op = apply.mock.calls.at(-1)![1][0] as unknown as {
      type: string;
      data: { body: string };
    };
    expect(op.type).toBe('comment');
    expect(op.data.body).toContain('Bash(npx pnpm@12.9.1 test:*)');
  });

  it('reads a line without a kind as label and where', () => {
    expect(parseDeliverable('Report | out/report.pdf')).toEqual({
      label: 'Report',
      ref: 'out/report.pdf',
    });
    expect(parseDeliverable(' | file')).toBeNull();
  });

  it('reads back a result without a kind as it was written, edit after edit', () => {
    // How the editor writes { label: 'Report', ref: 'docs/x.md' }: an empty kind between.
    const line = 'Report |  | docs/x.md';
    expect(parseDeliverable(line)).toEqual({ label: 'Report', ref: 'docs/x.md' });
    expect(parseDeliverable('Report | | rec_123')).toEqual({ label: 'Report', ref: 'rec_123' });
  });
});
