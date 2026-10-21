# Pharos

Generative UI project management for people working with AI agents.

**v0.2.0 — early development.** This is the second public preview, shared so you can follow
the work, try it locally, and contribute. APIs and saved-view formats may change as the project
develops. See the [roadmap](docs/PLAN.md) and [release notes](CHANGELOG.md).

Your agent keeps the project's goals, scope, stages, tasks, artifacts, and decisions in Pharos
over MCP, and explains them with **views** it composes from a catalog of project-management
components (stage trackers, timelines, kanban boards, goal trees, tables, charts). You read and
edit those views in a local web app that updates live as the agent works. Ask a question from any
widget and the agent answers with a view instead of paragraphs.

Everything runs on your machine. Data lives in one SQLite file, and every change is a revision
you can inspect and revert.

## Requirements

- Node.js 24 is recommended (`.node-version`); supported versions are 22.13+, 24.x, and 26+
  (excluding 23.x and 25.x). Pharos uses the built-in `node:sqlite`.
- pnpm 12.9.1. If you don't have pnpm, replace `pnpm` with `npx pnpm@12.9.1` in the commands
  below (for example, `npx pnpm@12.9.1 install --frozen-lockfile`).
- An MCP client for your agent, such as Claude Code, Codex, Cursor, or Claude Desktop

## Setup

Clone or download this repository, then open a terminal in its root directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts:

- the server on <http://localhost:4300> (REST under `/api`, MCP at `/mcp`)
- the web app on <http://localhost:5173>

Open the web app and create a project, or connect your agent and ask it to set one up.

If Claude Code is installed, asking a question in the web app starts an agent automatically.
To start with automatic answering disabled, use `PHAROS_AGENT_COMMAND=off pnpm dev` in a POSIX
shell. You can also pause answering in **Settings**; a pause is saved in the database, so it survives
restarts until you resume. The automatic runner uses a POSIX shell;
on Windows, use WSL for this workflow.

### Keep it running (macOS)

`pnpm dev` only lives as long as its terminal. To have Pharos always available for your agents,
run the built app as a launchd service instead:

```sh
pnpm service install
```

That builds your local `main` in a copy of its own (`~/.pharos/app`, so edits in your checkout
never affect it), then starts the server at <http://localhost:4300>, which also serves the web
app, at login and restarts it if it ever exits. Its log is `~/.pharos/server.log`. Use
`pnpm service status`, `stop`, `start`, `restart`, `log`, and `uninstall` to manage it.

It also keeps itself up to date: whenever `main` moves (a commit, merge or pull), it builds the
new `main` in a second copy, backs up the database to `~/.pharos/backups` (the last 5 are kept),
switches to it and restarts, and goes back to the previous version if the new one doesn't start.
A build that fails leaves the running version alone, and it waits while an agent is answering a
question. `~/.pharos/update.log` says what it did; `pnpm service autoupdate off` stops it, and
`pnpm service update` deploys `main` by hand. `install` stores only `PORT`,
`PHAROS_DB`, `PHAROS_AGENT_COMMAND`, `PHAROS_AGENT_LOG`, and `PHAROS_WEB_URL` from its environment
(any other variable your command needs must be set by the command itself), and links that agents
share point at the service's own address unless `PHAROS_WEB_URL` says otherwise. Stop the service
before `pnpm dev`, since both listen on port 4300. On other systems, run `pnpm build` and then `pnpm --filter @pharos/server start`
under your own supervisor; the built server serves the web app too.

## Connect your agent

The server must be running (`pnpm dev`) for the HTTP connection.

**Claude Code**

```sh
claude mcp add --transport http pharos http://localhost:4300/mcp
```

**Codex**

```sh
codex mcp add pharos --url http://localhost:4300/mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.pharos]
url = "http://localhost:4300/mcp"
```

For non-interactive runs (`codex exec`), which can't ask you to approve a tool call, the tested
runs approved Pharos's tools per run with
`-c 'mcp_servers.pharos.default_tools_approval_mode="approve"'`.

