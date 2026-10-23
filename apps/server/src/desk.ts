import { randomBytes } from 'node:crypto';
import {
  DESK_OLD_DAYS,
  DESK_OVERDUE_HOURS,
  choiceMessage,
  choiceUpdate,
  decisionState,
  TASK_ANSWER,
  isCalendarDate,
  localToday,
  meaningOf,
  taskAnswerChange,
  taskAnswerState,
  valueFor,
  type TaskAnswer,
  type AskOwner,
  type Author,
  type Desk,
  type DeskItem,
  type DeskRun,
  type Entity,
  type RunReport,
} from '@pharos/schema';
import { PharosError } from './store/errors.js';
import { perProject } from './store/project-cache.js';
import type { Store } from './store/store.js';
import { sheetSummaries } from './views/doc.js';

/**
 * The desk (R16, docs/reframe/r16-desk.md): what waits on the owner in every project, derived
 * from decisions, review-desk sheets, tasks for a person and runs that need a look; and the run
 * log those runs come from (a table, not revisions).
 */

const TIME_PART = /(\d+(?:[.,]\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)(?![a-z])/gi;

/** Minutes in "10 min", "2h", "1 h 30 min"; undefined when none of it reads as time. */
export function minutesIn(text: string | undefined): number | undefined {
  if (!text) return undefined;
  let total = 0;
  let found = false;
  for (const m of text.matchAll(TIME_PART)) {
    const n = Number(m[1]!.replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    total += m[2]!.toLowerCase().startsWith('h') ? n * 60 : n;
    found = true;
  }
  return found && total > 0 ? Math.round(total) : undefined;
}

const firstLine = (text: string | undefined, max = 160) => {
  const line = text
    ?.split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const projectHref = (projectId: string, entityId: string) =>
  `/projects/${projectId}?entity=${encodeURIComponent(entityId)}`;

type RunRow = {
  id: string;
  project_id: string | null;
  kind: string;
  name: string;
  agent: string;
  started_at: string;
  ended_at: string | null;
  outcome: string;
  summary: string | null;
  counts: string | null;
  view_id: string | null;
  seen_at: string | null;
};

function toRun(row: RunRow): DeskRun {
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    kind: row.kind as DeskRun['kind'],
    name: row.name,
    agent: row.agent,
    startedAt: row.started_at,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    outcome: row.outcome as DeskRun['outcome'],
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.counts ? { counts: JSON.parse(row.counts) as DeskRun['counts'] } : {}),
    ...(row.view_id ? { viewId: row.view_id } : {}),
    ...(row.seen_at ? { seenAt: row.seen_at } : {}),
  };
}

/** Night runs, routines and the answering agent's runs: started, finished, seen. */
export class RunLog {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get db() {
    return this.store.database;
  }

  get(id: string): DeskRun | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  /** Starts a run, or (with `id`) updates it; a run that ends gets its end time. */
  report(author: Author, input: RunReport): DeskRun {
    const at = this.now().toISOString();
    if (input.projectId && this.store.get(input.projectId)?.type !== 'project')
      throw new PharosError('not_found', `Project ${input.projectId} not found`);
    if (input.viewId && this.store.get(input.viewId)?.type !== 'view')
      throw new PharosError('not_found', `View ${input.viewId} not found`);
    if (input.id) {
      const run = this.get(input.id);
      if (!run) throw new PharosError('not_found', `Run ${input.id} not found`);
      const outcome = input.outcome ?? run.outcome;
      const ended = outcome === 'running' ? null : (run.endedAt ?? at);
      this.db
        .prepare(
          `UPDATE runs SET outcome = ?, ended_at = ?, summary = ?, counts = ?, view_id = ?,
             project_id = ?, name = ?, kind = ? WHERE id = ?`,
        )
        .run(
          outcome,
          ended,
          input.summary ?? run.summary ?? null,
          input.counts
            ? JSON.stringify(input.counts)
            : run.counts
              ? JSON.stringify(run.counts)
              : null,
          input.viewId ?? run.viewId ?? null,
          input.projectId ?? run.projectId ?? null,
          input.name ?? run.name,
          input.kind ?? run.kind,
          run.id,
        );
      return this.get(run.id)!;
    }
    const id = `run_${randomBytes(6).toString('hex')}`;
    const outcome = input.outcome ?? 'running';
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, kind, name, agent, started_at, ended_at, outcome, summary,
           counts, view_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId ?? null,
        input.kind ?? 'other',
        input.name ?? 'Run',
        author.name,
        at,
        outcome === 'running' ? null : at,
        outcome,
        input.summary ?? null,
        input.counts ? JSON.stringify(input.counts) : null,
        input.viewId ?? null,
      );
    return this.get(id)!;
  }

  /** The owner has looked at a run that needed a look. */
  markSeen(id: string): DeskRun {
    if (!this.get(id)) throw new PharosError('not_found', `Run ${id} not found`);
    this.db.prepare('UPDATE runs SET seen_at = ? WHERE id = ?').run(this.now().toISOString(), id);
    return this.get(id)!;
  }

  list(options: { limit?: number; projectId?: string } = {}): DeskRun[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const rows = (
      options.projectId
        ? this.db
            .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY rowid DESC LIMIT ?')
            .all(options.projectId, limit)
        : this.db.prepare('SELECT * FROM runs ORDER BY rowid DESC LIMIT ?').all(limit)
    ) as RunRow[];
    return rows.map(toRun);
  }

  /** The latest run of each name, newest first. */
  latest(): DeskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM runs WHERE rowid IN (SELECT MAX(rowid) FROM runs GROUP BY name)
         ORDER BY rowid DESC LIMIT 20`,
      )
      .all() as RunRow[];
    return rows.map(toRun);
  }
}

/** Where a decision is answered: a page that shows its DecisionBlock, else its details. */
function decisionHref(views: Entity<'view'>[], projectId: string, id: string): string {
  const needle = `"decision":"${id}"`;
  const view = views.find((v) => JSON.stringify(v.data.doc ?? v.data.spec ?? '').includes(needle));
  return view ? `/projects/${projectId}/views/${view.id}` : projectHref(projectId, id);
}

/**
 * Everything waiting on the owner (today's first, then the old ones, folded on the page), in every project (or one): open review-desk sheets, decisions
 * with options nobody answered (a deferral is open again on its day), unfinished tasks a person
 * was asked to do (ask_owner) or that are due by tomorrow, and runs that failed or half failed and haven't been looked at. A decision or task a
 * sheet asks about is the sheet's, not an item of its own.
 */
export function deskOf(
  store: Store,
  runs: RunLog,
  options: { projectId?: string; now?: Date } = {},
): Desk {
  const now = options.now ?? new Date();
  const today = localToday(now.toISOString());
  const tomorrow = localToday(new Date(now.getTime() + 86_400_000).toISOString());
  const overdueBefore = now.getTime() - DESK_OVERDUE_HOURS * 3600_000;
  const oldBefore = now.getTime() - DESK_OLD_DAYS * 86_400_000;
  const items: DeskItem[] = [];
  const projects = store
    .list('project')
    .filter((p) => !options.projectId || p.id === options.projectId)
    .filter((p) => p.data.status !== 'archived' && p.data.status !== 'done');
  const add = (item: Omit<DeskItem, 'overdue' | 'old'>) =>
    items.push({
      ...item,
      overdue: Date.parse(item.since) < overdueBefore,
      old: Date.parse(item.since) < oldBefore,
    });

  for (const project of projects) {
    // A project's items are reused until it changes (or the day turns: deferrals come back, due
    // dates arrive); overdue and old are worked out fresh below.
    const projectItems = perProject(store, 'desk', project.id, `${today}|${tomorrow}`, () => {
      const local: Omit<DeskItem, 'overdue' | 'old'>[] = [];
      const add = (item: Omit<DeskItem, 'overdue' | 'old'>) => local.push(item);
      const data = store.dataset(project.id);
      const covered = new Set<string>();
      for (const view of data.views) {
        // An archived report was handed back: its sheets no longer wait on the owner.
        if (!view.data.doc || view.data.archived) continue;
        for (const sheet of sheetSummaries(store, project.id, view.data.doc, today)) {
          for (const d of sheet.decisions) covered.add(d.id);
          for (const t of sheet.tasks ?? []) covered.add(t.id);
          if (sheet.state !== 'open') continue;
          const openDecisions = sheet.decisions.filter(
            (d) => d.state === 'open' || d.state === 'deferred',
          );
          const left = (sheet.tasks ?? []).filter((t) => t.state === 'open');
          const started = [
            ...openDecisions.map((d) => store.get(d.id)?.createdAt),
            ...left.map((t) => store.get(t.id)?.createdAt),
          ].filter((at): at is string => !!at);
          const parts = [
            openDecisions.length &&
              `${openDecisions.length} ${openDecisions.length === 1 ? 'choice' : 'choices'}`,
            left.length && `${left.length} ${left.length === 1 ? 'task' : 'tasks'} to tick`,
          ].filter(Boolean);
          add({
            id: `${view.id}#${sheet.id}`,
            kind: 'sheet',
            projectId: project.id,
            project: project.data.name,
            title: sheet.title,
            ...(parts.length ? { ask: `${parts.join(', ')} · in “${view.data.name}”` } : {}),
            ...(minutesIn(sheet.time) ? { minutes: minutesIn(sheet.time) } : {}),
            since: started.sort()[0] ?? view.createdAt,
            gate: !!sheet.tags?.includes('gate'),
            href: `/projects/${project.id}/views/${view.id}#sheet-${sheet.id}`,
          });
        }
      }
      for (const d of data.decisions) {
        if (covered.has(d.id) || !d.data.options?.length) continue;
        const meaning = meaningOf(project, 'decision.status', d.data.status);
        if (meaning === 'superseded' || meaning === 'rejected') continue;
        const state = decisionState(d.data);
        const back = state.kind === 'deferred' && state.until <= today;
        if (state.kind !== 'open' && !back) continue;
        add({
          id: d.id,
          kind: 'decision',
          projectId: project.id,
          project: project.data.name,
          title: d.data.title,
          ...(firstLine(d.data.body) ? { ask: firstLine(d.data.body) } : {}),
          ...(d.data.minutes ? { minutes: d.data.minutes } : {}),
          since: back ? `${state.until}T00:00:00.000Z` : d.createdAt,
          gate: !!d.data.gate,
          href: decisionHref(data.views, project.id, d.id),
          options: d.data.options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.asks ? { asks: o.asks } : {}),
          })),
          ...(d.data.recommendedOptionId
            ? { recommendedOptionId: d.data.recommendedOptionId }
            : {}),
        });
      }
      const people = new Set(
        data.assignees.filter((a) => a.data.kind === 'human').map((a) => a.id),
      );
      for (const t of data.tasks) {
        if (covered.has(t.id) || !people.has(t.data.assigneeId ?? '')) continue;
        // Done, won't do and replied are answered; a later one waits until its day.
        const meaning = meaningOf(project, 'task.status', t.data.status);
        const state = taskAnswerState(t.data, meaning, today);
        if (state !== 'open') continue;
        // A person's plan tasks stay in their projects: only what an agent asked of them, or what
        // is due by tomorrow, waits on the desk.
        const due = t.data.dueDate && t.data.dueDate <= tomorrow;
        if (!t.data.desk && !due) continue;
        add({
          id: t.id,
          kind: 'task',
          projectId: project.id,
          project: project.data.name,
          title: t.data.title,
          ...(firstLine(t.data.description) ? { ask: firstLine(t.data.description) } : {}),
          ...(minutesIn(t.data.estimate) ? { minutes: minutesIn(t.data.estimate) } : {}),
          // Back from "later": it has waited since its day, like a decision's deferral.
          since: t.data.deferredUntil ? `${t.data.deferredUntil}T00:00:00.000Z` : t.createdAt,
          // ask_owner makes a gate a high-priority desk task.
          gate:
            !!t.data.desk &&
            ['high', 'urgent'].includes(meaningOf(project, 'task.priority', t.data.priority) ?? ''),
          href: projectHref(project.id, t.id),
        });
      }
      return local;
    });
    for (const item of projectItems) add(item);
  }

  const latest = runs.latest();
  const projectNames = new Map(projects.map((p) => [p.id, p.data.name]));
  for (const run of latest) {
    if (run.seenAt || (run.outcome !== 'failed' && run.outcome !== 'partial')) continue;
    if (options.projectId && run.projectId !== options.projectId) continue;
    const name = run.projectId ? projectNames.get(run.projectId) : undefined;
    add({
      id: run.id,
      kind: 'run',
      ...(name ? { projectId: run.projectId, project: name } : {}),
      title: `${run.name}: ${run.outcome === 'failed' ? 'failed' : 'partly done'}`,
      ...(run.summary ? { ask: run.summary } : {}),
      since: run.endedAt ?? run.startedAt,
      gate: false,
      href:
        run.viewId && run.projectId
          ? `/projects/${run.projectId}/views/${run.viewId}`
          : `/desk#${run.id}`,
    });
  }

  items.sort(
    (a, b) =>
      Number(a.old) - Number(b.old) ||
      Number(b.overdue) - Number(a.overdue) ||
      Number(b.gate) - Number(a.gate) ||
      a.since.localeCompare(b.since),
  );
  return {
    items,
    minutes: items.reduce((sum, i) => sum + (i.minutes ?? 0), 0),
    overdue: items.filter((i) => i.overdue).length,
    old: items.filter((i) => i.old).length,
    runs: options.projectId ? latest.filter((r) => r.projectId === options.projectId) : latest,
  };
}

