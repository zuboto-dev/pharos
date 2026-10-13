import {
  BOARD_COLUMNS,
  R4,
  START_HERE,
  WEAK_BECAUSE_LABELS,
  changedLines,
  diffWords,
  evidenceId,
  stripWorkCode,
  COMPONENT_INFO,
  ENTITIES,
  fieldReader,
  findOption,
  meaningOf,
  optionsFor,
  optionKeyOf,
  runQuery,
  stageProgress,
  taskProgress,
  type Board,
  type ComponentName,
  type Entity,
  type EntityType,
  type Filter,
  type NodeOf,
  type ProjectDataset,
  type Query,
  type QueryableType,
  type ViewNode,
  type Where,
} from '@pharos/schema';
import { AgentFiles } from '../store/agent-files.js';
import { claimWarnings, type Store } from '../store/store.js';

/** One widget's preview: what it shows right now, and anything that looks wrong. */
export type WidgetPreview = {
  id: string;
  component: ComponentName;
  title?: string;
  width: number;
  shows: string;
  empty: boolean;
  warnings: string[];
};

const HOPS: Record<string, EntityType> = {
  stage: 'stage',
  assignee: 'assignee',
  task: 'task',
  parent: 'goal',
  project: 'project',
};
const META = new Set(['id', 'createdAt', 'updatedAt']);

/** Whether a field path exists on a type (one hop allowed), so typos don't silently match nothing. */
function pathProblem(type: EntityType, path: string): string | null {
  const dot = path.indexOf('.');
  if (dot > 0) {
    const hop = HOPS[path.slice(0, dot)];
    if (!hop)
      return `"${path}": "${path.slice(0, dot)}" isn't a reference you can follow (use stage., assignee., task., parent.)`;
    if (!(`${path.slice(0, dot)}Id` in ENTITIES[type].data.shape)) {
      return `"${path}": ${type} has no ${path.slice(0, dot)}`;
    }
    // Report the full path the agent wrote, not just the part after the hop.
    const rest = path.slice(dot + 1);
    return pathProblem(hop, rest)?.replace(`"${rest}"`, `"${path}"`) ?? null;
  }
  if (META.has(path) || path in ENTITIES[type].data.shape) return null;
  return `"${path}" isn't a field of ${type} (fields: ${Object.keys(ENTITIES[type].data.shape).join(', ')})`;
}

function filterProblems(type: QueryableType, filter: Filter | undefined): string[] {
  const wheres: Where[] = [...(filter?.where ? [filter.where] : []), ...(filter?.anyOf ?? [])];
  const paths = [
    ...wheres.flatMap((w) => Object.keys(w)),
    ...(filter?.sort ?? []).map((s) => s.field),
  ];
  return paths.map((p) => pathProblem(type, p)).filter((p): p is string => p !== null);
}

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

/**
 * `widgetIds`: the widgets on the board being previewed and their components, so StartHere steps
 * and a FileList's `showIn` can be checked.
 */
type Context = {
  data: ProjectDataset;
  store: Store;
  today: string;
  widgetIds: Map<string, ComponentName>;
};

function count(ctx: Context, query: Query): number {
  return runQuery(ctx.data, query.type, query, { today: ctx.today }).length;
}

/** What a row is called, as a list shows it; `hideCodes` drops a leading work code (F6). */
function rowName(type: EntityType, data: unknown, hideCodes = false): string {
  const name = String((data as Record<string, unknown>)[ENTITIES[type].label] ?? '');
  return hideCodes ? stripWorkCode(name) : name;
}

function sample(ctx: Context, query: Query, n = 3, hideCodes = false): string {
  const rows = runQuery(ctx.data, query.type, query, { today: ctx.today });
  const names = rows.slice(0, n).map((r) => `“${rowName(query.type, r.data, hideCodes)}”`);
  return rows.length
    ? `${plural(rows.length, query.type.replace('_', ' '))}: ${names.join(', ')}${rows.length > n ? ', …' : ''}`
    : 'nothing';
}

