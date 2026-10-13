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
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import type { AskAbout, ViewActions } from '../catalog/context';
import { MENU_PANEL } from '../catalog/select';
import { ICON_BUTTON, Tip } from '../catalog/tip';
import { BUTTON } from '../catalog/ui';
import { useAgentStatus } from '../lib/events';
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
  const [question, setQuestion] = useState('');
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
        className="relative w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MessageCircleQuestion className="size-5 text-sky-500" /> Ask your agent
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          About:{' '}
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{about.label}</span>
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
          placeholder="e.g. Why is this behind? What should I do next?"
          className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        {earlier.length > 0 && onOpenAnswer && (
          <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
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
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white dark:hover:bg-neutral-800"
              >
                <span className="min-w-0 flex-1">
                  {v.data.question ?? v.data.name}{' '}
                  <span className="text-xs text-neutral-400">{timeAgo(v.createdAt)}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-emerald-600" />
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {agent.configured && agent.enabled
            ? 'Your agent will start on it in a moment; '
            : 'Your agent sees open questions when it next checks Pharos (or ask it: “answer my questions in Pharos”). '}
          Its answer appears here as an answer view.
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
  const agent = useAgentStatus();
  const open = requests.filter((r) => r.data.status === 'open');
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
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-neutral-400">
                {working
                  ? 'Your agent is answering…'
                  : waiting
                    ? 'Your agent will answer these shortly'
                    : 'Waiting for the agent'}
              </div>
              {open.length === 0 && (
                <p className="px-2.5 pb-2 text-xs text-neutral-400">Nothing waiting.</p>
              )}
              {open.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <CircleDot className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
                  <div className="min-w-0 flex-1">
                    <div>{r.data.question}</div>
                    <div className="text-xs text-neutral-400">
                      {r.data.about ? `${r.data.about} · ` : ''}
                      {timeAgo(r.createdAt)}
                    </div>
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
                    className="rounded p-0.5 text-neutral-400 hover:text-rose-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {answered.length > 0 && (
                <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-neutral-400">
                  Answered
                </div>
              )}
              {answered.map((r) => (
                <Link
                  key={r.id}
                  to={
                    r.data.answerViewId
                      ? `/projects/${projectId}/views/${r.data.answerViewId}`
                      : `/projects/${projectId}`
                  }
                  onClick={() => setAnchor(null)}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div>{r.data.question}</div>
                    <div className="text-xs text-sky-600 dark:text-sky-400">Open the answer</div>
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
