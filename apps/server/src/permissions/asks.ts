import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  PermissionAsk,
  PermissionAskAnswer,
  PermissionAskDecision,
  PermissionAskInput,
  PermissionAskStatus,
  PermissionPreview,
  PermissionTarget,
} from '@pharos/schema';
import { PharosError } from '../store/errors.js';
import { explain } from './explain.js';
import { example, ruleFor } from './rules.js';
import { checkScope, type PermissionService } from './service.js';
import { scopesFor } from './scopes.js';
import { readSession } from './transcripts.js';

/**
 * Live permission asks (the Claude Code `PermissionRequest` hook): an agent is about to ask the
 * owner for permission; the hook tells Pharos and waits a short while for the owner's answer here.
 *
 * Kept in memory only (like presence): an ask lives as long as the hook waits, and a few answered
 * ones stay for the page. Answers are the owner's alone (the routes check), and "Allow always" goes
 * through the same preview, backup and Undo as the Permissions page.
 */

/** How long the hook waits for an answer before Claude Code asks in the terminal. */
export const ASK_WAIT_MS = 60_000;
/** Asks kept after they're answered or expired, for the page. */
const KEPT = 20;

/** Routines that run with nobody at the terminal (scheduled night, morning and wrap-up runs). */
export const UNATTENDED_ROUTINES = new Set(['/nightshift', '/daybreak', '/wrapup']);

type Session = { label: string; unattended: boolean };

/**
 * Whether nobody can answer a prompt in this session: `permission_mode: dontAsk`, a headless entry
 * point (`sdk-…`, from the hook's environment or the transcript), or one of the unattended
 * routines (for a subagent, its parent session's). When unsure: interactive.
 */
export function isUnattended(
  input: Pick<PermissionAskInput, 'permission_mode' | 'entrypoint'>,
  session: { headless: boolean; routine?: string } | undefined,
): boolean {
  if (input.permission_mode === 'dontAsk') return true;
  if (input.entrypoint?.startsWith('sdk')) return true;
  if (!session) return false;
  return (
    session.headless || (session.routine !== undefined && UNATTENDED_ROUTINES.has(session.routine))
  );
}

type Entry = PermissionAsk & { folderPath?: string; waiters: Set<() => void> };

export type AskEvents = {
  /** A new ask is waiting (the server makes a notification of it). */
  onAsk?: (ask: PermissionAsk) => void;
  /** An ask changed (answered, expired). */
  onChange?: (ask: PermissionAsk) => void;
};

const DECISION: Record<PermissionAskStatus, PermissionAskDecision> = {
  waiting: { status: 'waiting' },
  allowed_once: { status: 'allowed_once', behavior: 'allow' },
  allowed_always: { status: 'allowed_always', behavior: 'allow' },
  denied: {
    status: 'denied',
    behavior: 'deny',
    message:
      'The owner denied this in Pharos. Don’t retry it; continue with other work or ask why.',
  },
  terminal: { status: 'terminal' },
  unattended: { status: 'unattended' },
  dismissed: { status: 'dismissed' },
  expired: { status: 'expired' },
};

/** Waiting first, then notify-only ones still open, then the answered. */
const rank = (status: PermissionAskStatus) =>
  status === 'waiting' ? 0 : status === 'unattended' ? 1 : 2;

export class PermissionAsks {
  private readonly asks = new Map<string, Entry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly service: PermissionService,
    private readonly events: AskEvents = {},
    private readonly waitMs = ASK_WAIT_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private shown(entry: Entry): PermissionAsk {
    const { folderPath: _f, waiters: _w, ...ask } = entry;
    void _f;
    void _w;
    return ask;
  }

  /** A transcript path is read only when it is one of Claude Code's (never any other file). */
  private async session(input: PermissionAskInput): Promise<Session> {
    const unknown = { label: 'a Claude Code session', unattended: isUnattended(input, undefined) };
    const path = input.transcript_path;
    if (!path) return unknown;
    try {
      const projects = realpathSync(join(this.service.claudeHome, 'projects'));
      const file = realpathSync(resolve(path));
      if (!file.startsWith(`${projects}/`) || !file.endsWith('.jsonl') || !statSync(file).isFile())
        return unknown;
      const subagent = /\/subagents\/[^/]+\.jsonl$/.test(file);
      if (!subagent) {
        const s = await readSession(file);
        return { label: s.label, unattended: isUnattended(input, s) };
      }
      const parentFile = `${file.replace(/\/subagents\/[^/]+\.jsonl$/, '')}.jsonl`;
      const parent = await readSession(parentFile).catch(() => undefined);
      return {
        label: `a subagent of ${parent?.label ?? 'a session'}`,
        unattended: isUnattended(input, parent),
      };
    } catch {
      return unknown;
    }
  }

