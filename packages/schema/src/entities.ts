import { z } from 'zod';
import { DECISION_CHOICE_FIELDS } from './decisions.js';
import { TASK_ANSWER } from './task-answers.js';
import { TASK_DETAIL_FIELDS } from './task-details.js';
import { FilePath, FolderId } from './files.js';
import { OPTION_FIELDS, ProjectOptions, defaultOptions, type OptionKey } from './options.js';
import { FieldValue, Interval, RecordKey, RecordTypes } from './records.js';
import { ViewSpec } from './views/board.js';
import { GALLERY, ImageRef } from './views/pictures.js';
import { ReportDoc } from './views/doc.js';
import { ReportPage } from './views/report.js';

export {
  ArtifactKind,
  Certainty,
  ArtifactStatus,
  DecisionStatus,
  FileKind,
  GoalStatus,
  ScopeKind,
  StageStatus,
  TaskPriority,
  TaskStatus,
} from './options.js';

/**
 * A field whose values come from the project's options for it (see `options` on the project).
 * Checked against those options when saved.
 */
function optionField(key: OptionKey) {
  const defaults = defaultOptions(key).map((o) => o.value);
  return z
    .string()
    .min(1)
    .describe(
      `One of the project's ${OPTION_FIELDS[key].label.toLowerCase()} options (defaults: ${defaults.join(', ')})`,
    );
}

export const Id = z.string().min(1);
const Text = z.string().min(1);
const Markdown = z.string();
const IsoDate = z.iso.date();
const Order = z.number();
/** Project files this item is about (R7.12): a task's papers, a decision's evidence. */
const FileIds = z.array(Id).optional().describe('Linked file ids');

export const SectionData = z.strictObject({
  name: Text.describe('e.g. "Work", "Personal"'),
  order: Order,
  parentId: Id.optional().describe('The section this one sits inside (none: the top level)'),
});

export const RepositoryData = z.strictObject({
  name: Text.describe('Display name of the code repository'),
  path: z.string().optional().describe('Local filesystem path'),
  url: z.string().optional().describe('Remote URL, e.g. a GitHub URL'),
  description: Markdown.optional(),
  sectionId: Id.optional().describe('Sidebar section this folder is grouped under'),
  order: Order,
});

export const AssigneeData = z.strictObject({
  name: Text.describe('e.g. "me", "Claude Code"'),
  kind: z.enum(['human', 'agent']),
  description: Markdown.optional(),
});

export const ProjectStatus = z.enum(['planning', 'active', 'paused', 'done', 'archived']);
export const ProjectData = z.strictObject({
  name: Text,
  repositoryId: Id.optional().describe('Repository this project belongs to (optional)'),
  summary: z.string().optional().describe('One-line summary'),
  description: Markdown.optional().describe('Longer description (markdown)'),
  status: ProjectStatus,
  currentStageId: Id.optional().describe('Stage the project is currently in'),
  options: ProjectOptions.optional(),
  recordTypes: RecordTypes.optional().describe(
    'Kinds of records this project keeps (R8), e.g. a car service; usually set by a pack',
  ),
  pinned: z.boolean().optional().describe('Pinned projects are listed first in the sidebar'),
  // The owner's standing rules and feedback for this project, in their words: every session's
  // brief carries them (project_brief), so all agents and machines share them.
  rules: z.array(z.string().min(1).max(300)).max(40).optional(),
  sectionId: Id.optional().describe('Sidebar section, for projects without a repository'),
  order: Order.describe('Position among its sibling projects in the sidebar'),
});

export const GoalData = z.strictObject({
  projectId: Id,
  parentId: Id.optional().describe('Parent goal, for sub-goals'),
  title: Text,
  description: Markdown.optional(),
  successCriteria: z.array(Text).describe('How we know the goal is met'),
  status: optionField('goal.status'),
  order: Order,
  fileIds: FileIds,
});

