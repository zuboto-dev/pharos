import type { Terminal } from '@xterm/xterm';

/** What wheelSteps needs of the terminal. */
export type WheelTerminal = Pick<Terminal, 'cols' | 'rows'> & {
  modes: Pick<Terminal['modes'], 'mouseTrackingMode'>;
};

/**
 * Wheel scrolling for a full-screen agent that asked for the mouse (Claude Code scrolls its own
 * conversation): xterm.js reports one wheel step per wheel event however far it went, so a long
 * answer crawled by a line at a time. This reports one step per line scrolled, as a native
 * terminal does, in the SGR encoding (mode 1006) the agent asked for. Returns the handler for
 * `attachCustomWheelEventHandler`: false when it sent the steps itself.
 */
export function wheelSteps(
  terminal: WheelTerminal,
  el: Element,
  sgr: () => boolean,
  send: (data: string) => void,
): (event: WheelEvent) => boolean {
  let partial = 0;
  return (event) => {
    if (terminal.modes.mouseTrackingMode === 'none' || !sgr()) return true;
    if (event.deltaY === 0 || event.shiftKey) return true;
    const screen = el.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!screen?.height || !screen.width) return true;
    const cellHeight = screen.height / terminal.rows;
    const lines =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * terminal.rows
          : event.deltaY / cellHeight;
    if (Math.sign(lines) !== Math.sign(partial)) partial = 0;
    partial += lines;
    const steps = Math.trunc(partial);
    partial -= steps;
    if (steps) {
      const clamp = (n: number, max: number) => Math.min(max, Math.max(1, n || 1));
      const col = clamp(
        Math.floor((event.clientX - screen.left) / (screen.width / terminal.cols)) + 1,
        terminal.cols,
      );
      const row = clamp(Math.floor((event.clientY - screen.top) / cellHeight) + 1, terminal.rows);
      const step = `\x1b[<${steps < 0 ? 64 : 65};${col};${row}M`;
      send(step.repeat(Math.min(Math.abs(steps), terminal.rows)));
    }
    event.preventDefault();
    return false;
  };
}
