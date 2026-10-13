// R7.1 contract: the file entity, folders, file types and routes · Opus 5.5
// Every path and name here is made up; no test reads the owner's documents.
import { describe, expect, it } from 'vitest';
import { ArtifactData, ENTITIES, FileData, createSchema, patchSchema } from './entities.js';
import {
  AGENT_FILE_FIELDS,
  AddFilesInput,
  FILE_ROUTES,
  FileFolders,
  FilePath,
  FolderCreateInput,
  FolderPath,
  FolderUpdateInput,
  SCAN_FILE_FIELDS,
  fileTypeOf,
  fileUrl,
  folderContains,
} from './files.js';
import { OPTION_FIELDS, defaultOptions, meaningOf, valueFor } from './options.js';
import { applyInputFor } from './revisions.js';
import { COMPONENT_INFO } from './views/catalog-info.js';
import { ViewNode } from './views/catalog.js';
import { runQuery } from './views/run-query.js';
import type { ProjectDataset } from './views/query.js';

const file = {
  projectId: 'prj_1',
  title: 'Office lease',
  rootId: 'root_abc123',
  path: 'Company/office-lease.pdf',
  size: 1234,
  modifiedAt: '2026-09-01T10:00:00.000Z',
  kind: 'contract',
  tags: ['company'],
  taskIds: [],
};

