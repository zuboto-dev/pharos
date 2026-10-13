import {
  decisionState,
  ENTITIES,
  evidenceId,
  runQuery,
  type Entity,
  type EvidenceItem,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { ArrowDown, Check } from 'lucide-react';
import { useBoardFiles } from '../board-files';
import type { CSSProperties, ReactNode } from 'react';
import { formatDate, localToday } from '../../lib/format';
import { useViewData } from '../context';
import { fileIdsOf, LinkedFiles } from '../linked-files';
import { useOpenItem } from '../open-item';
import { firstUses, TermText, useTermMatcher } from '../terms';
import { Badge, isHttp, Uri, type Tone } from '../ui';
import { CertaintyMark } from './knowledge';

/**
 * The opening of a report page (docs/reframe/start-here.md): what the page is for, why the work
 * exists, its point in one sentence with the evidence behind it, the reader's part, where it sits,
 * and a short path into the widgets below.
 */

type Purpose = NodeOf<'StartHere'>['purpose'];

const PURPOSE: Record<
  Purpose,
  { label: string; tone: Tone; bar: string; number: string; part: string }
> = {
  done: {
    label: 'Done',
    tone: 'green',
    bar: 'border-l-emerald-500 dark:border-l-emerald-400',
    number: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    part: 'bg-sunken',
  },
  found: {
    label: 'Found',
    tone: 'blue',
    bar: 'border-l-sky-500 dark:border-l-sky-400',
    number: 'bg-sky-50 text-accent-strong dark:bg-sky-950',
    part: 'bg-sunken',
  },
  'needs-you': {
    label: 'Needs you',
    tone: 'amber',
    bar: 'border-l-amber-500 dark:border-l-amber-400',
    number: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    part: 'bg-amber-50 dark:bg-amber-950/50',
  },
};

const LABEL = 'text-xs font-medium tracking-wide text-muted uppercase';

/** "Oct 11", with the year when it isn't this year. */
function shortDate(date: string): string {
  return formatDate(date, date.slice(0, 4) === localToday().slice(0, 4));
}

function labelOf(entity: Entity): string {
  return String((entity.data as Record<string, unknown>)[ENTITIES[entity.type].label] ?? entity.id);
}

/** Scrolls to a widget on the same board as `from`; does nothing when it isn't there. */
export function scrollToWidget(from: HTMLElement, id: string): boolean {
  const find = (scope: HTMLElement) =>
    Array.from(scope.querySelectorAll<HTMLElement>('[data-widget]')).find(
      (el) => el.dataset.widget === id,
    );
  let scope = from.parentElement;
  let target: HTMLElement | undefined;
  while (scope && !(target = find(scope))) scope = scope.parentElement;
  if (!target) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  // Move focus too, so keyboard and screen-reader users land where the step pointed.
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}

/**
 * What backs the headline: a link for an artifact with a web address, otherwise a button that
 * opens the record. An item's short `label` (F5) is shown instead of its title; the title stays as
 * the tooltip and in the accessible name.
 */
function Evidence({ items }: { items: readonly EvidenceItem[] }) {
  const { entityById } = useViewData();
  const openItem = useOpenItem();
  const shown = items.flatMap((item) => {
    const entity = entityById.get(evidenceId(item));
    if (!entity) return [];
    const title = labelOf(entity);
    const label = typeof item === 'string' ? undefined : item.label.trim() || undefined;
    return [{ entity, title, label: label === title ? undefined : label }];
  });
  if (!shown.length) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
      <span>Evidence</span>
      {shown.map(({ entity: e, title, label }) => {
        const uri = e.type === 'artifact' ? (e as Entity<'artifact'>).data.uri : undefined;
        const text = (
          <>
            {label ?? title}
            {label && <span className="sr-only"> ({title})</span>}
          </>
        );
        return isHttp(uri) ? (
          <Uri key={e.id} uri={uri} title={label ? title : undefined}>
            {text}
          </Uri>
        ) : (
          <button
            key={e.id}
            type="button"
            title={label ? title : undefined}
            onClick={() => openItem(e.id)}
            className="max-w-full truncate rounded-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            {text}
          </button>
        );
      })}
      {/* The papers the evidence links (R7.12), one tap from the opening. */}
      <LinkedFiles ids={[...new Set(shown.flatMap(({ entity }) => fileIdsOf(entity) ?? []))]} />
    </p>
  );
}

function Step({
  step,
  index,
  numberClass,
}: {
  step: NodeOf<'StartHere'>['path'][number];
  index: number;
  numberClass: string;
}) {
  const body: ReactNode = (
    <>
      <span
        aria-hidden
        className={clsx(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          numberClass,
        )}
      >
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">
          <span className="sr-only">Step {index + 1}: </span>
          {step.label}
        </span>
        {step.says && <span className="block text-sm text-muted">{step.says}</span>}
      </span>
    </>
  );
  const box = 'flex h-full w-full items-start gap-3 rounded-tile p-2.5 text-left';
  if (!step.target) return <div className={box}>{body}</div>;
  const target = step.target;
  return (
    <button
      type="button"
      onClick={(e) => scrollToWidget(e.currentTarget, target)}
      className={clsx(
        box,
        'group transition hover:bg-sunken focus-visible:outline-2 focus-visible:outline-sky-400',
      )}
    >
      {body}
      <ArrowDown
        aria-hidden
        className="mt-1 size-3.5 shrink-0 text-faint transition group-hover:text-neutral-500 dark:group-hover:text-neutral-300"
      />
    </button>
  );
}