/** Describes what one leaf node shows, mirroring how the web app renders it. */
function describeLeaf(
  node: ViewNode,
  ctx: Context,
): { shows: string; empty: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const tasksOf = (filter?: Filter) => {
    warnings.push(...filterProblems('task', filter));
    return runQuery(ctx.data, 'task', filter, { today: ctx.today });
  };
  const queryOf = (q: Query) => {
    warnings.push(...filterProblems(q.type, q));
    return q;
  };
  const n = node as Record<string, unknown> & { component: ComponentName };
  if (node.component === 'StartHere') return describeStartHere(node, ctx, warnings);
  if (node.component === 'BeforeAfter') return describeBeforeAfter(node, ctx, warnings);
  if (node.component === 'FindingChart') return describeFindingChart(node, ctx, warnings);
  if (isExplaining(node)) return describeExplaining(node, ctx, warnings);
  switch (node.component) {
    case 'ProjectHeader': {
      const p = taskProgress(ctx.data.tasks, ctx.data.project);
      return {
        shows: `${ctx.data.project.data.name}, ${p.percent}% done (${p.done}/${p.total} tasks)`,
        empty: false,
        warnings,
      };
    }
    case 'StatCards': {
      const stats = (node as NodeOf<'StatCards'>).stats.map((s) => {
        const value = s.value ?? (s.query ? count(ctx, queryOf(s.query)) : '—');
        if (s.of && typeof value === 'number')
          return `${s.label} ${miniBar(value, count(ctx, queryOf(s.of)))}`;
        const total = s.of ? ` / ${count(ctx, queryOf(s.of))}` : '';
        return `${s.label} ${value}${total}`;
      });
      return { shows: stats.join(' · '), empty: false, warnings };
    }
    case 'Stat': {
      const s = node as NodeOf<'Stat'>;
      const value = count(ctx, queryOf(s.query));
      const shown = s.of
        ? `${Math.round((value / Math.max(1, count(ctx, queryOf(s.of)))) * 100)}%`
        : String(value);
      return { shows: `${s.label}: ${shown}`, empty: false, warnings };
    }
    case 'ProgressRing': {
      const p = taskProgress(
        tasksOf({ where: (node as NodeOf<'ProgressRing'>).where }),
        ctx.data.project,
      );
      return {
        shows: p.total ? `${p.percent}% (${p.done} of ${p.total} tasks)` : 'No tasks yet',
        empty: !p.total,
        warnings,
      };
    }
    case 'Text': {
      const t = node as NodeOf<'Text'>;
      const text = t.content.replace(/\$\{(\w+)\}/g, (match, name: string) => {
        const v = t.values?.[name];
        if (!v) {
          warnings.push(`\${${name}} has no value in "values"`);
          return match;
        }
        if ('count' in v) return String(count(ctx, queryOf(v.count)));
        if ('percent' in v) {
          const of = count(ctx, queryOf(v.percent.of));
          return `${of ? Math.round((count(ctx, queryOf(v.percent.query)) / of) * 100) : 0}%`;
        }
        if ('bar' in v)
          return miniBar(count(ctx, queryOf(v.bar.query)), count(ctx, queryOf(v.bar.of)));
        const stage = ctx.data.stages.find((s) => s.id === ctx.data.project.data.currentStageId);
        return {
          name: ctx.data.project.data.name,
          summary: ctx.data.project.data.summary ?? '',
          status: ctx.data.project.data.status,
          currentStage: stage?.data.name ?? 'no stage',
          currentStageTarget: stage?.data.targetDate ?? 'no date',
        }[v.project];
      });
      return { shows: text, empty: !text.trim(), warnings };
    }
    case 'Callout':
    case 'Markdown': {
      const text =
        node.component === 'Callout'
          ? (node as NodeOf<'Callout'>).body
          : ((node as NodeOf<'Markdown'>).content ??
            (n.source ? ctx.data.project.data.description : '') ??
            '');
      return {
        shows: text
          ? `text: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`
          : 'No description yet',
        empty: !text,
        warnings,
      };
    }
    case 'GoalTree':
    case 'ScopeBoard':
    case 'MilestoneList':
    case 'StageTracker':
    case 'Timeline':
    case 'ArtifactGallery':
    case 'DecisionLog': {
      const type: QueryableType = (
        {
          GoalTree: 'goal',
          ScopeBoard: 'scope_item',
          MilestoneList: 'stage',
          StageTracker: 'stage',
          Timeline: 'stage',
          ArtifactGallery: 'artifact',
          DecisionLog: 'decision',
        } as const
      )[node.component];
      const filter = n.filter as Filter | undefined;
      const query = queryOf({ type, ...filter });
      let rows = runQuery(ctx.data, type, query, { today: ctx.today });
      if (node.component === 'DecisionLog' && !filter?.sort) {
        // Like the component: newest first, then the limit.
        const all = runQuery(
          ctx.data,
          'decision',
          { ...filter, limit: undefined },
          { today: ctx.today },
        );
        rows = [...all].sort((a, b) => b.createdRev - a.createdRev).slice(0, filter?.limit);
        const names = rows.slice(0, 3).map((r) => `“${(r.data as { title: string }).title}”`);
        return {
          shows: rows.length
            ? `${plural(rows.length, 'decision')}, newest first: ${names.join(', ')}${rows.length > 3 ? ', …' : ''}`
            : 'nothing',
          empty: !rows.length,
          warnings,
        };
      }
      if (node.component === 'ScopeBoard' && (node as NodeOf<'ScopeBoard'>).kinds) {
        // Only the groups (by meaning) the board shows.
        const kinds = new Set<string>((node as NodeOf<'ScopeBoard'>).kinds);
        rows = rows.filter((r) =>
          kinds.has(
            meaningOf(ctx.data.project, 'scope_item.kind', (r.data as { kind: string }).kind) ?? '',
          ),
        );
        const names = rows.slice(0, 3).map((r) => `“${(r.data as { title: string }).title}”`);
        return {
          shows: rows.length
            ? `${plural(rows.length, 'scope item')}: ${names.join(', ')}${rows.length > 3 ? ', …' : ''}`
            : 'nothing',
          empty: !rows.length,
          warnings,
        };
      }
      if (node.component === 'Timeline') {
        const dated = rows.filter(
          (s) =>
            (s.data as { startDate?: string; targetDate?: string }).startDate ||
            (s.data as { targetDate?: string }).targetDate,
        );
        if (rows.length && !dated.length)
          return { shows: 'No stage has dates, so the timeline is empty', empty: true, warnings };
      }
      if (node.component === 'StageTracker' && rows.length) {
        const parts = ctx.data.stages
          .filter((s) => rows.some((r) => r.id === s.id))
          .map(
            (s) => `${s.data.name} ${stageProgress(s, ctx.data.tasks, ctx.data.project).percent}%`,
          );
        return { shows: parts.join(' · '), empty: false, warnings };
      }
      return { shows: sample(ctx, query), empty: !rows.length, warnings };
    }
    case 'KanbanBoard':
    case 'TaskTable':
    case 'AssigneeMatrix': {
      const tasks = tasksOf(n.filter as Filter | undefined);
      return {
        shows: tasks.length
          ? sample(ctx, { type: 'task', ...(n.filter as Filter) }, 3, n.hideCodes === true)
          : 'No tasks match',
        empty: !tasks.length,
        warnings,
      };
    }
    case 'TaskChecklist': {
      const c = node as NodeOf<'TaskChecklist'>;
      let tasks = tasksOf(c.filter);
      if (c.assigneeKind) {
        const kinds = new Map(ctx.data.assignees.map((a) => [a.id, a.data.kind]));
        tasks = tasks.filter((t) => kinds.get(t.data.assigneeId ?? '') === c.assigneeKind);
      }
      if (c.hideDone ?? true)
        tasks = tasks.filter((t) => !['done', 'cancelled'].includes(t.data.status));
      return {
        shows: tasks.length
          ? plural(tasks.length, 'task') + ' to tick off'
          : 'Nothing to do (shows an empty state)',
        empty: !tasks.length,
        warnings,
      };
    }
    case 'DependencyGraph': {
      const tasks = tasksOf(n.filter as Filter | undefined);
      const ids = new Set(tasks.map((t) => t.id));
      const edges = tasks.reduce(
        (sum, t) => sum + t.data.dependsOn.filter((d) => ids.has(d)).length,
        0,
      );
      return {
        shows: edges
          ? `${plural(tasks.length, 'task')}, ${plural(edges, 'dependency')}`
          : 'No dependencies between these tasks',
        empty: !edges,
        warnings,
      };
    }
    case 'DataTable':
    case 'DataList': {
      const q = queryOf((node as NodeOf<'DataTable'> | NodeOf<'DataList'>).query);
      const fields =
        node.component === 'DataTable'
          ? (node as NodeOf<'DataTable'>).columns.map((c) => c.field)
          : ((node as NodeOf<'DataList'>).secondary ?? []);
      warnings.push(
        ...fields.map((f) => pathProblem(q.type, f)).filter((p): p is string => p !== null),
      );
      return {
        shows: sample(ctx, q, 3, n.hideCodes === true),
        empty: !count(ctx, q),
        warnings,
      };
    }
    case 'CountChart': {
      const c = node as NodeOf<'CountChart'>;
      const q = queryOf(c.query);
      const problem = pathProblem(q.type, c.by);
      if (problem) warnings.push(problem);
      const parts = countGroups(ctx, q, c.by).map((g) => `${g.label} ${g.count}`);
      return {
        shows: parts.length ? parts.join(' · ') : 'Nothing matches',
        empty: !parts.length,
        warnings,
      };
    }
    case 'FileList': {
      const f = node as NodeOf<'FileList'>;
      const query = queryOf({ type: 'file', ...f.filter });
      if (f.showIn && !ctx.widgetIds.has(f.showIn))
        warnings.push(
          `showIn "${f.showIn}" is not a widget on this board, so rows open the drawer instead; add a FileView with that id or remove showIn`,
        );
      else if (f.showIn && ctx.widgetIds.get(f.showIn) !== 'FileView')
        warnings.push(
          `showIn "${f.showIn}" is a ${ctx.widgetIds.get(f.showIn)}, not a FileView, so rows open the drawer instead`,
        );
      const shown = sample(ctx, query);
      return {
        shows: shown === 'nothing' ? 'No files match (shows an empty state)' : shown,
        empty: shown === 'nothing',
        warnings,
      };
    }
    case 'FileView': {
      const v = node as NodeOf<'FileView'>;
      if (!v.file) {
        warnings.push(
          'no file: set `file` to the id of the key document (from project_snapshot.files) so the widget shows it before the reader picks one',
        );
        return { shows: 'Nothing until the reader picks a file', empty: true, warnings };
      }
      const file = ctx.data.files.find((x) => x.id === v.file);
      if (!file) {
        warnings.push(
          `file ${v.file} not found in this project; use the id of a file in project_snapshot.files (only the owner adds files)`,
        );
        return { shows: 'A note that the file isn’t in the project', empty: true, warnings };
      }
      const kind = findOption(ctx.data.project, 'file.kind', file.data.kind)?.label;
      const details = [
        kind,
        file.data.issuer,
        file.data.issuedDate && `issued ${file.data.issuedDate}`,
        file.data.expiryDate &&
          (file.data.expiryDate < ctx.today
            ? `expired ${file.data.expiryDate}`
            : `expires ${file.data.expiryDate}`),
      ].filter(Boolean);
      return {
        shows: `“${file.data.title}”${details.length ? ` (${details.join(', ')})` : ''}, its preview and actions`,
        empty: false,
        warnings,
      };
    }
    case 'ActivityFeed': {
      const n2 = new AgentFiles(ctx.store).revisions(
        ctx.store.history({
          projectId: ctx.data.project.id,
          limit: (node as NodeOf<'ActivityFeed'>).limit ?? 10,
        }),
      ).length;
      return { shows: plural(n2, 'recent change'), empty: !n2, warnings };
    }
    default:
      return { shows: node.component, empty: false, warnings };
  }
}

