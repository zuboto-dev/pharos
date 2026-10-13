import {
  CATALOG,
  COMPONENT_INFO,
  TEMPLATES,
  ViewNode,
  type ComponentName,
  type ProjectDataset,
  type ViewSpec,
} from '@pharos/schema';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

const data = dataset as unknown as ProjectDataset;

// ActivityFeed fetches history; answer with an empty list.
vi.stubGlobal(
  'fetch',
  async () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
);
afterEach(cleanup);

function renderSpec(spec: ViewSpec, d: ProjectDataset = data) {
  return render(
    <ViewDataProvider data={d} version={1}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

/** One node per catalog component, with typical props. */
const SAMPLES: Record<ComponentName, ViewNode> = {
  Grid: { component: 'Grid', columns: 3, children: [{ component: 'ProgressRing', span: 2 }] },
  Section: { component: 'Section', title: 'S', children: [] },
  Tabs: { component: 'Tabs', tabs: [{ label: 'A', children: [{ component: 'TaskTable' }] }] },
  ProjectHeader: { component: 'ProjectHeader' },
  StatCards: {
    component: 'StatCards',
    stats: [
      { label: 'Done', query: { type: 'task', where: { status: 'done' } }, of: { type: 'task' } },
    ],
  },
  ProgressRing: { component: 'ProgressRing', where: { stageId: '$currentStage' } },
  Callout: { component: 'Callout', tone: 'warning', body: '**Heads up**' },
  Markdown: { component: 'Markdown', source: 'project.description' },
  GoalTree: { component: 'GoalTree' },
  ScopeBoard: { component: 'ScopeBoard' },
  StageTracker: { component: 'StageTracker' },
  Timeline: { component: 'Timeline' },
  MilestoneList: { component: 'MilestoneList' },
  KanbanBoard: { component: 'KanbanBoard', groupBy: 'stage' },
  TaskChecklist: { component: 'TaskChecklist', assigneeKind: 'human' },
  TaskTable: {
    component: 'TaskTable',
    columns: ['status', 'priority', 'stage', 'assignee', 'estimate', 'dependsOn'],
  },
  DependencyGraph: { component: 'DependencyGraph' },
  AssigneeMatrix: { component: 'AssigneeMatrix' },
  ArtifactGallery: { component: 'ArtifactGallery' },
  DecisionLog: { component: 'DecisionLog', filter: { limit: 2 } },
  DecisionBlock: { component: 'DecisionBlock', decision: 'dec_missing' },
  ActivityFeed: { component: 'ActivityFeed' },
  DataTable: COMPONENT_INFO.DataTable.example,
  CountChart: COMPONENT_INFO.CountChart.example,
  Stat: COMPONENT_INFO.Stat.example,
  DataList: COMPONENT_INFO.DataList.example,
  Text: COMPONENT_INFO.Text.example,
  Layers: COMPONENT_INFO.Layers.example,
  BeforeAfter: COMPONENT_INFO.BeforeAfter.example,
  FindingChart: COMPONENT_INFO.FindingChart.example,
  FileList: COMPONENT_INFO.FileList.example,
  FileView: COMPONENT_INFO.FileView.example,
  Gallery: COMPONENT_INFO.Gallery.example,
  ClaimCard: COMPONENT_INFO.ClaimCard.example,
  StartHere: COMPONENT_INFO.StartHere.example,
  DueTracker: COMPONENT_INFO.DueTracker.example,
  CategoryBreakdown: COMPONENT_INFO.CategoryBreakdown.example,
};

const empty: ProjectDataset = {
  ...data,
  project: { ...data.project, data: { name: 'Empty', status: 'planning', order: 0 } },
  goals: [],
  scopeItems: [],
  stages: [],
  tasks: [],
  artifacts: [],
  decisions: [],
};

describe('catalog components', () => {
  it('has a sample for every catalog component', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(CATALOG).sort());
  });

  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name} renders with data and when empty`, () => {
      expect(ViewNode.safeParse(spec).success).toBe(true);
      for (const d of [data, empty]) {
        const { container, unmount } = renderSpec(spec, d);
        expect(container.textContent).not.toMatch(/failed to render|Unknown component/);
        unmount();
      }
    });
  }

  it('renders the overview template with project content', () => {
    const { container } = renderSpec(TEMPLATES.overview);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/failed to render/);
    for (const expected of [
      'Pharos',
      'M2 Catalog + renderer',
      'Catalog components',
      'Every change is traceable',
      'Multi-user accounts',
      'Use node:sqlite instead of Drizzle',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('draws the R4 picture stubs from stored claims', () => {
    const claim = (id: string, extra: Record<string, unknown>) => ({
      id,
      type: 'claim',
      createdAt: '',
      updatedAt: '',
      createdRev: 1,
      updatedRev: 1,
      data: {
        projectId: data.project.id,
        statement: `Claim ${id}`,
        certainty: 'reading',
        checkedOn: '2026-10-12',
        sourceIds: [],
        tags: [],
        order: 0,
        ...extra,
      },
    });
    const withClaims = {
      ...data,
      claims: [
        claim('clm_change', { statement: 'The guide says how to start.' }),
        claim('clm_before', { quote: 'Run pnpm dev to start.' }),
        claim('clm_after', { quote: 'Run pnpm service install to start.' }),
        claim('clm_tokens_headline', { statement: 'OpenUI needs half the tokens.' }),
        claim('clm_openui_tokens', {
          figure: { value: 4800, unit: 'tokens', label: 'OpenUI' },
          tags: ['token-benchmark'],
        }),
        claim('clm_json_tokens', {
          figure: { value: 10180, unit: 'tokens', label: 'JSON' },
          tags: ['token-benchmark'],
          order: 1,
        }),
      ],
    } as unknown as ProjectDataset;
    const before = renderSpec(COMPONENT_INFO.BeforeAfter.example, withClaims).container;
    expect(before.querySelector('del')?.textContent?.trim()).toBe('dev');
    expect(before.querySelector('ins')?.textContent?.trim()).toBe('service install');
    expect(before.textContent).toContain('The guide says how to start.');
    expect(before.textContent).toContain('Before · 8bb6b32');
    cleanup();
    const chart = renderSpec(COMPONENT_INFO.FindingChart.example, withClaims).container;
    expect(chart.textContent).toContain('OpenUI needs half the tokens.');
    expect([...chart.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      `OpenUI${(4800).toLocaleString()} tokens`,
      `JSON${(10180).toLocaleString()} tokens`,
    ]);
  });

  it('isolates a crashing component behind its error boundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      ...data,
      tasks: [{ ...data.tasks[0]!, data: { ...data.tasks[0]!.data, dependsOn: null } }],
    } as unknown as ProjectDataset;
    const { container } = renderSpec(
      { component: 'Section', children: [{ component: 'KanbanBoard' }, { component: 'GoalTree' }] },
      broken,
    );
    expect(container.textContent).toMatch(/KanbanBoard failed to render/);
    expect(container.textContent).toContain('Every change is traceable');
    spy.mockRestore();
  });
});
