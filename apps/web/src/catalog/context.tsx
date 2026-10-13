import type { Entity, Operation, ProjectDataset } from '@pharos/schema';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type OpenTarget = { entity: string } | { revision: number } | { history: true };

/** `revision` is null when the changes didn't change anything. */
export type ApplyOutcome =
  { ok: true; revision: number | null; created: Record<string, string> } | { ok: false };

/** What a question is about, when someone asks the agent from the UI. */
export type AskAbout = { label: string; viewId?: string; widgetId?: string; aboutId?: string };

export type ViewActions = {
  /** Opens the "ask the agent" dialog (only where asking is available). */
  ask?: (about: AskAbout) => void;
  /** Saves changes as one revision by the human user; `undoable` offers an Undo afterwards. */
  apply: (
    message: string,
    operations: Operation[],
    options?: { undoable?: boolean },
  ) => Promise<ApplyOutcome>;
  /** Shows an entity, a revision, or the project's history in the detail drawer. */
  open: (target: OpenTarget) => void;
  /** Reverts any revision as a new revision (where history can be changed). */
  revert?: (
    revision: number,
    message: string,
  ) => Promise<{ ok: true; revision: number | null } | { ok: false; error: string }>;
};

export type ViewData = ProjectDataset & {
  stageById: Map<string, Entity<'stage'>>;
  taskById: Map<string, Entity<'task'>>;
  assigneeById: Map<string, Entity<'assignee'>>;
  /** Every entity in the dataset, of any type. */
  entityById: Map<string, Entity>;
  /** Changes whenever the dataset is refetched; components that fetch extra data key on it. */
  version: number;
  actions: ViewActions;
};

const READ_ONLY: ViewActions = { apply: async () => ({ ok: false }), open: () => {} };

const ViewDataContext = createContext<ViewData | null>(null);

export function ViewDataProvider({
  data,
  version,
  actions = READ_ONLY,
  children,
}: {
  data: ProjectDataset;
  version: number;
  actions?: ViewActions;
  children: ReactNode;
}) {
  const value = useMemo<ViewData>(() => {
    const all: Entity[] = [
      data.project,
      ...(data.repository ? [data.repository] : []),
      ...data.assignees,
      ...data.goals,
      ...data.scopeItems,
      ...data.stages,
      ...data.tasks,
      ...data.artifacts,
      ...data.decisions,
      ...data.claims,
      ...data.terms,
      ...(data.files ?? []),
      ...data.views,
    ];
    return {
      ...data,
      stageById: new Map(data.stages.map((s) => [s.id, s])),
      taskById: new Map(data.tasks.map((t) => [t.id, t])),
      assigneeById: new Map(data.assignees.map((a) => [a.id, a])),
      entityById: new Map(all.map((e) => [e.id, e])),
      version,
      actions,
    };
  }, [data, version, actions]);
  return <ViewDataContext.Provider value={value}>{children}</ViewDataContext.Provider>;
}

export function useViewData(): ViewData {
  const value = useContext(ViewDataContext);
  if (!value) throw new Error('useViewData must be used inside ViewDataProvider');
  return value;
}
