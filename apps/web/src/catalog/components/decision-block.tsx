import {
  DECISION,
  addUnits,
  choiceMessage,
  choiceUpdate,
  DECLINE_REASON_CHARS,
  declineMessage,
  declineReason,
  declineUpdate,
  decisionState,
  isDeclined,
  relationLine,
  relationNotes,
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
  CircleX,
  History,
  Link2,
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
import { Clickable, EntityRef } from '../interactive';
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
  // The person the owner's tasks go to, as the desk names them (desk.ts ownerAssignee).
  const counts = new Map<string, number>();
  for (const t of data.tasks) {
    const id = t.data.assigneeId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const person = data.assignees
    .filter((a) => a.data.kind === 'human')
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
  if (person) return { id: person.id, create: [] };
  return {
    id: '$me',
    create: [
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'me', kind: 'human' } } as const,
    ],
  };
}

/**
 * What its relations say (relationNotes): a decision it builds on still open, one decided
 * assuming this one, or something it rests on that changed after it was decided. Each names the
 * other and opens it.
 */
function RelationStrip({ decision }: { decision: Entity<'decision'> }) {
  const data = useViewData();
  const notes = relationNotes(
    decision,
    (id) => data.entityById.get(id),
    data.decisions as Entity<'decision'>[],
  );
  if (!notes.length) return null;
  return (
    <ul data-relation-notes="" className="space-y-1">
      {notes.map((note) => (
        <li
          key={`${note.kind}-${note.id}`}
          data-relation={note.kind}
          className="flex items-start gap-2 rounded-tile bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {note.kind === 'changed' ? (
            <History aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Link2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <Clickable id={note.id} className="min-w-0 text-left hover:underline">
            {relationLine(note)}
          </Clickable>
        </li>
      ))}
    </ul>
  );
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
  decisionId,
  question,
}: {
  decisionId: string;
  question: string;
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
      // The agent panel's picker can point at one option ("Decision › option …").
      data-entity={decisionId}
      data-entity-type="decision"
      data-pick-title={`${question} › option “${option.label}”`}
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
            {option.asks ? 'Choose and explain' : 'Choose this'}
          </button>
        </div>
      )}
    </li>
  );
}

type Mode = 'idle' | 'answer' | 'later' | 'note' | 'decline';

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

/**
 * The decision and its answers. `inPanel` is the details panel's form: the panel already shows the
 * title, and its narrow column takes the options one under another.
 */
