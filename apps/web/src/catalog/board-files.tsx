import type { Widget } from '@pharos/schema';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Files shown on one board (R7.11): a FileList whose `showIn` names a FileView widget on the same
 * board shows the tapped file there instead of opening the drawer. The board keeps which file
 * each FileView shows; nothing is saved, so a reload shows each FileView's own `file` again.
 */
export type BoardFiles = {
  /** The file each FileView widget shows now, by widget id (its `file` until one is picked). */
  shown: (widgetId: string) => string | undefined;
  /** The FileView widgets on the board, in board order (R7.12: linked files open in the first). */
  fileViews: string[];
  /** Whether a FileView widget with this id is on the board. */
  has: (widgetId: string) => boolean;
  show: (widgetId: string, fileId: string) => void;
  /** Another widget on the board, by id (v0.2 B10: StartHere reads the block it points at). */
  widget: (widgetId: string) => Widget | undefined;
};

const BoardFilesContext = createContext<BoardFiles | null>(null);
const WidgetIdContext = createContext<string | null>(null);

export function BoardFilesProvider({
  widgets,
  children,
}: {
  widgets: Widget[];
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const defaults = useMemo(
    () =>
      new Map(
        widgets
          .filter((w) => w.node.component === 'FileView')
          .map((w) => [w.id, w.node.component === 'FileView' ? w.node.file : undefined]),
      ),
    [widgets],
  );
  const show = useCallback(
    (widgetId: string, fileId: string) => setPicked((p) => ({ ...p, [widgetId]: fileId })),
    [],
  );
  const value = useMemo<BoardFiles>(
    () => ({
      shown: (id) => picked[id] ?? defaults.get(id),
      fileViews: [...defaults.keys()],
      has: (id) => defaults.has(id),
      show,
      widget: (id) => widgets.find((w) => w.id === id),
    }),
    [picked, defaults, show, widgets],
  );
  return <BoardFilesContext.Provider value={value}>{children}</BoardFilesContext.Provider>;
}

/** Tells the component inside a board widget its widget id. */
export function WidgetIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <WidgetIdContext.Provider value={id}>{children}</WidgetIdContext.Provider>;
}

/** The board's files, or null outside a board. */
export const useBoardFiles = () => useContext(BoardFilesContext);

/** The id of the board widget this component is in, or null outside a board. */
export const useWidgetId = () => useContext(WidgetIdContext);
