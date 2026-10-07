# Pharos — Archived tasks

> **Frozen on 2026-10-06.** Pharos now tracks its own development: open the **Pharos** project in
> your local Pharos (or ask an agent for `project_snapshot`). This file is kept as a record of
> M0–M3 and the original M4–M5 proposal, and is no longer updated. Unchecked items below are
> historical, not current work. See [PLAN.md](PLAN.md) for the milestone overview.

Status: `[ ]` todo · `[~]` in progress · `[x]` done

## M0 — Foundations

- [x] Init git repo, pnpm workspace, TypeScript base config, ESLint + Prettier
- [x] Create `packages/schema` with Zod and a build step
- [x] Scaffold `apps/server` (Hono) with `/health`
- [x] Scaffold `apps/web` (Vite + React + Tailwind) that calls `/health`
- [x] Root `pnpm dev` script that runs both
- [x] Add CLAUDE.md pointing agents at `docs/`

## M1 — Project data + history + MCP

- [x] Define Zod schemas: Repository, Project, Goal, ScopeItem, Stage, Task, Assignee, Artifact, Decision
- [x] Define the revision model: Revision (author, message, timestamp) + Change (entity, before, after)
- [x] SQLite tables + migrations (`node:sqlite`)
- [x] Data-access layer where every write creates a revision (grouping several changes in one revision)
- [x] Reference checks, cascade deletes, and cycle detection (goal parents, task dependencies)
- [x] Revert: apply the inverse of a revision as a new revision, with conflict detection
- [x] REST endpoints for entities, apply, snapshot, history, diff, revert
- [x] MCP server (stdio + streamable HTTP) wired to the data-access layer
- [x] MCP tools: `list`, `get`, `apply` (batched operations with required `message` and `$ref`s)
- [x] MCP tools: `history_list`, `history_diff`, `history_revert`
- [x] MCP tool: `project_snapshot` (compact structured summary)
- [x] Localhost-only access (bind to 127.0.0.1, reject non-local Host/Origin)
- [x] Tests: store, REST, and MCP (SDK client); end-to-end over real HTTP + stdio
- [x] Test: connect from Claude Code (HTTP MCP), create projects, and inspect their history

## M2 — Component catalog + renderer

- [x] Define the view spec format (layout tree + components + data bindings)
- [x] Define the data binding/query format (entity, filters, sort, group)
- [x] Layout components: Grid, Section, Tabs
- [x] Overview: ProjectHeader, StatCards, ProgressRing, Callout, Markdown
- [x] Goals & scope: GoalTree, ScopeBoard
- [x] Plan & time: StageTracker, Timeline, MilestoneList
- [x] Work: KanbanBoard, TaskTable, DependencyGraph, AssigneeMatrix
- [x] Outputs: ArtifactGallery, DecisionLog, ActivityFeed
- [x] Renderer: spec → React tree, with per-component error boundaries
- [x] Default Overview view template, created automatically for every new project
- [x] Project list grouped by repository + project page
- [x] `view` entity type (views are versioned through the revision history)
- [x] Render tests for every catalog component (with data, empty, and a crashing component)
- [x] Visual review round 1: equal heights in grid rows; one stage-progress rule (status first, then tasks)
- [x] Detail drawer for every entity and revision (fields, references, related items, history), linkable via `?entity=` / `?revision=`
- [x] Hover previews for references; click-to-open on cards, rows, graph nodes, stages, goals, scope, artifacts, decisions, activity
- [x] Human edits: task checkbox, Start, drag-and-drop between kanban columns, enum/assignee/stage selects in the drawer (saved as revisions by `human:me`)
- [x] TaskChecklist component (tasks for people), added to the Overview template
- [x] Visual review round 2
- [x] Views are boards of widgets (12-column grid); any spec converts to a board (`toBoard`)
- [x] Customize mode: drag to reorder, resize width/height with column snapping and magnetic guides, remove, add from the catalog, reset to template; every change is a revision with Undo
- [x] Per-project custom options (task status/priority, stage/goal/artifact/decision status, scope groups, artifact kinds), each mapped to a built-in meaning so progress, queries, and highlights keep working
- [x] Options editor (rename, recolor, change meaning, reorder, add, remove with "move items to"), opened from kanban columns, scope board, and the detail drawer
- [x] Visual review round 3: resizing can't shrink below content (saved heights are minimums) or below a per-component column minimum
- [x] Light / Dark / System theme switch; primary buttons readable in dark mode
- [x] Create projects by hand (with an existing or new repository)
- [x] Visual review round 4 (checked in the browser with browser-use):
  - widget picker opens below its button; new widgets scroll into view
  - Customize on mobile (↑ ↓ to move, ⚙ settings, ✕ remove; resize stays desktop-only)
  - widget settings per component (e.g. which stages a stage tracker, kanban, or progress ring covers)
  - quick add for tasks, stages, goals and sub-goals, scope items, artifacts, decisions; delete from the detail panel (all undoable)
  - Timeline: Gantt layout with stage names, aligned day/week/month axis with gridlines, dates on hover
- [x] Visual review round 5 (with M3: live updates, view tabs, agent-built views)

## M3 — Generative views

- [x] Component guidance (`COMPONENT_INFO`: when to use, min/suggested width, example) + JSON Schema from Zod
- [x] MCP tools: `catalog_list`, `catalog_describe`
- [x] MCP tools: `view_list`, `view_get`, `view_create`, `view_update` (widget ops: add, update, move, remove; reset to template), `view_delete`
- [x] Views removed from the agent `apply` schema (113 KB → under 40 KB)
- [x] Validation with path-based, agent-friendly error messages
- [x] SSE live updates for data and view changes (including writes from the stdio MCP process)
- [x] View tabs in the UI (new, rename, pin, archive/restore, delete)
- [x] Test: a headless Claude Code agent built a useful "Plan & risk" view from `catalog_list` alone, and it appeared in the browser without a reload

## M4 — Ask & explain (original proposal)

- [ ] Answer views (temporary, linked to the question asked)
- [ ] Promote an answer view to a saved view
- [ ] MCP prompt/resource: "view design guidelines" for agents
- [ ] Example gallery: question → good view spec pairs
- [ ] Test a set of common questions (status, blockers, next steps, who's on what)

## M5 — Edit, polish, dogfood (original proposal)

- [ ] Inline edits for text fields (title, description, dates); status/assignee/stage edits, adding and deleting landed in M2
- [ ] History panel: a full revision timeline with a revert button for any revision (revision details with diffs and Undo toasts landed in M2)
- [x] Activity feed in the UI (built from revisions; landed in M2)
- [x] Light / dark / system theme and empty states (landed in M2)
- [ ] Loading states (pages render nothing while data loads)
- [ ] README with setup + MCP client config snippets
- [x] Import this file into Pharos and track Pharos's own development there (done early, on 2026-10-06)
