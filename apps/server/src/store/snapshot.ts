import {
  OPTION_KEYS,
  optionsFor,
  stageProgress,
  taskProgress,
  meaningOf,
  type EntityDataMap,
} from '@pharos/schema';
import { isExpired, requestContext } from '../views/service.js';
import type { Store } from './store.js';

/** Task counts per status value (custom statuses keep their own names). */
function countByStatus(tasks: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { status } of tasks) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

type GoalNode = Pick<EntityDataMap['goal'], 'title' | 'status' | 'successCriteria'> & {
  id: string;
  subgoals: GoalNode[];
};

/**
 * A compact, structured view of a whole project, sized for an agent to read in one go.
 * Long text (task descriptions, decision bodies) is left out; fetch entities for details.
 */
export function projectSnapshot(store: Store, projectId: string) {
  const project = store.getOfType('project', projectId);
  const repository = project.data.repositoryId
    ? store.getOfType('repository', project.data.repositoryId)
    : null;
  const stages = store.list('stage', { projectId });
  const tasks = store.list('task', { projectId });
  const goals = store.list('goal', { projectId });
  const assigneeNames = new Map(store.list('assignee').map((a) => [a.id, a.data.name]));
  const taskData = tasks.map((t) => t.data);

  const goalNodes = new Map<string, GoalNode>(
    goals.map((g) => [
      g.id,
      {
        id: g.id,
        title: g.data.title,
        status: g.data.status,
        successCriteria: g.data.successCriteria,
        subgoals: [],
      },
    ]),
  );
  const goalTree: GoalNode[] = [];
  for (const g of goals) {
    const node = goalNodes.get(g.id)!;
    const parent = g.data.parentId ? goalNodes.get(g.data.parentId) : undefined;
    (parent ? parent.subgoals : goalTree).push(node);
  }

  const scope = store.list('scope_item', { projectId }).map((s) => ({
    id: s.id,
    title: s.data.title,
    kind: s.data.kind,
    rationale: s.data.rationale,
  }));

  return {
    project: {
      id: project.id,
      name: project.data.name,
      summary: project.data.summary,
      description: project.data.description,
      status: project.data.status,
      currentStageId: project.data.currentStageId,
      repository: repository && {
        id: repository.id,
        name: repository.data.name,
        path: repository.data.path,
        url: repository.data.url,
      },
      updatedAt: project.updatedAt,
    },
    /** Only fields with custom options are listed; the rest use the defaults. */
    options: Object.fromEntries(
      OPTION_KEYS.filter((k) => project.data.options?.[k]).map((k) => [
        k,
        optionsFor(project, k).map(({ value, label, meaning }) => ({ value, label, meaning })),
      ]),
    ),
    progress: {
      percentDone: taskProgress(tasks, project).percent,
      tasks: countByStatus(taskData),
    },
    goals: goalTree,
    scope: {
      in: scope.filter((s) => meaningOf(project, 'scope_item.kind', s.kind) === 'in'),
      out: scope.filter((s) => meaningOf(project, 'scope_item.kind', s.kind) === 'out'),
      maybe: scope.filter((s) => meaningOf(project, 'scope_item.kind', s.kind) === 'maybe'),
    },
    stages: stages.map((s) => {
      const { percent, done, total, basis } = stageProgress(s, tasks, project);
      return {
        id: s.id,
        name: s.data.name,
        status: s.data.status,
        startDate: s.data.startDate,
        targetDate: s.data.targetDate,
        current: s.id === project.data.currentStageId,
        percentDone: percent,
        progressBasis: basis,
        tasks: countByStatus(taskData.filter((t) => t.stageId === s.id)),
        tasksDone: `${done}/${total}`,
      };
    }),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.data.title,
      status: t.data.status,
      priority: t.data.priority,
      stageId: t.data.stageId,
      assignee: t.data.assigneeId ? assigneeNames.get(t.data.assigneeId) : undefined,
      dependsOn: t.data.dependsOn.length ? t.data.dependsOn : undefined,
      estimate: t.data.estimate,
      dueDate: t.data.dueDate,
    })),
    artifacts: store.list('artifact', { projectId }).map((a) => ({
      id: a.id,
      title: a.data.title,
      kind: a.data.kind,
      status: a.data.status,
      uri: a.data.uri,
      stageId: a.data.stageId,
      taskId: a.data.taskId,
    })),
    // People and agents work can be assigned to (shared across projects), with ids for assigneeId.
    assignees: store
      .list('assignee')
      .map((a) => ({ id: a.id, name: a.data.name, kind: a.data.kind })),
    decisions: store.list('decision', { projectId }).map((d) => ({
      id: d.id,
      title: d.data.title,
      status: d.data.status,
      decidedById: d.data.decidedById,
      decisionDate: d.data.decisionDate,
      recordedAt: d.createdAt,
    })),
    views: store
      .list('view', { projectId })
      .filter((v) => !v.data.archived && !isExpired(v))
      .map((v) => ({
        id: v.id,
        name: v.data.name,
        pinned: v.data.pinned,
        kind:
          v.data.kind === 'answer'
            ? 'answer'
            : v.data.spec
              ? 'custom'
              : `template:${v.data.template ?? 'overview'}`,
        ...(v.data.question ? { question: v.data.question } : {}),
      })),
    /** Questions people asked from the UI that no agent has answered yet. */
    requests: store.list('request', { projectId, where: { status: 'open' } }).map((r) => ({
      id: r.id,
      question: r.data.question,
      ...(r.data.about ? { about: r.data.about } : {}),
      ...(r.data.aboutId ? { aboutId: r.data.aboutId } : {}),
      ...(r.data.viewId ? { viewId: r.data.viewId } : {}),
      ...(r.data.widgetId ? { widgetId: r.data.widgetId } : {}),
      context: requestContext(store, r),
      askedAt: r.createdAt,
    })),
    recentRevisions: store.history({ projectId, limit: 5 }).map((r) => ({
      id: r.id,
      author: r.author.name,
      message: r.message,
      createdAt: r.createdAt,
      changes: r.changes.length,
    })),
  };
}
