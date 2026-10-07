import { z } from 'zod';
import { Filter, Query, Where } from './query.js';

/**
 * The component catalog: every building block a view can use, with the props agents may set.
 * Components read live project data through filters/queries, so views never copy data.
 */

const common = {
  title: z.string().optional().describe('Heading shown above the component'),
  span: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe('Columns to span when inside a Grid (default 1)'),
};

function component<C extends string, S extends z.ZodRawShape>(
  name: C,
  description: string,
  shape: S,
) {
  return z.strictObject({ component: z.literal(name), ...common, ...shape }).describe(description);
}

// ------------------------------------------------------------------ layout

// Layout nodes are written out (not via `component`) so their recursive `children` getters stay
// lazy; spreading an object would evaluate them before ViewNode exists.

export const GridNode = z
  .strictObject({
    component: z.literal('Grid'),
    ...common,
    columns: z.number().int().min(1).max(4).optional().describe('Default 2'),
    get children(): z.ZodArray<z.ZodType<ViewNode>> {
      return z.array(ViewNode);
    },
  })
  .describe('Lays children out in equal columns.');

export const SectionNode = z
  .strictObject({
    component: z.literal('Section'),
    ...common,
    description: z.string().optional(),
    get children(): z.ZodArray<z.ZodType<ViewNode>> {
      return z.array(ViewNode);
    },
  })
  .describe('Groups children under a heading.');

const Tab = z.strictObject({
  label: z.string(),
  get children(): z.ZodArray<z.ZodType<ViewNode>> {
    return z.array(ViewNode);
  },
});

export const TabsNode = z
  .strictObject({ component: z.literal('Tabs'), ...common, tabs: z.array(Tab) })
  .describe('Switchable tabs, each with its own children.');

// ------------------------------------------------------------------ overview

export const ProjectHeaderNode = component(
  'ProjectHeader',
  'Project name, summary, status, repository, current stage, and overall progress.',
  {},
);

export const StatCardsNode = component('StatCards', 'A row of key numbers.', {
  stats: z.array(
    z.strictObject({
      label: z.string(),
      query: Query.optional().describe('Shows how many entities match'),
      of: Query.optional().describe('With query, shows "matching / total"'),
      value: z
        .union([z.string(), z.number()])
        .optional()
        .describe('A fixed value instead of a query'),
      tone: z.enum(['neutral', 'good', 'warning', 'bad']).optional(),
    }),
  ),
});

export const ProgressRingNode = component(
  'ProgressRing',
  'Percentage of tasks done (cancelled tasks excluded).',
  {
    where: Where.optional().describe('Which tasks to count, e.g. {"stageId": "$currentStage"}'),
    label: z.string().optional(),
  },
);

export const CalloutNode = component('Callout', 'A highlighted note, e.g. a risk or key message.', {
  tone: z.enum(['info', 'success', 'warning', 'danger']).optional(),
  body: z.string().describe('Markdown'),
});

export const MarkdownNode = component('Markdown', 'Formatted text.', {
  content: z.string().optional().describe('Markdown to show'),
  source: z
    .enum(['project.description'])
    .optional()
    .describe('Show a stored field instead of fixed content'),
});

// ------------------------------------------------------------------ goals & scope

export const GoalTreeNode = component(
  'GoalTree',
  'Goals and sub-goals with status and success criteria.',
  {
    filter: Filter.optional(),
    showCriteria: z.boolean().optional().describe('Default true'),
  },
);

export const ScopeBoardNode = component('ScopeBoard', 'Scope items in In / Maybe / Out columns.', {
  kinds: z
    .array(z.enum(['in', 'maybe', 'out']))
    .optional()
    .describe('Columns to show (default all)'),
});

// ------------------------------------------------------------------ plan & time

export const StageTrackerNode = component(
  'StageTracker',
  'Stages as a horizontal stepper with status, progress, and the current stage highlighted.',
  {
    filter: Filter.optional().describe('Which stages, e.g. {"where": {"id": "$currentStage"}}'),
  },
);

export const TimelineNode = component(
  'Timeline',
  'Stages on a time axis using their start and target dates (stages without dates are listed separately).',
  {
    filter: Filter.optional().describe('Which stages to show'),
  },
);

export const MilestoneListNode = component(
  'MilestoneList',
  'Stages as a vertical list with dates, status, and task progress.',
  { filter: Filter.optional() },
);

// ------------------------------------------------------------------ work

const TaskGroup = z.enum(['status', 'stage', 'assignee', 'priority']);

export const KanbanBoardNode = component('KanbanBoard', 'Tasks as cards in columns.', {
  filter: Filter.optional(),
  groupBy: TaskGroup.optional().describe('Default status'),
  hideEmpty: z.boolean().optional().describe('Hide columns without tasks'),
});

export const TaskTableNode = component('TaskTable', 'Tasks as a table.', {
  filter: Filter.optional(),
  columns: z
    .array(z.enum(['status', 'priority', 'stage', 'assignee', 'estimate', 'dueDate', 'dependsOn']))
    .optional()
    .describe('Columns after the title (default status, priority, stage, assignee)'),
});

export const TaskChecklistNode = component(
  'TaskChecklist',
  'Tasks as a checklist people can tick off, with start/done actions. Good for work assigned to humans.',
  {
    filter: Filter.optional(),
    assigneeKind: z
      .enum(['human', 'agent'])
      .optional()
      .describe('Only tasks assigned to people (human) or agents (agent)'),
    hideDone: z.boolean().optional().describe('Hide done and cancelled tasks (default true)'),
  },
);

