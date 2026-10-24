import { itemsSize, type DecisionItem } from '@pharos/schema';
import clsx from 'clsx';
import { useState } from 'react';

/**
 * The items a decision's choice applies to (a cleanup's folders), each with a checkbox, all ticked
 * at first: the owner unticks what to keep, and choosing the option the items go with saves the
 * ticked ids (items.selected). Shared by the DecisionBlock, the details panel and the desk.
 */

/** The ticked ids of a list, all ticked at first. */
export function useTicked(list: DecisionItem[] | undefined) {
  const ids = (list ?? []).map((i) => i.id);
  const key = ids.join('\n');
  const [state, setState] = useState<{ key: string; ticked: ReadonlySet<string> }>(() => ({
    key,
    ticked: new Set(ids),
  }));
  // The agent changed the list: start again from all ticked.
  const ticked = state.key === key ? state.ticked : new Set(ids);
  const setTicked = (next: ReadonlySet<string>) => setState({ key, ticked: next });
  return [ticked, setTicked] as const;
}

/** The ticked ids in the list's order. */
export function tickedIds(list: DecisionItem[], ticked: ReadonlySet<string>): string[] {
  return list.filter((i) => ticked.has(i.id)).map((i) => i.id);
}

/** "5 of 7 selected · 280 MB": the size only when every ticked item names one. */
export function selectionLine(list: DecisionItem[], ticked: ReadonlySet<string>): string {
  const picked = list.filter((i) => ticked.has(i.id));
  const size = itemsSize(picked);
  return `${picked.length} of ${list.length} selected${size ? ` · ${size}` : ''}`;
}

const LINK =
  'rounded-control px-1 text-xs font-medium text-sky-700 hover:underline disabled:text-faint disabled:no-underline dark:text-sky-300';

export function ItemChecklist({
  list,
  ticked,
  onChange,
  optionLabel,
  compact = false,
  disabled = false,
}: {
  list: DecisionItem[];
  ticked: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  /** The option the selection goes with ("Move to Trash"). */
  optionLabel?: string;
  /** The desk's tighter rows. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const all = ticked.size === list.length;
  const none = ticked.size === 0;
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div
      data-decision-items=""
      role="group"
      aria-label={optionLabel ? `Items for “${optionLabel}”` : 'Items'}
      className="rounded-tile border border-line"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        <p aria-live="polite" className="text-xs text-muted tabular-nums">
          <span data-items-count="" className="font-medium text-ink">
            {selectionLine(list, ticked)}
          </span>
          {optionLabel && <span> for “{optionLabel}”</span>}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || all}
            onClick={() => onChange(new Set(list.map((i) => i.id)))}
            className={LINK}
          >
            Select all
          </button>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <button
            type="button"
            disabled={disabled || none}
            onClick={() => onChange(new Set())}
            className={LINK}
          >
            Select none
          </button>
        </div>
      </div>
      <ul className={clsx('overflow-y-auto', compact ? 'max-h-64' : 'max-h-80')}>
        {list.map((item) => (
          <li key={item.id} className="border-b border-line last:border-b-0">
            <label
              className={clsx(
                'flex cursor-pointer items-start gap-2.5 px-3 hover:bg-sunken',
                compact ? 'py-1.5' : 'py-2',
              )}
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={ticked.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 size-4 shrink-0 accent-neutral-900 dark:accent-neutral-100"
              />
              <span className="min-w-0">
                <span
                  className={clsx(
                    'block text-sm break-words',
                    ticked.has(item.id) ? 'text-ink' : 'text-muted',
                  )}
                >
                  {item.label}
                </span>
                {item.detail && (
                  <span className="block text-xs text-muted tabular-nums">{item.detail}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
