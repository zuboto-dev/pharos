import {
  OPTION_COLORS,
  OPTION_FIELDS,
  defaultOptions,
  findOption,
  meaningOf,
  newOptionValue,
  optionsFor,
  valueFor,
  type Operation,
  type Option,
  type OptionKey,
} from '@pharos/schema';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { humanize, plural } from '../lib/format';
import { useViewData } from './context';
import { Select } from './select';
import { Badge, DOT_TONES, Dot } from './ui';
import { useInDocument } from './variant';

/** The project's options for each option field, with lookups that tolerate unknown values. */
export function useOptions() {
  const { project } = useViewData();
  return {
    list: (key: OptionKey) => optionsFor(project, key),
    get: (key: OptionKey, value: string): Option =>
      findOption(project, key, value) ?? {
        value,
        label: humanize(value),
        meaning: value,
        color: 'neutral',
      },
    meaning: (key: OptionKey, value: string | undefined) => meaningOf(project, key, value),
    valueFor: (key: OptionKey, meaning: string) => valueFor(project, key, meaning),
  };
}

export function OptionBadge({ field, value }: { field: OptionKey; value: string }) {
  const option = useOptions().get(field, value);
  return <Badge tone={option.color}>{option.label}</Badge>;
}

export function OptionDot({
  field,
  value,
  className,
}: {
  field: OptionKey;
  value: string;
  className?: string;
}) {
  return <Dot tone={useOptions().get(field, value).color} className={className} />;
}