**Cursor** (`~/.cursor/mcp.json`) and other clients that support streamable HTTP

```json
{
  "mcpServers": {
    "pharos": { "url": "http://localhost:4300/mcp" }
  }
}
```

**Clients that need stdio** (for example Claude Desktop). Run `pnpm build` once, then:

```json
{
  "mcpServers": {
    "pharos": {
      "command": "node",
      "args": ["/path/to/pharos/apps/server/dist/stdio.js"]
    }
  }
}
```

The stdio process shares the web server's database only if both resolve the same path: set the
same `PHAROS_DB` (an absolute path) in the client's `env` if the server doesn't use the default.
Changes it makes are found by polling about once a second, so the web app normally shows them
within a few seconds.

Then try asking your agent:

- “Set up a project in Pharos for this repo from its docs: goals, scope, stages, and tasks.”
- “What's blocking the current stage? Answer with a Pharos view.”
- “Mark the README task done in Pharos.”

## Works with

Each agent below passed all five compatibility scenarios in [`eval/compat`](eval/compat)
(set up a project from a brief, mark a task done, answer a question with a checked view, start
from a pack and add a record, ask for a folder and wait for the owner), connected over MCP only
to an isolated Pharos server:

| Agent       | Tested version                  | Date       | Result     |
| ----------- | ------------------------------- | ---------- | ---------- |
| Claude Code | 2.1.300 (claude-opus-5-5)       | 2026-10-14 | 5/5 passed |
| Codex       | codex-cli 0.162.1 (gpt-6.1-sol) | 2026-10-14 | 5/5 passed |
| OpenCode    | —                               | —          | planned    |

