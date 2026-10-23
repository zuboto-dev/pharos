import { z } from 'zod';
import { addDays } from './views/dates.js';

/**
 * A decision the owner makes on a page (R10.19): the question (the decision's title), 2–5
 * options with what each leads to, the agent's recommendation and why, and the owner's answer:
 * one of the options (with a note of theirs if they like), an answer of their own, or "later".
 * Agents propose; only a person chooses (Store.apply refuses an agent's choice, note, answer or
 * deferral). An option can ask for the note when it's chosen ("Which steps failed?").
 */

/** Limits for a decision's options; the schema keeps them short so the apply schema stays small. */
export const DECISION = {
  minOptions: 2,
  maxOptions: 5,
  labelChars: 60,
  summaryChars: 160,
  /** Pros and cons per option, each a few words. */
  maxPoints: 3,
  pointChars: 60,
  maxClaims: 4,
  reasonChars: 200,
  answerChars: 300,
  /** The question an option asks when it's chosen, and the note that answers it. */
  asksChars: 160,
  noteChars: 2000,
} as const;

/** The fields only a person writes: the choice, an own answer, and a deferral. */
export const OWNER_DECISION_FIELDS = ['chosenOptionId', 'note', 'answer', 'deferredUntil'] as const;

const Point = z.string().min(1).max(DECISION.pointChars);

export const DecisionOption = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9-]{1,24}$/)
      .describe('Short key, e.g. "a"'),
    label: z.string().min(1).max(DECISION.labelChars),
    summary: z.string().min(1).max(DECISION.summaryChars).optional().describe('What it leads to'),
    claimIds: z.array(z.string().min(1)).max(DECISION.maxClaims).optional().describe('Its sources'),
    pros: z.array(Point).max(DECISION.maxPoints).optional(),
    cons: z.array(Point).max(DECISION.maxPoints).optional(),
    asks: z
      .string()
      .min(1)
      .max(DECISION.asksChars)
      .optional()
      .describe(
        'Ask the owner to write a note when they choose this option, e.g. "Which steps failed, and what did you see?"; the note is required for it',
      ),
    outcome: z
      .enum(['go', 'decline', 'later'])
      .optional()
      .describe(
        'What choosing it means: go (default: the decision is accepted), decline ("No", "Leave as is": rejected), later ("Not now": back on the desk in a week)',
      ),
  })
  .meta({ id: 'DecisionOption' });
export type DecisionOption = z.infer<typeof DecisionOption>;

/** The decision fields R10.19 adds, spread into DecisionData. */
export const DECISION_CHOICE_FIELDS = {
  options: z
    .array(DecisionOption)
    .max(DECISION.maxOptions)
    .optional()
    .describe('2–5 options for the owner to choose from (a DecisionBlock shows them)'),
  recommendedOptionId: z.string().min(1).optional().describe('Your pick'),
  recommendationReason: z.string().min(1).max(DECISION.reasonChars).optional(),
  chosenOptionId: z.string().min(1).optional().describe('Set by the owner only'),
  note: z
    .string()
    .min(1)
    .max(DECISION.noteChars)
    .optional()
    .describe('Owner only: their note with the option they chose (what went wrong, a condition)'),
  answer: z
    .string()
    .min(1)
    .max(DECISION.answerChars)
    .optional()
    .describe("Owner only: an answer that isn't an option"),
  deferredUntil: z.iso.date().optional().describe('Owner only'),
};

type DecisionLike = {
  options?: DecisionOption[];
  recommendedOptionId?: string;
  recommendationReason?: string;
  chosenOptionId?: string;
  note?: string;
  answer?: string;
  deferredUntil?: string;
};

/** Problems that make a decision's choice data inconsistent; the store refuses these. */
export function decisionIssues(data: DecisionLike): string[] {
  const issues: string[] = [];
  const ids = (data.options ?? []).map((o) => o.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push(`options: id "${id}" is used twice`);
    seen.add(id);
  }
  const known = ids.length ? ` (${ids.join(', ')})` : ' (there are no options)';
  for (const field of ['recommendedOptionId', 'chosenOptionId'] as const) {
    const value = data[field];
    if (value !== undefined && !seen.has(value))
      issues.push(`${field}: "${value}" isn't one of the options${known}`);
  }
  if (data.chosenOptionId !== undefined && data.answer !== undefined)
    issues.push(
      'chosenOptionId and answer: choose an option or write an answer, not both (a note goes in note)',
    );
  if (data.note !== undefined && data.chosenOptionId === undefined)
    issues.push('note: a note goes with a chosen option; an answer of their own goes in answer');
  return issues;
}

