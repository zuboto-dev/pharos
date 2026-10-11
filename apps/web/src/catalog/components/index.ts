import type { ComponentName, NodeOf } from '@pharos/schema';
import type { ReactNode } from 'react';
import { CountChart, DataList, DataTable, Stat, TextBlock } from './generic';
import { GoalTree, ScopeBoard } from './goals';
import { ClaimCard, Layers } from './knowledge';
import { ActivityFeed, ArtifactGallery, DecisionLog } from './outputs';
import { Callout, MarkdownBlock, ProgressRing, ProjectHeader, StatCards } from './overview';
import { MilestoneList, StageTracker, Timeline } from './plan';
import { AssigneeMatrix, DependencyGraph, KanbanBoard, TaskChecklist, TaskTable } from './work';

type LeafName = Exclude<ComponentName, 'Grid' | 'Section' | 'Tabs'>;

type ComponentDef<C extends LeafName> = {
  render: (props: { node: NodeOf<C> }) => ReactNode;
  /** Render without the panel frame. */
  bare?: boolean;
  /** Panel without inner padding. */
  flush?: boolean;
  /** The component shows `title` itself, so the frame shouldn't repeat it. */
  ownTitle?: boolean;
};

export const COMPONENTS: { [C in LeafName]: ComponentDef<C> } = {
  ProjectHeader: { render: ProjectHeader, bare: true },
  StatCards: { render: StatCards, bare: true },
  ProgressRing: { render: ProgressRing },
  Callout: { render: Callout, bare: true, ownTitle: true },
  Markdown: { render: MarkdownBlock },
  GoalTree: { render: GoalTree },
  ScopeBoard: { render: ScopeBoard },
  StageTracker: { render: StageTracker },
  Timeline: { render: Timeline },
  MilestoneList: { render: MilestoneList },
  KanbanBoard: { render: KanbanBoard },
  TaskTable: { render: TaskTable },
  TaskChecklist: { render: TaskChecklist },
  DependencyGraph: { render: DependencyGraph },
  AssigneeMatrix: { render: AssigneeMatrix },
  ArtifactGallery: { render: ArtifactGallery },
  DecisionLog: { render: DecisionLog },
  ActivityFeed: { render: ActivityFeed },
  DataTable: { render: DataTable },
  CountChart: { render: CountChart },
  Stat: { render: Stat, bare: true },
  DataList: { render: DataList },
  Text: { render: TextBlock, bare: true },
  Layers: { render: Layers, bare: true },
  ClaimCard: { render: ClaimCard, bare: true },
};
