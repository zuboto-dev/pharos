# Pharos — Plan

## Current plan — Generative UI workflows

This roadmap was redesigned on October 6, 2026. Maintainers track detailed tasks, dependencies
and evidence in their local Pharos instance; that project database is not included in the repository.
The public roadmap is recorded below, followed by the archived foundation milestones.

The first public release is **v0.1.0**, an early development preview. Earlier internal planning
called the foundation milestone “v1”; that label did not represent a stable public 1.0 release.
Publishing v0.1.0 does not mean the G1–G5 goals have been completed.

Pharos already implements runtime Generative UI through a trusted component catalog and live
project queries. The next goal is a useful, reliable **question → view → action → refinement →
reuse** workflow. Keep the authoritative project store, MCP access and revision history.

| Stage                                     | Outcome                                                               | Exit evidence                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1 — Establish the workflow baseline      | Specify three representative workflows and capture the starting point | Versioned cases extending the M4 evaluation, predeclared targets, baseline measurements, and independent verification of the old M6 release gate |
| G2 — Make answers reliable and current    | Grounded answers, visible freshness and preserved human edits         | Semantic query validation, stale-answer/reuse behavior, concurrent-edit checks, and accurate run/pause/failure states                            |
| G3 — Let people refine and act            | Refine generic views and complete one typed task-change action        | Saved-view round trip, input/stale/duplicate handling, live updates, Undo, preserved layout, and keyboard/focus checks                           |
| G4 — Close demonstrated capability gaps   | Add only capabilities needed by reproduced workflows                  | Gap record, the smallest justified change or a documented no-change result, two-agent comparison, and an optional integration decision           |
| G5 — Prove value and release the workflow | Demonstrate useful project work and repeatable release readiness      | Comparison with frozen baselines, a real Pharos planning/execution/review cycle, documented pass/fail results, and a clean-checkout walkthrough  |

**G1 is current.** Stages express outcome gates; recorded task dependencies determine what can
overlap. No delivery dates are assigned by this plan. Since October 7, 2026 every delivery task in the
Pharos project is a work item (W1–W17) or one of its sub-tasks (Wn.m), each assigned to a model (Opus 5.5,
Sonnet 5.5, GPT-6.1-Sol or GPT-6-Astra) with a required reasoning level, or to the owner for approvals,
usability walkthroughs and the release call, each with acceptance criteria; see the
decision “Assign roadmap work to four models with required reasoning levels”. Compare factual correctness,
task completion, correction burden, time to useful content, total latency and cost. Choose numerical
improvement targets and budgets in G1 before the experiment; preserve correctness and prevent silent
data loss or stale mutations in the checked core cases. A release recommendation requires evidence,
not just a completed task count.

The six previous Later ideas remain in **Options · Not scheduled**: answering-agent selection,
ScopeBoard dragging, a desktop shell, custom themes, a marketplace and an agent pool. They are
excluded from delivery progress. Seven research proposals have linked implementation tasks in main;
their original records remain in the Generative UI research project as **Promoted to main**.

A2UI, AG-UI, MCP Apps, alternative renderer libraries and partial-spec streaming are optional
responses to a demonstrated need. This plan does not require a framework migration or arbitrary
generated code, and does not authorize a publish/deploy action.

M0–M5 are archived as completed. M6 and Later are archived as superseded; M6 had 8/8 tasks done,
but its independent clean-install/CI/docs/Settings verification carries into G1. All 86 completed
tasks remain historical evidence. Pharos currently represents this archive with explicit custom
stage statuses and filtered views because stages have no native archive field.

## Existing architecture and historical plan

The stack and original milestones below preserve the foundation record. Live status and new work
belong to the roadmap above, rather than this historical sequence.

## Proposed tech stack

| Layer           | Choice                                                      | Notes                                                           |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Language        | TypeScript (monorepo, pnpm workspaces)                      | One language across server, UI, and schemas                     |
| Server          | Node + Hono                                                 | REST plus SSE for live updates                                  |
| MCP             | `@modelcontextprotocol/sdk`                                 | stdio and streamable HTTP transports                            |
| Storage         | SQLite via built-in `node:sqlite` + small migration runner  | Local-first, zero setup, no native build                        |
| Schemas         | Zod (shared package)                                        | Single source for validation, types, and JSON Schema for agents |
| Web UI          | React + Vite + Tailwind                                     | Catalog components live in their own package                    |
| Charts / graphs | Plain SVG + CSS (timeline, dependency graph, progress ring) | No chart dependencies needed so far                             |

