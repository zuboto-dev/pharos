import { z } from 'zod';
import { OPTION_FIELDS, ProjectOptions, defaultOptions, type OptionKey } from './options.js';
import { ViewSpec } from './views/board.js';

export {
  ArtifactKind,
  ArtifactStatus,
  DecisionStatus,
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

export const SectionData = z.strictObject({
  name: Text.describe('e.g. "Work", "Personal"'),
  order: Order,
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
  pinned: z.boolean().optional().describe('Pinned projects are listed first in the sidebar'),
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
});

export const TaskData = z.strictObject({
  projectId: Id,
  stageId: Id.optional(),
  title: Text,
  description: Markdown.optional(),
  status: optionField('task.status'),
  priority: optionField('task.priority'),
  assigneeId: Id.optional(),
  dependsOn: z.array(Id).describe('Ids of tasks that must finish first'),
  estimate: z.string().optional().describe('Free-form, e.g. "2h", "3 points"'),
  dueDate: IsoDate.optional().describe('YYYY-MM-DD'),
  order: Order,
});

export const ArtifactData = z.strictObject({
  projectId: Id,
  title: Text,
  description: Markdown.optional(),
  kind: optionField('artifact.kind'),
  status: optionField('artifact.status'),
  uri: z.string().optional().describe('Path or URL of the deliverable'),
  stageId: Id.optional(),
  taskId: Id.optional(),
});

export const DecisionData = z.strictObject({
  projectId: Id,
  title: Text,
  body: Markdown.optional().describe('Context, options considered, and the reasoning'),
  status: optionField('decision.status'),
  decidedById: Id.optional().describe(
    'Assignee (person or agent) who made the decision, often the person who asked; not just who recorded it',
  ),
  decisionDate: IsoDate.optional().describe('YYYY-MM-DD the decision was made'),
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
  pinned: z.boolean().describe('Pinned views are shown first'),
  archived: z.boolean().optional().describe('Archived views are hidden from the tabs'),
  kind: z
    .enum(['saved', 'answer'])
    .optional()
    .describe('An answer view answers one question and expires unless kept (default: saved)'),
  question: z.string().optional().describe('For answer views: the question it answers'),
  expiresAt: z.iso
    .datetime()
    .optional()
    .describe('For answer views: hidden after this time unless kept'),
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
  section: { prefix: 'sec', data: SectionData, defaults: {}, refs: {}, label: 'name' },
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
    refs: { projectId: projectRef, parentId: { type: 'goal', onDelete: 'cascade' } },
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
    refs: { projectId: projectRef },
    label: 'name',
  },
  task: {
    prefix: 'task',
    data: TaskData,
    defaults: { status: 'todo', priority: 'medium', dependsOn: [] },
    refs: {
      projectId: projectRef,
      stageId: { type: 'stage', onDelete: 'unset' },
      assigneeId: { type: 'assignee', onDelete: 'unset' },
      dependsOn: { type: 'task', many: true, onDelete: 'unset' },
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
    },
    label: 'title',
  },
  decision: {
    prefix: 'dec',
    data: DecisionData,
    defaults: { status: 'accepted' },
    refs: { projectId: projectRef, decidedById: { type: 'assignee', onDelete: 'unset' } },
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
 * Patch input: every field optional, `null` clears an optional field.
 * `projectId` can't change: entities don't move between projects.
 */
export function patchSchema(type: EntityType): z.ZodObject {
  const shape = ENTITIES[type].data.shape as Record<string, z.ZodType>;
  const patch: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    if (key === 'projectId') continue;
    const inner = field instanceof z.ZodOptional ? (field.unwrap() as z.ZodType) : field;
    patch[key] = inner.nullable().optional();
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
