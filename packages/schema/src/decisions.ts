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
  /** Items the owner picks from (a cleanup's folders): how many, and how long each line is. */
  maxItems: 200,
  itemIdChars: 200,
  itemLabelChars: 200,
  itemDetailChars: 300,
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

/** One thing the owner can leave out of a choice: a folder to clean up, a file to send. */
export const DecisionItem = z
  .strictObject({
    id: z
      .string()
      .regex(/^[A-Za-z0-9._:/-]{1,200}$/)
      .describe('Stable, e.g. a path'),
    label: z.string().min(1).max(DECISION.itemLabelChars),
    detail: z
      .string()
      .min(1)
      .max(DECISION.itemDetailChars)
      .optional()
      .describe('e.g. "312 MB · 9 days old"'),
  })
  .meta({ id: 'DecisionItem' });
export type DecisionItem = z.infer<typeof DecisionItem>;

const ITEMS_LIST = z.array(DecisionItem).min(1).max(DECISION.maxItems);
const ITEMS_APPLIES_TO = z
  .string()
  .regex(/^[a-z0-9-]{1,24}$/)
  .optional()
  .describe('Option it goes with (default: recommended)');

/**
 * Items a choice applies to (a cleanup's folders): the owner unticks the ones to keep, and
 * choosing `appliesTo` records the ticked ids as `selected` with the choice. Agents set the list
 * and appliesTo; only the owner's choice sets selected.
 */
export const DecisionItems = z
  .strictObject({
    list: ITEMS_LIST,
    appliesTo: ITEMS_APPLIES_TO,
    selected: z
      .array(z.string().min(1).max(DECISION.itemIdChars))
      .max(DECISION.maxItems)
      .optional()
      .describe('Owner only: ids kept'),
  })
  .meta({ id: 'DecisionItems' });
export type DecisionItems = z.infer<typeof DecisionItems>;

/** What an agent sends (ask_owner): the list and the option it applies to. */
export const DecisionItemsInput = z.strictObject({ list: ITEMS_LIST, appliesTo: ITEMS_APPLIES_TO });

/** The option a decision's item selection goes with: appliesTo, else the recommended option. */
export function itemsOptionId(data: {
  items?: Partial<DecisionItems> | undefined;
  recommendedOptionId?: string | undefined;
  options?: Pick<DecisionOption, 'id' | 'label' | 'outcome'>[] | undefined;
}): string | undefined {
  if (!data.items) return undefined;
  return (
    data.items.appliesTo ??
    data.recommendedOptionId ??
    data.options?.find((o) => optionOutcome(o) === 'go')?.id
  );
}

const SIZE = /(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB)\b/i;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * The total size of some items when every one of them names a size in its detail ("312 MB · …"),
 * as "280 MB"; undefined when one doesn't, so the count stands alone.
 */
export function itemsSize(list: DecisionItem[]): string | undefined {
  if (!list.length) return undefined;
  let bytes = 0;
  for (const item of list) {
    const m = item.detail?.match(SIZE);
    if (!m) return undefined;
    bytes += Number(m[1]!.replace(',', '.')) * 1024 ** UNITS.indexOf(m[2]!.toUpperCase());
  }
  let unit = 0;
  while (bytes >= 1024 && unit < UNITS.length - 1) {
    bytes /= 1024;
    unit++;
  }
  const n = bytes >= 100 || unit === 0 ? Math.round(bytes) : Math.round(bytes * 10) / 10;
  return `${n} ${UNITS[unit]}`;
}

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
  items: DecisionItems.optional().describe(
    'What the choice applies to (e.g. folders to clean up); the owner unticks some',
  ),
};