/** The person the owner's tasks go to: the person with the most tasks, made when there is none. */
function ownerAssignee(store: Store): string | null {
  const people = store.list('assignee').filter((a) => a.data.kind === 'human');
  if (!people.length) return null;
  const counts = new Map<string, number>();
  for (const t of store.list('task')) {
    const id = t.data.assigneeId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return people.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0]!.id;
}

/**
 * Puts something on the owner's desk in one call (MCP ask_owner): with options, a decision they
 * answer in one tap; without, a task for them. One revision, by the agent.
 */
export function askOwner(
  store: Store,
  author: Author,
  input: AskOwner,
): { id: string; kind: 'decision' | 'task'; revision: number; href: string } {
  const project = store.get(input.projectId);
  if (project?.type !== 'project')
    throw new PharosError('not_found', `Project ${input.projectId} not found`);
  const p = project as Entity<'project'>;
  if (input.options) {
    if (input.recommendedOptionId && !input.options.some((o) => o.id === input.recommendedOptionId))
      throw new PharosError('invalid', 'recommendedOptionId must be one of the options');
    const result = store.apply(author, {
      message: `Ask the owner: ${input.title}`,
      operations: [
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: {
            projectId: p.id,
            title: input.title,
            ...(input.ask ? { body: input.ask } : {}),
            status: valueFor(p, 'decision.status', 'proposed'),
            options: input.options,
            ...(input.recommendedOptionId
              ? { recommendedOptionId: input.recommendedOptionId }
              : {}),
            ...(input.minutes ? { minutes: input.minutes } : {}),
            ...(input.gate ? { gate: true } : {}),
          },
        },
      ],
    });
    const id = result.created.d!;
    return {
      id,
      kind: 'decision',
      revision: result.revision?.id ?? store.latestRevisionId(),
      href: decisionHref(store.dataset(p.id).views, p.id, id),
    };
  }
  const assignee = ownerAssignee(store);
  const result = store.apply(author, {
    message: `Ask the owner: ${input.title}`,
    operations: [
      ...(assignee
        ? []
        : [
            {
              op: 'create' as const,
              type: 'assignee' as const,
              ref: 'me',
              data: { name: 'Owner', kind: 'human' as const },
            },
          ]),
      {
        op: 'create',
        type: 'task',
        ref: 't',
        data: {
          projectId: p.id,
          title: input.title,
          ...(input.ask ? { description: input.ask } : {}),
          assigneeId: assignee ?? '$me',
          desk: true,
          ...(input.minutes ? { estimate: `${input.minutes} min` } : {}),
          ...(input.gate ? { priority: valueFor(p, 'task.priority', 'high') } : {}),
        },
      },
    ],
  });
  const id = result.created.t!;
  return {
    id,
    kind: 'task',
    revision: result.revision?.id ?? store.latestRevisionId(),
    href: projectHref(p.id, id),
  };
}

