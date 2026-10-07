# Changelog

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