export const DependencyGraphNode = component(
  'DependencyGraph',
  'Tasks as a left-to-right graph following dependsOn.',
  { filter: Filter.optional() },
);

export const AssigneeMatrixNode = component(
  'AssigneeMatrix',
  'Task counts per assignee and status.',
  { filter: Filter.optional() },
);

// ------------------------------------------------------------------ outputs

export const ArtifactGalleryNode = component(
  'ArtifactGallery',
  'Expected and delivered artifacts as cards.',
  { filter: Filter.optional() },
);

export const DecisionLogNode = component('DecisionLog', 'Decisions, newest first.', {
  filter: Filter.optional(),
});

export const ActivityFeedNode = component(
  'ActivityFeed',
  'Recent revisions: who changed what and why.',
  {
    limit: z.number().int().min(1).max(50).optional().describe('Default 10'),
  },
);

// ------------------------------------------------------------------ generic data
// Query-bound building blocks for any entity type and field, next to the domain components.

const FieldPath = z
  .string()
  .min(1)
  .describe(
    'A field of the queried type, or one hop through a reference, e.g. "status", "stage.name", "assignee.kind"',
  );

export const DataTableNode = component(
  'DataTable',
  'A table of any entity type with the columns you choose.',
  {
    query: Query,
    columns: z
      .array(z.strictObject({ field: FieldPath, label: z.string().optional() }))
      .min(1)
      .describe('Columns in order. Clicking a row opens that item'),
  },
);

export const CountChartNode = component(
  'CountChart',
  'Bars counting entities grouped by a field.',
  {
    query: Query,
    by: FieldPath.describe(
      'Field to group by, e.g. "status", "kind", "stage.name", "assignee.kind"',
    ),
    sort: z
      .enum(['count', 'field'])
      .optional()
      .describe("Biggest first (count) or in the field's natural order (default)"),
    limit: z.number().int().min(1).max(50).optional().describe('Show at most this many bars'),
  },
);

export const StatNode = component(
  'Stat',
  'One number: how many entities match, or what share of another query they are.',
  {
    label: z.string(),
    query: Query,
    of: Query.optional().describe('With this, shows a percentage of it instead of a count'),
    tone: z.enum(['neutral', 'good', 'warning', 'bad']).optional(),
    caption: z.string().optional().describe('Small text under the number'),
  },
);

export const DataListNode = component('DataList', 'A compact list of any entity type.', {
  query: Query,
  secondary: z
    .array(FieldPath)
    .optional()
    .describe('Fields shown after each item, e.g. ["status", "dueDate"]'),
});

const TextValue = z.union([
  z.strictObject({ count: Query }),
  z.strictObject({ percent: z.strictObject({ query: Query, of: Query }) }),
  z.strictObject({
    project: z.enum(['name', 'summary', 'status', 'currentStage', 'currentStageTarget']),
  }),
]);

export const TextNode = component(
  'Text',
  'Markdown with live values, e.g. "**${open}** tasks open, ${late} overdue".',
  {
    content: z.string().describe('Markdown; ${name} is replaced by values[name]'),
    values: z
      .record(z.string().regex(/^\w+$/), TextValue)
      .optional()
      .describe('Named values: {count: query}, {percent: {query, of}}, or {project: field}'),
  },
);

// ------------------------------------------------------------------ the tree

const LEAF_NODES = [
  ProjectHeaderNode,
  StatCardsNode,
  ProgressRingNode,
  CalloutNode,
  MarkdownNode,
  GoalTreeNode,
  ScopeBoardNode,
  StageTrackerNode,
  TimelineNode,
  MilestoneListNode,
  KanbanBoardNode,
  TaskTableNode,
  TaskChecklistNode,
  DependencyGraphNode,
  AssigneeMatrixNode,
  ArtifactGalleryNode,
  DecisionLogNode,
  ActivityFeedNode,
  DataTableNode,
  CountChartNode,
  StatNode,
  DataListNode,
  TextNode,
] as const;

type Common = { title?: string; span?: number };
type LeafNode = z.infer<(typeof LEAF_NODES)[number]>;

// Written by hand because TypeScript can't infer a recursive union.
export type ViewNode =
  | LeafNode
  | (Common & { component: 'Grid'; columns?: number; children: ViewNode[] })
  | (Common & { component: 'Section'; description?: string; children: ViewNode[] })
  | (Common & { component: 'Tabs'; tabs: { label: string; children: ViewNode[] }[] });

/** Every node schema; a discriminated union over these gives precise, path-based errors. */
export const NODE_SCHEMAS = () => [GridNode, SectionNode, TabsNode, ...LEAF_NODES] as const;

export const ViewNode: z.ZodType<ViewNode> = z.lazy(() =>
  z.discriminatedUnion('component', NODE_SCHEMAS()),
);

export type ComponentName = ViewNode['component'];
export type NodeOf<C extends ComponentName> = Extract<ViewNode, { component: C }>;

/** Every catalog component's schema, by name. */
export const CATALOG = Object.fromEntries(
  [GridNode, SectionNode, TabsNode, ...LEAF_NODES].map((node) => [
    node.shape.component.value,
    node,
  ]),
) as unknown as Record<ComponentName, z.ZodObject>;