describe('file entity', () => {
  it('stores where a file is and its details, with defaults for kind, tags and tasks', () => {
    expect(FileData.safeParse(file).success).toBe(true);
    const full = {
      ...file,
      sha256: 'a'.repeat(64),
      mimeType: 'application/pdf',
      issuer: 'Sample Properties LLC',
      issuedDate: '2025-01-15',
      expiryDate: '2026-12-31',
      notes: 'Renew in **November**',
    };
    expect(FileData.safeParse(full).success).toBe(true);
    expect(FileData.safeParse({ ...full, sha256: 'not-a-hash' }).success).toBe(false);
    expect(FileData.safeParse({ ...full, expiryDate: '31/12/2026' }).success).toBe(false);
    expect(FileData.safeParse({ ...full, size: -1 }).success).toBe(false);
    expect(FileData.safeParse({ ...full, rootId: '/Users/someone' }).success).toBe(false);
    const minimal = { ...file } as Partial<typeof file>;
    delete minimal.kind;
    delete minimal.tags;
    delete minimal.taskIds;
    expect(createSchema('file').safeParse(minimal).success).toBe(true);
    expect(ENTITIES.file.defaults).toEqual({ kind: 'other', tags: [], taskIds: [] });
    expect(ENTITIES.file.refs.taskIds).toEqual({ type: 'task', many: true, onDelete: 'unset' });
  });

  it('only accepts a path inside its folder, never a dotfile or a way out', () => {
    for (const ok of ['a.pdf', 'Company/2026/lease v2.pdf', 'Ünïcode/収据.pdf'])
      expect(FilePath.safeParse(ok).success, ok).toBe(true);
    for (const bad of [
      '',
      '/abs/file.pdf',
      '../secret.pdf',
      'a/../../b.pdf',
      'a/./b.pdf',
      'a//b.pdf',
      'a/',
      '.env',
      'keys/.ssh/id_rsa',
      'Company/.hidden.pdf',
      'a\\b.pdf',
      'a\u0000b.pdf',
    ])
      expect(FilePath.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('lets an artifact point at a file, unset when the file is deleted', () => {
    const artifact = { projectId: 'prj_1', title: 'Lease', kind: 'file', status: 'delivered' };
    expect(ArtifactData.safeParse({ ...artifact, fileId: 'file_1' }).success).toBe(true);
    expect(ENTITIES.artifact.refs.fileId).toEqual({ type: 'file', onDelete: 'unset' });
  });

  it('has a file kind option field whose defaults code reads by meaning', () => {
    expect(OPTION_FIELDS['file.kind'].meanings).toEqual([
      'statement',
      'receipt',
      'contract',
      'certificate',
      'manual',
      'audio',
      'other',
    ]);
    expect(defaultOptions('file.kind').map((o) => o.label)).toContain('Certificate');
    const project = {
      data: {
        options: {
          'file.kind': [
            { value: 'tax_form', label: 'Tax form', meaning: 'statement' as const },
            { value: 'misc', label: 'Misc', meaning: 'other' as const },
          ],
        },
      },
    };
    expect(meaningOf(project, 'file.kind', 'tax_form')).toBe('statement');
    expect(valueFor(project, 'file.kind', 'other')).toBe('misc');
  });

  it('marks which fields the scan owns and which agents see', () => {
    const fields = Object.keys(FileData.shape);
    for (const f of [...SCAN_FILE_FIELDS, ...AGENT_FILE_FIELDS]) expect(fields).toContain(f);
    // Agents never see where a file is on disk.
    for (const f of ['rootId', 'path', 'sha256', 'notes'])
      expect(AGENT_FILE_FIELDS as readonly string[]).not.toContain(f);
  });

  it('gives agents an apply schema that only updates file details', () => {
    const agent = applyInputFor(['file'], { file: SCAN_FILE_FIELDS });
    const op = (o: object) => agent.safeParse({ message: 'm', operations: [o] }).success;
    expect(op({ op: 'update', type: 'file', id: 'file_1', data: { issuer: 'Demo Bank' } })).toBe(
      true,
    );
    expect(op({ op: 'update', type: 'file', id: 'file_1', data: { path: 'x.pdf' } })).toBe(false);
    expect(op({ op: 'create', type: 'file', data: file })).toBe(false);
    expect(op({ op: 'delete', type: 'file', id: 'file_1' })).toBe(false);
    // The full schema (the web app, the add route) still creates files.
    expect(patchSchema('file').shape).toHaveProperty('path');
    expect(
      applyInputFor(['file']).safeParse({
        message: 'm',
        operations: [{ op: 'create', type: 'file', data: file }],
      }).success,
    ).toBe(true);
  });
});

describe('folders', () => {
  const folder = (id: string, path: string, level = 'details') => ({
    id,
    path,
    label: 'Company',
    level,
    addedAt: '2026-10-12T10:00:00.000Z',
  });

  it('takes absolute folder paths with a level, and refuses nested or repeated folders', () => {
    expect(FolderPath.safeParse('/Users/someone/Documents/Company').success).toBe(true);
    for (const bad of ['relative/dir', '/a/', '/a/../b', '/a/./b', '/a//b'])
      expect(FolderPath.safeParse(bad).success, bad).toBe(false);
    expect(
      FileFolders.safeParse([
        folder('root_aaaaaa', '/x/Company'),
        folder('root_bbbbbb', '/x/Company2', 'hidden'),
      ]).success,
    ).toBe(true);
    // A hidden folder inside a contents folder could be read through its parent.
    expect(
      FileFolders.safeParse([
        folder('root_aaaaaa', '/x/Company', 'contents'),
        folder('root_bbbbbb', '/x/Company/Private', 'hidden'),
      ]).success,
    ).toBe(false);
    expect(
      FileFolders.safeParse([folder('root_aaaaaa', '/x/a'), folder('root_aaaaaa', '/x/b')]).success,
    ).toBe(false);
    expect(FileFolders.safeParse([folder('root_aaaaaa', '/x/a', 'public')]).success).toBe(false);
    expect(folderContains('/x/Company', '/x/Company2')).toBe(false);
    expect(folderContains('/x/Company', '/x/Company/a')).toBe(true);
  });

  it('adds a folder with an optional label and level, and changes only label or level', () => {
    expect(FolderCreateInput.parse({ path: '/x/Company' })).toEqual({ path: '/x/Company' });
    expect(FolderCreateInput.safeParse({ path: '/x', level: 'everything' }).success).toBe(false);
    expect(FolderUpdateInput.safeParse({ level: 'contents' }).success).toBe(true);
    expect(FolderUpdateInput.safeParse({}).success).toBe(false);
    expect(FolderUpdateInput.safeParse({ path: '/elsewhere' }).success).toBe(false);
  });
});

describe('file types and routes', () => {
  it('previews only allowlisted types and never shows HTML or SVG inline', () => {
    expect(fileTypeOf('a/Lease.PDF')).toMatchObject({ mime: 'application/pdf', preview: 'pdf' });
    expect(fileTypeOf('notes.md').preview).toBe('markdown');
    for (const name of ['page.html', 'logo.svg', 'run.sh', 'App.app', 'tool.command', 'noext'])
      expect(fileTypeOf(name), name).toEqual({
        mime: 'application/octet-stream',
        preview: 'none',
        open: false,
      });
  });

  it('builds file URLs from ids only', () => {
    expect(fileUrl('content', 'file_1')).toBe('/api/files/file_1/content');
    expect(fileUrl('info', 'file_1')).toBe('/api/files/file_1');
    expect(fileUrl('download', 'a/../b')).toBe('/api/files/a%2F..%2Fb/download');
    for (const route of Object.values(FILE_ROUTES)) expect(route).not.toMatch(/:path\b/);
  });

  it('adds files from the scan by folder and path, at most 200 at once', () => {
    const entry = { rootId: 'root_abc123', path: 'Company/lease.pdf' };
    expect(AddFilesInput.safeParse({ files: [entry] }).success).toBe(true);
    expect(AddFilesInput.safeParse({ files: [{ ...entry, path: '../x' }] }).success).toBe(false);
    expect(AddFilesInput.safeParse({ files: [] }).success).toBe(false);
  });
});

describe('FileList', () => {
  it('has guidance, a valid example and props for grouping, controls and details', () => {
    expect(ViewNode.safeParse(COMPONENT_INFO.FileList.example).success).toBe(true);
    const ok = (node: object) => ViewNode.safeParse({ component: 'FileList', ...node }).success;
    expect(ok({ groupBy: 'none', controls: [], details: ['size', 'tags'] })).toBe(true);
    expect(ok({ controls: ['search', 'kind', 'tag', 'issuer', 'expiry'] })).toBe(true);
    expect(ok({ groupBy: 'issuer' })).toBe(false);
    expect(ok({ controls: ['path'] })).toBe(false);
    expect(ok({ details: ['path'] })).toBe(false);
  });

  it('queries files by kind meaning and expiry, and artifacts by their file', () => {
    const entity = (id: string, data: object) => ({
      id,
      type: 'file' as const,
      data: { ...file, ...data },
      createdAt: '',
      updatedAt: '',
      createdRev: 1,
      updatedRev: 1,
    });
    const data = {
      project: { id: 'prj_1', data: { name: 'P', status: 'active', order: 0 } },
      assignees: [],
      goals: [],
      stages: [],
      tasks: [],
      files: [
        entity('file_a', { kind: 'contract', expiryDate: '2026-11-01' }),
        entity('file_b', { kind: 'receipt' }),
      ],
      artifacts: [
        {
          id: 'art_1',
          type: 'artifact',
          data: {
            projectId: 'prj_1',
            title: 'A',
            kind: 'file',
            status: 'delivered',
            fileId: 'file_a',
          },
        },
      ],
    } as unknown as ProjectDataset;
    const today = { today: '2026-10-12' };
    expect(
      runQuery(data, 'file', { where: { expiryDate: { lte: '$today+30d' } } }, today).map(
        (f) => f.id,
      ),
    ).toEqual(['file_a']);
    expect(runQuery(data, 'file', { where: { kind: 'receipt' } }).map((f) => f.id)).toEqual([
      'file_b',
    ]);
    expect(
      runQuery(data, 'artifact', { where: { 'file.kind': 'contract' } }).map((a) => a.id),
    ).toEqual(['art_1']);
  });
});
