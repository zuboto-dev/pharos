import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  PermissionAsk,
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
let asks: PermissionAsk[];

const suggestion = (
  s: Partial<PermissionSuggestion> & { rule: string; summary: string },
): PermissionSuggestion => ({
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
  risk: 'low',
  riskWhy: 'Only reads; it changes nothing.',
  origins: [{ label: '/nightshift', count: 4 }],
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

const ASK: PermissionAsk = {
  id: 'a1',
  at: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 40_000).toISOString(),
  status: 'waiting',
  unattended: false,
  folder: '/home/me/code/shop',
  displayFolder: '~/code/shop',
  projects: ['Shop site'],
  agent: '/nightshift',
  tool: 'Bash',
  example: 'npx pnpm@12.9.1 test',
  rule: 'Bash(npx pnpm@12.9.1 test:*)',
  summary: 'Runs the project’s tests',
  risk: 'low',
  riskWhy: 'Runs the project’s own test scripts.',
  allowable: true,
  canAlwaysAllow: true,
};

function preview(body: { rule?: string; action?: string }): PermissionPreview {
  const rule = body.rule ?? ASK.rule;
  return {
    folderId: 'f1',
    path: '/home/me/code/shop/.claude/settings.local.json',
    exists: true,
    rule,
    action: (body.action as 'allow') ?? 'allow',
    addTo: (body.action as 'allow') ?? 'allow',
    removeFrom: [],
    before: { allow: ['Bash(ls:*)'], deny: [], ask: [] },
    after: { allow: ['Bash(ls:*)', rule], deny: [], ask: [] },
    unchanged: false,
    warnings: [],
    hash: 'h1',
  };
}

beforeEach(() => {
  calls = [];
  asks = [];
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
          suggestion({
            rule: 'Bash(pnpm build:*)',
            summary: 'Builds or starts the project',
            examples: ['pnpm build --prod', 'pnpm build', 'pnpm build --x'],
          }),
          suggestion({
            rule: 'Bash(rm:*)',
            summary: 'Runs the command “rm”',
            total: 3,
            week: 0,
            allowable: false,
            risk: 'high',
            reason: 'Deletes files, so it can only be denied',
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
    if (url === '/api/permissions/asks') return Response.json(asks);
    if (url === '/api/permissions/preview' || url.endsWith('/preview'))
      return Response.json(preview(body ?? {}));
    if (url === '/api/permissions/write') {
      overview = { ...overview, recent: [RECORD] };
      return Response.json({ preview: {}, record: RECORD });
    }
    if (url.startsWith('/api/permissions/asks/') && url.endsWith('/answer')) {
      const status = {
        once: 'allowed_once',
        deny: 'denied',
        terminal: 'terminal',
        always: 'allowed_always',
      }[body.answer as string];
      asks = asks.map((a) => ({ ...a, status: status as PermissionAsk['status'] }));
      return Response.json({ ...asks[0], ...(body.answer === 'always' ? { record: RECORD } : {}) });
    }
    if (url === '/api/permissions/undo') return Response.json({ ...RECORD, undoable: false });
    return Response.json({});
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Agent permissions in Settings', () => {
  it('lists a project’s five most asked commands, the rest behind Show all', async () => {
    const folder = overview.folders[0]!;
    overview = {
      ...overview,
      folders: [
        {
          ...folder,
          suggestions: Array.from({ length: 7 }, (_, i) =>
            suggestion({ rule: `Bash(tool${i}:*)`, summary: `Runs tool ${i}` }),
          ),
        },
      ],
    };
    render(<AgentPermissions />);
    const card = await screen.findByRole('listitem', { name: 'shop' });
    fireEvent.click(within(card).getByRole('button', { name: /Shop site/ }));
    expect(within(card).getAllByText(/^Runs tool/)).toHaveLength(5);
    fireEvent.click(within(card).getByRole('button', { name: 'Show all 7' }));
    expect(within(card).getAllByText(/^Runs tool/)).toHaveLength(7);
  });

  it('says how often a rule was asked for', () => {
    expect(askedText({ week: 23, total: 30 }, 14)).toBe('asked 23 times this week');
    expect(askedText({ week: 0, total: 1 }, 14)).toBe('asked 1 time in 14 days');
  });

  it('starts collapsed: a project, a count; then one line per command; then its detail', async () => {
    render(<AgentPermissions />);
    const folder = await screen.findByRole('listitem', { name: 'shop' });
    const header = within(folder).getByRole('button', { name: /Shop site/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(within(folder).getByText('7 asks this week')).toBeTruthy();
    expect(within(folder).queryByText('Builds or starts the project')).toBeNull();
    fireEvent.click(header);
    const row = within(folder).getByRole('listitem', { name: 'Bash(pnpm build:*)' });
    expect(within(row).getByText('Builds or starts the project')).toBeTruthy();
    expect(within(row).getByText('4 this week')).toBeTruthy();
    // No buttons until a command is opened.
    expect(within(row).queryByRole('button', { name: 'Allow' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Builds or starts/ }));
    expect(within(row).getByText(/From \/nightshift \(4\)/)).toBeTruthy();
    expect(within(row).getAllByText(/^pnpm build/)).toHaveLength(2);
    expect(within(row).getByText('Low risk')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Allow' })).toBeTruthy();
    // A deny-only command has Deny and says why.
    const rm = within(folder).getByRole('listitem', { name: 'Bash(rm:*)' });
    fireEvent.click(within(rm).getByRole('button', { name: /rm/ }));
    expect(within(rm).queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(within(rm).getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(within(rm).getByText('Deletes files, so it can only be denied')).toBeTruthy();
    expect(calls.every((c) => c.author === 'human:me')).toBe(true);
  });

  it('shows the exact change, writes it as the owner, and undoes it', async () => {
    render(<AgentPermissions />);
    fireEvent.click(await screen.findByRole('button', { name: /Shop site/ }));
    const row = screen.getByRole('listitem', { name: 'Bash(pnpm build:*)' });
    fireEvent.click(within(row).getByRole('button', { name: /Builds or starts/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Allow' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Allow: Builds or starts the project',
    });
    await within(dialog).findByText('/home/me/code/shop/.claude/settings.local.json');
    expect(within(dialog).getByText('+ Bash(pnpm build:*)')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow and write' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.url === '/api/permissions/write')).toMatchObject({
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
  });

  it('shows a live ask with its project, agent, plain words and risk, and answers it', async () => {
    asks = [ASK];
    render(<AgentPermissions />);
    const card = await screen.findByRole('listitem', { name: 'Ask from Shop site' });
    expect(within(card).getByText('Runs the project’s tests')).toBeTruthy();
    expect(within(card).getByText('npx pnpm@12.9.1 test')).toBeTruthy();
    expect(within(card).getByText(/\/nightshift/)).toBeTruthy();
    expect(within(card).getByText('Low risk')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Just this once' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/permissions/asks/a1/answer')?.body).toEqual({
        answer: 'once',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Ask from Shop site' })).toBeNull(),
    );
    expect(screen.getByText(/Allowed once/)).toBeTruthy();
  });

  it('Allow always on a live ask shows the change before writing', async () => {
    asks = [ASK];
    render(<AgentPermissions />);
    const card = await screen.findByRole('listitem', { name: 'Ask from Shop site' });
    fireEvent.click(within(card).getByRole('button', { name: 'Allow always' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Allow always: Runs the project’s tests',
    });
    await within(dialog).findByText('+ Bash(npx pnpm@12.9.1 test:*)');
    expect(calls.some((c) => c.url.endsWith('/answer'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow and write' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/answer'))?.body).toEqual({
        answer: 'always',
        target: 'local',
        hash: 'h1',
      }),
    );
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows a night run’s ask as notify-only: Allow always for next time, or Dismiss', async () => {
    asks = [{ ...ASK, status: 'unattended', unattended: true }];
    render(<AgentPermissions />);
    const card = await screen.findByRole('listitem', { name: 'Ask from Shop site' });
    expect(screen.getByText('Asked while nobody was watching')).toBeTruthy();
    expect(within(card).getByText(/Asked during \/nightshift, which nobody watches/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Allow always' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Just this once' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Deny' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/permissions/asks/a1/answer')?.body).toEqual({
        answer: 'dismiss',
      }),
    );
  });
});
