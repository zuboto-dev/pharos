import {
  runQuery,
  WEAK_BECAUSE_LABELS,
  type Entity,
  type EntityType,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  FileText,
  SearchX,
  TriangleAlert,
} from 'lucide-react';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { formatDate, localToday } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { useOptions } from '../options';
import { Popover, usePopover } from '../popover';
import { LinkedFiles } from '../linked-files';
import { LocalSourcePath, linkedFileOf } from '../source-file';
import { firstUses, firstUsesByKey, TermText, useTermMatcher, type TermRange } from '../terms';
import { AskAgentButton, EmptyState } from '../empty-state';
import { Badge, Dot, isHttp, Uri, type Tone } from '../ui';
import {
  OpenTasks,
  ProgressLine,
  progressScale,
  stepProgress,
  type StepProgress,
} from './layer-progress';

/**
 * The explain blocks: stored claims (findings) with how sure each is and where it comes from.
 * They read claims, their sources (artifacts) and the decisions behind "Confirmed by you" from
 * the project's data; the view holds only ids, tags and filters.
 */

type Claim = Entity<'claim'>;
type Artifact = Entity<'artifact'>;
type ExplainTone = NonNullable<NodeOf<'ClaimCard'>['tone']>;
type Layer = NodeOf<'Layers'>['layers'][number];

const BADGE_TONE: Record<ExplainTone, Tone> = {
  neutral: 'neutral',
  own: 'blue',
  watch: 'amber',
  gap: 'red',
};

const BORDER: Record<ExplainTone, string> = {
  neutral: 'border-line',
  own: 'border-sky-300 dark:border-sky-800',
  watch: 'border-amber-300 dark:border-amber-800',
  gap: 'border-rose-300 dark:border-rose-800',
};

const STRONG_BORDER: Record<ExplainTone, string> = {
  neutral: 'border-neutral-500 dark:border-neutral-400',
  own: 'border-sky-500 dark:border-sky-400',
  watch: 'border-amber-500 dark:border-amber-400',
  gap: 'border-rose-500 dark:border-rose-400',
};

const KICKER: Record<ExplainTone, string> = {
  neutral: 'text-muted',
  own: 'text-accent-strong',
  watch: 'text-amber-700 dark:text-amber-300',
  gap: 'text-rose-700 dark:text-rose-300',
};

const GLYPH_COLOR: Record<Tone, string> = {
  neutral: 'text-muted',
  blue: 'text-accent',
  green: 'text-ok',
  amber: 'text-warn',
  red: 'text-danger',
  violet: 'text-violet-600 dark:text-violet-400',
  muted: 'text-faint',
};

/** The shape says how sure, next to the word, so colour never carries it alone. */
const GLYPHS: Record<string, string> = { reading: '◐', verified: '●', confirmed: '◆' };

const MEANING_LINES: Record<string, (date: string, decision?: string) => string> = {
  reading: () => "An agent's analysis of the sources. Not checked as a fact, and not tested.",
  verified: (date) => `Read from the linked source on ${date}.`,
  confirmed: (date, decision) =>
    decision ? `You decided this: ${decision}, ${date}.` : `You decided this on ${date}.`,
};

function entityOf<T extends EntityType>(
  byId: ViewData['entityById'],
  id: string | undefined,
  type: T,
): Entity<T> | undefined {
  const entity = id ? byId.get(id) : undefined;
  return entity?.type === type ? (entity as Entity<T>) : undefined;
}

function findClaim(data: ViewData, id: string): Claim | undefined {
  return runQuery(data, 'claim', { where: { id } })[0];
}

/** The claim's sources that exist, in order. */
function sourcesOf(byId: ViewData['entityById'], claim: Claim): Artifact[] {
  return claim.data.sourceIds
    .map((id) => entityOf(byId, id, 'artifact'))
    .filter((s): s is Artifact => !!s);
}

/** The source the claim's quote comes from: `quoteSourceId`, else its first source. */
function quoteSourceOf(byId: ViewData['entityById'], claim: Claim): Artifact | undefined {
  return entityOf(byId, claim.data.quoteSourceId, 'artifact') ?? sourcesOf(byId, claim)[0];
}

/**
 * A source's title: a link that opens in a new tab for a web address, otherwise a button that
 * opens the project file it is (R7.6), or else the artifact, in the drawer.
 */