type DecisionLike = {
  options?: DecisionOption[];
  recommendedOptionId?: string;
  recommendationReason?: string;
  chosenOptionId?: string;
  note?: string;
  answer?: string;
  deferredUntil?: string;
  items?: DecisionItems;
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
  if (data.items) {
    const listed = new Set<string>();
    for (const item of data.items.list) {
      if (listed.has(item.id)) issues.push(`items: id "${item.id}" is used twice`);
      listed.add(item.id);
    }
    const { appliesTo, selected } = data.items;
    if (appliesTo !== undefined && !seen.has(appliesTo))
      issues.push(`items.appliesTo: "${appliesTo}" isn't one of the options${known}`);
    if (selected) {
      const target = itemsOptionId(data);
      if (data.chosenOptionId === undefined || data.chosenOptionId !== target)
        issues.push(
          `items.selected: a selection goes with choosing "${target ?? '?'}", the option the items apply to`,
        );
      const picked = new Set<string>();
      for (const id of selected) {
        if (!listed.has(id)) issues.push(`items.selected: "${id}" isn't one of the items`);
        else if (picked.has(id)) issues.push(`items.selected: "${id}" is listed twice`);
        picked.add(id);
      }
    }
  }
  return issues;
}

/** Things to fix in a proposed decision that don't block the save (apply and preview warnings). */
const LOCAL_FILE =
  /file:\/\/\S+|(?:\/private)?\/tmp\/\S+|\bscratchpad\b\S*|(?:~|\/Users\/[^\s/]+)\/\S+\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|wav|mp3|html?|pdf)\b/i;

/**
 * The first place in a text that points the owner at a file on the agent's computer (a temp
 * folder, a scratchpad, a picture on disk). The owner reads Pharos, which can't open it: the
 * R1 fidelity decision asked to "review the screenshots" at such a path (2026-10-23).
 */
export function localFileMention(text: string | undefined): string | undefined {
  return text?.match(LOCAL_FILE)?.[0];
}

/** The warning for a text the owner reads that points at a file on the agent's computer. */
export function localFileWarning(text: string | undefined): string | undefined {
  const at = localFileMention(text);
  return at
    ? `points the owner at a file on this computer (${at.slice(0, 60)}), which Pharos can't open: upload the pictures (report_asset_put) and show them in the page's sheet that asks it, or link the Pharos page`
    : undefined;
}

export function decisionWarnings(data: DecisionLike & { body?: string }): string[] {
  const out: string[] = [];
  const local = localFileWarning(data.body);
  if (local) out.push(local);
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

/** Whole answers that put a decision off or decline it; a longer label ("Cancel the membership",
 * "Wait for the M5 model") is an option of its own, so it counts as go. */
const LATER_LABELS = new Set([
  'not now',
  'not yet',
  'later',
  'hold',
  'hold off',
  'wait',
  'postpone',
  'defer',
  'decide later',
  'ask again',
  'ask me again',
]);
const DECLINE_LABELS = new Set([
  'no',
  'none',
  'neither',
  'decline',
  'reject',
  'skip',
  'cancel',
  "don't",
  'do not',
  'leave as is',
  'leave it as is',
  'keep as is',
  'keep it as is',
  'keep it as it is',
  'stay as is',
]);

/**
 * What choosing an option means: its `outcome` when the agent set one, else read from a label
 * that is only such an answer ("Not now", "Hold" → later; "No", "Leave as is" → decline), with a
 * reason after a comma or dash allowed ("No, keep it"); anything else is go.
 */
export function optionOutcome(option: Pick<DecisionOption, 'label' | 'outcome'>): OptionOutcome {
  if (option.outcome) return option.outcome;
  const label = option.label
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/\s*[,;:—–(]|\s+-\s+/)[0]!
    .replace(/[.!?]+$/, '')
    .trim();
  if (LATER_LABELS.has(label)) return 'later';
  if (DECLINE_LABELS.has(label)) return 'decline';
  return 'go';
}

/** The fields a person's answer writes on a decision (null removes one). */
export type DecisionPatch = {
  chosenOptionId: string | null;
  note: string | null;
  answer: string | null;
  deferredUntil: string | null;
  status: string;
  decidedById: string | null;
  decisionDate: string | null;
  items?: DecisionItems;
};

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
    /** The decision's items and the target option (itemsOptionId), when it has items. */
    items?: DecisionItems | undefined;
    itemsOptionId?: string | undefined;
    /** The ids the person kept ticked (default: all), recorded when they choose the target. */
    selected?: string[] | undefined;
  },
): DecisionPatch {
  const outcome = optionOutcome(option);
  const items = input.items
    ? {
        items:
          outcome !== 'later' && option.id === input.itemsOptionId
            ? { ...input.items, selected: input.selected ?? input.items.list.map((i) => i.id) }
            : withoutSelection(input.items),
      }
    : {};
  if (outcome === 'later')
    return {
      ...items,
      chosenOptionId: null,
      note: null,
      answer: null,
      deferredUntil: addDays(input.today, LATER_DAYS),
      status: input.status('proposed'),
      decidedById: null,
      decisionDate: null,
    };
  return {
    ...items,
    chosenOptionId: option.id,
    note: input.note || null,
    answer: null,
    deferredUntil: null,
    status: input.status(outcome === 'decline' ? 'rejected' : 'accepted'),
    decidedById: input.decidedById,
    decisionDate: input.today,
  };
}

