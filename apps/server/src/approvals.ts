import { randomBytes } from 'node:crypto';
import {
  APPROVAL,
  APPROVAL_LOG_SETTING,
  APPROVAL_RULES_SETTING,
  ApprovalAnswer,
  ApprovalRuleInput,
  ApprovalRules,
  SUGGEST_WAIT_HOURS,
  SUGGEST_WORDS,
  addDays,
  approvalBlock,
  hasWord,
  localToday,
  matchingRule,
  meaningOf,
  type ApprovalRule,
  type ApprovalsState,
  type Author,
  type Entity,
  type RuleCandidate,
} from '@pharos/schema';
import { deskAnswer } from './desk.js';
import { PharosError } from './store/errors.js';
import type { Store } from './store/store.js';

/**
 * Standing approvals (packages/schema/src/approvals.ts): the owner's rules answer decisions that
 * only need a yes, with the agent's recommendation, as the owner, one revision each. `sweep` runs
 * after every commit and on a timer (for rules that wait, and for other processes' writes); it
 * never throws. A decision a rule answered is logged, and never answered by a rule again once the
 * owner undoes it.
 */
export class StandingApprovals {
  private sweeping = false;

  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  rules(): ApprovalRule[] {
    const parsed = ApprovalRules.safeParse(this.store.setting(APPROVAL_RULES_SETTING) ?? []);
    return parsed.success ? parsed.data : [];
  }

  log(): ApprovalAnswer[] {
    const raw = this.store.setting<unknown[]>(APPROVAL_LOG_SETTING) ?? [];
    return raw.flatMap((r) => {
      const parsed = ApprovalAnswer.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    });
  }

