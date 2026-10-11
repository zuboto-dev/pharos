import { BOARD_GUIDE, COMPONENT_INFO, similarAnswers, type ComponentName } from '@pharos/schema';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { isExpired, requestContext } from './views/service.js';

/**
 * Guidance for agents as MCP resources and prompts, so clients can load it without a tool call.
 * The same rules back the catalog tools; this adds the judgement about what makes a good view.
 */
export const VIEW_GUIDELINES = `# Designing Pharos views

Pharos shows a project as views made of widgets. People read views instead of long text, so a
good view replaces a paragraph you would otherwise write.

## Pick the kind of view
- **Answer view** (view_answer): someone asked a question. It expires after a week unless kept.
- **Saved view** (view_create): an angle someone will come back to (a release, a weekly check-in).
- **Edit** an existing view (view_update) when they ask to change "the board" or "the overview".

## Shape
1. **Lead with the answer.** The first widget says it in one or two sentences: a Text with live
   numbers, or a Callout when it is a warning, blocker, or recommendation.
2. **Then the evidence**, most important first: the table, chart, or list that proves the answer.
3. **One question per view, 3–8 widgets.** If you need more, it is two questions.
4. **Widths in a row add up to 12.** Typical rows: 12 · 6+6 · 4+8 · 3+3+3+3 (stats).
   Never go below a component's minColumns.

## Choosing components
- Prefer domain components when they fit: KanbanBoard (work by status), StageTracker and
  Timeline (where and when), GoalTree and ScopeBoard (why and what), DependencyGraph (what waits
  on what), DecisionLog (what was decided).
- Use the generic tier when you need a specific field or type: DataTable (chosen columns),
  CountChart (distribution), Stat (one number), DataList (short list), Text (sentence with numbers).
- Filter instead of copying: never put counts or names into text by hand; use Text values or a
  query so the view stays right as the project changes.

## Queries that answer common questions
- Overdue: {dueDate: {lt: "$today"}, status: {not: ["done", "cancelled"]}}
- Due this week: {dueDate: {gte: "$today", lte: "$today+7d"}}
- Late stages' work: {"stage.targetDate": {lt: "$today"}, status: {not: "done"}}
- Blocked or overdue: anyOf [{status: "blocked"}, {dueDate: {lt: "$today"}, status: {not: ["done", "cancelled"]}}]
- Current stage: {stageId: "$currentStage"}
- High priority and up: {priority: {gte: "high"}}

## Before you say it is ready
- Read the preview that view_answer, view_create, and view_update return (or run view_preview on
  a draft). Fix unknown fields, unintended empty widgets, and width warnings. An empty widget is fine only when "nothing" is the answer, and then
  say so in the headline.
- In chat, keep it short: one or two sentences with the answer and the link. The view carries the detail.
`;

