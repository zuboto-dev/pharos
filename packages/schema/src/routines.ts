import { z } from 'zod';

/**
 * The Routines page: Pharos's control panel for the owner's daily routines (evening wrap-up,
 * night run, morning report, cleanup). The engine stays the Routines app (its own server, by
 * default http://127.0.0.1:4777, `PHAROS_ROUTINES_URL`); Pharos proxies its API under
 * `/api/routines/*` for the owner only and draws the page itself. Nothing here is project data:
 * never revisions, never over MCP.
 */

export const ROUTINES = ['wrapup', 'nightshift', 'daybreak'] as const;
export type Routine = (typeof ROUTINES)[number];

export const ROUTINE_NAMES: Record<Routine, string> = {
  wrapup: 'Wrap-up',
  nightshift: 'Night run',
  daybreak: 'Morning report',
};

/** What the three built-in routines do, for routines.json from before `routines` existed. */
export const ROUTINE_INSTRUCTIONS: Record<Routine, string> = {
  wrapup: 'Close the day, update Pharos, and hand code-doable work to the night.',
  nightshift: 'Work the handoff: each task on its model, verified, landed in small slices.',
  daybreak: 'Verify the night and write what was done, the results and today’s plan.',
};

/** A routine id: lower case, digits and dashes. */
export const ROUTINE_ID = /^[a-z0-9-]{1,32}$/;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM');

/**
 * One routine as the owner defines it (routines.json `routines`): a name, a daily time, what to
 * do in the owner's words, and which projects it covers. The three built-ins also name the skill
 * they run (wrapup, nightshift, daybreak); a custom one has only its instructions.
 */
/** Days of the week a routine can run on (the day the run happens, in the schedule's timezone). */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
const DAY_NAMES: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
export const WEEKDAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** Days as people say them: "every day", "weekdays", "Fridays", "Mon, Wed, Fri". */
export function daysText(days: readonly Day[] | undefined): string {
  if (!days || new Set(days).size >= 7) return 'every day';
  const sorted = DAYS.filter((d) => days.includes(d));
  if (sorted.join() === WEEKDAYS.join()) return 'weekdays';
  if (sorted.join() === 'sat,sun') return 'weekends';
  if (sorted.length === 1) return `${DAY_NAMES[sorted[0]!]}s`;
  return sorted.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
}

/** Short days for a chip or a tooltip: "Fri only", "weekdays", "Mon, Wed". */
export function daysShort(days: readonly Day[] | undefined): string {
  const text = daysText(days);
  return days && days.length === 1 ? `${DAY_NAMES[days[0]!].slice(0, 3)} only` : text;
}

const Days = z
  .array(z.enum(DAYS))
  .min(1, 'pick at least one day')
  .max(7)
  .refine((d) => new Set(d).size === d.length, 'each day once');

export const RoutineDef = z.object({
  id: z.string().regex(ROUTINE_ID, 'an id of a-z, 0-9 and -'),
  name: z.string().trim().min(1).max(60),
  time: Time,
  enabled: z.boolean(),
  skill: z.string().max(40).optional(),
  instructions: z.string().max(2000),
  projects: z.union([z.literal('enrolled'), z.array(z.string().min(1).max(120)).max(100)]),
  /** The days it runs; missing means every day. */
  days: Days.optional(),
});
export type RoutineDef = z.infer<typeof RoutineDef>;

/**
 * What an agent proposes (MCP routine_propose): a routine the owner adds with one tap on the
 * desk. Agents never change routines.json themselves.
 */
export const RoutineProposal = z.strictObject({
  name: z.string().trim().min(1).max(60).describe('Its name, e.g. "Weekly review"'),
  time: Time.describe('When it runs each day it runs, HH:MM (24 h) in the schedule’s timezone'),
  days: Days.optional().describe('The days it runs (mon…sun); leave out for every day'),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('What it should do, in the owner’s words: what to look at and what to leave them'),
  projects: z
    .union([z.literal('enrolled'), z.array(z.string().min(1).max(120)).min(1).max(100)])
    .optional()
    .describe('Routines project names (folder names, e.g. "tutti"), or "enrolled" (default)'),
  reason: z.string().trim().min(1).max(600).describe('Why: one or two lines the owner reads'),
  projectId: z
    .string()
    .optional()
    .describe('The Pharos project whose desk it goes on (default: the first named project’s)'),
});
export type RoutineProposal = z.infer<typeof RoutineProposal>;

