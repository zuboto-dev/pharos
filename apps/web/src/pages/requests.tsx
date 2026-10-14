import { similarAnswers, type Entity } from '@pharos/schema';
import clsx from 'clsx';
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Loader2,
  MessageCircleQuestion,
  X,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { AskAbout, ViewActions } from '../catalog/context';
import { MENU_PANEL } from '../catalog/select';
import { ICON_BUTTON, Tip } from '../catalog/tip';
import { BUTTON } from '../catalog/ui';
import { postJson } from '../lib/api';
import { useAgentStatus, type AgentStatus } from '../lib/events';
import { timeAgo } from '../lib/format';

/** Asks the agent a question about part of the project; it becomes a request the agent sees. */
export function AskDialog({
  projectId,
  about,
  apply,
  onClose,
  answers = [],
  onOpenAnswer,
}: {
  projectId: string;
  about: AskAbout;
  apply: ViewActions['apply'];
  onClose: () => void;
  /** Current answer views, offered when the question was answered before. */
  answers?: Entity<'view'>[];
  onOpenAnswer?: (viewId: string) => void;
}) {
  const [question, setQuestion] = useState(about.question ?? '');
  // Asked from a block (R10.6): change that block in place, or answer in a separate view. A
  // question an empty block starts (add the missing data) is not a change to the block.
  const [mode, setMode] = useState<'block' | 'answer'>(
    about.widgetId && !about.question ? 'block' : 'answer',
  );
  const modeName = useId();
  // Focus goes back to whatever opened the dialog (the block's Ask button) when it closes.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    },
    [opener],
  );
  const earlier = question.trim()
    ? similarAnswers(question, answers, (v) => v.data.question).slice(0, 3)
    : [];
  const agent = useAgentStatus();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    const outcome = await apply(
      `Ask: ${q}`,
      [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId,
            question: q,
            about: about.label,
            ...(about.viewId ? { viewId: about.viewId } : {}),
            ...(about.widgetId ? { widgetId: about.widgetId } : {}),
            ...(about.aboutId ? { aboutId: about.aboutId } : {}),
            ...(about.widgetId && mode === 'block' ? { mode: 'block' } : {}),
          },
        },
      ],
      { undoable: true },
    );
    if (outcome.ok) onClose();
  };
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Ask your agent"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="relative w-full max-w-md space-y-3 rounded-block bg-surface p-5 shadow-overlay"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MessageCircleQuestion className="size-5 text-sky-500" /> Ask your agent
        </h2>
        <p className="text-sm text-muted">
          About: <span className="font-medium text-ink-soft">{about.label}</span>
        </p>
        <textarea
          aria-label="Question"
          autoFocus
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
          }}
          placeholder={
            mode === 'block'
              ? 'e.g. Show only this month. Add the shop as a column.'
              : 'e.g. Why is this behind? What should I do next?'
          }
          className="w-full rounded-control border border-line-strong bg-surface px-2.5 py-2 text-sm"
        />
        {about.widgetId && (
          <fieldset className="space-y-1.5 text-sm">
            <legend className="mb-1 text-xs font-medium text-muted">Your agent should</legend>
            {(
              [
                [
                  'block',
                  'Change this block',
                  'Only this block changes; the rest of the page stays. You can undo it.',
                ],
                [
                  'answer',
                  'Answer in a new view',
                  'The page stays as it is; the answer opens as its own view.',
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={modeName}
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-ink-soft">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {earlier.length > 0 && onOpenAnswer && (
          <div className="space-y-1 rounded-tile border border-emerald-200 bg-emerald-50/60 p-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
              Answered before (answers stay up to date)
            </div>
            {earlier.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onOpenAnswer(v.id);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-white dark:hover:bg-neutral-800"
              >
                <span className="min-w-0 flex-1">
                  {v.data.question ?? v.data.name}{' '}
                  <span className="text-xs text-faint">{timeAgo(v.createdAt)}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-emerald-600" />
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">
          {agent.configured && agent.enabled
            ? 'Your agent will start on it in a moment. '
            : 'Your agent sees open questions when it next checks Pharos (or ask it: “answer my questions in Pharos”). '}
          {mode === 'block'
            ? 'The block shows when it is working on it, and you can undo the change.'
            : 'Its answer appears here as an answer view.'}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={!question.trim()} className={BUTTON.primary}>
            Ask
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Where an open question really is with the answering agent (R11, W7.5): in the run now, waiting
 * for the next run, left open by a run that failed, timed out or was stopped (with a retry), or
 * waiting for a person because answering is paused or not set up.
 */
export function requestRunState(
  requestId: string,
  agent: AgentStatus,
): { kind: 'running' | 'queued' | 'failed' | 'waiting'; text: string; retry?: boolean } {
  if (agent.run?.requestIds.includes(requestId))
    return agent.state === 'stopping' || agent.paused
      ? { kind: 'waiting', text: 'Stopping: answering was paused' }
      : { kind: 'running', text: 'Being answered now' };
  const last = agent.lastRun;
  if (last?.requestIds?.includes(requestId) && last.outcome && last.outcome !== 'finished') {
    const why =
      last.outcome === 'stopped'
        ? 'The run was stopped when answering was paused'
        : last.outcome === 'timed_out'
          ? 'The run timed out before answering it'
          : `The run failed${last.exitCode !== null ? ` (exit ${last.exitCode})` : ''} before answering it`;
    return { kind: 'failed', text: why, retry: agent.configured && agent.enabled };
  }
  if (last?.requestIds?.includes(requestId) && last.outcome === 'finished')
    return {
      kind: 'failed',
      text: 'The last run ended without answering it',
      retry: agent.configured && agent.enabled,
    };
  if (agent.configured && agent.enabled) return { kind: 'queued', text: 'Queued for the next run' };
  if (agent.configured && agent.paused)
    return { kind: 'waiting', text: 'Answering is paused: waits for you or your agent' };
  return { kind: 'waiting', text: 'Waits for your agent' };
}

/** The project's questions: open ones waiting for the agent, and recent answered ones. */
export function RequestsButton({
  projectId,
  requests,
  apply,
}: {
  projectId: string;
  requests: Entity<'request'>[];
  apply: ViewActions['apply'];
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const agent = useAgentStatus();
  const open = requests.filter((r) => r.data.status === 'open');
  const retry = (id: string) => {
    setRetrying(id);
    postJson('/api/agent/answer-waiting', {})
      .catch(() => {})
      .finally(() => setRetrying(null));
  };
  const answered = requests
    .filter((r) => r.data.status === 'answered')
    .sort((a, b) => b.updatedRev - a.updatedRev)
    .slice(0, 5);
  if (!requests.some((r) => r.data.status !== 'dismissed')) return null;
  // The server's agent picks up open questions on its own when one is configured.
  const working = agent.answering.includes(projectId) && open.length > 0;
  const waiting = open.length > 0 && agent.configured && agent.enabled && !working;
  return (
    <>
      <Tip label="Questions" align="end">
        <button
          type="button"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
          className={open.length > 0 ? ICON_BUTTON.accent : ICON_BUTTON.secondary}
          aria-label={`Questions: ${open.length} waiting`}
          aria-expanded={anchor !== null}
          aria-haspopup="dialog"
        >
          {working ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <MessageCircleQuestion className="size-4" aria-hidden />
          )}
          {open.length > 0 && (
            <span className="rounded-full bg-sky-500 px-1.5 text-xs text-white">{open.length}</span>
          )}
        </button>
      </Tip>
      {anchor &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setAnchor(null)} />
            <div
              role="dialog"
              aria-label="Questions"
              style={{
                top: anchor.bottom + 6,
                left: Math.max(8, Math.min(anchor.right - 352, window.innerWidth - 360)),
              }}
              className={clsx('fixed z-[61] max-h-[70vh] w-88 overflow-y-auto text-sm', MENU_PANEL)}
            >
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-faint">
                {working
                  ? 'Your agent is answering…'
                  : waiting
                    ? 'Your agent will answer these shortly'
                    : 'Waiting for the agent'}
              </div>
              {open.length === 0 && (
                <p className="px-2.5 pb-2 text-xs text-faint">Nothing waiting.</p>
              )}
              {open.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 rounded-tile px-2.5 py-2 hover:bg-sunken"
                >
                  <CircleDot className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
                  <div className="min-w-0 flex-1">
                    <div>{r.data.question}</div>
                    <div className="text-xs text-faint">
                      {r.data.mode === 'block' ? 'Change ' : ''}
                      {r.data.mode === 'refresh' ? 'Refresh ' : ''}
                      {r.data.about ? `${r.data.about} · ` : ''}
                      {timeAgo(r.createdAt)}
                    </div>
                    <RunState
                      state={requestRunState(r.id, agent)}
                      busy={retrying === r.id}
                      onRetry={() => retry(r.id)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Dismiss “${r.data.question}”`}
                    title="Dismiss"
                    onClick={() =>
                      void apply(
                        `Dismiss question “${r.data.question}”`,
                        [
                          {
                            op: 'update',
                            type: 'request',
                            id: r.id,
                            data: { status: 'dismissed' },
                          },
                        ],
                        {
                          undoable: true,
                        },
                      )
                    }
                    className="rounded p-0.5 text-faint hover:text-rose-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {answered.length > 0 && (
                <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-faint">Answered</div>
              )}
              {answered.map((r) => (
                <Link
                  key={r.id}
                  to={
                    r.data.answerViewId
                      ? `/projects/${projectId}/views/${r.data.answerViewId}`
                      : r.data.viewId
                        ? `/projects/${projectId}/views/${r.data.viewId}`
                        : `/projects/${projectId}`
                  }
                  onClick={() => setAnchor(null)}
                  className="flex items-start gap-2 rounded-tile px-2.5 py-2 hover:bg-sunken"
                >
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div>{r.data.question}</div>
                    {r.data.reply && <div className="text-xs text-muted">{r.data.reply}</div>}
                    <div className="text-xs text-accent">
                      {r.data.mode === 'block' ? 'Open the page' : 'Open the answer'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

const RUN_STATE_TONE = {
  running: 'text-emerald-700 dark:text-emerald-300',
  queued: 'text-sky-700 dark:text-sky-300',
  failed: 'text-amber-700 dark:text-amber-300',
  waiting: 'text-muted',
};

/** One open question's state with the answering agent, and a retry when a run left it open. */
function RunState({
  state,
  busy,
  onRetry,
}: {
  state: ReturnType<typeof requestRunState>;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={clsx(
        'mt-0.5 flex flex-wrap items-center gap-2 text-xs',
        RUN_STATE_TONE[state.kind],
      )}
    >
      <span role="status">{state.text}</span>
      {state.retry && (
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="rounded-control font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50"
        >
          {busy ? 'Trying again…' : 'Try again'}
        </button>
      )}
    </div>
  );
}
