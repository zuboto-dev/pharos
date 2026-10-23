import { describe, expect, it } from 'vitest';
import { parseDiff } from './diff.js';
import { ReportDoc } from './doc.js';

const PATCH = `diff --git a/src/bell.ts b/src/bell.ts
index 1111111..2222222 100644
--- a/src/bell.ts
+++ b/src/bell.ts
@@ -10,4 +10,5 @@ export function bell() {
   const count = unread();
-  if (count > 0) show(count);
+  if (count > 0 && !quiet()) show(count);
+  log(count);
   return count;
 }
\\ No newline at end of file
`;

describe('parseDiff', () => {
  it('numbers lines in both files, counts them and marks the words of a line edited in place', () => {
    const { hunks, added, removed } = parseDiff(PATCH);
    expect([added, removed]).toEqual([2, 1]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.context).toBe('export function bell() {');
    const lines = hunks[0]!.lines;
    expect(lines.map((l) => l.kind)).toEqual(['same', 'removed', 'added', 'added', 'same', 'same']);
    expect(lines[0]).toMatchObject({ old: 10, new: 10 });
    expect(lines[1]).toMatchObject({ old: 11 });
    expect(lines[2]).toMatchObject({ new: 11 });
    expect(lines[5]).toMatchObject({ old: 13, new: 14 });
    // The run is 1 removed then 2 added: not paired, so no word marks.
    expect(lines[1]).not.toHaveProperty('parts');
  });

  it('pairs n removed lines with n added ones and keeps only that side in each', () => {
    const { hunks } = parseDiff(
      '@@ -1,1 +1,1 @@\n-const label = name;\n+const label = agentLabel(name);\n',
    );
    const [before, after] = hunks[0]!.lines;
    expect(before).toMatchObject({ kind: 'removed' });
    expect(after).toMatchObject({ kind: 'added' });
    if (before?.kind !== 'removed' || after?.kind !== 'added') throw new Error('kinds');
    expect(before.parts?.some((p) => p.op === 'added')).toBe(false);
    expect(after.parts?.filter((p) => p.op === 'added').map((p) => p.text.trim())).toEqual([
      'agentLabel(name);',
    ]);
  });

  it('reads several files of one diff, and a bare hunk with no "@@" from line 1', () => {
    const two = `${PATCH}diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n--- old comment\n+-- new comment\n`;
    const parsed = parseDiff(two);
    expect(parsed.hunks).toHaveLength(2);
    // "--- old comment" inside a hunk is a removed line, not a file header.
    expect(parsed.removed).toBe(2);
    expect(parseDiff('+one\n+two\n').hunks[0]!.lines.map((l) => l.kind)).toEqual([
      'added',
      'added',
    ]);
  });
});

describe('the diff block', () => {
  const doc = (patch: string) => ({
    blocks: [{ kind: 'diff', id: 'd', files: [{ path: 'a.ts', patch }] }],
  });
  it('is a document block, and the total of patches is limited', () => {
    expect(ReportDoc.safeParse(doc(PATCH)).success).toBe(true);
    const big = {
      blocks: Array.from({ length: 6 }, (_, i) => ({
        kind: 'diff',
        id: `d${i}`,
        files: [{ path: 'a.ts', patch: '+x\n'.repeat(13_000) }],
      })),
    };
    expect(ReportDoc.safeParse(big).error?.issues[0]?.message).toMatch(/characters of diffs/);
  });
});

describe("a sheet's shows", () => {
  const fig = { kind: 'figure', id: 'shot', items: [{ src: 'a.png', alt: 'A' }] };
  const sheet = (shows: string[]) => ({
    kind: 'sheet',
    id: 's',
    title: 'Pick one',
    shows,
    blocks: [{ kind: 'block', id: 't', node: { component: 'Text', content: 'Which?' } }],
  });
  it('names figure or drawing blocks of the document, and nothing else', () => {
    expect(ReportDoc.safeParse({ blocks: [fig, sheet(['shot'])] }).success).toBe(true);
    expect(
      ReportDoc.safeParse({ blocks: [fig, sheet(['nope'])] }).error?.issues[0]?.message,
    ).toMatch(/shows "nope", which is not a figure or drawing/);
  });
});
