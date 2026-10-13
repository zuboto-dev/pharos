import { z } from 'zod';

/**
 * A decision the owner makes on a page (R10.19): the question (the decision's title), 2–5
 * options with what each leads to, the agent's recommendation and why, and the owner's answer:
 * one of the options, an answer of their own, or "later". Agents propose; only a person chooses
 * (Store.apply refuses an agent's choice, answer or deferral).
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
} as const;

/** The fields only a person writes: the choice, an own answer, and a deferral. */
export const OWNER_DECISION_FIELDS = ['chosenOptionId', 'answer', 'deferredUntil'] as const;

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
    issues.push('chosenOptionId and answer: choose an option or write an answer, not both');
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
  | { kind: 'chosen'; option: DecisionOption }
  | { kind: 'answered'; answer: string }
  | { kind: 'deferred'; until: string }
  | { kind: 'open' };

/** Where a decision stands: chosen, answered in the owner's words, deferred, or open. */
export function decisionState(data: DecisionLike): DecisionState {
  const option = data.chosenOptionId
    ? data.options?.find((o) => o.id === data.chosenOptionId)
    : undefined;
  if (option) return { kind: 'chosen', option };
  if (data.answer) return { kind: 'answered', answer: data.answer };
  if (data.deferredUntil) return { kind: 'deferred', until: data.deferredUntil };
  return { kind: 'open' };
}
