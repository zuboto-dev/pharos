import {
  DECISION,
  addUnits,
  decisionState,
  valueFor,
  type DecisionOption,
  type Entity,
  type NodeOf,
  type Operation,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  CalendarClock,
  Check,
  ListPlus,
  Minus,
  PenLine,
  Plus,
  Scale,
  Star,
  Undo2,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { formatDate, localToday } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { EntityRef } from '../interactive';
import { AskAgentButton, EmptyState } from '../empty-state';
import { BUTTON, Badge } from '../ui';

/**
 * A decision the reader makes on the page (R10.19): the question, its options side by side with
 * what each leads to, pros, cons and sources, the agent's recommendation marked, and three ways
 * to answer: choose an option, write another answer, or decide later. Choosing records the
 * owner's decision (status accepted, decided by them, today, the option) as one undoable
 * revision; agents can't (Store.apply refuses them). Once answered, the block shows the answer
 * compactly and keeps the options one tap away.
 */

const INPUT =
  'w-full rounded-control border border-neutral-300 bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-neutral-700 dark:focus:border-sky-700 dark:focus:ring-sky-900';

/** The person deciding: the first person among the assignees, or a new "me" created with it. */
function decider(data: ViewData): { id: string; create: Operation[] } {
  const person = data.assignees.find((a) => a.data.kind === 'human');
  if (person) return { id: person.id, create: [] };
  return {
    id: '$me',
    create: [
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'me', kind: 'human' } } as const,
    ],
  };
}

