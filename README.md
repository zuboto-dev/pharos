# Pharos

**Less reading, more seeing.** Your AI agent keeps the project; Pharos shows it to you as pages
instead of paragraphs.

[Website](https://pharos.zuboto.com) · [Guide](docs/GUIDE.md) · [Changelog](CHANGELOG.md) ·
v0.2, early preview · MIT

![A report page in Pharos: live numbers and a chart, not a wall of text](docs/images/report-page-spending-story.png)

| Without Pharos                    | With Pharos                                          |
| --------------------------------- | ---------------------------------------------------- |
| The agent reports in paragraphs   | It answers with a page: a board, chart or report     |
| Status lives in old chat history  | Goals, stages, tasks and decisions live in one place |
| Pages go stale silently           | A page is marked out of date when its data changes   |
| You can't tell what the agent did | Every change is a revision you can see and undo      |

Local only: one SQLite file on your machine, no account. Works with any MCP agent (tested with
Claude Code and Codex).

## Start

```sh
pnpm install --frozen-lockfile
pnpm dev                                       # web app on :5173, server on :4300
claude mcp add --transport http pharos http://localhost:4300/mcp
```

Then ask your agent: _"Set up this repo as a Pharos project and show me where it stands."_

Needs Node 22.13+ or 24+ and pnpm 12.9.1 (or `npx pnpm@12.9.1`). Other agents, the always-on
macOS service and settings are in the [guide](docs/GUIDE.md).

## For AI agents

- **Using Pharos over MCP:** call `project_snapshot` first, write data only with `apply` (with a
  message saying why), check views with `view_preview` before `view_create`, and read
  `report_guide` before writing a report. Full tool list:
  [guide → For AI agents](docs/GUIDE.md#for-ai-agents).
- **Changing this code:** read [`CLAUDE.md`](CLAUDE.md) first.

## More

[Guide](docs/GUIDE.md) (setup, agents, reports, config, troubleshooting) ·
[Overview](docs/OVERVIEW.md) (why and principles) · [Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) (no auth: keep it local) · [Code of conduct](CODE_OF_CONDUCT.md)
