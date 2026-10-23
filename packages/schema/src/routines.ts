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
export const RoutineDef = z.object({
  id: z.string().regex(ROUTINE_ID, 'an id of a-z, 0-9 and -'),
  name: z.string().trim().min(1).max(60),
  time: Time,
  enabled: z.boolean(),
  skill: z.string().max(40).optional(),
  instructions: z.string().max(2000),
  projects: z.union([z.literal('enrolled'), z.array(z.string().min(1).max(120)).max(100)]),
});
export type RoutineDef = z.infer<typeof RoutineDef>;

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
};

export type RoutinesConfig = {
  schedule: Partial<Record<Routine, string>> & { timezone?: string };
  master: { model: string; effort: string };
  dispatch: Record<string, Partial<Record<Difficulty, string>>>;
  cleanup?: { level?: number; scratch_days?: number };
  projects: RoutinesProject[];
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
  if (!from && to) return `New routine “${to.name}” at ${to.time} for ${who(to)}`;
  if (from && !to) return `Remove the routine “${from.name}”`;
  if (!from || !to) return 'No change';
  const parts: string[] = [];
  if (from.name !== to.name) parts.push(`renamed “${to.name}”`);
  if (from.time !== to.time) parts.push(`at ${from.time} → ${to.time}`);
  if (from.enabled !== to.enabled) parts.push(to.enabled ? 'on' : 'off');
  if (from.instructions !== to.instructions) parts.push('new instructions');
  if (JSON.stringify(from.projects) !== JSON.stringify(to.projects)) parts.push(`for ${who(to)}`);
  return `${from.name}: ${parts.join(', ') || 'no change'}`;
}

/** The value a change's field holds in `config` now (undefined when it isn't there). */
export function currentRoutinesValue(config: RoutinesConfig, change: RoutinesChange): unknown {
  switch (change.field) {
    case 'enrolled':
    case 'budget_usd':
    case 'hours':
      return config.projects.find((p) => p.name === change.project)?.[change.field];
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