/** The items without the owner's selection (a reopen, another option, a decline). */
export function withoutSelection(items: DecisionItems): DecisionItems {
  const rest = { ...items };
  delete rest.selected;
  return rest;
}

/** "5 of 7": how many of a decision's items a selection keeps. */
export function selectionCount(items: DecisionItems, selected: string[] = items.selected ?? []) {
  return `${selected.length} of ${items.list.length}`;
}

/** The answer a decline records; a reason follows after ": ". */
export const DECLINED = 'Declined';
/** Room for a decline's reason within an answer (DECISION.answerChars). */
export const DECLINE_REASON_CHARS = DECISION.answerChars - DECLINED.length - 2;

/** Whether a decision was declined with Decline (any decision, whatever its options). */
export function isDeclined(data: { answer?: string | null | undefined }): boolean {
  return data.answer === DECLINED || Boolean(data.answer?.startsWith(`${DECLINED}: `));
}

/** The reason a decline gave, if any. */
export function declineReason(answer: string): string | undefined {
  return answer.startsWith(`${DECLINED}: `) ? answer.slice(DECLINED.length + 2) : undefined;
}

/**
 * The update Decline makes on any decision, with or without a "no" among its options: rejected,
 * decided by the person today, the reason kept as the answer ("Declined: too early").
 */
export function declineUpdate(input: {
  reason?: string;
  today: string;
  decidedById: string;
  status: (meaning: 'rejected') => string;
  /** The decision's items, so a selection from an earlier choice goes with it. */
  items?: DecisionItems | undefined;
}): DecisionPatch {
  const reason = input.reason?.trim().slice(0, DECLINE_REASON_CHARS);
  return {
    ...(input.items ? { items: withoutSelection(input.items) } : {}),
    chosenOptionId: null,
    note: null,
    answer: reason ? `${DECLINED}: ${reason}` : DECLINED,
    deferredUntil: null,
    status: input.status('rejected'),
    decidedById: input.decidedById,
    decisionDate: input.today,
  };
}

/** The revision message for a decline. */
export function declineMessage(question: string, reason?: string): string {
  return `Decline “${question}”${reason?.trim() ? `: ${reason.trim()}` : ''}`;
}

/** The revision message for a choice. */
export function choiceMessage(
  option: DecisionOption,
  question: string,
  note?: string,
  today?: string,
  /** "5 of 7" when the choice goes with a selection of the decision's items. */
  selection?: string,
): string {
  if (optionOutcome(option) === 'later')
    // The note a later choice may carry stays in the history (the decision keeps no choice).
    return `Later (${today ? addDays(today, LATER_DAYS) : `${LATER_DAYS} days`}): “${question}” (chose “${option.label}”${note ? `: ${note}` : ''})`;
  return `Choose “${option.label}”: ${selection ? `${selection} · ` : ''}${question}${note ? ` (${note})` : ''}`;
}
