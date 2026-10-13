import { describe, expect, it } from 'vitest';
import { contrast, contrastIssues } from './contrast';

function html(markup: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = markup;
  return div;
}

describe('contrast check', () => {
  it('computes WCAG ratios', () => {
    expect(contrast([1, 1, 1, 1], [0, 0, 0, 1])).toBeCloseTo(21, 0);
    expect(contrast([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1])).toBeCloseTo(1, 5);
  });

  it('flags a light-only grey that is too faint on a dark block', () => {
    const issues = contrastIssues(html('<p class="text-neutral-500">Quiet</p>'), 'dark');
    expect(issues).toEqual([expect.objectContaining({ text: 'Quiet', needs: 4.5 })]);
    expect(issues[0]!.ratio).toBeLessThan(4.5);
  });

  it('uses the dark variant and the tokens for each mode', () => {
    const block = html(
      '<p class="text-neutral-500 dark:text-neutral-400">Pair</p><p class="text-muted">Token</p><p class="text-faint">Faint</p>',
    );
    expect(contrastIssues(block, 'dark')).toEqual([]);
    // In light mode the faint token is neutral-400, which is below AA (kept for quiet text).
    expect(contrastIssues(block, 'light').map((i) => i.text)).toEqual(['Faint']);
  });

  it('composites translucent backgrounds and counts large text at 3:1', () => {
    const block = html(
      '<div class="bg-sky-950/40"><span class="text-sky-300">On tint</span></div><p class="text-2xl text-neutral-500">Big</p>',
    );
    expect(contrastIssues(block, 'dark')).toEqual([]);
  });

  it('skips hidden and screen-reader-only text', () => {
    const block = html(
      '<span class="sr-only text-neutral-700">a</span><span aria-hidden="true" class="text-neutral-700">b</span>',
    );
    expect(contrastIssues(block, 'dark')).toEqual([]);
  });
});