/** "▰▰▱▱▱ 2/5": a word-sized bar (R4 mini bars); the glyphs count as no words. */
function miniBar(value: number, of: number): string {
  const filled = of ? Math.round((Math.min(value, of) / of) * 5) : 0;
  return `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${value}/${of}`;
}

type Group = { label: string; values: Set<string>; count: number };

/** Items counted by a field, labelled as people see them: names for references, labels for options. */
function countGroups(ctx: Context, q: Query, by: string): Group[] {
  const read = fieldReader(ctx.data, { today: ctx.today });
  const byId = new Map<string, { type: EntityType; data: Record<string, unknown> }>(
    [
      ctx.data.project,
      ...ctx.data.assignees,
      ...ctx.data.stages,
      ...ctx.data.tasks,
      ...ctx.data.goals,
    ].map((e) => [e.id, e]),
  );
  const display = (v: unknown, type: EntityType, field: string): string => {
    if (v === undefined || v === null || v === '') return 'None';
    const target = typeof v === 'string' ? byId.get(v) : undefined;
    if (target) return String(target.data[ENTITIES[target.type].label] ?? v);
    const key = optionKeyOf(type, field);
    return (key && findOption(ctx.data.project, key, String(v))?.label) || String(v);
  };
  const groups = new Map<string, Group>();
  for (const row of runQuery(ctx.data, q.type, q, { today: ctx.today })) {
    const { value, type, field } = read(row, by);
    for (const v of Array.isArray(value) ? value : [value]) {
      const label = display(v, type, field);
      const group = groups.get(label) ?? { label, values: new Set<string>(), count: 0 };
      group.values.add(String(v ?? ''));
      group.count++;
      groups.set(label, group);
    }
  }
  return [...groups.values()];
}

// ------------------------------------------------------------------ explanation views

/**
 * Blocks that show stored claims. A view that uses one is an explanation view, and only those get
 * the reader checks below; task boards and other project views stay quiet.
 */
const EXPLAINING = ['ClaimCard', 'Layers', 'BeforeAfter', 'FindingChart'] as const;
/** Text blocks that may come before the point. */
const LEAD_IN = new Set<string>(['Markdown', 'Text', 'Callout']);
const CONTAINERS = new Set<string>(['Grid', 'Section', 'Tabs']);
/** Most words allowed before the first ClaimCard: about two short sentences (slice-1.md §5). */
export const POINT_WORDS = 30;

type Explaining =
  NodeOf<'ClaimCard'> | NodeOf<'Layers'> | NodeOf<'BeforeAfter'> | NodeOf<'FindingChart'>;

function isExplaining(node: ViewNode): node is Explaining {
  return (EXPLAINING as readonly string[]).includes(node.component);
}

/** How the reader sees a claim: its statement and its certainty mark. */
function claimLine(ctx: Context, claim: Entity<'claim'>): string {
  const { statement, certainty, checkedOn, sourceIds, weakBecause } = claim.data;
  const label =
    optionsFor(ctx.data.project, 'claim.certainty').find((o) => o.value === certainty)?.label ??
    certainty;
  const weak = weakBecause ? `, weak: ${WEAK_BECAUSE_LABELS[weakBecause]}` : '';
  return `“${statement}” (${label}, ${checkedOn}, ${plural(sourceIds.length, 'source')}${weak})`;
}

/** The words a ClaimCard shows: its kicker, the claim's statement and its detail. */
function cardText(node: NodeOf<'ClaimCard'>, claim: Entity<'claim'>): string {
  return [node.kicker, claim.data.statement, claim.data.detail].filter(Boolean).join(' ');
}

