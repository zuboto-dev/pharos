import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

/** What the server sends (apps/server/src/terminal/sessions.ts). */
type ServerMessage =
  | { t: 'o'; d: string }
  | { t: 'start'; agent: string; cwd: string; replay: boolean }
  | { t: 'exit'; code: number | null; signal?: number }
  | { t: 'error'; message: string };

export type TerminalState = 'connecting' | 'running' | 'exited' | 'closed';

export type TerminalHandle = {
  /** Ends the agent and starts a new one (or reconnects when the connection was lost). */
  restart(): void;
  focus(): void;
};

export type InboxItem = { id: number; text: string };

/** A CSS colour (the theme tokens are oklch) as rgb() for xterm. */
function rgb(color: string, fallback: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = fallback;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

/** The terminal's colours from the app's theme tokens, light or dark as the app is now. */
function themeFrom(el: Element): ITheme {
  const style = getComputedStyle(el);
  const token = (name: string, fallback: string) =>
    rgb(style.getPropertyValue(name).trim() || fallback, fallback);
  const dark = document.documentElement.classList.contains('dark');
  const background = token('--ph-surface', dark ? '#171717' : '#ffffff');
  const foreground = token('--ph-ink', dark ? '#f5f5f5' : '#171717');
  return {
    background,
    foreground,
    cursor: token('--ph-accent', '#0369a1'),
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(14, 165, 233, 0.25)',
    // Claude Code and Codex draw with ANSI colours: readable shades on either background.
    ...(dark
      ? {}
      : {
          black: '#171717',
          brightBlack: '#525252',
          white: '#d4d4d4',
          brightWhite: '#a3a3a3',
          yellow: '#a16207',
          brightYellow: '#854d0e',
          green: '#15803d',
          brightGreen: '#166534',
          cyan: '#0e7490',
          brightCyan: '#155e75',
        }),
  };
}

/**
 * The agent's terminal (R17): xterm.js over the project's terminal socket. Typing goes to the
 * agent; `inbox` holds references from the picker, typed into the input line (never Enter) once
 * the agent has drawn its prompt.
 */
export default function TerminalView({
  projectId,
  inbox,
  onConsumed,
  onState,
  ref,
}: {
  projectId: string;
  inbox: InboxItem[];
  onConsumed: (ids: number[]) => void;
  onState: (state: TerminalState, detail?: string) => void;
  ref?: Ref<TerminalHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const socket = useRef<WebSocket | null>(null);
  /** The agent has drawn its prompt: output went quiet after starting (or a replay). */
  const ready = useRef(false);
  /** Changes to reconnect. */
  const [connection, setConnectionKey] = useState(0);
  const setConnection = useCallback(() => setConnectionKey((k) => k + 1), []);
  const send = useRef<(message: object) => boolean>(() => false);
  const flush = useRef<() => void>(() => {});
  const stateRef = useRef(onState);
  useEffect(() => {
    stateRef.current = onState;
  }, [onState]);

  useImperativeHandle(
    ref,
    () => ({
      restart() {
        if (!send.current({ t: 'restart' })) setConnection();
        term.current?.focus();
      },
      focus() {
        term.current?.focus();
      },
    }),
    [setConnection],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      theme: themeFrom(el),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(el);
    term.current = terminal;
    try {
      fit.fit();
    } catch {
      // Not laid out yet: the observer below fits it.
    }

    // The app's theme changes the terminal's colours with it.
    const themeWatch = new MutationObserver(() => (terminal.options.theme = themeFrom(el)));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${location.host}/api/projects/${encodeURIComponent(projectId)}/terminal/socket?cols=${terminal.cols}&rows=${terminal.rows}`,
    );
    socket.current = ws;
    ready.current = false;
    stateRef.current('connecting');
    send.current = (message) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(message));
      return true;
    };
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const settle = (ms: number) => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        ready.current = true;
        flush.current();
      }, ms);
    };
    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'o') {
        terminal.write(message.d);
        if (!ready.current) settle(700);
      } else if (message.t === 'start') {
        terminal.reset();
        ready.current = false;
        stateRef.current('running', message.cwd);
        if (message.replay) settle(150);
      } else if (message.t === 'exit') {
        ready.current = false;
        stateRef.current('exited', message.code === null ? undefined : `exit ${message.code}`);
      } else if (message.t === 'error') stateRef.current('closed', message.message);
    };
    ws.onclose = (event) => {
      ready.current = false;
      stateRef.current('closed', event.code === 1006 ? undefined : event.reason || undefined);
    };
    const typing = terminal.onData((data) => send.current({ t: 'i', d: data }));
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      send.current({ t: 'r', cols: terminal.cols, rows: terminal.rows });
    });
    observer.observe(el);
    terminal.focus();
    return () => {
      clearTimeout(quiet);
      observer.disconnect();
      themeWatch.disconnect();
      typing.dispose();
      send.current = () => false;
      ws.onclose = null;
      ws.close();
      terminal.dispose();
      term.current = null;
    };
  }, [projectId, connection]);

  // References from the picker: typed into the input line once the agent is ready.
  useEffect(() => {
    flush.current = () => {
      if (!ready.current || !inbox.length) return;
      const sent = inbox.filter((item) => send.current({ t: 'i', d: item.text }));
      if (sent.length) {
        onConsumed(sent.map((item) => item.id));
        term.current?.focus();
      }
    };
    flush.current();
  }, [inbox, onConsumed]);

  return <div ref={host} className="h-full min-h-0 w-full" data-agent-terminal="" />;
}
