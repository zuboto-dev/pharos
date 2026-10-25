import { z } from 'zod';

/**
 * What a task asks for, so a person can check the work without asking: the steps to take
 * (`actions`), what makes it done (`acceptance`), and what it leaves behind (`deliverables`).
 * All optional on the record (older tasks and the owner's own stay valid); agents are warned
 * when they create or start a task without them (`taskDetailWarnings`).
 */
export const TASK_DETAILS = {
  /** Most steps, checks or deliverables on one task. */
  items: 20,
  /** A step may hold a command in a code block, so it has room for one. */
  stepChars: 1000,
  labelChars: 200,
  refChars: 500,
} as const;

export const DELIVERABLE_KINDS = ['file', 'page', 'link', 'commit', 'record', 'other'] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

const Line = z.string().trim().min(1).max(TASK_DETAILS.stepChars);

export const Deliverable = z
  .strictObject({
    label: z.string().trim().min(1).max(TASK_DETAILS.labelChars),
    kind: z.enum(DELIVERABLE_KINDS).optional(),
    ref: z.string().trim().min(1).max(TASK_DETAILS.refChars).optional().describe('Path, URL or id'),
  })
  .meta({ id: 'Deliverable' });
export type Deliverable = z.infer<typeof Deliverable>;

/** The three fields, spread into TaskData. */
export const TASK_DETAIL_FIELDS = {
  actions: z.array(Line).max(TASK_DETAILS.items).optional().describe('Steps to take, in order'),
  acceptance: z
    .array(Line)
    .max(TASK_DETAILS.items)
    .optional()
    .describe('Checkable "done when" statements'),
  acceptanceMet: z
    .array(Line)
    .max(TASK_DETAILS.items)
    .optional()
    .describe(
      'The acceptance statements checked off, word for word; when every one is, Pharos marks the task done',
    ),
  deliverables: z
    .array(Deliverable)
    .max(TASK_DETAILS.items)
    .optional()
    .describe('Short links to what it produces; write results and evidence as comments instead'),
};

type TaskLike = {
  title?: string;
  status?: string;
  desk?: boolean;
  actions?: string[];
  acceptance?: string[];
  deliverables?: Deliverable[];
};

const NAMES = {
  actions: 'required actions (actions)',
  acceptance: 'acceptance criteria (acceptance)',
  deliverables: 'expected results (deliverables)',
} as const;

/** The detail fields a task should carry: a task on the owner's desk needs no deliverables. */
export function requiredTaskDetails(task: TaskLike): (keyof typeof NAMES)[] {
  return task.desk ? ['actions', 'acceptance'] : ['actions', 'acceptance', 'deliverables'];
}

/** Which of the required detail fields are empty. */
export function missingTaskDetails(task: TaskLike): (keyof typeof NAMES)[] {
  return requiredTaskDetails(task).filter((f) => !task[f]?.length);
}

function list(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Warnings for an agent's write of one task (never refused): created, or moved to in progress,
 * without its details; marked done with deliverables that don't say where they are.
 * `meaning` maps a status value to its built-in meaning.
 */
export function taskDetailWarnings(
  before: TaskLike | null,
  after: TaskLike,
  meaning: (status: string | undefined) => string | undefined,
): string[] {
  const out: string[] = [];
  const was = before ? meaning(before.status) : undefined;
  const now = meaning(after.status);
  const started = now === 'in_progress' && was !== 'in_progress';
  if (!before || started) {
    const missing = missingTaskDetails(after);
    if (missing.length)
      out.push(
        `${before ? 'moved to in progress' : 'created'} without ${list(missing.map((f) => NAMES[f]))}: add them so a person could check the work without asking`,
      );
  }
  if (now === 'done' && was !== 'done') {
    const noRef = (after.deliverables ?? []).filter((d) => !d.ref).map((d) => `"${d.label}"`);
    if (noRef.length)
      out.push(
        `marked done with deliverables that have no ref (${list(noRef)}): give each its path, URL, commit or id`,
      );
  }
  return out;
}

/** A short count for a hover hint on a task row, e.g. "3 steps · 2 checks · 1 result". */
export function taskDetailSummary(task: TaskLike): string | undefined {
  const count = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  const parts = [
    count(task.actions?.length ?? 0, 'step'),
    count(task.acceptance?.length ?? 0, 'check'),
    count(task.deliverables?.length ?? 0, 'result'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}
