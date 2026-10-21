import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectAgent } from './ConnectAgent';

const URL = 'http://localhost:4317/mcp';
afterEach(cleanup);

function panelText() {
  return screen.getByRole('tabpanel').textContent ?? '';
}

describe('connect an agent', () => {
  it('builds each client’s snippet from the given URL, each with a copy button', () => {
    render(<ConnectAgent mcpUrl={URL} />);
    expect(panelText()).toContain(`claude mcp add --transport http pharos ${URL}`);
    expect(screen.getByRole('button', { name: 'Copy Claude Code command' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Claude Desktop' }));
    expect(panelText()).toContain('claude_desktop_config.json');
    expect(panelText()).toMatch(
      /"command": "npx",\s+"args": \[\s+"-y",\s+"mcp-remote",\s+"([^"]+)"/,
    );
    expect(panelText().match(/"mcp-remote",\s+"([^"]+)"/)?.[1]).toBe(URL);
    expect(panelText()).toContain('public HTTPS');
    expect(screen.getByRole('button', { name: 'Copy Claude Desktop config' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Codex CLI' }));
    expect(panelText()).toContain(`codex mcp add pharos --url ${URL}`);
    expect(panelText()).toContain(`[mcp_servers.pharos]\nurl = "${URL}"`);
    expect(screen.getByRole('button', { name: 'Copy Codex command' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Codex config' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'ChatGPT' }));
    expect(panelText()).toContain('Settings → MCP servers → Add server');
    expect(panelText()).toContain(URL);
    expect(panelText()).toContain('Chats on chatgpt.com can’t use this Pharos');
    expect(panelText()).toContain('public HTTPS address');
    expect(screen.getByRole('button', { name: 'Copy ChatGPT server URL' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Other' }));
    expect(panelText()).toContain(`"url": "${URL}"`);
  });

  it('moves between clients with the arrow keys', () => {
    render(<ConnectAgent mcpUrl={URL} />);
    const first = screen.getByRole('tab', { name: 'Claude Code' });
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const desktop = screen.getByRole('tab', { name: 'Claude Desktop' });
    expect(desktop.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(desktop);
    fireEvent.keyDown(desktop, { key: 'End' });
    const other = screen.getByRole('tab', { name: 'Other' });
    expect(other.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the first run compact: Claude Code first, the rest behind "Other agents"', () => {
    render(<ConnectAgent mcpUrl={URL} compact />);
    expect(screen.getByRole('button', { name: 'Copy Claude Code command' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    const more = screen.getByRole('button', { name: /Other agents/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Claude Code' })).toBeNull();
    expect(panelText()).toContain('claude_desktop_config.json');
    fireEvent.click(screen.getByRole('tab', { name: 'ChatGPT' }));
    expect(panelText()).toContain('Chats on chatgpt.com can’t use this Pharos');
  });
});
