/**
 * Small text helpers shared by the server preview and the web components (R4), so both count and
 * show the same words: work codes hidden from titles, and the before/after diff of two quotes.
 */

/** A leading work code such as "W3.8 · ", "R4.2: " or "G1 – ", with its separator. */
const WORK_CODE = /^\s*[A-Z]{1,3}\d+(?:\.\d+)*[a-z]?\s*(?:[·:–—|-]\s*)+/u;

/** "W3.8 · Measure the baseline" → "Measure the baseline"; titles without a code stay as they are. */
export function stripWorkCode(title: string): string {
  const rest = title.replace(WORK_CODE, '');
  return rest.trim() ? rest : title;
}

export type DiffPart = { op: 'same' | 'removed' | 'added'; text: string };

/** Words with the spaces after them, so joining the parts gives back the text. */
function tokens(text: string): string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

/**
 * Word-level diff of two passages (longest common subsequence), in reading order: removed words
 * come before the added words that replace them. Joining the `same` and `removed` parts gives
 * `before`; joining the `same` and `added` parts gives `after` (spacing may differ).
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  const key = (t: string) => t.trim();
  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] =
        key(a[i]!) === key(b[j]!)
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const parts: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = parts.at(-1);
    if (last?.op === op) last.text += text;
    else parts.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && key(a[i]!) === key(b[j]!)) {
      push('same', b[j]!);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      push('removed', a[i++]!);
    } else {
      push('added', b[j++]!);
    }
  }
  return parts;
}

/** The lines of each passage that the other doesn't have: what a BeforeAfter shows. */
export function changedLines(before: string, after: string): { before: string[]; after: string[] } {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  const a = lines(before);
  const b = lines(after);
  return { before: a.filter((l) => !b.includes(l)), after: b.filter((l) => !a.includes(l)) };
}
