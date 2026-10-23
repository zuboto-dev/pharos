import type { ILinkProvider, Terminal } from '@xterm/xterm';

/** A web address in terminal text, up to the first space, quote or bracket that closes it. */
const URL = /https?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]}]/g;

/** The addresses in one line of text, with their 1-based start and end columns. */
export function findLinks(text: string): { url: string; start: number; end: number }[] {
  return [...text.matchAll(URL)].map((m) => ({
    url: m[0],
    start: m.index + 1,
    end: m.index + m[0].length,
  }));
}

/** Whether a click asks to open a link: ⌘ on a Mac, Ctrl elsewhere (as in VS Code's terminal). */
export const opensLink = (event: MouseEvent, mac = /Mac|iPhone|iPad/.test(navigator.platform)) =>
  mac ? event.metaKey : event.ctrlKey;

/**
 * The terminal's web links: underlined on hover, opened in a new tab with ⌘-click. Lines the
 * agent wrapped are read as one, so an address split across two rows still opens whole.
 */
export function webLinks(terminal: Terminal): ILinkProvider {
  return {
    provideLinks(row, callback) {
      const buffer = terminal.buffer.active;
      // The whole wrapped line this row belongs to.
      let first = row - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
      let last = first;
      while (buffer.getLine(last + 1)?.isWrapped) last++;
      const cols = terminal.cols;
      let text = '';
      for (let y = first; y <= last; y++)
        text += (buffer.getLine(y)?.translateToString(y === last) ?? '').padEnd(
          y === last ? 0 : cols,
        );
      const at = (offset: number) => ({
        x: (offset % cols) + 1,
        y: first + Math.floor(offset / cols) + 1,
      });
      callback(
        findLinks(text)
          .map(({ url, start, end }) => ({
            text: url,
            range: { start: at(start - 1), end: at(end - 1) },
            decorations: { underline: true, pointerCursor: true },
            activate: (event: MouseEvent, uri: string) => {
              if (opensLink(event)) window.open(uri, '_blank', 'noopener,noreferrer');
            },
          }))
          .filter((link) => link.range.start.y <= row && link.range.end.y >= row),
      );
    },
  };
}
