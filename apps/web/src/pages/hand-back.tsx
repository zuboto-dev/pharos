import type { Entity, Operation } from '@pharos/schema';
import { Archive, ArchiveRestore, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useViewData } from '../catalog/context';
import { BUTTON } from '../catalog/ui';
import { getJson } from '../lib/api';
import { deskSummary, useSheetTasks, type Sheet } from './document-rich';

// Handing a finished review document back (R15): a review document is tentative, it exists to
// collect the owner's answers. When their last answer completes it, Pharos offers to archive it
// and tell the agent, in one revision whose message says so and which project_snapshot lists
// under `handedBack` until the agent has looked.

/** Pinned and template (Overview) views are never archived. */
export const canArchive = (view: Entity<'view'>): boolean =>
  !view.data.pinned &&
  !view.data.template &&
  view.data.kind !== 'answer' &&
  view.data.kind !== 'main';

/** What the hand-back revision says: plainly what happened, for the agent's changes_since. */
export function handBackMessage(name: string, answered: number, agent: string | undefined) {
  return `Archive “${name}”: all ${answered} answered — over to ${agent ?? 'the agent'}`;
}

/** The hand-back: the view archived, with whom it went back to and how many were answered. */
export function handBack(
  view: Entity<'view'>,
  answered: number,
  agent: string | undefined,
): { message: string; operations: Operation[] } {
  return {
    message: handBackMessage(view.data.name, answered, agent),
    operations: [
      {
        op: 'update',
        type: 'view',
        id: view.id,
        data: { archived: true, handedBack: { ...(agent ? { to: agent } : {}), answered } },
      },
    ],
  };
}

/** Restoring an archived view (and ending its hand-back, if it had one). */
export function restoreView(view: Entity<'view'>): { message: string; operations: Operation[] } {
  return {
    message: `Restore view “${view.data.name}”`,
    operations: [
      {
        op: 'update',
        type: 'view',
        id: view.id,
        data: view.data.handedBack ? { archived: null, handedBack: null } : { archived: null },
      },
    ],
  };
}

/** The author of the view's latest agent revision: who wrote the report. */
async function agentOf(viewId: string): Promise<string | undefined> {
  try {
    const [latest] = await getJson<{ author: { kind: string; name: string } }[]>(
      `/api/history?entityId=${encodeURIComponent(viewId)}&authorKind=agent&limit=1`,
    );
    return latest?.author.kind === 'agent' ? latest.author.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the document's sheets that ask something are all answered, and how many. Every
 * top-level sheet counts (one is enough), as the review desk counts them.
 */
function useCompletion(sheets: Sheet[]) {
  const desk = deskSummary(sheets, useViewData().decisions, useSheetTasks());
  return { complete: desk.asked > 0 && desk.answered === desk.asked, answered: desk.answered };
}

/**
 * Offers to archive a review document and tell its agent at the moment the owner's last answer
 * completes it in this browser session: never when it opens already finished, never for a
 * document that asks nothing.
 */
export function HandBackPrompt({ view, sheets }: { view: Entity<'view'>; sheets: Sheet[] }) {
  const { actions } = useViewData();
  const { complete, answered } = useCompletion(sheets);
  // Where the document stood at the last render: only a change to complete opens the dialog.
  const [before, setBefore] = useState({ id: view.id, complete });
  const [shown, setShown] = useState<{ id: string; answered: number } | null>(null);
  if (before.id !== view.id || before.complete !== complete) {
    setBefore({ id: view.id, complete });
    const becameComplete = before.id === view.id && !before.complete && complete;
    if (becameComplete && canArchive(view) && !view.data.archived)
      setShown({ id: view.id, answered });
    else setShown(null);
  }
  // Who wrote it: the author of the view's latest agent revision.
  const [agent, setAgent] = useState<{ id: string; name?: string } | null>(null);
  const asking = shown?.id;
  useEffect(() => {
    if (!asking) return;
    let live = true;
    void agentOf(asking).then((name) => live && setAgent({ id: asking, name }));
    return () => {
      live = false;
    };
  }, [asking]);
  if (!shown) return null;
  const close = () => setShown(null);
  return (
    <HandBackDialog
      answered={shown.answered}
      agent={agent?.id === shown.id ? agent.name : undefined}
      onKeep={close}
      onArchive={() => {
        close();
        const { message, operations } = handBack(
          view,
          shown.answered,
          agent?.id === shown.id ? agent.name : undefined,
        );
        void actions.apply(message, operations, { undoable: true });
      }}
    />
  );
}

/** "All N answered. Archive this report and tell <agent>?" */
export function HandBackDialog({
  answered,
  agent,
  onArchive,
  onKeep,
}: {
  answered: number;
  agent?: string;
  onArchive: () => void;
  onKeep: () => void;
}) {
  const titleId = useId();
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeep();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-hand-back=""
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div className="absolute inset-0 bg-neutral-900/20 dark:bg-black/40" onClick={onKeep} />
      <div className="relative w-full max-w-sm animate-pop-in space-y-4 rounded-block bg-surface p-5 shadow-overlay">
        <div className="space-y-1">
          <p id={titleId} className="text-base font-semibold">
            All {answered} answered.
          </p>
          <p className="text-sm text-muted">Archive this report and tell {agent ?? 'the agent'}?</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onKeep} className={BUTTON.secondary}>
            Keep it open
          </button>
          <button ref={primary} type="button" onClick={onArchive} className={BUTTON.primary}>
            <Send className="size-3.5" aria-hidden /> Archive and tell the agent
          </button>
        </div>
      </div>
    </div>
  );
}

/** Above an archived view: it is archived (handed back, when it was), with Restore. */
export function ArchivedNotice({ view }: { view: Entity<'view'> }) {
  const { actions } = useViewData();
  const back = view.data.handedBack;
  return (
    <div
      data-archived-notice=""
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-tile bg-sunken px-4 py-2.5 text-sm"
    >
      <Archive className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Archived</span>
        {back && (
          <span className="text-muted">
            {' '}
            · all {back.answered} answered, handed back to {back.to ?? 'the agent'}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => {
          const { message, operations } = restoreView(view);
          void actions.apply(message, operations, { undoable: true });
        }}
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        <ArchiveRestore className="size-3.5" aria-hidden /> Restore
      </button>
    </div>
  );
}
