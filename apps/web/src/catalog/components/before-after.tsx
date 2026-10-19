import {
  changedLines,
  diffWords,
  runQuery,
  type DiffPart,
  type Entity,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { CHART, Legend } from '../chart';
import { useViewData, type ViewData } from '../context';
import { Columns2 } from 'lucide-react';
import { AskAgentButton, EmptyState } from '../empty-state';
import { Empty } from '../ui';
import { CertaintyMark, ClaimBasis } from './knowledge';
import { useInDocument } from '../variant';

// R4 block 3 (docs/reframe/r4-plan.md): a change shown, not told. The stated change sits on top;
// beneath it its own certainty mark and quote/assumption; below that two panes, before and after,
// show only the lines of each claim's quoted passage that changed (in order, so a moved line
// counts), with removed words struck and added words underlined. Colour is never the only cue:
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
    <blockquote className="text-sm leading-relaxed break-words whitespace-pre-line text-ink">
      {parts.map((p, i) =>
        p.op === 'removed' ? (
          <span key={i}>
            <span className="sr-only">[removed: </span>
            <del className={CHART.removed}>{p.text}</del>
            <span className="sr-only">] </span>
          </span>
        ) : p.op === 'added' ? (
          <span key={i}>
            <span className="sr-only">[added: </span>
            <ins className={CHART.added}>{p.text}</ins>
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
  // In a report document (R14) the two sides sit in the text under a hairline, not in cards.
  const inDocument = useInDocument();
  return (
    <section
      aria-label={label ? `${side}, ${label}` : side}
      className={clsx(
        'flex min-w-0 flex-col gap-2',
        inDocument
          ? 'border-t border-line pt-3'
          : 'rounded-block border border-line bg-surface p-4',
      )}
    >
      <h3 className={CHART.axis}>
        {side}
        {label && <span className="font-normal normal-case"> · {label}</span>}
      </h3>
      {!claim ? (
        <Empty>This passage was deleted or isn’t in this project.</Empty>
      ) : !quote ? (
        <Empty>No passage quoted yet.</Empty>
      ) : parts.length > 0 ? (
        <Passage parts={parts} />
      ) : (
        <p className="text-sm text-faint italic">
          {side === 'Before' ? 'Nothing here before' : 'Nothing in its place'}
        </p>
      )}
      {quote && hidden > 0 && (
        <p className="text-xs text-faint">
          {hidden} unchanged {hidden === 1 ? 'line' : 'lines'} not shown
        </p>
      )}
      {claim && (
        <div className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1">
          <CertaintyMark claim={claim} />
          {locator && (
            <span className={clsx('min-w-0 truncate', CHART.note)}>
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
    return (
      <EmptyState
        icon={Columns2}
        title="These passages were deleted or aren’t in this project"
        hint="Ask your agent to quote the passages to compare."
      >
        <AskAgentButton question="Quote the before and after passages this block should compare." />
      </EmptyState>
    );
  const beforeQuote = before?.data.quote ?? '';
  const afterQuote = after?.data.quote ?? '';
  const changed = changedLines(beforeQuote, afterQuote);
  const both = Boolean(beforeQuote && afterQuote);
  const same = both && changed.same;
  // Only the order changed: every line taken out is put back elsewhere. Show both passages whole.
  const sorted = (lines: string[]) => [...lines].sort().join('\n');
  const moved = both && !same && sorted(changed.before) === sorted(changed.after);
  const showWhole = same || moved;
  const was = changed.before.join('\n');
  const now = changed.after.join('\n');
  return (
    <div className="@container space-y-3">
      {stated && (
        <div className="space-y-1">
          <p className={CHART.title}>{stated.data.statement}</p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <CertaintyMark claim={stated} />
            <ClaimBasis claim={stated} />
          </div>
        </div>
      )}
      <div className="grid gap-3 @lg:grid-cols-2">
        <Pane
          side="Before"
          label={node.beforeLabel}
          claim={before}
          parts={showWhole ? whole(beforeQuote) : was ? paneParts('Before', was, now) : []}
          hidden={showWhole ? 0 : lineCount(beforeQuote) - changed.before.length}
        />
        <Pane
          side="After"
          label={node.afterLabel}
          claim={after}
          parts={showWhole ? whole(afterQuote) : now ? paneParts('After', was, now) : []}
          hidden={showWhole ? 0 : lineCount(afterQuote) - changed.after.length}
        />
      </div>
      {same ? (
        <p className="text-xs text-muted">The two passages are the same.</p>
      ) : moved ? (
        <p className="text-xs text-muted">The same lines, in a different order.</p>
      ) : (
        both && (
          <Legend
            items={[
              {
                swatch: <span className={clsx(CHART.removed, 'px-0.5 line-through')}>struck</span>,
                label: 'removed',
              },
              {
                swatch: <span className={clsx(CHART.added, 'px-0.5')}>underlined</span>,
                label: 'added',
              },
            ]}
          />
        )
      )}
    </div>
  );
}