/** What a ClaimCard or Layers shows, warning about missing claims, claims without a source, and empty layers. */
function describeExplaining(
  node: NodeOf<'ClaimCard'> | NodeOf<'Layers'>,
  ctx: Context,
  warnings: string[],
): { shows: string; empty: boolean; warnings: string[] } {
  const byId = new Map(ctx.data.claims.map((c) => [c.id, c]));
  const shown: Entity<'claim'>[] = [];
  const find = (id: string) => {
    const claim = byId.get(id);
    if (claim) shown.push(claim);
    else warnings.push(`claim ${id} not found in this project`);
    return claim;
  };
  const sourceWarnings = () => {
    const seen = new Set<string>();
    for (const claim of shown) {
      if (seen.has(claim.id)) continue;
      seen.add(claim.id);
      warnings.push(...claimWarnings(claim, ctx.data.project));
    }
  };
  if (node.component === 'ClaimCard') {
    const claim = find(node.claim);
    sourceWarnings();
    const words = claim ? countWords(cardText(node, claim)) : 0;
    if (words > START_HERE.cardWords)
      warnings.push(
        `this card shows ${words} words; keep a card to ${START_HERE.cardWords} or fewer: shorten the claim's statement to one short line and drop its detail, or move the finding into a Layers stack the reader opens`,
      );
    return {
      shows: claim ? claimLine(ctx, claim) : 'a missing claim (shows an empty state)',
      empty: !claim,
      warnings,
    };
  }
  const flow = node.orientation === 'flow';
  if (flow) warnings.push(...flowWarnings(node));
  const parts = node.layers.map((layer) => {
    warnings.push(...filterProblems('claim', layer.items));
    const pill = layer.pill?.claim ? find(layer.pill.claim) : undefined;
    const rows = layerClaims(ctx, layer);
    shown.push(...rows);
    if (!layer.items && !flow)
      warnings.push(
        `layer "${layer.key}" has no items: pick its claims with items (only a flow step may be a label alone)`,
      );
    else if (layer.items && !rows.length) warnings.push(`layer "${layer.key}" shows nothing`);
    const progress = layerProgress(ctx, layer, warnings);
    const holds = rows.length
      ? plural(rows.length, 'claim')
      : layer.items
        ? 'nothing'
        : 'label only';
    return {
      rows,
      text: `${layer.key} ${layer.title}: ${holds}${progress ? `, ${progress}` : ''}${pill ? ` (pill: ${claimLine(ctx, pill)})` : ''}`,
    };
  });
  sourceWarnings();
  return {
    shows: parts.map((p) => p.text).join(' · '),
    empty: parts.every((p) => !p.rows.length),
    warnings,
  };
}

type LayerSpec = NodeOf<'Layers'>['layers'][number];

/** A layer's claims; a label-only flow step (no items) holds none, not every claim. */
function layerClaims(ctx: Context, layer: LayerSpec): Entity<'claim'>[] {
  if (!layer.items) return [];
  return runQuery(
    ctx.data,
    'claim',
    { sort: [{ field: 'order' }], ...layer.items },
    { today: ctx.today },
  );
}

/** A step's task progress, "2 of 9 done" (cancelled left out, by meaning), when it sets progress. */
function layerProgress(ctx: Context, layer: LayerSpec, warnings?: string[]): string | undefined {
  if (!layer.progress) return undefined;
  warnings?.push(...filterProblems('task', { where: layer.progress }));
  const tasks = runQuery(ctx.data, 'task', { where: layer.progress }, { today: ctx.today });
  const p = taskProgress(tasks, ctx.data.project);
  if (!p.total)
    warnings?.push(
      `layer "${layer.key}" progress counts no tasks: check its where, or leave progress out`,
    );
  return `${p.done} of ${p.total} done`;
}

/** A flow is 2–5 short labelled boxes (r4-plan.md block 1). */
function flowWarnings(node: NodeOf<'Layers'>): string[] {
  const out: string[] = [];
  const n = node.layers.length;
  if (n < R4.flowMinSteps || n > R4.flowMaxSteps)
    out.push(
      `a flow has ${plural(n, 'step')}; use ${R4.flowMinSteps}–${R4.flowMaxSteps} boxes, or a stack for more`,
    );
  for (const layer of node.layers)
    if (layer.title.length > R4.flowLabelChars)
      out.push(
        `flow step "${layer.key}" label is ${layer.title.length} characters; keep a box label under ${R4.flowLabelChars}, and put the rest in its claims`,
      );
  if (node.axis) out.push('axis shows only in a row; leave it out of a flow');
  return out;
}

/** Every node in the order the reader meets it: depth-first, and only a Tabs' first tab (the others start hidden). */
function readingOrder(nodes: ViewNode[]): ViewNode[] {
  return nodes.flatMap((node) => [
    node,
    ...readingOrder(
      node.component === 'Tabs'
        ? (node.tabs[0]?.children ?? [])
        : node.component === 'Grid' || node.component === 'Section'
          ? node.children
          : [],
    ),
  ]);
}

function allNodes(nodes: ViewNode[]): ViewNode[] {
  return nodes.flatMap((node) => [
    node,
    ...allNodes(
      node.component === 'Tabs'
        ? node.tabs.flatMap((t) => t.children)
        : node.component === 'Grid' || node.component === 'Section'
          ? node.children
          : [],
    ),
  ]);
}

