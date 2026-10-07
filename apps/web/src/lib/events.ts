import { useEffect, useRef, useState } from 'react';

export type RevisionEvent = { id: number; projectIds: string[] };

/** The server's question-answering agent (Claude Code, or PHAROS_AGENT_COMMAND). */
export type AgentStatus = {
  /** A command is set up on the server. */
  configured: boolean;
  /** Not paused in Settings. */
  enabled: boolean;
  mode: 'default' | 'custom' | 'off' | 'unavailable';
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
  };
};

const listeners = new Set<(event: RevisionEvent) => void>();
const agentListeners = new Set<(status: AgentStatus) => void>();
let source: EventSource | null = null;

/** One shared connection to the server's change feed, opened while anyone is listening. */
function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.addEventListener('revision', (e) => {
    const event = JSON.parse((e as MessageEvent<string>).data) as RevisionEvent;
    for (const listener of listeners) listener(event);
  });
  source.addEventListener('agent', (e) => {
    const status = JSON.parse((e as MessageEvent<string>).data) as AgentStatus;
    for (const listener of agentListeners) listener(status);
  });
  // EventSource reconnects by itself after network errors or server restarts.
}

function disconnect() {
  if (listeners.size || agentListeners.size || !source) return;
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
