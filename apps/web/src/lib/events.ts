import type { PresenceEntry, PresenceState } from '@pharos/schema';
import { useEffect, useRef, useState } from 'react';

export type RevisionEvent = { id: number; projectIds: string[] };

/** Files of a report page were uploaded (not a revision): an open frame of it reloads (R13.5). */
export type ReportAssetsEvent = { type: 'report-assets'; viewId: string; at: string };

/** The server's question-answering agent (Claude Code, or PHAROS_AGENT_COMMAND). */
export type AgentStatus = {
  /** A command is set up on the server. */
  configured: boolean;
  /** Answering automatically: set up and not paused in Settings (W7.9). */
  enabled: boolean;
  /** Paused in Settings (the stored switch). */
  paused?: boolean;
  /** What is really happening (R11, W7); older servers leave it out. */
  state?: 'off' | 'unavailable' | 'paused' | 'idle' | 'queued' | 'running' | 'stopping';
  /** The run in progress. */
  run?: { projectIds: string[]; requestIds: string[]; startedAt: string; agent?: string };
  mode: 'default' | 'custom' | 'off' | 'unavailable';
  /** The built-in agent chosen in Settings (mode `default`). */
  preset?: AgentPreset;
  /** The built-in agents and whether each is installed on the server's computer. */
  presets?: { id: AgentPreset; label: string; installed: boolean }[];
  /** Who answers, in words. */
  agent?: string;
  command?: string;
  logPath?: string;
  running: boolean;
  answering: string[];
  queued: string[];
  lastRun?: {
    projectIds: string[];
    startedAt: string;
    durationMs: number;
    exitCode: number | null;
    timedOut: boolean;
    /** Stopped because answering was paused (pausing stops the run, v0.2 B5). */
    stopped?: boolean;
    outcome?: 'finished' | 'failed' | 'timed_out' | 'stopped';
    requestIds?: string[];
    finishedAt?: string;
    agent?: string;
  };
};

/** The built-in answering agents the server can run (Settings picks one). */
export type AgentPreset = 'claude' | 'codex';

/** Sent each time the feed (re)connects: which version of Pharos is answering. */
type ReadyEvent = { latest?: number; version?: string; build?: string };

const listeners = new Set<(event: RevisionEvent) => void>();
const agentListeners = new Set<(status: AgentStatus) => void>();
const updateListeners = new Set<(build: string | undefined) => void>();
const presenceListeners = new Set<(entries: PresenceEntry[]) => void>();
const assetListeners = new Set<(event: ReportAssetsEvent) => void>();
let source: EventSource | null = null;
/** The build this page was loaded with (the first one the server reported), and a newer one. */
let loadedBuild: string | undefined;
let newerBuild: string | undefined;

/**
 * Notes the version a (re)connected server reports. The first one is taken as what this page
 * runs; a different one later means Pharos was updated and restarted underneath the page.
 */
function noticeBuild(ready: ReadyEvent) {
  const build = ready.build ?? ready.version;
  if (!build) return;
  if (loadedBuild === undefined) loadedBuild = build;
  else if (build !== loadedBuild && build !== newerBuild) {
    newerBuild = build;
    for (const listener of updateListeners) listener(build);
  }
}

/** One shared connection to the server's change feed, opened while anyone is listening. */
function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.addEventListener('revision', (e) => {
    const event = JSON.parse((e as MessageEvent<string>).data) as RevisionEvent;
    for (const listener of listeners) listener(event);
  });
  source.addEventListener('report-assets', (e) => {
    try {
      announceReportAssets(JSON.parse((e as MessageEvent<string>).data) as ReportAssetsEvent);
    } catch {
      // An unreadable event reloads nothing.
    }
  });
  source.addEventListener('agent', (e) => {
    const status = JSON.parse((e as MessageEvent<string>).data) as AgentStatus;
    for (const listener of agentListeners) listener(status);
  });
  source.addEventListener('presence', (e) => {
    try {
      announcePresence(JSON.parse((e as MessageEvent<string>).data) as PresenceState);
    } catch {
      // An unreadable presence event changes nothing.
    }
  });
  // Lost the server: nobody can say who is working, so no mark stays up (it reconnects by
  // itself and the server sends the marks again).
  source.addEventListener('error', () => announcePresence({ entries: [] }));
  source.addEventListener('ready', (e) => {
    try {
      noticeBuild(JSON.parse((e as MessageEvent<string>).data) as ReadyEvent);
    } catch {
      // An unreadable ready event just isn't a version signal.
    }
  });
  // EventSource reconnects by itself after network errors or server restarts.
}