### Repo layout

```
pharos/
  apps/
    server/        # HTTP API, SSE, MCP server, DB
    web/           # React UI; src/catalog = catalog components + view renderer
  packages/
    schema/        # Zod: data model + component specs + view spec
  docs/
```

## Archived milestones — M0 to M6

### M0 — Foundations

Set up the monorepo, tooling, shared schema package, and an empty server and web app that talk to each other.
**Done when:** `pnpm dev` starts the server and web UI, and the UI shows a health check from the server.

### M1 — Project data + history + MCP

Build the data model (including repositories), the revision history, the database, the REST
API, and the MCP read, write (`apply`), and history tools.
**Done when:** Claude Code (over MCP) can create two projects under one repository with
goals, stages, and tasks; every change shows up as a revision with a message; and
`project_snapshot` returns the project.

### M2 — Component catalog + renderer

Build the catalog components, their schemas, the view spec format, the renderer, and data bindings.
**Done when:** a new project automatically gets a default Overview view (header, stage tracker,
kanban, goal tree) that renders from live data.

### M3 — Generative views

Add MCP tools for catalog discovery and view CRUD, validation with agent-friendly errors, and live updates.
**Done when:** an agent, starting only from `catalog_list`, creates a useful view for a new
project, and it shows up in the browser without a reload.

### M4 — Ask & explain

Answer questions with generated views. Planned from a Generative UI review (Pharos follows the
declarative pattern of A2UI / json-render; the gap is what agents can show, not how):

1. **Query language v2:** comparisons, relative dates (`$today+7d`), text search, any-of groups,
   one hop through references (`stage.status`)
2. **Generic data components:** DataTable, CountChart, Stat, DataList, templated Text, bound by
   query to any entity type, next to the domain components
3. **Answer views:** views with kind `answer` and the question they answer; kept or dismissed in the UI
4. **Requests inbox:** "Ask about this" in the UI creates a request agents see in `project_snapshot`
5. **Agent self-checks and guidance:** `view_preview`, changes since an agent last looked, view
   guidelines and an example gallery as MCP prompts/resources
6. **Evaluation** with real agents on common questions (status, blockers, overdue, due this week)

Tracked as tasks and proposed decisions in the Pharos project (the "M4 plan" view).
**Done when:** asking the agent "what's overdue?" or "what's blocking stage 2?" produces a focused
answer view, and a question asked from the UI reaches the agent.

### M5 — Edit, polish, dogfood

Add inline edits, the history panel (timeline, diff, revert), theming, empty states, and docs. Move Pharos's own planning into Pharos.
**Done when:** this project's tasks are tracked in Pharos and the docs/TASKS.md file is retired.

Done (October 2026): inline editing of titles, descriptions, and dates; questions answered
automatically by Claude Code when installed (`PHAROS_AGENT_COMMAND` to change or turn off); a
history panel with revert for any revision; loading states and a getting-started guide; the README;
answering cost cut by briefing the agent up front; and reuse of earlier answers. Later ideas were
subsequently preserved in "Options · Not scheduled" under the redesigned roadmap.

### M6 — Initial release preparation (historical)

Prepare the repository for open-source contributions: MIT license, contributor guide, code of
conduct, issue and pull request templates, CI, and portable examples without personal data.
Finish the README and add a Settings page for theme, answering controls, and connection/data
details. Agent selection, custom themes, and other new product directions remain in Later.

**Done when:** a fresh checkout can follow the README, all CI checks pass, release documentation
is present, and the Settings page is usable. Live task status is tracked in Pharos; publishing
the repository and enabling host-specific settings are separate release actions.

## Order and dependencies

```
M0 ──▶ M1 ──▶ M3 ──▶ M4 ──▶ M5 ──▶ M6
        └──▶ M2 ──┘
```

M1 and M2 can run in parallel after M0, but M2's data bindings need M1's model.

## Risks

| Risk                                         | Mitigation                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Agents generate cluttered or unhelpful views | Good catalog descriptions, view guidelines exposed over MCP, a small and opinionated catalog        |
| Spec validation errors confuse agents        | Return precise, path-based error messages with examples                                             |
| Catalog too rigid for some projects          | Keep components composable; track gaps for a later "custom block" escape hatch                      |
| Data model churn                             | Keep the schema in one package; entities stored as validated JSON; numbered migrations from day one |
| History grows large or slow                  | Store revisions as compact change sets; index by project and entity; add snapshots later if needed  |
| Agents skip change messages                  | Make `message` a required parameter on MCP write tools                                              |
