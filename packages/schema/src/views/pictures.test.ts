// R7.13 pictures: image address safety, the artifact fields and what a Gallery shows · Opus 5.5
// Every address and name here is made up.
import { describe, expect, it } from 'vitest';
import { ArtifactData, createSchema, type Entity } from '../entities.js';
import { CATALOG } from './catalog.js';
import { galleryContents, isPictureFile } from './gallery.js';
import { hostOf, imageSource, safeImageUrl } from './pictures.js';
import type { ProjectDataset } from './query.js';

describe('image addresses', () => {
  it('loads https pictures from public hosts only', () => {
    expect(safeImageUrl('https://images.example.com/a.png')).toBe(
      'https://images.example.com/a.png',
    );
    for (const unsafe of [
      'http://images.example.com/a.png',
      'https://user:secret@images.example.com/a.png',
      'https://localhost/a.png',
      'https://127.0.0.1:4300/api/files/file_1/content',
      'https://192.168.1.10/a.png',
      'https://10.0.0.2/a.png',
      'https://[::1]/a.png',
      'https://printer.local/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//images.example.com/a.png',
      '/etc/passwd',
      'file:///Users/me/a.png',
      'file_abc123',
      '',
      42,
    ])
      expect(safeImageUrl(unsafe), String(unsafe)).toBeNull();
  });

  it('reads file ids, http(s) addresses and nothing else', () => {
    expect(imageSource('file_0123456789ab')).toEqual({ kind: 'file', fileId: 'file_0123456789ab' });
    expect(imageSource('http://example.com/x.png')).toMatchObject({
      kind: 'url',
      safe: false,
      problem: "it isn't https",
      host: 'example.com',
    });
    expect(imageSource('https://www.example.com/x.png')).toMatchObject({
      kind: 'url',
      safe: true,
      host: 'example.com',
    });
    expect(imageSource('javascript:alert(1)')).toEqual({ kind: 'invalid' });
    expect(imageSource('https://exa mple.com/x.png')).toEqual({ kind: 'invalid' });
    expect(imageSource(`https://example.com/${'a'.repeat(3000)}`)).toEqual({ kind: 'invalid' });
    expect(hostOf('https://www.example.org/patterns')).toBe('example.org');
    expect(hostOf('docs/notes.md')).toBeNull();
  });

  it('stores image, alt and tags on artifacts, refusing unsafe schemes', () => {
    const create = createSchema('artifact');
    const ok = create.safeParse({
      projectId: 'prj_1',
      title: 'Stepper',
      image: 'https://images.example.com/stepper.png',
      alt: 'Four numbered steps',
      tags: ['ui-examples'],
    });
    expect(ok.success).toBe(true);
    expect(
      create.safeParse({ projectId: 'prj_1', title: 'X', image: 'file_0123456789ab' }).success,
    ).toBe(true);
    for (const image of ['javascript:alert(1)', 'data:image/png;base64,AA', 'C:\\a.png', ''])
      expect(create.safeParse({ projectId: 'prj_1', title: 'X', image }).success, image).toBe(
        false,
      );
    expect(ArtifactData.shape.alt.safeParse('x'.repeat(301)).success).toBe(false);
  });
});

describe('galleryContents', () => {
  const entity = <T extends 'artifact' | 'file'>(
    type: T,
    id: string,
    data: Record<string, unknown>,
    order: number,
  ) =>
    ({
      id,
      type,
      data: { projectId: 'prj_1', ...data },
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-13T10:00:00.000Z',
      createdRev: order,
      updatedRev: order,
    }) as unknown as Entity<T>;
  const data = {
    project: entity('artifact', 'prj_1', { name: 'P' }, 0),
    assignees: [],
    goals: [],
    scopeItems: [],
    stages: [],
    tasks: [],
    decisions: [],
    views: [],
    requests: [],
    claims: [],
    terms: [],
    artifacts: [
      entity(
        'artifact',
        'art_a',
        {
          title: 'Card layout',
          description: 'Cards in a row',
          image: 'https://images.example.com/cards.png',
          uri: 'https://www.example.org/cards',
          alt: 'Three cards',
          tags: ['ui'],
        },
        1,
      ),
      entity('artifact', 'art_b', { title: 'No picture', tags: ['ui'] }, 2),
      entity('artifact', 'art_c', { title: 'Stepper', image: 'file_shot1', tags: ['ui'] }, 3),
    ],
    files: [
      entity(
        'file',
        'file_shot1',
        { title: 'Stepper shot', path: 'ui/stepper.PNG', tags: ['ui'] },
        4,
      ),
      entity('file', 'file_doc1', { title: 'Brief', path: 'ui/brief.pdf', tags: ['ui'] }, 5),
    ],
  } as unknown as ProjectDataset;

  it('lists artifacts with an image, then picture files, and says what it left out', () => {
    const node = CATALOG.Gallery.parse({
      component: 'Gallery',
      artifacts: { where: { tags: 'ui' } },
      files: { where: { tags: 'ui' } },
      caption: 'description',
    });
    const out = galleryContents(data, node as never);
    expect(out.pictures.map((p) => p.id)).toEqual(['art_a', 'art_c', 'file_shot1']);
    expect(out.pictures[0]).toMatchObject({
      caption: 'Cards in a row',
      alt: 'Three cards',
      altMissing: false,
      sourceUrl: 'https://www.example.org/cards',
      sourceHost: 'example.org',
    });
    // No description: the title; no alt: the title, flagged.
    expect(out.pictures[1]).toMatchObject({ caption: 'Stepper', alt: 'Stepper', altMissing: true });
    expect(out.withoutImage.map((a) => a.id)).toEqual(['art_b']);
    expect(out.notPictures.map((f) => f.id)).toEqual(['file_doc1']);
    const capped = galleryContents(data, { ...(node as object), max: 1 } as never);
    expect(capped.pictures).toHaveLength(1);
    expect(capped.overMax).toBe(2);
  });

  it('knows which files are pictures by their type', () => {
    expect(isPictureFile('a/b.webp')).toBe(true);
    expect(isPictureFile('a/b.heic')).toBe(false);
    expect(isPictureFile('a/b.svg')).toBe(false);
    expect(isPictureFile(undefined)).toBe(false);
  });

  it('rejects unknown layouts and too many pictures in the spec', () => {
    const parse = (extra: object) =>
      CATALOG.Gallery.safeParse({ component: 'Gallery', ...extra }).success;
    expect(parse({ layout: 'compare', highlight: ['art_a'] })).toBe(true);
    expect(parse({ layout: 'carousel' })).toBe(false);
    expect(parse({ max: 25 })).toBe(false);
    expect(parse({ columns: 5 })).toBe(false);
    expect(parse({ images: ['https://example.com/a.png'] })).toBe(false);
  });
});
