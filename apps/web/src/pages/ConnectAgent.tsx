import clsx from 'clsx';
import { Check, ChevronDown, Copy, Info } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useResource } from '../lib/api';

/** Where the server listens for MCP when Settings can't be read yet (the default port). */
export const DEFAULT_MCP_URL = 'http://localhost:4300/mcp';

/** The MCP URL this server reports (`GET /api/settings`), or the default while it loads. */
export function useMcpUrl(): string {
  const settings = useResource<{ mcpUrl?: string }>('/api/settings');
  return settings.data?.mcpUrl ?? DEFAULT_MCP_URL;
}

/** A block of text to paste somewhere, with a copy button. */
export function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-tile bg-neutral-900 p-3 text-sm text-neutral-100 dark:bg-neutral-800">
      <code className="min-w-0 flex-1 break-words whitespace-pre-wrap">{text}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-white"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

type Client = {
  key: string;
  label: string;
  /** Steps in order; a step may carry a snippet to copy. */
  steps: { text: ReactNode; snippet?: { label: string; text: string } }[];
  /** One line on what else the client needs (a restart, Node, a public address). */
  note?: ReactNode;
};

function claudeDesktopConfig(url: string) {
  return JSON.stringify(
    { mcpServers: { pharos: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    null,
    2,
  );
}

/** How each agent connects to this server's MCP URL. */
export function clients(url: string): Client[] {
  return [
    {
      key: 'claude-code',
      label: 'Claude Code',
      steps: [
        {
          text: 'Run in a terminal:',
          snippet: {
            label: 'Claude Code command',
            text: `claude mcp add --transport http pharos ${url}`,
          },
        },
      ],
    },
    {
      key: 'claude-desktop',
      label: 'Claude Desktop',
      steps: [
        {
          text: (
            <>
              In Claude Desktop, open <strong>Settings → Developer → Edit Config</strong> and add
              Pharos under <code>mcpServers</code> in <code>claude_desktop_config.json</code>:
            </>
          ),
          snippet: { label: 'Claude Desktop config', text: claudeDesktopConfig(url) },
        },
        { text: 'Quit Claude Desktop completely and open it again.' },
      ],
      note: (
        <>
          Needs Node.js (<code>mcp-remote</code> bridges the app to this server). The file is in{' '}
          <code>~/Library/Application Support/Claude/</code> on macOS and{' '}
          <code>%APPDATA%\Claude\</code> on Windows. Connectors added under Settings → Connectors
          connect from Anthropic’s cloud and need a public HTTPS address, so they can’t reach this
          Pharos.
        </>
      ),
    },
    {
      key: 'codex',
      label: 'Codex CLI',
      steps: [
        {
          text: 'Run in a terminal:',
          snippet: { label: 'Codex command', text: `codex mcp add pharos --url ${url}` },
        },
        {
          text: (
            <>
              Or add it to <code>~/.codex/config.toml</code>:
            </>
          ),
          snippet: {
            label: 'Codex config',
            text: `[mcp_servers.pharos]\nurl = "${url}"`,
          },
        },
      ],
      note: 'The Codex IDE extension and the ChatGPT desktop app read the same config.',
    },
    {
      key: 'chatgpt',
      label: 'ChatGPT',
      steps: [
        {
          text: (
            <>
              In the ChatGPT desktop app, open <strong>Settings → MCP servers → Add server</strong>,
              name it <code>pharos</code>, choose <strong>Streamable HTTP</strong>, and paste:
            </>
          ),
          snippet: { label: 'ChatGPT server URL', text: url },
        },
        {
          text: 'Save, then select Restart. The app shares this list with Codex, so adding Pharos to one adds it to both.',
        },
      ],
      note: (
        <>
          Chats on chatgpt.com can’t use this Pharos: custom MCP servers there connect from OpenAI’s
          servers, so they need a public HTTPS address (or OpenAI’s Secure MCP Tunnel) and a plan
          with developer mode. A Pharos on this computer has neither.
        </>
      ),
    },
    {
      key: 'other',
      label: 'Other',
      steps: [
        {
          text: (
            <>
              Cursor (<code>~/.cursor/mcp.json</code>) and other clients that speak streamable HTTP:
            </>
          ),
          snippet: {
            label: 'MCP config',
            text: JSON.stringify({ mcpServers: { pharos: { url } } }, null, 2),
          },
        },
      ],
    },
  ];
}

function ClientSteps({ client }: { client: Client }) {
  return (
    <div className="space-y-3 text-sm">
      <ol className="space-y-2.5">
        {client.steps.map((step, i) => (
          <li key={i} className="space-y-1.5">
            <p className="text-ink-soft">
              {client.steps.length > 1 && (
                <span className="text-muted tabular-nums">{i + 1}. </span>
              )}
              {step.text}
            </p>
            {step.snippet && <CopyLine label={step.snippet.label} text={step.snippet.text} />}
          </li>
        ))}
      </ol>
      {client.note && (
        <p className="flex gap-1.5 text-xs text-muted">
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{client.note}</span>
        </p>
      )}
    </div>
  );
}

/** Tabs, one per client; arrow keys, Home and End move between them. */
function ClientTabs({ list }: { list: Client[] }) {
  const [active, setActive] = useState(list[0]!.key);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = list.find((c) => c.key === active) ?? list[0]!;
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = list.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(list[next]!.key);
    tabs.current[next]?.focus();
  };
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Agent" className="flex flex-wrap gap-1">
        {list.map((client, i) => {
          const selected = client.key === current.key;
          return (
            <button
              key={client.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${client.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(client.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={clsx(
                'rounded-control border px-2.5 py-1 text-sm',
                selected
                  ? 'border-sky-500 bg-sky-50 font-medium text-sky-900 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-100'
                  : 'border-line-strong text-ink-soft hover:bg-subtle',
              )}
            >
              {client.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${current.key}`}
        tabIndex={0}
        className="rounded-tile focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <ClientSteps client={current} />
      </div>
    </div>
  );
}

/**
 * How to connect an agent to this Pharos over MCP: Claude Code, Claude Desktop, Codex CLI,
 * ChatGPT and others, each with snippets built from `mcpUrl`. `compact` (first run) shows Claude
 * Code and keeps the rest behind "Other agents".
 */
export function ConnectAgent({ mcpUrl, compact = false }: { mcpUrl: string; compact?: boolean }) {
  const list = clients(mcpUrl);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!compact) return <ClientTabs list={list} />;
  const [first, ...rest] = list;
  return (
    <div className="space-y-2">
      <ClientSteps client={first!} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded text-sm text-accent hover:underline"
      >
        <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />
        Other agents
        <span className="text-muted">(Claude Desktop, Codex, ChatGPT…)</span>
      </button>
      {open && (
        <div id={panelId} className="pt-1">
          <ClientTabs list={rest} />
        </div>
      )}
    </div>
  );
}