/** A proposal waiting on the owner, as the Routines page lists it. */
export type RoutineProposalView = {
  decisionId: string;
  href: string;
  proposedBy: string;
  proposal: RoutineProposal;
  /** Approved, but Routines didn't answer: Pharos tries again. */
  waiting?: string;
};

/** The routines a routines.json defines; the three built-ins from `schedule` when it has none. */
export function routinesOf(config: Pick<RoutinesConfig, 'schedule' | 'routines'>): RoutineDef[] {
  if (Array.isArray(config.routines)) return config.routines;
  return ROUTINES.flatMap((id) => {
    const time = config.schedule?.[id];
    if (!time) return [];
    return [
      {
        id,
        name: ROUTINE_NAMES[id],
        time,
        enabled: true,
        skill: id,
        instructions: ROUTINE_INSTRUCTIONS[id],
        projects: 'enrolled' as const,
      },
    ];
  });
}

/** Whether a routine covers a project (its own list, or every enrolled one). */
export function routineCovers(routine: RoutineDef, project: RoutinesProject): boolean {
  return routine.projects === 'enrolled'
    ? project.enrolled
    : routine.projects.includes(project.name);
}

/** The Routines app's planning files a row can open (its `/api/file` list). */
export const ROUTINE_FILES = [
  'NEXT.md',
  'HANDOFF.md',
  'PACKET.md',
  'MORNING.md',
  'PRODUCT.md',
  'REVIEW.md',
] as const;
export type RoutineFile = (typeof ROUTINE_FILES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** The models the dispatch table offers (what run.sh's nightshift skill understands). */
export const ROUTINE_MODELS = ['haiku', 'sonnet', 'opus'] as const;

/** A log file name as the Routines app writes them (`2026-10-23-pharos-wrapup.log`). */
export const ROUTINE_LOG = /^[\w.-]+\.log$/;

/** One project in routines.json (fields Pharos doesn't edit pass through unchanged). */
export type RoutinesProject = {
  name: string;
  path: string;
  enrolled: boolean;
  budget_usd: number;
  hours: number;
  note?: string;
  pm?: { type: string; url?: string; project?: string } | null;
  cleanup?: number;
  /** The id of one of `machines` its routines run on; absent: the Routines computer itself. */
  machine?: string;
};

/** Another computer of the owner's that routines can run on (over SSH), e.g. axion-01. */
export type RoutinesMachine = { id: string; name: string; host: string; home?: string };

export type RoutinesConfig = {
  schedule: Partial<Record<Routine, string>> & { timezone?: string };
  master: { model: string; effort: string };
  dispatch: Record<string, Partial<Record<Difficulty, string>>>;
  cleanup?: { level?: number; scratch_days?: number };
  projects: RoutinesProject[];
  /** The owner's other machines a project can run on (Routines `machines`). */
  machines?: RoutinesMachine[];
  /** The owner's routines (newer Routines apps); see `routinesOf` for older ones. */
  routines?: RoutineDef[];
  [key: string]: unknown;
};

export type RoutineRunStatus = 'ok' | 'ran' | 'error' | 'running';

export type RoutineRun = {
  file: string | null;
  when: string | null;
  status: RoutineRunStatus;
  tail: string;
};

export type RoutinesProjectStatus = {
  name: string;
  exists: boolean;
  files?: Partial<Record<RoutineFile, { when: string | null; first: string | null }>>;
  git?: { dirty: number; head: string; ahead: string };
  queue?: { auto: number; review: number; needs_you: number; ship: string };
  /** The last run of each routine, by routine id. */
  runs?: Record<string, RoutineRun | null | undefined>;
};

/**
 * What Pharos knows of a Routines project: its Pharos projects (those whose repository folder is
 * the project's path) and their report views named after a routine ("Night run").
 */
export type RoutinesPharos = {
  projects: { id: string; name: string }[];
  reports: { routine: string; name: string; href: string }[];
};

/**
 * A Pharos folder (a repository with a path on this computer): what the Routines page lists, so
 * a new folder shows up there and a deleted one stops matching. `project` is the folder's main
 * Pharos project (the one named like the folder, else its first), which a new Routines entry links.
 */
export type RoutinesFolder = {
  id: string;
  name: string;
  path: string;
  project?: { id: string; name: string };
};

/** A Routines project as the save adds it (fields the engine reads; others pass through). */
export const RoutinesProjectEntry = z
  .object({
    name: z.string().trim().min(1).max(120),
    path: z.string().min(1).max(1000),
    enrolled: z.boolean(),
    budget_usd: z.number().min(0).max(500),
    hours: z.number().min(0).max(24),
    pm: z
      .object({ type: z.string().max(40), project: z.string().max(200).optional() })
      .passthrough()
      .nullable()
      .optional(),
    note: z.string().max(500).optional(),
  })
  .passthrough();

export type RoutinesPage = { url: string; date?: string; posted?: string };

/** Where one project is in the routine running now (Routines' `current`). */
export type RoutinesCurrentProject = {
  name: string;
  state: 'queued' | 'waiting' | 'running' | 'done' | 'skipped' | 'failed';
  /** Why it waits or was skipped ("a Claude session is active in breathe · try 2 of 3"). */
  reason?: string;
  /** Since when it is in this state (the Routines computer's local time). */
  since?: string;
  /** Its report, when done: a Pharos page. */
  report?: string;
};

/** The routine running now, project by project (null when none runs). */
export type RoutinesCurrent = {
  routine: string;
  name: string;
  started: string;
  projects: RoutinesCurrentProject[];
};

/** GET /api/routines/state. */
export type RoutinesState =
  | {
      available: true;
      /** routines.json, with `routines` always filled (derived from `schedule` when missing). */
      config: RoutinesConfig & { routines: RoutineDef[] };
      /** The Routines app keeps a `routines` list: routines can be added and removed. */
      editable: boolean;
      status: RoutinesProjectStatus[];
      /** By Routines project name. */
      pharos: Record<string, RoutinesPharos>;
      /** Pharos's folders with a path, when this server has a store. */
      folders?: RoutinesFolder[];
      /** The routine running now (newer Routines apps); null when idle. */
      current?: RoutinesCurrent | null;
      /** Routines agents proposed that wait on the owner (routine_propose). */
      proposals?: RoutineProposalView[];
      report?: { text: string; date: string | null; when: string | null };
      pages?: Partial<Record<'morning' | 'evening', RoutinesPage>>;
      /** The Routines computer's local time, `YYYY-MM-DDTHH:MM`. */
      now: string;
      url: string;
    }
  | { available: false; reason: string; url: string };

const Model = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,39}$/, 'a model name');
const Name = z.string().min(1).max(120);