export const ScopeItemData = z.strictObject({
  projectId: Id,
  title: Text,
  kind: optionField('scope_item.kind'),
  rationale: Markdown.optional(),
  order: Order,
});

export const StageData = z.strictObject({
  projectId: Id,
  name: Text,
  description: Markdown.optional(),
  status: optionField('stage.status'),
  startDate: IsoDate.optional().describe('YYYY-MM-DD'),
  targetDate: IsoDate.optional().describe('YYYY-MM-DD'),
  order: Order,
  fileIds: FileIds,
});

export const TaskData = z.strictObject({
  projectId: Id,
  stageId: Id.optional(),
  // The goals it serves (a task can serve several); the Map draws them.
  goalIds: z.array(Id).optional(),
  title: Text,
  description: Markdown.optional(),
  // What to do, what makes it done, and what it produces (agents are warned without them).
  ...TASK_DETAIL_FIELDS,
  status: optionField('task.status'),
  priority: optionField('task.priority'),
  assigneeId: Id.optional(),
  dependsOn: z.array(Id).describe('Ids of tasks that must finish first'),
  estimate: z.string().optional().describe('Free-form, e.g. "2h", "3 points"'),
  desk: z
    .boolean()
    .optional()
    .describe("On the owner's desk: an agent asked them to do it (ask_owner sets it)"),
  // The owner's other answers (won't do is the cancelled status): only a person sets these.
  reply: z.string().min(1).max(TASK_ANSWER.replyChars).optional().describe('Owner only'),
  deferredUntil: IsoDate.optional().describe('Owner only'),
  dueDate: IsoDate.optional().describe('YYYY-MM-DD'),
  order: Order,
  fileIds: FileIds,
});

/** A note on a task: results, evidence, a question (author and time come from its revision). */
export const CommentData = z.strictObject({
  projectId: Id,
  taskId: Id.describe('The task it is on'),
  body: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe('Markdown: results, evidence, links; code in fenced blocks'),
});

export const ArtifactData = z.strictObject({
  projectId: Id,
  title: Text,
  description: Markdown.optional(),
  kind: optionField('artifact.kind'),
  status: optionField('artifact.status'),
  uri: z.string().optional().describe('Path or URL of the deliverable'),
  fileId: Id.optional().describe(
    'The project file it is, so a local source opens. Set by Pharos (matching uri) or the owner; agents put the local path in uri instead',
  ),
  stageId: Id.optional(),
  taskId: Id.optional(),
  // R7.13: a picture of it, shown by Gallery.
  image: ImageRef.optional().describe('https URL or image file id (Gallery)'),
  alt: z.string().min(1).max(GALLERY.altChars).optional().describe('What the picture shows'),
  tags: z.array(Text).optional(),
});

export const DecisionData = z.strictObject({
  projectId: Id,
  title: Text,
  body: Markdown.optional().describe('Context, options considered, and the reasoning'),
  status: optionField('decision.status'),
  decidedById: Id.optional().describe(
    'Assignee who made the decision, often the person who asked (not who recorded it)',
  ),
  decisionDate: IsoDate.optional().describe('YYYY-MM-DD the decision was made'),
  dependsOn: z.array(Id).optional().describe('Decisions this builds on'),
  fileIds: FileIds,
  // R10.19: options the owner chooses from on a page.
  ...DECISION_CHOICE_FIELDS,
  // R16: how it sits on the owner's desk.
  minutes: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .describe('About how long the owner needs to answer, in minutes (shown on the desk)'),
  gate: z
    .boolean()
    .optional()
    .describe('Only the owner can do it (a secret, a payment, a push, personal data)'),
});

