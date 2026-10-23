import { z } from 'zod';
import { ACTION_FIELDS } from '../actions.js';
import { DUE_BANDS } from '../records.js';
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

/** Limits for the R4 picture blocks (r4-plan.md), checked by the preview's warnings. */
export const R4 = {
  flowMinSteps: 2,
  flowMaxSteps: 5,
  /** A flow box's label. */
  flowLabelChars: 30,
  /** Words a BeforeAfter shows: the stated change and the changed lines. */
  beforeAfterWords: 40,
  /** A FindingChart's title claim, in words. */
  findingTitleWords: 15,
  minBars: 2,
  maxBars: 12,
} as const;

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

export const StatCardsNode = component(
  'StatCards',
  'A row of key numbers; a stat with `of` also draws a word-sized bar.',
  {
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
  },
);

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

/** F6 (R4): titles like "W3.8 · Measure the baseline" read as "Measure the baseline". */
const hideCodes = z
  .boolean()
  .optional()
  .describe('Hide work codes at the start of titles, e.g. "W3.8 · " (default false)');
/** Terms in data rows are off unless asked for, so task boards stay plain. */
const rowTerms = z
  .boolean()
  .optional()
  .describe('Explain project terms where they first appear in the rows (default false)');

export const TaskTableNode = component('TaskTable', 'Tasks as a table.', {
  filter: Filter.optional(),
  hideCodes,
  terms: rowTerms,
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

export const MapNode = component(
  'Map',
  'Goals in a ring around the project (or one goal) and the tasks serving them around each; a task serving several goals sits between them, lines show what it waits on, colour its status. Tasks on no goal gather apart.',
  {
    center: z
      .string()
      .optional()
      .describe('A goal to center on (its sub-goals form the ring); default the project'),
    filter: Filter.optional().describe('Which tasks to place'),
  },
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

/** R10.19: one proposed decision the reader answers on the page. */
export const DecisionBlockNode = component(
  'DecisionBlock',
  "One proposed decision: its options side by side with what each leads to, pros, cons and sources, the recommendation marked, and buttons to choose, write another answer or decide later. Once answered it shows the owner's choice.",
  { decision: z.string().min(1).describe('Id of a decision with options in this project') },
);

/** Filter controls a FileList can show above its rows (R7). */
export const FILE_LIST_CONTROLS = ['search', 'kind', 'tag', 'issuer', 'expiry'] as const;
/** Details a FileList row can show after the title. */
export const FILE_LIST_DETAILS = [
  'issuer',
  'issuedDate',
  'expiryDate',
  'tags',
  'size',
  'modifiedAt',
] as const;

export const FileListNode = component(
  'FileList',
  "Files from the owner's folders added to this project, grouped by kind; a row opens the file viewer (preview, actions, details).",
  {
    filter: Filter.optional().describe(
      'Which files, e.g. {"where": {"tags": "tax-2025"}} or expiring soon {"where": {"expiryDate": {"lte": "$today+60d"}}}',
    ),
    groupBy: z.enum(['kind', 'none']).optional().describe('Default kind'),
    controls: z
      .array(z.enum(FILE_LIST_CONTROLS))
      .optional()
      .describe(
        'Controls the reader can filter with: a name search and filters for kind, tag, issuer and expiry (default all; [] hides them)',
      ),
    details: z
      .array(z.enum(FILE_LIST_DETAILS))
      .optional()
      .describe(
        'Shown after each title (default: the one date that matters, expiry, else issued, else changed)',
      ),
    showIn: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of a FileView widget on the same board: tapping a row shows that file there instead of opening the viewer',
      ),
  },
);

/** How much room a FileView takes (R7.11). */
export const FILE_VIEW_SIZES = ['compact', 'full'] as const;

export const FileViewNode = component(
  'FileView',
  "One file from the owner's folders shown inline: its preview (image, PDF, text or Markdown), title and the one date that matters (an expiry badge, else issued or changed), and the actions as icons (Download, Open, Reveal in Finder, Copy path, New tab); kind, issuer and where it is open on a tap.",
  {
    file: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of a file added to this project (project_snapshot.files), shown until the reader picks another in a FileList whose showIn names this widget',
      ),
    size: z
      .enum(FILE_VIEW_SIZES)
      .optional()
      .describe('compact: a short preview beside a list; full (default): a tall preview'),
  },
);

/** How a Gallery lays its pictures out (R7.13). */
export const GALLERY_LAYOUTS = ['grid', 'compare', 'strip'] as const;
/** What a Gallery writes under each picture. */
export const GALLERY_CAPTIONS = ['title', 'description', 'none'] as const;

export const GalleryNode = component(
  'Gallery',
  "Pictures from the project: artifacts with an `image` (an https address or a project image file) and image files from the owner's folders, with a caption and where each comes from; a tapped picture opens large.",
  {
    artifacts: Filter.optional().describe(
      'Artifacts whose image to show, e.g. {"where": {"tags": "ui-examples"}} or {"where": {"id": ["art_1", "art_2"]}}; artifacts without an image are left out',
    ),
    files: Filter.optional().describe(
      'Project image files (png, jpg, gif, webp) to show, e.g. {"where": {"tags": "screenshots"}}; other files are left out',
    ),
    layout: z
      .enum(GALLERY_LAYOUTS)
      .optional()
      .describe(
        'grid (default): a wall of pictures; compare: exactly two side by side, e.g. before/after or option A/B; strip: one scrolling row',
      ),
    columns: z
      .number()
      .int()
      .min(2)
      .max(4)
      .optional()
      .describe('Pictures per row in a grid on a wide screen (default 3)'),
    caption: z
      .enum(GALLERY_CAPTIONS)
      .optional()
      .describe("Shown under each picture: the item's title (default), its description, or none"),
    claim: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of the claim that states what the pictures show; it heads the gallery, with its mark',
      ),
    highlight: z
      .array(z.string().min(1))
      .optional()
      .describe('Ids of the pictures to draw with an accent ring (artifact or file ids)'),
    max: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe('Show at most this many pictures (default 12)'),
  },
);

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
    total: z
      .boolean()
      .optional()
      .describe(
        'Add a total row under number, money and meter columns (a ledger); money is totalled per currency',
      ),
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
    sum: FieldPath.optional().describe(
      'Bars add up this number, money or meter field instead of counting, e.g. "fields.cost"',
    ),
    bucket: z
      .enum(['month', 'year'])
      .optional()
      .describe('When `by` is a date: one bar per month or year, in date order'),
  },
);

