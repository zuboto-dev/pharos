import clsx from 'clsx';
import { AlertTriangle, Bot, Crosshair, Loader2, RefreshCw, SquareTerminal, X } from 'lucide-react';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ICON_BUTTON, ICON_GHOST, Tooltip } from '../catalog/tooltip';
import { getJson } from '../lib/api';
import type { InboxItem, TerminalHandle, TerminalState } from './TerminalView';
import { panelShortcut } from './shortcut';
import { TerminalDot } from './RunningAgents';
import { useTerminalHints } from './running';

// xterm.js loads with the panel, not with every page.
const TerminalView = lazy(() => import('./TerminalView'));

/** GET /api/projects/:id/terminal (apps/server/src/terminal/service.ts). */
export type TerminalStatus = {
  available: boolean;
  reason?: 'hosted' | 'no-agent' | 'unsupported';
  message?: string;
  agent?: { id: 'claude' | 'codex'; label: string };
  running: boolean;
  /** The other projects in this project's folder: one agent works for all of them. */
  sharedWith?: { id: string; name: string }[];
};

/** Whether this project's page can show the agent terminal, and why not. */
export function useTerminalStatus(projectId: string | undefined): TerminalStatus | null {
  const [status, setStatus] = useState<{ id: string; value: TerminalStatus } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getJson<TerminalStatus>(`/api/projects/${projectId}/terminal`).then(
      (value) => !cancelled && setStatus({ id: projectId, value }),
      () =>
        !cancelled &&
        setStatus({
          id: projectId,
          value: { available: false, reason: 'unsupported', running: false },
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return status && status.id === projectId ? status.value : null;
}

const WIDTH_KEY = 'pharos-agent-panel-width';
export const MIN_WIDTH = 340;
const DEFAULT_WIDTH = 520;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.7));
}

export function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(maxWidth(), Math.round(width)));
}

/** The panel's width, remembered per browser. */
export function usePanelWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved ? clampWidth(saved) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const save = useCallback((next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    try {
      localStorage.setItem(WIDTH_KEY, String(value));
    } catch {
      // Private windows: the width lasts for this page only.
    }
  }, []);
  return [width, save];
}

/** Below 768 px the panel is a full-screen sheet. */
export function useNarrow(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return narrow;
}

/** The project bar's button: opens the panel, or says why there is none here. */
export function AgentPanelButton({
  projectId,
  status,
  open,
  onToggle,
}: {
  projectId: string;
  status: TerminalStatus | null;
  open: boolean;
  onToggle: () => void;
}) {
  const hint = useTerminalHints().hints.get(projectId);
  if (!status) return null;
  const label = status.agent ? `${status.agent.label} terminal` : 'Agent terminal';
  if (!status.available)
    return (
      <Tooltip label={`${label}: unavailable`} detail={status.message}>
        <button
          type="button"
          aria-disabled
          aria-label={`${label}: unavailable`}
          onClick={(e) => e.preventDefault()}
          className={clsx(ICON_BUTTON.secondary, 'cursor-not-allowed opacity-40')}
        >
          <SquareTerminal className="size-4" aria-hidden />
        </button>
      </Tooltip>
    );
  return (
    <Tooltip label={open ? `Hide ${label}` : label} shortcut={panelShortcut()}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={
          open
            ? `Hide ${label}`
            : `${label}${hint ? (hint.unseen ? ' (running, new output)' : ' (running)') : ''}`
        }
        aria-pressed={open}
        className={clsx(open ? ICON_BUTTON.pressed : ICON_BUTTON.secondary, 'relative')}
      >
        <SquareTerminal className="size-4" aria-hidden />
        {/* Its agent still runs with the panel closed; the accent dot: new output since. */}
        {!open && hint && <TerminalDot unseen={hint.unseen} className="-top-1 -right-1" />}
      </button>
    </Tooltip>
  );
}

/**
 * The agent panel (R17): the owner's own agent CLI in a terminal, docked on the right of the
 * project page (resizable, its width remembered), a full-screen sheet on a phone. One session
 * per project on the server: closing the panel keeps the conversation for 30 minutes.
 */
