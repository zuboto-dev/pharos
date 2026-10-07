import type { Board } from './board.js';

/** Built-in view templates. A view with `template` renders the latest version of it. */
export const TEMPLATES = {
  overview: {
    component: 'Board',
    widgets: [
      { id: 'header', node: { component: 'ProjectHeader' } },
      {
        id: 'stats',
        node: {
          component: 'StatCards',
          stats: [
            {
              label: 'Open',
              query: { type: 'task', where: { status: ['todo', 'in_progress', 'blocked'] } },
            },
            { label: 'In progress', query: { type: 'task', where: { status: 'in_progress' } } },
            {
              label: 'Blocked',
              query: { type: 'task', where: { status: 'blocked' } },
              tone: 'bad',
            },
            {
              label: 'Done',
              query: { type: 'task', where: { status: 'done' } },
              of: { type: 'task', where: { status: { not: 'cancelled' } } },
              tone: 'good',
            },
          ],
        },
      },
      { id: 'stages', node: { component: 'StageTracker', title: 'Stages' } },
      {
        id: 'progress',
        w: 4,
        node: {
          component: 'ProgressRing',
          title: 'Current stage',
          where: { stageId: '$currentStage' },
        },
      },
      {
        id: 'people',
        w: 8,
        node: { component: 'TaskChecklist', title: 'Assigned to people', assigneeKind: 'human' },
      },
      {
        id: 'tasks',
        node: {
          component: 'KanbanBoard',
          title: 'Tasks',
          filter: { where: { status: { not: 'cancelled' } } },
        },
      },
      { id: 'goals', w: 6, node: { component: 'GoalTree', title: 'Goals' } },
      { id: 'scope', w: 6, node: { component: 'ScopeBoard', title: 'Scope' } },
      {
        id: 'decisions',
        w: 6,
        node: { component: 'DecisionLog', title: 'Decisions', filter: { limit: 5 } },
      },
      {
        id: 'activity',
        w: 6,
        node: { component: 'ActivityFeed', title: 'Recent activity', limit: 8 },
      },
    ],
  },
} satisfies Record<string, Board>;

export type TemplateName = keyof typeof TEMPLATES;
