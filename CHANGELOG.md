# Changelog

## 0.2.0 — 2026-10-19

Second development preview. Pharos now reads more like a set of pages about your project than a
tracker: pages answer the reader's questions first, show what changed since you last looked, can
act on records, show the files the project is about, and can be written whole as HTML by an
agent. This is still an early release, not a stable 1.0 product.

### Available

- **Report pages**: an agent can write a whole page as HTML, with its own look, story and
  interactive parts, that reads live project data. Pharos shows it in a locked frame (no network,
  no popups, no leaving the page), keeps every version, and marks it out of date when the data it
  read changes; "Ask to refresh" has the answering agent rewrite it from the same data. Agents use
  `view_create` with a page, `report_asset_put` for pictures, fonts and scripts, `report_guide`
  and `view_preview`.
- **Actions and block asks**: Action blocks ("Log a service", "Mark paid") with a short form built
  from the record type, one revision per submission and Undo; ask an agent to change one block of
  a page, and agents may change only that block while the ask is open.
- **What changed and out-of-date marks**: dots and a "since you last looked" line on pages that
  changed, stale answers with Refresh, and clear run states (off, paused, idle, queued, running,
  stopping) for automatic answering.
- **Project files**: add folders on the Settings page with an access level; file lists, a file
  viewer and a Files page. Files stay on your disk and are read-only, and agents see only file
  details, never contents, and can't add, move or remove files.
- **Records and packs**: record types with money, date and text fields, and ready-made project
  packs (car, money, music, study, company documents) under New project; pages are checked
  against record fields, and their totals and due dates are fact-checked.
- New blocks: claim cards, layers and tap-to-explain terms, before-and-after, finding charts, flow
  pictures, a gallery, a decision block and category breakdowns.
- Presence: calm marks where an agent is editing a page or answering a question.
- A clearer look: one visual system for colour, type and spacing, light-mode contrast to WCAG AA,
  loading skeletons, empty states that say what's next, a one-line top bar, a phone layout and an
  offer to reload when Pharos is updated.
- Agent compatibility scenarios in `eval/compat`: Claude Code and Codex each passed 5 of 5.
- Sample views built from made-up data, installed with `samples/install/install-samples.mjs`.

### Still being developed

- Measuring how well pages answer a reader's questions across many kinds of projects.
- More agents in the compatibility runs (OpenCode is planned).
- Report pages: a page can still put data into a link the reader chooses to open, and a page
  opened in a tab of its own has no live data.
- Complete keyboard interaction.

The application is still local-only and has no authentication; keep the server and web app on
your own machine. Pausing automatic answering now stops a run in progress. See
[SECURITY.md](SECURITY.md) for boundaries. The release contains source code and made-up samples;
project databases, private logs and credentials are not included.

## 0.1.0 — 2026-10-07

First public development preview of Pharos, a local Generative UI project workspace for people
working with AI agents. This is an early release, not a stable 1.0 product.

### Available

- Structured projects, goals, scope, stages, tasks, artifacts and decisions with revision history
  and Undo.
- MCP tools over HTTP and stdio for agents to read, update and explain project work.
- Generated, saved and temporary answer views composed from a typed component catalog and live
  project queries.
- A local web app with inline editing, board customization, custom project options, light/dark
  themes and view-update attribution.
- Optional automatic answering through a local agent, plus a macOS background-service helper.
- MIT license, contribution guidance, synthetic test fixtures and CI configuration.

### Still being developed

- Stronger semantic query validation, answer freshness and protection from concurrent edits.
- Generic-widget refinement, typed forms/actions and complete keyboard interaction.
- Clearer run/pause behavior and repeatable workflow evaluation.

The application is local-only and has no authentication. Pausing automatic answering stops new
queued work; it does not cancel a process already running. See [SECURITY.md](SECURITY.md) and the
[G1–G5 roadmap](docs/PLAN.md) for boundaries and planned work. The release contains source code;
project databases, private logs and credentials are not included.
