import { runQuery, type Entity } from '@pharos/schema';
import { useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { useViewData } from './context';
import { Popover, usePopover } from './popover';
import { isHttp, Uri, type MarkdownExtras } from './ui';

/**
 * Tap-to-explain terms: a project's `term` records, marked where they first appear in a widget.
 * Matching is a pure function over the widget's texts in reading order, so rendering twice can't
 * drop or repeat a mark.
 */

export type Term = Entity<'term'>;
export type TermMatcher = { pattern: RegExp; byForm: Map<string, Term> };
export type TermRange = { start: number; end: number; term: Term };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One pattern for every word and other form, longest first, matching whole words only. */
export function termMatcher(terms: readonly Term[]): TermMatcher | null {
  const byForm = new Map<string, Term>();
  for (const term of terms) {
    for (const form of [term.data.word, ...term.data.alsoCalled]) {
      const key = form.trim().toLowerCase();
      if (key && !byForm.has(key)) byForm.set(key, term);
    }
  }
  if (!byForm.size) return null;
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length).map(escape);
  // Letters and digits on either side mean it's part of a longer word.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return { pattern, byForm };
}

/** First uses in one text, skipping terms already in `seen` (which it updates). */
function marksIn(text: string, matcher: TermMatcher, seen: Set<string>): TermRange[] {
  const ranges: TermRange[] = [];
  for (const match of text.matchAll(matcher.pattern)) {
    const term = matcher.byForm.get(match[0].toLowerCase());
    if (!term || seen.has(term.id)) continue;
    seen.add(term.id);
    ranges.push({ start: match.index, end: match.index + match[0].length, term });
  }
  return ranges;
}

/** For texts in reading order: where each term is used first, per text. */
export function firstUses(texts: readonly string[], matcher: TermMatcher | null): TermRange[][] {
  if (!matcher) return texts.map(() => []);
  const seen = new Set<string>();
  return texts.map((text) => marksIn(text, matcher, seen));
}

/** `firstUses` for texts with keys, e.g. `["clm_1:statement", "…"]`. */
export function firstUsesByKey(
  entries: readonly (readonly [string, string])[],
  matcher: TermMatcher | null,
): Map<string, TermRange[]> {
  const ranges = firstUses(
    entries.map(([, text]) => text),
    matcher,
  );
  return new Map(entries.map(([key], i) => [key, ranges[i]!]));
}

/** The project's terms, unless the widget turned them off with `terms: false`. */
export function useTermMatcher(enabled: boolean | undefined = true): TermMatcher | null {
  const data = useViewData();
  return useMemo(
    () => (enabled === false ? null : termMatcher(runQuery(data, 'term'))),
    [data, enabled],
  );
}

/** A marked use with the punctuation that touches it, e.g. `(` + `MCP` + `),`. */
export type TermPiece = { term: Term; before: string; word: string; after: string };

