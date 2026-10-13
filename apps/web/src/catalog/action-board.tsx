import type { NodeOf, Widget } from '@pharos/schema';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The page an Action block is on (R10): its view id (a submission names the page and block, and
 * the server reads the action from there) and the board's Action blocks, so a DueTracker row can
 * open the "done" Action its `action` prop names.
 */
export type BoardActions = {
  viewId?: string;
  action: (widgetId: string) => NodeOf<'Action'> | undefined;
};

const BoardActionsContext = createContext<BoardActions>({ action: () => undefined });

export function BoardActionsProvider({
  viewId,
  widgets,
  children,
}: {
  viewId?: string;
  widgets: Widget[];
  children: ReactNode;
}) {
  const value = useMemo<BoardActions>(() => {
    const actions = new Map(
      widgets.flatMap((w) => (w.node.component === 'Action' ? [[w.id, w.node] as const] : [])),
    );
    return { viewId, action: (id) => actions.get(id) };
  }, [viewId, widgets]);
  return <BoardActionsContext.Provider value={value}>{children}</BoardActionsContext.Provider>;
}

export const useBoardActions = () => useContext(BoardActionsContext);
