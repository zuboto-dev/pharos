import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ViewData, type Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { changesSince, handedBackLines } from './changes.js';
import { createView, getView, updateView } from './service.js';

// Handing a finished review document back: the owner archives it with `handedBack` in one
// revision; agents see it in changes_since and in project_snapshot's `handedBack` until they
// have looked. Made-up data only.

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };
const MESSAGE = 'Archive “Garden review”: all 2 answered — over to Opus 5.5';

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(agent, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Water beds' } },
    ],
  });
  const projectId = created.p!;
  const doc = {
    blocks: [
      {
        kind: 'sheet',
        id: 'beds',
        title: 'Beds',
        time: '2 min',
        blocks: [{ kind: 'block', id: 'list', node: { component: 'TaskChecklist' } }],
      },
    ],
  };
  const viewId = createView(store, agent, {
    projectId,
    name: 'Garden review',
    message: 'Review',
    doc,
  }).view.id;
  // The agent has caught up to here.
  changesSince(store, agent.name, projectId);
  return { store, projectId, viewId };
}

const handBack = (store: Store, viewId: string) =>
  store.apply(me, {
    message: MESSAGE,
    operations: [
      {
        op: 'update',
        type: 'view',
        id: viewId,
        data: { archived: true, handedBack: { to: 'Opus 5.5', answered: 2 } },
      },
    ],
  });

describe('handing a review document back', () => {
  it('the schema accepts archived and handedBack, and only a well-formed hand-back', () => {
    const base = { projectId: 'p', name: 'R', pinned: false, order: 0 };
    expect(
      ViewData.safeParse({ ...base, archived: true, handedBack: { to: 'Opus 5.5', answered: 3 } })
        .success,
    ).toBe(true);
    expect(
      ViewData.safeParse({ ...base, archived: true, handedBack: { answered: 1 } }).success,
    ).toBe(true);
    expect(ViewData.safeParse({ ...base, handedBack: { to: 'x' } }).success).toBe(false);
    expect(ViewData.safeParse({ ...base, handedBack: { answered: -1 } }).success).toBe(false);
  });

  it('changes_since shows the revision as it says; the snapshot line lasts until the agent looks', () => {
    const { store, projectId, viewId } = setup();
    expect(handedBackLines(store, agent.name, projectId)).toEqual([]);
    handBack(store, viewId);
    expect(handedBackLines(store, agent.name, projectId)).toEqual([
      `“Garden review” (${viewId}): the owner answered all 2 and archived it, handed back to you. Read the answers with view_get.`,
    ]);
    // Another agent reads whom it went to.
    expect(handedBackLines(store, 'Codex', projectId)[0]).toContain('handed back to Opus 5.5');
    const changes = changesSince(store, agent.name, projectId);
    expect(changes.revisions).toEqual([
      expect.objectContaining({
        author: 'human:me',
        message: MESSAGE,
        changes: [expect.objectContaining({ op: 'update', type: 'view', id: viewId })],
      }),
    ]);
    expect(changes.revisions[0]!.changes[0]!.fields).toEqual(
      expect.arrayContaining(['archived', 'handedBack']),
    );
    expect(handedBackLines(store, agent.name, projectId)).toEqual([]);
    // view_get says so too.
    expect(getView(store, viewId)).toMatchObject({
      archived: true,
      handedBack: { to: 'Opus 5.5', answered: 2 },
    });
  });

  it('a plain archive is no hand-back, and restoring ends it', () => {
    const { store, projectId, viewId } = setup();
    store.apply(me, {
      message: 'Archive view “Garden review”',
      operations: [{ op: 'update', type: 'view', id: viewId, data: { archived: true } }],
    });
    expect(handedBackLines(store, agent.name, projectId)).toEqual([]);
    handBack(store, viewId);
    updateView(store, agent, { viewId, archived: false, message: 'Back to work' });
    expect(store.getOfType('view', viewId).data.handedBack).toBeUndefined();
    expect(handedBackLines(store, agent.name, projectId)).toEqual([]);
  });

  it('project_snapshot over MCP lists it under handedBack', async () => {
    const { store, projectId, viewId } = setup();
    handBack(store, viewId);
    const app = createApp(store);
    const client = new Client({ name: 'Opus 5.5', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    const result = (await client.callTool({
      name: 'project_snapshot',
      arguments: { projectId },
    })) as CallToolResult;
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const snapshot = JSON.parse(text);
    expect(snapshot.handedBack).toEqual([expect.stringContaining('handed back to you')]);
    expect(snapshot.unseenChanges).toBe(1);
  });
});
