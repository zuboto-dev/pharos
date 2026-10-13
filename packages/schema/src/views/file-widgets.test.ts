// R7.11 files as widgets: the FileView and FileList contract · Opus 5.5
import { describe, expect, it } from 'vitest';
import { Board } from './board.js';
import { COMPONENT_INFO } from './catalog-info.js';
import { ViewNode } from './catalog.js';

describe('FileView and FileList showIn', () => {
  it('accepts a FileView with or without a file, in either size', () => {
    for (const node of [
      { component: 'FileView', file: 'file_abc123' },
      { component: 'FileView', file: 'file_abc123', size: 'compact', title: 'Certificate' },
      { component: 'FileView', size: 'full' },
      COMPONENT_INFO.FileView.example,
    ])
      expect(ViewNode.safeParse(node).success, JSON.stringify(node)).toBe(true);
  });

  it('refuses unknown sizes, empty ids and stray props', () => {
    for (const node of [
      { component: 'FileView', file: 'file_abc123', size: 'huge' },
      { component: 'FileView', file: '' },
      { component: 'FileView', file: 'file_abc123', path: 'Company/cert.pdf' },
      { component: 'FileList', showIn: '' },
    ])
      expect(ViewNode.safeParse(node).success, JSON.stringify(node)).toBe(false);
  });

  it('lets a board pair a FileList filtered to one document set with a FileView', () => {
    const board = Board.safeParse({
      component: 'Board',
      widgets: [
        {
          id: 'papers',
          w: 6,
          node: {
            component: 'FileList',
            filter: {
              where: { tags: 'business-registration', expiryDate: { lte: '$today+60d' } },
            },
            controls: ['search', 'kind'],
            details: ['issuer', 'expiryDate'],
            showIn: 'certificate',
          },
        },
        {
          id: 'certificate',
          w: 6,
          node: { component: 'FileView', file: 'file_abc123', size: 'compact' },
        },
      ],
    });
    expect(board.success).toBe(true);
  });

  it('sizes a FileView so it fits beside a list', () => {
    const info = COMPONENT_INFO.FileView;
    expect(info.minColumns).toBeLessThanOrEqual(6);
    expect(info.use).toMatch(/never invented/);
  });
});