/** Words a reader reads, leaving out Markdown symbols and link targets. */
export function countWords(text: string): number {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The text a node shows on its own (not its children's): title, then body. */
function nodeText(node: ViewNode, ctx: Context): string {
  const body =
    node.component === 'Text'
      ? describeLeaf(node, ctx).shows
      : node.component === 'Markdown'
        ? (node.content ?? (node.source ? ctx.data.project.data.description : '') ?? '')
        : node.component === 'Callout'
          ? node.body
          : node.component === 'Section'
            ? (node.description ?? '')
            : '';
  return `${node.title ?? ''} ${body}`;
}

/**
 * The reader should meet the view's point at once: in an explanation view, a ClaimCard comes
 * first, after at most POINT_WORDS words of text and no other block (slice-1.md §5).
 */
function pointWarning(board: Board, ctx: Context): string | null {
  const roots = board.widgets.map((w) => w.node);
  if (!allNodes(roots).some(isExplaining)) return null;
  const fix = `put a StartHere (or a ClaimCard with size "headline") first and keep what comes before it to ${POINT_WORDS} words or fewer`;
  const order = readingOrder(roots);
  // A StartHere's headline states the point too (start-here.md), so it counts like a ClaimCard.
  const isPoint = (n: ViewNode) => n.component === 'ClaimCard' || n.component === 'StartHere';
  if (!order.some(isPoint))
    return `the point comes too late: no ClaimCard or StartHere states it where the reader starts; ${fix}`;
  let words = 0;
  for (const node of order) {
    words += countWords(nodeText(node, ctx));
    if (isPoint(node)) {
      return words > POINT_WORDS
        ? `the point comes too late: ${words} words before the first ${node.component}; ${fix}`
        : null;
    }
    if (!CONTAINERS.has(node.component) && !LEAD_IN.has(node.component))
      return `the point comes too late: a ${node.component} comes before the first ${order.find(isPoint)!.component}; ${fix}`;
  }
  return null;
}

// ------------------------------------------------------------------ pictures (R4)

const claimById = (ctx: Context, id: string | undefined) =>
  id ? ctx.data.claims.find((c) => c.id === id) : undefined;

/** The words a BeforeAfter shows: the stated change, then the lines that changed on each side. */
function beforeAfterText(node: NodeOf<'BeforeAfter'>, ctx: Context): string[] {
  const before = claimById(ctx, node.before)?.data.quote ?? '';
  const after = claimById(ctx, node.after)?.data.quote ?? '';
  const changed = changedLines(before, after);
  return [
    claimById(ctx, node.claim)?.data.statement ?? '',
    node.beforeLabel ?? '',
    node.afterLabel ?? '',
    ...changed.before,
    ...changed.after,
  ];
}

/** BeforeAfter: two quoted passages and the claim that states the change (r4-plan.md block 3). */
function describeBeforeAfter(
  node: NodeOf<'BeforeAfter'>,
  ctx: Context,
  warnings: string[],
): { shows: string; empty: boolean; warnings: string[] } {
  const get = (id: string) => {
    const claim = claimById(ctx, id);
    if (!claim) warnings.push(`claim ${id} not found in this project`);
    return claim;
  };
  const stated = node.claim ? get(node.claim) : undefined;
  const before = get(node.before);
  const after = get(node.after);
  if (!node.claim)
    warnings.push(
      'no claim states the change: set claim to a claim saying what changed, in one line above the panes',
    );
  const seen = new Set<string>();
  for (const claim of [stated, before, after])
    if (claim && !seen.has(claim.id)) {
      seen.add(claim.id);
      warnings.push(...claimWarnings(claim, ctx.data.project));
    }
  for (const [side, claim] of [
    ['before', before],
    ['after', after],
  ] as const)
    if (claim && !claim.data.quote)
      warnings.push(
        `the ${side} claim ${claim.id} has no quote: store the passage ${side} the change, word for word, as its quote (with locator and source)`,
      );
  const a = before?.data.quote ?? '';
  const b = after?.data.quote ?? '';
  const statedWords = countWords(stated?.data.statement ?? '');
  if (statedWords > R4.findingTitleWords)
    warnings.push(
      `the stated change is ${statedWords} words; keep it to ${R4.findingTitleWords} or fewer: one line, and let the panes show the rest`,
    );
  const words = beforeAfterText(node, ctx).reduce((sum, t) => sum + countWords(t), 0);
  if (a && b && changedLines(a, b).same)
    warnings.push('before and after quote the same passage, so nothing shows as changed');
  else if (words > R4.beforeAfterWords)
    warnings.push(
      `this BeforeAfter shows ${words} words; keep the stated change and the changed lines to ${R4.beforeAfterWords}: quote only the lines that changed`,
    );
  const parts = a && b ? diffWords(a, b) : [];
  const clip = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);
  const removed = parts.filter((p) => p.op === 'removed').map((p) => clip(p.text.trim()));
  const added = parts.filter((p) => p.op === 'added').map((p) => clip(p.text.trim()));
  const side = (label: string, extra?: string) => (extra ? `${label} · ${extra}` : label);
  return {
    shows:
      `${stated ? `${claimLine(ctx, stated)}; ` : ''}${side('Before', node.beforeLabel)} → ${side('After', node.afterLabel)}` +
      (parts.length
        ? `: removed ${removed.length ? removed.map((t) => `“${t}”`).join(', ') : 'nothing'}, added ${added.length ? added.map((t) => `“${t}”`).join(', ') : 'nothing'}`
        : ': nothing to compare'),
    empty: !a || !b,
    warnings,
  };
}

type Bar = { key: string; label: string; value: number; unit?: string; values?: Set<string> };

/** The bars a FindingChart draws: claims with a figure, or groups counted by a field. */
function findingBars(node: NodeOf<'FindingChart'>, ctx: Context): Bar[] {
  if (node.bars) {
    return runQuery(
      ctx.data,
      'claim',
      { sort: [{ field: 'order' }], ...node.bars },
      { today: ctx.today },
    ).flatMap((c) =>
      c.data.figure
        ? [
            {
              key: c.id,
              label: c.data.figure.label,
              value: c.data.figure.value,
              unit: c.data.figure.unit,
            },
          ]
        : [],
    );
  }
  if (!node.count) return [];
  let groups = countGroups(ctx, node.count.query, node.count.by);
  if (node.count.sort === 'count') groups = [...groups].sort((x, y) => y.count - x.count);
  return groups
    .slice(0, node.count.limit)
    .map((g) => ({ key: g.label, label: g.label, value: g.count, values: g.values }));
}

/** FindingChart: bars under a title that is a stored claim (r4-plan.md block 4). */
function describeFindingChart(
  node: NodeOf<'FindingChart'>,
  ctx: Context,
  warnings: string[],
): { shows: string; empty: boolean; warnings: string[] } {
  const claim = claimById(ctx, node.claim);
  if (!node.claim)
    warnings.push(
      "the chart's title isn't a stored claim: set claim to the claim that states the finding, so the title carries its certainty and source",
    );
  else if (!claim) warnings.push(`claim ${node.claim} not found in this project`);
  if (node.title)
    warnings.push(
      'title is free text: the claim is the title, so leave title out and keep the finding in the claim',
    );
  const titleWords = countWords(claim?.data.statement ?? '');
  if (titleWords > R4.findingTitleWords)
    warnings.push(
      `the title claim is ${titleWords} words; keep it to ${R4.findingTitleWords} or fewer, the finding in one line`,
    );
  const checked = new Set<string>();
  const check = (c: Entity<'claim'>) => {
    if (checked.has(c.id)) return;
    checked.add(c.id);
    warnings.push(...claimWarnings(c, ctx.data.project));
  };
  if (claim) check(claim);

  if (!node.bars && !node.count)
    warnings.push('no bars: set bars (a claim filter) or count ({query, by})');
  if (node.bars && node.count)
    warnings.push('set bars or count, not both: the chart draws bars and ignores count');
  if (node.bars) {
    warnings.push(...filterProblems('claim', node.bars));
    const rows = runQuery(ctx.data, 'claim', node.bars, { today: ctx.today });
    for (const c of rows) {
      check(c);
      if (!c.data.figure)
        warnings.push(`claim ${c.id} has no figure, so it draws no bar: add figure {value, label}`);
    }
  } else if (node.count) {
    warnings.push(...filterProblems(node.count.query.type, node.count.query));
    const problem = pathProblem(node.count.query.type, node.count.by);
    if (problem) warnings.push(problem);
  }

  const bars = findingBars(node, ctx);
  if ((node.bars || node.count) && bars.length < R4.minBars)
    warnings.push(
      `the chart has ${plural(bars.length, 'bar')}; a finding chart compares, so it needs at least ${R4.minBars}`,
    );
  if (bars.length > R4.maxBars)
    warnings.push(`the chart has ${bars.length} bars; keep it to ${R4.maxBars} or fewer`);
  const units = [...new Set(bars.map((b) => b.unit ?? ''))];
  if (units.length > 1)
    warnings.push(
      `the bars mix units (${units.map((u) => `"${u}"`).join(', ')}): one chart compares one unit, so split it or fix the figures`,
    );
  if (node.max !== undefined) {
    const over = bars.filter((b) => b.value > node.max!);
    if (over.length)
      warnings.push(
        `${over.map((b) => `"${b.label}" (${b.value})`).join(', ')} ${over.length === 1 ? 'is' : 'are'} over max ${node.max}: a bar can't exceed the whole it is part of, so fix the figure or the max`,
      );
  }
  const lit =
    node.highlight === undefined
      ? bars[0]
      : bars.find((b) => b.key === node.highlight || b.values?.has(node.highlight!));
  if (node.highlight !== undefined && !lit)
    warnings.push(
      `highlight "${node.highlight}" matches no bar: use ${node.bars ? 'the id of a claim with a figure' : 'a group value or label'}`,
    );
  const barText = bars
    .map(
      (b) =>
        `${b.label} ${b.value}${b.unit ? ` ${b.unit}` : ''}${b === lit ? ' (highlighted)' : ''}`,
    )
    .join(' · ');
  return {
    shows: `${claim ? `${claimLine(ctx, claim)}: ` : ''}${barText || 'no bars'}${node.max !== undefined && bars.length ? ` (out of ${node.max})` : ''}`,
    empty: !bars.length,
    warnings,
  };
}

// ------------------------------------------------------------------ report opening

/** Starts the warning for a report page without a StartHere, so callers can recognise it. */
export const NO_OPENING = 'no start-here opening';

/** What a StartHere shows, warning about anything that breaks the start-here rules (start-here.md). */
function describeStartHere(
  node: NodeOf<'StartHere'>,
  ctx: Context,
  warnings: string[],
): { shows: string; empty: boolean; warnings: string[] } {
  const byId = new Map<string, Entity>(
    [
      ...ctx.data.stages,
      ...ctx.data.goals,
      ...ctx.data.tasks,
      ...ctx.data.artifacts,
      ...ctx.data.decisions,
      ...ctx.data.claims,
      ...ctx.data.scopeItems,
      ...ctx.data.files,
    ].map((e) => [e.id, e]),
  );
  const claim = node.claim ? ctx.data.claims.find((c) => c.id === node.claim) : undefined;
  if (node.claim && !claim) warnings.push(`claim ${node.claim} not found in this project`);
  if (claim) warnings.push(...claimWarnings(claim, ctx.data.project));
  const headline = claim?.data.statement ?? node.headline ?? '';
  const max = START_HERE.headlineChars;
  if (!headline)
    warnings.push(
      'no headline: set headline to the outcome in one sentence, or claim on a found page',
    );
  else if (headline.length > max)
    warnings.push(
      `headline is ${headline.length} characters; keep it under ${max}: one sentence with a verb, details below`,
    );
  if (!node.why)
    warnings.push(
      `no why: add why, one line under ${START_HERE.whyChars} characters on what the work is for or the question it answers, so the reader knows why it exists before what it produced`,
    );
  else if (node.why.length > START_HERE.whyChars)
    warnings.push(
      `why is ${node.why.length} characters; keep it under ${START_HERE.whyChars}: what the work is for, in one line`,
    );
  if (!node.yourPart)
    warnings.push(
      'no yourPart: say in one line what the reader has to do, even "Nothing now", e.g. "Nothing now. When G1 resumes: approve the 3 test cases and targets."',
    );
  else if (node.yourPart.length > START_HERE.yourPartChars)
    warnings.push(
      `yourPart is ${node.yourPart.length} characters; keep it under ${START_HERE.yourPartChars}: one line, with the detail in a step below`,
    );

  const evidence = (node.evidence ?? []).map(evidenceId);
  for (const id of evidence)
    if (!byId.has(id)) warnings.push(`evidence ${id} not found in this project`);
  if (!claim && !evidence.some((id) => byId.has(id)))
    warnings.push(
      'the headline has no evidence: list what backs it in evidence (artifact, task or decision ids), or set claim on a found page',
    );

  const place = (id: string | undefined, type: 'stage' | 'goal') => {
    if (!id) return undefined;
    const e = byId.get(id);
    if (e?.type === type) return String(e.data[ENTITIES[type].label as keyof typeof e.data]);
    warnings.push(`${type}Id ${id} is not a ${type} in this project`);
    return undefined;
  };
  const stage = place(node.stageId, 'stage');
  const goal = place(node.goalId, 'goal');
  if (!node.stageId && !node.goalId && (ctx.data.stages.length || ctx.data.goals.length))
    warnings.push(
      'where it sits: set stageId or goalId so the reader knows which part of the project this is about',
    );

  const steps = node.path.length;
  if (steps < START_HERE.minSteps || steps > START_HERE.maxSteps)
    warnings.push(
      `the reading path has ${plural(steps, 'step')}; use ${START_HERE.minSteps}–${START_HERE.maxSteps}, and put more detail behind them`,
    );
  node.path.forEach((step, i) => {
    if (step.target && !ctx.widgetIds.has(step.target))
      warnings.push(
        `step ${i + 1} "${step.label}" points at widget "${step.target}", which isn't on this board`,
      );
  });
  if (node.purpose === 'needs-you' && !node.due)
    warnings.push('a needs-you page says by when: set due');

  const where = [ctx.data.project.data.name, stage, goal, node.date].filter(Boolean).join(' › ');
  const path = node.path.map((s, i) => `${i + 1} ${s.label}`).join(' → ');
  return {
    shows:
      `${node.purpose}: ${node.why ? `why: ${node.why}; ` : ''}“${headline}” (${where})` +
      `${node.yourPart ? `; your part: ${node.yourPart}` : ''}; path: ${path}`,
    empty: !headline,
    warnings,
  };
}

/**
 * A report page (one with a StartHere, ClaimCard or Layers) opens with exactly one StartHere,
 * before anything else the reader meets (start-here.md).
 */
function openingWarnings(board: Board): string[] {
  const roots = board.widgets.map((w) => w.node);
  const all = allNodes(roots);
  const opening = all.filter((n) => n.component === 'StartHere');
  if (!opening.length && !all.some(isExplaining)) return [];
  if (!opening.length)
    return [
      `${NO_OPENING}: open a report page with a StartHere (its purpose, a headline, where it sits, and a reading path of ${START_HERE.minSteps}–${START_HERE.maxSteps} steps)`,
    ];
  const out: string[] = [];
  if (opening.length > 1)
    out.push(
      `${opening.length} StartHere blocks: a report page has one purpose and one opening; keep one and split the rest into their own views`,
    );
  const first = readingOrder(roots).find((n) => !CONTAINERS.has(n.component));
  if (first && first.component !== 'StartHere')
    out.push(
      `the StartHere is not first: a ${first.component} comes before it; move it to the top so the reader starts there`,
    );
  return out;
}

// ------------------------------------------------------------------ reading budget (R3.6)

/**
 * What a node shows before the reader opens anything: `texts` count towards the word budget, and
 * `marked` are the texts where the web components underline terms. Data blocks (tables, lists,
 * boards) count only their title.
 */
function visibleText(node: ViewNode, ctx: Context): { texts: string[]; marked: string[] } {
  const title = node.title ?? '';
  const on = !('terms' in node) || node.terms !== false;
  switch (node.component) {
    case 'StartHere': {
      const claim = node.claim ? ctx.data.claims.find((c) => c.id === node.claim) : undefined;
      const headline = claim?.data.statement ?? node.headline ?? '';
      return {
        texts: [
          node.why ?? '',
          headline,
          node.yourPart ?? '',
          ...node.path.flatMap((step) => [step.label, step.says ?? '']),
        ],
        marked: on ? [headline] : [],
      };
    }
    case 'Text':
    case 'Markdown':
    case 'Callout': {
      const body = node.component === 'Text' ? describeLeaf(node, ctx).shows : nodeText(node, ctx);
      return { texts: [node.component === 'Text' ? title : '', body], marked: on ? [body] : [] };
    }
    case 'Section':
      return { texts: [title, node.description ?? ''], marked: [] };
    case 'ClaimCard': {
      const claim = ctx.data.claims.find((c) => c.id === node.claim);
      if (!claim) return { texts: [title], marked: [] };
      const said = [claim.data.statement, claim.data.detail ?? ''];
      return { texts: [title, node.kicker ?? '', ...said], marked: on ? said : [] };
    }
    case 'Layers': {
      // A stack and a flow show only the layer open at first; a row shows every step.
      const flow = node.orientation === 'flow';
      const isOpen = (layer: LayerSpec) => node.orientation === 'row' || layer.key === node.open;
      const shown = (layer: LayerSpec) => {
        if (!isOpen(layer)) return [];
        const pill = ctx.data.claims.filter((c) => c.id === layer.pill?.claim);
        const items = layerClaims(ctx, layer);
        return [...pill, ...items.filter((c) => !pill.includes(c))].flatMap((c) => [
          c.data.statement,
          c.data.detail ?? '',
        ]);
      };
      // A flow box shows its label; its hint opens with it.
      const inLayers = node.layers.flatMap((l) => [
        l.title,
        !flow || isOpen(l) ? (l.hint ?? '') : '',
        ...shown(l),
      ]);
      return {
        texts: [
          title,
          node.prompt ?? '',
          ...(node.legend ?? []).map((l) => l.label),
          ...(node.axis && !flow ? [node.axis.from, node.axis.to] : []),
          ...node.layers.map((l) => l.pill?.label ?? ''),
          ...node.layers.map((l) => layerProgress(ctx, l)?.replace(/ done$/, '') ?? ''),
          ...inLayers,
        ],
        // A flow is a picture: no underlines unless it asks for them.
        marked: (flow ? node.terms === true : on) ? inLayers : [],
      };
    }
    case 'BeforeAfter': {
      const said = beforeAfterText(node, ctx);
      return { texts: [title, ...said], marked: [] };
    }
    case 'FindingChart': {
      const claim = node.claim ? ctx.data.claims.find((c) => c.id === node.claim) : undefined;
      const bars = findingBars(node, ctx).map((b) => `${b.label} ${b.value}${b.unit ?? ''}`);
      return { texts: [title, claim?.data.statement ?? '', ...bars], marked: [] };
    }
    case 'TaskTable':
    case 'DataList': {
      // Rows aren't counted (data), but they underline terms when asked to.
      if (node.terms !== true) return { texts: [title], marked: [] };
      const query: Query =
        node.component === 'TaskTable' ? { type: 'task', ...node.filter } : node.query;
      const rows = runQuery(ctx.data, query.type, query, { today: ctx.today });
      return {
        texts: [title],
        marked: rows.map((r) => rowName(query.type, r.data, node.hideCodes === true)),
      };
    }
    default:
      return { texts: [title], marked: [] };
  }
}

/** The project's terms as one whole-word pattern, longest form first, like the web's termMatcher. */
function termPattern(ctx: Context) {
  const byForm = new Map<string, Entity<'term'>>();
  for (const term of ctx.data.terms)
    for (const form of [term.data.word, ...term.data.alsoCalled]) {
      const key = form.trim().toLowerCase();
      if (key && !byForm.has(key)) byForm.set(key, term);
    }
  if (!byForm.size) return null;
  const forms = [...byForm.keys()]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return { pattern, byForm };
}

/** Words that tell the reader what to do, which only the StartHere's yourPart should say. */
const YOUR_PART =
  /\b(your (part|turn|move|actions?|to-?dos?)|what you (need|have) to do|what to do next|(nothing )?needs? you|action needed|for you to (do|decide))\b/i;

/** Whether a node (other than the StartHere) speaks to the reader about their part; returns the words. */
function yourPartElsewhere(node: ViewNode, ctx: Context): string | undefined {
  const texts = [
    node.title ?? '',
    node.component === 'ClaimCard' ? (node.kicker ?? '') : '',
    node.component === 'Layers' ? node.layers.map((l) => l.title).join('\n') : '',
    node.component === 'Section' ? (node.description ?? '') : '',
    LEAD_IN.has(node.component) ? nodeText(node, ctx) : '',
  ];
  for (const text of texts) {
    const match = YOUR_PART.exec(text);
    if (match) return match[0];
  }
  return undefined;
}

/**
 * Report pages stay short (R3.6): the reader's part said once, at most START_HERE.pageWords
 * visible words before any detail, wordy findings one per line, and few underlined terms.
 */
function budgetWarnings(board: Board, ctx: Context): string[] {
  const all = allNodes(board.widgets.map((w) => w.node));
  if (!all.some((n) => n.component === 'StartHere' || isExplaining(n))) return [];
  const out: string[] = [];

  if (all.some((n) => n.component === 'StartHere'))
    for (const w of board.widgets) {
      const said = allNodes([w.node])
        .filter((n) => n.component !== 'StartHere')
        .map((n) => yourPartElsewhere(n, ctx))
        .find(Boolean);
      if (said)
        out.push(
          `widget "${w.id}" also tells the reader their part ("${said}"); say it once, in the StartHere's yourPart, and take it out here so the page can't contradict itself`,
        );
    }

  // Words before any detail, and underlined terms (each widget marks a term's first use in it).
  const matcher = termPattern(ctx);
  const perWidget: { id: string; words: number }[] = [];
  const underlined = new Map<string, string>();
  let marks = 0;
  for (const w of board.widgets) {
    let words = 0;
    for (const node of readingOrder([w.node])) {
      const shown = visibleText(node, ctx);
      words += shown.texts.reduce((sum, t) => sum + countWords(t), 0);
      if (!matcher) continue;
      const seen = new Set<string>();
      for (const text of shown.marked)
        for (const m of text.matchAll(matcher.pattern)) {
          const term = matcher.byForm.get(m[0].toLowerCase());
          if (!term || seen.has(term.id)) continue;
          seen.add(term.id);
          underlined.set(term.id, term.data.word);
        }
      marks += seen.size;
    }
    perWidget.push({ id: w.id, words });
  }
  const total = perWidget.reduce((sum, w) => sum + w.words, 0);
  if (total > START_HERE.pageWords) {
    const most = [...perWidget]
      .filter((w) => w.words)
      .sort((a, b) => b.words - a.words)
      .slice(0, 3)
      .map((w) => `"${w.id}" ${w.words}`)
      .join(', ');
    out.push(
      `the page shows ${total} words before the reader opens anything; keep it to about ${START_HERE.pageWords}. Most words: ${most}. Cut repeats and background, and move the rest into details on tap (a Layers stack, a claim's quote or assumption, a later tab); data tables don't count`,
    );
  }
  if (marks > START_HERE.maxTerms) {
    const words = [...underlined.values()].map((w) => `"${w}"`).join(', ');
    out.push(
      `the page underlines ${marks} terms (${words}); keep it to ${START_HERE.maxTerms} or fewer: keep a term only for a word a non-specialist wouldn't know, and delete it or set terms: false where the word is everyday`,
    );
  }

  // Wordy claim cards side by side, in a board row or a Grid of 3 or more columns.
  const wordy = (node: ViewNode) => {
    if (node.component !== 'ClaimCard') return false;
    const claim = ctx.data.claims.find((c) => c.id === node.claim);
    return !!claim && countWords(cardText(node, claim)) > START_HERE.sideBySideWords;
  };
  const sideBySide = (where: string, n: number, ids: string) =>
    out.push(
      `${where} puts ${n} claim cards with long statements side by side${ids}; wordy findings read better one per line: give each the full width or list them in a Layers stack, one short line each with details on tap. Keep side-by-side cards for short items such as numbers and labels`,
    );
  const rows: Board['widgets'][] = [[]];
  let used = 0;
  for (const w of board.widgets) {
    const width = w.w ?? BOARD_COLUMNS;
    if (used + width > BOARD_COLUMNS) {
      rows.push([]);
      used = 0;
    }
    rows.at(-1)!.push(w);
    used += width;
  }
  rows.forEach((row, i) => {
    const long = row.filter((w) => wordy(w.node));
    if (long.length >= 3)
      sideBySide(`row ${i + 1}`, long.length, ` (${long.map((w) => `"${w.id}"`).join(', ')})`);
  });
  for (const w of board.widgets)
    for (const node of allNodes([w.node])) {
      if (node.component !== 'Grid' || (node.columns ?? 2) < 3) continue;
      const long = node.children.filter(wordy).length;
      if (long >= 3) sideBySide(`a ${node.columns}-column Grid in "${w.id}"`, long, '');
    }
  return out;
}

function describeNode(
  node: ViewNode,
  ctx: Context,
): { shows: string; empty: boolean; warnings: string[] } {
  if (node.component === 'Grid' || node.component === 'Section' || node.component === 'Tabs') {
    const children =
      node.component === 'Tabs' ? node.tabs.flatMap((t) => t.children) : node.children;
    const parts = children.map((c) => ({ c, d: describeNode(c, ctx) }));
    return {
      shows: parts.map(({ c, d }) => `${c.title ?? c.component}: ${d.shows}`).join(' | '),
      empty: parts.every(({ d }) => d.empty),
      warnings: parts.flatMap(({ c, d }) =>
        d.warnings.map((w) => `${c.title ?? c.component}: ${w}`),
      ),
    };
  }
  return describeLeaf(node, ctx);
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What every widget of a board shows for a project right now, plus layout and filter warnings. */
export function previewBoard(store: Store, projectId: string, board: Board, today = localToday()) {
  const ctx: Context = {
    // Previews are for agents: file details only, no hidden files (R7.5).
    data: new AgentFiles(store).dataset(store.dataset(projectId)),
    store,
    today,
    widgetIds: new Map(board.widgets.map((w) => [w.id, w.node.component])),
  };
  const widgets: WidgetPreview[] = board.widgets.map((w) => {
    const width = w.w ?? BOARD_COLUMNS;
    const d = describeNode(w.node, ctx);
    const min = COMPONENT_INFO[w.node.component].minColumns;
    const warnings = [...d.warnings];
    if (width < min)
      warnings.push(
        `width ${width} is below the minimum of ${min} columns for ${w.node.component}`,
      );
    return {
      id: w.id,
      component: w.node.component,
      ...(w.node.title ? { title: w.node.title } : {}),
      width,
      shows: d.shows,
      empty: d.empty,
      warnings,
    };
  });

  // Rows flow left to right; flag rows that leave columns unused before the next widget wraps.
  const layout: string[] = [];
  let row = 0;
  let rowNo = 1;
  board.widgets.forEach((w, i) => {
    const width = w.w ?? BOARD_COLUMNS;
    if (row + width > BOARD_COLUMNS) {
      if (row < BOARD_COLUMNS)
        layout.push(
          `row ${rowNo} uses ${row} of ${BOARD_COLUMNS} columns before "${board.widgets[i]!.id}" wraps`,
        );
      row = 0;
      rowNo++;
    }
    row += width;
  });
  if (row > 0 && row < BOARD_COLUMNS && board.widgets.length > 1)
    layout.push(`the last row uses ${row} of ${BOARD_COLUMNS} columns`);

  // View-level: what a reader would trip over in an explanation view.
  const point = pointWarning(board, ctx);
  const warnings = [
    ...openingWarnings(board),
    ...(point ? [point] : []),
    ...budgetWarnings(board, ctx),
  ];

  const empty = widgets.filter((w) => w.empty).map((w) => w.id);
  return {
    widgets,
    layout,
    warnings,
    summary:
      `${plural(widgets.length, 'widget')}` +
      (empty.length
        ? `; ${empty.length} show an empty state (${empty.join(', ')})`
        : '; none empty') +
      (widgets.some((w) => w.warnings.length) || layout.length || warnings.length
        ? '; see warnings'
        : ''),
  };
}