function SourceTitle({ source, onOpen }: { source: Artifact; onOpen?: () => void }) {
  const { actions, entityById } = useViewData();
  if (isHttp(source.data.uri)) return <Uri uri={source.data.uri}>{source.data.title}</Uri>;
  const fileId = linkedFileOf(entityById, source);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
        actions.open({ entity: fileId ?? source.id });
      }}
      className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
    >
      <FileText className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{source.data.title}</span>
    </button>
  );
}

/** "Oct 11", with the year when it isn't this year. */
function shortDate(date: string): string {
  return formatDate(date, date.slice(0, 4) === localToday().slice(0, 4));
}

// ------------------------------------------------------------------ certainty mark

/**
 * "◐ Our reading, Oct 11" and its source: a link for one web source, otherwise a "Source" or
 * "Sources (n)" button. Tapping the mark or that button explains it: what the word means, who
 * said it, and every source, with a local file's path and the quoted passage under its source.
 */
export function CertaintyMark({
  claim,
  sourceLabel = 'short',
  passage = true,
}: {
  claim: Claim;
  /** short: "Source ↗"; title: the source's title, for a mark shared by a whole block. */
  sourceLabel?: 'short' | 'title';
  /** Show the quoted passage under its source; off for a mark that stands for several claims. */
  passage?: boolean;
}) {
  const { entityById } = useViewData();
  const options = useOptions();
  const { anchor, trigger, close } = usePopover();
  const option = options.get('claim.certainty', claim.data.certainty);
  const meaning = options.meaning('claim.certainty', claim.data.certainty) ?? '';
  const decision = entityOf(entityById, claim.data.confirmedById, 'decision');
  const date =
    meaning === 'confirmed'
      ? (decision?.data.decisionDate ?? claim.data.checkedOn)
      : claim.data.checkedOn;
  const sources = sourcesOf(entityById, claim);
  const [only] = sources;
  // A single web source is a plain link; a local one, or several, open the list with the passage.
  const singleLink = sources.length === 1 && isHttp(only!.data.uri) ? only : undefined;
  const { quote, locator, weakBecause, assumption } = claim.data;
  // The source the passage (or just where it sits) comes from; off for a shared mark.
  const quoteSource = passage && (quote || locator) ? quoteSourceOf(entityById, claim) : undefined;
  const author = entityOf(entityById, claim.data.authorId, 'assignee');
  const glyph = GLYPHS[meaning] ?? '○';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted">
      <button
        type="button"
        {...trigger}
        title="How sure this is"
        className="inline-flex items-baseline gap-1 rounded-sm text-left font-medium text-ink-soft hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-sky-400 dark:hover:text-white"
      >
        <span aria-hidden className={GLYPH_COLOR[option.color]}>
          {glyph}
        </span>
        <span>
          {option.label}, {shortDate(date)}
        </span>
      </button>
      {sources.length > 0 && sourceLabel === 'title' && <span aria-hidden>·</span>}
      {singleLink ? (
        <Uri uri={singleLink.data.uri!} title={singleLink.data.title}>
          {sourceLabel === 'title' ? singleLink.data.title : 'Source'}
        </Uri>
      ) : (
        sources.length > 0 && (
          <button
            type="button"
            {...trigger}
            className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left text-accent hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <span className="truncate">
              {sources.length > 1
                ? `Sources (${sources.length})`
                : sourceLabel === 'title'
                  ? only!.data.title
                  : 'Source'}
            </span>
            {sources.every((s) => isHttp(s.data.uri)) ? (
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            ) : (
              <FileText className="size-3 shrink-0" aria-hidden />
            )}
          </button>
        )
      )}
      {/* "Confirmed by you" rests on the owner's decision, so it needs no source to be sound. */}
      {!sources.length && meaning !== 'confirmed' && (
        <span className="text-faint">no source yet</span>
      )}
      {weakBecause && (
        <span title="Why the evidence is thin" className="text-warn">
          {WEAK_BECAUSE_LABELS[weakBecause]}
        </span>
      )}
      {anchor && (
        <Popover anchor={anchor} label={option.label} onClose={close}>
          <div className="flex items-baseline gap-1.5 font-semibold text-ink">
            <span aria-hidden className={GLYPH_COLOR[option.color]}>
              {glyph}
            </span>
            {option.label}
          </div>
          {MEANING_LINES[meaning] && (
            <p>{MEANING_LINES[meaning](formatDate(date), decision?.data.title)}</p>
          )}
          {author && <p className="text-xs text-muted">By {author.data.name}</p>}
          <p className="text-xs text-muted">Checked {formatDate(claim.data.checkedOn)}</p>
          {passage && assumption && (
            <p className="text-xs break-words text-muted">
              <span className="font-medium text-ink">Assumes:</span> {assumption}
            </p>
          )}
          {sources.length > 0 && (
            <ul className="space-y-2 border-t border-line-soft pt-2">
              {sources.map((s) => (
                <li key={s.id} className="min-w-0 space-y-1">
                  <div className="flex min-w-0">
                    <SourceTitle source={s} onOpen={() => close(false)} />
                  </div>
                  <LocalSourcePath source={s} onOpen={() => close(false)} />
                  {s.id === quoteSource?.id && quote && (
                    <blockquote className="border-l-2 border-neutral-300 pl-2 text-xs break-words text-ink-soft italic dark:border-neutral-600">
                      “{quote}”
                    </blockquote>
                  )}
                  {s.id === quoteSource?.id && locator && (
                    <p className="text-xs text-muted">{locator}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ claim card

/**
 * What a claim rests on, behind a small toggle so the card stays short: the quoted passage with
 * its source ("From source") and the assumption ("Our reading"). Renders a button and, when open,
 * a full-width panel; the parent is a wrapping flex row, so the panel drops to its own line.
 */
export function ClaimBasis({
  claim,
  defaultOpen = false,
  caption = true,
}: {
  claim: Claim;
  /** Start open, for a panel the reader has already opened (a chart's bar). */
  defaultOpen?: boolean;
  /** Name the quote's source and locator under it; off when the parent lists the sources. */
  caption?: boolean;
}) {
  const { entityById } = useViewData();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { quote, assumption, locator } = claim.data;
  if (!quote && !assumption) return null;
  const source = quoteSourceOf(entityById, claim);
  const label = quote && assumption ? 'Quote and assumption' : quote ? 'Quote' : 'Assumption';
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded-sm text-xs font-medium text-muted hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-sky-400 dark:hover:text-white"
      >
        {label}
        <ChevronDown
          aria-hidden
          className={clsx('size-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={panelId} className="basis-full space-y-1.5 pt-1 text-sm">
          {quote && (
            <figure className="min-w-0 space-y-0.5">
              <blockquote className="border-l-2 border-neutral-300 pl-3 break-words text-ink-soft italic dark:border-neutral-600">
                “{quote}”
              </blockquote>
              {caption && (source || locator) && (
                <figcaption className="flex min-w-0 flex-wrap items-baseline gap-x-1 pl-3 text-xs text-muted">
                  <span aria-hidden>—</span>
                  {source && <SourceTitle source={source} />}
                  {source && locator && <span aria-hidden>·</span>}
                  {locator && <span>{locator}</span>}
                </figcaption>
              )}
            </figure>
          )}
          {assumption && (
            <p className="break-words text-muted">
              <span className="font-medium text-ink">Assumes:</span> {assumption}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function ClaimCard({ node }: { node: NodeOf<'ClaimCard'> }) {
  const data = useViewData();
  const matcher = useTermMatcher(node.terms);
  const claim = findClaim(data, node.claim);
  if (!claim)
    return (
      <EmptyState
        icon={SearchX}
        title="This finding was deleted or isn’t in this project"
        hint="Ask your agent to point this block at another finding."
      >
        <AskAgentButton question="Point this block at a finding that’s in the project." />
      </EmptyState>
    );
  const { statement, detail } = claim.data;
  const [statementTerms, detailTerms] = firstUses([statement, detail ?? ''], matcher);
  const tone = node.tone ?? 'neutral';
  const kicker = node.kicker && (
    <p className={clsx('text-xs font-semibold tracking-wider uppercase', KICKER[tone])}>
      {node.kicker}
    </p>
  );
  if (node.size === 'headline') {
    return (
      <header className="space-y-2 py-1">
        {kicker}
        <h2 className="text-2xl font-bold tracking-tight text-balance text-ink sm:text-3xl">
          <TermText text={statement} ranges={statementTerms} />
        </h2>
        {detail && (
          <p className="max-w-[60ch] text-base text-ink-soft">
            <TermText text={detail} ranges={detailTerms} />
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <CertaintyMark claim={claim} />
          <ClaimBasis claim={claim} />
        </div>
        <LinkedFiles ids={claim.data.fileIds} />
      </header>
    );
  }
  return (
    <article
      className={clsx(
        'flex h-full min-w-0 flex-col gap-1.5 rounded-block border bg-surface p-4',
        BORDER[tone],
      )}
    >
      {kicker}
      <p className="font-semibold text-ink">
        <TermText text={statement} ranges={statementTerms} />
      </p>
      {detail && (
        <p className="text-sm text-muted">
          <TermText text={detail} ranges={detailTerms} />
        </p>
      )}
      <LinkedFiles ids={claim.data.fileIds} />
      <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
        <CertaintyMark claim={claim} />
        <ClaimBasis claim={claim} />
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ layers

type LayerModel = {
  layer: Layer;
  /** The claim behind the pill's label, shown first with its own mark. */
  pill?: Claim;
  /** The layer's items, sorted. */
  claims: Claim[];
  /** Items without `aboutId`, shown as lines. */
  lines: Claim[];
  /** Items grouped by the artifact they're about, in first-seen order. */
  cards: { about: Artifact; claims: Claim[] }[];
  /** The step's tasks, when it counts progress. */
  progress?: StepProgress;
};

function layerModels(data: ViewData, node: NodeOf<'Layers'>): LayerModel[] {
  return node.layers.map((layer) => {
    const pillId = layer.pill?.claim;
    const pill = pillId ? findClaim(data, pillId) : undefined;
    // A step without `items` is a label only: it holds no claims (an empty filter would match all).
    const claims = layer.items
      ? runQuery(data, 'claim', { sort: [{ field: 'order' }], ...layer.items }).filter(
          (c) => c.id !== pillId,
        )
      : [];
    const lines: Claim[] = [];
    const cards = new Map<string, { about: Artifact; claims: Claim[] }>();
    for (const claim of claims) {
      const about = entityOf(data.entityById, claim.data.aboutId, 'artifact');
      if (!about) {
        lines.push(claim);
        continue;
      }
      const card = cards.get(about.id) ?? { about, claims: [] };
      card.claims.push(claim);
      cards.set(about.id, card);
    }
    return {
      layer,
      pill,
      claims,
      lines,
      cards: [...cards.values()],
      progress: stepProgress(data, layer),
    };
  });
}

/**
 * When every item shares certainty, checked date and one source, the block shows one mark under
 * it instead of repeating it on each claim. The claim returned stands for all of them.
 */
export function sharedMarkOf(claims: readonly Claim[]): Claim | undefined {
  const [first] = claims;
  if (!first || claims.length < 2 || first.data.sourceIds.length !== 1) return undefined;
  const same = claims.every(
    (c) =>
      c.data.certainty === first.data.certainty &&
      c.data.checkedOn === first.data.checkedOn &&
      c.data.sourceIds.length === 1 &&
      c.data.sourceIds[0] === first.data.sourceIds[0],
  );
  return same ? first : undefined;
}

/** Texts of one claim, keyed for `firstUsesByKey`. */
function claimTexts(prefix: string, claim: Claim): [string, string][] {
  return [
    [`${prefix}:${claim.id}:s`, claim.data.statement],
    [`${prefix}:${claim.id}:d`, claim.data.detail ?? ''],
  ];
}

/** Texts inside an open layer, in reading order. */
function panelTexts(m: LayerModel): [string, string][] {
  const key = m.layer.key;
  return [
    ...(m.pill ? claimTexts(key, m.pill) : []),
    ...m.lines.flatMap((c) => claimTexts(key, c)),
    ...m.cards.flatMap((card) => card.claims.flatMap((c) => claimTexts(key, c))),
  ];
}

type Shared = {
  terms: Map<string, TermRange[]>;
  /** Hide per-claim marks: the block shows one for all. */
  hideMarks: boolean;
  warnTag: string;
};

function ClaimLine({
  claim,
  prefix,
  shared,
  mark = !shared.hideMarks,
  strong = false,
}: {
  claim: Claim;
  prefix: string;
  shared: Shared;
  mark?: boolean;
  strong?: boolean;
}) {
  const statement = (
    <TermText text={claim.data.statement} ranges={shared.terms.get(`${prefix}:${claim.id}:s`)} />
  );
  const detail = claim.data.detail && (
    <TermText text={claim.data.detail} ranges={shared.terms.get(`${prefix}:${claim.id}:d`)} />
  );
  // The quote and assumption open per line, even when the block shares one mark.
  const hasBasis = !!(claim.data.quote || claim.data.assumption);
  const evidence = (mark || hasBasis) && (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {mark && <CertaintyMark claim={claim} />}
      <ClaimBasis claim={claim} />
    </div>
  );
  if (claim.data.tags.includes(shared.warnTag)) {
    return (
      <div
        role="note"
        className="flex gap-2 rounded-control bg-amber-50 px-2.5 py-2 text-sm text-amber-950 dark:bg-amber-950/60 dark:text-amber-100"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0 space-y-1">
          <p>
            <span className="sr-only">Watch out: </span>
            {statement}
          </p>
          {detail && <p className="text-xs">{detail}</p>}
          {evidence}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <p className={clsx('text-ink', strong ? 'font-semibold' : 'text-sm')}>{statement}</p>
      {detail && <p className="text-sm text-muted">{detail}</p>}
      {evidence}
    </div>
  );
}

function NothingYet() {
  return <p className="text-sm text-faint">Nothing here yet</p>;
}

function LayerPanel({
  m,
  shared,
  highlightAbout,
}: {
  m: LayerModel;
  shared: Shared;
  highlightAbout?: string;
}) {
  const key = m.layer.key;
  if (!m.pill && !m.claims.length && !m.progress) return <NothingYet />;
  return (
    <>
      {m.progress && <OpenTasks progress={m.progress} />}
      {m.pill && <ClaimLine claim={m.pill} prefix={key} shared={shared} mark />}
      {m.lines.map((c) => (
        <ClaimLine key={c.id} claim={c} prefix={key} shared={shared} />
      ))}
      {m.cards.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] items-start gap-3">
          {m.cards.map(({ about, claims }) => {
            const accent = about.id === highlightAbout;
            const warns = claims.some((c) => c.data.tags.includes(shared.warnTag));
            return (
              <div
                key={about.id}
                className={clsx(
                  'min-w-0 space-y-2 rounded-tile border p-3',
                  accent
                    ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40'
                    : warns
                      ? 'border-amber-300 dark:border-amber-800'
                      : 'border-line',
                )}
              >
                <h4 className="text-sm font-semibold text-ink">{about.data.title}</h4>
                {claims.map((c) => (
                  <ClaimLine key={c.id} claim={c} prefix={key} shared={shared} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stack({
  node,
  models,
  hideMarks,
}: {
  node: NodeOf<'Layers'>;
  models: LayerModel[];
  hideMarks: boolean;
}) {
  const [open, setOpen] = useState<string | null>(node.open ?? null);
  const matcher = useTermMatcher(node.terms);
  const id = useId();
  // Reading order: each layer's title and hint, then its panel when it's open.
  const terms = firstUsesByKey(
    models.flatMap((m): [string, string][] => [
      [`${m.layer.key}:title`, m.layer.title],
      [`${m.layer.key}:hint`, m.layer.hint ?? ''],
      ...(m.layer.key === open ? panelTexts(m) : []),
    ]),
    matcher,
  );
  const shared: Shared = { terms, hideMarks, warnTag: node.warnTag ?? 'watch' };
  const scale = progressScale(models.map((m) => m.progress));
  return (
    <div className="space-y-1.5">
      {models.map((m, i) => {
        const { layer } = m;
        const isOpen = layer.key === open;
        const ids = {
          button: `${id}-${i}-button`,
          panel: `${id}-${i}-panel`,
          key: `${id}-${i}-key`,
          title: `${id}-${i}-title`,
          hint: `${id}-${i}-hint`,
          pill: `${id}-${i}-pill`,
          progress: `${id}-${i}-progress`,
        };
        const labelledBy = [
          ids.key,
          ids.title,
          layer.hint && ids.hint,
          layer.pill && ids.pill,
          m.progress && ids.progress,
        ]
          .filter(Boolean)
          .join(' ');
        const tone = layer.pill?.tone ?? 'neutral';
        return (
          <div key={layer.key} className="space-y-1.5">
            {/* The whole row is one button underneath; the text sits on top so the terms in it
                stay buttons of their own (a button can't hold another). */}
            <div
              className={clsx(
                'relative rounded-block bg-surface motion-safe:transition',
                isOpen
                  ? 'border border-sky-500 ring-1 ring-sky-500 dark:border-sky-400 dark:ring-sky-400'
                  : layer.highlight
                    ? clsx('border-2 border-dashed', STRONG_BORDER[tone])
                    : 'border border-line hover:border-neutral-400 dark:hover:border-neutral-600',
              )}
            >
              <button
                type="button"
                id={ids.button}
                aria-expanded={isOpen}
                aria-controls={ids.panel}
                aria-labelledby={labelledBy}
                onClick={() => setOpen(isOpen ? null : layer.key)}
                className="absolute inset-0 cursor-pointer rounded-block outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
              />
              <div className="pointer-events-none relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-4">
                <span
                  id={ids.key}
                  className="flex size-8 items-center justify-center rounded-full border border-neutral-300 text-sm font-medium text-ink-soft tabular-nums dark:border-neutral-600"
                >
                  <span className="sr-only">Layer </span>
                  {layer.key}
                </span>
                <span className="min-w-0">
                  <span id={ids.title} className="block font-semibold text-ink">
                    <TermText text={layer.title} ranges={terms.get(`${layer.key}:title`)} />
                  </span>
                  {layer.hint && (
                    <span id={ids.hint} className="block text-sm text-muted">
                      <TermText text={layer.hint} ranges={terms.get(`${layer.key}:hint`)} />
                    </span>
                  )}
                  {m.progress && (
                    <span className="mt-1.5 block max-w-xs">
                      <ProgressLine progress={m.progress} scale={scale} id={ids.progress} />
                    </span>
                  )}
                </span>
                <span className="col-start-2 flex items-center gap-2 justify-self-start sm:col-start-auto sm:justify-self-end">
                  {layer.pill && (
                    <span id={ids.pill}>
                      <Badge tone={BADGE_TONE[layer.pill.tone]}>{layer.pill.label}</Badge>
                    </span>
                  )}
                  <ChevronDown
                    aria-hidden
                    className={clsx(
                      'hidden size-4 text-faint motion-safe:transition sm:block',
                      isOpen && 'rotate-180',
                    )}
                  />
                </span>
              </div>
            </div>
            <div
              id={ids.panel}
              role="region"
              aria-labelledby={ids.title}
              hidden={!isOpen}
              className="space-y-3 rounded-block border border-line bg-surface p-4"
            >
              {isOpen && <LayerPanel m={m} shared={shared} highlightAbout={node.highlightAbout} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  node,
  models,
  hideMarks,
}: {
  node: NodeOf<'Layers'>;
  models: LayerModel[];
  hideMarks: boolean;
}) {
  const matcher = useTermMatcher(node.terms);
  const terms = firstUsesByKey(
    models.flatMap((m): [string, string][] => [
      [`${m.layer.key}:title`, m.layer.title],
      [`${m.layer.key}:hint`, m.layer.hint ?? ''],
      ...(m.pill ? claimTexts(m.layer.key, m.pill) : []),
      ...m.claims.flatMap((c) => claimTexts(m.layer.key, c)),
    ]),
    matcher,
  );
  const shared: Shared = { terms, hideMarks, warnTag: node.warnTag ?? 'watch' };
  const scale = progressScale(models.map((m) => m.progress));
  const [tasksOpen, setTasksOpen] = useState<string | null>(null);
  const id = useId();
  const { axis } = node;
  const columns = { '--cols': `repeat(${models.length}, minmax(0, 1fr))` } as CSSProperties;
  const axisLabel = 'text-xs font-medium tracking-wide text-muted uppercase';
  return (
    <div>
      {axis && (
        <p className={clsx('mb-1.5 sm:hidden', axisLabel)}>
          <span aria-hidden>↑ </span>
          {axis.from}
        </p>
      )}
      <div
        style={columns}
        className="grid grid-cols-1 overflow-hidden rounded-block border border-line bg-surface sm:grid-cols-(--cols)"
      >
        {models.map((m, i) => {
          const { layer } = m;
          const tasksId = `${id}-${i}-tasks`;
          const showTasks = tasksOpen === layer.key;
          return (
            <section
              key={layer.key}
              aria-label={layer.title}
              className={clsx(
                'min-w-0 space-y-2 border-b border-line p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0',
                layer.highlight && 'bg-sky-50 dark:bg-sky-950/40',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className={axisLabel}>
                  <TermText text={layer.title} ranges={terms.get(`${layer.key}:title`)} />
                </h4>
                {layer.pill && <Badge tone={BADGE_TONE[layer.pill.tone]}>{layer.pill.label}</Badge>}
              </div>
              {layer.hint && (
                <p className="text-sm text-muted">
                  <TermText text={layer.hint} ranges={terms.get(`${layer.key}:hint`)} />
                </p>
              )}
              {m.progress && (
                <ProgressLine
                  progress={m.progress}
                  scale={scale}
                  toggle={
                    m.progress.total
                      ? {
                          open: showTasks,
                          controls: tasksId,
                          onToggle: () => setTasksOpen(showTasks ? null : layer.key),
                        }
                      : undefined
                  }
                />
              )}
              {m.progress && showTasks && <OpenTasks progress={m.progress} id={tasksId} />}
              {/* The claim behind the pill comes first, as in the stack: it's the part's status. */}
              {m.pill && <ClaimLine claim={m.pill} prefix={layer.key} shared={shared} mark />}
              {m.claims.map((c) => (
                <ClaimLine key={c.id} claim={c} prefix={layer.key} shared={shared} strong />
              ))}
              {!m.claims.length && !m.pill && !m.progress && <NothingYet />}
            </section>
          );
        })}
      </div>
      {axis && (
        <>
          <p className={clsx('mt-1.5 sm:hidden', axisLabel)}>
            <span aria-hidden>↓ </span>
            {axis.to}
          </p>
          <p className={clsx('mt-1.5 hidden justify-between gap-4 sm:flex', axisLabel)}>
            <span>
              <span aria-hidden>← </span>
              {axis.from}
            </span>
            <span>
              {axis.to}
              <span aria-hidden> →</span>
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/** Box layouts by step count: a few steps sit side by side sooner than five do. */
const FLOW_WIDE = {
  narrow: {
    list: '@md:flex-row',
    item: '@md:flex-1 @md:flex-row',
    down: '@md:hidden',
    right: '@md:block',
  },
  wide: {
    list: '@2xl:flex-row',
    item: '@2xl:flex-1 @2xl:flex-row',
    down: '@2xl:hidden',
    right: '@2xl:block',
  },
};

const STEP_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * A process as a picture: labelled boxes joined by arrows (stacked with down arrows where the
 * block is narrow). A box with something behind it is a button; the tapped one opens below the
 * row with its open tasks and claims. Arrow keys, Home and End move between the boxes.
 */
function Flow({
  node,
  models,
  hideMarks,
}: {
  node: NodeOf<'Layers'>;
  models: LayerModel[];
  hideMarks: boolean;
}) {
  const [open, setOpen] = useState<string | null>(node.open ?? null);
  // A flow is a picture: no dotted underlines unless the view asks for them.
  const matcher = useTermMatcher(node.terms === true);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const openModel = models.find((m) => m.layer.key === open && hasDetail(m));
  const terms = firstUsesByKey(
    models.flatMap((m): [string, string][] => [
      [`${m.layer.key}:title`, m.layer.title],
      ...(m === openModel ? [[`${m.layer.key}:hint`, m.layer.hint ?? ''] as [string, string]] : []),
      ...(m === openModel ? panelTexts(m) : []),
    ]),
    matcher,
  );
  const shared: Shared = { terms, hideMarks, warnTag: node.warnTag ?? 'watch' };
  const scale = progressScale(models.map((m) => m.progress));
  const wide = FLOW_WIDE[models.length <= 3 ? 'narrow' : 'wide'];
  const panelId = `${id}-panel`;
  const live = models.flatMap((m, i) => (hasDetail(m) ? [i] : []));

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const at = live.indexOf(i);
    const step = STEP_KEYS[e.key];
    const target =
      step !== undefined
        ? live[Math.max(0, Math.min(live.length - 1, at + step))]
        : e.key === 'Home'
          ? live[0]
          : e.key === 'End'
            ? live.at(-1)
            : undefined;
    if (target === undefined) return;
    e.preventDefault();
    buttons.current[target]?.focus();
  }

  return (
    <div className="@container space-y-3">
      <ol className={clsx('flex flex-col', wide.list)}>
        {models.map((m, i) => {
          const { layer } = m;
          const interactive = hasDetail(m);
          const isOpen = m === openModel;
          const tone = layer.pill?.tone ?? 'neutral';
          const ids = {
            title: `${id}-${i}-title`,
            pill: `${id}-${i}-pill`,
            progress: `${id}-${i}-progress`,
          };
          return (
            <li key={layer.key} className={clsx('flex min-w-0 flex-col items-stretch', wide.item)}>
              {i > 0 && (
                <span
                  aria-hidden
                  className="flex shrink-0 items-center justify-center p-1 text-faint"
                >
                  <ArrowDown className={clsx('size-4', wide.down)} />
                  <ArrowRight className={clsx('hidden size-4', wide.right)} />
                </span>
              )}
              <div
                className={clsx(
                  'relative min-w-0 flex-1 rounded-block bg-surface motion-safe:transition',
                  isOpen
                    ? 'border border-sky-500 ring-1 ring-sky-500 dark:border-sky-400 dark:ring-sky-400'
                    : layer.highlight
                      ? clsx('border-2 border-dashed', STRONG_BORDER[tone])
                      : clsx('border', BORDER[tone]),
                  interactive && !isOpen && 'hover:shadow-sm',
                )}
              >
                {interactive && (
                  <button
                    type="button"
                    ref={(el) => {
                      buttons.current[i] = el;
                    }}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-labelledby={[ids.title, layer.pill && ids.pill, m.progress && ids.progress]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setOpen(isOpen ? null : layer.key)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    className="absolute inset-0 cursor-pointer rounded-block outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
                  />
                )}
                <div className="pointer-events-none relative flex h-full flex-col gap-2 p-3">
                  <span className="flex items-start justify-between gap-2">
                    <span
                      id={ids.title}
                      className="min-w-0 text-sm font-semibold break-words text-ink"
                    >
                      <TermText text={layer.title} ranges={terms.get(`${layer.key}:title`)} />
                    </span>
                    {interactive && (
                      <ChevronDown
                        aria-hidden
                        className={clsx(
                          'mt-0.5 size-4 shrink-0 text-faint motion-safe:transition-transform',
                          isOpen && 'rotate-180',
                        )}
                      />
                    )}
                  </span>
                  {layer.pill && (
                    <span id={ids.pill} className="flex">
                      <Badge tone={BADGE_TONE[layer.pill.tone]}>{layer.pill.label}</Badge>
                    </span>
                  )}
                  {m.progress && (
                    <span className="mt-auto block">
                      <ProgressLine progress={m.progress} scale={scale} id={ids.progress} />
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div
        id={panelId}
        role="region"
        aria-labelledby={openModel ? `${id}-${models.indexOf(openModel)}-title` : undefined}
        hidden={!openModel}
        className="space-y-3 rounded-block border border-line bg-surface p-4"
      >
        {openModel && (
          <>
            {openModel.layer.hint && (
              <p className="text-sm text-muted">
                <TermText
                  text={openModel.layer.hint}
                  ranges={terms.get(`${openModel.layer.key}:hint`)}
                />
              </p>
            )}
            <LayerPanel m={openModel} shared={shared} highlightAbout={node.highlightAbout} />
          </>
        )}
      </div>
    </div>
  );
}

/** Whether a step has anything to open: its status claim, claims or tasks. */
function hasDetail(m: LayerModel): boolean {
  return !!(m.pill || m.claims.length || m.progress);
}

export function Layers({ node }: { node: NodeOf<'Layers'> }) {
  const data = useViewData();
  const models = layerModels(data, node);
  const shared = sharedMarkOf(models.flatMap((m) => m.claims));
  const Body = node.orientation === 'row' ? Row : node.orientation === 'flow' ? Flow : Stack;
  return (
    <div className="space-y-3">
      {node.prompt && <p className="text-sm text-muted">{node.prompt}</p>}
      {node.legend && node.legend.length > 0 && (
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {node.legend.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <Dot tone={BADGE_TONE[item.tone]} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <Body node={node} models={models} hideMarks={!!shared} />
      {shared && (
        <p>
          <CertaintyMark claim={shared} sourceLabel="title" passage={false} />
        </p>
      )}
    </div>
  );
}
