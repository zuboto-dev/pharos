import {
  APPROVAL,
  type ApprovalRule,
  type ApprovalRuleInput,
  type ApprovalsState,
  type ApprovalSuggestion,
  type Entity,
} from '@pharos/schema';
import { CheckCheck, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '../catalog/skeleton';
import { BUTTON } from '../catalog/ui';
import { ApiError, ownerSend, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { plural, timeAgo } from '../lib/format';
import { Section, Switch } from './settings-ui';

const INPUT =
  'w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-neutral-400 focus:border-sky-500 focus:outline-none';

const SELECT =
  'rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

/** Waits the form offers: at once, or about one of the owner's check-ins. */
const WAITS = [0, 4, 10, 24];

const waitText = (hours: number) =>
  hours === 0 ? 'answers at once' : `waits ${hours} h for you first`;

const decisionHref = (projectId: string, id: string) =>
  `/projects/${projectId}?entity=${encodeURIComponent(id)}`;

/**
 * Standing approvals (packages/schema/src/approvals.ts): the owner's rules that answer decisions
 * needing only a yes, the rules Pharos suggests from their answers, and the log, with undo.
 */
export function StandingApprovals() {
  const state = useResource<ApprovalsState>('/api/approvals');
  const projects = useResource<Entity<'project'>[]>('/api/entities/project');
  const { reload } = state;
  useRevisionEvents(() => reload());
  const [error, setError] = useState<string>();
  const projectList = Array.isArray(projects.data) ? projects.data : [];
  const names = new Map(projectList.map((p) => [p.id, p.data.name]));

  const send = async (path: string, body: unknown) => {
    setError(undefined);
    try {
      await ownerSend(path, body);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const save = (rule: ApprovalRuleInput) => send('/api/approvals/rules', rule);

  // Only a state of this shape (an older server, or a test's stub, answers something else).
  const s = Array.isArray(state.data?.rules) ? state.data : undefined;
  return (
    <Section
      id="approvals"
      title="Standing approvals"
      icon={CheckCheck}
      description="Rules that answer decisions which only need your yes. Pharos picks the option the agent recommended, as you, and logs it here so you can undo it. A rule never answers a gate, a choice of items, an option that asks for a note, or a question about deleting, sending, publishing, paying or production."
    >
      {!s && state.status === 'loading' ? (
        <Skeleton lines={4} label="Loading standing approvals" />
      ) : !s ? (
        <p className="text-sm text-muted">Standing approvals could not be loaded.</p>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Last 7 days: you answered {plural(s.week.answered, 'decision')}, and {s.week.followed}{' '}
            of them took the agent’s recommendation. Rules answered {s.week.byRules}.
          </p>
          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}
          {s.suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Suggested from your answers</h3>
              <ul className="divide-y divide-line-soft rounded-tile border border-line">
                {s.suggestions.map((g) => (
                  <Suggestion key={g.word} suggestion={g} onAdd={save} />
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Your rules</h3>
            {s.rules.length === 0 ? (
              <p className="text-sm text-muted">No rules yet: every decision waits for you.</p>
            ) : (
              <ul className="divide-y divide-line-soft rounded-tile border border-line">
                {s.rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    projects={names}
                    waiting={s.matches[rule.id] ?? []}
                    onToggle={(enabled) => void save({ ...rule, enabled })}
                    onRemove={() => void send('/api/approvals/rules/remove', { id: rule.id })}
                  />
                ))}
              </ul>
            )}
            <NewRule projects={projectList} onAdd={save} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Answered by rules, last 7 days</h3>
            {s.answers.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-line-soft rounded-tile border border-line">
                {s.answers.map((a) => (
                  <li key={a.decisionId} className="flex items-start gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={decisionHref(a.projectId, a.decisionId)}
                        className="font-medium hover:underline"
                      >
                        {a.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {names.get(a.projectId) ?? 'A project'} · chose “{a.option}” · rule “
                        {a.rule}” · {timeAgo(a.at)}
                      </p>
                    </div>
                    {a.undoneAt ? (
                      <span className="text-xs text-muted">Undone, back with you</span>
                    ) : (
                      <button
                        type="button"
                        className={BUTTON.secondary}
                        onClick={() =>
                          void send('/api/approvals/undo', { decisionId: a.decisionId })
                        }
                      >
                        <Undo2 className="size-3.5" aria-hidden /> Undo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function Suggestion({
  suggestion: g,
  onAdd,
}: {
  suggestion: ApprovalSuggestion;
  onAdd: (rule: ApprovalRuleInput) => Promise<void>;
}) {
  const changed = g.answered - g.followed;
  return (
    <li className="flex flex-wrap items-center gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p>
          Questions with “<span className="font-medium">{g.word}</span>”: you took the
          recommendation {g.followed} of {g.answered} times in 30 days.
        </p>
        <p className="text-xs text-muted">
          {changed
            ? `You answered differently ${plural(changed, 'time')}, so this rule ${waitText(g.waitHours)}.`
            : `This rule ${waitText(g.waitHours)}.`}
        </p>
      </div>
      <button
        type="button"
        className={BUTTON.accent}
        onClick={() =>
          void onAdd({
            name: `Yes to “${g.word}”`,
            words: [g.word],
            waitHours: g.waitHours,
            enabled: true,
          })
        }
      >
        <Plus className="size-3.5" aria-hidden /> Add this rule
      </button>
    </li>
  );
}

function RuleRow({
  rule,
  projects,
  waiting,
  onToggle,
  onRemove,
}: {
  rule: ApprovalRule;
  projects: Map<string, string>;
  waiting: ApprovalsState['matches'][string];
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const where = rule.projectIds?.length
    ? rule.projectIds.map((id) => projects.get(id) ?? 'a project').join(', ')
    : 'every project';
  return (
    <li className="space-y-1 p-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-muted">
            Questions with {rule.words.map((w) => `“${w}”`).join(' or ')} · {where} ·{' '}
            {waitText(rule.waitHours)}
          </p>
        </div>
        <Switch checked={rule.enabled} label={`Rule “${rule.name}” on`} onChange={onToggle} />
        <button
          type="button"
          aria-label={`Remove rule “${rule.name}”`}
          className={BUTTON.secondary}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      {waiting.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">
            {rule.enabled
              ? `${plural(waiting.length, 'decision')} waiting now match it`
              : `Turned on, it would answer ${plural(waiting.length, 'decision')} waiting now`}
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {waiting.map((d) => (
              <li key={d.id}>
                <Link to={decisionHref(d.projectId, d.id)} className="hover:underline">
                  {d.title}
                </Link>{' '}
                · {projects.get(d.projectId) ?? 'a project'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function NewRule({
  projects,
  onAdd,
}: {
  projects: Entity<'project'>[];
  onAdd: (rule: ApprovalRuleInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [words, setWords] = useState('');
  const [wait, setWait] = useState(0);
  const [project, setProject] = useState('');
  const list = words
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2)
    .slice(0, APPROVAL.maxWords);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!list.length) return;
    await onAdd({
      name: name.trim() || `Yes to ${list.map((w) => `“${w}”`).join(', ')}`,
      words: list,
      waitHours: wait,
      enabled: true,
      ...(project ? { projectIds: [project] } : {}),
    });
    setName('');
    setWords('');
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Add a rule"
      className="space-y-2 rounded-tile border border-dashed border-line-strong p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label="Words in the question"
          placeholder="Words in the question, e.g. merge, link"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          className={INPUT}
        />
        <input
          aria-label="Name (optional)"
          placeholder="Name (optional)"
          value={name}
          maxLength={APPROVAL.nameChars}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Which projects"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className={SELECT}
        >
          <option value="">Every project</option>
          {projects
            .filter((p) => p.data.status !== 'archived')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.data.name}
              </option>
            ))}
        </select>
        <select
          aria-label="When it answers"
          value={wait}
          onChange={(e) => setWait(Number(e.target.value))}
          className={SELECT}
        >
          {WAITS.map((h) => (
            <option key={h} value={h}>
              {h === 0 ? 'Answer at once' : `Wait ${h} h for me first`}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!list.length} className={BUTTON.primary}>
          Add rule
        </button>
      </div>
    </form>
  );
}
