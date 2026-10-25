import { z } from 'zod';
import { DECISION, DecisionItemsInput, DecisionOption, type DecisionItem } from './decisions.js';
import { TASK_DETAIL_FIELDS } from './task-details.js';

/**
 * The desk (R16, docs/reframe/r16-desk.md): everything waiting on the owner in every project, in
 * one list. Items are derived from decisions, review-desk sheets, tasks assigned to a person and
 * runs that need a look; nothing about an item is stored apart from the data it comes from.
 */

/** Waiting longer than this is overdue: the beta bar is nothing unseen for more than 48 hours. */
export const DESK_OVERDUE_HOURS = 48;

/** Waiting longer than this is old: the desk folds these away so today's items lead. */
export const DESK_OLD_DAYS = 14;

export const DESK_ITEM_KINDS = ['decision', 'sheet', 'task', 'run'] as const;
export type DeskItemKind = (typeof DESK_ITEM_KINDS)[number];

export type DeskItem = {
  /** The decision's, task's, run's id; a sheet's is `<viewId>#<sheetId>`. */
  id: string;
  kind: DeskItemKind;
  projectId?: string;
  project?: string;
  title: string;
  /** One line: what it needs from the owner. */
  ask?: string;
  minutes?: number;
  /** When it started waiting (ISO). */
  since: string;
  overdue: boolean;
  /** Waiting more than DESK_OLD_DAYS: likely forgotten, shown folded. */
  old: boolean;
  gate: boolean;
  /** Where it is answered in the web app. */
  href: string;
  /** What its relations say (relationLine): it builds on an open decision, one was decided
   * assuming it, or something it rests on changed after it was decided. */
  note?: string;
  /** A decision's options, so the desk can answer it in place. */
  options?: { id: string; label: string; asks?: string }[];
  recommendedOptionId?: string;
  /** Items the owner picks from, and the option (id) the selection goes with. */
  items?: { list: DecisionItem[]; appliesTo: string };
};

export const RUN_KINDS = ['night', 'routine', 'answer', 'other'] as const;
export const RUN_OUTCOMES = ['running', 'ok', 'partial', 'failed'] as const;

/** A run that happened without the owner: a night run, a routine, the answering agent. */
export type DeskRun = {
  id: string;
  projectId?: string;
  kind: (typeof RUN_KINDS)[number];
  name: string;
  agent: string;
  startedAt: string;
  endedAt?: string;
  outcome: (typeof RUN_OUTCOMES)[number];
  summary?: string;
  counts?: { done?: number; failed?: number; unverified?: number };
  viewId?: string;
  seenAt?: string;
};

export type Desk = {
  items: DeskItem[];
  /** Sum of the items' minutes (items without minutes add nothing). */
  minutes: number;
  overdue: number;
  old: number;
  /** The latest run of each name, newest first. */
  runs: DeskRun[];
  /** Reviews the owner handed back that no agent has picked up yet. */
  handBacks?: DeskHandBack[];
};

/**
 * A review the owner archived and handed back to an agent, with no agent change in its project
 * since (2026-10-23: one waited 7 hours unseen). The desk says so; a session's start hook prints
 * the ones for its folder.
 */
export type DeskHandBack = {
  viewId: string;
  view: string;
  projectId: string;
  project: string;
  /** The agent it was handed to, when one was named. */
  to?: string;
  /** When it was handed back (ISO). */
  since: string;
  /** The project's repository folder, so a session in that folder finds it. */
  folder?: string;
  href: string;
};

const Count = z.number().int().min(0).max(100_000);

/** A run report (MCP run_report, POST /api/runs): start one, or finish it with `id`. */
export const RunReport = z.strictObject({
  id: z.string().optional().describe('The run to finish or update; omit to start a new one'),
  projectId: z.string().optional().describe('The project it ran for; omit for one across projects'),
  kind: z.enum(RUN_KINDS).optional().describe('night, routine, answer or other (default other)'),
  name: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(
      'A stable name, e.g. "Night run" or "Morning report": the desk shows the latest per name',
    ),
  outcome: z
    .enum(RUN_OUTCOMES)
    .optional()
    .describe('running (default when starting), ok, partial or failed'),
  summary: z.string().max(300).optional().describe('One or two lines for the owner'),
  counts: z
    .strictObject({
      done: Count.optional(),
      failed: Count.optional(),
      unverified: Count.optional(),
    })
    .optional(),
  viewId: z.string().optional().describe('A page with the details, e.g. the morning report'),
});
export type RunReport = z.infer<typeof RunReport>;

/** One call to put something on the owner's desk (MCP ask_owner). */
export const AskOwner = z.strictObject({
  projectId: z.string(),
  title: z
    .string()
    .min(1)
    .max(200)
    .describe('What the owner decides or does, as a question or an action'),
  ask: z.string().max(400).optional().describe('One or two lines of context: why it needs them'),
  minutes: z.number().int().min(1).max(600).optional().describe('About how long it takes them'),
  gate: z
    .boolean()
    .optional()
    .describe(
      'Only they can do it (a secret, a payment, a push, personal data); a task is made high priority',
    ),
  options: z
    .array(DecisionOption)
    .min(2)
    .max(DECISION.maxOptions)
    .optional()
    .describe(
      'Choices: makes a decision the owner answers in one tap; without them it is a task for the owner',
    ),
  recommendedOptionId: z.string().optional(),
  items: DecisionItemsInput.optional().describe(
    'Items the choice applies to (e.g. the folders a cleanup would move): each {id, label, detail?}; the owner unticks the ones to keep, and their answer lists the ids they kept in items.selected (get the decision, or desk_list since). appliesTo: the option the selection goes with (default your recommendedOptionId)',
  ),
  dependsOn: z.array(z.string()).optional().describe('Decisions this builds on'),
  viewId: z.string().optional().describe('A page that explains it (the desk links there)'),
  // A task for the owner (no options): the steps and what makes it done are required in spirit
  // (a warning without them), what it leaves is optional.
  actions: TASK_DETAIL_FIELDS.actions.describe('A task: the steps for them, in order (required)'),
  acceptance: TASK_DETAIL_FIELDS.acceptance.describe('A task: "done when" checks (required)'),
  deliverables: TASK_DETAIL_FIELDS.deliverables,
  allowCommands: TASK_DETAIL_FIELDS.allowCommands,
});
export type AskOwner = z.infer<typeof AskOwner>;