// Opening brackets and quotes right before a term, and closing ones or other punctuation right
// after it, stay on its line: a button is an atomic inline, so the browser would otherwise allow
// a break between it and a "," or ";".
const OPENING = /[\p{Ps}\p{Pi}"']+$/u;
const CLOSING = /^[\p{Pe}\p{Pf}.,;:!?…%"']+/u;

/** Splits a text at its marks into plain strings and marked uses with their punctuation. */
export function termPieces(text: string, ranges: readonly TermRange[]): (string | TermPiece)[] {
  const pieces: (string | TermPiece)[] = [];
  let at = 0;
  ranges.forEach(({ start, end, term }, i) => {
    const next = ranges[i + 1]?.start ?? text.length;
    const before = OPENING.exec(text.slice(at, start))?.[0] ?? '';
    const after = CLOSING.exec(text.slice(end, next))?.[0] ?? '';
    if (start - before.length > at) pieces.push(text.slice(at, start - before.length));
    pieces.push({ term, before, word: text.slice(start, end), after });
    at = end + after.length;
  });
  if (at < text.length) pieces.push(text.slice(at));
  return pieces;
}

/** Keeps a term on one line with the punctuation around it. */
function Glued({
  before,
  after,
  children,
}: {
  before: string;
  after: string;
  children: ReactNode;
}) {
  if (!before && !after) return children;
  return (
    <span className="whitespace-nowrap">
      {before}
      {children}
      {after}
    </span>
  );
}

/** Plain text with its term marks. */
export function TermText({ text, ranges = [] }: { text: string; ranges?: TermRange[] }) {
  if (!ranges.length) return text;
  return termPieces(text, ranges).map((piece, i) =>
    typeof piece === 'string' ? (
      piece
    ) : (
      <Glued key={i} before={piece.before} after={piece.after}>
        <TermButton term={piece.term}>{piece.word}</TermButton>
      </Glued>
    ),
  );
}

/** A marked word: dotted underline, same colour; tap or Enter explains it. */
export function TermButton({ term, children }: { term: Term; children: ReactNode }) {
  const { entityById } = useViewData();
  const { anchor, trigger, close } = usePopover();
  const found = term.data.sourceId ? entityById.get(term.data.sourceId) : undefined;
  const source = found?.type === 'artifact' ? (found as Entity<'artifact'>) : undefined;
  const uri = isHttp(source?.data.uri) ? source.data.uri : undefined;
  return (
    <>
      <button
        type="button"
        {...trigger}
        title={`What “${term.data.word}” means`}
        className="pointer-events-auto inline cursor-help rounded-sm p-0 text-inherit underline decoration-neutral-400 decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-solid focus-visible:outline-2 focus-visible:outline-sky-400 dark:decoration-neutral-500"
      >
        {children}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={term.data.word} onClose={close}>
          <span className="block font-semibold text-neutral-900 dark:text-neutral-100">
            {term.data.word}
          </span>
          <span className="block">{term.data.explanation}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            {uri ? (
              <Uri uri={uri} title={source?.data.title}>
                Source
              </Uri>
            ) : (
              'Our wording'
            )}
          </span>
        </Popover>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Markdown

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

/** Text inside these is never marked. */
const SKIP = new Set(['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition']);

/**
 * A remark plugin: splits text nodes at each term's first use, in document order, into an element
 * rendered as a `span[data-term]`, wrapped with the punctuation touching it in a
 * `span[data-term-glue]` (see `useMarkdownTerms`).
 */
function remarkTerms(matcher: TermMatcher) {
  return () => (tree: { type: string }) => {
    const seen = new Set<string>();
    const walk = (node: MdNode) => {
      if (SKIP.has(node.type) || !node.children) return;
      node.children = node.children.flatMap((child): MdNode[] => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        const ranges = marksIn(child.value, matcher, seen);
        if (!ranges.length) return [child];
        return termPieces(child.value, ranges).map((piece): MdNode => {
          if (typeof piece === 'string') return { type: 'text', value: piece };
          const mark: MdNode = {
            type: 'pharosTerm',
            data: { hName: 'span', hProperties: { dataTerm: piece.term.id } },
            children: [{ type: 'text', value: piece.word }],
          };
          if (!piece.before && !piece.after) return mark;
          return {
            type: 'pharosTermGlue',
            data: { hName: 'span', hProperties: { dataTermGlue: '' } },
            children: [
              ...(piece.before ? [{ type: 'text', value: piece.before }] : []),
              mark,
              ...(piece.after ? [{ type: 'text', value: piece.after }] : []),
            ],
          };
        });
      });
    };
    walk(tree as MdNode);
  };
}

/** Props for `Markdown` that mark the first use of each term; spread them on it. */
export function useMarkdownTerms(enabled: boolean | undefined): MarkdownExtras {
  const matcher = useTermMatcher(enabled);
  return useMemo(() => {
    if (!matcher) return {};
    const termById = new Map([...matcher.byForm.values()].map((t) => [t.id, t]));
    const components: Components = {
      // Markdown makes no other spans: these come from `remarkTerms`.
      span: ({ children, ...props }) => {
        const id = (props as Record<string, unknown>)['data-term'];
        const term = typeof id === 'string' ? termById.get(id) : undefined;
        if (term) return <TermButton term={term}>{children}</TermButton>;
        if ('data-term-glue' in props) return <span className="whitespace-nowrap">{children}</span>;
        return <span>{children}</span>;
      },
    };
    return { remarkPlugins: [remarkTerms(matcher)], components };
  }, [matcher]);
}
