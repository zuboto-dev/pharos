import { createContext, useCallback, useContext } from 'react';
import { useViewData } from '../catalog/context';

// The file viewer (v0.2 A6): one modal for every place a reader opens a file. The owner: "A
// modal is a viewer for the file in a widget or detail view when user clicked." This module is
// only the hook, so blocks can open the viewer without importing it (FileViewer.tsx has it).

export type FileViewerApi = {
  /**
   * Opens the viewer on a file. `list` is the files of the list it was opened from, in the order
   * shown, for ← → and the arrows; without it, just this file.
   */
  open: (fileId: string, list?: readonly string[]) => void;
};

export const FileViewerContext = createContext<FileViewerApi | null>(null);

/** The viewer, or null outside one (then files open in the drawer, as before). */
export const useFileViewer = () => useContext(FileViewerContext);

/** Opens a file: in the viewer when there is one, else its details in the drawer. */
export function useOpenFile(): (fileId: string, list?: readonly string[]) => void {
  const viewer = useFileViewer();
  const { actions } = useViewData();
  return useCallback(
    (fileId, list) => (viewer ? viewer.open(fileId, list) : actions.open({ entity: fileId })),
    [viewer, actions],
  );
}
