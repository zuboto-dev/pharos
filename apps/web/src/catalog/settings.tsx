import { ViewNode, type ComponentName } from '@pharos/schema';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { humanize } from '../lib/format';
import { useViewData } from './context';
import { useOptions } from './options';
import { Select } from './select';
import { BUTTON } from './ui';

type Draft = Record<string, unknown> & { component: ComponentName };
type Where = Record<string, unknown>;

const FIELD = 'w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm';

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-neutral-900 dark:accent-neutral-100"
      />
      {label}
    </label>
  );
}

/** Returns `where` with `field` set (or removed when value is undefined); undefined when empty. */
function setWhere(where: Where | undefined, field: string, value: unknown): Where | undefined {
  const next = { ...where };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return Object.keys(next).length ? next : undefined;
}

/** Sets a key on a filter object, dropping the filter when it becomes empty. */
function setFilterKey(filter: Record<string, unknown> | undefined, key: string, value: unknown) {
  const next = { ...filter };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

/**
 * Which stages a widget covers, as a condition on `field` (stageId for tasks, id for stages):
 * all, the project's current stage, or specific stages.
 */
function StageScope({
  value,
  onChange,
  noun,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  /** What's being filtered by stage, e.g. "tasks"; omit when the items are stages themselves. */
  noun?: string;
}) {
  const { stages } = useViewData();
  const mode = value === undefined ? 'all' : value === '$currentStage' ? 'current' : 'pick';
  const picked = Array.isArray(value)
    ? (value as string[])
    : typeof value === 'string' && mode === 'pick'
      ? [value]
      : [];
  return (
    <div className="space-y-2">
      <Select
        label="Stages"
        value={mode}
        onChange={(m) =>
          onChange(
            m === 'all'
              ? undefined
              : m === 'current'
                ? '$currentStage'
                : stages.slice(0, 1).map((s) => s.id),
          )
        }
        options={[
          { value: 'all', label: 'All stages' },
          {
            value: 'current',
            label: 'Current stage',
            description: 'Follows the project as it moves to the next stage',
          },
          { value: 'pick', label: 'Specific stages…', description: 'Choose stages from a list' },
        ]}
      />
      {mode === 'pick' && (
        <div className="grid gap-1 rounded-control bg-sunken p-2 sm:grid-cols-2">
          {stages.map((stage) => (
            <Check
              key={stage.id}
              label={stage.data.name}
              checked={picked.includes(stage.id)}
              onChange={(on) => {
                const ids = on ? [...picked, stage.id] : picked.filter((id) => id !== stage.id);
                onChange(ids.length ? ids : undefined);
              }}
            />
          ))}
          {!stages.length && <p className="text-xs text-muted">No stages yet</p>}
        </div>
      )}
      <p className="text-xs text-muted">
        {noun ? `Which stages’ ${noun} to show.` : 'Which stages to show.'}
      </p>
    </div>
  );
}

const TASK_COLUMNS = [
  'status',
  'priority',
  'stage',
  'assignee',
  'estimate',
  'dueDate',
  'dependsOn',
] as const;
/** Task-based components whose `filter` can be narrowed to stages. */
const TASK_FILTERED = new Set([
  'KanbanBoard',
  'TaskTable',
  'TaskChecklist',
  'DependencyGraph',
  'AssigneeMatrix',
  'ArtifactGallery',
]);
const STAGE_LISTS = new Set(['StageTracker', 'Timeline', 'MilestoneList']);

/** Settings for one widget, with controls chosen per component. Saves the whole node. */
export function WidgetSettings({
  node,
  onSave,
  onClose,
}: {
  node: ViewNode;
  onSave: (node: ViewNode) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(node) as Draft);
  const [error, setError] = useState<string | null>(null);
  const options = useOptions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key: string, value: unknown) =>
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (value === undefined || value === '') delete next[key];
      return next;
    });
  const filter = draft.filter as Record<string, unknown> | undefined;
  const filterWhere = filter?.where as Where | undefined;
  const setFilterWhere = (field: string, value: unknown) =>
    set('filter', setFilterKey(filter, 'where', setWhere(filterWhere, field, value)));

  const c = draft.component;
  const controls: ReactNode[] = [];

  if (!['ProjectHeader'].includes(c)) {
    controls.push(
      <Row key="title" label="Title">
        <input
          aria-label="Title"
          value={(draft.title as string) ?? ''}
          onChange={(e) => set('title', e.target.value)}
          className={FIELD}
        />
      </Row>,
    );
  }
  if (TASK_FILTERED.has(c)) {
    controls.push(
      <Row key="stages" label="Stages">
        <StageScope
          value={filterWhere?.stageId}
          onChange={(v) => setFilterWhere('stageId', v)}
          noun={c === 'ArtifactGallery' ? 'artifacts' : 'tasks'}
        />
      </Row>,
    );
  }
  if (STAGE_LISTS.has(c)) {
    controls.push(
      <Row key="stages" label="Stages">
        <StageScope value={filterWhere?.id} onChange={(v) => setFilterWhere('id', v)} />
      </Row>,
    );
  }
  if (c === 'ProgressRing') {
    const where = draft.where as Where | undefined;
    controls.push(
      <Row key="label" label="Label">
        <input
          aria-label="Label"
          value={(draft.label as string) ?? ''}
          onChange={(e) => set('label', e.target.value)}
          className={FIELD}
        />
      </Row>,
      <Row key="stages" label="Stages">
        <StageScope
          value={where?.stageId}
          onChange={(v) => set('where', setWhere(where, 'stageId', v))}
          noun="tasks"
        />
      </Row>,
    );
  }
  if (c === 'KanbanBoard') {
    const hidesCancelled =
      JSON.stringify(filterWhere?.status) === JSON.stringify({ not: 'cancelled' });
    controls.push(
      <Row key="group" label="Columns">
        <Select
          label="Group by"
          value={(draft.groupBy as string) ?? 'status'}
          onChange={(g) => set('groupBy', g === 'status' ? undefined : g)}
          options={[
            { value: 'status', label: 'By status', description: 'Columns for each task status' },
            { value: 'stage', label: 'By stage', description: 'Columns for each stage' },
            {
              value: 'assignee',
              label: 'By assignee',
              description: 'Columns for each person or agent',
            },
            { value: 'priority', label: 'By priority', description: 'Most urgent first' },
          ]}
        />
      </Row>,
      <div key="flags" className="space-y-1.5">
        <Check
          label="Hide cancelled tasks"
          checked={hidesCancelled}
          onChange={(on) => setFilterWhere('status', on ? { not: 'cancelled' } : undefined)}
        />
        <Check
          label="Hide empty columns"
          checked={Boolean(draft.hideEmpty)}
          onChange={(on) => set('hideEmpty', on || undefined)}
        />
      </div>,
    );
  }
  if (c === 'TaskTable') {
    const columns = (draft.columns as string[] | undefined) ?? [
      'status',
      'priority',
      'stage',
      'assignee',
    ];
    controls.push(
      <Row key="columns" label="Columns">
        <div className="grid grid-cols-2 gap-1">
          {TASK_COLUMNS.map((col) => (
            <Check
              key={col}
              label={
                col === 'dependsOn' ? 'Depends on' : col === 'dueDate' ? 'Due date' : humanize(col)
              }
              checked={columns.includes(col)}
              onChange={(on) =>
                set(
                  'columns',
                  TASK_COLUMNS.filter((x) => (x === col ? on : columns.includes(x))),
                )
              }
            />
          ))}
        </div>
      </Row>,
    );
  }
  if (c === 'TaskChecklist') {
    controls.push(
      <Row key="who" label="Assigned to">
        <Select
          label="Assigned to"
          value={(draft.assigneeKind as string) ?? ''}
          onChange={(k) => set('assigneeKind', k || undefined)}
          options={[
            { value: '', label: 'Everyone' },
            { value: 'human', label: 'People', description: 'Tasks assigned to a person' },
            { value: 'agent', label: 'Agents', description: 'Tasks assigned to an AI agent' },
          ]}
        />
      </Row>,
      <Check
        key="done"
        label="Hide finished tasks"
        checked={draft.hideDone !== false}
        onChange={(on) => set('hideDone', on ? undefined : false)}
      />,
    );
  }
  if (c === 'GoalTree') {
    controls.push(
      <Check
        key="criteria"
        label="Show success criteria"
        checked={draft.showCriteria !== false}
        onChange={(on) => set('showCriteria', on ? undefined : false)}
      />,
    );
  }
  if (c === 'ScopeBoard') {
    const kinds = (draft.kinds as string[] | undefined) ?? ['in', 'maybe', 'out'];
    controls.push(
      <Row key="kinds" label="Groups" hint="Custom groups show under the group they count as.">
        <div className="flex gap-3">
          {(['in', 'maybe', 'out'] as const).map((k) => (
            <Check
              key={k}
              label={
                options.list('scope_item.kind').find((o) => o.meaning === k)?.label ?? humanize(k)
              }
              checked={kinds.includes(k)}
              onChange={(on) => {
                const next = (['in', 'maybe', 'out'] as const).filter((x) =>
                  x === k ? on : kinds.includes(x),
                );
                set('kinds', next.length === 3 ? undefined : next);
              }}
            />
          ))}
        </div>
      </Row>,
    );
  }
  if (c === 'DecisionLog' || c === 'ActivityFeed') {
    const current =
      c === 'DecisionLog'
        ? (filter?.limit as number | undefined)
        : (draft.limit as number | undefined);
    controls.push(
      <Row key="limit" label="Show at most">
        <input
          aria-label="Show at most"
          type="number"
          min={1}
          max={50}
          value={current ?? ''}
          placeholder={c === 'ActivityFeed' ? '10' : 'All'}
          onChange={(e) => {
            const n = e.target.value
              ? Math.max(1, Math.min(50, Number(e.target.value)))
              : undefined;
            if (c === 'DecisionLog') set('filter', setFilterKey(filter, 'limit', n));
            else set('limit', n);
          }}
          className={clsx(FIELD, 'w-28')}
        />
      </Row>,
    );
  }
  if (c === 'Callout') {
    controls.push(
      <Row key="tone" label="Tone">
        <Select
          label="Tone"
          value={(draft.tone as string) ?? 'info'}
          onChange={(t) => set('tone', t)}
          options={[
            { value: 'info', label: 'Info', color: 'blue' },
            { value: 'success', label: 'Success', color: 'green' },
            { value: 'warning', label: 'Warning', color: 'amber' },
            { value: 'danger', label: 'Danger', color: 'red' },
          ]}
        />
      </Row>,
      <Row key="body" label="Text" hint="Markdown is supported.">
        <textarea
          aria-label="Text"
          rows={4}
          value={(draft.body as string) ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          className={FIELD}
        />
      </Row>,
    );
  }
  if (c === 'Markdown') {
    const fromProject = draft.source === 'project.description';
    controls.push(
      <Row key="source" label="Content">
        <Select
          label="Content"
          value={fromProject ? 'project' : 'custom'}
          onChange={(c) => {
            if (c === 'project')
              setDraft((d) => ({ ...d, source: 'project.description', content: undefined }));
            else
              setDraft((d) => ({ ...d, source: undefined, content: (d.content as string) ?? '' }));
          }}
          options={[
            {
              value: 'project',
              label: 'The project’s description',
              description: 'Stays in sync when it changes',
            },
            {
              value: 'custom',
              label: 'Custom text',
              description: 'Write markdown for this widget',
            },
          ]}
        />
      </Row>,
    );
    if (!fromProject) {
      controls.push(
        <textarea
          key="content"
          aria-label="Custom text"
          rows={6}
          value={(draft.content as string) ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          className={FIELD}
        />,
      );
    }
  }
  if (controls.length <= 1 && c !== 'ProjectHeader') {
    controls.push(
      <p key="more" className="text-xs text-muted">
        Other settings for this widget can be changed by your agent.
      </p>,
    );
  }

  const save = () => {
    // Drop keys left undefined by the controls before validating.
    const clean = JSON.parse(JSON.stringify(draft));
    const result = ViewNode.safeParse(clean);
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      return;
    }
    onSave(result.data);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Widget settings"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="relative max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-block bg-surface p-5 shadow-overlay"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {humanize(c.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())} settings
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-control p-1 text-muted hover:bg-subtle"
          >
            <X className="size-5" />
          </button>
        </div>
        {c === 'ProjectHeader' ? (
          <p className="text-sm text-muted">This widget has no settings.</p>
        ) : (
          controls
        )}
        {error && <p className="text-sm whitespace-pre-line text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="submit" className={BUTTON.primary}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