  /** The hook reports a prompt: what it is, in plain words, for the owner. */
  async create(input: PermissionAskInput): Promise<PermissionAsk> {
    const home = this.service.home;
    const suggested = ruleFor(input.tool_name, input.tool_input, home) ?? {
      rule: input.tool_name,
      tool: input.tool_name,
      subject: input.tool_name,
      allowable: true,
    };
    const where = this.service.whereIs(input.cwd);
    const explained = explain(suggested);
    const canAlwaysAllow = suggested.allowable && where.folderPath !== undefined;
    const at = this.now();
    const session = await this.session(input);
    // Nobody can answer in time in an unattended run: notify only, and the hook doesn't wait
    // (unless PHAROS_ASK_WAIT says to).
    const notifyOnly = session.unattended && !input.wait_override;
    // The card stays as long as the hook waits (it says how long), never longer than ours.
    const waitMs = notifyOnly ? 0 : Math.min(this.waitMs, (input.wait_seconds ?? Infinity) * 1000);
    const entry: Entry = {
      id: randomUUID(),
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + waitMs).toISOString(),
      status: notifyOnly ? 'unattended' : 'waiting',
      unattended: session.unattended,
      folder: where.folder,
      displayFolder: where.display,
      projects: where.projects,
      ...(where.projectId ? { projectId: where.projectId } : {}),
      ...(where.folderPath ? { folderId: where.folderId, folderPath: where.folderPath } : {}),
      agent: session.label,
      tool: input.tool_name,
      example: example(
        suggested.subject === suggested.tool ? input.tool_name : suggested.subject,
        home,
      ),
      rule: suggested.rule,
      ...explained,
      allowable: suggested.allowable,
      ...(suggested.reason ? { reason: suggested.reason } : {}),
      canAlwaysAllow,
      scopes: canAlwaysAllow
        ? scopesFor({
            suggested,
            raws: [suggested.subject],
            folder: { path: where.folderPath!, name: where.name },
            home,
            risk: explained.risk,
          })
        : [],
      waiters: new Set(),
    };
    this.asks.set(entry.id, entry);
    if (!notifyOnly)
      this.timers.set(
        entry.id,
        setTimeout(() => this.settle(entry.id, 'expired'), waitMs + 1_000),
      );
    this.prune();
    const ask = this.shown(entry);
    try {
      this.events.onAsk?.(ask);
    } catch (error) {
      console.error('[pharos] Could not announce a permission ask:', error);
    }
    return ask;
  }

  private prune() {
    const done = [...this.asks.values()].filter((a) => a.status !== 'waiting');
    for (const old of done.slice(0, Math.max(0, done.length - KEPT))) this.asks.delete(old.id);
  }

  private get(id: string): Entry {
    const entry = this.asks.get(id);
    if (!entry)
      throw new PharosError('not_found', 'That ask is gone (it was answered or timed out)');
    return entry;
  }

  private settle(id: string, status: PermissionAskStatus): Entry | undefined {
    const entry = this.asks.get(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    if (!entry || (entry.status !== 'waiting' && entry.status !== 'unattended')) return entry;
    entry.status = status;
    entry.answeredAt = this.now().toISOString();
    for (const wake of entry.waiters) wake();
    entry.waiters.clear();
    try {
      this.events.onChange?.(this.shown(entry));
    } catch (error) {
      console.error('[pharos] Could not announce a permission answer:', error);
    }
    return entry;
  }

  /** Newest first: the waiting ones, then the last answered. */
  list(): PermissionAsk[] {
    return [...this.asks.values()]
      .sort((a, b) => rank(a.status) - rank(b.status) || b.at.localeCompare(a.at))
      .map((e) => this.shown(e));
  }

  /** The hook waits here (at most `ms`) for the owner's answer. */
  async wait(id: string, ms: number): Promise<PermissionAskDecision> {
    const entry = this.asks.get(id);
    if (!entry) return { status: 'expired' };
    if (entry.status === 'waiting')
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(done, Math.max(0, Math.min(ms, this.waitMs)));
        function done() {
          clearTimeout(timer);
          entry!.waiters.delete(done);
          resolveWait();
        }
        entry.waiters.add(done);
      });
    return DECISION[entry.status];
  }

  /** "Allow always": the change it would write, for the confirm step. */
  preview(id: string, target: PermissionTarget, rule?: string): PermissionPreview {
    const entry = this.get(id);
    if (!entry.canAlwaysAllow || !entry.folderPath)
      throw new PharosError(
        'invalid',
        entry.allowable
          ? 'This agent isn’t working in a project folder, so there’s no folder to keep the rule in'
          : (entry.reason ?? 'This can only be denied'),
      );
    const chosen = rule ?? entry.rule;
    checkScope(entry.scopes, chosen, target);
    return this.service.previewAt({
      folderId: entry.folderId!,
      folder: entry.folderPath,
      rule: chosen,
      action: 'allow',
      target,
      tool: entry.tool,
      allowable: entry.allowable,
      ...(entry.reason ? { reason: entry.reason } : {}),
    });
  }

  /** The owner's answer; "always" also writes the rule (backup, Undo) before letting it run. */
  answer(id: string, answer: PermissionAskAnswer): PermissionAsk {
    const entry = this.get(id);
    // A notify-only ask (an unattended run) has no hook waiting: only a rule for next time, or
    // dismissing it, make sense.
    const open =
      entry.status === 'waiting' ||
      (entry.status === 'unattended' &&
        (answer.answer === 'always' || answer.answer === 'dismiss'));
    if (!open)
      throw new PharosError(
        'invalid',
        entry.status === 'unattended'
          ? 'That run couldn’t wait: allow it always for next time, or dismiss it'
          : 'That ask was already answered or timed out',
      );
    if (answer.answer === 'dismiss') this.settle(id, 'dismissed');
    else if (answer.answer === 'always') {
      const result = this.service.commit(this.preview(id, answer.target, answer.rule), answer.hash);
      entry.record = result.record;
      this.settle(id, 'allowed_always');
    } else if (answer.answer === 'once') {
      // Even a deny-only command may run once when the owner says so: no rule is kept.
      this.settle(id, 'allowed_once');
    } else this.settle(id, answer.answer === 'deny' ? 'denied' : 'terminal');
    return this.shown(entry);
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
