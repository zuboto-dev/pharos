import { diffWords, type DiffPart } from './text-tools.js';

/** One line of a diff, with its numbers in the old and new file. */
export type DiffLine =
  | { kind: 'same'; text: string; old: number; new: number }
  | { kind: 'removed'; text: string; old: number; parts?: DiffPart[] }
  | { kind: 'added'; text: string; new: number; parts?: DiffPart[] };

/** A hunk: where it starts (the "@@" line, with any function name after it) and its lines. */
export type DiffHunk = { header: string; context?: string; lines: DiffLine[] };

export type ParsedDiff = { hunks: DiffHunk[]; added: number; removed: number };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
/** Header lines `git diff` prints before the first hunk: skipped. */
const HEADER =
  /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/;

/**
 * A file's unified diff (`git diff` output) as hunks of numbered lines. A run of removed lines
 * followed by as many added ones is a line edited in place: those carry `parts`, the words that
 * changed, so the reader sees what changed inside a long line.
 */
export function parseDiff(patch: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  let added = 0;
  let removed = 0;
  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    const start = HUNK.exec(raw);
    if (start) {
      oldNo = Number(start[1]);
      newNo = Number(start[2]);
      hunk = { header: raw, ...(start[3] ? { context: start[3] } : {}), lines: [] };
      hunks.push(hunk);
      continue;
    }
    // The next file in a whole-repository diff: its header lines follow, then its hunks.
    if (raw.startsWith('diff --git ')) {
      hunk = undefined;
      continue;
    }
    if (!hunk) {
      if (HEADER.test(raw) || !raw) continue;
      // No "@@" line: the whole patch is one hunk from line 1.
      oldNo = newNo = 1;
      hunk = { header: '', lines: [] };
      hunks.push(hunk);
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === '+') {
      hunk.lines.push({ kind: 'added', text, new: newNo++ });
      added++;
    } else if (mark === '-') {
      hunk.lines.push({ kind: 'removed', text, old: oldNo++ });
      removed++;
    } else if (mark === ' ' || raw === '') {
      hunk.lines.push({ kind: 'same', text, old: oldNo++, new: newNo++ });
    } else hunk.lines.push({ kind: 'same', text: raw, old: oldNo++, new: newNo++ });
  }
  for (const h of hunks) {
    // A trailing empty line is the patch's own last newline, not a line of the file.
    const last = h.lines[h.lines.length - 1];
    if (last?.kind === 'same' && !last.text) h.lines.pop();
    pairEdits(h.lines);
  }
  return { hunks: hunks.filter((h) => h.lines.length), added, removed };
}

/** Marks the changed words of lines edited in place (n removed then n added, n ≤ 8). */
function pairEdits(lines: DiffLine[]): void {
  for (let i = 0; i < lines.length;) {
    let r = i;
    while (lines[r]?.kind === 'removed') r++;
    let a = r;
    while (lines[a]?.kind === 'added') a++;
    const n = r - i;
    if (n > 0 && n === a - r && n <= 8)
      for (let k = 0; k < n; k++) {
        const before = lines[i + k]!;
        const after = lines[r + k]!;
        if (before.text.length + after.text.length > 2000) continue;
        const parts = diffWords(before.text, after.text);
        // Mostly rewritten: word marks would be noise; the line colour says it.
        const same = parts.filter((p) => p.op === 'same').reduce((s, p) => s + p.text.length, 0);
        if (same < Math.min(before.text.length, after.text.length) / 3) continue;
        if (before.kind === 'removed') before.parts = parts.filter((p) => p.op !== 'added');
        if (after.kind === 'added') after.parts = parts.filter((p) => p.op !== 'removed');
      }
    i = Math.max(a, i + 1);
  }
}
