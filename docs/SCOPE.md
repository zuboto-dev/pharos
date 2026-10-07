# Pharos — Initial scope (v0.1)

This document preserves the original foundation scope, published as v0.1. The current Generative UI delivery scope is in
[PLAN.md](PLAN.md#current-plan--generative-ui-workflows) and the live Pharos project. It adds
workflow evaluation, semantic validation/freshness, human refinement, typed task actions and
accessible interaction while retaining the local-first, structured-data and trusted-catalog boundaries.

## Initial goals

1. An agent connected over MCP can create a project and fill in its description, goals, scope,
   stages, tasks, assignees, and expected artifacts.
2. An agent can generate one or more **views** for a project from the component catalog, and
   the user sees them render live in the browser.
3. The user can ask a question about the project (through their agent), and the agent can
   answer with a generated **answer view**.
4. The user can do basic edits in the UI (task status, assignee, and so on), and agents
   see those changes.
5. Pharos can manage the development of Pharos itself (dogfooding).

## In scope

### Project data model

- **Repository** (optional): a linked code repo (local path / remote URL); one repo can hold
  several projects, and a project can also exist without a repo
- **Project**: name, summary, description (markdown), status, current stage, repository
- **Goal**: hierarchical goals and success criteria
- **Scope item**: in or out of scope, with rationale
- **Stage / milestone**: ordered phases with target dates and status
- **Task**: title, description, status, priority, assignee, stage, dependencies, estimate
- **Assignee**: human or agent (for example "Claude Code", "me")
- **Artifact**: expected and produced deliverables (files, links, docs), linked to tasks or stages
- **Decision / note**: short log entries with timestamps

### Custom options

Each project can replace the default option lists for task status and priority, stage, goal,
artifact, and decision status, scope groups, and artifact kinds. Every option maps to a built-in
**meaning** (e.g. a custom "In review" status counts as in progress), so progress, filters, and
highlights work the same for every project, and agents can read the options from
`project_snapshot`.

### Revision history (git-like)

Every change to project data or a view is recorded as a **revision**, modeled on a git commit:

- author (human or a named agent), timestamp, and a **message** saying _why_ the change was made
- the changes it contains (entity, field, before → after); several edits can be grouped into one revision
- browse history per project, per task/decision, or per view
- diff any two revisions; revert a revision
- decisions and tasks link to the revisions that created or changed them, so the reasoning can be traced

MCP write tools require a message with each change, the same way a commit needs a message.
The activity feed is built from these revisions.

### Component catalog (initial set)

Each component has a typed schema (Zod → JSON Schema) that agents can discover over MCP.

| Category      | Components                                                |
| ------------- | --------------------------------------------------------- |
| Overview      | ProjectHeader, StatCards, ProgressRing, Callout, Markdown |
| Goals & scope | GoalTree, ScopeBoard (in / out / maybe)                   |
| Plan & time   | StageTracker, Timeline / Gantt, MilestoneList             |
| Work          | KanbanBoard, TaskTable, DependencyGraph, AssigneeMatrix   |
| Outputs       | ArtifactGallery, DecisionLog, ActivityFeed                |
| Layout        | Grid, Section, Tabs                                       |

Components bind to data by **query** (for example "tasks where stage = 2"), not by copying data,
so views stay live.

### View system

- A view is a **board**: a 12-column grid of widgets, each one catalog component with a width,
  optional column, and optional height. People can rearrange, resize, remove, and add widgets;
  agents generate boards (or simple component trees, which are converted to boards).

- A **view spec** is a JSON tree of layout and catalog components plus data bindings.
- Views are stored per project, named, and can be pinned or archived.
- **Default views**: every project automatically gets an **Overview** view (header, stage
  tracker, task board, goals) built from a template, so it is never blank. Agents customize it
  or add views on top.
- View specs are versioned through the same revision history.
- **Answer views** are temporary views created in reply to a question; they can be promoted to
  saved views.
- Specs are validated against catalog schemas; invalid specs are rejected with useful errors
  the agent can fix.

### MCP server

- `project_snapshot`: a compact structured summary so an agent can get up to speed quickly
- `list` / `get` for reading any entity type
- `apply`: the write tool for project data. It takes a required `message` (the reason for the
  change) and a batch of create/update/delete operations, applied atomically as one revision.
  Creates can name themselves (`ref`) so later operations in the same batch can reference them (`$ref`)
- `catalog_list` / `catalog_describe`: the component catalog, with guidance on when to use each
  component, sizes, examples, and the rules for boards and filters
- `view_list` / `view_get` / `view_create` / `view_update` / `view_delete`: generate and edit views
  with small widget operations (add, update, move, remove, reset to template)
- `history_list` / `history_diff` / `history_revert`
- Transport: stdio (for local clients) and streamable HTTP

### Web UI

- Project list, grouped by repository, and a project page with view tabs
- History panel: a revision timeline with messages, diffs, and revert
- Live updates when an agent changes data or views
- Basic inline edits (task status, assignee, and title)
- Light and dark theme

## Out of scope (v0.1)

- Multi-user accounts, auth, sharing, and cloud hosting
- A built-in chat or LLM panel inside Pharos (agents connect over MCP instead)
- Free-form, agent-written HTML or JSX components
- Integrations with Jira, Linear, GitHub Issues, and similar tools (possible later)
- Mobile apps and a desktop wrapper
- Time tracking, billing, and resource leveling

## Later candidates

- Custom fields on entities, declared per project like custom options
- Views inside chat apps via MCP Apps (a read-only renderer as a `ui://` resource)
- Built-in chat panel using the Claude API
- Sandboxed custom blocks for anything the catalog can't express
- GitHub integration (link tasks to PRs and issues)
- Export or share views as static pages
- Multi-agent coordination views (which agent is doing what, plus handoffs)
- View hints: Pharos suggests missing views to agents (for example "dependencies exist but no
  view shows them")
- Branching for plans ("what if" plans that can be merged back)
- Export project data and history as files that can be committed to the linked code repo

## Resolved decisions

- **Repos and projects:** one repository can hold several projects.
- **History:** all data and view changes are versioned with git-like revisions (author,
  message, diff, revert).
- **Who creates views:** Pharos creates default views automatically; agents customize them and
  add their own.
