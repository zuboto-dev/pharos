import clsx from 'clsx';
import { Crosshair, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_BUTTON, Tooltip } from '../catalog/tooltip';
import type { AskAbout } from '../catalog/context';
import { AgentPanel, type TerminalStatus } from './AgentPanel';
import { isPanelShortcut } from './shortcut';
import { PickHighlight, SelectionPoint, usePicker } from './picker';
import { describeTarget, kindLabel, referenceText, type PickTarget } from './reference';
import type { InboxItem } from './TerminalView';

const OPEN_KEY = 'pharos-agent-panel-open';

function readOpen(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The project page's agent panel state (R17): open, and what waits to be typed into it. Whether
 * it is open is remembered per project in this browser, so coming back to a project whose panel
 * you left open opens it again (its agent kept running meanwhile).
 */
export function useAgentDock(projectId?: string, running = false) {
  const [openIds, setOpenIds] = useState<string[]>(readOpen);
  // Opened in this visit. A remembered panel reopens only while its agent still runs, so coming
  // back never starts a new agent (and its usage) by itself.
  const [openedHere, setOpenedHere] = useState<string[]>([]);
  const open =
    !!projectId && openIds.includes(projectId) && (running || openedHere.includes(projectId));
  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) =>
      setOpenIds((ids) => {
        if (!projectId) return ids;
        const was = ids.includes(projectId) && (running || openedHere.includes(projectId));
        const now = typeof next === 'function' ? next(was) : next;
        if (now) setOpenedHere((here) => (here.includes(projectId) ? here : [...here, projectId]));
        const updated = now
          ? [...ids.filter((id) => id !== projectId), projectId]
          : ids.filter((id) => id !== projectId);
        try {
          localStorage.setItem(OPEN_KEY, JSON.stringify(updated));
        } catch {
          // Not remembered: it opens closed next time.
        }
        return updated;
      }),
    [projectId, running, openedHere],
  );
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const next = useRef(0);
  /** Opens the panel and types `text` into the agent's input line (never Enter). */
  const insert = useCallback(
    (text: string) => {
      setOpen(true);
      setInbox((items) => [...items, { id: ++next.current, text }]);
    },
    [setOpen],
  );
  const consumed = useCallback(
    (ids: number[]) => setInbox((items) => items.filter((item) => !ids.includes(item.id))),
    [],
  );
  return { open, setOpen, inbox, insert, consumed };
}

export type AgentDockState = ReturnType<typeof useAgentDock>;

/**
 * "Ask" on a block or a record, when the agent panel is here: the reference goes into the agent's
 * input line (with the question to start from) instead of the questions dialog.
 */
export function askInPanel(
  about: AskAbout,
  views: { id: string; data: { name: string } }[],
  entityType: (id: string) => string | undefined,
): string {
  const view = views.find((v) => v.id === about.viewId);
  const el = about.widgetId
    ? document.querySelector(`[data-widget="${CSS.escape(about.widgetId)}"]`)
    : null;
  let target: PickTarget | undefined = el ? describeTarget(el) : undefined;
  const type = about.aboutId ? entityType(about.aboutId) : undefined;
  if (!target && about.aboutId && type)
    // The drawer's label already says the kind ("Task “Build a raised bed”"): keep the name only.
    target = {
      kind: kindLabel(type),
      title: about.label.replace(/^[^“]*“(.*)”$/, '$1'),
      entity: { type, id: about.aboutId },
    };
  return (
    referenceText(view ? { id: view.id, name: view.data.name } : undefined, target) +
    (about.question ?? '')
  );
}

/** A record's type, found in the project's dataset (its lists of entities). */
export function entityTypeIn(data: object | undefined, id: string): string | undefined {
  const typeOf = (e: unknown) =>
    e && typeof e === 'object' && (e as { id?: unknown }).id === id
      ? (e as { type?: string }).type
      : undefined;
  for (const value of Object.values(data ?? {})) {
    const found = Array.isArray(value) ? value.map(typeOf).find(Boolean) : typeOf(value);
    if (found) return found;
  }
  return undefined;
}

/** The panel, the picker and the "point at this" button of a project page. */
export function AgentDock({
  projectId,
  status,
  view,
  dock,
  width,
  onWidth,
  narrow,
}: {
  projectId: string;
  status: TerminalStatus;
  view: { id: string; name: string } | undefined;
  dock: AgentDockState;
  width: number;
  onWidth: (width: number) => void;
  narrow: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const { open, setOpen, insert } = dock;
  const onPick = useCallback(
    (el: Element) => {
      insert(referenceText(view, describeTarget(el)));
      setPicking(false);
    },
    [insert, view],
  );
  const stop = useCallback(() => setPicking(false), []);
  const box = usePicker(picking, onPick, stop);

  // While the panel is docked, its width is a CSS variable, so a details drawer opens beside it
  // instead of under it (asking about the details needs both in view).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--agent-panel-w', open && !narrow ? `${width}px` : '0px');
    return () => root.style.setProperty('--agent-panel-w', '0px');
  }, [open, narrow, width]);

  // ⌘J (Ctrl+J elsewhere) shows or hides the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPanelShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <>
      {open && (
        <AgentPanel
          projectId={projectId}
          status={status}
          width={width}
          onWidth={onWidth}
          narrow={narrow}
          hidden={narrow && picking}
          picking={picking}
          onTogglePicker={() => setPicking((p) => !p)}
          inbox={dock.inbox}
          onConsumed={dock.consumed}
          onClose={() => {
            setPicking(false);
            setOpen(false);
          }}
        />
      )}
      <PickHighlight box={box} />
      {picking &&
        // A way out without a keyboard (a phone hides the sheet while pointing).
        createPortal(
          <div data-pick-ignore="" className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
            <Tooltip label="Stop pointing" shortcut="Esc" side="top">
              <button
                type="button"
                aria-label="Stop pointing"
                onClick={stop}
                className={clsx(ICON_BUTTON.accent, 'h-10 min-w-10 shadow-popover')}
              >
                <Crosshair className="size-4" aria-hidden />
                <X className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
          </div>,
          document.body,
        )}
      <SelectionPoint
        enabled={!picking}
        onPoint={(target, text) =>
          insert(referenceText(view, target ? describeTarget(target) : undefined, text))
        }
      />
    </>
  );
}
