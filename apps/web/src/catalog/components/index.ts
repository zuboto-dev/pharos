import type { ComponentName, NodeOf } from '@pharos/schema';
import type { ReactNode } from 'react';
import { CountChart, DataList, DataTable, Stat, TextBlock } from './generic';
import { GoalTree, ScopeBoard } from './goals';
import { BeforeAfter } from './before-after';
import { FileList } from './file-list';
import { FileView } from './file-view';
import { Gallery } from './gallery';
import { FindingChart } from './finding-chart';
import { ClaimCard, Layers } from './knowledge';
import { ActivityFeed, ArtifactGallery, DecisionLog } from './outputs';
import { Callout, MarkdownBlock, ProgressRing, ProjectHeader, StatCards } from './overview';
import { MilestoneList, StageTracker, Timeline } from './plan';
import { StartHere } from './start-here';
import { CategoryBreakdown, DueTracker } from './records';
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
  FileList: { render: FileList },
  FileView: { render: FileView },
  Gallery: { render: Gallery },
  ActivityFeed: { render: ActivityFeed },
  DataTable: { render: DataTable },
  CountChart: { render: CountChart },
  Stat: { render: Stat, bare: true },
  DataList: { render: DataList },
  Text: { render: TextBlock, bare: true },
  Layers: { render: Layers, bare: true },
  ClaimCard: { render: ClaimCard, bare: true },
  BeforeAfter: { render: BeforeAfter, bare: true },
  FindingChart: { render: FindingChart },
  StartHere: { render: StartHere, bare: true },
  DueTracker: { render: DueTracker },
  CategoryBreakdown: { render: CategoryBreakdown },
};
