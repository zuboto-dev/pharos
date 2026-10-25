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
   - Always a document, never an HTML report page (`page`): Pharos refuses one, and the content
     is made with Pharos's blocks. To show another website inside the report, use an `embed`
     block; a `drawing` block is only for one visual no component can draw.
   - A review, or anything the user must choose or do: a review desk (sheets with decisions
     that have options and a recommendation, and tasks for them), so they answer in place and
     it reaches their desk.
   - Every task you add has a description with context only, `actions` (steps anyone can
     follow; commands in fenced code blocks), `acceptance` ("done when" checks to tick) and
     results as comments on the task, so a person could check the work without asking.
   - Write in plain, literal words: no metaphors or idioms ("merged into main", not "landed";
     "the tests pass", not "green"), no internal labels or code names unless the same sentence
     explains them, and say who does what by which date. A reader who has to ask what you meant
     costs a whole round of conversation.
   - Every change shows before and after: screenshots or a clip for a screen, the piece of UI
     drawn twice side by side for a component, a `diff` block for code, old and new values for
     data. Take the before shot before you change anything.
   - A repository file you mention (in a report, a task or decision description): a repo link,
     `[FORMAL_MODEL.md](repo:docs/research/FORMAL_MODEL.md@review/formal-model)` (`@branch` when
     it isn't on the checked-out branch), so the owner can open it in Pharos.
   - Updating an existing page beats making a new one (`view_list`, then `view_update`).
   - Anything written for the user (a plan, research, a review, notes, a summary) goes in a
     Pharos document, not a new Markdown file in the folder; files are only for what belongs
     with the code (README, CLAUDE.md, code docs).
   - After a version or batch of merged work, a night run, a search or research pass, or an
     evaluation: add a dated section at the top of the project's "Updates" report document
     (newest first: what changed with before and after, the numbers, what needs the owner).
     Create it once if the project has none; never a new page per update.
6. **Check it.** `view_preview`; fix every warning you can.
7. **Little to show is no reason to skip it.** A short page with what there is and what is
   missing is the report; only a one-line factual answer stays in chat.
8. **Answer in chat** with one or two lines (the claim, what needs them) and the page's link.