function Points({ kind, items }: { kind: 'pro' | 'con'; items?: string[] }) {
  if (!items?.length) return null;
  const Icon = kind === 'pro' ? Plus : Minus;
  return (
    <ul aria-label={kind === 'pro' ? 'For' : 'Against'} className="space-y-0.5 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <Icon
            aria-hidden
            className={clsx('mt-0.5 size-3.5 shrink-0', kind === 'pro' ? 'text-ok' : 'text-danger')}
          />
          <span className="text-ink-soft">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function OptionCard({
  option,
  recommended,
  chosen,
  onChoose,
  busy,
}: {
  option: DecisionOption;
  recommended: boolean;
  chosen: boolean;
  onChoose?: () => void;
  busy: boolean;
}) {
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className={clsx(
        'flex min-w-0 flex-col gap-2.5 rounded-tile border p-3 sm:p-4',
        chosen
          ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20'
          : recommended
            ? 'border-accent/50 bg-sky-50/40 dark:bg-sky-950/20'
            : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={headingId} className="min-w-0 text-base font-semibold text-balance">
          {option.label}
        </h4>
        {chosen ? (
          <Badge tone="green">
            <Check aria-hidden className="size-3" /> Chosen
          </Badge>
        ) : (
          recommended && (
            <Badge tone="blue">
              <Star aria-hidden className="size-3" /> Recommended
            </Badge>
          )
        )}
      </div>
      {option.summary && <p className="text-sm text-ink-soft">{option.summary}</p>}
      <Points kind="pro" items={option.pros} />
      <Points kind="con" items={option.cons} />
      {option.claimIds?.length ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <span>Sources</span>
          {option.claimIds.map((id) => (
            <EntityRef key={id} id={id} className="max-w-56" />
          ))}
        </div>
      ) : null}
      {onChoose && (
        <div className="mt-auto pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onChoose}
            // "Choose this" on the card (no quotes inside quotes); the option's name for screen readers.
            aria-label={`Choose ${option.label}`}
            className={clsx(
              recommended ? BUTTON.primary : BUTTON.secondary,
              'min-h-11 w-full sm:min-h-0 sm:w-auto',
            )}
          >
            Choose this
          </button>
        </div>
      )}
    </li>
  );
}

type Mode = 'idle' | 'answer' | 'later';

export function DecisionBlock({ node }: { node: NodeOf<'DecisionBlock'> }) {
  const data = useViewData();
  const decision = data.decisions.find((d) => d.id === node.decision);
  if (!decision)
    return (
      <EmptyState
        icon={Scale}
        title="This decision was deleted or isn’t in this project"
        hint="Ask your agent to set it up again, or to point this block at another one."
      >
        <AskAgentButton question="Set up the decision this block should show, with its options." />
      </EmptyState>
    );
  return <Decision decision={decision} />;
}

function Decision({ decision }: { decision: Entity<'decision'> }) {
  const data = useViewData();
  const { project, actions } = data;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const titleId = useId();
  const options = decision.data.options ?? [];
  const state = decisionState(decision.data);
  const recommended = options.find((o) => o.id === decision.data.recommendedOptionId);
  const question = decision.data.title;

  const save = async (message: string, patch: Record<string, unknown>, extra: Operation[] = []) => {
    setBusy(true);
    const outcome = await actions.apply(
      message,
      [...extra, { op: 'update', type: 'decision', id: decision.id, data: patch }],
      { undoable: true },
    );
    setBusy(false);
    if (outcome.ok) setMode('idle');
    return outcome.ok;
  };
  const status = (meaning: string) => valueFor(project, 'decision.status', meaning);
  /** The owner's answer: an option or their own words, decided today by them. */
  const answer = (patch: { chosenOptionId?: string; answer?: string }, message: string) => {
    const who = decider(data);
    return save(
      message,
      {
        chosenOptionId: patch.chosenOptionId ?? null,
        answer: patch.answer ?? null,
        deferredUntil: null,
        status: status('accepted'),
        decidedById: who.id,
        decisionDate: localToday(),
      },
      who.create,
    );
  };
  const reopen = () =>
    save(`Reopen “${question}”`, {
      chosenOptionId: null,
      answer: null,
      status: status('proposed'),
      decidedById: null,
      decisionDate: null,
    });

  const decidedBy = decision.data.decidedById
    ? data.assigneeById.get(decision.data.decidedById)?.data.name
    : undefined;
  const answered = state.kind === 'chosen' || state.kind === 'answered';

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {answered ? 'Decided' : 'Decision for you'}
          </p>
          <h3 id={titleId} className="text-lg font-semibold text-balance">
            {question}
          </h3>
        </div>
        {state.kind === 'deferred' && (
          <Badge tone="amber">
            <CalendarClock aria-hidden className="size-3" /> Later: {formatDate(state.until, true)}
          </Badge>
        )}
      </div>

      {answered ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-tile border border-emerald-300 bg-emerald-50/60 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-800 dark:bg-emerald-950/20"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">
              <Check aria-hidden className="mr-1 inline size-4 text-ok" />
              {state.kind === 'chosen' ? (
                <>
                  Chosen: <span className="font-semibold">{state.option.label}</span>
                </>
              ) : (
                <>
                  Answer: <span className="font-semibold">{state.answer}</span>
                </>
              )}
            </p>
            {state.kind === 'chosen' && state.option.summary && (
              <p className="text-sm text-ink-soft">{state.option.summary}</p>
            )}
            <p className="text-xs text-muted">
              {[decidedBy, decision.data.decisionDate && formatDate(decision.data.decisionDate)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {options.length > 0 && (
              <button
                type="button"
                aria-expanded={showOptions}
                onClick={() => setShowOptions((s) => !s)}
                className={BUTTON.secondary}
              >
                {showOptions ? 'Hide options' : 'See options'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void reopen()}
              className={BUTTON.secondary}
            >
              <Undo2 aria-hidden className="size-3.5" /> Change
            </button>
          </div>
        </div>
      ) : null}

      {(!answered || showOptions) &&
        (options.length ? (
          <ul
            aria-label="Options"
            className={clsx(
              'grid gap-3',
              options.length === 2 && 'sm:grid-cols-2',
              options.length >= 3 && 'sm:grid-cols-2 lg:grid-cols-3',
            )}
          >
            {options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                recommended={option.id === recommended?.id}
                chosen={state.kind === 'chosen' && state.option.id === option.id}
                busy={busy}
                onChoose={
                  answered
                    ? undefined
                    : () =>
                        void answer(
                          { chosenOptionId: option.id },
                          `Choose “${option.label}”: ${question}`,
                        )
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={ListPlus}
            title="No options yet"
            hint="Your agent lays the options out side by side, with pros, cons and sources."
          >
            <AskAgentButton question="Add the options for this decision, with pros, cons and sources." />
          </EmptyState>
        ))}

      {!answered && recommended && (
        <p className="text-sm text-ink-soft">
          <span className="font-medium text-ink">Why “{recommended.label}”:</span>{' '}
          {decision.data.recommendationReason ?? 'no reason given yet'}
        </p>
      )}

      {!answered &&
        (mode === 'answer' ? (
          <AnswerForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onSave={(text) => answer({ answer: text }, `Answer “${question}”: ${text}`)}
          />
        ) : mode === 'later' ? (
          <LaterForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onSave={(until) =>
              save(`Decide “${question}” later, by ${until}`, { deferredUntil: until })
            }
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode('answer')} className={BUTTON.secondary}>
              <PenLine aria-hidden className="size-3.5" /> Write another answer
            </button>
            <button type="button" onClick={() => setMode('later')} className={BUTTON.secondary}>
              <CalendarClock aria-hidden className="size-3.5" /> Decide later
            </button>
          </div>
        ))}
    </section>
  );
}

function FormShell({
  label,
  children,
  onSubmit,
  onCancel,
  busy,
  submit,
}: {
  label: string;
  children: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  submit: string;
}) {
  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="space-y-2 rounded-tile border border-line p-3"
    >
      {children}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={BUTTON.primary}>
          {submit}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnswerForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <FormShell
      label="Another answer"
      busy={busy || !text.trim()}
      submit="Save answer"
      onCancel={onCancel}
      onSubmit={() => {
        if (text.trim()) void onSave(text.trim());
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        Your answer
      </label>
      <textarea
        id={id}
        autoFocus
        rows={2}
        maxLength={DECISION.answerChars}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim())
            void onSave(text.trim());
        }}
        placeholder="None of these: …"
        className={INPUT}
      />
    </FormShell>
  );
}

function LaterForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (until: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const today = localToday();
  const [until, setUntil] = useState(addUnits(today, 1, 'weeks'));
  const id = useId();
  const quick = [
    { label: 'In a week', date: addUnits(today, 1, 'weeks') },
    { label: 'In a month', date: addUnits(today, 1, 'months') },
  ];
  return (
    <FormShell
      label="Decide later"
      busy={busy || !until || until < today}
      submit="Remind me then"
      onCancel={onCancel}
      onSubmit={() => {
        if (until && until >= today) void onSave(until);
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        Decide by
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="date"
          autoFocus
          min={today}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className={clsx(INPUT, 'w-auto tabular-nums dark:[color-scheme:dark]')}
        />
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            aria-pressed={until === q.date}
            onClick={() => setUntil(q.date)}
            className={until === q.date ? BUTTON.accent : BUTTON.secondary}
          >
            {q.label}
          </button>
        ))}
      </div>
    </FormShell>
  );
}
