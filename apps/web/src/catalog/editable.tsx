import { ENTITIES, type Entity } from '@pharos/schema';
import clsx from 'clsx';
import { ExternalLink, Pencil, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatDate, humanize } from '../lib/format';
import { useViewData } from './context';
import { labelOf } from './interactive';
import { BUTTON, Markdown } from './ui';

/** "dueDate" → "due date", "successCriteria" → "success criteria". */
function words(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Saves one field as an undoable revision; `null` clears it. */
function useSaveField(entity: Entity) {
  const { actions } = useViewData();
  return (field: string, value: unknown) => {
    const before = (entity.data as Record<string, unknown>)[field];
    if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return;
    const isLabel = field === ENTITIES[entity.type].label;
    const noun = entity.type.replace('_', ' ');
    const message = isLabel
      ? `Rename ${noun} “${labelOf(entity)}” to “${value}”`
      : value === null
        ? `Clear the ${words(field)} of “${labelOf(entity)}”`
        : `Edit the ${words(field)} of “${labelOf(entity)}”`;
    void actions.apply(
      message,
      [{ op: 'update', type: entity.type, id: entity.id, data: { [field]: value } }],
      {
        undoable: true,
      },
    );
  };
}

const INPUT =
  'w-full rounded-md border border-sky-300 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-sky-200 dark:border-sky-800 dark:bg-neutral-900 dark:focus:ring-sky-900';
const EDIT_HINT =
  'inline-flex shrink-0 items-center rounded p-0.5 text-neutral-400 opacity-0 group-hover/edit:opacity-100 hover:text-neutral-700 focus:opacity-100 dark:hover:text-neutral-200';

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

/** The item's name, renamed in place: click it, type, Enter (or click away) saves, Esc cancels. */
export function EditableTitle({ entity, prefix }: { entity: Entity; prefix?: ReactNode }) {
  const save = useSaveField(entity);
  const [editing, setEditing] = useState(false);
  const field = ENTITIES[entity.type].label;
  const value = labelOf(entity);
  const commit = (text: string) => {
    setEditing(false);
    if (text.trim()) save(field, text.trim());
  };
  return (
    <div className="flex items-start gap-2">
      {prefix}
      {editing ? (
        <input
          aria-label="Name"
          autoFocus
          defaultValue={value}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className={clsx(INPUT, 'text-lg font-semibold')}
        />
      ) : (
        <h2
          role="button"
          tabIndex={0}
          title="Click to rename"
          onClick={() => setEditing(true)}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
          className="cursor-text rounded px-1 -mx-1 text-lg leading-snug font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {value}
        </h2>
      )}
    </div>
  );
}

/** Long text (markdown): shown rendered, edited in a text area with Save / Cancel. */
export function EditableMarkdown({ entity, field }: { entity: Entity; field: string }) {
  const save = useSaveField(entity);
  const value = ((entity.data as Record<string, unknown>)[field] as string | undefined) ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    save(field, draft.trim() ? draft.trim() : null);
    setDraft(null);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
    if (e.key === 'Escape') {
      e.stopPropagation();
      setDraft(null);
    }
  };
  if (draft !== null) {
    return (
      <div className="space-y-2">
        <textarea
          aria-label={humanize(words(field))}
          autoFocus
          rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={keys}
          className={clsx(INPUT, 'font-mono text-[13px] leading-relaxed')}
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={commit} className={BUTTON.primary}>
            Save
          </button>
          <button type="button" onClick={() => setDraft(null)} className={BUTTON.secondary}>
            Cancel
          </button>
          <span className="text-xs text-neutral-400">Markdown · ⌘↵ to save · Esc to cancel</span>
        </div>
      </div>
    );
  }
  if (!value) return <AddButton label={`Add ${words(field)}`} onClick={() => setDraft('')} />;
  return (
    <div className="group/edit relative">
      <Markdown>{value}</Markdown>
      <button
        type="button"
        aria-label={`Edit ${words(field)}`}
        onClick={() => setDraft(value)}
        className={clsx(EDIT_HINT, 'absolute -top-1 right-0 bg-white dark:bg-neutral-900')}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

/** A one-line text field (estimate, link, path…), edited in place. */
export function EditableText({
  entity,
  field,
  placeholder,
}: {
  entity: Entity;
  field: string;
  placeholder?: string;
}) {
  const save = useSaveField(entity);
  const value = ((entity.data as Record<string, unknown>)[field] as string | undefined) ?? '';
  const [editing, setEditing] = useState(false);
  const commit = (text: string) => {
    setEditing(false);
    save(field, text.trim() ? text.trim() : null);
  };
  if (editing) {
    return (
      <input
        aria-label={humanize(words(field))}
        autoFocus
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className={clsx(INPUT, 'max-w-72')}
      />
    );
  }
  if (!value) return <AddButton label="Add" onClick={() => setEditing(true)} />;
  const link = /^https?:\/\//.test(value);
  return (
    <span className="group/edit inline-flex max-w-full items-center gap-1">
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 break-all text-sky-600 hover:underline dark:text-sky-400"
        >
          {value} <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : (
        <span className="break-words">{value}</span>
      )}
      <button
        type="button"
        aria-label={`Edit ${words(field)}`}
        onClick={() => setEditing(true)}
        className={EDIT_HINT}
      >
        <Pencil className="size-3.5" />
      </button>
    </span>
  );
}

/** A date (YYYY-MM-DD) with the browser's date picker and a clear button. */
export function EditableDate({ entity, field }: { entity: Entity; field: string }) {
  const save = useSaveField(entity);
  const value = ((entity.data as Record<string, unknown>)[field] as string | undefined) ?? '';
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        aria-label={humanize(words(field))}
        value={value}
        onChange={(e) => save(field, e.target.value || null)}
        className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900 dark:[color-scheme:dark]"
      />
      {value && (
        <button
          type="button"
          aria-label={`Clear ${words(field)}`}
          title={`Clear (${formatDate(value, true)})`}
          onClick={() => save(field, null)}
          className="rounded p-0.5 text-neutral-400 hover:text-rose-600"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** A list of short lines (e.g. success criteria), edited as one line per item. */
export function EditableList({ entity, field }: { entity: Entity; field: string }) {
  const save = useSaveField(entity);
  const items = ((entity.data as Record<string, unknown>)[field] as string[] | undefined) ?? [];
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    save(
      field,
      draft
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <div className="space-y-2">
        <textarea
          aria-label={humanize(words(field))}
          autoFocus
          rows={Math.max(3, draft.split('\n').length + 1)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          placeholder="One per line"
          className={INPUT}
        />
        <div className="flex gap-2">
          <button type="button" onClick={commit} className={BUTTON.primary}>
            Save
          </button>
          <button type="button" onClick={() => setDraft(null)} className={BUTTON.secondary}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (!items.length) return <AddButton label="Add" onClick={() => setDraft('')} />;
  return (
    <div className="group/edit flex items-start gap-1">
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
      <button
        type="button"
        aria-label={`Edit ${words(field)}`}
        onClick={() => setDraft(items.join('\n'))}
        className={EDIT_HINT}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}
