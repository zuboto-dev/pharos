# Pharos — Overview

> Generative UI project management for humans working with AI agents.

## Problem

People now run large, long-lived projects with LLM-based AI agents. As projects grow, both
the human and the agent get lost in walls of text: plans, status updates, task lists, and
explanations all arrive as prose.

Existing tools don't fit this well:

- **Traditional PM tools** (Jira, Linear, etc.) impose a fixed framework. Agents can be taught
  to use them, but not every project fits that framework.
- **Flexible tools** (Notion, whiteboards, etc.) let people shape their own views, but those
  visual structures are hard for an agent to understand, produce, or keep up to date.

## Idea

**Generative UI**: the agent generates the interface that best explains _this_ project,
based on its context, instead of forcing the project into a fixed layout.

The agent doesn't invent UI from scratch. It composes views from a **catalog of conventional
project-management components** (timelines, kanban boards, goal trees, stage trackers, artifact
lists, and so on), bound to live project data. The result is a project that explains itself
visually: its description, goals, scope, plan, current stage, assignments, progress, and
expected artifacts.

The agent can also **answer questions with UI**. When the user asks "what's blocking the
release?" or "what's the plan for next week?", the agent can respond with a focused generated
view instead of paragraphs.

## Who it's for

- **Primary:** a developer or builder running projects with one or more AI agents
  (Claude Code, Claude Desktop, Cursor, and other MCP clients).
- **Secondary:** the agents themselves, which get a structured, persistent source of truth
  for the project instead of re-reading long chat history.

## Product principles

1. **Structured data first, UI second.** Views are generated _over_ project data, never
   instead of it. Changing a task updates every view that shows it.
2. **Compose, don't draw.** Agents build views from a typed component catalog (JSON specs),
   which keeps them consistent, safe, and editable.
3. **Agent-agnostic.** Any MCP-capable agent can read and write projects and generate views.
4. **Less reading, more seeing.** Every feature should reduce the amount of text a human has
   to read to understand the state of a project.
5. **Local-first.** It runs on the user's machine with local storage, so there's no account
   to set up.

## How it works (at a glance)

```
 ┌──────────────┐   MCP (tools)    ┌──────────────────────────────┐
 │  AI agent    │ ───────────────▶ │  Pharos server                │
 │ (Claude Code,│                  │  - project data (SQLite)     │
 │  Cursor, …)  │ ◀─────────────── │  - view specs (JSON)         │
 └──────────────┘   results        │  - component catalog schemas │
                                   └──────────────┬───────────────┘
                                                  │ HTTP + live updates
                                   ┌──────────────▼───────────────┐
                                   │  Pharos web UI (localhost)    │
                                   │  renders view specs with the │
                                   │  component catalog           │
                                   └──────────────────────────────┘
```

## Key decisions

| Decision            | Choice                              | Why                                                      |
| ------------------- | ----------------------------------- | -------------------------------------------------------- |
| Agent integration   | MCP server                          | Works with any MCP client, so no agent is locked in      |
| Platform (v0.1)     | Local web app                       | Fastest path; suits a single builder working with agents |
| Generative UI model | Component catalog + JSON view specs | Safe, consistent, data-bound, and editable               |
| Source of truth     | Structured project data             | Views stay in sync; agents don't depend on prose         |

See also [SCOPE.md](SCOPE.md), [PLAN.md](PLAN.md), and the [archived task list](TASKS.md).
