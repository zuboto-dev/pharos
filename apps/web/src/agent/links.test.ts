import { describe, expect, it } from 'vitest';
import { findLinks, opensLink } from './links';

describe('links in the terminal', () => {
  it('finds web addresses, leaving closing punctuation out', () => {
    expect(
      findLinks(
        'Opened http://127.0.0.1:4300/projects/p1/views/v2. See (https://example.com/a?b=1).',
      ),
    ).toEqual([
      { url: 'http://127.0.0.1:4300/projects/p1/views/v2', start: 8, end: 49 },
      { url: 'https://example.com/a?b=1', start: 57, end: 81 },
    ]);
    expect(findLinks('no link here')).toEqual([]);
  });

  it('opens with ⌘ on a Mac and Ctrl elsewhere, never on a plain click', () => {
    const click = (init: MouseEventInit) => new MouseEvent('click', init);
    expect(opensLink(click({ metaKey: true }), true)).toBe(true);
    expect(opensLink(click({}), true)).toBe(false);
    expect(opensLink(click({ ctrlKey: true }), false)).toBe(true);
    expect(opensLink(click({ metaKey: true }), false)).toBe(false);
  });
});