/**
 * One edit on the page: the field, the value the page showed (`from`) and the new one (`to`).
 * The save refuses an edit whose field no longer holds `from` (routines.json changed meanwhile).
 */
export const RoutinesChange = z.discriminatedUnion('field', [
  z.object({ field: z.literal('enrolled'), project: Name, from: z.boolean(), to: z.boolean() }),
  z.object({
    field: z.literal('budget_usd'),
    project: Name,
    from: z.number(),
    to: z.number().min(0).max(500),
  }),
  z.object({
    field: z.literal('hours'),
    project: Name,
    from: z.number(),
    to: z.number().min(0).max(24),
  }),
  // Where a project's routines run: a machine id from `machines`, or null for this computer.
  z.object({
    field: z.literal('machine'),
    project: Name,
    from: z.string().nullable(),
    to: z
      .string()
      .regex(/^[\w.-]{1,64}$/)
      .nullable(),
  }),
  z.object({
    field: z.literal('schedule'),
    routine: z.enum(ROUTINES),
    from: z.string().optional(),
    to: Time,
  }),
  z.object({
    field: z.literal('timezone'),
    from: z.string().optional(),
    to: z.string().min(1).max(64),
  }),
  z.object({
    field: z.literal('dispatch'),
    kind: Name,
    level: z.enum(DIFFICULTIES),
    from: z.string().optional(),
    to: Model,
  }),
  // A routine added (from null), changed, or removed (to null).
  z.object({
    field: z.literal('routine'),
    id: z.string().regex(ROUTINE_ID),
    from: RoutineDef.nullable(),
    to: RoutineDef.nullable(),
  }),
  // A project added to routines.json (from null: a Pharos folder) or removed (to null). Removing
  // only takes the entry out of routines.json; the folder and its files stay.
  z.object({
    field: z.literal('project'),
    name: Name,
    from: RoutinesProjectEntry.nullable(),
    to: RoutinesProjectEntry.nullable(),
  }),
]);
export type RoutinesChange = z.infer<typeof RoutinesChange>;

