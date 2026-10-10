# Pharos: goal and principles

2026-10-10 · written by Opus 5.5 · commit 3dee4e8

> **Draft for the owner to approve.** Nothing here is decided until the owner approves it.

## Goal

**Pharos is designed to light the way for people who are lost in piles of words while pursuing
their ideas, hopes and dreams.**

AI agents produce plans, research and results as long text. Pharos turns that into views the reader
can understand: where they stand, what needs them, and an obvious path to any detail.
(A **view** is a page inside a project, opened from a tab.)

- **The reader** is a person pursuing an idea with the help of AI agents. No technical background
  or knowledge of the topic is assumed. Today the reader is the owner.
- **Pharos is** a local app where agents store a project's work and knowledge as records, and build
  views from those records for the reader to open in a browser.
- **Pharos is not** a project-management tool at heart: project status is one thing it shows, not
  the point. It is not a scoreboard of what agents did, and not a place for agents to write
  free-form pages.

## Principles

1. **Reader first.** Every view is made for the person reading it, not as proof of what the workers
   did. Wording is part of the design, because a view can't be asked what it meant.
2. **Show the work instead of describing it.** Show the actual result: before and after, the
   output itself, the test passing or failing. A sentence saying "done" is not enough.
3. **Onboarding in every view.** The agent that builds a view decides, for that view's purpose,
   where the reader starts, what they need first, and how to reach more detail. Every term is
   explained where it appears.
4. **Certainty always visible.** Every claim shows how sure it is: confirmed by the owner, taken
   from an official source, or the agent's own unconfirmed analysis. A clean view must never look
   more certain than the research behind it.
5. **Knowledge as data.** Findings are stored as records with their source, certainty, the
   conditions they depend on, and the open questions, not as text in a memo. Views read those
   records, so when a finding changes, every view that shows it changes too.
6. **Two-way questions.** A view can ask the reader questions, keep the answers, and narrow itself
   to the reader's situation. The reader can still ask the agent questions, as today.
7. **Keep the frame and the closed catalog, extended.** The frame (project list, its groups, view
   tabs) stays, and agents still build views only from the closed catalog: a fixed set of tested
   building blocks that show live data, let the reader act in place, and are checked before they
   appear. What goes inside views changes, and a new block for explaining is added only when a real
   case needs it.
8. **Small steps with the owner.** Work moves in small steps the owner sees and approves, never
   many tasks followed by one report.

**Check for every view:** within about 30 seconds the reader knows where they stand and what, if
anything, needs them, and can reach any detail by a visible path without reading a block of text.

## What changes against OVERVIEW.md and SCOPE.md (not edited here)

- **Purpose:** "Generative UI project management" becomes "light the way"; project status
  becomes one use among others.
- **Reader:** from "a developer running projects with agents" to anyone pursuing an idea, with no
  technical background assumed. Agents still do the work, but they are not the reader.
- **Catalog:** today it holds only project-management components (boards, tables, timelines); it
  gains components for explaining.
- **Data:** today it holds only project records (goals, tasks, stages, decisions); it gains
  knowledge records (finding, source, certainty, conditions, open questions) and the reader's
  answers.
- **Questions:** today only the reader asks; views will also ask the reader.
- **Default view:** today's Overview (stages, task board, goals) is a status board; it will be
  reconsidered under principle 3.
- **Unchanged:** runs on the owner's computer; any AI agent can connect; data first, views built
  on it; every change recorded with its reason; agents can't write their own page code; the frame.