To run them yourself, start a separate server on its own port and database with answering off,
then point the runner at it (it refuses port 4300, so your own data is never touched; each
scenario is one agent run and uses that agent's usage):

```sh
PORT=4391 PHAROS_DB=/tmp/pharos-compat.db PHAROS_AGENT_COMMAND=off \
  PHAROS_AGENT_LOG=/tmp/pharos-compat-agent.log pnpm --filter @pharos/server dev
node eval/compat/run.mjs --agent claude --url http://127.0.0.1:4391   # or --agent codex
```

It prints a pass/fail table and writes the results (with each run's output) under `eval/results/compat`.

## Answering questions from the web app

Use **Ask** on any widget or item to send your agent a question. If Claude Code (`claude`) is
installed, the server answers new questions automatically. It runs Claude Code connected only to
Pharos, and the answer shows up as a new view. Automatic answers use your agent account and may
incur usage charges. You can pause it, or answer questions that waited, under **Settings**
(bottom of the sidebar).

| Setting                               | Effect                                             |
| ------------------------------------- | -------------------------------------------------- |
| _(not set)_                           | Claude Code answers, if it is installed            |
| `PHAROS_AGENT_COMMAND='your command'` | Runs your command instead                          |
| `PHAROS_AGENT_COMMAND=off`            | Off; your agent sees open questions when it checks |

A custom command receives `PHAROS_PROMPT` (the questions plus the view guidelines, catalog, and
examples, ready to pass to an agent), `PHAROS_PROJECT_IDS`, `PHAROS_REQUEST_IDS`, and `PHAROS_URL`
in its environment. Output goes to `~/.pharos/agent.log`. Only one run happens at a time.

## Report pages

Most views are boards of catalog blocks. For a story that needs its own look, its own charts or
something to play with, an agent can instead write a **report page**: a whole HTML document that
reads live project data. Pharos shows it in a locked frame, keeps every version, and marks it out
of date when the data it read changes.

![The made-up "Spending story" report page in the Pharos web app](docs/images/report-page-spending-story.png)

_The "Spending story" sample (`samples/install/steps/r13-report-page.mjs`, made-up data): the
numbers and the chart come from the project's records as the page loads._

An agent makes one over MCP:

1. `report_guide` explains when to write a page instead of a board, the `window.pharos` API, the
   frame's limits and a skeleton to start from.
2. `view_preview` with a `page` (the HTML, a short `summary`, and named `data` reads, each an
   entity type and filter) checks the page and its reads before anything is saved.
3. `view_create` with that `page` saves it (`view_update` changes it later).
4. `report_asset_put` uploads the pictures, fonts, stylesheets and scripts it refers to by
   relative path (`report_asset_list` lists them).

The page can't reach the network, open popups or leave its frame; links open through Pharos. It
gets its data only through `window.pharos`: `pharos.data(name)` resolves to the rows of a named read,
`pharos.onData` and `pharos.onTheme` call back when the data or the light/dark theme changes, and
`pharos.openFile` and `pharos.openLink` ask Pharos to open a project file or a web address.
[`docs/reframe/r13-report-pages.md`](docs/reframe/r13-report-pages.md) has the contract.

## Configuration

| Variable               | Default                  | Purpose                                                 |
| ---------------------- | ------------------------ | ------------------------------------------------------- |
| `PHAROS_DB`            | `~/.pharos/pharos.db`    | Database file                                           |
| `PORT`                 | `4300`                   | Server port                                             |
| `PHAROS_WEB_URL`       | `http://localhost:5173`  | Web app address in shared links (built server: its own) |
| `PHAROS_SERVER_URL`    | `http://localhost:4300`  | Server the web app's dev proxy talks to                 |
| `PHAROS_AGENT_COMMAND` | Claude Code if installed | Command that answers questions (`off` disables)         |
| `PHAROS_AGENT_LOG`     | `~/.pharos/agent.log`    | Log for that command                                    |

Set configuration variables in the environment before starting Pharos; it does not automatically
load a root `.env` file. The server only accepts requests from localhost, plus the host of a
non-local `PHAROS_WEB_URL` (a tunnel with a login in front, see SECURITY.md). Keep the web app and
server local: v0.2 has no authentication. See [SECURITY.md](SECURITY.md) for the trust model and
vulnerability reporting.

## Troubleshooting

- **"Port 4300 is already in use"**: Pharos (maybe the service, see `pnpm service status`) is
  already running. Stop it, or start this one with another `PORT`. With `pnpm dev`, also set
  `PHAROS_SERVER_URL` to the new address so the web app's proxy follows, for example
  `PORT=4400 PHAROS_SERVER_URL=http://localhost:4400 pnpm dev`. The web app stays on 5173, or the
  next free port if that is taken. Update the MCP URL your agent uses to match.
- **The agent can't connect**: the HTTP server must be running at the URL you registered. A stdio
  client starts its own process and uses the database that process resolves, so a project that
  seems to be missing usually means a different `PHAROS_DB`.
- **Questions aren't answered**: **Settings** shows why. Answering is off with
  `PHAROS_AGENT_COMMAND=off`, unavailable when Claude Code isn't installed (install it or set
  your own command), or paused (resume it there). Output of the command is in
  `~/.pharos/agent.log` (or `PHAROS_AGENT_LOG`); the service's own log is `~/.pharos/server.log`.
- **Changes from another process don't appear**: the web app reloads on a server event, and
  changes written by another process (stdio) are noticed by polling about once a second. Reload
  the page if the live connection was interrupted.

## Development

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

- `packages/schema`: shared Zod schemas (entities, options, view catalog, query language)
- `apps/server`: Hono server, SQLite store with history, MCP tools
- `apps/web`: Vite + React web app that renders views

See [`docs/OVERVIEW.md`](docs/OVERVIEW.md) for the idea and principles,
[`docs/SCOPE.md`](docs/SCOPE.md) for the initial scope, and [`docs/PLAN.md`](docs/PLAN.md) for the
architecture. [`CLAUDE.md`](CLAUDE.md) has notes for agents working on Pharos itself.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, adding components and views,
and submitting a pull request. Use `pnpm format` to apply formatting fixes. CI runs the checks
above on pushes and pull requests.

## Community and license

Use the repository's bug report or feature request template for feedback. Participants follow
the [code of conduct](CODE_OF_CONDUCT.md). Pharos is available under the [MIT License](LICENSE).
