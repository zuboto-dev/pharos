// R7.13 Gallery: previews, warnings, agents and pictures from hidden folders · Opus 5.5
// Every folder, file, address and name here is made up; nothing touches the disk or the network.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FOLDERS_SETTING, type Author, type FileFolder } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { VIEW_GUIDELINES, answerBrief } from '../guidance.js';
import { AgentFiles } from '../store/agent-files.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { previewView } from './service.js';

const human: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const folders: FileFolder[] = [
    {
      id: 'root_shots1',
      path: '/Volumes/Example/Shots',
      label: 'Shots',
      level: 'details',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'root_private1',
      path: '/Volumes/Example/Private',
      label: 'Private',
      level: 'hidden',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
  ];
  store.setSetting(FOLDERS_SETTING, folders);
  const file = (ref: string, rootId: string, path: string, title: string, tags: string[]) => ({
    op: 'create' as const,
    type: 'file' as const,
    ref,
    data: {
      projectId: '$p',
      title,
      rootId,
      path,
      size: 900,
      modifiedAt: '2026-09-01T10:00:00.000Z',
      mimeType: 'image/png',
      tags,
    },
  });
  // Only the owner adds files.
  const { created } = store.apply(human, {
    message: 'Add the screenshots',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Example research' } },
      file('cards', 'root_shots1', 'ui/card-layout.png', 'Card layout', ['ui']),
      file('stepper', 'root_shots1', 'ui/stepper.png', 'Stepper', ['ui']),
      file('notes', 'root_shots1', 'ui/notes.pdf', 'Notes', ['ui']),
      file('secret', 'root_private1', 'Vault/secret.png', 'Hidden mock-up', []),
    ],
  });
  return {
    store,
    ids: created as Record<'p' | 'cards' | 'stepper' | 'notes' | 'secret', string>,
  };
}

const warningsOf = (
  preview: Pick<ReturnType<typeof previewView>, 'widgets' | 'layout' | 'warnings'>,
) => [
  ...preview.warnings,
  ...preview.layout,
  ...preview.widgets.flatMap((w) => w.warnings.map((m) => `${w.id}: ${m}`)),
];

describe('Gallery in previews', () => {
  it('describes the pictures and stays quiet when they are fine', () => {
    const { store, ids } = setup();
    store.apply(agent, {
      message: 'Store two UI examples',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          data: {
            projectId: ids.p,
            title: 'Card layout',
            image: ids.cards,
            alt: 'Three cards in a row, each with a picture and a title',
            tags: ['ui-examples'],
          },
        },
        {
          op: 'create',
          type: 'artifact',
          data: {
            projectId: ids.p,
            title: 'Stepper',
            image: 'https://images.example.com/stepper.png',
            alt: 'Four numbered steps joined by a line',
            uri: 'https://www.example.org/patterns/stepper',
            tags: ['ui-examples'],
          },
        },
      ],
    });
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [
        {
          id: 'pictures',
          node: {
            component: 'Gallery',
            artifacts: { where: { tags: 'ui-examples' } },
            layout: 'compare',
          },
        },
      ],
    });
    expect(warningsOf(preview)).toEqual([]);
    const shows = preview.widgets[0]!.shows;
    expect(shows).toContain('2 pictures as a side-by-side comparison');
    expect(shows).toContain('“Stepper” (example.org)');
    expect(shows).toContain('“Card layout” (project file)');
    expect(preview.widgets[0]!.empty).toBe(false);
  });

  it('warns about no matching pictures, missing alt text and images that are not https', () => {
    const { store, ids } = setup();
    const { created } = store.apply(human, {
      message: 'Examples',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'plain',
          data: { projectId: ids.p, title: 'Plain http', image: 'http://example.com/a.png' },
        },
        {
          op: 'create',
          type: 'artifact',
          ref: 'local',
          data: {
            projectId: ids.p,
            title: 'Local',
            image: 'https://127.0.0.1/a.png',
            alt: 'A screenshot',
          },
        },
        {
          op: 'create',
          type: 'artifact',
          ref: 'none',
          data: { projectId: ids.p, title: 'No picture', tags: ['x'] },
        },
      ],
    });
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [
        {
          id: 'empty',
          node: { component: 'Gallery', artifacts: { where: { tags: 'nothing-here' } } },
        },
        { id: 'unchosen', node: { component: 'Gallery' } },
        {
          id: 'bad',
          node: {
            component: 'Gallery',
            artifacts: { where: { title: ['Plain http', 'Local', 'No picture'] } },
            highlight: ['art_nothere'],
          },
        },
      ],
    });
    const warnings = warningsOf(preview);
    expect(preview.widgets[0]!.empty).toBe(true);
    expect(warnings).toContainEqual(expect.stringMatching(/^empty: no matching pictures/));
    expect(warnings).toContainEqual(expect.stringMatching(/^unchosen: no pictures chosen/));
    expect(warnings).toContainEqual(
      expect.stringMatching(new RegExp(`^bad: missing alt text on ${created.plain}`)),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining(`the image of ${created.plain} isn't shown because it isn't https`),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining(`the image of ${created.local} isn't shown because it points at`),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining(`1 artifact without an image is left out: “No picture”`),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining('highlight art_nothere matches no picture'),
    );
  });

  it('checks files: pictures only, files in the project, compare needs two', () => {
    const { store, ids } = setup();
    store.apply(human, {
      message: 'Examples',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          data: { projectId: ids.p, title: 'Notes as a picture', image: ids.notes, alt: 'Notes' },
        },
        {
          op: 'create',
          type: 'artifact',
          data: { projectId: ids.p, title: 'Gone', image: 'file_000000000000', alt: 'Gone' },
        },
      ],
    });
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [
        {
          id: 'files',
          node: {
            component: 'Gallery',
            files: { where: { tags: 'ui' } },
            layout: 'compare',
            columns: 3,
          },
        },
        {
          id: 'arts',
          node: {
            component: 'Gallery',
            artifacts: { where: { title: ['Notes as a picture', 'Gone'] } },
            max: 1,
          },
        },
      ],
    });
    const warnings = warningsOf(preview);
    // Two of the three tagged files are pictures: compare is satisfied, the PDF is left out.
    expect(preview.widgets[0]!.shows).toContain('2 pictures');
    expect(warnings).toContainEqual(expect.stringMatching(/^files: 1 file isn't a picture/));
    expect(warnings).toContainEqual(expect.stringMatching(/^files: columns applies to layout/));
    expect(warnings).not.toContainEqual(expect.stringMatching(/^files: layout "compare"/));
    expect(warnings).toContainEqual(expect.stringContaining("which isn't a picture"));
    // An id agents can't resolve reads as no image (it may be a hidden file).
    expect(warnings).toContainEqual(
      expect.stringMatching(/^arts: 1 artifact without an image is left out: “Gone”/),
    );
    const capped = previewView(store, {
      projectId: ids.p,
      widgets: [
        { id: 'capped', node: { component: 'Gallery', files: { where: { tags: 'ui' } }, max: 1 } },
      ],
    });
    expect(warningsOf(capped)).toContainEqual(
      expect.stringMatching(/^capped: 1 more picture matches but is left out by max 1/),
    );
    const compareOne = previewView(store, {
      projectId: ids.p,
      widgets: [
        {
          id: 'one',
          node: { component: 'Gallery', files: { where: { id: ids.cards } }, layout: 'compare' },
        },
      ],
    });
    expect(warningsOf(compareOne)).toContainEqual(
      expect.stringContaining('layout "compare" sets two pictures side by side, but 1 picture'),
    );
    // A picture from another project's files.
    const other = store.apply(human, {
      message: 'Another project',
      operations: [
        { op: 'create', type: 'project', ref: 'q', data: { name: 'Other' } },
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: {
            projectId: '$q',
            title: 'Elsewhere',
            rootId: 'root_shots1',
            path: 'other/elsewhere.png',
            size: 10,
            modifiedAt: '2026-09-01T10:00:00.000Z',
            mimeType: 'image/png',
          },
        },
      ],
    });
    store.apply(human, {
      message: 'Point at it',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          data: { projectId: ids.p, title: 'Elsewhere', image: other.created.f!, alt: 'Elsewhere' },
        },
      ],
    });
    const elsewhere = previewView(store, {
      projectId: ids.p,
      widgets: [
        {
          id: 'away',
          node: { component: 'Gallery', artifacts: { where: { title: 'Elsewhere' } } },
        },
      ],
    });
    expect(warningsOf(elsewhere)).toContainEqual(
      expect.stringContaining(`is file ${other.created.f}, which is not in this project`),
    );
  });
});

