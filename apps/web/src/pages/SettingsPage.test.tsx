import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderStatus } from '@pharos/schema';
import { SettingsPage } from './SettingsPage';

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let agent: Record<string, unknown>;
let waiting: unknown[];
let folders: FolderStatus[];

/** What the server would send for a folder (deny rules like the server's, for these paths). */
function folderStatus(f: Pick<FolderStatus, 'id' | 'path' | 'label' | 'level'>): FolderStatus {
  return {
    ...f,
    addedAt: '2026-10-01T00:00:00.000Z',
    available: true,
    files: null,
    scannedAt: null,
    scanning: false,
    error: null,
    denyRules: f.level === 'contents' ? [] : [`Read(/${f.path}/**)`],
  };
}

beforeEach(() => {
  calls = [];
  folders = [];
  waiting = [];
  agent = {
    configured: true,
    enabled: true,
    mode: 'default',
    logPath: '/home/me/.pharos/agent.log',
    running: false,
    answering: [],
    queued: [],
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === '/api/settings')
      return Response.json({
        version: '0.0.0',
        dataPath: '/home/me/.pharos/pharos.db',
        port: 4300,
        mcpUrl: 'http://localhost:4300/mcp',
        projects: 3,
        revisions: 140,
        agent,
      });
    if (url === '/api/agent') return Response.json(agent);
    if (url === '/api/settings/agent') {
      const change = body as { enabled?: boolean; preset?: string };
      agent = { ...agent, ...change };
      if (change.preset) agent.agent = change.preset === 'codex' ? 'Codex' : 'Claude Code';
      return Response.json(agent);
    }
    if (url === '/api/agent/answer-waiting') return Response.json({ questions: waiting.length });
    if (url.startsWith('/api/entities/request')) return Response.json(waiting);
    if (url === '/api/settings/folders' && method === 'GET') return Response.json(folders);
    if (url === '/api/settings/folders' && method === 'POST') {
      const input = body as { path: string; label?: string; level?: 'details' };
      if (input.path.endsWith('nope'))
        return Response.json(
          { error: { code: 'invalid', message: `No folder at ${input.path}` } },
          { status: 400 },
        );
      const folder = folderStatus({
        id: 'root_new000',
        path: input.path,
        label: input.label ?? input.path.split('/').pop()!,
        level: input.level ?? 'details',
      });
      folders = [...folders, folder];
      return Response.json(folder, { status: 201 });
    }
    if (url.startsWith('/api/settings/folders/')) {
      const id = url.split('/').pop()!;
      if (method === 'DELETE') {
        folders = folders.filter((f) => f.id !== id);
        return Response.json({ removed: id });
      }
      folders = folders.map((f) => (f.id === id ? folderStatus({ ...f, ...(body as object) }) : f));
      return Response.json(folders.find((f) => f.id === id));
    }
    return Response.json({});
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('settings', () => {
  it('switches the theme for this browser', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('pharos-theme')).toBe('dark');
  });

  it('pauses and resumes answering, but never sets the command', async () => {
    render(<SettingsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Answer questions automatically' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);
    await screen.findByText(/^Paused/);
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: '/api/settings/agent',
      method: 'PUT',
      body: { enabled: false },
    });
    expect(screen.getByText(/can only be set on the server/)).toBeTruthy();
  });

  it('offers to answer questions that waited while answering was paused', async () => {
    waiting = [{ id: 'req_1' }, { id: 'req_2' }];
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Answer now' }));
    await screen.findByText('Answering 2 questions…');
    expect(calls.some((c) => c.url === '/api/agent/answer-waiting' && c.method === 'POST')).toBe(
      true,
    );
  });

  it('picks which installed agent answers', async () => {
    agent = {
      ...agent,
      preset: 'claude',
      agent: 'Claude Code',
      presets: [
        { id: 'claude', label: 'Claude Code', installed: true },
        { id: 'codex', label: 'Codex', installed: true },
      ],
    };
    render(<SettingsPage />);
    const group = await screen.findByRole('radiogroup', { name: 'Agent that answers' });
    const codex = within(group).getByRole('radio', { name: 'Codex' });
    await waitFor(() =>
      expect(
        within(group).getByRole('radio', { name: 'Claude Code' }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
    fireEvent.click(codex);
    await waitFor(() => expect(codex.getAttribute('aria-checked')).toBe('true'));
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      url: '/api/settings/agent',
      method: 'PUT',
      body: { preset: 'codex' },
    });
    await screen.findByText(/^Codex \(found on this computer\)/);
  });

  it('shows an agent that is not installed, and offers no choice under PHAROS_AGENT_COMMAND', async () => {
    agent = {
      ...agent,
      preset: 'claude',
      presets: [
        { id: 'claude', label: 'Claude Code', installed: true },
        { id: 'codex', label: 'Codex', installed: false },
      ],
    };
    const { unmount } = render(<SettingsPage />);
    const codex = await screen.findByRole('radio', { name: /Codex/ });
    expect(codex.hasAttribute('disabled')).toBe(true);
    expect(codex.textContent).toMatch(/not installed/);
    unmount();

    agent = { ...agent, mode: 'custom', preset: undefined, command: 'my-agent --answer' };
    render(<SettingsPage />);
    await screen.findByText(/decides which agent answers/);
    expect(screen.queryByRole('radiogroup', { name: 'Agent that answers' })).toBeNull();
  });

  it('explains when no agent is set up', async () => {
    agent = { ...agent, configured: false, mode: 'unavailable' };
    render(<SettingsPage />);
    await screen.findByText(/Not set up: install Claude Code/);
    expect(
      screen
        .getByRole('switch', { name: 'Answer questions automatically' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows where the data lives and how to connect an agent', async () => {
    render(<SettingsPage />);
    const data = await screen.findByRole('region', { name: 'Data and connection' });
    await within(data).findByText('/home/me/.pharos/pharos.db');
    expect(data.textContent).toContain('3 projects · 140 revisions');
    expect(data.textContent).toContain('http://localhost:4300/mcp');
    const connect = screen.getByRole('region', { name: 'Connect an agent' });
    expect(connect.textContent).toContain(
      'claude mcp add --transport http pharos http://localhost:4300/mcp',
    );
    fireEvent.click(within(connect).getByRole('tab', { name: 'Codex CLI' }));
    expect(connect.textContent).toContain('codex mcp add pharos --url http://localhost:4300/mcp');
  });
});

describe('folders', () => {
  const region = () => screen.findByRole('region', { name: 'Folders' });

  it('adds a folder with a level and shows the Claude Code rule to copy', async () => {
    render(<SettingsPage />);
    const section = await region();
    await within(section).findByText('No folders yet.');
    fireEvent.change(within(section).getByLabelText('Folder path'), {
      target: { value: '/Users/me/Company' },
    });
    fireEvent.change(within(section).getByLabelText('What agents see in the new folder'), {
      target: { value: 'hidden' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Add folder' }));
    await within(section).findByRole('listitem', { name: 'Company' });
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      url: '/api/settings/folders',
      method: 'POST',
      body: { path: '/Users/me/Company', level: 'hidden' },
    });
    const rules = within(section).getByLabelText('Claude Code deny rules');
    expect(JSON.parse(rules.textContent!)).toEqual({
      permissions: { deny: ['Read(//Users/me/Company/**)'] },
    });
    expect(within(section).getByRole('button', { name: 'Copy deny rules' })).toBeTruthy();
    expect(section.textContent).toContain('~/.claude/settings.json');
  });

  it('says plainly what Pharos can and can’t enforce', async () => {
    render(<SettingsPage />);
    const note = within(await region()).getByRole('note', {
      name: 'What Pharos can and can’t enforce',
    });
    expect(note.textContent).toMatch(/enforces these levels for agents that connect over MCP/);
    expect(note.textContent).toMatch(/shell access, such as Claude Code, can read the disk/);
    expect(note.textContent).toMatch(/curl/);
  });

  it('shows why a folder can’t be added', async () => {
    render(<SettingsPage />);
    const section = await region();
    fireEvent.change(within(section).getByLabelText('Folder path'), {
      target: { value: '/Users/me/nope' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Add folder' }));
    expect((await within(section).findByRole('alert')).textContent).toBe(
      'No folder at /Users/me/nope',
    );
  });

  it('changes the level, renames and removes a folder', async () => {
    folders = [
      folderStatus({ id: 'root_abc123', path: '/Users/me/Tax', label: 'Tax', level: 'details' }),
    ];
    render(<SettingsPage />);
    const section = await region();
    const row = await within(section).findByRole('listitem', { name: 'Tax' });

    fireEvent.change(within(row).getByLabelText('What agents see in Tax'), {
      target: { value: 'contents' },
    });
    await within(section).findByText(/no Claude Code rule to add/);
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({
      url: '/api/settings/folders/root_abc123',
      method: 'PATCH',
      body: { level: 'contents' },
    });

    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    fireEvent.change(within(row).getByLabelText('Folder name'), { target: { value: 'Taxes' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    const renamed = await within(section).findByRole('listitem', { name: 'Taxes' });

    fireEvent.click(within(renamed).getByRole('button', { name: 'Remove' }));
    expect(renamed.textContent).toMatch(/stay in their projects and show as missing/);
    fireEvent.click(within(renamed).getByRole('button', { name: 'Remove folder' }));
    await within(section).findByText('No folders yet.');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
