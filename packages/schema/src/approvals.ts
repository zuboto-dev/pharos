import { z } from 'zod';
import { optionOutcome, type DecisionOption } from './decisions.js';

/**
 * Standing approvals: the owner's rules for decisions that only need a yes. A rule names words
 * in a decision's question ("merge"), and Pharos answers a matching decision with the option the
 * agent recommended, as the owner, logged so it can be undone. Rules are an app setting the owner
 * changes in Settings (never revisions, never over MCP); every answer they give is a revision.
 *
 * A rule never answers a gate, a decision with items to pick (a cleanup), an option that asks for
 * a note, a recommendation that declines or puts off, or a question that sends, publishes, deletes
 * or pays (NEVER_WORDS): those stay the owner's.
 */

export const APPROVAL_RULES_SETTING = 'approvals.rules';
export const APPROVAL_LOG_SETTING = 'approvals.log';

export const APPROVAL = {
  maxRules: 30,
  nameChars: 60,
  maxWords: 8,
  wordChars: 40,
  maxWaitHours: 72,
  /** Answers kept in the log. */
  logSize: 300,
} as const;

/** Words that keep a decision with the owner whatever the rules say (charter gates). */
export const NEVER_WORDS = [
  'delete',
  'trash',
  'remove',
  'push',
  'publish',
  'send',
  'email',
  'pay',
  'payment',
  'buy',
  'sign up',
  'production',
  'prod',
  'secret',
  'password',
  'legal',
  'tax',
] as const;

export const ApprovalRule = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.string().trim().min(1).max(APPROVAL.nameChars),
    words: z
      .array(z.string().trim().toLowerCase().min(2).max(APPROVAL.wordChars))
      .min(1)
      .max(APPROVAL.maxWords)
      .describe('The question contains any of these (whole words)'),
    projectIds: z.array(z.string().min(1)).max(100).optional().describe('None: every project'),
    waitHours: z
      .number()
      .int()
      .min(0)
      .max(APPROVAL.maxWaitHours)
      .describe('How long a decision waits for the owner before the rule answers it'),
    enabled: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'ApprovalRule' });
export type ApprovalRule = z.infer<typeof ApprovalRule>;

/** What the Settings form sends to add or change a rule. */
export const ApprovalRuleInput = ApprovalRule.omit({ id: true, createdAt: true }).extend({
  id: ApprovalRule.shape.id.optional(),
});
export type ApprovalRuleInput = z.infer<typeof ApprovalRuleInput>;

export const ApprovalRules = z.array(ApprovalRule).max(APPROVAL.maxRules);

/** One answer a rule gave. */
export const ApprovalAnswer = z.strictObject({
  decisionId: z.string(),
  projectId: z.string(),
  title: z.string(),
  option: z.string(),
  ruleId: z.string(),
  rule: z.string(),
  revision: z.number().int(),
  at: z.string(),
  /** Set when the owner undid it: the rule never answers that decision again. */
  undoneAt: z.string().optional(),
});
export type ApprovalAnswer = z.infer<typeof ApprovalAnswer>;

/** The parts of a decision a rule looks at. */
export type RuleCandidate = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  gate?: boolean | undefined;
  options?: DecisionOption[] | undefined;
  recommendedOptionId?: string | undefined;
  chosenOptionId?: string | undefined;
  answer?: string | undefined;
  deferredUntil?: string | undefined;
  items?: unknown;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` has `word` as a whole word (or phrase), ignoring case. */
export function hasWord(text: string, word: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escape(word.toLowerCase())}($|[^\\p{L}\\p{N}])`,
    'u',
  ).test(text.toLowerCase());
}

/**
 * Why no rule may answer this decision, or undefined when one may: it must be open, carry a
 * recommendation that goes ahead without a note, and not be a gate, a pick of items, or a question
 * with one of NEVER_WORDS.
 */
export function approvalBlock(d: RuleCandidate): string | undefined {
  if (d.chosenOptionId || d.answer) return 'already answered';
  if (d.deferredUntil) return 'you put it off';
  if (d.gate) return 'a gate';
  if (d.items) return 'has items to pick';
  const option = d.options?.find((o) => o.id === d.recommendedOptionId);
  if (!option) return 'no recommendation';
  if (optionOutcome(option) !== 'go') return 'the recommendation is not a yes';
  if (option.asks) return 'the recommendation asks for a note';
  const never = NEVER_WORDS.find((w) => hasWord(d.title, w));
  if (never) return `mentions “${never}”`;
  return undefined;
}

/** The first enabled rule that answers this decision now, if any. */
export function matchingRule(
  rules: ApprovalRule[],
  d: RuleCandidate,
  now: Date,
): ApprovalRule | undefined {
  if (approvalBlock(d)) return undefined;
  return rules.find(
    (r) =>
      r.enabled &&
      (!r.projectIds?.length || r.projectIds.includes(d.projectId)) &&
      r.words.some((w) => hasWord(d.title, w)) &&
      (r.waitHours === 0 || now.getTime() - Date.parse(d.createdAt) >= r.waitHours * 3600_000),
  );
}

/** Words a suggestion may be about: approvals that rarely need more than a yes. */
export const SUGGEST_WORDS = ['merge', 'fast-forward', 'approve', 'allow', 'link', 'install'];

/** A rule Pharos suggests from how the owner answered. */
export type ApprovalSuggestion = {
  word: string;
  /** Decisions with the word the owner answered with the recommendation, and all answered. */
  followed: number;
  answered: number;
  /** 0 when they always took it; else long enough to answer first at their next look. */
  waitHours: number;
};

/** A suggestion's wait when the owner sometimes answered otherwise: about one check-in. */
export const SUGGEST_WAIT_HOURS = 10;

/** What GET /api/approvals returns. */
export type ApprovalsState = {
  rules: ApprovalRule[];
  /** Newest first: what rules answered in the last 7 days. */
  answers: ApprovalAnswer[];
  /** Per rule: the waiting decisions it would answer now, and later (still in its wait). */
  matches: Record<string, { id: string; projectId: string; title: string; at: string }[]>;
  suggestions: ApprovalSuggestion[];
  /** In the last 7 days: decisions you answered, and how many took the recommendation. */
  week: { answered: number; followed: number; byRules: number };
};