/** POST /api/routines/save. */
export const RoutinesSave = z.object({ changes: z.array(RoutinesChange).min(1).max(200) });

/** POST /api/routines/run: one routine for one project, now. */
export const RoutinesRun = z.object({ routine: z.string().regex(ROUTINE_ID), project: Name });

const money = (n: number) => `$${n}`;

/** What one edit does, in words: "pharos: night budget $8 → $10". */
export function describeRoutinesChange(change: RoutinesChange): string {
  switch (change.field) {
    case 'enrolled':
      return `${change.project}: ${change.to ? 'enrolled' : 'not enrolled'}`;
    case 'budget_usd':
      return `${change.project}: night budget ${money(change.from)} → ${money(change.to)}`;
    case 'hours':
      return `${change.project}: night hours ${change.from} h → ${change.to} h`;
    case 'machine':
      return `${change.project}: runs on ${change.to ?? 'this computer'} (was ${change.from ?? 'this computer'})`;
    case 'schedule':
      return `${ROUTINE_NAMES[change.routine]} at ${change.from ?? 'no time'} → ${change.to}`;
    case 'timezone':
      return `Timezone ${change.from ?? 'none'} → ${change.to}`;
    case 'dispatch':
      return `${change.kind}, ${change.level}: ${change.from ?? 'none'} → ${change.to}`;
    case 'routine':
      return describeRoutineChange(change.from, change.to);
    case 'project':
      if (change.to && !change.from)
        return `Add ${change.name} to the routines (${change.to.enrolled ? 'enrolled' : 'parked'}, ${money(change.to.budget_usd)} · ${change.to.hours} h)`;
      if (change.from && !change.to)
        return `Remove ${change.name} from the routines (its folder and files stay)`;
      return `${change.name}: changed`;
  }
}

const who = (r: RoutineDef) =>
  r.projects === 'enrolled' ? 'enrolled projects' : r.projects.join(', ') || 'no projects';

function describeRoutineChange(from: RoutineDef | null, to: RoutineDef | null): string {
  if (!from && to)
    return `New routine “${to.name}” at ${to.time}${to.days ? `, ${daysText(to.days)}` : ''} for ${who(to)}`;
  if (from && !to) return `Remove the routine “${from.name}”`;
  if (!from || !to) return 'No change';
  const parts: string[] = [];
  if (from.name !== to.name) parts.push(`renamed “${to.name}”`);
  if (from.time !== to.time) parts.push(`at ${from.time} → ${to.time}`);
  if (from.enabled !== to.enabled) parts.push(to.enabled ? 'on' : 'off');
  if (from.instructions !== to.instructions) parts.push('new instructions');
  if (JSON.stringify(from.projects) !== JSON.stringify(to.projects)) parts.push(`for ${who(to)}`);
  if (daysText(from.days) !== daysText(to.days))
    parts.push(`${daysText(from.days)} → ${daysText(to.days)}`);
  return `${from.name}: ${parts.join(', ') || 'no change'}`;
}

/** The value a change's field holds in `config` now (undefined when it isn't there). */
export function currentRoutinesValue(config: RoutinesConfig, change: RoutinesChange): unknown {
  switch (change.field) {
    case 'enrolled':
    case 'budget_usd':
    case 'hours':
      return config.projects.find((p) => p.name === change.project)?.[change.field];
    case 'machine':
      return config.projects.find((p) => p.name === change.project)?.machine ?? null;
    case 'schedule':
      return config.schedule?.[change.routine];
    case 'timezone':
      return config.schedule?.timezone;
    case 'dispatch':
      return config.dispatch?.[change.kind]?.[change.level];
    case 'routine':
      return routinesOf(config).find((r) => r.id === change.id) ?? null;
    case 'project':
      return config.projects.find((p) => p.name === change.name) ?? null;
  }
}
