// R9 packs over MCP: pack_list carries the pack guide, each new pack applies in one revision and
// its page passes the query checks, and the guide is enough to name every record field · Opus 5.5
// Made-up data only.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PACKS, PACK_GUIDE } from '@pharos/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';

let store: Store;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  app = createApp(store);
});

async function connect() {
  const client = new Client({ name: 'Opus 5.5', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return {
    error: result.isError ? text : undefined,
    value: result.isError ? null : JSON.parse(text),
  };
}

describe('the pack guide', () => {
  it('comes with pack_list and as a resource', async () => {
    const client = await connect();
    const { value } = await call(client, 'pack_list', {});
    expect(value.guide).toBe(PACK_GUIDE);
    expect(value.packs.map((p: { key: string }) => p.key)).toEqual([
      'car',
      'money',
      'music',
      'study',
      'company',
    ]);
    const resource = await client.readResource({ uri: 'pharos://guide/packs' });
    expect((resource.contents[0] as { text: string }).text).toBe(PACK_GUIDE);
  });

  it('covers every step and names every record field of every pack', () => {
    for (const step of [
      'pack_apply',
      'folder_request',
      'files_unadded',
      'view_update',
      'view_preview',
      'onePer',
      'Query checks',
      'Fact checks',
    ])
      expect(PACK_GUIDE, step).toContain(step);
    for (const pack of PACKS) {
      expect(PACK_GUIDE).toContain(`(\`${pack.key}\`)`);
      for (const type of pack.recordTypes)
        for (const field of type.fields) expect(PACK_GUIDE).toContain(`${field.key} (`);
    }
  });
});

describe('R9 packs', () => {
  for (const key of ['music', 'study', 'company']) {
    it(`${key}: applies in one revision with examples, and its page has no query findings`, async () => {
      const client = await connect();
      const applied = await call(client, 'pack_apply', {
        pack: key,
        name: `${key} (test)`,
        examples: true,
      });
      expect(applied.error).toBeUndefined();
      expect(applied.value.warnings ?? []).toEqual([]);
      const [view] = applied.value.views;
      const preview = await call(client, 'view_preview', { viewId: view.id });
      expect(preview.value.findings ?? []).toEqual([]);
      const shown = JSON.stringify(preview.value.widgets);
      expect(shown).not.toMatch(/Unknown component/);
      // One revert undoes the whole pack.
      const revert = await call(client, 'history_revert', {
        revision: applied.value.revision,
        message: 'Undo the test pack',
      });
      expect(revert.error).toBeUndefined();
      expect(store.list('project').filter((p) => p.data.name === `${key} (test)`)).toEqual([]);
    });
  }

  it('music: the page plays the latest mix of each song once a mix points at an audio file', async () => {
    const client = await connect();
    const { value } = await call(client, 'pack_apply', {
      pack: 'music',
      name: 'Band',
      examples: true,
    });
    const preview = await call(client, 'view_preview', { viewId: value.views[0].id });
    const latest = preview.value.widgets.find((w: { id: string }) => w.id === 'latest');
    // Night Bus has two mixes; only the newest is listed (three songs have a mix).
    expect(latest.shows).toMatch(/^3 records: “Night Bus mix 2”/);
  });

  it('refuses a record that misses a required field, saying which', async () => {
    const client = await connect();
    const { value } = await call(client, 'pack_apply', { pack: 'study', name: 'Term' });
    const refused = await call(client, 'apply', {
      message: 'Log a session',
      operations: [
        {
          op: 'create',
          type: 'record',
          data: {
            projectId: value.projectId,
            recordType: 'session',
            title: 'Reading',
            fields: { date: '2026-10-12', hours: 1 },
          },
        },
      ],
    });
    expect(refused.error).toMatch(/subject/);
  });
});
