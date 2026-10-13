import type { ComponentName, ViewNode } from './catalog.js';

export type ComponentCategory =
  'data' | 'overview' | 'goals & scope' | 'plan & time' | 'work' | 'outputs' | 'explain' | 'layout';

export type ComponentInfo = {
  category: ComponentCategory;
  /** When an agent should reach for this component. */
  use: string;
  /** Narrowest readable width, in board columns (of 12). People can't resize below it. */
  minColumns: number;
  /** A good default width on a board. */
  suggestedColumns: number;
  /** A complete, valid example node. */
  example: ViewNode;
};

/**
 * Guidance for choosing and sizing components. Shared by the MCP catalog tools (for agents)
 * and the web app (resize limits), so both follow the same rules.
 */
export const COMPONENT_INFO: Record<ComponentName, ComponentInfo> = {
  ProjectHeader: {
    category: 'overview',
    use: 'Top of an overview: name, status, summary, repository, current stage, overall progress. Use once per view, full width.',
    minColumns: 4,
    suggestedColumns: 12,
    example: { component: 'ProjectHeader' },
  },
  StatCards: {
    category: 'overview',
    use: 'A few headline counts (2–4). Each stat counts entities matching a query; `of` shows "x / total" with a word-sized bar, so the reader sees the share without reading.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'StatCards',
      stats: [
        {
          label: 'Open',
          query: { type: 'task', where: { status: { not: ['done', 'cancelled'] } } },
        },
        { label: 'Blocked', query: { type: 'task', where: { status: 'blocked' } }, tone: 'bad' },
        {
          label: 'Done',
          query: { type: 'task', where: { status: 'done' } },
          of: { type: 'task', where: { status: { not: 'cancelled' } } },
          tone: 'good',
        },
      ],
    },
  },
  ProgressRing: {
    category: 'overview',
    use: 'One percentage that matters, e.g. progress of the current stage. Narrow; pair it with a list beside it.',
    minColumns: 3,
    suggestedColumns: 4,
    example: {
      component: 'ProgressRing',
      title: 'Current stage',
      where: { stageId: '$currentStage' },
    },
  },
  Callout: {
    category: 'overview',
    use: 'A short message the reader must not miss: a risk, a blocker, a key decision. Keep it to 1–3 sentences.',
    minColumns: 3,
    suggestedColumns: 12,
    example: {
      component: 'Callout',
      tone: 'warning',
      title: 'Release blocked',
      body: 'Waiting on **API review**.',
    },
  },
  Markdown: {
    category: 'overview',
    use: 'Prose that has no better structured form, or the project description (`source`). Prefer structured components.',
    minColumns: 3,
    suggestedColumns: 6,
    example: { component: 'Markdown', title: 'About', source: 'project.description' },
  },
  GoalTree: {
    category: 'goals & scope',
    use: 'Goals and sub-goals with their success criteria: why the project exists.',
    minColumns: 3,
    suggestedColumns: 6,
    example: { component: 'GoalTree', title: 'Goals' },
  },
  ScopeBoard: {
    category: 'goals & scope',
    use: 'What is in, maybe, and out of scope, with reasons. Good next to GoalTree.',
    minColumns: 4,
    suggestedColumns: 6,
    example: { component: 'ScopeBoard', title: 'Scope' },
  },
  StageTracker: {
    category: 'plan & time',
    use: 'Where the project is: stages as steps with progress, current one highlighted. Full width works best.',
    minColumns: 4,
    suggestedColumns: 12,
    example: { component: 'StageTracker', title: 'Stages' },
  },
  Timeline: {
    category: 'plan & time',
    use: 'When things happen: stages on a time axis (needs start/target dates). Full width.',
    minColumns: 4,
    suggestedColumns: 12,
    example: { component: 'Timeline', title: 'Timeline' },
  },
  MilestoneList: {
    category: 'plan & time',
    use: 'Stages as a compact vertical list with dates and progress; fits a side column.',
    minColumns: 3,
    suggestedColumns: 4,
    example: { component: 'MilestoneList', title: 'Milestones' },
  },
  KanbanBoard: {
    category: 'work',
    use: 'Tasks by status (or stage, assignee, priority). The default way to show work; people can drag cards.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'KanbanBoard',
      title: 'Tasks',
      filter: { where: { stageId: '$currentStage' } },
    },
  },
  TaskTable: {
    category: 'work',
    use: 'Many tasks with details side by side (estimate, dependencies). Denser than a kanban. On a report page set `hideCodes: true` so "W3.8 · Measure the baseline" reads "Measure the baseline", and `terms: true` to explain terms in the rows.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'TaskTable',
      title: 'All tasks',
      columns: ['status', 'priority', 'stage', 'assignee', 'estimate'],
    },
  },
  TaskChecklist: {
    category: 'work',
    use: 'A to-do list people tick off, e.g. tasks assigned to humans (`assigneeKind: "human"`).',
    minColumns: 4,
    suggestedColumns: 8,
    example: { component: 'TaskChecklist', title: 'Your tasks', assigneeKind: 'human' },
  },
  DependencyGraph: {
    category: 'work',
    use: 'Why something is blocked or what order work must happen in: tasks linked by dependsOn.',
    minColumns: 4,
    suggestedColumns: 8,
    example: {
      component: 'DependencyGraph',
      title: 'Dependencies',
      filter: { where: { status: { not: 'done' } } },
    },
  },
  AssigneeMatrix: {
    category: 'work',
    use: 'Who is on what: task counts per person/agent and status.',
    minColumns: 4,
    suggestedColumns: 6,
    example: { component: 'AssigneeMatrix', title: 'Workload' },
  },
  ArtifactGallery: {
    category: 'outputs',
    use: 'Expected and delivered deliverables (docs, files, links).',
    minColumns: 3,
    suggestedColumns: 12,
    example: { component: 'ArtifactGallery', title: 'Deliverables' },
  },
  DecisionLog: {
    category: 'outputs',
    use: 'Recent decisions and their status; the reasoning opens on click.',
    minColumns: 3,
    suggestedColumns: 6,
    example: { component: 'DecisionLog', title: 'Decisions', filter: { limit: 5 } },
  },
  FileList: {
    category: 'outputs',
    use: 'The project\'s files (statements, receipts, contracts, certificates, manuals) as a list grouped by kind, with a name search and filters for kind, tag, issuer and expiry; the reader opens a file to preview it, download it or reveal it in Finder. Files stay in the owner\'s folders; agents add them only from files_unadded (after the owner approves a folder), so never invent file ids or paths. For one document set (e.g. business registration papers), tag its files and filter on the tag: {"where": {"tags": "business-registration"}}; papers expiring within 60 days {"where": {"expiryDate": {"lte": "$today+60d"}}}. Set `showIn` to the id of a FileView widget on the same board so a tapped row shows that file there instead of opening the drawer. You see each file\'s details, never its contents.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'FileList',
      title: 'Company papers',
      filter: { where: { kind: ['contract', 'certificate'] } },
      details: ['issuer', 'expiryDate'],
    },
  },
  FileView: {
    category: 'outputs',
    use: 'One key document shown in the view itself: its preview (image, PDF, text or Markdown), title and the one date that matters (expiry, else issued, else changed), and Download, Open, Reveal in Finder, Copy path and New tab as icons; kind, issuer and where it is open in its details on a tap. `file` is the id of a file in project_snapshot.files (never invented); pair it with a FileList whose `showIn` is this widget\'s id so the reader can switch documents. `size: "compact"` (a short preview) fits beside a list at 5–6 columns; "full" (default) gives a tall preview. A file missing on disk says so and keeps its details.',
    minColumns: 4,
    suggestedColumns: 6,
    example: {
      component: 'FileView',
      title: 'Certificate',
      file: 'file_fixture1',
      size: 'compact',
    },
  },
  Gallery: {
    category: 'outputs',
    use: 'Pictures, not words, whenever the subject is visual: UI and product examples, screenshots, places, diagrams. Store each picture as an artifact with `image` (an https address of the image, or a project image file id from project_snapshot.files), `alt` (what it shows, one sentence) and `uri` (the page it comes from, shown as its host under the picture), plus a shared tag; then filter `artifacts` on the tag. `files` adds the project\'s own image files. `layout: "compare"` puts exactly two side by side (before/after, option A/B; highlight the better one); "strip" is one scrolling row; "grid" (default) is a wall with `columns` 2–4. `claim` heads it with the stored claim the pictures show. A tapped picture opens large with its caption and source. Never paste image data or describe a picture in a paragraph instead.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'Gallery',
      title: 'Empty states we found',
      artifacts: { where: { tags: 'ui-examples' } },
      layout: 'grid',
      columns: 3,
    },
  },
  ActivityFeed: {
    category: 'outputs',
    use: 'Recent changes: who changed what and why.',
    minColumns: 3,
    suggestedColumns: 6,
    example: { component: 'ActivityFeed', title: 'Recent activity', limit: 8 },
  },
  DataTable: {
    category: 'data',
    use: 'Any entity type with chosen columns, e.g. artifacts with kind, status, and stage; or tasks with due date and assignee. Use when no domain component shows the fields you need. For records, columns are "fields.<key>" and money shows in its currency; `total: true` adds a total row (a ledger), and a log is records sorted by date, newest first.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'DataTable',
      title: 'Due this week',
      query: {
        type: 'task',
        where: { dueDate: { gte: '$today', lte: '$today+7d' } },
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
  CountChart: {
    category: 'data',
    use: 'How things are distributed: count of any entity type by any field (status, kind, stage, assignee). Good for "where is the work?" questions. `sum` adds up a number or money field instead (e.g. cost per year: by "fields.date", bucket "year", sum "fields.cost").',
    minColumns: 3,
    suggestedColumns: 6,
    example: {
      component: 'CountChart',
      title: 'Open tasks by stage',
      query: { type: 'task', where: { status: { not: ['done', 'cancelled'] } } },
      by: 'stage.name',
    },
  },
  Stat: {
    category: 'data',
    use: 'One key number with context, e.g. overdue tasks, or the share of deliverables delivered. Pair several in a row. `sum` shows a total (money per currency) instead of a count; with `target`, "saved of target" with a bar.',
    minColumns: 2,
    suggestedColumns: 3,
    example: {
      component: 'Stat',
      label: 'Overdue',
      tone: 'bad',
      query: {
        type: 'task',
        where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
      },
    },
  },
  DataList: {
    category: 'data',
    use: 'A short list of anything with a few details, e.g. decisions still proposed, goals still open. `hideCodes: true` drops work codes from titles on a report page; `terms: true` explains terms in the rows.',
    minColumns: 3,
    suggestedColumns: 6,
    example: {
      component: 'DataList',
      title: 'Open questions',
      query: { type: 'decision', where: { status: 'proposed' } },
      secondary: ['createdAt'],
    },
  },
  Text: {
    category: 'data',
    use: 'A sentence or two with live numbers, as a headline or summary at the top of an answer. `{bar: {query, of}}` draws a word-sized bar inline instead of a number; `{sum: {query, field}}` gives a total. Every number in the text should come from a value, so it can be checked.',
    minColumns: 3,
    suggestedColumns: 12,
    example: {
      component: 'Text',
      content: '**${open}** tasks are open in ${stage}; **${late}** are overdue.',
      values: {
        open: {
          count: {
            type: 'task',
            where: { stageId: '$currentStage', status: { not: ['done', 'cancelled'] } },
          },
        },
        late: {
          count: {
            type: 'task',
            where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
          },
        },
        stage: { project: 'currentStage' },
      },
    },
  },
  ClaimCard: {
    category: 'explain',
    use: 'One stored finding (a `claim`) with its certainty mark ("Our reading", "From source", "Confirmed by you"), checked date and source link. After the StartHere opening, use `size: "headline"`, full width, for the main finding. Use `size: "card"` for takeaways: side by side only for short items (a number, a label, a line of 12 words or fewer); wordy findings go one per row, full width, one short line each, with the rest behind a layer the reader opens. A card shows at most 25 words (statement, detail and kicker). Write the words in the claim, never in the view.',
    minColumns: 3,
    suggestedColumns: 6,
    example: {
      component: 'ClaimCard',
      claim: 'clm_headline',
      size: 'headline',
      kicker: 'Generative UI',
    },
  },
  Layers: {
    category: 'explain',
    use: 'A picture of how something is built, as ordered layers the reader taps open (`orientation: "stack"`), a few steps side by side (`"row"`, e.g. a spectrum with an `axis`), or a `"flow"`: 2–5 boxes joined by arrows, each a label under 30 characters with its pill colour, whose claims open below the row when the reader taps a box (use it for a process, "Your question → AI arranges blocks → Pharos draws the screen", instead of columns of sentences). Each layer picks stored claims by tag with `items`; a flow step may leave `items` out and be a label only. `progress` (a task where, e.g. {"stageId": "stg_1"}) adds a bar and "2 of 9" to a step, on the same scale for every step, and tapping it lists the open tasks. Claims with an `aboutId` group into one card per tool, the others show as lines. Name layers, never state facts in `title` or `hint`. A flow is a picture, so terms are off unless `terms: true`.',
    minColumns: 6,
    suggestedColumns: 12,
    example: {
      component: 'Layers',
      prompt: 'Tap a layer to see the tools in it.',
      open: '2',
      legend: [
        { tone: 'own', label: 'Pharos has its own' },
        { tone: 'gap', label: 'Nobody offers it' },
      ],
      layers: [
        {
          key: '2',
          title: 'The recipe format',
          hint: 'How the AI writes down which blocks go where',
          pill: { label: 'Pharos has its own', tone: 'own' },
          items: { where: { tags: 'layer-2' } },
        },
        {
          key: '1',
          title: 'The AI model',
          hint: 'It writes the text or the recipe',
          items: { where: { tags: 'layer-1' } },
        },
      ],
    },
  },
  BeforeAfter: {
    category: 'explain',
    use: 'Show what a change did: two panes, "Before · 8bb6b32" and "After · main", each the quoted passage of a stored claim (`before`, `after`), with removed words struck and added words marked; `claim` states the change above in one line (15 words or fewer). Store each passage word for word as the claim\'s `quote`, with `locator` (file and line, or commit) and its source. Use it on a done page for "what changed". Keep the stated change and the changed lines to about 40 words.',
    minColumns: 6,
    suggestedColumns: 12,
    example: {
      component: 'BeforeAfter',
      claim: 'clm_change',
      before: 'clm_before',
      after: 'clm_after',
      beforeLabel: '8bb6b32',
      afterLabel: 'main',
    },
  },
  FindingChart: {
    category: 'explain',
    use: 'A number-backed finding as a picture: horizontal bars with values and labels on them, one bar (`highlight`) in the accent colour, the rest grey, no axis or legend. The title is the stored `claim` that states the finding (15 words or fewer), never free text, so leave `title` out. Bars come from claims with `bars` (a claim filter; each claim\'s `figure` {value, unit, label} is one bar, and on "From source" the value must appear in its quote) or from a project query with `count` ({query, by}, like CountChart). Use 2–12 bars in one unit. When the bars are parts of a whole, set `max` to that whole (7 for "of 7 tools", 100 for percentages) so each bar shows against a faint full-length track; no figure may exceed it. Tapping a bar opens its claim, its quote or assumption, and every source behind it.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'FindingChart',
      claim: 'clm_tokens_headline',
      bars: { where: { tags: 'token-benchmark' } },
      highlight: 'clm_openui_tokens',
    },
  },
  StartHere: {
    category: 'explain',
    use: 'Opens every report page, first and full width: the page\'s one purpose (`done`, `found` or `needs-you`); `why`, one line (under 100 characters) on what the work is for or the question it answers, shown above the headline; one headline sentence with a verb (under 160 characters); `yourPart`, one line (under 120 characters) on what the reader has to do, even when it is "Nothing now" (the only place the page says it: no other widget titled "Your part" or "What you need to do"); where it sits (`stageId` or `goalId`, and `date`; the project is shown for you), and a `path` of 2–4 labelled steps, each with a `target` widget id on the same board so tapping scrolls there. Back the headline: on a found page set `claim` (its statement, certainty mark and sources show); otherwise list `evidence` ids (artifacts, tasks, decisions), or `{id, label}` to show a short label (24 characters or fewer, e.g. "Test run") instead of a long title. Needs-you pages set `due`. One per view. Keep the whole page short: about 150 words before anything the reader opens.',
    minColumns: 6,
    suggestedColumns: 12,
    example: {
      component: 'StartHere',
      purpose: 'done',
      why: 'So a reader knows at once what a report page is for and what it asks of them',
      headline: 'Report pages now open with a start-here block that says what the page is for.',
      yourPart: 'Nothing now. Open one report page on your phone and say if the opening helps.',
      evidence: [{ id: 'art_tests', label: 'Test run' }],
      date: '2026-10-12',
      path: [
        { label: 'What changed', says: 'The new block, before and after', target: 'changed' },
        { label: 'How it was checked', says: 'Tests and a phone-width check', target: 'checked' },
        { label: 'What is left', says: 'Two open points', target: 'left' },
      ],
    },
  },
  Tabs: {
    category: 'layout',
    use: 'Several alternative views of the same thing in one widget (e.g. Board / Table). Each tab holds components.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'Tabs',
      tabs: [
        { label: 'Board', children: [{ component: 'KanbanBoard' }] },
        { label: 'Table', children: [{ component: 'TaskTable' }] },
      ],
    },
  },
  DueTracker: {
    category: 'data',
    use: "What's due among repeating records (services, bills, renewals): each with its next date and/or reading, in four bands (past due, very urgent, urgent, not urgent), most urgent first. The records need an interval; `show` adds a field such as the amount.",
    minColumns: 4,
    suggestedColumns: 7,
    example: {
      component: 'DueTracker',
      title: "What's due",
      query: { type: 'record', where: { recordType: 'reminder' } },
    },
  },
  CategoryBreakdown: {
    category: 'data',
    use: 'Planned against spent per category (a budget): categories are records with a planned amount, spending records point at their category. One bar each, what is left or over, and a total; currencies are never converted.',
    minColumns: 4,
    suggestedColumns: 7,
    example: {
      component: 'CategoryBreakdown',
      title: 'This month',
      categories: { type: 'record', where: { recordType: 'category' } },
      planned: 'fields.planned',
      spent: {
        query: {
          type: 'record',
          where: { recordType: 'spending', 'fields.date': { gte: '$monthStart' } },
        },
        by: 'fields.category',
        sum: 'fields.amount',
      },
    },
  },
  Grid: {
    category: 'layout',
    use: 'Rarely needed: a board already lays widgets out in columns. Only for side-by-side components inside Tabs.',
    minColumns: 4,
    suggestedColumns: 12,
    example: {
      component: 'Grid',
      columns: 2,
      children: [{ component: 'GoalTree' }, { component: 'ScopeBoard' }],
    },
  },
  Section: {
    category: 'layout',
    use: 'Rarely needed on a board: groups components under a heading inside Tabs.',
    minColumns: 4,
    suggestedColumns: 12,
    example: { component: 'Section', title: 'Planning', children: [{ component: 'StageTracker' }] },
  },
};