/** What people did since a revision (the owner's answers), for an agent's next turn. */
export function answersSince(store: Store, since: number, projectId?: string) {
  return store
    .history({ after: since, authorKind: 'human', limit: 50, ...(projectId ? { projectId } : {}) })
    .map((r) => ({ revision: r.id, at: r.createdAt, message: r.message }));
}

/**
 * A task answer other than done, checked: exactly one of won't do, later (a day after today) or
 * a reply; none when the request marks it done.
 */
function taskAnswerOf(
  input: { done?: boolean; wontDo?: boolean; later?: string; reply?: string },
  today: string,
): TaskAnswer | undefined {
  const given = [input.done, input.wontDo, input.later !== undefined, input.reply !== undefined];
  if (given.filter(Boolean).length !== 1)
    throw new PharosError(
      'invalid',
      'Send one answer for a task: done: true, wontDo: true, later: "YYYY-MM-DD" or reply: "…"',
    );
  if (input.done) return undefined;
  if (input.wontDo) return { kind: 'wontDo' };
  if (input.later !== undefined) {
    if (!isCalendarDate(input.later) || input.later <= today)
      throw new PharosError('invalid', `later must be a day after today (${today}), as YYYY-MM-DD`);
    return { kind: 'later', until: input.later };
  }
  const text = input.reply?.trim() ?? '';
  if (!text) throw new PharosError('invalid', 'reply needs some text');
  if (text.length > TASK_ANSWER.replyChars)
    throw new PharosError('invalid', `reply is at most ${TASK_ANSWER.replyChars} characters`);
  return { kind: 'reply', text };
}