describe('Gallery images and what agents see', () => {
  it('refuses image values that are neither an http(s) address nor a file id', () => {
    const { store, ids } = setup();
    for (const image of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/etc/x.png', 'x'])
      expect(() =>
        store.apply(human, {
          message: 'Bad image',
          operations: [
            { op: 'create', type: 'artifact', data: { projectId: ids.p, title: 'X', image } },
          ],
        }),
      ).toThrow(/image/);
  });

  it('never lets agents point at, or see, a picture in a hidden folder', () => {
    const { store, ids } = setup();
    expect(() =>
      store.apply(agent, {
        message: 'Use the hidden mock-up',
        operations: [
          {
            op: 'create',
            type: 'artifact',
            data: { projectId: ids.p, title: 'Mock-up', image: ids.secret, alt: 'A mock-up' },
          },
        ],
      }),
    ).toThrow(/data\.image: .* not found/);
    // The owner may; agents then see the artifact without the image.
    const { created } = store.apply(human, {
      message: 'Owner links the hidden mock-up',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'a',
          data: { projectId: ids.p, title: 'Mock-up', image: ids.secret, alt: 'A mock-up' },
        },
      ],
    });
    const seen = new AgentFiles(store).entity(store.get(created.a!)!);
    expect(seen).not.toBeNull();
    expect(seen!.data).not.toHaveProperty('image');
    const diffs = new AgentFiles(store).diffs(
      store.diff({ from: 0, projectId: ids.p }).filter((d) => d.id === created.a),
    );
    expect(JSON.stringify(diffs)).not.toContain(ids.secret);
    // A web address is kept.
    const web = store.apply(agent, {
      message: 'A web picture',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'w',
          data: {
            projectId: ids.p,
            title: 'Web',
            image: 'https://images.example.com/w.png',
            alt: 'W',
          },
        },
      ],
    });
    expect(new AgentFiles(store).entity(store.get(web.created.w!)!)!.data).toHaveProperty(
      'image',
      'https://images.example.com/w.png',
    );
  });

  it('teaches agents to show visual research as pictures', async () => {
    const { store, ids } = setup();
    expect(VIEW_GUIDELINES).toContain('What it looks like: Gallery');
    expect(VIEW_GUIDELINES).toContain('layout: "compare"');
    // In memory: the app answers the client directly, no port is opened.
    const app = createApp(store);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    expect(client.getInstructions()).toContain('must show its examples as pictures');
    expect(answerBrief(store, [ids.p])).toContain('What it looks like: Gallery');
  });
});