export const StatNode = component(
  'Stat',
  'One number: how many entities match, or what share of another query they are.',
  {
    label: z.string(),
    query: Query,
    of: Query.optional().describe('With this, shows a percentage of it instead of a count'),
    sum: FieldPath.optional().describe(
      'Show the total of this number, money or meter field over the matching rows instead of a count, e.g. "fields.amount"',
    ),
    target: FieldPath.optional().describe(
      'With sum: the total of this field over the same rows is the target, shown as "x of y" with a bar, e.g. savings "fields.saved" of "fields.target"',
    ),
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
  hideCodes,
  terms: rowTerms,
});

const TextValue = z.union([
  z.strictObject({ count: Query }),
  z.strictObject({ percent: z.strictObject({ query: Query, of: Query }) }),
  z
    .strictObject({ bar: z.strictObject({ query: Query, of: Query }) })
    .describe('A word-sized bar: how many of `of` match `query`'),
  z.strictObject({
    project: z.enum(['name', 'summary', 'status', 'currentStage', 'currentStageTarget']),
  }),
  z
    .strictObject({ sum: z.strictObject({ query: Query, field: FieldPath }) })
    .describe('The total of a number, money or meter field, e.g. money per currency'),
]);

export const TextNode = component(
  'Text',
  'Markdown with live values, e.g. "**${open}** tasks open, ${late} overdue".',
  {
    content: z.string().describe('Markdown; ${name} is replaced by values[name]'),
    values: z
      .record(z.string().regex(/^\w+$/), TextValue)
      .optional()
      .describe(
        'Named values: {count: query}, {percent: {query, of}}, {bar: {query, of}} (a word-sized bar), {sum: {query, field}}, or {project: field}',
      ),
    terms,
  },
);

// ------------------------------------------------------------------ records (R8)
// Blocks for a project's own records: what's due, and money planned against money spent.

