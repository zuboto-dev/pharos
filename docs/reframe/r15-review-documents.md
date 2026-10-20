# R15 · Rich report documents and the review desk

Asked by Chaeeon on 2026-10-20, after comparing R14 documents with an HTML review page an agent
made on claude.ai: documents "still seem very limited and don't deliver the content enough". The
reference is a review desk: one calm column; each thing to review is a sheet with its time, its
pictures (before/after screenshots, phone shots, recordings), how to check it (numbered steps with
commands to copy), and answer buttons whose answers are saved for the agent's next session; a
progress line and a list of sheets at the top; reasoning tucked behind "more". Chaeeon wants agents
to write this much inside Pharos, not as an imported HTML file. Their standing instruction to
agents now says: anything that needs their review or feedback comes as a report with pictures and
the steps to proceed, or a review interface they can follow.

R15 extends R14 (`docs/reframe/r14-report-documents.md`); everything there still holds unless
changed below. Schema: `packages/schema/src/views/doc.ts`.

## New blocks

- `figure`: pictures, clips or sounds uploaded to the view with `report_asset_put`; `items`
  (`src`, `alt`, `caption`), `layout` single | pair | grid | phone | compare, `caption`. A picture
  opens full size on click (Escape closes). `compare`: two pictures of the same size with a slider
  between them. Video and audio get their controls; nothing autoplays.
- `steps`: numbered steps (`text` markdown, optional `command` with a copy button, optional
  `expect`: what the reader should see).
- `details`: closed by default (`summary`, `open`), holds leaf blocks and columns.
- `sheet`: one item to review or act on: `title`, `time` ("10 min"), `tags`, `decisions` (ids of
  decisions with options, each shown with a DecisionBlock inside the sheet), `blocks` (leaves,
  columns, details). A sheet with decisions is open until each has a choice or an answer, then
  answered. Sheets sit at the top level only.

Containers: leaves (block, drawing, embed, figure, steps) go anywhere; columns hold leaves;
details hold leaves and columns; sheets hold leaves, columns and details.

## The review desk

When a document has two or more sheets, Pharos draws a header above the first one: "Needs you: N
items, about M min" (M sums the sheets' times it can read as minutes or hours; leave it out when
none can be read), a progress bar and "k of n answered" (sheets with decisions), and one chip per
sheet linking to it, with a dot that turns green once answered. A sheet without decisions counts
as an item but not in the progress.

## Answers

- In a document, the reader can answer: DecisionBlock (choose, write another answer, decide
  later, change) and TaskChecklist ticks work as on a board. Structure edits stay hidden (adding,
  dragging, editing option lists, Action forms) as in R14.
- Answers are ordinary project data (decision `chosenOptionId`, `answer`, `deferredUntil`; task
  status), one revision each, with Undo. Agents read them over MCP: `view_get` on a document lists
  each sheet with its state and each decision's answer, so "read my answers" needs one call.
- The reader's own answers don't make the document out of date: a change that only sets a
  decision's owner-only fields (`chosenOptionId`, `answer`, `deferredUntil`) or ticks a task the
  document shows in a TaskChecklist doesn't count for its freshness (R11).

## Server

- Assets: `GET /api/views/:id/assets/<path>` serves a document's uploaded files to the app (the
  right type; SVG with a sandbox CSP and no scripts; Range requests so video and audio can seek;
  only while the view exists). `report_asset_put` accepts audio (mp3, m4a, ogg, wav).
- `view_preview` warns about: figure sources not uploaded yet (list them; the agent uploads, then
  previews again), a compare figure without exactly two pictures, sheet decisions that don't exist
  in the project, have no options, or have no DecisionBlock inside that sheet, and a document with
  sheets but no `time` on any.
- `report_guide` gains "Rich documents and the review desk": when to use each block; a report
  explains (what was done, why, the evidence as pictures, how to check, what's needed from the
  reader) rather than only listing data; screenshots: take them with your own tools, upload with
  report_asset_put, show before/after as a pair or compare; a complete review-desk example (two
  sheets, one figure, one steps block, one decision). Tool descriptions mention figures and
  sheets.

## Web

- Renderers for figure (all layouts, the full-size view, the compare slider), steps (copy button
  that says "Copied"), details, sheet (a quiet frame is right here: a sheet is an item, unlike
  R14's plain blocks), and the review-desk header. Code blocks in Text and Markdown inside a
  document get a copy button too.
- Re-enable answering in documents (see Answers); answers update the sheet state and the header
  live through the feed.
- Layout: 1440 and 390 px, light and dark; no horizontal page scroll; a phone figure shows at most
  two shots per row on a phone.

## Proof

- Sample "Review desk (sample)" on made-up data: three sheets (one with a pair of before/after
  screenshots of a made-up app and a decision, one with steps and a command, one with an audio
  clip and a checklist), a details block, live progress. Screenshots before and after answering.
- The first real one: the review of R15 itself, written by Claude Code in the Pharos project.

## Not in R15

Hand editing, comments on a block, sharing and export, uploads by the reader.