export const ViewData = z.strictObject({
  projectId: Id,
  name: Text,
  description: Markdown.optional().describe('What this view is for'),
  template: z
    .enum(['overview'])
    .optional()
    .describe('Render a built-in template (kept up to date); ignored when spec is set'),
  spec: ViewSpec.optional().describe(
    'The view: a Board of widgets (preferred) or a single component tree',
  ),
  page: ReportPage.optional().describe(
    'A report page (R13): the whole page as HTML the agent wrote; spec and template are ignored when set',
  ),
  doc: ReportDoc.optional().describe(
    'A report document (R14): blocks in reading order that Pharos draws in its own style; never with spec or page',
  ),
  pinned: z.boolean().describe('Pinned views are shown first'),
  archived: z
    .boolean()
    .optional()
    .describe(
      'Archived views are hidden from the tabs (listed under Archived, still openable); pinned and template views are never archived',
    ),
  handedBack: z
    .strictObject({
      to: Text.optional().describe(
        'The agent it went back to: the author of its latest agent revision',
      ),
      answered: z.number().int().nonnegative().describe('How many of its sheets were answered'),
    })
    .optional()
    .describe(
      'Set with archived when the owner finished a review document (every sheet answered) and handed it back to the agent; read the answers with view_get',
    ),
  kind: z
    .enum(['saved', 'answer', 'main'])
    .optional()
    .describe(
      "main: the project's main page, one per project, a document revised as the project moves (never archived); answer: answers one question and expires unless kept; default saved",
    ),
  question: z.string().optional().describe('For answer views: the question it answers'),
  expiresAt: z.iso
    .datetime()
    .optional()
    .describe('For answer views: hidden after this time unless kept'),
  evidenceRevision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Set by Pharos, never by agents: the revision whose data an agent built this view from (R11); later changes to that data make its written parts stale',
    ),
  order: Order,
});

export const RequestData = z.strictObject({
  projectId: Id,
  question: Text.describe('What the person asked, in their words'),
  about: z.string().optional().describe('What it was asked about, e.g. "Tasks widget in Overview"'),
  viewId: Id.optional().describe('The view it was asked from'),
  widgetId: z.string().optional().describe('The widget it was asked about'),
  aboutId: Id.optional().describe('The item it was asked about (any type)'),
  status: z.enum(['open', 'answered', 'dismissed']),
  answerViewId: Id.optional().describe('The answer view that answers it'),
  mode: z
    .enum(['answer', 'block', 'refresh'])
    .optional()
    .describe(
      '"block": change only widgetId in place (R10), not answer in a new view; "refresh": the data behind answer view viewId changed, so answer it again in that view (R11)',
    ),
  reply: z.string().min(1).max(300).optional().describe('Your short note to the person'),
});

/** A number a claim states, drawn as one bar in a FindingChart (R4). */
export const ClaimFigure = z.strictObject({
  value: z.number().describe('The number as the source gives it, e.g. 4800 or 82.8'),
  unit: z.string().min(1).max(12).optional().describe('e.g. "tokens", "%", "ms"'),
  label: z.string().min(1).max(24).describe('What the bar is, on the bar, e.g. "OpenUI"'),
});
export type ClaimFigure = z.infer<typeof ClaimFigure>;

/** Named reasons the evidence behind a claim is weak (GRADE's downgrade reasons, R4). */
export const WeakBecause = z.enum(['one-source', 'indirect', 'disagree']);
export type WeakBecause = z.infer<typeof WeakBecause>;
/** How each reason reads after the certainty mark. */
export const WEAK_BECAUSE_LABELS: Record<WeakBecause, string> = {
  'one-source': 'one source',
  indirect: 'indirect',
  disagree: 'sources disagree',
};

