# R17 · Agent panel (prototype)

Asked 2026-10-21 (owner): "A terminal on the right showing the agent interface rather than the Ask
button. If the user uses Claude, show Claude Code. Then a picker so the user can ask anything
about the content, exactly pointing at it. Desktop-app users can keep a chat open next to Pharos;
CLI users can't."

## What it is

- A panel docked on the right of a project page (resizable, its width remembered per browser; a
  full-screen sheet below 768 px) running the owner's own agent CLI in a real terminal (xterm.js
  over a WebSocket to a pseudo-terminal on the server, node-pty). Light and dark follow the app's
  theme tokens. The project bar's terminal button (`SquareTerminal`, ⌘J / Ctrl+J) opens it.
- The agent is the one chosen for answering in Settings (`agent.preset`) while it is installed,
  else the first installed: Claude Code, then Codex. It is connected to this Pharos over MCP.
- **Picker** (`Crosshair` in the panel header): hovering a board block (`[data-widget]`), a
  document block or sheet (`[data-doc-block]`), a decision or a task row (`[data-entity]`)
  outlines it (drawn over the page, nothing moves); a click, or Tab to it and Enter, types a
  reference into the agent's input line without pressing Enter:
  `[Pharos: “Overview” › Task “Buy seeds” (view v1, block tasks, task t9)] `. Escape (or the
  floating stop button) leaves picker mode.
- **Point at selected words**: selecting text on the page shows a small `TextQuote` button; it
  types the same reference followed by the quoted words.
- Where the panel is available, a block's **Ask** button (and "Ask an agent" on empty blocks)
  types that block's reference (and the question to start from) into the panel instead of opening
  the questions dialog. Where it isn't (hosted address, no CLI, no PTY), the button shows as
  unavailable with the reason in its tooltip and Ask keeps the questions flow.

Code: `apps/server/src/terminal/` (guard, command, sessions, service, pty) with the routes in
`app.ts`; `apps/web/src/agent/` (panel, terminal view, picker, reference).

## Security rules

The panel starts a process from the browser, so:

- **This computer only.** The socket (`GET /api/projects/:id/terminal/socket`, upgrade) is refused
  with 403 unless the Host is local (`localhost`, `127.0.0.1`, `[::1]`), no proxy header is present
  (`Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`), and the Origin
  is a local page of this very server (same host and port as the Host; a missing Origin, another
  site or another local port is refused). On the owner's hosted address (a non-local
  `PHAROS_WEB_URL`) the status route says `hosted` and the socket is 403.
- **Never an agent.** A request declaring an agent author (`X-Pharos-Author` other than `human:…`)
  is refused, on the status route and the socket.
- **Fixed commands.** Only the two presets, run without a shell from the path found at start:
  - Claude Code: `claude --mcp-config <PHAROS_HOME>/agent-mcp.json --strict-mcp-config` and
    `--append-system-prompt <brief>` (interactive; only this Pharos as MCP server, so a "pharos"
    entry in the owner's own config can't point it at another Pharos).
  - Codex: `codex -c mcp_servers.pharos.url="http://localhost:<port>/mcp"` and
    `-c developer_instructions=<brief>` (interactive; overrides a "pharos" entry, and any
    `developer_instructions`, of the owner's own config).
  - The brief (`terminalBrief`) names the projects the session works for, by name and id: one,
    or all the projects whose repository is that folder (they share it, below), with a request
    to ask which one when it isn't clear.
    The client sends only typed input, a size, or "restart"; any other message closes the socket.
    `PHAROS_AGENT_COMMAND` doesn't apply here (it is for headless answering). With neither CLI
    installed the panel says so.
- **Working folder.** The project's repository folder when its repository records a local `path`
  that is an existing absolute folder; else `<PHAROS_HOME or ~/.pharos>/agent-home/<projectId>`,
  made on demand. Never a folder from the client. (A repository's `path` can be written by agents
  too: the panel then starts there, which is no more than any agent writing to the store can do.)
- **Environment.** PATH and HOME of the server, plus USER, LOGNAME, SHELL, TMPDIR and LANG (which
  terminal programs and the macOS keychain expect), `TERM=xterm-256color`, `COLORTERM=truecolor`,
  `PHAROS_URL` and `PHAROS_PROJECT_IDS` (comma-separated). Nothing from the client, no other
  server variables.
- **Sessions.** One per working folder: projects whose repository is the same folder share one
  agent (two agents in one checkout would overwrite each other's edits); the panel header says
  "also <project>", and Restart restarts it for all of them. A project without a folder has its
  own. Reused when the panel reopens (the last 256 KB of output is replayed, so the conversation
  is still there; once older output is dropped, the replay starts at an escape sequence and is
  preceded by the private modes the agent set before it, so Claude Code's full screen and mouse
  reports survive a long conversation). Killed with its whole process group (SIGHUP, SIGTERM,
  then SIGKILL) when the server stops (`SIGTERM`, `SIGINT`,
  `SIGHUP`, exit) and after 30 minutes with no panel attached. Restart ends the session and starts
  a new one.
- **The server never dies from a session.** Output, exit, socket and sweep callbacks catch and log;
  node-pty loads lazily, and a failed load only turns the panel off (`unsupported`).

node-pty 1.1.0's macOS prebuilds lose their `spawn-helper` executable bit when unpacked; the
server restores it on that one file in node-pty's folder before the first spawn (`terminal/pty.ts`).

**Long output in the panel.** Claude Code draws full screen and scrolls its own conversation
from mouse wheel reports. xterm.js sends one report per wheel event however far it went, so the
panel's `wheelSteps` (`apps/web/src/agent/wheel.ts`) sends one SGR report per line scrolled while
the agent asked for SGR mouse reports. The agent redraws everything for each new size, so the
panel sends a size only once dragging its edge settles (150 ms), and only when it changed.

## Not done

- The agent's own trust prompt ("Do you trust this folder?") shows the first time in each folder;
  the owner answers it in the panel.
- The reference waits until the agent's output goes quiet after starting (700 ms) before it is
  typed; a slow start or a prompt on screen at that moment can catch it.
- Claude Code draws with its own theme setting: with Pharos in dark mode and Claude Code's light
  theme, its message bars stay light.
- No authentication beyond the local-only rules: any process on this computer that can open a
  local page could reach it, as it can run the CLI itself.
- Selecting text inside a draggable card (kanban) isn't possible in Chrome, so the selection
  button doesn't appear there; the picker does.
- A report page (R13) and a document's drawings are separate framed documents: a whole page can't
  be pointed at yet, and a drawing only as a whole block.
- Windows (ConPTY) is untested.
