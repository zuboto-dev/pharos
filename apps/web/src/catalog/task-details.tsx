import {
  DELIVERABLE_KINDS,
  type Deliverable,
  type DeliverableKind,
  type Entity,
  type PermissionCommandsPreview,
  type PermissionCommandsResult,
  type PermissionWriteRecord,
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
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, ownerSend, useResource } from '../lib/api';
import { dateTime } from '../lib/format';
import { useViewData } from './context';
import { EditableList, INPUT } from './editable';
import { AUTHOR_ICONS } from './history';
import { RISK } from './risk';
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
      {task.data.allowCommands?.length ? (
        <Part title="Allow for agents">
          <AllowCommands task={task} commands={task.data.allowCommands} />
        </Part>
      ) : null}
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

/**
 * The commands a task asks the owner to allow, with one button: Pharos turns each into the rule
 * Settings → Agent permissions would suggest, shows its risk, and on the press writes the
 * allowable ones to the project folder's own settings.local.json (owner-only routes). A comment
 * on the task records what was written; Undo takes it back.
 */
function AllowCommands({ task, commands }: { task: Entity<'task'>; commands: string[] }) {
  const { actions } = useViewData();
  const body = { projectId: task.data.projectId, commands };
  const key = JSON.stringify(body);
  const [preview, setPreview] = useState<PermissionCommandsPreview | null>(null);
  const [records, setRecords] = useState<PermissionWriteRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    ownerSend<PermissionCommandsPreview>('/api/permissions/commands/preview', JSON.parse(key))
      .then((p) => live && setPreview(p))
      .catch((err: unknown) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [key]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!preview) return <p className="text-sm text-muted">Checking these commands…</p>;
  const toWrite = preview.rows.filter((r) => r.allowable && !r.unchanged);
  const allow = async () => {
    setBusy(true);
    try {
      const result = await ownerSend<PermissionCommandsResult>(
        '/api/permissions/commands/write',
        body,
      );
      setPreview(result);
      setRecords(result.records);
      if (result.records.length)
        await actions.apply(
          `Allowed ${result.records.length} command rules for “${task.data.title}”`,
          [
            {
              op: 'create',
              type: 'comment',
              data: {
                projectId: task.data.projectId,
                taskId: task.id,
                body:
                  `Allowed in \`${result.path}\`:\n\n` +
                  result.records.map((r) => `- \`${r.rule}\``).join('\n'),
              },
            },
          ],
        );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    try {
      for (const r of records ?? []) await ownerSend('/api/permissions/undo', { id: r.id });
      setRecords(null);
      setPreview(
        await ownerSend<PermissionCommandsPreview>('/api/permissions/commands/preview', body),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2" data-allow-commands="">
      <ul className="space-y-1.5 text-sm">
        {preview.rows.map((r) => (
          <li key={r.rule} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-sunken px-1 py-0.5 text-xs break-all">{r.rule}</code>
              {r.unchanged ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">Allowed</span>
              ) : r.allowable ? (
                <span className={`rounded-full px-1.5 text-[11px] ${RISK[r.risk].className}`}>
                  {RISK[r.risk].label}
                </span>
              ) : (
                <span className="text-xs text-danger">Can’t be allowed</span>
              )}
            </div>
            <p className="text-xs text-muted">
              {r.allowable ? r.summary : (r.reason ?? r.riskWhy)}
            </p>
          </li>
        ))}
      </ul>
      {records?.length ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <SquareCheck aria-hidden className="size-3.5 text-emerald-600" />
          Allowed {records.length} in this project’s folder only.
          <button
            type="button"
            disabled={busy}
            onClick={undo}
            className="text-accent-strong hover:underline"
          >
            Undo
          </button>
        </p>
      ) : toWrite.length ? (
        <div className="space-y-1">
          <button type="button" disabled={busy} onClick={allow} className={BUTTON.primary}>
            Allow {toWrite.length} {toWrite.length === 1 ? 'command' : 'commands'}
          </button>
          <p className="text-xs text-faint">
            Written to <code>{preview.path.replace(/^\/Users\/[^/]+/, '~')}</code>, this folder
            only.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">Nothing left to allow here.</p>
      )}
    </div>
  );
}

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Couldn’t reach the server';

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