function disconnect() {
  if (
    listeners.size ||
    agentListeners.size ||
    updateListeners.size ||
    presenceListeners.size ||
    assetListeners.size ||
    !source
  )
    return;
  source.close();
  source = null;
}

/** Calls `handler` for every new revision saved by anyone: you, an agent, or another tab. */
export function useRevisionEvents(handler: (event: RevisionEvent) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (event: RevisionEvent) => latest.current(event);
    listeners.add(listener);
    connect();
    return () => {
      listeners.delete(listener);
      disconnect();
    };
  }, []);
}

/** Passes on a report-assets event from the feed (or a test) to whoever listens. */
export function announceReportAssets(event: ReportAssetsEvent): void {
  if (typeof event?.viewId !== 'string') return;
  for (const listener of assetListeners) listener(event);
}

/** Calls `handler` when files of a report page are uploaded (any view; filter by viewId). */
export function useReportAssetEvents(handler: (event: ReportAssetsEvent) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (event: ReportAssetsEvent) => latest.current(event);
    assetListeners.add(listener);
    connect();
    return () => {
      assetListeners.delete(listener);
      disconnect();
    };
  }, []);
}

const IDLE: AgentStatus = {
  configured: false,
  enabled: true,
  mode: 'unavailable',
  running: false,
  answering: [],
  queued: [],
};

/** Shares a status this page just received (e.g. after changing it), as if the server sent it. */
export function announceAgentStatus(status: AgentStatus): void {
  for (const listener of agentListeners) listener(status);
}

/** Whether questions are answered automatically, and whether the agent is at it right now. */
export function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState(IDLE);
  useEffect(() => {
    let live = true;
    agentListeners.add(setStatus);
    connect();
    fetch('/api/agent')
      .then((r) => (r.ok ? (r.json() as Promise<Partial<AgentStatus>>) : {}))
      .then((s) => live && setStatus({ ...IDLE, ...s }))
      .catch(() => {});
    return () => {
      live = false;
      agentListeners.delete(setStatus);
      disconnect();
    };
  }, []);
  return status;
}

/**
 * A newer build of Pharos than the one this page is running, once the server has been updated
 * and restarted (the page keeps its old code until reloaded); undefined until then.
 */
export function useNewerBuild(): string | undefined {
  const [build, setBuild] = useState(newerBuild);
  useEffect(() => {
    updateListeners.add(setBuild);
    connect();
    return () => {
      updateListeners.delete(setBuild);
      disconnect();
    };
  }, []);
  return build;
}

// Presence (v0.2 B5): which agent is working where right now, from the feed's `presence` events.
// Each mark also expires here when its time is up, in case the server's next event is late.

type HeldEntry = PresenceEntry & { until?: number };
let presence: HeldEntry[] = [];
let presenceTimer: ReturnType<typeof setTimeout> | undefined;

function livePresence(now = Date.now()): PresenceEntry[] {
  return presence.filter((e) => e.until === undefined || e.until > now);
}

function notifyPresence() {
  clearTimeout(presenceTimer);
  const now = Date.now();
  presence = presence.filter((e) => e.until === undefined || e.until > now);
  const next = Math.min(...presence.map((e) => e.until ?? Infinity));
  if (next !== Infinity) presenceTimer = setTimeout(notifyPresence, next - now + 50);
  const entries = livePresence(now);
  for (const listener of presenceListeners) listener(entries);
}

/** Takes the server's presence state (or a test's) as the marks shown now. */
export function announcePresence(state: PresenceState): void {
  const now = Date.now();
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  presence = entries.map((e) =>
    typeof e.expiresInMs === 'number' ? { ...e, until: now + e.expiresInMs } : { ...e },
  );
  notifyPresence();
}

/** Every agent mark right now: who is working on which project, view, or block. */
export function usePresence(): PresenceEntry[] {
  const [entries, setEntries] = useState<PresenceEntry[]>(() => livePresence());
  useEffect(() => {
    presenceListeners.add(setEntries);
    connect();
    return () => {
      presenceListeners.delete(setEntries);
      disconnect();
    };
  }, []);
  return entries;
}
