# Pharos

Generative UI project management for people working with AI agents.

**v0.1.0 — early development.** This is the first public preview, shared so you can follow
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
shell. You can also pause answering in **Settings**. The automatic runner uses a POSIX shell;
on Windows, use WSL for this workflow.

### Keep it running (macOS)

`pnpm dev` only lives as long as its terminal. To have Pharos always available for your agents,
run the built app as a launchd service instead:

```sh
pnpm service install
```

That builds Pharos, then starts the server at <http://localhost:4300>, which also serves the web
app, at login and restarts it if it ever exits. Its log is `~/.pharos/server.log`. Use
`pnpm service status`, `stop`, `start`, `restart`, `log`, and `uninstall` to manage it, and re-run
`install` after pulling changes so it runs the latest build. Configuration variables set while
installing are stored in the service, and links that agents share point at the service's own
address unless `PHAROS_WEB_URL` says otherwise. Stop the service before `pnpm dev`, since both
listen on port 4300. On other systems, run `pnpm build` and then `pnpm --filter @pharos/server start`
under your own supervisor; the built server serves the web app too.

## Connect your agent

The server must be running (`pnpm dev`) for the HTTP connection.

**Claude Code**

```sh
claude mcp add --transport http pharos http://localhost:4300/mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.pharos]
url = "http://localhost:4300/mcp"
```

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

The stdio process uses the same database as the web server, and the web app picks up its changes
within a second.

Then try asking your agent:

- “Set up a project in Pharos for this repo from its docs: goals, scope, stages, and tasks.”
- “What's blocking the current stage? Answer with a Pharos view.”
- “Mark the README task done in Pharos.”

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

## Configuration

| Variable               | Default                  | Purpose                                         |
| ---------------------- | ------------------------ | ----------------------------------------------- |
| `PHAROS_DB`            | `~/.pharos/pharos.db`    | Database file                                   |
| `PORT`                 | `4300`                   | Server port                                     |
| `PHAROS_WEB_URL`       | `http://localhost:5173`  | Web app address used in links agents share      |
| `PHAROS_SERVER_URL`    | `http://localhost:4300`  | Server the web app's dev proxy talks to         |
| `PHAROS_AGENT_COMMAND` | Claude Code if installed | Command that answers questions (`off` disables) |
| `PHAROS_AGENT_LOG`     | `~/.pharos/agent.log`    | Log for that command                            |

Set configuration variables in the environment before starting Pharos; it does not automatically
load a root `.env` file. The server only accepts requests from localhost. Keep the web app and
server local: v0.1 has no authentication. See [SECURITY.md](SECURITY.md) for the trust model and
vulnerability reporting.

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
