import type { ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { GetStarted, LoadError, isEmptyProject } from './onboarding';

const data = dataset as unknown as ProjectDataset;
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('getting started', () => {
  it('counts a project as empty only when nothing is planned', () => {
    expect(isEmptyProject(data)).toBe(false);
    expect(isEmptyProject({ ...data, goals: [], stages: [], tasks: [], scopeItems: [] })).toBe(
      true,
    );
    expect(isEmptyProject({ ...data, goals: [], stages: [], scopeItems: [] })).toBe(false);
    // A pack project (R8) keeps records, not a plan: no "get it planned" panel.
    const pack = {
      ...data,
      goals: [],
      stages: [],
      tasks: [],
      scopeItems: [],
      project: {
        ...data.project,
        data: { ...data.project.data, recordTypes: [{ key: 'bill', name: 'Bill', fields: [] }] },
      },
    } as ProjectDataset;
    expect(isEmptyProject(pack)).toBe(false);
  });

  it('offers the MCP command and a planning prompt naming the project, and stays hidden once dismissed', () => {
    render(<GetStarted projectId="p1" name="Atlas" />);
    const panel = screen.getByRole('region', { name: 'Get started' });
    expect(panel.textContent).toContain(
      'claude mcp add --transport http pharos http://localhost:4300/mcp',
    );
    expect(screen.getByRole('button', { name: /Other agents/ })).toBeTruthy();
    expect(panel.textContent).toContain('Set up the "Atlas" project in Pharos');
    fireEvent.click(screen.getByRole('button', { name: 'Hide getting started' }));
    expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull();
    cleanup();
    render(<GetStarted projectId="p1" name="Atlas" />);
    expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull();
    render(<GetStarted projectId="p2" name="Other" />);
    expect(screen.getByRole('region', { name: 'Get started' })).toBeTruthy();
  });

  it('tells a missing project apart from an unreachable server', () => {
    render(<LoadError notFound what="Project" />);
    expect(screen.getByRole('heading').textContent).toBe('Project not found');
    cleanup();
    render(<LoadError notFound={false} what="Project" />);
    expect(screen.getByRole('heading').textContent).toBe('Can’t reach the Pharos server');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
