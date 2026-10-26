import { describe, expect, it } from 'vitest';
import {
  MAIN_PAGE_WORDS,
  compareDocs,
  mainPageWordsWarning,
  visibleWords,
  comparisonLine,
  isBoardView,
  isMainPage,
  isProjectManagementView,
} from './versions.js';
import type { ReportDoc } from './doc.js';

const text = (id: string, content: string) =>
  ({ kind: 'block', id, node: { component: 'Text', content } }) as ReportDoc['blocks'][number];

describe('page roles', () => {
  it('tells the main page and board views apart', () => {
    expect(isMainPage({ data: { kind: 'main', doc: {} } })).toBe(true);
    expect(isBoardView({ data: {} })).toBe(true);
    expect(isBoardView({ data: { doc: {} } })).toBe(false);
    expect(isBoardView({ data: { page: {} } })).toBe(false);
    expect(isBoardView({ data: { kind: 'answer' } })).toBe(false);
  });

  it('counts the Overview and boards of mostly tasks and stages as project management', () => {
    const board = (...names: string[]) => ({
      data: {
        spec: {
          component: 'Board',
          widgets: names.map((n, i) => ({ id: `w${i}`, node: { component: n } })),
        },
      },
    });
    expect(isProjectManagementView({ data: { template: 'overview' } })).toBe(true);
    expect(isProjectManagementView(board('KanbanBoard', 'StageTracker', 'Text'))).toBe(true);
    expect(isProjectManagementView(board('DataTable', 'DueTracker', 'TaskTable'))).toBe(false);
    expect(isProjectManagementView(board())).toBe(false);
    expect(isProjectManagementView({ data: { doc: {}, template: 'overview' } })).toBe(false);
  });
});

describe('compareDocs', () => {
  it('marks added, removed and changed blocks, removed ones where they were', () => {
    const before = { blocks: [text('a', 'One two'), text('b', 'Gone'), text('c', 'Same')] };
    const after = { blocks: [text('a', 'One three'), text('c', 'Same'), text('d', 'New')] };
    const c = compareDocs(before, after);
    expect(c.blocks.map((b) => `${b.block.id}:${b.change}`)).toEqual([
      'a:changed',
      'b:removed',
      'c:same',
      'd:added',
    ]);
    expect(c.blocks[0]!.words).toEqual([
      { op: 'same', text: 'One ' },
      { op: 'removed', text: 'two' },
      { op: 'added', text: 'three' },
    ]);
    expect(comparisonLine(c)).toBe('1 added · 1 changed · 1 removed');
  });

  it('a first version is all added; equal blocks with keys in another order are the same', () => {
    expect(compareDocs(undefined, { blocks: [text('a', 'x')] }).added).toBe(1);
    const a = { kind: 'block', id: 'a', node: { component: 'Text', content: 'x' } };
    const b = { node: { content: 'x', component: 'Text' }, id: 'a', kind: 'block' };
    expect(
      compareDocs({ blocks: [a] } as ReportDoc, { blocks: [b] } as ReportDoc).blocks[0]!.change,
    ).toBe('same');
    expect(comparisonLine({ added: 0, removed: 0, changed: 0 })).toBe('No change to the blocks');
  });
});

describe('main page words', () => {
  it('counts the words in view, not those folded into details or sheets', () => {
    const doc = {
      blocks: [
        text('a', '# Pharos\n\nCarry a **project** forward.'),
        { kind: 'details', id: 'd', summary: 'More', blocks: [text('b', 'hidden words here')] },
      ],
    } as ReportDoc;
    expect(visibleWords(doc)).toBe(5);
    expect(mainPageWordsWarning(doc)).toBeUndefined();
    const long = { blocks: [text('a', 'word '.repeat(MAIN_PAGE_WORDS + 1))] };
    expect(mainPageWordsWarning(long)).toMatch(/shows 201 words before any details/);
  });
});
