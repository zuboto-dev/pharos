import type { ReportDoc } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { drawingOverlaps, readerChecks } from './reader-checks.js';

const text = (id: string, content: string) => ({
  kind: 'block' as const,
  id,
  node: { component: 'Text' as const, content },
});
const doc = (...blocks: unknown[]) => ({ blocks }) as unknown as ReportDoc;
const GOOD = text(
  'lead',
  '# Seeds arrive Friday\n\n**3 beds**, **42 plants**, **2 open questions**.',
);

describe('reader checks on report documents', () => {
  it('passes a report that leads with its claim and key numbers', () => {
    const chart = { kind: 'block', id: 'c', node: { component: 'CountChart', title: 'Beds' } };
    expect(
      readerChecks(doc(GOOD, text('a', '## Two beds are ready for planting\n\nShort.'), chart)),
    ).toEqual([]);
  });

  it('flags sections of words only; a chart, a figure or a table in the section passes', () => {
    const fig = { kind: 'figure', id: 'f', items: [{ src: 'shots/a.png', alt: 'A bed' }] };
    const w = readerChecks(
      doc(
        GOOD,
        text('a', '## Two beds are ready\n\nShort.'),
        text('b', '## Water use fell by a third\n\nShort.'),
        fig,
        text('c', '## Costs by month\n\n| Month | Cost |\n|---|---|\n| Jul | 4 |'),
        text('d', '## 10 / 10'),
        text('e', '## Two questions for you'),
        { kind: 'sheet', id: 's', title: 'Pick', blocks: [text('t', 'Which?')] },
      ),
    );
    expect(w.filter((x) => x.includes('words only'))).toEqual([
      'Reader check: section "Two beds are ready" is words only; show it with Stats or a chart, a table, a figure, or a drawing (interactive where the reader would explore)',
    ]);
  });

  it('asks for the claim first and for key numbers', () => {
    const w = readerChecks(doc(text('a', 'Some words without a heading.')));
    expect(w.some((x) => x.includes('open with the claim'))).toBe(true);
    expect(w.some((x) => x.includes('no key numbers'))).toBe(true);
  });

  it('a Stat block counts as key numbers; a review desk needs none', () => {
    const stat = { kind: 'block', id: 's', node: { component: 'Stat', label: 'Beds' } };
    expect(readerChecks(doc(text('lead', '# Ready'), stat)).join()).not.toContain('key numbers');
    const sheet = { kind: 'sheet', id: 'q', title: 'Pick', blocks: [text('t', 'Which?')] };
    expect(readerChecks(doc(text('lead', '# Two things need you'), sheet)).join()).not.toContain(
      'key numbers',
    );
  });

  it('flags topic headings, long paragraphs, local links, and prose with nothing to see', () => {
    const w = readerChecks(
      doc(
        GOOD,
        text('s', '## Summary\n\n' + 'word '.repeat(150)),
        text('l', 'See [the plan](http://localhost:4300/projects/p1/views/v1).'),
        text('more', 'x'.repeat(3600)),
      ),
    );
    expect(w.some((x) => x.includes('"Summary", a topic'))).toBe(true);
    expect(w.some((x) => x.includes('750-character paragraph'))).toBe(true);
    expect(w.some((x) => x.includes('link to "/projects/p1/views/v1"'))).toBe(true);
    expect(w.some((x) => x.includes('nothing to see'))).toBe(true);
  });

  it("finds a drawing's lines running through its labels, and passes lines between boxes", () => {
    const html = (d: string) =>
      `<svg viewBox="0 0 900 200"><path d="${d}" stroke="#000"/><rect x="10" y="35" width="290" height="130"/><rect x="310" y="35" width="280" height="130"/><g text-anchor="middle"><text x="155" y="78" font-size="23">Garden</text><text x="450" y="111">Prototype and experiments</text></g></svg>`;
    expect(drawingOverlaps('map', html('M300 100H390M510 100H600'))[0]).toContain(
      '"Prototype and experiments"',
    );
    expect(drawingOverlaps('map', html('M300 100H310M590 100H600'))).toEqual([]);
  });
});