export const ClaimData = z.strictObject({
  projectId: Id,
  statement: Text.max(200).describe(
    'One plain sentence the reader sees; no task codes. When a source speaks about itself, write "X says …"',
  ),
  detail: z
    .string()
    .max(400)
    .optional()
    .describe('One or two more plain sentences, shown under the statement'),
  certainty: optionField('claim.certainty'),
  checkedOn: IsoDate.describe('YYYY-MM-DD it was last checked against its sources'),
  sourceIds: z.array(Id).describe('Artifacts it comes from; a link needs an http(s) uri'),
  quote: Text.max(300)
    .optional()
    .describe(
      'For "From source": the exact passage from the source that supports it, copied word for word',
    ),
  quoteSourceId: Id.optional().describe(
    'Which of sourceIds the quote comes from, when it has several (default: the first)',
  ),
  assumption: Text.max(200)
    .optional()
    .describe('For "Our reading": the assumption it rests on, in one plain sentence'),
  locator: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      'Where in the source the quote sits, e.g. "§7 Completion", "line 42", "commit deb7096"; shown with the quote',
    ),
  figure: ClaimFigure.optional().describe(
    'The number this claim states, drawn as a bar in a FindingChart; for "From source" the value must appear in the quote',
  ),
  weakBecause: WeakBecause.optional().describe(
    'Why the evidence is weak, shown after the mark: one-source, indirect (the source speaks about something close), or disagree (sources disagree)',
  ),
  confirmedById: Id.optional().describe('For "Confirmed by you": the decision the owner accepted'),
  aboutId: Id.optional().describe(
    'The artifact it is about (a tool, Pharos); its title heads the card',
  ),
  authorId: Id.optional().describe('Assignee (agent or person) whose claim it is'),
  tags: z.array(z.string()).describe('Keys views pick claims by, e.g. "layer-4"; never shown'),
  order: Order,
  fileIds: FileIds,
});

export const TermData = z.strictObject({
  projectId: Id,
  word: Text.max(40).describe('As it appears in text, e.g. "recipe"'),
  explanation: Text.max(240).describe('One or two plain sentences'),
  alsoCalled: z.array(z.string().min(1).max(40)).describe('Other forms to match, e.g. ["recipes"]'),
  sourceId: Id.optional().describe(
    'Artifact the explanation comes from; without one it says "Our wording"',
  ),
});

/**
 * A file on the owner's disk, added to a project from a folder in Settings (R7). The file stays
 * where it is; Pharos keeps where it is and its details. `rootId` is a folder id from the
 * settings, not an entity, so removing a folder leaves its files here, shown as missing.
 * SCAN_FILE_FIELDS (files.ts) are set by the scan only.
 */
export const FileData = z.strictObject({
  projectId: Id,
  title: Text.max(200).describe('Shown name, e.g. "Certificate of incorporation"'),
  rootId: FolderId,
  path: FilePath,
  size: z.number().int().min(0).describe('Bytes'),
  modifiedAt: z.iso.datetime().describe('Last modified on disk'),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional()
    .describe('Filled when first read; finds the file again after it moves'),
  mimeType: z.string().min(1).optional().describe('From the allowlist in files.ts'),
  kind: optionField('file.kind'),
  issuer: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Who issued it or sent it, e.g. a bank, an agency, a supplier'),
  issuedDate: IsoDate.optional().describe('YYYY-MM-DD it was issued'),
  expiryDate: IsoDate.optional().describe('YYYY-MM-DD it expires or must be renewed'),
  tags: z.array(z.string().min(1).max(40)),
  notes: Markdown.optional(),
  taskIds: z.array(Id).describe('Tasks this file belongs to'),
});

/**
 * One record of a kind the project defines (R8): a service, a bill, a spending. Its fields are
 * checked against the record type in `project.data.recordTypes`.
 */
export const RecordData = z.strictObject({
  projectId: Id,
  recordType: RecordKey.describe("Key of one of the project's record types"),
  title: Text.max(200),
  fields: z
    .record(z.string(), FieldValue)
    .describe('Values by field key; money is {amount (minor units), currency}'),
  interval: Interval.optional().describe('When it repeats (record types with interval: true)'),
  notes: Markdown.optional(),
  order: Order,
  fileIds: FileIds,
});