export const DueTrackerNode = component(
  'DueTracker',
  "Repeating records (an interval: every N days or N km, whichever first) by when they're due, in four bands: past due, very urgent, urgent, not urgent.",
  {
    query: Query.describe(
      'Repeating records, e.g. {"type": "record", "where": {"recordType": "reminder"}}, or files by expiryDate',
    ),
    show: z
      .array(FieldPath)
      .max(3)
      .optional()
      .describe('Fields shown after each title, e.g. ["fields.amount"]'),
    bands: z
      .array(z.enum(DUE_BANDS))
      .optional()
      .describe('Only these bands (default all), e.g. ["past_due", "very_urgent", "urgent"]'),
    limit: z.number().int().min(1).max(50).optional(),
    date: FieldPath.optional().describe(
      'For one-off dates instead of an interval (R9): the date field each record is due on, e.g. exams "fields.date"; urgent within 30 days, very urgent within 7',
    ),
    action: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of an Action block on the same page whose does is "done" (e.g. "Mark paid"): each row gets its button, with that record picked (R10)',
      ),
  },
);

/** R10: a button and a short form that adds a record or marks one done, on the page. */
export const ActionNode = component(
  'Action',
  'A button that opens a short form built from a record type\'s fields: "create" adds a record (Log a service), "done" marks a repeating record done on a date (Mark paid). One revision, with Undo.',
  ACTION_FIELDS,
);

export const CategoryBreakdownNode = component(
  'CategoryBreakdown',
  'Planned against spent per category: one bar per category with what is left or how far over, and a total. Money stays in its currency.',
  {
    categories: Query.describe(
      'The categories, e.g. {"type": "record", "where": {"recordType": "category"}}',
    ),
    planned: FieldPath.describe('Field of a category holding its plan, e.g. "fields.planned"'),
    spent: z.strictObject({
      query: Query.describe(
        'What was spent, e.g. this month\'s spending {"type": "record", "where": {"recordType": "spending", "fields.date": {"gte": "$monthStart"}}}',
      ),
      by: FieldPath.describe('Reference from a spending to its category, e.g. "fields.category"'),
      sum: FieldPath.describe('The amount to add up, e.g. "fields.amount"'),
    }),
    aim: z
      .enum(['limit', 'target'])
      .optional()
      .describe(
        'limit (default): a budget, going over is bad; target (R9): a goal to reach, e.g. study hours per subject, so over is fine and "to go" counts down',
      ),
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
  title: z
    .string()
    .min(1)
    .max(60)
    .describe(
      `A name, not a claim, e.g. "The recipe format"; in a flow, a box label under ${R4.flowLabelChars} characters`,
    ),
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
  items: Filter.optional().describe(
    'Which claims it holds, e.g. {"where": {"tags": "layer-4"}}; sorted by order unless sort is given. Leave it out only for a label-only flow step',
  ),
  progress: Where.optional().describe(
    'Which tasks this step counts, e.g. {"stageId": "stg_1"}: a bar and "2 of 9" done (cancelled left out); tapping it lists the open ones',
  ),
});

