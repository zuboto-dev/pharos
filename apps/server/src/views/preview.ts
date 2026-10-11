import {
  BOARD_COLUMNS,
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
import { claimSourceWarning, type Store } from '../store/store.js';

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

type Context = { data: ProjectDataset; store: Store; today: string };

function count(ctx: Context, query: Query): number {
  return runQuery(ctx.data, query.type, query, { today: ctx.today }).length;
}

function sample(ctx: Context, query: Query, n = 3): string {
  const label = ENTITIES[query.type].label;
  const rows = runQuery(ctx.data, query.type, query, { today: ctx.today });
  const names = rows.slice(0, n).map((r) => `“${(r.data as Record<string, unknown>)[label]}”`);
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
          ? sample(ctx, { type: 'task', ...(n.filter as Filter) })
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
      return { shows: sample(ctx, q), empty: !count(ctx, q), warnings };
    }
    case 'CountChart': {
      const c = node as NodeOf<'CountChart'>;
      const q = queryOf(c.query);
      const problem = pathProblem(q.type, c.by);
      if (problem) warnings.push(problem);
      const read = fieldReader(ctx.data, { today: ctx.today });
      // Show what people see: names for references, labels for options, not raw ids or values.
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
      const groups = new Map<string, number>();
      for (const row of runQuery(ctx.data, q.type, q, { today: ctx.today })) {
        const { value, type, field } = read(row, c.by);
        for (const v of Array.isArray(value) ? value : [value]) {
          const label = display(v, type, field);
          groups.set(label, (groups.get(label) ?? 0) + 1);
        }
      }
      const parts = [...groups].map(([k, v]) => `${k} ${v}`);
      return {
        shows: parts.length ? parts.join(' · ') : 'Nothing matches',
        empty: !parts.length,
        warnings,
      };
    }
    case 'ActivityFeed': {
      const n2 = ctx.store.history({
        projectId: ctx.data.project.id,
        limit: (node as NodeOf<'ActivityFeed'>).limit ?? 10,
      }).length;
      return { shows: plural(n2, 'recent change'), empty: !n2, warnings };
    }
    default:
      return { shows: node.component, empty: false, warnings };
  }
}

// ------------------------------------------------------------------ explanation views

/**
 * Blocks that show stored claims. A view that uses one is an explanation view, and only those get
 * the reader checks below; task boards and other project views stay quiet.
 */
const EXPLAINING = ['ClaimCard', 'Layers'] as const;
/** Text blocks that may come before the point. */
const LEAD_IN = new Set<string>(['Markdown', 'Text', 'Callout']);
const CONTAINERS = new Set<string>(['Grid', 'Section', 'Tabs']);
/** Most words allowed before the first ClaimCard: about two short sentences (slice-1.md §5). */
export const POINT_WORDS = 30;

type Explaining = NodeOf<'ClaimCard'> | NodeOf<'Layers'>;

function isExplaining(node: ViewNode): node is Explaining {
  return (EXPLAINING as readonly string[]).includes(node.component);
}

/** How the reader sees a claim: its statement and its certainty mark. */
function claimLine(ctx: Context, claim: Entity<'claim'>): string {
  const { statement, certainty, checkedOn, sourceIds } = claim.data;
  const label =
    optionsFor(ctx.data.project, 'claim.certainty').find((o) => o.value === certainty)?.label ??
    certainty;
  return `“${statement}” (${label}, ${checkedOn}, ${plural(sourceIds.length, 'source')})`;
}

/** What a ClaimCard or Layers shows, warning about missing claims, claims without a source, and empty layers. */
function describeExplaining(
  node: Explaining,
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
      const warning = claimSourceWarning(claim, ctx.data.project);
      if (warning) warnings.push(warning);
    }
  };
  if (node.component === 'ClaimCard') {
    const claim = find(node.claim);
    sourceWarnings();
    return {
      shows: claim ? claimLine(ctx, claim) : 'a missing claim (shows an empty state)',
      empty: !claim,
      warnings,
    };
  }
  const parts = node.layers.map((layer) => {
    warnings.push(...filterProblems('claim', layer.items));
    const pill = layer.pill?.claim ? find(layer.pill.claim) : undefined;
    const rows = runQuery(
      ctx.data,
      'claim',
      { sort: [{ field: 'order' }], ...layer.items },
      { today: ctx.today },
    );
    shown.push(...rows);
    if (!rows.length) warnings.push(`layer "${layer.key}" shows nothing`);
    return {
      rows,
      text: `${layer.key} ${layer.title}: ${rows.length ? plural(rows.length, 'claim') : 'nothing'}${pill ? ` (pill: ${claimLine(ctx, pill)})` : ''}`,
    };
  });
  sourceWarnings();
  return {
    shows: parts.map((p) => p.text).join(' · '),
    empty: parts.every((p) => !p.rows.length),
    warnings,
  };
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
  const fix = `put a ClaimCard with size "headline" first and keep what comes before it to ${POINT_WORDS} words or fewer`;
  const order = readingOrder(roots);
  if (!order.some((n) => n.component === 'ClaimCard'))
    return `the point comes too late: no ClaimCard states it where the reader starts; ${fix}`;
  let words = 0;
  for (const node of order) {
    words += countWords(nodeText(node, ctx));
    if (node.component === 'ClaimCard') {
      return words > POINT_WORDS
        ? `the point comes too late: ${words} words before the first ClaimCard; ${fix}`
        : null;
    }
    if (!CONTAINERS.has(node.component) && !LEAD_IN.has(node.component))
      return `the point comes too late: a ${node.component} comes before the first ClaimCard; ${fix}`;
  }
  return null;
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
  const ctx: Context = { data: store.dataset(projectId), store, today };
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
  const warnings = point ? [point] : [];

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