export const ENTITY_TYPES = [
  'section',
  'repository',
  'assignee',
  'project',
  'goal',
  'scope_item',
  'stage',
  'task',
  'artifact',
  'decision',
  'view',
  'request',
  'claim',
  'term',
  'file',
  'record',
  'comment',
] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export type RefSpec = {
  type: EntityType;
  many?: boolean;
  /** What happens to this entity when the referenced one is deleted. */
  onDelete: 'unset' | 'cascade';
};

type EntityDef = {
  prefix: string;
  data: z.ZodObject;
  /** Values filled in on create when omitted. `order` is computed by the store. */
  defaults: Record<string, unknown>;
  refs: Record<string, RefSpec>;
  /** Field used as a human-readable label in history and snapshots. */
  label: string;
};

const projectRef: RefSpec = { type: 'project', onDelete: 'cascade' };

export const ENTITIES = {
  section: {
    prefix: 'sec',
    data: SectionData,
    defaults: {},
    refs: { parentId: { type: 'section', onDelete: 'unset' } },
    label: 'name',
  },
  repository: {
    prefix: 'repo',
    data: RepositoryData,
    defaults: {},
    refs: { sectionId: { type: 'section', onDelete: 'unset' } },
    label: 'name',
  },
  assignee: { prefix: 'asg', data: AssigneeData, defaults: {}, refs: {}, label: 'name' },
  project: {
    prefix: 'prj',
    data: ProjectData,
    defaults: { status: 'planning' },
    refs: {
      repositoryId: { type: 'repository', onDelete: 'unset' },
      sectionId: { type: 'section', onDelete: 'unset' },
      currentStageId: { type: 'stage', onDelete: 'unset' },
    },
    label: 'name',
  },
  goal: {
    prefix: 'goal',
    data: GoalData,
    defaults: { status: 'open', successCriteria: [] },
    refs: {
      projectId: projectRef,
      parentId: { type: 'goal', onDelete: 'cascade' },
      fileIds: { type: 'file', many: true, onDelete: 'unset' },
    },
    label: 'title',
  },
  scope_item: {
    prefix: 'scope',
    data: ScopeItemData,
    defaults: {},
    refs: { projectId: projectRef },
    label: 'title',
  },
  stage: {
    prefix: 'stg',
    data: StageData,
    defaults: { status: 'planned' },
    refs: { projectId: projectRef, fileIds: { type: 'file', many: true, onDelete: 'unset' } },
    label: 'name',
  },
  task: {
    prefix: 'task',
    data: TaskData,
    defaults: { status: 'todo', priority: 'medium', dependsOn: [] },
    refs: {
      projectId: projectRef,
      stageId: { type: 'stage', onDelete: 'unset' },
      goalIds: { type: 'goal', many: true, onDelete: 'unset' },
      assigneeId: { type: 'assignee', onDelete: 'unset' },
      dependsOn: { type: 'task', many: true, onDelete: 'unset' },
      fileIds: { type: 'file', many: true, onDelete: 'unset' },
    },
    label: 'title',
  },
  artifact: {
    prefix: 'art',
    data: ArtifactData,
    defaults: { kind: 'other', status: 'expected' },
    refs: {
      projectId: projectRef,
      stageId: { type: 'stage', onDelete: 'unset' },
      taskId: { type: 'task', onDelete: 'unset' },
      fileId: { type: 'file', onDelete: 'unset' },
    },
    label: 'title',
  },
  decision: {
    prefix: 'dec',
    data: DecisionData,
    defaults: { status: 'accepted' },
    refs: {
      projectId: projectRef,
      decidedById: { type: 'assignee', onDelete: 'unset' },
      dependsOn: { type: 'decision', many: true, onDelete: 'unset' },
      fileIds: { type: 'file', many: true, onDelete: 'unset' },
    },
    label: 'title',
  },
  view: {
    prefix: 'view',
    data: ViewData,
    defaults: { pinned: false },
    refs: { projectId: projectRef },
    label: 'name',
  },
  request: {
    prefix: 'req',
    data: RequestData,
    defaults: { status: 'open' },
    refs: {
      projectId: projectRef,
      viewId: { type: 'view', onDelete: 'unset' },
      answerViewId: { type: 'view', onDelete: 'unset' },
    },
    label: 'question',
  },
  claim: {
    prefix: 'clm',
    data: ClaimData,
    // A meaning; the store picks the project's value for it.
    defaults: { certainty: 'reading', sourceIds: [], tags: [] },
    refs: {
      projectId: projectRef,
      sourceIds: { type: 'artifact', many: true, onDelete: 'unset' },
      quoteSourceId: { type: 'artifact', onDelete: 'unset' },
      confirmedById: { type: 'decision', onDelete: 'unset' },
      aboutId: { type: 'artifact', onDelete: 'unset' },
      authorId: { type: 'assignee', onDelete: 'unset' },
      fileIds: { type: 'file', many: true, onDelete: 'unset' },
    },
    label: 'statement',
  },
  term: {
    prefix: 'term',
    data: TermData,
    defaults: { alsoCalled: [] },
    refs: { projectId: projectRef, sourceId: { type: 'artifact', onDelete: 'unset' } },
    label: 'word',
  },
  file: {
    prefix: 'file',
    data: FileData,
    // A meaning; the store picks the project's value for it.
    defaults: { kind: 'other', tags: [], taskIds: [] },
    refs: {
      projectId: projectRef,
      taskIds: { type: 'task', many: true, onDelete: 'unset' },
    },
    label: 'title',
  },
  record: {
    prefix: 'rec',
    data: RecordData,
    defaults: { fields: {} },
    refs: { projectId: projectRef, fileIds: { type: 'file', many: true, onDelete: 'unset' } },
    label: 'title',
  },
  comment: {
    prefix: 'cmt',
    data: CommentData,
    defaults: {},
    refs: { projectId: projectRef, taskId: { type: 'task', onDelete: 'cascade' } },
    label: 'body',
  },
} satisfies Record<EntityType, EntityDef>;