export function AgentPanel({
  projectId,
  status,
  width,
  onWidth,
  narrow,
  hidden,
  picking,
  onTogglePicker,
  inbox,
  onConsumed,
  onClose,
}: {
  projectId: string;
  status: TerminalStatus;
  width: number;
  onWidth: (width: number) => void;
  narrow: boolean;
  /** Kept running but out of sight (a phone while picking). */
  hidden: boolean;
  picking: boolean;
  onTogglePicker: () => void;
  inbox: InboxItem[];
  onConsumed: (ids: number[]) => void;
  onClose: () => void;
}) {
  const terminal = useRef<TerminalHandle>(null);
  const [state, setState] = useState<{ state: TerminalState; detail?: string }>({
    state: 'connecting',
  });
  const onState = useCallback(
    (next: TerminalState, detail?: string) => setState({ state: next, detail }),
    [],
  );
  const drag = useRef<{ x: number; width: number } | null>(null);
  const label = status.agent?.label ?? 'Agent';
  const shared = status.sharedWith?.map((p) => p.name).join(', ');

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(drag.current.width + (drag.current.x - e.clientX));
  };
  const onPointerUp = () => (drag.current = null);
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') onWidth(width + step);
    else if (e.key === 'ArrowRight') onWidth(width - step);
    else return;
    e.preventDefault();
  };

  return createPortal(
    <aside
      data-agent-panel=""
      aria-label={`${label} terminal`}
      className={clsx(
        'fixed z-50 flex flex-col border-line bg-surface shadow-overlay',
        narrow ? 'inset-0' : 'top-0 right-0 bottom-0 border-l',
        hidden && 'hidden',
      )}
      style={narrow ? undefined : { width }}
    >
      {!narrow && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Panel width"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onHandleKey}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-sky-400/40 focus-visible:bg-sky-400/60 focus-visible:outline-none"
        />
      )}
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <Tooltip
          label={`${label}, connected to this Pharos`}
          detail={
            [
              state.detail && `Working folder: ${state.detail}`,
              shared && `The same agent works for ${shared}, which share this folder.`,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          <span
            tabIndex={0}
            aria-label={`${label}, connected to this Pharos`}
            className="flex min-w-0 items-center gap-1.5 rounded-control text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <Bot className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="truncate">{label}</span>
            {shared && <span className="truncate font-normal text-faint">· also {shared}</span>}
            {state.state === 'connecting' && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-faint" aria-hidden />
            )}
          </span>
        </Tooltip>
        <span className="flex-1" />
        <Tooltip
          label={picking ? 'Stop pointing' : 'Point at something on the page'}
          detail={
            picking
              ? undefined
              : 'Click a block, sheet, decision or task (or Tab to it and press Enter): a reference goes into the agent’s input line. Esc stops.'
          }
        >
          <button
            type="button"
            onClick={onTogglePicker}
            aria-pressed={picking}
            aria-label={picking ? 'Stop pointing' : 'Point at something on the page'}
            className={picking ? ICON_BUTTON.accent : ICON_BUTTON.secondary}
          >
            <Crosshair className="size-4" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label={`Restart ${label}`} detail="Ends this conversation and starts a new one">
          <button
            type="button"
            onClick={() => terminal.current?.restart()}
            aria-label={`Restart ${label}`}
            className={ICON_BUTTON.secondary}
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Close" detail="The conversation keeps running for 30 minutes">
          <button type="button" onClick={onClose} aria-label="Close" className={ICON_GHOST}>
            <X className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </header>
      {state.state === 'reconnecting' && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-xs text-muted"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Reconnecting… the agent keeps its conversation
          </span>
        </div>
      )}
      {(state.state === 'exited' || state.state === 'closed') && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-xs text-muted">
          <AlertTriangle className="size-3.5 text-warn" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {state.state === 'exited' ? `${label} ended` : 'Disconnected'}
            {state.detail && state.state === 'exited' ? ` (${state.detail})` : ''}
          </span>
          <button
            type="button"
            onClick={() => terminal.current?.restart()}
            className="inline-flex items-center gap-1 font-semibold text-accent"
          >
            <RefreshCw className="size-3.5" aria-hidden /> Start again
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 bg-surface py-1.5 pl-2.5">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-faint">
              <Loader2 className="size-5 animate-spin" aria-label="Loading the terminal" />
            </div>
          }
        >
          <TerminalView
            key={projectId}
            ref={terminal}
            projectId={projectId}
            inbox={inbox}
            onConsumed={onConsumed}
            onState={onState}
          />
        </Suspense>
      </div>
    </aside>,
    document.body,
  );
}
