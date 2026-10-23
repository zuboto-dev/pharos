import { describe, expect, it } from 'vitest';
import { wheelSteps, type WheelTerminal } from './wheel';

/** A terminal of 80 × 40 cells drawn 800 × 600 px at the page's top left: cells are 10 × 15 px. */
function setup(mode: WheelTerminal['modes']['mouseTrackingMode'] = 'any', sgr = true) {
  const el = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  el.append(screen);
  const sent: string[] = [];
  const terminal: WheelTerminal = { cols: 80, rows: 40, modes: { mouseTrackingMode: mode } };
  const handle = wheelSteps(
    terminal,
    el,
    () => sgr,
    (data) => sent.push(data),
  );
  const wheel = (deltaY: number, deltaMode = 0) =>
    handle({
      deltaY,
      deltaMode,
      clientX: 205,
      clientY: 95,
      shiftKey: false,
      preventDefault: () => {},
    } as WheelEvent);
  return { sent, wheel };
}

const up = (n: number) => '\x1b[<64;21;7M'.repeat(n);
const down = (n: number) => '\x1b[<65;21;7M'.repeat(n);

describe('wheel scrolling in a full-screen agent', () => {
  it('sends one wheel step per line scrolled, at the pointer’s cell', () => {
    const { sent, wheel } = setup();
    // A mouse wheel notch of 100 px is six and two thirds lines: six steps now, the rest kept.
    expect(wheel(-100)).toBe(false);
    expect(sent).toEqual([up(6)]);
    expect(wheel(-50)).toBe(false);
    expect(sent[1]).toEqual(up(4));
    // Turning around starts over.
    wheel(45);
    expect(sent[2]).toEqual(down(3));
  });

  it('adds up a trackpad’s small moves', () => {
    const { sent, wheel } = setup();
    for (let i = 0; i < 6; i++) wheel(5);
    expect(sent).toEqual([down(1), down(1)]);
  });

  it('counts lines and pages as they are', () => {
    const { sent, wheel } = setup();
    wheel(3, WheelEvent.DOM_DELTA_LINE);
    wheel(-1, WheelEvent.DOM_DELTA_PAGE);
    expect(sent).toEqual([down(3), up(40)]);
  });

  it('leaves the wheel to xterm.js when the agent didn’t ask for SGR mouse reports', () => {
    const none = setup('none');
    expect(none.wheel(-100)).toBe(true);
    const legacy = setup('any', false);
    expect(legacy.wheel(-100)).toBe(true);
    expect([...none.sent, ...legacy.sent]).toEqual([]);
  });
});