/** Question → good answer view pairs, used as worked examples. */
export const EXAMPLES: { question: string; why: string; widgets: unknown[] }[] = [
  {
    question: "What's overdue?",
    why: 'Headline with the count, then the overdue tasks with who has them and how late.',
    widgets: [
      {
        id: 'headline',
        node: {
          component: 'Text',
          content: '**${late}** tasks are overdue; **${soon}** more are due this week.',
          values: {
            late: {
              count: {
                type: 'task',
                where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
              },
            },
            soon: {
              count: {
                type: 'task',
                where: {
                  dueDate: { gte: '$today', lte: '$today+7d' },
                  status: { not: ['done', 'cancelled'] },
                },
              },
            },
          },
        },
      },
      {
        id: 'late',
        node: {
          component: 'DataTable',
          title: 'Overdue',
          query: {
            type: 'task',
            where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
            sort: [{ field: 'dueDate' }],
          },
          columns: [
            { field: 'title' },
            { field: 'dueDate', label: 'Due' },
            { field: 'assigneeId', label: 'Who' },
            { field: 'stage.name', label: 'Stage' },
          ],
        },
      },
    ],
  },
  {
    question: "What's blocking the current stage?",
    why: 'A Callout names the bottleneck; the dependency graph shows why; progress gives context.',
    widgets: [
      {
        id: 'answer',
        node: {
          component: 'Callout',
          tone: 'warning',
          title: 'Bottleneck: <task>',
          body: 'Explain what waits on it, in one or two sentences.',
        },
      },
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
        id: 'open',
        w: 8,
        node: {
          component: 'TaskTable',
          title: 'Not done yet',
          filter: { where: { stageId: '$currentStage', status: { not: ['done', 'cancelled'] } } },
          columns: ['status', 'assignee', 'dependsOn'],
        },
      },
      {
        id: 'order',
        node: {
          component: 'DependencyGraph',
          title: 'What waits on what',
          filter: { where: { stageId: '$currentStage' } },
        },
      },
    ],
  },
  {
    question: 'Who is working on what?',
    why: 'Workload by person, then the board grouped by assignee.',
    widgets: [
      {
        id: 'load',
        w: 6,
        node: {
          component: 'CountChart',
          title: 'Open tasks per person',
          query: { type: 'task', where: { status: { not: ['done', 'cancelled'] } } },
          by: 'assigneeId',
          sort: 'count',
        },
      },
      { id: 'matrix', w: 6, node: { component: 'AssigneeMatrix', title: 'By status' } },
      {
        id: 'board',
        node: {
          component: 'KanbanBoard',
          title: 'Work by person',
          groupBy: 'assignee',
          filter: { where: { status: { not: ['done', 'cancelled'] } } },
        },
      },
    ],
  },
  {
    question: 'Are we on track?',
    why: 'Overall progress and the schedule, with the stages at risk called out.',
    widgets: [
      {
        id: 'headline',
        node: {
          component: 'Text',
          content: '**${pct}** done overall; current stage **${stage}** is due **${due}**.',
          values: {
            pct: {
              percent: {
                query: { type: 'task', where: { status: 'done' } },
                of: { type: 'task', where: { status: { not: 'cancelled' } } },
              },
            },
            stage: { project: 'currentStage' },
            due: { project: 'currentStageTarget' },
          },
        },
      },
      { id: 'stages', node: { component: 'StageTracker', title: 'Stages' } },
      { id: 'timeline', node: { component: 'Timeline', title: 'Schedule' } },
    ],
  },
  {
    question: 'What did we decide about <topic>?',
    why: 'Text search over decisions, newest first.',
    widgets: [
      {
        id: 'decisions',
        node: {
          component: 'DecisionLog',
          title: 'Decisions about <topic>',
          filter: { where: { title: { contains: '<topic>' } } },
        },
      },
    ],
  },
];

function examplesMarkdown(): string {
  return [
    '# Example answer views',
    '',
    'Question → widgets that answer it well. Adapt titles, filters, and texts to the project.',
    ...EXAMPLES.flatMap((e) => [
      '',
      `## ${e.question}`,
      '',
      e.why,
      '',
      '```json',
      JSON.stringify(e.widgets, null, 2),
      '```',
    ]),
  ].join('\n');
}

function catalogMarkdown(): string {
  return [
    '# Pharos component catalog',
    '',
    BOARD_GUIDE,
    '',
    ...(Object.keys(COMPONENT_INFO) as ComponentName[]).map(
      (name) =>
        `- **${name}** (${COMPONENT_INFO[name].category}, min ${COMPONENT_INFO[name].minColumns} cols): ${COMPONENT_INFO[name].use}`,
    ),
    '',
    'Use the catalog_describe tool for each component’s exact props.',
  ].join('\n');
}

function text(uri: string, body: string, mimeType = 'text/markdown') {
  return { contents: [{ uri, mimeType, text: body }] };
}

/**
 * Everything an agent needs to answer the open questions in some projects in one go: the
 * questions, the guidelines, the catalog, and worked examples. Given to the question-answering
 * agent up front, so it doesn't spend calls discovering them.
 */