export type EntityDataMap = { [T in EntityType]: z.infer<(typeof ENTITIES)[T]['data']> };

/** Whether entities of this type belong to a project (vs. workspace-wide). */
export function isProjectScoped(type: EntityType): boolean {
  return type !== 'repository' && type !== 'assignee' && type !== 'section';
}

export function hasOrder(type: EntityType): boolean {
  return 'order' in ENTITIES[type].data.shape;
}

/** Create input: fields that have defaults (and `order`) become optional. */
export function createSchema(type: EntityType): z.ZodObject {
  const def: EntityDef = ENTITIES[type];
  const optional: Record<string, true> = {};
  for (const key of Object.keys(def.defaults)) optional[key] = true;
  if (hasOrder(type)) optional.order = true;
  return def.data.partial(optional);
}

/**
 * The same schema without its own description (C1): an update's fields are described once, in the
 * create operation of the same type, which keeps the apply tool's JSON schema small. Checks stay;
 * a schema shared by id ($defs) is kept as it is.
 */
function undescribed(schema: z.ZodType): z.ZodType {
  const meta = z.globalRegistry.get(schema);
  if (!meta?.description || meta.id) return schema;
  return schema.clone(schema._zod.def);
}

/**
 * Patch input: every field optional, `null` clears an optional field.
 * `projectId` can't change: entities don't move between projects.
 */
export function patchSchema(type: EntityType): z.ZodObject {
  const shape = ENTITIES[type].data.shape as Record<string, z.ZodType>;
  const patch: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    if (key === 'projectId') continue;
    const inner = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodType) : field;
    patch[key] = undescribed(inner).nullable().optional();
  }
  return z.strictObject(patch);
}

/** Stored entity: data plus store-managed metadata. */
export type Entity<T extends EntityType = EntityType> = {
  id: string;
  type: T;
  data: EntityDataMap[T];
  createdAt: string;
  updatedAt: string;
  createdRev: number;
  updatedRev: number;
};
