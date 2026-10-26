/**
 * A project's pulse: where it stands, worked out by Pharos from its records and history, never
 * written by an agent. GET /api/pulse returns one per active project; the home page shows them
 * side by side and the project page shows its own above the views.
 */

/** Days of finished tasks a pulse charts, oldest first. */
export const PULSE_DAYS = 14;

export type ProjectPulse = {
  projectId: string;
  project: string;
  /** The current stage, with its target date and days left (negative: passed). */
  stage?: { name: string; targetDate?: string; daysLeft?: number; index: number; of: number };
  goals: { open: number; achieved: number };
  tasks: {
    open: number;
    inProgress: number;
    review: number;
    blocked: number;
    /** Finished and added in the last 7 days. */
    doneWeek: number;
    addedWeek: number;
  };
  /** Tasks finished each day, PULSE_DAYS days, oldest first, today last. */
  doneByDay: number[];
  /** What waits on the owner (the desk): how many, the oldest, gates among them. */
  waiting: { count: number; gates: number; oldestSince?: string };
  /** Decisions the owner's standing approvals answered in the last 7 days. */
  byRules: number;
  /** Runs going on now. */
  running: { name: string; since: string }[];
  /** The newest change. */
  last?: { at: string; who: string; message: string };
};

export type Pulse = { today: string; projects: ProjectPulse[] };
