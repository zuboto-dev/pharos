// R7.11 files as widgets: FileView and FileList's showIn in previews and agent guidance · Opus 5.5
// Every folder, file and name here is made up; nothing touches the disk.
import { Board, FOLDERS_SETTING, type Author, type FileFolder } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { VIEW_GUIDELINES, answerBrief } from '../guidance.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { createView, previewView } from './service.js';

const human: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const folders: FileFolder[] = [
    {
      id: 'root_company1',
      path: '/Volumes/Example/Company',
      label: 'Company',
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
  const file = (ref: string, rootId: string, path: string, title: string) => ({
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
      mimeType: 'application/pdf',
    },
  });
  // Only the owner adds files.
  const { created } = store.apply(human, {
    message: 'Add the papers',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } },
      file('cert', 'root_company1', 'Registration/certificate.pdf', 'certificate'),
      file('tax', 'root_company1', 'Registration/tax-letter.pdf', 'tax letter'),
      file('secret', 'root_private1', 'Vault/plan.pdf', 'Hidden plan'),
    ],
  });
  return { store, ids: created as Record<'p' | 'cert' | 'tax' | 'secret', string> };
}

const warningsOf = (
  preview: Pick<ReturnType<typeof previewView>, 'widgets' | 'layout' | 'warnings'>,
) => [
  ...preview.warnings,
  ...preview.layout,
  ...preview.widgets.flatMap((w) => w.warnings.map((m) => `${w.id}: ${m}`)),
];

describe('FileView and FileList in previews', () => {
  it('says which file a FileView shows, and warns when it is missing, hidden or unset', () => {
    const { store, ids } = setup();
    store.apply(agent, {
      message: 'Fill in the certificate',
      operations: [
        {
          op: 'update',
          type: 'file',
          id: ids.cert,
          data: {
            title: 'Business registration certificate',
            kind: 'certificate',
            issuer: 'Example Registry',
            issuedDate: '2024-03-01',
            tags: ['business-registration'],
          },
        },
      ],
    });
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [
        { id: 'ok', w: 6, node: { component: 'FileView', file: ids.cert, size: 'compact' } },
        { id: 'gone', w: 6, node: { component: 'FileView', file: 'file_doesnotexist' } },
        { id: 'hidden', w: 6, node: { component: 'FileView', file: ids.secret } },
        { id: 'unset', w: 6, node: { component: 'FileView' } },
      ],
    });
    const [ok, gone, hidden, unset] = preview.widgets;
    expect(ok!.warnings).toEqual([]);
    expect(ok!.shows).toContain('“Business registration certificate” (Certificate');
    expect(ok!.shows).toContain('Example Registry');
    expect(gone!.warnings[0]).toMatch(/file file_doesnotexist not found in this project/);
    // A hidden file reads exactly like a missing one: agents never learn it exists.
    expect(hidden!.warnings[0]).toBe(gone!.warnings[0]!.replace('file_doesnotexist', ids.secret));
    expect(JSON.stringify(preview)).not.toContain('Hidden plan');
    expect(unset!.warnings[0]).toMatch(/^no file: set `file`/);
    expect(unset!.empty).toBe(true);
  });

  it('checks that showIn names a FileView on the same board', () => {
    const { store, ids } = setup();
    const list = (showIn: string) => ({
      component: 'FileList' as const,
      filter: { where: { tags: 'business-registration' } },
      showIn,
    });
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [
        { id: 'a', w: 6, node: list('viewer') },
        { id: 'viewer', w: 6, node: { component: 'FileView', file: ids.cert } },
        { id: 'b', w: 6, node: list('nowhere') },
        { id: 'c', w: 6, node: list('a') },
      ],
    });
    const byId = Object.fromEntries(preview.widgets.map((w) => [w.id, w]));
    expect(byId.a!.warnings).toEqual([]);
    expect(byId.a!.shows).toBe('No files match (shows an empty state)');
    expect(byId.b!.warnings[0]).toMatch(/showIn "nowhere" is not a widget on this board/);
    expect(byId.c!.warnings[0]).toMatch(/showIn "a" is a FileList, not a FileView/);
  });

  it('counts the files a FileList shows, without hidden ones', () => {
    const { store, ids } = setup();
    const preview = previewView(store, {
      projectId: ids.p,
      widgets: [{ id: 'all', node: { component: 'FileList' } }],
    });
    expect(preview.widgets[0]!.shows).toBe('2 files: “certificate”, “tax letter”');
  });
});

describe('document sets guidance', () => {
  it('teaches agents to tag files, fill their details and compose one view', () => {
    const section = VIEW_GUIDELINES.slice(VIEW_GUIDELINES.indexOf('## Document sets'));
    for (const words of ['kind', 'issuer', 'issuedDate', 'expiryDate', 'showIn', 'FileView'])
      expect(section).toContain(words);
    expect(section).toMatch(/can't add, remove or move files/);
    const { store, ids } = setup();
    expect(answerBrief(store, [ids.p])).toContain('Document sets');
  });

  it('its example board passes its own checks once the ids are real', () => {
    const { store, ids } = setup();
    store.apply(agent, {
      message: 'Tag the registration papers',
      operations: [ids.cert, ids.tax].map((id) => ({
        op: 'update' as const,
        type: 'file' as const,
        id,
        data: { tags: ['business-registration'], kind: 'certificate', issuer: 'Example Registry' },
      })),
    });
    const section = VIEW_GUIDELINES.slice(VIEW_GUIDELINES.indexOf('## Document sets'));
    const json = section.slice(section.indexOf('[{'), section.indexOf('}}]') + 3);
    const widgets = JSON.parse(
      json.replaceAll('<certificate file id>', ids.cert).replaceAll('<YYYY-MM-DD>', '2026-10-12'),
    ) as unknown[];
    expect(Board.safeParse({ component: 'Board', widgets }).success).toBe(true);
    const preview = previewView(store, { projectId: ids.p, widgets });
    expect(warningsOf(preview)).toEqual([]);
    // Saved by an agent, the same board keeps no warnings either.
    const saved = createView(store, agent, {
      projectId: ids.p,
      name: 'Registration',
      message: 'A view for the registration papers',
      widgets,
    });
    expect(warningsOf(saved.preview)).toEqual([]);
  });
});
