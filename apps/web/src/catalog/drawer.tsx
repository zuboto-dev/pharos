import {
  ENTITIES,
  decisionState,
  optionKeyOf,
  optionsFor,
  type Entity,
  type EntityType,
  type RevisionSummary,
  connectionsOf,
  groupConnections,
  taskDetailSummary,
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
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { FileDetails } from '../files/FileDetails';
import { Loading, SkeletonShape, SkeletonRows } from './skeleton';
import { Decision } from './components/decision-block';
import { RecordDetails } from './components/records';
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
import { ArtifactPicture } from './artifact-picture';
import { TaskDetails } from './task-details';
import { Select, type SelectOption } from './select';
import { Badge, Empty, toneOf } from './ui';

const HIDDEN = new Set(['projectId', 'order', 'spec', 'template']);
/** A task's steps, checks and results, drawn above the fields by TaskDetails. */
const TASK_DETAIL_FIELDS = new Set(['actions', 'acceptance', 'deliverables']);
/** Long text, edited as markdown above the fields. */
const MARKDOWN = new Set(['description', 'body', 'rationale']);
/** One-line text people can edit in place (shown even when empty, to add it). */
const SHORT_TEXT = new Set(['summary', 'estimate', 'uri', 'path', 'url', 'question', 'alt']);

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
      <dt className="pt-0.5 text-muted">{label}</dt>
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
        className="inline-flex items-center gap-1 break-all text-accent hover:underline"
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
    if (entity.type === 'task' && TASK_DETAIL_FIELDS.has(field)) continue;
    const value = record[field];
    const optional = (def.data.shape as Record<string, z.ZodType>)[field] instanceof z.ZodOptional;
    const schema = fieldSchema(entity.type, field);
    const ref = refs[field];
    let content: ReactNode;
    const optionKey = optionKeyOf(entity.type, field);
    if (entity.type === 'artifact' && field === 'image') {
      content = <ArtifactPicture artifact={entity as Entity<'artifact'>} />;
    } else if (entity.type === 'artifact' && field === 'tags') {
      content = <EditableList entity={entity} field={field} />;
    } else if (entity.type === 'decision' && DECISION_FIELDS.has(field)) {
      continue;
    } else if (
      entity.type === 'decision' &&
      ANSWER_FIELDS.has(field) &&
      (entity as Entity<'decision'>).data.options?.length
    ) {
      // The owner's answer sets these (the form shows who and when; the header, the status).
      continue;
    } else if (
      entity.type === 'decision' &&
      field === 'recommendationReason' &&
      decisionState((entity as Entity<'decision'>).data).kind !== 'chosen' &&
      decisionState((entity as Entity<'decision'>).data).kind !== 'answered'
    ) {
      // The open decision says it under its options.
      continue;
    } else if (optionKey) {
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
  return <dl className="divide-y divide-line-soft">{rows}</dl>;
}

/** A decision's options and the owner's answer, answered in the panel's own form (R10.19). */
const DECISION_FIELDS = new Set([
  'options',
  'recommendedOptionId',
  'chosenOptionId',
  'answer',
  'note',
  'deferredUntil',
]);

/** Set by the owner's answer on a decision with options, so never edited by hand there. */
const ANSWER_FIELDS = new Set(['status', 'decidedById', 'decisionDate']);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
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
            title={taskDetailSummary(task.data)}
            className="flex items-center gap-2 rounded-control px-1.5 py-1 hover:bg-sunken"
          >
            <TaskCheck task={task} />
            <span
              className={clsx(
                'flex-1 truncate text-sm',
                options.meaning('task.status', task.data.status) === 'done' &&
                  'text-faint line-through',
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
  // Everything else that points at it, the pages that show it, the text that mentions it.
  const shown: Partial<Record<string, string[]>> = {
    stage: ['Tasks in this stage', 'Deliverables'],
    task: ['Tasks waiting on it', 'Its deliverables'],
    goal: ['Sub-goals'],
  };
  const groups = groupConnections(connectionsOf(entity, [...data.entityById.values()])).filter(
    (g) => !shown[entity.type]?.includes(g.label),
  );
  if (groups.length)
    sections.push(
      <Section key="connected" title="Connected">
        <dl data-connections="" className="space-y-2">
          {groups.map((g) => (
            <div key={g.label}>
              <dt className="text-xs text-muted">{g.label}</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {g.ids.map((id) => (
                  <EntityRef key={id} id={id} />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Section>,
    );
  return <>{sections}</>;
}

function EntityHistory({ id }: { id: string }) {
  const { version } = useViewData();
  const history = useResource<RevisionSummary[]>(
    `/api/history?entityId=${id}&limit=20&v=${version}`,
  );
  if (history.status === 'loading') return <SkeletonRows rows={2} label="Loading history" />;
  if (!history.data) return <Empty>Couldn’t load history</Empty>;
  return (
    <ul className="-mx-1.5 space-y-0.5">
      {history.data.map((rev) => (
        <RevisionItem key={rev.id} rev={rev} />
      ))}
    </ul>
  );
}

/**
 * What a page says about a decision, drawn by the page that holds the panel (the project page
 * passes the document's renderer; the catalog doesn't import pages).
 */
export const DecisionContextSlot = createContext<((decisionId: string) => ReactNode) | null>(null);

function EntityDetails({ entity }: { entity: Entity }) {
  const decisionContext = useContext(DecisionContextSlot);
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
      {/* Choose, write another answer or decide later, as on the page (R10.19). */}
      {/* The reasons, pictures and clips the page gives it, then the answer form, as on the page. */}
      {entity.type === 'decision' && decisionContext?.(entity.id)}
      {entity.type === 'decision' && <Decision decision={entity as Entity<'decision'>} inPanel />}
      {longText.map((field) => (
        <EditableMarkdown key={field} entity={entity} field={field} />
      ))}
      {entity.type === 'task' && <TaskDetails task={entity as Entity<'task'>} />}
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

/** A revision's details while they load: its title, author line and a few changes. */
function RevisionSkeleton() {
  return (
    <Loading label="Loading revision" className="space-y-6">
      <div className="space-y-2">
        <SkeletonShape className="h-2.5 w-20" />
        <SkeletonShape className="h-5 w-3/4" />
        <SkeletonShape className="w-1/2" />
      </div>
      <SkeletonRows rows={3} label="Loading changes" />
    </Loading>
  );
}

function RevisionDetails({ id }: { id: number }) {
  const { entityById, version, actions } = useViewData();
  const formatValue = useFormatValue();
  const revision = useResource<RevisionSummary>(`/api/revisions/${id}?v=${version}`);
  if (revision.status === 'loading') return <RevisionSkeleton />;
  if (!revision.data) return <Empty>Revision not found</Empty>;
  const rev = revision.data;
  const Icon = AUTHOR_ICONS[rev.author.kind];
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => actions.open({ history: true })}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> All changes
        </button>
        <h2 className="text-lg leading-snug font-semibold">{rev.message}</h2>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Icon className="size-4" /> {rev.author.name} · {timeAgo(rev.createdAt)} · revision #
          {rev.id}
          {rev.revertOf && ` · reverts #${rev.revertOf}`}
        </p>
      </div>
      <RevertButton rev={rev} />
      <Section title={`Changes (${rev.changes.length})`}>
        <ul className="space-y-3">
          {rev.changes.map((change) => (
            <li key={change.id} className="space-y-1.5 rounded-tile border border-line p-3">
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
                <span className="text-muted">{TYPE_LABELS[change.type]}</span>
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
                        <td className="w-24 py-0.5 pr-2 text-muted">{fieldLabel(field)}</td>
                        <td className="py-0.5 break-all">
                          <span className="text-danger line-through">
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

/** How far the bottom sheet's handle is pulled down before the sheet closes. */
const SHEET_CLOSE_PX = 96;

export function DetailDrawer({
  target,
  onClose,
  onBack,
  leaving = false,
}: {
  target: OpenTarget;
  onClose: () => void;
  /** Returns to the details shown before this one, when there were any. */
  onBack?: () => void;
  /** Closing: it slides and fades out (index.css motion) before it goes. */
  leaving?: boolean;
}) {
  const { entityById } = useViewData();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Pulling the sheet's handle down on a phone: how far, and from where.
  const [pull, setPull] = useState(0);
  const pullFrom = useRef<number | null>(null);
  const data = useViewData();
  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape in the agent panel is the agent's (it stops Claude Code), not the drawer's.
      if ((e.target as Element | null)?.closest?.('[data-agent-panel]')) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, leaving]);

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
      className={clsx(
        // Beside the agent panel when it is open (its width is --agent-panel-w), never under it.
        'fixed inset-0 z-40 flex items-end justify-end sm:items-stretch sm:pr-(--agent-panel-w)',
        leaving && 'pointer-events-none',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={kind}
      aria-hidden={leaving || undefined}
    >
      <div
        className={clsx(
          'absolute inset-0 bg-neutral-900/20 dark:bg-black/40',
          leaving ? 'animate-fade-out' : 'animate-fade-in',
        )}
        onClick={onClose}
      />
      {/* On a phone (v0.2 B9) a bottom sheet: most of the screen, rounded on top, with a handle
          to pull it down; from sm up a drawer on the right. */}
      <aside
        data-drawer
        className={clsx(
          'relative flex h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-overlay sm:h-full sm:w-[30rem] sm:rounded-none',
          leaving
            ? 'animate-sheet-out sm:animate-drawer-out'
            : 'animate-sheet-in sm:animate-drawer-in',
        )}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
      >
        <div
          aria-hidden
          className="flex shrink-0 touch-none justify-center pt-2 pb-1 sm:hidden"
          onTouchStart={(e) => {
            pullFrom.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(e) => {
            const from = pullFrom.current;
            const y = e.touches[0]?.clientY;
            if (from !== null && y !== undefined) setPull(Math.max(0, y - from));
          }}
          onTouchEnd={() => {
            pullFrom.current = null;
            if (pull > SHEET_CLOSE_PX) onClose();
            setPull(0);
          }}
        >
          <span className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        </div>
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            {onBack && (
              <button
                type="button"
                aria-label="Back"
                title="Back to the previous details"
                onClick={onBack}
                className="-ml-1.5 rounded-control p-1 hover:bg-subtle hover:text-ink"
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
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs text-muted hover:bg-subtle"
            >
              <LinkIcon className="size-3.5" aria-hidden />
              {/* Icons only on a phone's sheet (v0.2 B9), so the header stays on one line. */}
              <span className={copied ? undefined : 'sr-only sm:not-sr-only'}>
                {copied ? 'Copied' : 'Copy link'}
              </span>
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
                className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs text-muted hover:bg-sky-50 hover:text-accent-strong dark:hover:bg-sky-950"
              >
                <MessageCircleQuestion className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">Ask</span>
              </button>
            )}
            {entity && entity.type !== 'project' && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs text-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
              >
                <Trash2 className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">
                  {entity.type === 'file' ? 'Remove' : 'Delete'}
                </span>
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-control p-1 text-muted hover:bg-subtle"
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
                className="rounded-control bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700"
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
          ) : entity?.type === 'record' ? (
            <RecordDetails
              key={entity.id}
              record={entity as Entity<'record'>}
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