/** A small button that opens the options editor for a field. */
export function EditOptionsButton({
  field,
  className,
  label,
}: {
  field: OptionKey;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // A report document (R14) is read-only.
  if (useInDocument()) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Edit ${OPTION_FIELDS[field].label.toLowerCase()} options`}
        aria-label={`Edit ${OPTION_FIELDS[field].label.toLowerCase()} options`}
        className={clsx(
          'inline-flex items-center gap-1 rounded-control p-1 text-xs text-faint hover:bg-subtle hover:text-ink-soft',
          className,
        )}
      >
        <Pencil className="size-3" />
        {label}
      </button>
      {open && <OptionsEditor field={field} onClose={() => setOpen(false)} />}
    </>
  );
}

const INPUT = 'min-w-0 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm';

/** How many entities use each value of an option field. */
function useUsage(field: OptionKey): Map<string, string[]> {
  const data = useViewData();
  const { type, field: name } = OPTION_FIELDS[field];
  const lists = {
    task: data.tasks,
    stage: data.stages,
    goal: data.goals,
    scope_item: data.scopeItems,
    artifact: data.artifacts,
    decision: data.decisions,
    claim: data.claims,
    file: data.files ?? [],
  } as const;
  const usage = new Map<string, string[]>();
  for (const entity of lists[type]) {
    const value = (entity.data as Record<string, unknown>)[name] as string;
    usage.set(value, [...(usage.get(value) ?? []), entity.id]);
  }
  return usage;
}

/**
 * Edits a project's options for one field: rename, recolour, change meaning, reorder, add, and
 * remove (moving anything that uses a removed option to another one). Each edit is a revision.
 */
export function OptionsEditor({ field, onClose }: { field: OptionKey; onClose: () => void }) {
  const { project, actions } = useViewData();
  const def = OPTION_FIELDS[field];
  const options = optionsFor(project, field);
  const usage = useUsage(field);
  const [newLabel, setNewLabel] = useState('');
  const [newMeaning, setNewMeaning] = useState<string>(def.meanings[0]!);
  const [removing, setRemoving] = useState<{ value: string; moveTo: string } | null>(null);
  // Meanings shown with their default name and colour, e.g. "Done" in green.
  const meaningChoices = defaultOptions(field).map((o) => ({
    value: o.meaning,
    label: o.label,
    color: o.color,
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (next: Option[], message: string, extra: Operation[] = []) =>
    actions.apply(message, [
      {
        op: 'update',
        type: 'project',
        id: project.id,
        data: {
          options: {
            ...project.data.options,
            [field]: next.map(({ value, label, meaning, color }) => ({
              value,
              label,
              meaning,
              color,
            })),
          },
        },
      },
      ...extra,
    ]);
  const change = (index: number, patch: Partial<Option>, message: string) =>
    save(
      options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
      message,
    );
  const move = (index: number, by: -1 | 1) => {
    const next = [...options];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    void save(next, `Reorder ${def.label.toLowerCase()} options`);
  };
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const option: Option = {
      value: newOptionValue(label, field, options),
      label,
      meaning: newMeaning,
      color: options.find((o) => o.meaning === newMeaning)?.color ?? 'neutral',
    };
    void save([...options, option], `Add “${label}” to ${def.label.toLowerCase()} options`);
    setNewLabel('');
  };
  const remove = (value: string, moveTo: string | null) => {
    const option = options.find((o) => o.value === value)!;
    const ids = usage.get(value) ?? [];
    const target = options.find((o) => o.value === moveTo);
    const moves: Operation[] = target
      ? ids.map((id) => ({ op: 'update', type: def.type, id, data: { [def.field]: target.value } }))
      : [];
    const message = target
      ? `Remove “${option.label}” from ${def.label.toLowerCase()} options, moving ${plural(ids.length, 'item')} to “${target.label}”`
      : `Remove “${option.label}” from ${def.label.toLowerCase()} options`;
    void save(
      options.filter((o) => o.value !== value),
      message,
      moves,
    );
    setRemoving(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${def.label} options`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-block bg-surface p-5 shadow-overlay">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">{def.label} options</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-control p-1 text-muted hover:bg-subtle"
          >
            <X className="size-5" />
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          “Counts as” keeps progress and highlights working: for example, a custom “In review”
          status can count as in progress.
        </p>
        <ul className="space-y-2">
          {options.map((option, i) => {
            const used = usage.get(option.value)?.length ?? 0;
            return (
              <li key={option.value} className="rounded-tile border border-line p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ColorPicker
                    value={option.color}
                    onChange={(color) => void change(i, { color }, `Recolor “${option.label}”`)}
                  />
                  <input
                    aria-label="Label"
                    defaultValue={option.label}
                    className={clsx(INPUT, 'flex-1')}
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== option.label)
                        void change(i, { label }, `Rename “${option.label}” to “${label}”`);
                      else e.target.value = option.label;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted">
                    counts as
                    <Select
                      label="Counts as"
                      value={option.meaning}
                      options={meaningChoices}
                      className="w-40"
                      onChange={(meaning) =>
                        void change(
                          i,
                          { meaning },
                          `Make “${option.label}” count as ${humanize(meaning).toLowerCase()}`,
                        )
                      }
                    />
                  </label>
                  <span className="w-14 text-right text-xs text-faint tabular-nums">
                    {used ? plural(used, 'use') : ''}
                  </span>
                  <div className="flex">
                    <button
                      type="button"
                      aria-label={`Move ${option.label} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="rounded p-1 text-faint hover:text-neutral-700 disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${option.label} down`}
                      disabled={i === options.length - 1}
                      onClick={() => move(i, 1)}
                      className="rounded p-1 text-faint hover:text-neutral-700 disabled:opacity-30"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${option.label}`}
                      disabled={options.length === 1}
                      onClick={() =>
                        used
                          ? setRemoving({
                              value: option.value,
                              moveTo:
                                options.find(
                                  (o) => o.value !== option.value && o.meaning === option.meaning,
                                )?.value ?? options.find((o) => o.value !== option.value)!.value,
                            })
                          : remove(option.value, null)
                      }
                      className="rounded p-1 text-faint hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                {removing?.value === option.value && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-control bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                    {plural(used, 'item')} use “{option.label}”. Move them to
                    <Select
                      label="Move to"
                      value={removing.moveTo}
                      className="w-44"
                      onChange={(moveTo) => setRemoving({ ...removing, moveTo })}
                      options={options
                        .filter((o) => o.value !== option.value)
                        .map((o) => ({ value: o.value, label: o.label, color: o.color }))}
                    />
                    <button
                      type="button"
                      onClick={() => remove(option.value, removing.moveTo)}
                      className="rounded-control bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700"
                    >
                      Move and remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="px-1 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="New option"
            placeholder="New option…"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className={clsx(INPUT, 'flex-1')}
          />
          <label className="flex items-center gap-1 text-xs text-muted">
            counts as
            <Select
              label="New option counts as"
              value={newMeaning}
              options={meaningChoices}
              className="w-40"
              onChange={setNewMeaning}
            />
          </label>
          <button
            type="submit"
            disabled={!newLabel.trim()}
            className="inline-flex items-center gap-1 rounded-control bg-inverse px-2.5 py-1 text-sm text-on-inverse hover:bg-neutral-800 disabled:opacity-40"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </form>
      </div>
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: Option['color'];
  onChange: (color: Option['color']) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Color"
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-control border border-line-strong"
      >
        <span className={clsx('size-3 rounded-full', DOT_TONES[value])} />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-10 flex gap-1 rounded-tile border border-line-strong bg-surface p-1.5 shadow-md">
          {OPTION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => {
                setOpen(false);
                if (color !== value) onChange(color);
              }}
              className={clsx(
                'flex size-6 items-center justify-center rounded-control hover:bg-subtle',
                color === value && 'ring-2 ring-sky-400',
              )}
            >
              <span className={clsx('size-3 rounded-full', DOT_TONES[color])} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
