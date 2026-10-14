import type { Entity } from '@pharos/schema';
import { useCallback } from 'react';
import { useOpenFile } from '../files/viewer-context';
import { useBoardFiles } from './board-files';
import { useViewData } from './context';
import { isHttp } from './ui';

/**
 * What tapping an item opens (R7.12, v0.2 A6): every artifact row or item opens its document,
 * wherever it is listed (DataTable, DataList, ArtifactGallery, links in TaskTable and the rest).
 * - a file, or an artifact linked to one (`fileId`): the board's FileView when the board has one,
 *   else the file viewer (a modal with its preview; `list` is what ← → step through);
 * - an artifact with a web address: the page, in a new tab;
 * - anything else (an artifact whose local document isn't in Pharos yet, a task, …): its drawer,
 *   where an artifact's panel says which folder it needs and offers Approve when asked for.
 */
export function useOpenItem(
  options: {
    /**
     * A file itself (not an artifact linked to one) opens in the viewer even when the board has
     * a FileView: a file's own row or card (a FileList without `showIn`) opens it (v0.2 A6).
     */
    fileItself?: boolean;
  } = {},
): (id: string, list?: readonly string[]) => void {
  const { entityById, actions } = useViewData();
  const board = useBoardFiles();
  const openFile = useOpenFile();
  const { fileItself = false } = options;
  return useCallback(
    (id: string, list?: readonly string[]) => {
      const showFile = (fileId: string) => {
        const target = board?.fileViews[0];
        if (!target) return openFile(fileId, list);
        board!.show(target, fileId);
        const widget = document.querySelector<HTMLElement>(`[data-widget="${CSS.escape(target)}"]`);
        widget?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      };
      const entity = entityById.get(id);
      if (entity?.type === 'file') return fileItself ? openFile(id, list) : showFile(id);
      if (entity?.type === 'artifact') {
        const { fileId, uri } = (entity as Entity<'artifact'>).data;
        if (fileId && entityById.get(fileId)?.type === 'file') return showFile(fileId);
        if (isHttp(uri)) {
          window.open(uri, '_blank', 'noopener,noreferrer');
          return;
        }
      }
      actions.open({ entity: id });
    },
    [entityById, actions, board, fileItself, openFile],
  );
}
