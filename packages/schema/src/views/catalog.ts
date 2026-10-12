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

/** Shared by text blocks and the explain blocks: mark project terms the reader can tap. */
const terms = z
  .boolean()
  .optional()
  .describe('Explain project terms where they first appear in this widget (default true)');

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
  terms,
});

export const MarkdownNode = component('Markdown', 'Formatted text.', {
  content: z.string().optional().describe('Markdown to show'),
  source: z
    .enum(['project.description'])
    .optional()
    .describe('Show a stored field instead of fixed content'),
  terms,
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
    terms,
  },
);

// ------------------------------------------------------------------ explain
// Stored claims (findings) and terms, shown so a reader sees the point, how sure it is, and where
// it comes from. The spec holds claim ids, tags and filters only, never a claim's words.

const ExplainTone = z
  .enum(['neutral', 'own', 'watch', 'gap'])
  .describe('own: Pharos has it · watch: take care · gap: missing');

const Layer = z.strictObject({
  key: z.string().min(1).max(3).describe('Marker in the circle, e.g. "5"; `open` refers to it'),
  title: z.string().min(1).max(60).describe('A name, not a claim, e.g. "The recipe format"'),
  hint: z
    .string()
    .max(90)
    .optional()
    .describe('One line under the title, e.g. "How the AI writes down which blocks go where"'),
  pill: z
    .strictObject({
      label: z.string().min(1).max(30),
      tone: ExplainTone,
      claim: z
        .string()
        .optional()
        .describe('Id of the claim behind the label; shown first in the layer with its mark'),
    })
    .optional(),
  highlight: z.boolean().optional().describe('Draw this one as the layer that matters most'),
  items: Filter.describe(
    'Which claims it holds, e.g. {"where": {"tags": "layer-4"}}; sorted by order unless sort is given',
  ),
});

export const LayersNode = component(
  'Layers',
  'Ordered layers or steps, each holding stored claims: a stack the reader taps open, or steps side by side.',
  {
    layers: z.array(Layer).min(2).max(7).describe('Top to bottom (stack) or left to right (row)'),
    orientation: z
      .enum(['stack', 'row'])
      .optional()
      .describe('stack (default): one layer open at a time; row: every step shown'),
    open: z.string().optional().describe('stack: key of the layer open at first (default none)'),
    prompt: z
      .string()
      .max(80)
      .optional()
      .describe('What to do, e.g. "Tap a layer to see the tools in it."'),
    legend: z
      .array(z.strictObject({ tone: ExplainTone, label: z.string().min(1).max(30) }))
      .max(4)
      .optional(),
    axis: z
      .strictObject({ from: z.string().max(30), to: z.string().max(30) })
      .optional()
      .describe('row: labels at the two ends, e.g. "more control" and "more freedom"'),
    highlightAbout: z
      .string()
      .optional()
      .describe('Artifact id; the card about it is drawn in the accent colour'),
    warnTag: z
      .string()
      .optional()
      .describe('Claims with this tag show as a warning in their card (default "watch")'),
    terms,
  },
);

export const ClaimCardNode = component(
  'ClaimCard',
  'One stored claim: its statement, how sure it is (a mark with a word and the checked date) and its source link.',
  {
    claim: z.string().min(1).describe('Id of a claim in this project'),
    size: z
      .enum(['headline', 'card'])
      .optional()
      .describe("headline: the view's point, large, first on the page; card (default)"),
    kicker: z
      .string()
      .max(30)
      .optional()
      .describe('One to three words above the statement, e.g. "Build"'),
    tone: ExplainTone.optional(),
    terms,
  },
);

// ------------------------------------------------------------------ report opening
// The "start here" block that opens a report page (docs/reframe/start-here.md): one purpose, one
// headline, where the page sits, and a short reading path into the widgets below.

/** Limits the save-time warnings check (start-here.md); the schema itself is looser. */
export const START_HERE = {
  /** GOV.UK summaries: under 160 characters, with a verb. */
  headlineChars: 160,
  minSteps: 2,
  maxSteps: 4,
} as const;

export const ReportPurpose = z
  .enum(['done', 'found', 'needs-you'])
  .describe(
    'done: work finished · found: research or a finding · needs-you: a decision for the reader',
  );

const StartStep = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(40)
    .describe('What the step is, key word first, e.g. "What changed"'),
  says: z
    .string()
    .max(100)
    .optional()
    .describe('What the reader will see there, e.g. "Three screens, before and after"'),
  target: z
    .string()
    .min(1)
    .optional()
    .describe('Id of a widget on this board; tapping the step scrolls to it'),
});

const IsoDate = z.iso.date();

export const StartHereNode = component(
  'StartHere',
  'The opening of a report page: its one purpose, a headline sentence with its evidence, where it sits, and a reading path of 2–4 steps.',
  {
    purpose: ReportPurpose,
    headline: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        `The outcome in one sentence with a verb, under ${START_HERE.headlineChars} characters. Leave it out when claim is set`,
      ),
    claim: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of the claim the headline states (found pages): its statement is shown, with its certainty mark and sources',
      ),
    evidence: z
      .array(z.string().min(1))
      .max(8)
      .optional()
      .describe(
        'Ids of what backs the headline: artifacts (links, files, test results), tasks, decisions or claims',
      ),
    stageId: z.string().optional().describe('The stage this report belongs to'),
    goalId: z.string().optional().describe('The goal this report belongs to'),
    date: IsoDate.describe('YYYY-MM-DD the report speaks for'),
    due: IsoDate.optional().describe('needs-you: YYYY-MM-DD the answer is needed by'),
    path: z
      .array(StartStep)
      .min(1)
      .max(6)
      .describe(
        `The reading path: ${START_HERE.minSteps}–${START_HERE.maxSteps} steps in reading order, each pointing at a widget below`,
      ),
    terms,
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
  LayersNode,
  ClaimCardNode,
  StartHereNode,
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
