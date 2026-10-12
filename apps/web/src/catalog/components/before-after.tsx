import {
  changedLines,
  diffWords,
  runQuery,
  type DiffPart,
  type Entity,
  type NodeOf,
} from '@pharos/schema';
import { useViewData, type ViewData } from '../context';
import { Empty } from '../ui';
import { CertaintyMark } from './knowledge';

// R4 block 3 (docs/reframe/r4-plan.md): a change shown, not told. The stated change sits on top;
// below it two panes, before and after, show only the lines of each claim's quoted passage that
// changed, with removed words struck and added words underlined. Colour is never the only cue:
// the words sit in <del>/<ins>, with a spoken "removed"/"added" for screen readers.

type Claim = Entity<'claim'>;
type Side = 'Before' | 'After';

function findClaim(data: ViewData, id: string | undefined): Claim | undefined {
  return id ? runQuery(data, 'claim', { where: { id } })[0] : undefined;
}

/** The same split `diffWords` uses: words with the spaces after them. */
function tokens(text: string): string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

/**
 * One pane's parts in its own spelling. `diffWords` gives `same` parts in the after passage's
 * spacing; the before pane takes as many of its own tokens instead, so its line breaks hold.
 */
export function paneParts(side: Side, before: string, after: string): DiffPart[] {
  const parts = diffWords(before, after);
  if (side === 'After') return parts.filter((p) => p.op !== 'removed');
  const own = tokens(before);
  let at = 0;
  return parts
    .filter((p) => p.op !== 'added')
    .map((p) => {
      const n = tokens(p.text).length;
      const text = own.slice(at, at + n).join('');
      at += n;
      return { op: p.op, text };
    });
}

function Passage({ parts }: { parts: DiffPart[] }) {
  return (
    <blockquote className="text-sm leading-relaxed break-words whitespace-pre-line text-neutral-800 dark:text-neutral-200">
      {parts.map((p, i) =>
        p.op === 'removed' ? (
          <span key={i}>
            <span className="sr-only">[removed: </span>
            <del className="rounded-sm bg-rose-50 text-rose-800 decoration-rose-500/70 dark:bg-rose-950/60 dark:text-rose-200 dark:decoration-rose-400/70">
              {p.text}
            </del>
            <span className="sr-only">] </span>
          </span>
        ) : p.op === 'added' ? (
          <span key={i}>
            <span className="sr-only">[added: </span>
            <ins className="rounded-sm bg-emerald-50 text-emerald-900 underline decoration-emerald-600/60 decoration-2 underline-offset-2 dark:bg-emerald-950/60 dark:text-emerald-200 dark:decoration-emerald-400/70">
              {p.text}
            </ins>
            <span className="sr-only">] </span>
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </blockquote>
  );
}

function Pane({
  side,
  label,
  claim,
  parts,
  hidden,
}: {
  side: Side;
  label?: string;
  claim?: Claim;
  /** This pane's changed lines, diffed against the other pane's; empty when none changed. */
  parts: DiffPart[];
  /** How many unchanged lines of this passage are left out. */
  hidden: number;
}) {
  const quote = claim?.data.quote;
  const locator = claim?.data.locator;
  return (
    <section
      aria-label={label ? `${side}, ${label}` : side}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h3 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        {side}
        {label && <span className="font-normal normal-case"> · {label}</span>}
      </h3>
      {!claim ? (
        <Empty>This passage was deleted or isn’t in this project</Empty>
      ) : !quote ? (
        <Empty>No passage quoted</Empty>
      ) : parts.length > 0 ? (
        <Passage parts={parts} />
      ) : (
        <p className="text-sm text-neutral-400 italic dark:text-neutral-500">
          {side === 'Before' ? 'Nothing here before' : 'Nothing in its place'}
        </p>
      )}
      {quote && hidden > 0 && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {hidden} unchanged {hidden === 1 ? 'line' : 'lines'} not shown
        </p>
      )}
      {claim && (
        <div className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1">
          <CertaintyMark claim={claim} />
          {locator && (
            <span className="min-w-0 truncate text-xs text-neutral-400 dark:text-neutral-500">
              <span className="sr-only">Where: </span>
              {locator}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

const whole = (text: string): DiffPart[] => [{ op: 'same', text }];
const lineCount = (text: string) => text.split('\n').filter((l) => l.trim()).length;

export function BeforeAfter({ node }: { node: NodeOf<'BeforeAfter'> }) {
  const data = useViewData();
  const stated = findClaim(data, node.claim);
  const before = findClaim(data, node.before);
  const after = findClaim(data, node.after);
  if (!before && !after)
    return <Empty>These passages were deleted or aren’t in this project</Empty>;
  const beforeQuote = before?.data.quote ?? '';
  const afterQuote = after?.data.quote ?? '';
  const changed = changedLines(beforeQuote, afterQuote);
  const was = changed.before.join('\n');
  const now = changed.after.join('\n');
  const same = Boolean(beforeQuote && afterQuote && !was && !now);
  return (
    <div className="@container space-y-3">
      {stated && (
        <p className="font-semibold text-neutral-900 dark:text-neutral-50">
          {stated.data.statement}
        </p>
      )}
      <div className="grid gap-3 @lg:grid-cols-2">
        <Pane
          side="Before"
          label={node.beforeLabel}
          claim={before}
          parts={same ? whole(beforeQuote) : was ? paneParts('Before', was, now) : []}
          hidden={same ? 0 : lineCount(beforeQuote) - changed.before.length}
        />
        <Pane
          side="After"
          label={node.afterLabel}
          claim={after}
          parts={same ? whole(afterQuote) : now ? paneParts('After', was, now) : []}
          hidden={same ? 0 : lineCount(afterQuote) - changed.after.length}
        />
      </div>
      {same ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          The two passages are the same.
        </p>
      ) : (
        beforeQuote &&
        afterQuote && (
          <p aria-hidden className="flex gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              <span className="rounded-sm bg-rose-50 px-0.5 text-rose-800 line-through decoration-rose-500/70 dark:bg-rose-950/60 dark:text-rose-200">
                struck
              </span>{' '}
              removed
            </span>
            <span>
              <span className="rounded-sm bg-emerald-50 px-0.5 text-emerald-900 underline decoration-emerald-600/60 decoration-2 underline-offset-2 dark:bg-emerald-950/60 dark:text-emerald-200">
                underlined
              </span>{' '}
              added
            </span>
          </p>
        )
      )}
    </div>
  );
}