/** How boards work, for agents composing views. */
export const BOARD_GUIDE = `A view is a Board: a 12-column grid of widgets laid out left to right, top to bottom.
Each widget is {id, w?, x?, h?, node}: a stable id, a width in columns (1–12, default 12), an optional start column (0–11; omit to flow), an optional minimum height in px (omit to fit content), and one catalog component as \`node\`.
Widths in a row should add up to 12 (e.g. 4 + 8, 6 + 6). Never go below a component's minColumns.
Components read live project data; never copy data into a view. Findings live in \`claim\` records and words to explain in \`term\` records: ClaimCard, Layers, BeforeAfter and FindingChart show claims, and text blocks explain terms where they first appear (\`terms: false\` turns that off). Store a term only for a word a non-specialist wouldn't know, not everyday words like "test case"; a report page underlines 5 terms at most. Narrow what they show with \`filter\` ({where, anyOf, sort, limit}) or \`where\`:
- where values: exact value, array (any of), {not: value|array}, {exists: bool}, {contains: text}, or a range {gt|gte|lt|lte: value}
- dates relative to today: "$today", "$today+7d", "$today-2w"; "$currentStage" is the project's current stage id, "$project" the project id
- fields can follow one reference: "stage.status", "stage.targetDate", "assignee.kind", "task.status" (artifacts), "parent.status" (goals); also "createdAt", "updatedAt"
- \`anyOf: [where, where]\` adds an "or": at least one must also match
- records (a project's own kinds, R8): query \`{type: "record", where: {recordType: "service"}}\`; fields are "fields.<key>", one hop through a reference "fields.vehicle.title", money parts "fields.cost.amount" (minor units) and "fields.cost.currency", and for repeating records "due.date", "due.band"; dates also "$monthStart", "$monthStart+1m", "$yearStart"
- every filter, sort, group, sum and column is checked when a view is saved: an unknown field, record type or option value, a sum over text, or a value that doesn't fit its field refuses the save with the allowed values and a corrected example; a record query without recordType only warns
- statuses and other option fields match by meaning too (e.g. "in_progress" matches a custom "In review"), and ranges follow the option order (priority {gte: "high"})
Examples: overdue tasks {where: {dueDate: {lt: "$today"}, status: {not: ["done", "cancelled"]}}} · due this week {where: {dueDate: {gte: "$today", lte: "$today+7d"}}} · blocked or late {anyOf: [{status: "blocked"}, {"stage.targetDate": {lt: "$today"}, status: {not: "done"}}]}
Good views answer one question each (e.g. "what's left this stage?"), lead with the most important widget, and use 3–8 widgets.`;
