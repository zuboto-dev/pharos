import { fieldReader, runQuery, type Entity, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { useViewData, type ViewData } from '../context';
import { Empty } from '../ui';
import { CertaintyMark } from './knowledge';

// R4.2 stub (docs/reframe/r4-plan.md block 4): the title is a stored claim; horizontal bars with
// their values and labels on them, one in the accent colour. R4 item F builds out the full block
// (tap a bar for its claim, quote and source; option labels and names for counted groups).

type Bar = { key: string; label: string; value: number; unit?: string; claim?: Entity<'claim'> };

function barsOf(data: ViewData, node: NodeOf<'FindingChart'>): Bar[] {
  if (node.bars)
    return runQuery(data, 'claim', { sort: [{ field: 'order' }], ...node.bars }).flatMap((c) =>
      c.data.figure ? [{ key: c.id, ...c.data.figure, claim: c }] : [],
    );
  if (!node.count) return [];
  const read = fieldReader(data);
  const groups = new Map<string, number>();
  for (const row of runQuery(data, node.count.query.type, node.count.query)) {
    const { value } = read(row, node.count.by);
    for (const v of Array.isArray(value) ? value : [value]) {
      const key = v === undefined || v === null || v === '' ? 'None' : String(v);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
  }
  let bars = [...groups].map(([key, value]) => ({ key, label: key, value }));
  if (node.count.sort === 'count') bars = bars.sort((a, b) => b.value - a.value);
  return bars.slice(0, node.count.limit);
}

export function FindingChart({ node }: { node: NodeOf<'FindingChart'> }) {
  const data = useViewData();
  const claim = node.claim ? runQuery(data, 'claim', { where: { id: node.claim } })[0] : undefined;
  const bars = barsOf(data, node);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const lit = node.highlight ?? bars[0]?.key;
  return (
    <figure className="space-y-3">
      {claim && (
        <figcaption className="space-y-1">
          <p className="font-semibold text-neutral-900 dark:text-neutral-50">
            {claim.data.statement}
          </p>
          <CertaintyMark claim={claim} />
        </figcaption>
      )}
      {bars.length ? (
        <ul className="space-y-1.5" aria-label={claim?.data.statement ?? 'Bars'}>
          {bars.map((b) => (
            <li key={b.key} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate text-neutral-700 dark:text-neutral-300">
                {b.label}
              </span>
              <span className="relative h-5 min-w-0 flex-1">
                <span
                  aria-hidden
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-sm',
                    b.key === lit ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-700',
                  )}
                  style={{ width: `${(b.value / max) * 100}%` }}
                />
              </span>
              <span className="shrink-0 text-neutral-600 tabular-nums dark:text-neutral-400">
                {b.value.toLocaleString()}
                {b.unit ? ` ${b.unit}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No numbers to draw yet</Empty>
      )}
    </figure>
  );
}
