import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** An agent running in a panel's terminal (GET /api/terminal/running, terminal/service.ts). */
export type TerminalRunning = {
  projectIds: string[];
  agent: string;
  /** A panel shows it now. */
  watched: boolean;
  lastOutputAt?: string;
};

/** Where an agent runs for a project, and whether it printed since this browser showed it. */
export type TerminalHint = { agent: string; watched: boolean; unseen: boolean };

const SEEN_KEY = 'pharos-terminal-seen';
const CHANGED = 'pharos-terminals-changed';

function readSeen(): Record<string, string> {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as unknown;
    return seen && typeof seen === 'object' ? (seen as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Something about the terminals changed here (a panel opened or closed): look again. */
export function terminalsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** This browser has shown the project's agent up to now. */
export function markTerminalSeen(projectId: string): void {
  try {
    localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ ...readSeen(), [projectId]: new Date().toISOString() }),
    );
  } catch {
    // Not remembered: the hint may show new output that was seen.
  }
}

/**
 * The agents running now, looked up every 10 s, when the window gets focus and when a panel
 * opens or closes here. Agents keep running when you leave their project (R17), so the app
 * shows where they are.
 */
export function useRunningTerminals(): TerminalRunning[] {
  const [running, setRunning] = useState<TerminalRunning[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/terminal/running')
        .then((r) => (r.ok ? r.json() : []))
        .then((data: unknown) => live && Array.isArray(data) && setRunning(data))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 10_000);
    window.addEventListener(CHANGED, load);
    window.addEventListener('focus', load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(CHANGED, load);
      window.removeEventListener('focus', load);
    };
  }, []);
  return running;
}

/** Per project: the agent running for it, and whether it printed since a panel here showed it. */
export function terminalHints(running: TerminalRunning[]): Map<string, TerminalHint> {
  const seen = readSeen();
  const hints = new Map<string, TerminalHint>();
  for (const r of running) {
    const lastSeen = r.projectIds
      .map((id) => seen[id])
      .filter(Boolean)
      .sort()
      .at(-1);
    const unseen = !r.watched && !!r.lastOutputAt && (!lastSeen || r.lastOutputAt > lastSeen);
    for (const id of r.projectIds) hints.set(id, { agent: r.agent, watched: r.watched, unseen });
  }
  return hints;
}

const Hints = createContext<{ running: TerminalRunning[]; hints: Map<string, TerminalHint> }>({
  running: [],
  hints: new Map(),
});

/** One look-up for the whole app: the rail, the sidebar and the project page read it. */
export function RunningTerminalsProvider({ children }: { children: ReactNode }) {
  const running = useRunningTerminals();
  // Seen marks change when a panel shows output; the list is looked up again then (terminalsChanged).
  const value = useMemo(() => ({ running, hints: terminalHints(running) }), [running]);
  return <Hints.Provider value={value}>{children}</Hints.Provider>;
}

export function useTerminalHints() {
  return useContext(Hints);
}
