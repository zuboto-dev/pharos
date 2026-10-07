import { describe, expect, it } from 'vitest';
import { columnWidth, minColumnsOf, snapHeight, snapWidth } from './layout';

// 12 columns of 60px with 16px gaps: column c's right edge is at c * 76 - 16.
const boardWidth = 12 * 60 + 11 * 16;
const edge = (c: number) => c * 76 - 16;

describe('snapWidth', () => {
  it('lands on the nearest whole column', () => {
    expect(columnWidth(boardWidth)).toBe(60);
    expect(snapWidth({ boardWidth, left: 0, rawRight: edge(5) + 30, others: [] })).toEqual({
      w: 5,
      guide: null,
    });
    expect(
      snapWidth({ boardWidth, left: edge(4) + 16, rawRight: edge(6) - 10, others: [] }),
    ).toEqual({ w: 2, guide: null });
  });

  it('is pulled to a neighbour’s edge within reach and shows a guide', () => {
    const neighbour = { left: 0, right: edge(8), top: 300, bottom: 400 };
    // Nearest column would be 7, but the neighbour's edge at column 8 is within the magnet.
    expect(snapWidth({ boardWidth, left: 0, rawRight: edge(7) + 40, others: [neighbour] })).toEqual(
      { w: 8, guide: edge(8) },
    );
    // Too far away: plain column snapping, no guide.
    expect(snapWidth({ boardWidth, left: 0, rawRight: edge(6), others: [neighbour] })).toEqual({
      w: 6,
      guide: null,
    });
  });

  it('never goes below one column or past the board', () => {
    expect(snapWidth({ boardWidth, left: edge(10) + 16, rawRight: -100, others: [] }).w).toBe(1);
    expect(snapWidth({ boardWidth, left: 0, rawRight: 5000, others: [] }).w).toBe(12);
  });
});

describe('snapHeight', () => {
  it('snaps to a nearby neighbour bottom, otherwise to 4px steps', () => {
    const others = [{ left: 500, right: 900, top: 0, bottom: 312 }];
    expect(snapHeight({ top: 0, rawHeight: 300, others })).toEqual({
      h: 312,
      guide: 312,
      atMin: false,
    });
    expect(snapHeight({ top: 0, rawHeight: 250, others })).toEqual({
      h: 252,
      guide: null,
      atMin: false,
    });
  });

  it('never shrinks below the content height', () => {
    const others = [{ left: 500, right: 900, top: 0, bottom: 200 }];
    // Content needs 230.4px: the drag stops there, and the shorter neighbour no longer attracts it.
    expect(snapHeight({ top: 0, rawHeight: 205, others, minHeight: 230.4 })).toEqual({
      h: 231,
      guide: null,
      atMin: true,
    });
    expect(snapHeight({ top: 0, rawHeight: 10, others: [] })).toEqual({
      h: 80,
      guide: null,
      atMin: true,
    });
    expect(snapHeight({ top: 0, rawHeight: 400, others: [], minHeight: 230 }).atMin).toBe(false);
  });
});

describe('minimum width', () => {
  it('keeps at least the component’s minimum columns', () => {
    expect(minColumnsOf('KanbanBoard')).toBe(4);
    expect(minColumnsOf('ProgressRing')).toBe(3);
    expect(snapWidth({ boardWidth, left: 0, rawRight: edge(1), others: [], minColumns: 4 }).w).toBe(
      4,
    );
    // Starting at column 10, only 2 columns are left in the row; that's the most it can get.
    expect(
      snapWidth({ boardWidth, left: edge(10) + 16, rawRight: 0, others: [], minColumns: 4 }).w,
    ).toBe(2);
  });
});
