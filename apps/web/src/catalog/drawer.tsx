import {
  ENTITIES,
  optionKeyOf,
  optionsFor,
  type Entity,
  type EntityType,
  type RevisionSummary,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  ArrowLeft,
  ExternalLink,
  Link as LinkIcon,
  MessageCircleQuestion,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { FileDetails } from '../files/FileDetails';
import { useResource } from '../lib/api';
import { humanize, plural, timeAgo } from '../lib/format';
import { useViewData, type OpenTarget } from './context';
import { Clickable, EntityRef, TYPE_LABELS, TaskCheck, labelOf } from './interactive';
import { EditOptionsButton, OptionBadge, useOptions } from './options';
import {
  EditableDate,
  EditableList,
  EditableMarkdown,
  EditableText,
  EditableTitle,
} from './editable';
import { AUTHOR_ICONS, ProjectHistory, RevertButton, RevisionItem } from './history';
import { QuickAdd, useCreate } from './quickadd';
import { ArtifactSourcePanel } from './source-file';
import { Select, type SelectOption } from './select';
import { Badge, Empty, toneOf } from './ui';

const HIDDEN = new Set(['projectId', 'order', 'spec', 'template']);
/** Long text, edited as markdown above the fields. */
const MARKDOWN = new Set(['description', 'body', 'rationale']);
/** One-line text people can edit in place (shown even when empty, to add it). */
const SHORT_TEXT = new Set(['summary', 'estimate', 'uri', 'path', 'url', 'question']);

/** Human-readable field name, e.g. assigneeId → "Assignee", dependsOn → "Depends on". */
function fieldLabel(field: string): string {
  if (field === 'fileIds') return 'Files';
  return field === 'dependsOn'
    ? 'Depends on'
    : humanize(
        field
          .replace(/Id$/, '')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase(),
      );
}

function fieldSchema(type: EntityType, field: string): z.ZodType | undefined {
  let schema = (ENTITIES[type].data.shape as Record<string, z.ZodType>)[field];
  if (schema instanceof z.ZodOptional) schema = schema.unwrap() as z.ZodType;
  return schema;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3 py-1.5 text-sm">
      <dt className="pt-0.5 text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A dropdown that saves its value as a revision. */
function FieldSelect({
  entity,
  field,
  options,
  optional,
}: {
  entity: Entity;
  field: string;
  options: SelectOption[];
  optional: boolean;
}) {
  const { actions } = useViewData();
  const current = ((entity.data as Record<string, unknown>)[field] as string | undefined) ?? '';
  const choices = optional || !current ? [{ value: '', label: 'None' }, ...options] : options;
  return (
    <Select
      label={fieldLabel(field)}
      value={current}
      options={choices}
      className="max-w-60"
      onChange={(next) => {
        const value = next || null;
        const label = options.find((o) => o.value === value)?.label ?? 'none';
        void actions.apply(
          `Set ${fieldLabel(field).toLowerCase()} of “${labelOf(entity)}” to ${label}`,
          [{ op: 'update', type: entity.type, id: entity.id, data: { [field]: value } }],
        );
      }}
    />
  );
}

function Value({ value }: { value: unknown }) {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 break-all text-sky-600 hover:underline dark:text-sky-400"
      >
        {value} <ExternalLink className="size-3 shrink-0" />
      </a>
    );
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  return <span className="break-words">{String(value)}</span>;
}

function Fields({ entity }: { entity: Entity }) {
  const data = useViewData();
  const record = entity.data as Record<string, unknown>;
  const def = ENTITIES[entity.type];
  const refs = def.refs as Record<string, { type: EntityType; many?: boolean }>;
  const refOptions = (type: EntityType): SelectOption[] | undefined => {
    if (type === 'stage') {
      return data.stages.map((st) => ({
        value: st.id,
        label: labelOf(st),
        description:
          [
            st.id === data.project.data.currentStageId ? 'Current stage' : '',
            st.data.targetDate ? `Due ${st.data.targetDate}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      }));
    }
    if (type === 'assignee') {
      return data.assignees.map((a) => ({
        value: a.id,
        label: labelOf(a),
        description: a.data.kind === 'agent' ? 'Agent' : 'Person',
      }));
    }
    return undefined;
  };

  const rows: ReactNode[] = [];
  for (const field of Object.keys(def.data.shape)) {
    if (HIDDEN.has(field) || field === def.label || MARKDOWN.has(field)) continue;
    const value = record[field];
    const optional = (def.data.shape as Record<string, z.ZodType>)[field] instanceof z.ZodOptional;
    const schema = fieldSchema(entity.type, field);
    const ref = refs[field];
    let content: ReactNode;
    const optionKey = optionKeyOf(entity.type, field);
    if (optionKey) {
      const choices = optionsFor(data.project, optionKey).map((o) => ({
        value: o.value,
        label: o.label,
        color: o.color,
        ...(o.meaning !== o.value
          ? { description: `Counts as ${humanize(o.meaning).toLowerCase()}` }
          : {}),
      }));
      content = (
        <div className="flex items-center gap-1">
          <FieldSelect entity={entity} field={field} options={choices} optional={false} />
          <EditOptionsButton field={optionKey} />
        </div>
      );
    } else if (schema instanceof z.ZodEnum) {
      const options = (schema.options as string[]).map((o) => ({
        value: o,
        label: humanize(o),
        color: toneOf(o),
      }));
      content = <FieldSelect entity={entity} field={field} options={options} optional={optional} />;
    } else if (ref && !ref.many && refOptions(ref.type)) {
      content = (
        <FieldSelect
          entity={entity}
          field={field}
          options={refOptions(ref.type)!}
          optional={optional}
        />
      );
    } else if (ref) {
      const ids = ref.many
        ? ((value as string[] | undefined) ?? [])
        : value
          ? [value as string]
          : [];
      if (!ids.length) continue;
      content = (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <EntityRef key={id} id={id} />
          ))}
        </div>
      );
    } else if (/Date$/.test(field)) {
      content = <EditableDate entity={entity} field={field} />;
    } else if (field === 'successCriteria') {
      content = <EditableList entity={entity} field={field} />;
    } else if (SHORT_TEXT.has(field)) {
      content = <EditableText entity={entity} field={field} />;
    } else if (Array.isArray(value)) {
      if (!value.length) continue;
      content = (
        <ul className="list-disc space-y-0.5 pl-4">
          {value.map((v, i) => (
            <li key={i}>{String(v)}</li>
          ))}
        </ul>
      );
    } else {
      if (value === undefined || value === '') continue;
      content = <Value value={value} />;
    }
    rows.push(
      <Row key={field} label={fieldLabel(field)}>
        {content}
      </Row>,
    );
  }
  return <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">{rows}</dl>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function TaskList({ tasks }: { tasks: Entity<'task'>[] }) {
  const options = useOptions();
  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id}>
          <Clickable
            id={task.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <TaskCheck task={task} />
            <span
              className={clsx(
                'flex-1 truncate text-sm',
                options.meaning('task.status', task.data.status) === 'done' &&
                  'text-neutral-400 line-through',
              )}
            >
              {task.data.title}
            </span>
            {!['done', 'todo'].includes(options.meaning('task.status', task.data.status)!) && (
              <OptionBadge field="task.status" value={task.data.status} />
            )}
          </Clickable>
        </li>
      ))}
    </ul>
  );
}

function Related({ entity }: { entity: Entity }) {
  const data = useViewData();
  const create = useCreate();
  const sections: ReactNode[] = [];
  if (entity.type === 'stage') {
    const tasks = data.tasks.filter((t) => t.data.stageId === entity.id);
    sections.push(
      <Section key="tasks" title={`Tasks (${tasks.length})`}>
        {tasks.length ? <TaskList tasks={tasks} /> : <Empty>No tasks in this stage</Empty>}
        <QuickAdd
          label="Add task"
          onAdd={(title) => create('task', { title, stageId: entity.id })}
        />
      </Section>,
    );
  }
  if (entity.type === 'task') {
    const blocks = data.tasks.filter((t) => t.data.dependsOn.includes(entity.id));
    if (blocks.length) {
      sections.push(
        <Section key="blocks" title="Blocks">
          <TaskList tasks={blocks} />
        </Section>,
      );
    }
  }
  if (entity.type === 'goal') {
    const subgoals = data.goals.filter((g) => g.data.parentId === entity.id);
    sections.push(
      <Section key="subgoals" title={`Sub-goals (${subgoals.length})`}>
        {subgoals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {subgoals.map((g) => (
              <EntityRef key={g.id} id={g.id} />
            ))}
          </div>
        )}
        <QuickAdd
          label="Add sub-goal"
          onAdd={(title) => create('goal', { title, parentId: entity.id })}
        />
      </Section>,
    );
  }
  if (entity.type === 'stage' || entity.type === 'task') {
    const field = entity.type === 'stage' ? 'stageId' : 'taskId';
    const artifacts = data.artifacts.filter((a) => a.data[field] === entity.id);
    if (artifacts.length) {
      sections.push(
        <Section key="artifacts" title="Artifacts">
          <div className="flex flex-wrap gap-1">
            {artifacts.map((a) => (
              <EntityRef key={a.id} id={a.id} />
            ))}
          </div>
        </Section>,
      );
    }
  }
  return <>{sections}</>;
}

function EntityHistory({ id }: { id: string }) {
  const { version } = useViewData();
  const history = useResource<RevisionSummary[]>(
    `/api/history?entityId=${id}&limit=20&v=${version}`,
  );
  if (!history.data)
    return <Empty>{history.status === 'loading' ? 'Loading…' : 'Couldn’t load history'}</Empty>;
  return (
    <ul className="-mx-1.5 space-y-0.5">
      {history.data.map((rev) => (
        <RevisionItem key={rev.id} rev={rev} />
      ))}
    </ul>
  );
}

function EntityDetails({ entity }: { entity: Entity }) {
  const longText = [...MARKDOWN].filter((f) => f in ENTITIES[entity.type].data.shape);
  return (
    <div className="space-y-6">
      <EditableTitle
        entity={entity}
        prefix={
          entity.type === 'task' ? (
            <TaskCheck task={entity as Entity<'task'>} className="mt-1" />
          ) : undefined
        }
      />
      {/* Where its document is and why it can't open yet, with Approve when asked (R7.12). */}
      {entity.type === 'artifact' && (
        <ArtifactSourcePanel artifact={entity as Entity<'artifact'>} />
      )}
      {longText.map((field) => (
        <EditableMarkdown key={field} entity={entity} field={field} />
      ))}
      <Fields entity={entity} />
      <Related entity={entity} />
      <Section title="History">
        <EntityHistory id={entity.id} />
      </Section>
    </div>
  );
}

/** A field value in a diff, with names instead of ids and option labels instead of values. */
function useFormatValue() {
  const { entityById } = useViewData();
  const options = useOptions();
  const one = (type: EntityType, field: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') {
      const key = optionKeyOf(type, field);
      if (key) return options.get(key, value).label;
      const entity = entityById.get(value);
      return entity ? labelOf(entity) : value;
    }
    if (Array.isArray(value))
      return value.length ? value.map((v) => one(type, field, v)).join(', ') : '—';
    return JSON.stringify(value);
  };
  return one;
}

function RevisionDetails({ id }: { id: number }) {
  const { entityById, version, actions } = useViewData();
  const formatValue = useFormatValue();
  const revision = useResource<RevisionSummary>(`/api/revisions/${id}?v=${version}`);
  if (!revision.data)
    return <Empty>{revision.status === 'loading' ? 'Loading…' : 'Revision not found'}</Empty>;
  const rev = revision.data;
  const Icon = AUTHOR_ICONS[rev.author.kind];
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => actions.open({ history: true })}
          className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="size-3.5" /> All changes
        </button>
        <h2 className="text-lg leading-snug font-semibold">{rev.message}</h2>
        <p className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
          <Icon className="size-4" /> {rev.author.name} · {timeAgo(rev.createdAt)} · revision #
          {rev.id}
          {rev.revertOf && ` · reverts #${rev.revertOf}`}
        </p>
      </div>
      <RevertButton rev={rev} />
      <Section title={`Changes (${rev.changes.length})`}>
        <ul className="space-y-3">
          {rev.changes.map((change) => (
            <li
              key={change.id}
              className="space-y-1.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  tone={change.op === 'create' ? 'green' : change.op === 'delete' ? 'red' : 'blue'}
                >
                  {humanize(
                    change.op === 'create'
                      ? 'added'
                      : change.op === 'delete'
                        ? 'removed'
                        : 'updated',
                  )}
                </Badge>
                <span className="text-neutral-500">{TYPE_LABELS[change.type]}</span>
                {entityById.has(change.id) ? (
                  <EntityRef id={change.id} />
                ) : (
                  <span>{change.label ?? change.id}</span>
                )}
              </div>
              {change.op === 'update' && (
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(change.fields).map(([field, diff]) => (
                      <tr key={field} className="align-top">
                        <td className="w-24 py-0.5 pr-2 text-neutral-500">{fieldLabel(field)}</td>
                        <td className="py-0.5 break-all">
                          <span className="text-rose-600 line-through dark:text-rose-400">
                            {formatValue(change.type, field, diff.before)}
                          </span>{' '}
                          →{' '}
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {formatValue(change.type, field, diff.after)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** What else changes when an entity is deleted, so the confirmation can say so. */
function deleteEffects(entity: Entity, data: ReturnType<typeof useViewData>): string {
  const count = (n: number, what: string) =>
    n ? `${plural(n, what)} ${what === 'sub-goal' ? 'will be deleted too' : ''}` : '';
  if (entity.type === 'goal') {
    const descendants = (id: string): number =>
      data.goals
        .filter((g) => g.data.parentId === id)
        .reduce((n, g) => n + 1 + descendants(g.id), 0);
    return count(descendants(entity.id), 'sub-goal');
  }
  if (entity.type === 'stage') {
    const n = data.tasks.filter((t) => t.data.stageId === entity.id).length;
    return n ? `Its ${plural(n, 'task')} will stay, without a stage.` : '';
  }
  if (entity.type === 'task') {
    const n = data.tasks.filter((t) => t.data.dependsOn.includes(entity.id)).length;
    return n ? `${plural(n, 'task')} that depend on it will no longer depend on it.` : '';
  }
  if (entity.type === 'file') return 'The file stays in its folder; only this project forgets it.';
  return '';
}

export function DetailDrawer({
  target,
  onClose,
  onBack,
}: {
  target: OpenTarget;
  onClose: () => void;
  /** Returns to the details shown before this one, when there were any. */
  onBack?: () => void;
}) {
  const { entityById } = useViewData();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const data = useViewData();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entity = 'entity' in target ? entityById.get(target.entity) : undefined;
  const kind =
    'history' in target
      ? 'History'
      : 'revision' in target
        ? 'Revision'
        : entity
          ? TYPE_LABELS[entity.type]
          : 'Not found';
  const status =
    entity && typeof (entity.data as Record<string, unknown>).status === 'string'
      ? ((entity.data as Record<string, unknown>).status as string)
      : undefined;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={kind}
    >
      <div className="absolute inset-0 bg-neutral-900/20 dark:bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full flex-col bg-white shadow-xl sm:w-[30rem] dark:bg-neutral-900">
        <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            {onBack && (
              <button
                type="button"
                aria-label="Back"
                title="Back to the previous details"
                onClick={onBack}
                className="-ml-1.5 rounded-md p-1 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            {kind}
            {status &&
              entity &&
              (optionKeyOf(entity.type, 'status') ? (
                <OptionBadge field={optionKeyOf(entity.type, 'status')!} value={status} />
              ) : (
                <Badge tone={toneOf(status)}>{humanize(status)}</Badge>
              ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(window.location.href)
                  .then(() => setCopied(true));
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <LinkIcon className="size-3.5" /> {copied ? 'Copied' : 'Copy link'}
            </button>
            {entity && data.actions.ask && (
              <button
                type="button"
                onClick={() => {
                  data.actions.ask!({
                    label: `${TYPE_LABELS[entity.type]} “${labelOf(entity)}”`,
                    aboutId: entity.id,
                  });
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950 dark:hover:text-sky-300"
              >
                <MessageCircleQuestion className="size-3.5" /> Ask
              </button>
            )}
            {entity && entity.type !== 'project' && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
              >
                <Trash2 className="size-3.5" /> {entity.type === 'file' ? 'Remove' : 'Delete'}
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>
        {confirming && entity && (
          <div
            role="alertdialog"
            aria-label="Confirm delete"
            className="space-y-2 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100"
          >
            <p>
              {entity.type === 'file' ? 'Remove' : 'Delete'}{' '}
              {TYPE_LABELS[entity.type].toLowerCase()} “{labelOf(entity)}”
              {entity.type === 'file' ? ' from this project' : ''}? {deleteEffects(entity, data)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void data.actions.apply(
                    entity.type === 'file'
                      ? `Remove file “${labelOf(entity)}” from the project`
                      : `Delete ${TYPE_LABELS[entity.type].toLowerCase()} “${labelOf(entity)}”`,
                    [{ op: 'delete', type: entity.type, id: entity.id }],
                    { undoable: true },
                  );
                  onClose();
                }}
                className="rounded-md bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700"
              >
                {entity.type === 'file' ? 'Remove' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-2 py-1 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {'history' in target ? (
            <ProjectHistory />
          ) : 'revision' in target ? (
            <RevisionDetails id={target.revision} />
          ) : entity?.type === 'file' ? (
            <FileDetails
              key={entity.id}
              file={entity as Entity<'file'>}
              history={<EntityHistory id={entity.id} />}
            />
          ) : entity ? (
            <EntityDetails key={entity.id} entity={entity} />
          ) : (
            <Empty>This item no longer exists.</Empty>
          )}
        </div>
      </aside>
    </div>
  );
}
