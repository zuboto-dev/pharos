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
  runs?: Partial<Record<Routine, RoutineRun | null>>;
};

export type RoutinesPage = { url: string; date?: string; posted?: string };

/** GET /api/routines/state. */
export type RoutinesState =
  | {
      available: true;
      config: RoutinesConfig;
      status: RoutinesProjectStatus[];
      report: { text: string; date: string | null; when: string | null };
      pages: Partial<Record<'morning' | 'evening', RoutinesPage>>;
      /** The Routines computer's local time, `YYYY-MM-DDTHH:MM`. */
      now: string;
      url: string;
    }
  | { available: false; reason: string; url: string };

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM');
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
]);
export type RoutinesChange = z.infer<typeof RoutinesChange>;

/** POST /api/routines/save. */
export const RoutinesSave = z.object({ changes: z.array(RoutinesChange).min(1).max(200) });

/** POST /api/routines/run: one routine for one project, now. */
export const RoutinesRun = z.object({ routine: z.enum(ROUTINES), project: Name });

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
  }
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
  }
}
