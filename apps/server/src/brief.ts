import { decisionState, meaningOf, type Entity } from '@pharos/schema';
import { deskOf, RunLog, waitingHandBacks } from './desk.js';
import { pageUpkeep } from './page-upkeep.js';
import { hostname } from 'node:os';
import type { Presence } from './presence.js';
import type { SessionNotes } from './session-notes.js';
import type { Store } from './store/store.js';
import { folderProjects } from './terminal/command.js';

/**
 * One project's brief, the context every session starts from (Chaeeon chose "Both, brief first",
 * 2026-10-23): what the project is and where it stands, the owner's standing rules, what they
 * answered lately, what was handed back, what waits on them, and who is working on what. Claude
 * Code, Codex, night runs and the panel's agent all read the same brief, so no session starts
 * cold. Derived on request; only the rules are stored (project.rules).
 */
export function projectBrief(
  store: Store,
  projectId: string,
  options: { now?: Date; presence?: Presence; runs?: RunLog; notes?: SessionNotes } = {},
): string {
  const now = options.now ?? new Date();
  const project = store.get(projectId) as Entity<'project'> | null;
  if (project?.type !== 'project') throw new Error(`No project ${projectId}`);
  const lines: string[] = [];
  const add = (heading: string, items: string[]) => {
    if (items.length) lines.push('', `## ${heading}`, ...items.map((i) => `- ${i}`));
  };
  const stage = project.data.currentStageId
    ? (store.get(project.data.currentStageId) as Entity<'stage'> | null)
    : null;
  lines.push(
    `# ${project.data.name} (${projectId})`,
    [
      project.data.summary,
      stage
        ? `Stage: ${stage.data.name}${stage.data.targetDate ? ` (target ${stage.data.targetDate})` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'No summary yet.',
  );
  add('The owner’s rules for this project', project.data.rules ?? []);
  // The main page says what the project is for: read it first. Then the pages that are behind
  // how Pharos pages work now, and what changed (page-upkeep.ts): agents fix them as they work.
  const main = store
    .list('view', { projectId })
    .find((v) => v.data.kind === 'main' && !v.data.archived);
  if (main)
    add('The main page', [
      `“${main.data.name}” (${main.id}, updated ${main.updatedAt.slice(0, 10)}): read it with view_get first`,
    ]);
  const upkeep = pageUpkeep(store, projectId, now);
  add('Pages to bring up to date (do these as part of your work here)', upkeep.todo);
  if (upkeep.todo.length) add('What changed in how Pharos pages work', upkeep.updates);

  const tasks = store.list('task', { projectId });
  const done = (t: Entity<'task'>) => meaningOf(project, 'task.status', t.data.status) === 'done';
  const goals = store
    .list('goal', { projectId })
    .filter((g) => meaningOf(project, 'goal.status', g.data.status) === 'open' && !g.data.parentId);
  add(
    'Open goals',
    goals.slice(0, 6).map((g) => {
      const serving = tasks.filter((t) => t.data.goalIds?.includes(g.id));
      return `${g.data.title} (${g.id})${serving.length ? `: ${serving.filter(done).length} of ${serving.length} tasks done` : ': no tasks linked yet'}`;
    }),
  );

  const week = now.getTime() - 7 * 86400_000;
  const answered = store
    .list('decision', { projectId })
    .filter((d) => {
      const state = decisionState(d.data).kind;
      return (state === 'chosen' || state === 'answered') && Date.parse(d.updatedAt) >= week;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((d) => {
      const state = decisionState(d.data);
      const answer =
        state.kind === 'chosen'
          ? `chose “${state.option.label}”`
          : state.kind === 'answered'
            ? `answered “${state.answer}”`
            : '';
      return `${d.data.title}: ${answer}${d.data.note ? ` (note: ${d.data.note})` : ''} · ${d.updatedAt.slice(0, 10)}`;
    });
  add('Answered by the owner in the last 7 days', answered);

  add(
    'Handed back to an agent, not picked up yet: act on these first',
    waitingHandBacks(store)
      .filter((h) => h.projectId === projectId)
      .map(
        (h) =>
          `“${h.view}” (${h.viewId}), since ${h.since.slice(0, 16).replace('T', ' ')}: read the answers with view_get`,
      ),
  );

  if (options.runs) {
    const desk = deskOf(store, options.runs, { projectId, now });
    const open = desk.items.filter((i) => i.kind !== 'run' && !i.old);
    add(
      `Waiting on the owner (${open.length})`,
      open.slice(0, 6).map((i) => `${i.title}${i.note ? ` · ${i.note}` : ''}`),
    );
  }

  const active = tasks.filter(
    (t) => meaningOf(project, 'task.status', t.data.status) === 'in_progress',
  );
  const who = (t: Entity<'task'>) => {
    const a = t.data.assigneeId
      ? (store.get(t.data.assigneeId) as Entity<'assignee'> | null)
      : null;
    return a ? ` (${a.data.name})` : '';
  };
  add(
    'In progress',
    active.slice(0, 8).map((t) => `${t.data.title}${who(t)} (${t.id})${taskDetailLines(t.data)}`),
  );
  const working = [
    ...new Set(
      (options.presence?.state().entries ?? [])
        .filter((e) => e.projectId === projectId)
        .map((e) => e.agent),
    ),
  ];
  if (working.length) add('Working in Pharos right now', working);
  // What the other sessions did last, wherever they ran: your terminal, the panel, routines.
  const recent = options.notes?.recent(projectId, 5) ?? [];
  add(
    'Recent sessions (their last message)',
    recent.map((n) => {
      // The computer Pharos runs on reads "this Mac"; runners by their own names.
      const host = n.host && n.host !== hostname() ? n.host : 'this Mac';
      const where = [n.kind, host].join(' on ');
      const when = n.lastAt.slice(0, 16).replace('T', ' ');
      return `${when} UTC · ${n.agent ?? 'agent'} (${where}): ${n.message.replace(/\s+/g, ' ').slice(0, 400)}`;
    }),
  );

  lines.push(
    '',
    'Updates, reviews, research results and reports go in Pharos as pages that show before they tell (report_guide); answer in chat with a line or two and the link. When the owner gives a standing rule or feedback for this project, add it to project.rules.',
  );
  return lines.join('\n');
}

/** An in-progress task's steps, checks and deliverables, indented under its line in the brief. */
function taskDetailLines(data: Entity<'task'>['data']): string {
  const out: string[] = [];
  data.actions?.forEach((a, i) => out.push(`${i + 1}. ${a}`));
  for (const c of data.acceptance ?? []) out.push(`Done when: ${c}`);
  for (const d of data.deliverables ?? [])
    out.push(`Produces: ${d.label}${d.kind ? ` (${d.kind})` : ''}${d.ref ? ` → ${d.ref}` : ''}`);
  return out.map((l) => `\n  ${l}`).join('');
}

/** The briefs of the projects whose repository is this folder (a session's start hook). */
export function folderBriefs(
  store: Store,
  folder: string,
  options: Parameters<typeof projectBrief>[2] = {},
): string[] {
  return folderProjects(store, folder).map((p) => projectBrief(store, p.id, options));
}
