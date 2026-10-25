import {
  DELIVERABLE_KINDS,
  type Deliverable,
  type DeliverableKind,
  type Entity,
  type RevisionSummary,
} from '@pharos/schema';
import {
  Database,
  FileText,
  GitCommitHorizontal,
  Link2,
  Package,
  PanelsTopLeft,
  Square,
  SquareCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useResource } from '../lib/api';
import { dateTime } from '../lib/format';
import { useViewData } from './context';
import { EditableList, INPUT } from './editable';
import { AUTHOR_ICONS } from './history';
import { BUTTON, Markdown } from './ui';

/**
 * A task's details in the drawer, below its description (context only): what to do (numbered
 * steps in Markdown; code blocks have a copy button), when it's done (a checklist: ticking every
 * check marks the task done, which the server decides) and the results and notes on it
 * (comments, newest last, with the short result links older tasks kept). The owner edits the
 * steps and checks in place.
 */
export function TaskDetails({ task }: { task: Entity<'task'> }) {
  return (
    <div className="space-y-5" data-task-details="">
      <Part title="What to do">
        <EditableList
          entity={task}
          field="actions"
          multiline
          addLabel="Add steps"
          placeholder="One step per line, in order (a step with a code block: separate steps with a line of ---)"
          display={(items) => (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm marker:text-faint">
              {items.map((a, i) => (
                <li key={i} className="pl-0.5">
                  <Markdown copyCode className="task-step">
                    {a}
                  </Markdown>
                </li>
              ))}
            </ol>
          )}
        />
      </Part>
      <Part title="Done when">
        <EditableList
          entity={task}
          field="acceptance"
          addLabel="Add checks"
          placeholder="One “done when” statement per line"
          display={(items) => <Checklist task={task} items={items} />}
        />
      </Part>
      <Part title="Results and notes">
        <Comments task={task} />
      </Part>
    </div>
  );
}

/** The "done when" checks as boxes to tick; all ticked makes the task done (Store.checksDone). */
function Checklist({ task, items }: { task: Entity<'task'>; items: string[] }) {
  const { actions } = useViewData();
  const met = new Set((task.data.acceptanceMet ?? []).filter((m) => items.includes(m)));
  const toggle = (item: string) => {
    const next = items.filter((i) => (i === item ? !met.has(i) : met.has(i)));
    void actions.apply(
      `${met.has(item) ? 'Untick' : 'Tick'} “${item}” on “${task.data.title}”`,
      [{ op: 'update', type: 'task', id: task.id, data: { acceptanceMet: next } }],
      { undoable: true },
    );
  };
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1 text-sm">
        {items.map((c, i) => {
          const done = met.has(c);
          return (
            <li key={i}>
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                onClick={() => toggle(c)}
                className="flex w-full items-start gap-2 rounded-control text-left hover:bg-subtle"
              >
                {done ? (
                  <SquareCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <Square aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
                )}
                <span className={done ? 'text-muted line-through' : undefined}>{c}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-faint">
        {met.size} of {items.length} checked
        {met.size < items.length ? ' · ticking every one marks the task done' : ''}
      </p>
    </div>
  );
}

/** Results, evidence and notes on a task, by whoever wrote them; anyone can add one. */
function Comments({ task }: { task: Entity<'task'> }) {
  const { comments = [], actions } = useViewData();
  const mine = comments
    .filter((c) => c.data.taskId === task.id)
    .sort((a, b) => a.createdRev - b.createdRev);
  const links = task.data.deliverables ?? [];
  const [draft, setDraft] = useState('');
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    void actions
      .apply(`Comment on “${task.data.title}”`, [
        {
          op: 'create',
          type: 'comment',
          data: { projectId: task.data.projectId, taskId: task.id, body },
        },
      ])
      .then((r) => r.ok && setDraft(''));
  };
  return (
    <div className="space-y-3">
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Result links">
          {links.map((d, i) => (
            <DeliverableChip key={i} item={d} />
          ))}
        </ul>
      )}
      {mine.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      <div className="space-y-1.5">
        <textarea
          aria-label="Add a comment"
          rows={draft.includes('\n') ? 4 : 2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Add a result, evidence or a note (Markdown)"
          className={INPUT}
        />
        {draft.trim() && (
          <button type="button" onClick={send} className={BUTTON.primary}>
            Comment
          </button>
        )}
      </div>
    </div>
  );
}

function CommentItem({ comment }: { comment: Entity<'comment'> }) {
  const revision = useResource<RevisionSummary>(`/api/revisions/${comment.createdRev}`);
  const author = revision.data?.author;
  const Icon = author ? AUTHOR_ICONS[author.kind] : null;
  return (
    <article className="rounded-tile border border-line px-3 py-2" data-comment={comment.id}>
      <header className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        {Icon && <Icon aria-hidden className="size-3.5" />}
        <span className="font-medium text-ink-soft">{author?.name ?? '…'}</span>
        <span title={new Date(comment.createdAt).toLocaleString()}>
          · {dateTime(comment.createdAt)}
        </span>
      </header>
      <Markdown copyCode className="text-sm">
        {comment.data.body}
      </Markdown>
    </article>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

const KIND_ICONS: Record<DeliverableKind, LucideIcon> = {
  file: FileText,
  page: PanelsTopLeft,
  link: Link2,
  commit: GitCommitHorizontal,
  record: Database,
  other: Package,
};

/** A short result link on one line: its kind, its label (in full on hover), where it is. */
function DeliverableChip({ item }: { item: Deliverable }) {
  const { entityById, actions } = useViewData();
  const Icon = KIND_ICONS[item.kind ?? 'other'];
  const ref = item.ref;
  const body = (
    <>
      <Icon aria-label={item.kind ?? 'other'} className="size-3.5 shrink-0 text-muted" />
      <span className="truncate">{item.label}</span>
    </>
  );
  const chip =
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs';
  const title = ref ? `${item.label}\n${ref}` : item.label;
  return (
    <li className="max-w-full" data-kind={item.kind ?? 'other'}>
      {ref && entityById.has(ref) ? (
        <button
          type="button"
          title={title}
          onClick={() => actions.open({ entity: ref })}
          className={`${chip} hover:bg-subtle`}
        >
          {body}
        </button>
      ) : ref && /^https?:\/\//i.test(ref) ? (
        <a
          href={ref}
          target="_blank"
          rel="noreferrer noopener"
          title={title}
          className={`${chip} hover:bg-subtle`}
        >
          {body}
        </a>
      ) : (
        <span title={title} className={chip}>
          {body}
        </span>
      )}
    </li>
  );
}

/** "label | kind | where"; a kind that isn't one is read as the where. */
export function parseDeliverable(line: string): Deliverable | null {
  const [label = '', ...rest] = line.split('|').map((p) => p.trim());
  if (!label) return null;
  const kind = DELIVERABLE_KINDS.find((k) => k === rest[0]?.toLowerCase());
  // An empty kind ("label |  | where", as a result without one is written) is skipped too.
  const ref = (kind || rest[0] === '' ? rest.slice(1) : rest).join(' | ').trim();
  return { label, ...(kind ? { kind } : {}), ...(ref ? { ref } : {}) };
}
