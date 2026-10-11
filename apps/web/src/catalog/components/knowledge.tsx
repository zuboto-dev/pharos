import { runQuery, type Entity, type EntityType, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { ChevronDown, ExternalLink, TriangleAlert } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { formatDate, localToday } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { useOptions } from '../options';
import { Popover, usePopover } from '../popover';
import { firstUses, firstUsesByKey, TermText, useTermMatcher, type TermRange } from '../terms';
import { Badge, Dot, Empty, isHttp, Uri, type Tone } from '../ui';

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
  neutral: 'border-neutral-200 dark:border-neutral-800',
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
  neutral: 'text-neutral-500 dark:text-neutral-400',
  own: 'text-sky-700 dark:text-sky-300',
  watch: 'text-amber-700 dark:text-amber-300',
  gap: 'text-rose-700 dark:text-rose-300',
};

const GLYPH_COLOR: Record<Tone, string> = {
  neutral: 'text-neutral-500 dark:text-neutral-400',
  blue: 'text-sky-600 dark:text-sky-400',
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-rose-600 dark:text-rose-400',
  violet: 'text-violet-600 dark:text-violet-400',
  muted: 'text-neutral-400 dark:text-neutral-500',
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

/** "Oct 11", with the year when it isn't this year. */
function shortDate(date: string): string {
  return formatDate(date, date.slice(0, 4) === localToday().slice(0, 4));
}

// ------------------------------------------------------------------ certainty mark

/**
 * "◐ Our reading, Oct 11" and a source link. Tapping the mark explains it: what the word means,
 * who said it, and every source.
 */
export function CertaintyMark({
  claim,
  sourceLabel = 'short',
}: {
  claim: Claim;
  /** short: "Source ↗"; title: the source's title, for a mark shared by a whole block. */
  sourceLabel?: 'short' | 'title';
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
  const sources = claim.data.sourceIds
    .map((id) => entityOf(entityById, id, 'artifact'))
    .filter((s): s is Artifact => !!s);
  const linked = sources.filter((s) => isHttp(s.data.uri));
  const author = entityOf(entityById, claim.data.authorId, 'assignee');
  const glyph = GLYPHS[meaning] ?? '○';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
      <button
        type="button"
        {...trigger}
        title="How sure this is"
        className="inline-flex items-baseline gap-1 rounded-sm text-left font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-neutral-300 dark:hover:text-white"
      >
        <span aria-hidden className={GLYPH_COLOR[option.color]}>
          {glyph}
        </span>
        <span>
          {option.label}, {shortDate(date)}
        </span>
      </button>
      {linked.length === 1 && (
        <>
          {sourceLabel === 'title' && <span aria-hidden>·</span>}
          <Uri uri={linked[0]!.data.uri!} title={linked[0]!.data.title}>
            {sourceLabel === 'title' ? linked[0]!.data.title : 'Source'}
          </Uri>
        </>
      )}
      {linked.length > 1 && (
        <button
          type="button"
          {...trigger}
          className="inline-flex items-center gap-1 rounded-sm text-sky-600 hover:underline focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-sky-400"
        >
          Sources ({linked.length})
          <ExternalLink className="size-3" aria-hidden />
        </button>
      )}
      {anchor && (
        <Popover anchor={anchor} label={option.label} onClose={close}>
          <div className="flex items-baseline gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
            <span aria-hidden className={GLYPH_COLOR[option.color]}>
              {glyph}
            </span>
            {option.label}
          </div>
          {MEANING_LINES[meaning] && (
            <p>{MEANING_LINES[meaning](formatDate(date), decision?.data.title)}</p>
          )}
          {author && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">By {author.data.name}</p>
          )}
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Checked {formatDate(claim.data.checkedOn)}
          </p>
          {sources.length > 0 && (
            <ul className="space-y-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
              {sources.map((s) => (
                <li key={s.id} className="flex min-w-0">
                  {isHttp(s.data.uri) ? (
                    <Uri uri={s.data.uri}>{s.data.title}</Uri>
                  ) : (
                    <span className="text-xs">
                      {s.data.title} <span className="text-neutral-400">(no link)</span>
                    </span>
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

export function ClaimCard({ node }: { node: NodeOf<'ClaimCard'> }) {
  const data = useViewData();
  const matcher = useTermMatcher(node.terms);
  const claim = findClaim(data, node.claim);
  if (!claim) return <Empty>This finding was deleted or isn’t in this project</Empty>;
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
        <h2 className="text-2xl font-bold tracking-tight text-balance text-neutral-900 sm:text-3xl dark:text-neutral-50">
          <TermText text={statement} ranges={statementTerms} />
        </h2>
        {detail && (
          <p className="max-w-[60ch] text-base text-neutral-600 dark:text-neutral-300">
            <TermText text={detail} ranges={detailTerms} />
          </p>
        )}
        <CertaintyMark claim={claim} />
      </header>
    );
  }
  return (
    <article
      className={clsx(
        'flex h-full min-w-0 flex-col gap-1.5 rounded-xl border bg-white p-4 dark:bg-neutral-900',
        BORDER[tone],
      )}
    >
      {kicker}
      <p className="font-semibold text-neutral-900 dark:text-neutral-50">
        <TermText text={statement} ranges={statementTerms} />
      </p>
      {detail && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <TermText text={detail} ranges={detailTerms} />
        </p>
      )}
      <div className="mt-auto pt-1">
        <CertaintyMark claim={claim} />
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
};

function layerModels(data: ViewData, node: NodeOf<'Layers'>): LayerModel[] {
  return node.layers.map((layer) => {
    const pillId = layer.pill?.claim;
    const pill = pillId ? findClaim(data, pillId) : undefined;
    const claims = runQuery(data, 'claim', { sort: [{ field: 'order' }], ...layer.items }).filter(
      (c) => c.id !== pillId,
    );
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
    return { layer, pill, claims, lines, cards: [...cards.values()] };
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
  if (claim.data.tags.includes(shared.warnTag)) {
    return (
      <div
        role="note"
        className="flex gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-950 dark:bg-amber-950/60 dark:text-amber-100"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p>
            <span className="sr-only">Watch out: </span>
            {statement}
          </p>
          {detail && <p className="text-xs">{detail}</p>}
          {mark && <CertaintyMark claim={claim} />}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <p
        className={clsx(
          'text-neutral-800 dark:text-neutral-100',
          strong ? 'font-semibold' : 'text-sm',
        )}
      >
        {statement}
      </p>
      {detail && <p className="text-sm text-neutral-500 dark:text-neutral-400">{detail}</p>}
      {mark && <CertaintyMark claim={claim} />}
    </div>
  );
}

function NothingYet() {
  return <p className="text-sm text-neutral-400 dark:text-neutral-500">Nothing here yet</p>;
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
  if (!m.pill && !m.claims.length) return <NothingYet />;
  return (
    <>
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
                  'min-w-0 space-y-2 rounded-lg border p-3',
                  accent
                    ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40'
                    : warns
                      ? 'border-amber-300 dark:border-amber-800'
                      : 'border-neutral-200 dark:border-neutral-800',
                )}
              >
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  {about.data.title}
                </h4>
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
        };
        const labelledBy = [ids.key, ids.title, layer.hint && ids.hint, layer.pill && ids.pill]
          .filter(Boolean)
          .join(' ');
        const tone = layer.pill?.tone ?? 'neutral';
        return (
          <div key={layer.key} className="space-y-1.5">
            {/* The whole row is one button underneath; the text sits on top so the terms in it
                stay buttons of their own (a button can't hold another). */}
            <div
              className={clsx(
                'relative rounded-xl bg-white transition dark:bg-neutral-900',
                isOpen
                  ? 'border border-sky-500 ring-1 ring-sky-500 dark:border-sky-400 dark:ring-sky-400'
                  : layer.highlight
                    ? clsx('border-2 border-dashed', STRONG_BORDER[tone])
                    : 'border border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600',
              )}
            >
              <button
                type="button"
                id={ids.button}
                aria-expanded={isOpen}
                aria-controls={ids.panel}
                aria-labelledby={labelledBy}
                onClick={() => setOpen(isOpen ? null : layer.key)}
                className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
              />
              <div className="pointer-events-none relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:px-4">
                <span
                  id={ids.key}
                  className="flex size-8 items-center justify-center rounded-full border border-neutral-300 text-sm font-medium text-neutral-600 tabular-nums dark:border-neutral-600 dark:text-neutral-300"
                >
                  <span className="sr-only">Layer </span>
                  {layer.key}
                </span>
                <span className="min-w-0">
                  <span
                    id={ids.title}
                    className="block font-semibold text-neutral-900 dark:text-neutral-50"
                  >
                    <TermText text={layer.title} ranges={terms.get(`${layer.key}:title`)} />
                  </span>
                  {layer.hint && (
                    <span
                      id={ids.hint}
                      className="block text-sm text-neutral-500 dark:text-neutral-400"
                    >
                      <TermText text={layer.hint} ranges={terms.get(`${layer.key}:hint`)} />
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
                      'hidden size-4 text-neutral-400 transition sm:block',
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
              className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
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
      ...m.claims.flatMap((c) => claimTexts(m.layer.key, c)),
      ...(m.pill ? claimTexts(m.layer.key, m.pill) : []),
    ]),
    matcher,
  );
  const shared: Shared = { terms, hideMarks, warnTag: node.warnTag ?? 'watch' };
  const { axis } = node;
  const columns = { '--cols': `repeat(${models.length}, minmax(0, 1fr))` } as CSSProperties;
  const axisLabel =
    'text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400';
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
        className="grid grid-cols-1 overflow-hidden rounded-xl border border-neutral-200 bg-white sm:grid-cols-(--cols) dark:border-neutral-800 dark:bg-neutral-900"
      >
        {models.map((m) => {
          const { layer } = m;
          return (
            <section
              key={layer.key}
              aria-label={layer.title}
              className={clsx(
                'min-w-0 space-y-2 border-b border-neutral-200 p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 dark:border-neutral-800',
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
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  <TermText text={layer.hint} ranges={terms.get(`${layer.key}:hint`)} />
                </p>
              )}
              {m.claims.map((c) => (
                <ClaimLine key={c.id} claim={c} prefix={layer.key} shared={shared} strong />
              ))}
              {!m.claims.length && !m.pill && <NothingYet />}
              {m.pill && <ClaimLine claim={m.pill} prefix={layer.key} shared={shared} mark />}
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

export function Layers({ node }: { node: NodeOf<'Layers'> }) {
  const data = useViewData();
  const models = layerModels(data, node);
  const shared = sharedMarkOf(models.flatMap((m) => m.claims));
  const Body = node.orientation === 'row' ? Row : Stack;
  return (
    <div className="space-y-3">
      {node.prompt && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{node.prompt}</p>
      )}
      {node.legend && node.legend.length > 0 && (
        <ul
          aria-label="Legend"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400"
        >
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
          <CertaintyMark claim={shared} sourceLabel="title" />
        </p>
      )}
    </div>
  );
}
