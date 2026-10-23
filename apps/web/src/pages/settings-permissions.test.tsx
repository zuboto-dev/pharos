import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  PermissionPreview,
  PermissionSuggestion,
  PermissionsOverview,
  PermissionWriteRecord,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPermissions, askedText } from './settings-permissions';

type Call = { url: string; method: string; body?: unknown; author?: string };
let calls: Call[];
let overview: PermissionsOverview;

const suggestion = (s: Partial<PermissionSuggestion> & { rule: string }): PermissionSuggestion => ({
  tool: 'Bash',
  total: 5,
  week: 4,
  approved: 1,
  denied: 4,
  blocked: 0,
  ruleDenied: 0,
  lastAt: '2026-10-22T10:00:00.000Z',
  examples: [],
  status: 'not_set',
  allowable: true,
  ...s,
});

const RECORD: PermissionWriteRecord = {
  id: 'w1',
  at: '2026-10-23T10:00:00.000Z',
  folderId: 'f1',
  path: '/home/me/code/shop/.claude/settings.local.json',
  rule: 'Bash(pnpm build:*)',
  action: 'allow',
  backup: '/home/me/code/shop/.claude/settings.local.json.pharos-backup-x',
  undoable: true,
};

beforeEach(() => {
  calls = [];
  overview = {
    windowDays: 14,
    scannedAt: '2026-10-23T10:00:00.000Z',
    transcripts: 3,
    user: { path: '/home/me/.claude/settings.json', exists: true },
    recent: [],
    folders: [
      {
        id: 'f1',
        path: '/home/me/code/shop',
        displayPath: '~/code/shop',
        label: 'shop',
        projects: ['Shop site'],
        sessions: 2,
        total: 9,
        week: 7,
        unfixable: 2,
        files: {
          local: { path: '/home/me/code/shop/.claude/settings.local.json', exists: true },
          shared: { path: '/home/me/code/shop/.claude/settings.json', exists: false },
        },
        more: 0,
        suggestions: [
          suggestion({ rule: 'Bash(pnpm build:*)', examples: ['pnpm build --prod'] }),
          suggestion({
            rule: 'Bash(rm:*)',
            total: 3,
            week: 0,
            allowable: false,
            reason: 'Deletes files, so it can only be denied',
          }),
          suggestion({
            rule: 'Bash(git log:*)',
            status: 'allowed',
            statusSource: 'user',
            matchedBy: 'Bash(git:*)',
          }),
        ],
      },
    ],
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const author = new Headers(init?.headers).get('x-pharos-author') ?? undefined;
    calls.push({ url, method, body, author });
    if (url === '/api/permissions') return Response.json(overview);
    if (url === '/api/permissions/preview')
      return Response.json({
        folderId: 'f1',
        path: '/home/me/code/shop/.claude/settings.local.json',
        exists: true,
        rule: body.rule,
        action: body.action,
        addTo: body.action,
        removeFrom: [],
        before: { allow: ['Bash(ls:*)'], deny: [], ask: [] },
        after: { allow: ['Bash(ls:*)', body.rule], deny: [], ask: [] },
        unchanged: false,
        warnings: [],
        hash: 'h1',
      } satisfies PermissionPreview);
    if (url === '/api/permissions/write') {
      overview = { ...overview, recent: [RECORD] };
      return Response.json({ preview: {}, record: RECORD });
    }
    if (url === '/api/permissions/undo') {
      overview = {
        ...overview,
        recent: [{ ...RECORD, undone: '2026-10-23T10:01:00.000Z', undoable: false }],
      };
      return Response.json({ ...RECORD, undoable: false });
    }
    return Response.json({});
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Agent permissions in Settings', () => {
  it('says how often a rule was asked for', () => {
    expect(askedText({ week: 23, total: 30 }, 14)).toBe('asked 23 times this week');
    expect(askedText({ week: 0, total: 1 }, 14)).toBe('asked 1 time in 14 days');
  });

  it('lists asks per folder, with status and deny-only rules', async () => {
    render(<AgentPermissions />);
    const row = await screen.findByRole('listitem', { name: 'Bash(pnpm build:*)' });
    expect(within(row).getByText('asked 4 times this week')).toBeTruthy();
    expect(within(row).getByText('pnpm build --prod')).toBeTruthy();
    expect(within(row).getByText('Not set')).toBeTruthy();
    const rm = screen.getByRole('listitem', { name: 'Bash(rm:*)' });
    expect((within(rm).getByRole('button', { name: /^Allow/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((within(rm).getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    const log = screen.getByRole('listitem', { name: 'Bash(git log:*)' });
    expect(within(log).getByText('Allowed')).toBeTruthy();
    expect((within(log).getByRole('button', { name: 'Allow' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/settings\.local\.json/, { selector: 'code' })).toBeTruthy();
    expect(calls.every((c) => c.author === 'human:me')).toBe(true);
  });

  it('shows the exact change, writes it as the owner, and undoes it', async () => {
    render(<AgentPermissions />);
    const row = await screen.findByRole('listitem', { name: 'Bash(pnpm build:*)' });
    fireEvent.click(within(row).getByRole('button', { name: 'Allow' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allow Bash(pnpm build:*)' });
    await within(dialog).findByText('/home/me/code/shop/.claude/settings.local.json');
    expect(within(dialog).getByText('+ Bash(pnpm build:*)')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/write'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow and write' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const write = calls.find((c) => c.url === '/api/permissions/write')!;
    expect(write).toMatchObject({
      method: 'POST',
      author: 'human:me',
      body: {
        folderId: 'f1',
        rule: 'Bash(pnpm build:*)',
        action: 'allow',
        target: 'local',
        hash: 'h1',
      },
    });
    const status = await screen.findByRole('status');
    fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/permissions/undo')).toBe(true));
    expect(calls.find((c) => c.url === '/api/permissions/undo')?.body).toEqual({ id: 'w1' });
  });

  it('writes to the shared settings.json when picked', async () => {
    render(<AgentPermissions />);
    fireEvent.click(await screen.findByLabelText(/Everyone on the repo/));
    const row = await screen.findByRole('listitem', { name: 'Bash(rm:*)' });
    fireEvent.click(within(row).getByRole('button', { name: 'Deny' }));
    await screen.findByRole('dialog', { name: 'Deny Bash(rm:*)' });
    expect(calls.find((c) => c.url === '/api/permissions/preview')?.body).toMatchObject({
      action: 'deny',
      target: 'shared',
    });
  });
});