/**
 * When "your part" points at a DecisionBlock that has been answered, what was decided (v0.2 B10):
 * the page then says "Done: you chose …" instead of asking again.
 */
function useAnsweredPart(target: string | undefined): string | undefined {
  const board = useBoardFiles();
  const { entityById } = useViewData();
  const widget = target ? board?.widget(target) : undefined;
  if (widget?.node.component !== 'DecisionBlock') return undefined;
  const decision = entityById.get(widget.node.decision);
  if (decision?.type !== 'decision') return undefined;
  const state = decisionState((decision as Entity<'decision'>).data);
  if (state.kind === 'chosen') return `Done: you chose “${state.option.label}”`;
  if (state.kind === 'answered') return `Done: you answered “${state.answer}”`;
  return undefined;
}

export function StartHere({ node }: { node: NodeOf<'StartHere'> }) {
  const data = useViewData();
  const done = useAnsweredPart(node.yourPartTarget);
  const matcher = useTermMatcher(node.terms);
  const purpose = PURPOSE[node.purpose];
  const claim = node.claim ? runQuery(data, 'claim', { where: { id: node.claim } })[0] : undefined;
  const headline = claim?.data.statement ?? node.headline;
  const [ranges] = firstUses([headline ?? ''], matcher);
  const stage = node.stageId ? data.stageById.get(node.stageId) : undefined;
  const goal = node.goalId ? data.entityById.get(node.goalId) : undefined;
  const where = [
    data.project.data.name,
    stage && labelOf(stage),
    goal?.type === 'goal' ? labelOf(goal) : undefined,
  ].filter((s): s is string => !!s);
  const columns = { '--cols': `repeat(${node.path.length}, minmax(0, 1fr))` } as CSSProperties;
  return (
    <section
      aria-label={`${purpose.label}: start here`}
      className={clsx(
        '@container space-y-3 rounded-block border border-l-4 border-line bg-surface p-4',
        purpose.bar,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tone={purpose.tone}>{purpose.label}</Badge>
        <nav aria-label="Where this sits" className="min-w-0 text-xs text-muted">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {where.map((part, i) => (
              <li key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span aria-hidden>›</span>}
                <span className="truncate">{part}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden>·</span>
              <time dateTime={node.date}>{shortDate(node.date)}</time>
            </li>
          </ol>
        </nav>
        {node.purpose === 'needs-you' && node.due && (
          <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Answer by <time dateTime={node.due}>{shortDate(node.due)}</time>
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {node.why && (
          <p className="text-sm text-ink-soft">
            <span className={clsx(LABEL, 'mr-2')}>Why</span>
            {node.why}
          </p>
        )}
        {headline ? (
          <h2 className="text-xl font-bold tracking-tight text-balance text-ink sm:text-2xl">
            <TermText text={headline} ranges={ranges} />
          </h2>
        ) : (
          <p className="text-sm text-muted">
            {node.claim ? 'This finding was deleted or isn’t in this project' : 'No headline yet'}
          </p>
        )}
        {claim && <CertaintyMark claim={claim} />}
        {node.evidence && <Evidence items={node.evidence} />}
      </div>
      {node.yourPart && (
        <p
          className={clsx(
            'flex flex-col gap-0.5 rounded-tile px-3 py-2.5 @lg:flex-row @lg:items-baseline @lg:gap-3',
            purpose.part,
          )}
        >
          <span className={clsx(LABEL, 'shrink-0')}>Your part</span>
          <span className="font-medium text-ink">
            {done ? (
              <span className="inline-flex items-baseline gap-1.5">
                <Check aria-hidden className="size-4 shrink-0 self-center text-ok" />
                {done}
              </span>
            ) : (
              node.yourPart
            )}
          </span>
          {node.yourPartTarget && (
            <button
              type="button"
              onClick={(e) => scrollToWidget(e.currentTarget, node.yourPartTarget!)}
              className="mt-1 inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium text-accent-strong hover:underline @lg:mt-0 @lg:ml-auto"
            >
              {done ? 'See it' : node.purpose === 'needs-you' ? 'Answer it' : 'Go there'}{' '}
              <ArrowDown aria-hidden className="size-3.5" />
            </button>
          )}
        </p>
      )}
      <nav aria-label="Reading path" className="space-y-1.5">
        <h3 className={LABEL}>Start here</h3>
        <ol style={columns} className="-mx-2.5 grid grid-cols-1 gap-1 @2xl:grid-cols-(--cols)">
          {node.path.map((step, i) => (
            <li key={i} className="min-w-0">
              <Step step={step} index={i} numberClass={purpose.number} />
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
