import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placePanel, Popover } from './popover';

afterEach(cleanup);

const PHONE = { width: 390, height: 844 };
const rect = (top: number, left: number, height = 20) => ({ top, bottom: top + height, left });

/** Inside the screen with an 8px inset on every side, for a panel of `height`. */
function expectInside(p: ReturnType<typeof placePanel>, height: number, vp = PHONE) {
  expect(p.left).toBeGreaterThanOrEqual(8);
  expect(p.left + p.width).toBeLessThanOrEqual(vp.width - 8);
  const shown = Math.min(height, p.maxHeight);
  const top = p.top ?? vp.height - p.bottom! - shown;
  expect(top).toBeGreaterThanOrEqual(8);
  expect(top + shown).toBeLessThanOrEqual(vp.height - 8);
}

describe('placePanel', () => {
  // A seven-source headline's panel: taller than most of a phone screen.
  const TALL = 700;

  it('keeps a tall panel inside a phone screen near the top edge', () => {
    const p = placePanel(rect(40, 300), PHONE, TALL);
    expect(p.top).toBe(66);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBe(844 - 8 - 66);
    expectInside(p, TALL);
  });

  it('keeps a tall panel inside a phone screen near the bottom edge', () => {
    const p = placePanel(rect(800, 4), PHONE, TALL);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(844 - 800 + 6);
    expect(p.maxHeight).toBe(844 - 8 - p.bottom!);
    expectInside(p, TALL);
  });

  it('goes below when it fits there, even with more room above', () => {
    const p = placePanel(rect(600, 20), PHONE, 150);
    expect(p.top).toBe(626);
    expectInside(p, 150);
  });

  it('clamps horizontally to an 8px inset and narrows on a tiny screen', () => {
    expect(placePanel(rect(100, 380), PHONE, 100).left).toBe(390 - 288 - 8);
    expect(placePanel(rect(100, -50), PHONE, 100).left).toBe(8);
    const tiny = placePanel(rect(100, 0), { width: 280, height: 500 }, 100);
    expect(tiny.width).toBe(264);
    expectInside(tiny, 100, { width: 280, height: 500 });
  });

  it('stays on screen when its button has scrolled out of view', () => {
    const above = placePanel(rect(-200, 10), PHONE, TALL);
    expect(above.top).toBe(8);
    expectInside(above, TALL);
    expectInside(placePanel(rect(900, 10), PHONE, TALL), TALL);
  });
});

describe('Popover', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', PHONE.width);
    vi.stubGlobal('innerHeight', PHONE.height);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(700);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const open = (top: number, left: number) =>
    render(
      <Popover anchor={new DOMRect(left, top, 80, 20)} label="Sources" onClose={() => {}}>
        {Array.from({ length: 7 }, (_, i) => (
          <p key={i}>Source {i + 1}</p>
        ))}
      </Popover>,
    );

  it('scrolls a seven-source panel inside the phone screen near the top', () => {
    open(40, 330);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.style.top).toBe('66px');
    expect(panel.style.maxHeight).toBe(`${844 - 8 - 66}px`);
    expect(panel.style.left).toBe(`${390 - 288 - 8}px`);
    expect(panel.style.width).toBe('288px');
  });

  it('opens a seven-source panel upward near the bottom, still inside the screen', () => {
    open(800, 0);
    const panel = screen.getByRole('dialog');
    expect(panel.style.top).toBe('');
    expect(panel.style.bottom).toBe(`${844 - 800 + 6}px`);
    expect(panel.style.maxHeight).toBe(`${844 - 8 - 50}px`);
    expect(panel.style.left).toBe('8px');
  });
});
