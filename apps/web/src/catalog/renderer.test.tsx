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
import { readFileSync } from 'node:fs';
import { contrastIssues } from '../test/contrast';

// A variable path, so Vite leaves the URL alone.
const cssFile = '../index.css';

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

// v0.2 B6: every block reads in dark mode. Text must meet WCAG AA (4.5:1, large text 3:1) on
// the block's surface, with the colours its classes give in dark mode (see test/contrast.ts).
describe('dark mode contrast', () => {
  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name} has readable text in dark mode`, () => {
      for (const d of [data, empty]) {
        const { container, unmount } = renderSpec(spec, d);
        expect(contrastIssues(container, 'dark')).toEqual([]);
        unmount();
      }
    });
  }
});

// v0.2 B9: every block fits a 390 px phone. happy-dom doesn't lay out, so this reads the classes
// that decide width (scripts/phone-check.mjs measures real pages in Chrome): anything wider than
// the phone, at the base (phone) breakpoint, must sit inside a box that scrolls sideways itself.
describe('phone width', () => {
  const PHONE_PX = 390 - 2 * 16;
  const REM = 16;
  /** The phone-width size a class sets, in px (`w-[30rem]`, `min-w-96`, `w-[420px]`). */
  const sizeOf = (cls: string): number | undefined => {
    const m = /^(?:min-)?w-(?:\[(\d+(?:\.\d+)?)(px|rem)\]|(\d+(?:\.\d+)?))$/.exec(cls);
    if (!m) return undefined;
    if (m[3]) return Number(m[3]) * 4; // the spacing scale: 0.25rem a step
    return Number(m[1]) * (m[2] === 'rem' ? REM : 1);
  };
  const scrolls = (el: Element) =>
    !!el.parentElement?.closest(
      '.overflow-x-auto, .overflow-auto, .overflow-x-scroll, .overflow-hidden, .overflow-x-hidden',
    );
  for (const [name, spec] of Object.entries(SAMPLES)) {
    it(`${name} fits a phone`, () => {
      for (const d of [data, empty]) {
        const { container, unmount } = renderSpec(spec, d);
        for (const el of container.querySelectorAll('[class]')) {
          for (const cls of el.classList) {
            const px = sizeOf(cls);
            if (px && px > PHONE_PX)
              expect(scrolls(el), `${name}: .${cls} is wider than a phone`).toBe(true);
          }
        }
        for (const table of container.querySelectorAll('table'))
          expect(
            table.closest('.overflow-x-auto'),
            `${name}: a table that can't scroll`,
          ).toBeTruthy();
        unmount();
      }
    });
  }

  it('makes every control 44 px to tap on touch screens', () => {
    const css = readFileSync(new URL(cssFile, import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(rule).toMatch(/min-height: 44px;\s*min-width: 44px;/);
    expect(css).toMatch(/@utility tap-area[\s\S]*width: max\(100%, 44px\)/);
  });
});

// v0.2 B8: a block with nothing to show says what's missing and the next step ("icon, line and a
// button"), never a bare "Nothing matches".
describe('empty states', () => {
  const bare: ProjectDataset = { ...empty, claims: [], terms: [], files: [], records: [] };
  // Blocks that always have something to show: layout, the project itself, numbers (a zero is an
  // answer), fixed text, and blocks whose content comes from the spec.
  const ALWAYS = new Set([
    'Grid',
    'Section',
    'Tabs',
    'ProjectHeader',
    'StatCards',
    'ProgressRing',
    'Callout',
    'KanbanBoard',
    'ActivityFeed',
    'Stat',
    'Text',
    'Layers',
    'StartHere',
  ]);
  for (const [name, spec] of Object.entries(SAMPLES)) {
    if (ALWAYS.has(name)) continue;
    it(`${name} says what's missing and what to do`, () => {
      const { container } = renderSpec(spec, bare);
      const state = container.querySelector('[data-empty-state]');
      expect(state, name).not.toBeNull();
      expect(state!.querySelector('svg')).not.toBeNull();
      expect(state!.querySelector('p.font-medium')?.textContent).toBeTruthy();
      expect(container.textContent).not.toMatch(/Nothing matches/);
    });
  }
});
