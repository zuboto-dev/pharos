import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let agent: Record<string, unknown>;
let waiting: unknown[];

beforeEach(() => {
  calls = [];
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
      agent = { ...agent, enabled: (body as { enabled: boolean }).enabled };
      return Response.json(agent);
    }
    if (url === '/api/agent/answer-waiting') return Response.json({ questions: waiting.length });
    if (url.startsWith('/api/entities/request')) return Response.json(waiting);
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
    expect(data.textContent).toContain(
      'claude mcp add --transport http pharos http://localhost:4300/mcp',
    );
  });
});
