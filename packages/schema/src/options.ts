import { z } from 'zod';

/**
 * Built-in meanings of option fields. Custom options each map to one of these, so progress,
 * highlights, and agents keep working however a project names its statuses.
 */
export const TaskStatus = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
export const TaskPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export const StageStatus = z.enum(['planned', 'active', 'done', 'skipped']);
export const GoalStatus = z.enum(['open', 'achieved', 'dropped']);
export const ScopeKind = z.enum(['in', 'maybe', 'out']);
export const ArtifactKind = z.enum(['file', 'link', 'doc', 'design', 'other']);
export const ArtifactStatus = z.enum(['expected', 'in_progress', 'delivered']);
export const DecisionStatus = z.enum(['proposed', 'accepted', 'rejected', 'superseded']);
/** How sure a claim is, weakest first. */
export const Certainty = z.enum(['reading', 'verified', 'confirmed']);
/** What a project file is (R7); a project can rename these or add its own, e.g. "Tax form". */
export const FileKind = z.enum([
  'statement',
  'receipt',
  'contract',
  'certificate',
  'manual',
  'audio',
  'other',
]);

export const OPTION_FIELDS = {
  'task.status': {
    type: 'task',
    field: 'status',
    meanings: TaskStatus.options,
    label: 'Task status',
  },
  'task.priority': {
    type: 'task',
    field: 'priority',
    meanings: TaskPriority.options,
    label: 'Task priority',
  },
  'stage.status': {
    type: 'stage',
    field: 'status',
    meanings: StageStatus.options,
    label: 'Stage status',
  },
  'goal.status': {
    type: 'goal',
    field: 'status',
    meanings: GoalStatus.options,
    label: 'Goal status',
  },
  'scope_item.kind': {
    type: 'scope_item',
    field: 'kind',
    meanings: ScopeKind.options,
    label: 'Scope group',
  },
  'artifact.kind': {
    type: 'artifact',
    field: 'kind',
    meanings: ArtifactKind.options,
    label: 'Artifact kind',
  },
  'artifact.status': {
    type: 'artifact',
    field: 'status',
    meanings: ArtifactStatus.options,
    label: 'Artifact status',
  },
  'decision.status': {
    type: 'decision',
    field: 'status',
    meanings: DecisionStatus.options,
    label: 'Decision status',
  },
  'claim.certainty': {
    type: 'claim',
    field: 'certainty',
    meanings: Certainty.options,
    label: 'Certainty',
  },
  'file.kind': {
    type: 'file',
    field: 'kind',
    meanings: FileKind.options,
    label: 'File kind',
  },
} as const;

export type OptionKey = keyof typeof OPTION_FIELDS;
export const OPTION_KEYS = Object.keys(OPTION_FIELDS) as OptionKey[];

export const OPTION_COLORS = [
  'neutral',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'muted',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

/** Default colour per meaning, for options without their own colour. */
const MEANING_COLORS: Record<string, OptionColor> = {
  todo: 'neutral',
  in_progress: 'blue',
  blocked: 'red',
  done: 'green',
  cancelled: 'muted',
  low: 'muted',
  medium: 'neutral',
  high: 'amber',
  urgent: 'red',
  planned: 'neutral',
  active: 'blue',
  skipped: 'muted',
  open: 'neutral',
  achieved: 'green',
  dropped: 'muted',
  in: 'green',
  maybe: 'amber',
  out: 'muted',
  expected: 'neutral',
  delivered: 'green',
  proposed: 'amber',
  accepted: 'green',
  rejected: 'red',
  superseded: 'muted',
  reading: 'amber',
  verified: 'green',
  confirmed: 'violet',
  statement: 'blue',
  receipt: 'green',
  contract: 'violet',
  certificate: 'amber',
};

export const OptionValue = z
  .string()
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits, and underscores')
  .max(40);

function optionList(key: OptionKey) {
  const meanings = OPTION_FIELDS[key].meanings as unknown as [string, ...string[]];
  return z
    .array(
      z.strictObject({
        value: OptionValue.describe('Stored value; keep it stable when renaming'),
        label: z.string().min(1).max(40),
        meaning: z.enum(meanings).describe('Which built-in meaning this option counts as'),
        color: z.enum(OPTION_COLORS).optional(),
      }),
    )
    .min(1)
    .superRefine((options, ctx) => {
      const seen = new Set<string>();
      options.forEach((o, i) => {
        if (seen.has(o.value))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate value "${o.value}"`,
            path: [i, 'value'],
          });
        seen.add(o.value);
      });
    })
    .describe(`Options in display order. Meanings: ${meanings.join(', ')}`);
}

export const ProjectOptions = z
  .strictObject(
    Object.fromEntries(OPTION_KEYS.map((k) => [k, optionList(k).optional()])) as Record<
      OptionKey,
      z.ZodOptional<ReturnType<typeof optionList>>
    >,
  )
  .describe('Custom option lists for this project; omitted fields use the defaults');
export type ProjectOptions = z.infer<typeof ProjectOptions>;

export type Option = { value: string; label: string; meaning: string; color: OptionColor };

function humanize(value: string): string {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Default labels where the plain meaning name would be unclear. */
const DEFAULT_LABELS: Partial<Record<OptionKey, Record<string, string>>> = {
  'scope_item.kind': { in: 'In scope', out: 'Out of scope' },
  'claim.certainty': {
    reading: 'Our reading',
    verified: 'From source',
    confirmed: 'Confirmed by you',
  },
};

/** Meanings with a fixed strength, weakest first. Ranges and sorting use this, never list order. */
export const RANKED_MEANINGS: Partial<Record<OptionKey, readonly string[]>> = {
  'claim.certainty': Certainty.options,
};

export function defaultOptions(key: OptionKey): Option[] {
  return OPTION_FIELDS[key].meanings.map((m) => ({
    value: m,
    label: DEFAULT_LABELS[key]?.[m] ?? humanize(m),
    meaning: m,
    color: MEANING_COLORS[m] ?? 'neutral',
  }));
}

type HasOptions = { data: { options?: ProjectOptions } } | null | undefined;

/** The options a project uses for a field, in display order. */
export function optionsFor(project: HasOptions, key: OptionKey): Option[] {
  const custom = project?.data.options?.[key];
  if (!custom) return defaultOptions(key);
  return custom.map((o) => ({ ...o, color: o.color ?? MEANING_COLORS[o.meaning] ?? 'neutral' }));
}

export function findOption(
  project: HasOptions,
  key: OptionKey,
  value: string | undefined,
): Option | undefined {
  return value === undefined ? undefined : optionsFor(project, key).find((o) => o.value === value);
}

/** The built-in meaning of a stored value (unknown values count as themselves). */
export function meaningOf(
  project: HasOptions,
  key: OptionKey,
  value: string | undefined,
): string | undefined {
  return findOption(project, key, value)?.meaning ?? value;
}

/** The first option with a meaning, e.g. the value to set when a task is ticked off. */
export function valueFor(project: HasOptions, key: OptionKey, meaning: string): string {
  const options = optionsFor(project, key);
  return (options.find((o) => o.meaning === meaning) ?? options[0]!).value;
}

/** The option key for an entity field, if that field uses options. */
export function optionKeyOf(type: string, field: string): OptionKey | undefined {
  const key = `${type}.${field}`;
  return key in OPTION_FIELDS ? (key as OptionKey) : undefined;
}

/** A value for a new option, derived from its label and not clashing with any meaning or existing value. */
export function newOptionValue(label: string, key: OptionKey, existing: Option[]): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'option';
  const taken = new Set([...existing.map((o) => o.value), ...OPTION_FIELDS[key].meanings]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