export function Decision({
  decision,
  inPanel = false,
}: {
  decision: Entity<'decision'>;
  inPanel?: boolean;
}) {
  const data = useViewData();
  const { project, actions } = data;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  /** The option whose question is open before it's chosen; null when editing the note of a choice. */
  const [pending, setPending] = useState<DecisionOption | null>(null);
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
  const answer = (
    patch: { chosenOptionId?: string; note?: string; answer?: string },
    message: string,
  ) => {
    const who = decider(data);
    const option = decision.data.options?.find((o) => o.id === patch.chosenOptionId);
    // A choice settles status, who and when with it (decline → rejected, later → back in a week).
    if (option)
      return save(
        choiceMessage(option, question, patch.note, localToday()),
        choiceUpdate(option, {
          ...(patch.note ? { note: patch.note } : {}),
          today: localToday(),
          decidedById: who.id,
          status,
        }),
        who.create,
      );
    return save(
      message,
      {
        chosenOptionId: patch.chosenOptionId ?? null,
        note: patch.note ?? null,
        answer: patch.answer ?? null,
        deferredUntil: null,
        status: status('accepted'),
        decidedById: who.id,
        decisionDate: localToday(),
      },
      who.create,
    );
  };
  /** No, whatever the options: rejected, by them today, with the reason they give. */
  const decline = (reason: string) => {
    const who = decider(data);
    return save(
      declineMessage(question, reason),
      declineUpdate({
        ...(reason ? { reason } : {}),
        today: localToday(),
        decidedById: who.id,
        status,
      }),
      who.create,
    );
  };
  const reopen = () =>
    save(`Reopen “${question}”`, {
      chosenOptionId: null,
      note: null,
      answer: null,
      status: status('proposed'),
      decidedById: null,
      decisionDate: null,
    });

  const decidedBy = decision.data.decidedById
    ? data.assigneeById.get(decision.data.decidedById)?.data.name
    : undefined;
  const answered = state.kind === 'chosen' || state.kind === 'answered';
  const declined = state.kind === 'answered' && isDeclined(decision.data);
  const choose = (option: DecisionOption) => {
    if (option.asks) {
      setPending(option);
      setMode('note');
    } else void answer({ chosenOptionId: option.id }, `Choose “${option.label}”: ${question}`);
  };
  /** The note with a choice: written when choosing an option that asks, or added afterwards. */
  const saveNote = (text: string) =>
    pending
      ? answer(
          { chosenOptionId: pending.id, ...(text ? { note: text } : {}) },
          `Choose “${pending.label}”: ${question}${text ? ` (${text})` : ''}`,
        )
      : save(text ? `Note on “${question}”: ${text}` : `Remove the note on “${question}”`, {
          note: text || null,
        });
  const noteOption = pending ?? (state.kind === 'chosen' ? state.option : undefined);
  const noteForm = mode === 'note' && noteOption && (
    <NoteForm
      busy={busy}
      question={noteOption.asks}
      required={Boolean(pending?.asks)}
      initial={pending ? '' : state.kind === 'chosen' ? (state.note ?? '') : ''}
      submit={pending ? `Choose “${noteOption.label}”` : 'Save note'}
      onCancel={() => {
        setPending(null);
        setMode('idle');
      }}
      onSave={async (text) => {
        const ok = await saveNote(text);
        if (ok) setPending(null);
        return ok;
      }}
    />
  );

  return (
    <section
      {...(inPanel ? { 'aria-label': question } : { 'aria-labelledby': titleId })}
      data-entity={decision.id}
      data-entity-type="decision"
      data-pick-title={question}
      className="space-y-4"
    >
      <RelationStrip decision={decision} />
      <div
        className={clsx(
          'flex flex-wrap items-start justify-between gap-2',
          inPanel && state.kind !== 'deferred' && 'hidden',
        )}
      >
        <div className={clsx('min-w-0 space-y-1', inPanel && 'hidden')}>
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
          data-declined={declined ? '' : undefined}
          className={clsx(
            'flex flex-col gap-3 rounded-tile border p-3',
            declined
              ? 'border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/20'
              : 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20',
            // The panel's narrow column keeps the answer above its buttons.
            !inPanel && 'sm:flex-row sm:items-center sm:justify-between',
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">
              {declined ? (
                <CircleX aria-hidden className="mr-1 inline size-4 text-danger" />
              ) : (
                <Check aria-hidden className="mr-1 inline size-4 text-ok" />
              )}
              {declined ? (
                <span className="font-semibold">Declined</span>
              ) : state.kind === 'chosen' ? (
                <>
                  Chosen: <span className="font-semibold">{state.option.label}</span>
                </>
              ) : (
                <>
                  Answer: <span className="font-semibold">{state.answer}</span>
                </>
              )}
            </p>
            {state.kind === 'chosen' && state.option.summary && !state.note && (
              <p className="text-sm text-ink-soft">{state.option.summary}</p>
            )}
            {declined && state.kind === 'answered' && declineReason(state.answer) && (
              <p data-decline-reason="" className="text-sm whitespace-pre-wrap text-ink">
                {declineReason(state.answer)}
              </p>
            )}
            {state.kind === 'chosen' && state.note && (
              <p data-decision-note="" className="text-sm whitespace-pre-wrap text-ink">
                {state.note}
              </p>
            )}
            <p className="text-xs text-muted">
              {[decidedBy, decision.data.decisionDate && formatDate(decision.data.decisionDate)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state.kind === 'chosen' && mode !== 'note' && (
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setMode('note');
                }}
                className={BUTTON.secondary}
              >
                <PenLine aria-hidden className="size-3.5" />{' '}
                {state.note ? 'Edit note' : 'Add a note'}
              </button>
            )}
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

      {answered && noteForm}

      {(!answered || showOptions) &&
        (options.length ? (
          <ul
            aria-label="Options"
            className={clsx(
              'grid gap-3',
              !inPanel && options.length === 2 && 'sm:grid-cols-2',
              !inPanel && options.length >= 3 && 'sm:grid-cols-2 lg:grid-cols-3',
            )}
          >
            {options.map((option) => (
              <OptionCard
                key={option.id}
                decisionId={decision.id}
                question={question}
                option={option}
                recommended={option.id === recommended?.id}
                chosen={state.kind === 'chosen' && state.option.id === option.id}
                busy={busy}
                onChoose={answered ? undefined : () => choose(option)}
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
        (mode === 'note' ? (
          noteForm
        ) : mode === 'answer' ? (
          <AnswerForm
            busy={busy}
            onCancel={() => setMode('idle')}
            onSave={(text) => answer({ answer: text }, `Answer “${question}”: ${text}`)}
          />
        ) : mode === 'decline' ? (
          <DeclineForm busy={busy} onCancel={() => setMode('idle')} onSave={decline} />
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
            <button type="button" onClick={() => setMode('decline')} className={BUTTON.secondary}>
              <CircleX aria-hidden className="size-3.5" /> Decline
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

function DeclineForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (reason: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <FormShell
      label="Decline"
      busy={busy}
      submit="Decline"
      onCancel={onCancel}
      onSubmit={() => void onSave(text.trim())}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        Why not<span className="font-normal text-muted"> (optional; your agent reads it)</span>
      </label>
      <textarea
        id={id}
        autoFocus
        rows={2}
        maxLength={DECLINE_REASON_CHARS}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onSave(text.trim());
        }}
        placeholder="Not worth it now: …"
        className={INPUT}
      />
    </FormShell>
  );
}

function NoteForm({
  busy,
  question,
  required,
  initial,
  submit,
  onSave,
  onCancel,
}: {
  busy: boolean;
  /** What the option asks ("Which steps failed?"); a plain note box without one. */
  question?: string;
  required: boolean;
  initial: string;
  submit: string;
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const id = useId();
  const blocked = required && !text.trim();
  const send = () => {
    if (!blocked) void onSave(text.trim());
  };
  return (
    <FormShell
      label="Note"
      busy={busy || blocked}
      submit={submit}
      onCancel={onCancel}
      onSubmit={send}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {question ?? 'Your note'}
        {!required && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      <textarea
        id={id}
        autoFocus
        rows={4}
        maxLength={DECISION.noteChars}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={question ? 'Step 3: …' : 'Anything to add: what you saw, a condition, …'}
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
