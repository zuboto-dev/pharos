import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DIFF_FOLD, DiffView, type Diff } from './document-diff';

afterEach(cleanup);

const block = (patch: string): Diff => ({
  kind: 'diff',
  id: 'd',
  title: 'What changed',
  ref: 'main..feat/x',
  files: [{ path: 'apps/web/src/Bell.tsx', patch, note: 'The bell counts unread only.' }],
});

describe('DiffView', () => {
  it('draws a file card: its path, counts, numbered lines with − / + and the changed words', () => {
    render(
      <DiffView
        block={block(
          '@@ -4,2 +4,2 @@ function Bell() {\n const n = 1;\n-return count;\n+return unread;\n',
        )}
      />,
    );
    expect(screen.getByText('Bell.tsx')).toBeTruthy();
    expect(screen.getByText('main..feat/x')).toBeTruthy();
    expect(screen.getByText('The bell counts unread only.')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-line]')];
    expect(rows.map((r) => r.getAttribute('data-line'))).toEqual(['same', 'removed', 'added']);
    // Line numbers: old 5 removed, new 5 added.
    expect(rows[1]!.textContent).toMatch(/^5−removed: return count;/);
    expect(rows[2]!.querySelector('ins')?.textContent).toBe('unread;');
    expect(rows[1]!.querySelector('del')?.textContent).toBe('count;');
  });

  it('opens a long file at its first lines, the rest one click away', () => {
    const long = `@@ -1,0 +1,${DIFF_FOLD + 30} @@\n${Array.from({ length: DIFF_FOLD + 30 }, (_, i) => `+line ${i}`).join('\n')}\n`;
    render(<DiffView block={block(long)} />);
    expect(document.querySelectorAll('[data-line]').length).toBe(DIFF_FOLD);
    fireEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(document.querySelectorAll('[data-line]').length).toBe(DIFF_FOLD + 30);
  });
});