/**
 * The owner answers from the desk (POST /api/desk/answer): choose a decision's option (with the
 * note an option asks for), or answer a task: done, won't do, later (a day) or a reply of their
 * own. The same change the DecisionBlock and the checklist make, as one revision with the owner
 * as the decider.
 */
export function deskAnswer(
  store: Store,
  author: Author,
  input: {
    id: string;
    chosenOptionId?: string;
    note?: string;
    done?: boolean;
    wontDo?: boolean;
    later?: string;
    reply?: string;
  },
  now: Date = new Date(),
) {
  const found = store.get(input.id);
  if (!found || (found.type !== 'decision' && found.type !== 'task'))
    throw new PharosError('not_found', `No decision or task ${input.id}`);
  const project = store.get((found.data as { projectId: string }).projectId) as Entity<'project'>;
  if (found.type === 'task') {
    const task = found as Entity<'task'>;
    const answer = taskAnswerOf(input, localToday(now));
    if (answer) {
      const change = taskAnswerChange(project, task, answer);
      return store.apply(author, {
        message: change.message,
        operations: [{ op: 'update', type: 'task', id: task.id, data: change.data }],
      });
    }
    return store.apply(author, {
      message: `Mark “${task.data.title}” done`,
      operations: [
        {
          op: 'update',
          type: 'task',
          id: task.id,
          data: { status: valueFor(project, 'task.status', 'done') },
        },
      ],
    });
  }
  const decision = found as Entity<'decision'>;
  const option = decision.data.options?.find((o) => o.id === input.chosenOptionId);
  if (!option) throw new PharosError('invalid', 'chosenOptionId must be one of its options');
  const note = input.note?.trim();
  if (option.asks && !note)
    throw new PharosError('invalid', `“${option.label}” asks for a note: ${option.asks}`);
  const person = store.list('assignee').find((a) => a.data.kind === 'human');
  return store.apply(author, {
    message: choiceMessage(option, decision.data.title, note, localToday()),
    operations: [
      ...(person
        ? []
        : [
            {
              op: 'create' as const,
              type: 'assignee' as const,
              ref: 'me',
              data: { name: 'me', kind: 'human' as const },
            },
          ]),
      {
        op: 'update',
        type: 'decision',
        id: decision.id,
        // Status, who and when follow from the choice (decline → rejected, later → back in a week).
        data: choiceUpdate(option, {
          ...(note ? { note } : {}),
          today: localToday(),
          decidedById: person?.id ?? '$me',
          status: (meaning) => valueFor(project, 'decision.status', meaning),
        }),
      },
    ],
  });
}