export function answerBrief(store: Store, projectIds: string[]): string {
  const questions = projectIds.flatMap((projectId) => {
    const project = store.getOfType('project', projectId);
    const answers = store
      .list('view', { projectId })
      .filter((v) => v.data.kind === 'answer' && !v.data.archived && !isExpired(v));
    return store.list('request', { projectId, where: { status: 'open' } }).map((r) =>
      [
        `- requestId ${r.id} in project "${project.data.name}" (${projectId}): ${r.data.question}`,
        r.data.about ? `  Asked from: ${r.data.about}` : '',
        ...requestContext(store, r).map((line) => `  ${line}`),
        ...similarAnswers(r.data.question, answers, (v) => v.data.question)
          .slice(0, 2)
          .map(
            (v) =>
              `  Answered before: view ${v.id} ("${v.data.question}"). Its data is live; if it still answers this, link it instead of building a new view: apply an update to request ${r.id} with {status: "answered", answerViewId: "${v.id}"}.`,
          ),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });
  return [
    'Handle these requests from people using Pharos. Each was sent with Ask from a widget or an',
    'item, so read it together with what it was asked about. Nobody reads your chat reply; put what',
    'you have to say in a view.',
    '',
    ...questions,
    '',
    'People use Ask for three things. Work out which one each request is:',
    '- A question about the project: answer it with view_answer (pass the requestId).',
    '- A request to change the project (tasks, stages, decisions, …) or a view: make the change',
    '  (apply, or view_update for views), then use view_answer to show what changed.',
    '- Feedback about Pharos itself: how a component looks or behaves, or a missing feature',
    '  (e.g. "the text in this column wraps", "this has no field for X"). That is about the app,',
    "  not this project's data, so don't rearrange their view to work around it. If a project",
    '  tracks Pharos itself, add a task there for it; then answer with view_answer in one or two',
    '  sentences: what you understood and what you recorded.',
    '',
    'For each request: call project_snapshot for its project (once per project), use get or list',
    'only for details the snapshot lacks, then do the above. view_answer returns a preview; fix',
    'problems with view_update if it shows any, then move on. Use catalog_describe only for a',
    "component whose props aren't shown in the examples below.",
    '',
    VIEW_GUIDELINES,
    catalogMarkdown(),
    '',
    examplesMarkdown(),
  ].join('\n');
}

export function registerGuidance(server: McpServer, store: Store): void {
  server.registerResource(
    'view-guidelines',
    'pharos://guide/views',
    {
      title: 'View design guidelines',
      description: 'How to design good Pharos views and answers',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, VIEW_GUIDELINES),
  );
  server.registerResource(
    'catalog',
    'pharos://guide/catalog',
    {
      title: 'Component catalog',
      description: 'Every view component, when to use it, and the board and filter rules',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, catalogMarkdown()),
  );
  server.registerResource(
    'answer-examples',
    'pharos://examples/answers',
    {
      title: 'Example answer views',
      description: 'Common questions and the widgets that answer them well',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, examplesMarkdown()),
  );
  server.registerResource(
    'project-snapshot',
    new ResourceTemplate('pharos://projects/{projectId}/snapshot', {
      list: () => ({
        resources: store.list('project').map((p) => ({
          uri: `pharos://projects/${p.id}/snapshot`,
          name: `${p.data.name} snapshot`,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Project snapshot',
      description: 'A compact summary of one project',
      mimeType: 'application/json',
    },
    (uri, { projectId }) =>
      text(
        uri.href,
        JSON.stringify(projectSnapshot(store, String(projectId)), null, 2),
        'application/json',
      ),
  );

  const guideAndExamples = `${VIEW_GUIDELINES}\n\n${examplesMarkdown()}`;
  server.registerPrompt(
    'answer_question',
    {
      title: 'Answer a question with a view',
      description: 'Answer a question about a project with a focused Pharos answer view',
      argsSchema: {
        question: z.string().describe('The question'),
        project: z.string().optional().describe('Project name or id'),
      },
    },
    ({ question, project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Answer this question about ${project ? `the project "${project}"` : 'my project'} in Pharos with an answer view (view_answer), following these guidelines. Check the preview it returns, then reply in one or two sentences with the answer and the link.\n\nQuestion: ${question}\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'catch_up',
    {
      title: 'Catch up on a project',
      description: 'See what people changed since you last looked and answer their open questions',
      argsSchema: { project: z.string().optional().describe('Project name or id') },
    },
    ({ project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Catch up on ${project ? `"${project}"` : 'my project'} in Pharos: call changes_since and summarize what people changed in a few bullets, then answer every open question in project_snapshot.requests with view_answer (pass its requestId), following these guidelines.\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'design_view',
    {
      title: 'Design a saved view',
      description: 'Build a saved Pharos view for a purpose, e.g. a weekly check-in',
      argsSchema: {
        purpose: z.string().describe('What the view is for'),
        project: z.string().optional(),
      },
    },
    ({ purpose, project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a saved view in Pharos for ${project ? `"${project}"` : 'my project'}: ${purpose}. Follow these guidelines, check the preview view_create returns, and reply with the link.\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
}
