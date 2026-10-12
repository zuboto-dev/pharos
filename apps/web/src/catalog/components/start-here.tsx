import {
  ENTITIES,
  evidenceId,
  runQuery,
  type Entity,
  type EvidenceItem,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { ArrowDown } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { formatDate, localToday } from '../../lib/format';
import { useViewData } from '../context';
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
    part: 'bg-neutral-50 dark:bg-neutral-800/60',
  },
  found: {
    label: 'Found',
    tone: 'blue',
    bar: 'border-l-sky-500 dark:border-l-sky-400',
    number: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    part: 'bg-neutral-50 dark:bg-neutral-800/60',
  },
  'needs-you': {
    label: 'Needs you',
    tone: 'amber',
    bar: 'border-l-amber-500 dark:border-l-amber-400',
    number: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    part: 'bg-amber-50 dark:bg-amber-950/50',
  },
};

const LABEL = 'text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400';

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
  const { entityById, actions } = useViewData();
  const shown = items.flatMap((item) => {
    const entity = entityById.get(evidenceId(item));
    if (!entity) return [];
    const title = labelOf(entity);
    const label = typeof item === 'string' ? undefined : item.label.trim() || undefined;
    return [{ entity, title, label: label === title ? undefined : label }];
  });
  if (!shown.length) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
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
            onClick={() => actions.open({ entity: e.id })}
            className="max-w-full truncate rounded-sm text-sky-600 hover:underline focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-sky-400"
          >
            {text}
          </button>
        );
      })}
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
        <span className="block font-medium text-neutral-900 dark:text-neutral-100">
          <span className="sr-only">Step {index + 1}: </span>
          {step.label}
        </span>
        {step.says && (
          <span className="block text-sm text-neutral-500 dark:text-neutral-400">{step.says}</span>
        )}
      </span>
    </>
  );
  const box = 'flex h-full w-full items-start gap-3 rounded-lg p-2.5 text-left';
  if (!step.target) return <div className={box}>{body}</div>;
  const target = step.target;
  return (
    <button
      type="button"
      onClick={(e) => scrollToWidget(e.currentTarget, target)}
      className={clsx(
        box,
        'group transition hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-sky-400 dark:hover:bg-neutral-800/60',
      )}
    >
      {body}
      <ArrowDown
        aria-hidden
        className="mt-1 size-3.5 shrink-0 text-neutral-300 transition group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-300"
      />
    </button>
  );
}

export function StartHere({ node }: { node: NodeOf<'StartHere'> }) {
  const data = useViewData();
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
        '@container space-y-4 rounded-xl border border-l-4 border-neutral-200 bg-white p-4 sm:p-5 dark:border-neutral-800 dark:bg-neutral-900',
        purpose.bar,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tone={purpose.tone}>{purpose.label}</Badge>
        <nav
          aria-label="Where this sits"
          className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400"
        >
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
      <div className="space-y-2">
        {node.why && (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            <span className={clsx(LABEL, 'mr-2')}>Why</span>
            {node.why}
          </p>
        )}
        {headline ? (
          <h2 className="text-xl font-bold tracking-tight text-balance text-neutral-900 sm:text-2xl dark:text-neutral-50">
            <TermText text={headline} ranges={ranges} />
          </h2>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {node.claim ? 'This finding was deleted or isn’t in this project' : 'No headline yet'}
          </p>
        )}
        {claim && <CertaintyMark claim={claim} />}
        {node.evidence && <Evidence items={node.evidence} />}
      </div>
      {node.yourPart && (
        <p
          className={clsx(
            'flex flex-col gap-0.5 rounded-lg px-3 py-2.5 @lg:flex-row @lg:items-baseline @lg:gap-3',
            purpose.part,
          )}
        >
          <span className={clsx(LABEL, 'shrink-0')}>Your part</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-50">{node.yourPart}</span>
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
