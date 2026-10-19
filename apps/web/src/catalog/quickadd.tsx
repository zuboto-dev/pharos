import type { EntityType, Where } from '@pharos/schema';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useViewData } from './context';
import { TYPE_LABELS } from './interactive';
import { BUTTON } from './ui';
import { useInDocument } from './variant';

/**
 * Field values a new item should get so it shows up in a widget filtered by `where`: exact
 * conditions are copied (with "$currentStage" resolved); ranges and negations are ignored.
 */
export function defaultsFrom(
  where: Where | undefined,
  currentStageId: string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, condition] of Object.entries(where ?? {})) {
    if (field === 'id') continue;
    const value = Array.isArray(condition) && condition.length === 1 ? condition[0] : condition;
    if (value === '$currentStage') {
      if (currentStageId) out[field] = currentStageId;
    } else if (typeof value === 'string' && !value.startsWith('$')) {
      out[field] = value;
    }
  }
  return out;
}

/** Creates an item in the current project as one undoable revision. */
export function useCreate() {
  const { project, actions } = useViewData();
  return (type: EntityType, data: Record<string, unknown>) => {
    const name = (data.title ?? data.name) as string;
    return actions.apply(
      `Add ${TYPE_LABELS[type].toLowerCase()} “${name}”`,
      [{ op: 'create', type, data: { projectId: project.id, ...data } }],
      { undoable: true },
    );
  };
}

/** A "+ Add …" button that turns into a title field; Enter adds and keeps it open for the next one. */
export function QuickAdd({
  label,
  onAdd,
  className,
  variant = 'row',
}: {
  label: string;
  onAdd: (title: string) => Promise<unknown>;
  className?: string;
  /** `button`: a button for an empty state (v0.2 B8), instead of a quiet row under a list. */
  variant?: 'row' | 'button';
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  // A report document (R14) is read-only: nothing is added from it.
  if (useInDocument()) return null;
  if (!open) {
    return (
      <button
        type="button"
        data-no-open
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          variant === 'button'
            ? clsx(BUTTON.accent, className)
            : clsx(
                'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-sm text-muted hover:bg-subtle hover:text-ink',
                className,
              )
        }
      >
        <Plus className="size-3.5" aria-hidden /> {label}
      </button>
    );
  }
  return (
    <form
      data-no-open
      className={clsx(variant === 'button' && 'w-full', className)}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        setValue('');
        void onAdd(title);
      }}
    >
      <input
        autoFocus
        aria-label={label}
        placeholder={`${label}… (Enter to add, Esc to close)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            setValue('');
          }
        }}
        onBlur={() => !value.trim() && setOpen(false)}
        className="w-full rounded-control border border-sky-300 bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-200 dark:border-sky-800 dark:focus:ring-sky-900"
      />
    </form>
  );
}
