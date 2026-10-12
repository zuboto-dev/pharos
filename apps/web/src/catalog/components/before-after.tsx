import { diffWords, runQuery, type Entity, type NodeOf } from '@pharos/schema';
import { useViewData, type ViewData } from '../context';
import { Empty } from '../ui';
import { CertaintyMark } from './knowledge';

// R4.2 stub (docs/reframe/r4-plan.md block 3): the stated change, then the two quoted passages
// with removed words struck and added words marked. R4 item E builds out the full block.

type Claim = Entity<'claim'>;

function findClaim(data: ViewData, id: string | undefined): Claim | undefined {
  return id ? runQuery(data, 'claim', { where: { id } })[0] : undefined;
}

function Pane({
  side,
  label,
  claim,
  parts,
}: {
  side: 'Before' | 'After';
  label?: string;
  claim?: Claim;
  parts: ReturnType<typeof diffWords>;
}) {
  const hidden = side === 'Before' ? 'added' : 'removed';
  return (
    <section
      aria-label={label ? `${side}, ${label}` : side}
      className="min-w-0 space-y-2 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h3 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
        {side}
        {label && <span className="font-normal normal-case"> · {label}</span>}
      </h3>
      {claim?.data.quote ? (
        <blockquote className="text-sm break-words text-neutral-800 dark:text-neutral-200">
          {parts
            .filter((p) => p.op !== hidden)
            .map((p, i) =>
              p.op === 'removed' ? (
                <del
                  key={i}
                  className="bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                >
                  {p.text}
                </del>
              ) : p.op === 'added' ? (
                <ins
                  key={i}
                  className="bg-emerald-50 text-emerald-800 no-underline dark:bg-emerald-950 dark:text-emerald-300"
                >
                  {p.text}
                </ins>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
        </blockquote>
      ) : (
        <Empty>No passage quoted</Empty>
      )}
      {claim && <CertaintyMark claim={claim} />}
    </section>
  );
}

export function BeforeAfter({ node }: { node: NodeOf<'BeforeAfter'> }) {
  const data = useViewData();
  const stated = findClaim(data, node.claim);
  const before = findClaim(data, node.before);
  const after = findClaim(data, node.after);
  if (!before && !after)
    return <Empty>These passages were deleted or aren’t in this project</Empty>;
  const parts = diffWords(before?.data.quote ?? '', after?.data.quote ?? '');
  return (
    <div className="space-y-3">
      {stated && (
        <p className="font-semibold text-neutral-900 dark:text-neutral-50">
          {stated.data.statement}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Pane side="Before" label={node.beforeLabel} claim={before} parts={parts} />
        <Pane side="After" label={node.afterLabel} claim={after} parts={parts} />
      </div>
    </div>
  );
}