  /** Adds a rule, or changes the one with its id. */
  saveRule(raw: unknown): ApprovalRule {
    const input = ApprovalRuleInput.parse(raw);
    const words = [...new Set(input.words)];
    const rules = this.rules();
    const existing = input.id ? rules.find((r) => r.id === input.id) : undefined;
    if (input.id && !existing) throw new PharosError('not_found', `No rule ${input.id}`);
    if (!existing && rules.length >= APPROVAL.maxRules)
      throw new PharosError('invalid', `At most ${APPROVAL.maxRules} rules`);
    const rule: ApprovalRule = {
      id: existing?.id ?? `rule-${randomBytes(4).toString('hex')}`,
      name: input.name,
      words,
      ...(input.projectIds?.length ? { projectIds: input.projectIds } : {}),
      waitHours: input.waitHours,
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? this.now().toISOString(),
    };
    this.store.setSetting(
      APPROVAL_RULES_SETTING,
      existing ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule],
    );
    this.sweep();
    return rule;
  }

  removeRule(id: string): void {
    const rules = this.rules();
    if (!rules.some((r) => r.id === id)) throw new PharosError('not_found', `No rule ${id}`);
    this.store.setSetting(
      APPROVAL_RULES_SETTING,
      rules.filter((r) => r.id !== id),
    );
  }

  /** Open decisions with a recommendation in active projects, as rules see them. */
  private candidates(): RuleCandidate[] {
    const answered = new Set(this.log().map((a) => a.decisionId));
    const projects = new Map(
      this.store
        .list('project')
        .filter((p) => p.data.status !== 'archived' && p.data.status !== 'done')
        .map((p) => [p.id, p]),
    );
    const out: RuleCandidate[] = [];
    for (const d of this.store.list('decision')) {
      const project = projects.get(d.data.projectId);
      if (!project || answered.has(d.id) || !d.data.recommendedOptionId) continue;
      const meaning = meaningOf(project, 'decision.status', d.data.status);
      if (meaning === 'superseded' || meaning === 'rejected' || meaning === 'accepted') continue;
      out.push(candidateOf(d));
    }
    return out;
  }

  /** Answers every decision (or just `onlyId`) a rule matches now. Never throws; returns what it answered. */
  sweep(onlyId?: string): ApprovalAnswer[] {
    if (this.sweeping) return [];
    this.sweeping = true;
    const made: ApprovalAnswer[] = [];
    try {
      const rules = this.rules().filter((r) => r.enabled);
      if (!rules.length) return made;
      const now = this.now();
      for (const d of this.candidates()) {
        if (onlyId && d.id !== onlyId) continue;
        const rule = matchingRule(rules, d, now);
        if (!rule) continue;
        try {
          made.push(this.answer(rule, d, now));
        } catch (error) {
          console.error(
            `[pharos] Standing approval “${rule.name}” could not answer ${d.id}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error('[pharos] Standing approvals failed:', error);
    } finally {
      this.sweeping = false;
    }
    return made;
  }

  private answer(rule: ApprovalRule, d: RuleCandidate, now: Date): ApprovalAnswer {
    const author: Author = { kind: 'human', name: `rule: ${rule.name}` };
    const result = deskAnswer(
      this.store,
      author,
      { id: d.id, chosenOptionId: d.recommendedOptionId!, via: `Standing approval “${rule.name}”` },
      now,
    );
    const entry: ApprovalAnswer = {
      decisionId: d.id,
      projectId: d.projectId,
      title: d.title,
      option: d.options!.find((o) => o.id === d.recommendedOptionId)!.label,
      ruleId: rule.id,
      rule: rule.name,
      revision: result.revision?.id ?? this.store.latestRevisionId(),
      at: now.toISOString(),
    };
    this.store.setSetting(APPROVAL_LOG_SETTING, [entry, ...this.log()].slice(0, APPROVAL.logSize));
    return entry;
  }

  /** An ask's result, with the rule's answer when one answered it at once (ask_owner). */
  withAnswer<T extends { id: string; kind: 'decision' | 'task' }>(asked: T) {
    if (asked.kind !== 'decision') return asked;
    this.sweep(asked.id);
    const answer = this.answerOf(asked.id);
    return answer
      ? {
          ...asked,
          answered: {
            option: answer.option,
            rule: answer.rule,
            next: `The owner's standing approval “${answer.rule}” chose “${answer.option}”: go ahead now.`,
          },
        }
      : asked;
  }

  /** The answer a rule gave this decision, if one did (and the owner didn't undo it). */
  answerOf(decisionId: string): ApprovalAnswer | undefined {
    return this.log().find((a) => a.decisionId === decisionId && !a.undoneAt);
  }

  /** Undoes a rule's answer: the decision is open again and on the desk, for the owner only. */
  undo(decisionId: string, author: Author): ApprovalAnswer {
    const log = this.log();
    const entry = log.find((a) => a.decisionId === decisionId && !a.undoneAt);
    if (!entry) throw new PharosError('not_found', `No rule answered ${decisionId}`);
    this.store.revert(
      entry.revision,
      author,
      `Undo standing approval “${entry.rule}”: ${entry.title}`,
    );
    const undone = { ...entry, undoneAt: this.now().toISOString() };
    this.store.setSetting(
      APPROVAL_LOG_SETTING,
      log.map((a) => (a === entry ? undone : a)),
    );
    return undone;
  }

  state(): ApprovalsState {
    const now = this.now();
    const rules = this.rules();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const answers = this.log().filter((a) => a.at >= weekAgo);
    const candidates = this.candidates().filter((d) => !approvalBlock(d));
    const matches: ApprovalsState['matches'] = {};
    for (const rule of rules)
      matches[rule.id] = candidates
        .filter((d) => matchingRule([{ ...rule, enabled: true, waitHours: 0 }], d, now))
        .map((d) => ({ id: d.id, projectId: d.projectId, title: d.title, at: d.createdAt }));
    return { rules, answers, matches, ...this.history(rules, now) };
  }

  /**
   * How the owner answered decisions a rule could have answered (open-ended structure aside): the
   * last 7 days' counts, and words they nearly always answered with the recommendation (30 days),
   * which no enabled rule covers yet.
   */
  private history(rules: ApprovalRule[], now: Date) {
    const today = localToday(now);
    const byRules = new Set(this.log().map((a) => a.decisionId));
    const answered = this.store
      .list('decision')
      .filter(
        (d) =>
          d.data.options?.length &&
          d.data.recommendedOptionId &&
          (d.data.chosenOptionId || d.data.answer) &&
          d.data.decisionDate &&
          !byRules.has(d.id),
      );
    const recent = (days: number) =>
      answered.filter((d) => d.data.decisionDate! > addDays(today, -days));
    const followed = (d: Entity<'decision'>) =>
      d.data.chosenOptionId === d.data.recommendedOptionId;
    const week = recent(7);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const covered = (word: string) =>
      rules.some((r) => r.enabled && r.words.some((w) => w === word));
    // Only decisions a rule may answer at all count towards a suggestion.
    const eligible = recent(30).filter((d) => {
      const open = { ...candidateOf(d), chosenOptionId: undefined, answer: undefined };
      return !approvalBlock(open);
    });
    const suggestions = SUGGEST_WORDS.filter((w) => !covered(w)).flatMap((word) => {
      const about = eligible.filter((d) => hasWord(d.data.title, word));
      const n = about.filter(followed).length;
      // Mostly a yes: a rule that waits about one check-in still saves the owner the tap.
      if (about.length < 3 || n / about.length < 0.75) return [];
      const waitHours = n === about.length ? 0 : SUGGEST_WAIT_HOURS;
      return [{ word, followed: n, answered: about.length, waitHours }];
    });
    return {
      suggestions: suggestions.sort((a, b) => b.answered - a.answered),
      week: {
        answered: week.length,
        followed: week.filter(followed).length,
        byRules: this.log().filter((a) => a.at >= weekAgo && !a.undoneAt).length,
      },
    };
  }
}

function candidateOf(d: Entity<'decision'>): RuleCandidate {
  return {
    id: d.id,
    projectId: d.data.projectId,
    title: d.data.title,
    createdAt: d.createdAt,
    gate: d.data.gate,
    options: d.data.options,
    recommendedOptionId: d.data.recommendedOptionId,
    chosenOptionId: d.data.chosenOptionId,
    answer: d.data.answer,
    deferredUntil: d.data.deferredUntil,
    items: d.data.items,
  };
}
