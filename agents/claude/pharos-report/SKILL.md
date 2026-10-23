---
name: pharos-report
description: Use when you finish a piece of work and report it, or the user asks for a report, a review, research results or findings, a status or progress update, a summary of what was done, or more details or an explanation about a project, and Pharos's MCP tools (mcp__pharos__*) are available. Writes it in Pharos as a report document or a review desk, with pictures before words, and answers in chat with the link. Not for quick factual answers or code changes.
---

<!-- Installed by Pharos (pnpm agents install); `pnpm agents remove` takes it out. -->

Pharos is installed here, so reports live in Pharos, where the user reads them, not in chat.

1. **No Pharos tools?** If no `mcp__pharos__*` tools are available, answer as usual and stop.
2. **Find the project.** `PHAROS_PROJECT_IDS` in the environment names it when you run in
   Pharos's panel; else `list {type: "project"}` and match this folder's repository or the
   project the user named. Then `project_snapshot`.
3. **Read its brief.** `project_brief` gives the owner's rules for it and what they answered lately;
   follow them.
4. **Read the guide once.** `report_guide` (report documents, the glance test, examples).
5. **Write it.**
   - A report, status or "more details": a report document (`view_create` with `doc`): a claim
     as the heading, 3–5 key numbers, then sections that each lead with something to see (stats,
     a chart, a table, a figure, a drawing, a clip), words only for the claim and the so-what.
     Facts the page shows are Pharos data it reads, not numbers copied into it.
   - A review, or anything the user must choose or do: a review desk (sheets with decisions
     that have options and a recommendation, and tasks for them), so they answer in place and
     it reaches their desk.
   - Every change shows before and after: screenshots or a clip for a screen, the piece of UI
     drawn twice side by side for a component, a `diff` block for code, old and new values for
     data. Take the before shot before you change anything.
   - Updating an existing page beats making a new one (`view_list`, then `view_update`).
6. **Check it.** `view_preview`; fix every warning you can.
7. **Little to show is no reason to skip it.** A short page with what there is and what is
   missing is the report; only a one-line factual answer stays in chat.
8. **Answer in chat** with one or two lines (the claim, what needs them) and the page's link.