/** Things to fix in a proposed decision that don't block the save (apply and preview warnings). */
export function decisionWarnings(data: DecisionLike): string[] {
  const out: string[] = [];
  const n = data.options?.length ?? 0;
  if (n < DECISION.minOptions)
    out.push(
      `has ${n} option${n === 1 ? '' : 's'}; give ${DECISION.minOptions}–${DECISION.maxOptions} so the owner can choose`,
    );
  if (n && !data.recommendedOptionId)
    out.push('has no recommendedOptionId; mark the option you recommend');
  else if (data.recommendedOptionId && !data.recommendationReason)
    out.push('has no recommendationReason; say in one line why you recommend it');
  return out;
}

export type DecisionState =
  | { kind: 'chosen'; option: DecisionOption; note?: string }
  | { kind: 'answered'; answer: string }
  | { kind: 'deferred'; until: string }
  | { kind: 'open' };

/** Where a decision stands: chosen, answered in the owner's words, deferred, or open. */
export function decisionState(data: DecisionLike): DecisionState {
  const option = data.chosenOptionId
    ? data.options?.find((o) => o.id === data.chosenOptionId)
    : undefined;
  if (option) return { kind: 'chosen', option, ...(data.note ? { note: data.note } : {}) };
  if (data.answer) return { kind: 'answered', answer: data.answer };
  if (data.deferredUntil) return { kind: 'deferred', until: data.deferredUntil };
  return { kind: 'open' };
}

export type OptionOutcome = 'go' | 'decline' | 'later';

/** How long a "later" option puts a decision off: it comes back on the desk that day. */
export const LATER_DAYS = 7;

const LATER_LABEL =
  /^(?:not now|not yet|later|hold|wait|postpone|defer|decide later|ask (?:me )?again)\b/i;
const DECLINE_LABEL =
  /^(?:no\b|none\b|decline|reject|don['’]?t\b|do not\b|skip\b|cancel\b|drop\b|(?:leave|keep|stay)(?: it)? as (?:it )?is\b)/i;

/**
 * What choosing an option means: its `outcome` when the agent set one, else read from its label
 * ("Not now", "Hold" → later; "No", "Leave as is", "Keep it as it is" → decline), else go.
 */
export function optionOutcome(option: Pick<DecisionOption, 'label' | 'outcome'>): OptionOutcome {
  if (option.outcome) return option.outcome;
  const label = option.label.trim();
  if (LATER_LABEL.test(label)) return 'later';
  if (DECLINE_LABEL.test(label)) return 'decline';
  return 'go';
}

/**
 * The update a person's choice makes, so status, who and when always agree with the choice (the
 * page's block, the details panel and the desk share it): go → accepted, decline → rejected,
 * both decided by them today; later → still proposed, back on the desk in LATER_DAYS days.
 */
export function choiceUpdate(
  option: DecisionOption,
  input: {
    note?: string;
    /** YYYY-MM-DD, the person's today. */
    today: string;
    decidedById: string;
    /** The project's status value for a meaning (valueFor(project, 'decision.status', …)). */
    status: (meaning: 'proposed' | 'accepted' | 'rejected') => string;
  },
): Record<string, string | null> {
  const outcome = optionOutcome(option);
  if (outcome === 'later')
    return {
      chosenOptionId: null,
      note: null,
      answer: null,
      deferredUntil: addDays(input.today, LATER_DAYS),
      status: input.status('proposed'),
      decidedById: null,
      decisionDate: null,
    };
  return {
    chosenOptionId: option.id,
    note: input.note || null,
    answer: null,
    deferredUntil: null,
    status: input.status(outcome === 'decline' ? 'rejected' : 'accepted'),
    decidedById: input.decidedById,
    decisionDate: input.today,
  };
}

/** The revision message for a choice. */
export function choiceMessage(
  option: DecisionOption,
  question: string,
  note?: string,
  today?: string,
): string {
  if (optionOutcome(option) === 'later')
    return `Later (${today ? addDays(today, LATER_DAYS) : `${LATER_DAYS} days`}): “${question}” (chose “${option.label}”)`;
  return `Choose “${option.label}”: ${question}${note ? ` (${note})` : ''}`;
}