export const LayersNode = component(
  'Layers',
  'Ordered layers or steps, each holding stored claims: a stack the reader taps open, or steps side by side.',
  {
    layers: z
      .array(Layer)
      .min(2)
      .max(7)
      .describe(
        `Top to bottom (stack) or left to right (row, flow); a flow has ${R4.flowMinSteps}–${R4.flowMaxSteps} steps`,
      ),
    orientation: z
      .enum(['stack', 'row', 'flow'])
      .optional()
      .describe(
        'stack (default): one layer open at a time; row: every step shown; flow: labelled boxes joined by arrows, a tapped box opens its claims below the row',
      ),
    open: z
      .string()
      .optional()
      .describe('stack or flow: key of the layer open at first (default none)'),
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
    terms: z
      .boolean()
      .optional()
      .describe(
        'Explain project terms where they first appear in this widget (default true; false in a flow, which is a picture)',
      ),
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

// ------------------------------------------------------------------ pictures (R4)
// docs/reframe/r4-plan.md: pictures read stored claims or project queries; the spec holds ids,
// tags, filters and short labels, never a finding's words or numbers.

export const BeforeAfterNode = component(
  'BeforeAfter',
  "A change shown, not told: two panes, before and after, each with its claim's quoted passage; removed words struck, added words marked.",
  {
    claim: z
      .string()
      .min(1)
      .optional()
      .describe('Id of the claim that states the change, shown above the panes'),
    before: z.string().min(1).describe('Id of the claim whose quote is the passage before'),
    after: z.string().min(1).describe('Id of the claim whose quote is the passage after'),
    beforeLabel: z
      .string()
      .min(1)
      .max(24)
      .optional()
      .describe('After "Before · ", e.g. a commit "8bb6b32" or a date'),
    afterLabel: z.string().min(1).max(24).optional().describe('After "After · ", e.g. "main"'),
  },
);

const FindingCount = z.strictObject({
  query: Query,
  by: FieldPath.describe('Field to group by, e.g. "status", "kind", "stage.name"'),
  sort: z
    .enum(['count', 'field'])
    .optional()
    .describe("Biggest first (count) or in the field's natural order (default)"),
  limit: z.number().int().min(1).max(12).optional().describe('Show at most this many bars'),
});

export const FindingChartNode = component(
  'FindingChart',
  'Horizontal bars whose title is a stored claim stating the finding: values and labels on the bars, one bar in the accent colour, the rest grey.',
  {
    claim: z
      .string()
      .min(1)
      .optional()
      .describe('Id of the claim that states the finding; it is the title, with its mark'),
    bars: Filter.optional().describe(
      'Bars from stored claims, e.g. {"where": {"tags": "token-benchmark"}}: each claim\'s figure is one bar and opens to its quote',
    ),
    count: FindingCount.optional().describe(
      'Bars counting project items by a field instead, like CountChart',
    ),
    highlight: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The bar drawn in the accent colour: a claim id (bars) or a group value or label (count). Default: the first bar',
      ),
    max: z
      .number()
      .positive()
      .optional()
      .describe(
        'The whole each bar is a part of, e.g. 7 for "of 7 tools" or 100 for percentages: every bar gets a faint full-length track and is drawn against it. Default: the longest bar fills the width',
      ),
  },
);

// ------------------------------------------------------------------ report opening
// The "start here" block that opens a report page (docs/reframe/start-here.md): one purpose, one
// headline, where the page sits, and a short reading path into the widgets below.

/** Limits the save-time warnings check (start-here.md); the schema itself is looser. */
export const START_HERE = {
  /** GOV.UK summaries: under 160 characters, with a verb. */
  headlineChars: 160,
  /** What the work is for, in one line (R3.6: the reader asked why the work exists). */
  whyChars: 100,
  /** What the reader has to do, in one line. */
  yourPartChars: 120,
  minSteps: 2,
  maxSteps: 4,
  /** Visible words a report page may show before any detail the reader opens. */
  pageWords: 150,
  /** Visible words on one claim card. */
  cardWords: 25,
  /** A claim card over this many words is too wordy to sit three to a row. */
  sideBySideWords: 12,
  /** Most terms a report page underlines. */
  maxTerms: 5,
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

/** F5 (R4): an evidence item is an id, or an id with a short label shown instead of its title. */
const EvidenceItem = z.union([
  z.string().min(1),
  z.strictObject({
    id: z.string().min(1),
    label: z
      .string()
      .min(1)
      .max(24)
      .describe('Shown instead of the title, e.g. "Test run" or "G1 measures"'),
  }),
]);
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** The id of an evidence item, whichever form it takes. */
export function evidenceId(item: EvidenceItem): string {
  return typeof item === 'string' ? item : item.id;
}

export const StartHereNode = component(
  'StartHere',
  "The opening of a report page: its one purpose, why the work exists, a headline sentence with its evidence, the reader's part, where it sits, and a reading path of 2–4 steps.",
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
    why: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        `What the work is for, or the question it answers, in one line under ${START_HERE.whyChars} characters, e.g. "To measure whether a new reader understands a Pharos page without help". Shown above the headline`,
      ),
    yourPart: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        `The reader's part in one line under ${START_HERE.yourPartChars} characters, the only place the page says it, e.g. "Nothing now. When G1 resumes: approve the 3 test cases and targets."`,
      ),
    yourPartTarget: z
      .string()
      .min(1)
      .optional()
      .describe('Id of the widget where the reader does it, e.g. a DecisionBlock; adds a button'),
    claim: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of the claim the headline states (found pages): its statement is shown, with its certainty mark and sources',
      ),
    evidence: z
      .array(EvidenceItem)
      .max(8)
      .optional()
      .describe(
        'What backs the headline: ids of artifacts (links, files, test results), tasks, decisions or claims, or {id, label} for a short label',
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
  MapNode,
  AssigneeMatrixNode,
  ArtifactGalleryNode,
  DecisionLogNode,
  DecisionBlockNode,
  FileListNode,
  FileViewNode,
  GalleryNode,
  ActivityFeedNode,
  DataTableNode,
  CountChartNode,
  StatNode,
  DataListNode,
  TextNode,
  LayersNode,
  ClaimCardNode,
  BeforeAfterNode,
  FindingChartNode,
  StartHereNode,
  DueTrackerNode,
  CategoryBreakdownNode,
  ActionNode,
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
