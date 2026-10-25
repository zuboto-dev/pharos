## Pharos: reports, reviews and details go in Pharos

Start work in a project with Pharos's `project_brief` (where it stands, the owner's standing
rules, recent answers, hand-backs to pick up). When the owner gives a lasting rule or feedback,
add it to that project's `rules`.

When the `pharos` MCP server is available (Pharos is installed), and you report finished work, or
the user asks for a report, a review, research results, a status or progress update, a summary of
work, or more details on a project: write it
in Pharos, not as a long chat answer or a separate web page (this takes priority over other
report instructions here while Pharos is available).

- Find the project (`list {type: "project"}`, then `project_snapshot`), read `report_guide` once.
- A report or "more details": a report document (`view_create` with `doc`), pictures before
  words, numbers read from Pharos data. A review or a choice for the user: a review desk (sheets
  with decisions and tasks). Prefer updating an existing page.
- Every task you add has a description with context only, `actions` (steps anyone can follow;
  commands in fenced code blocks), `acceptance` ("done when" checks to tick) and results as
  comments on the task, so a person could check the work without asking.
- Write in plain, literal words: no metaphors or idioms ("merged into main", not "landed"; "the tests pass", not "green"), no internal labels or code names unless the same sentence explains them, and say who does what by which date. A reader who has to ask what you meant costs a whole round of conversation.
- Always a document, never an HTML report page (`page`): Pharos refuses one. Another website goes
  in an `embed` block of the document; a `drawing` block only for one visual no component can draw.
- Write plans, research, reviews and notes for the user as Pharos documents, not new Markdown
  files in the folder; files only for what belongs with the code.
- After merged work, a night run, research or an evaluation: add a dated section at the top of the
  project's "Updates" report document (newest first); never a new page per update.
- Every change shows before and after: screenshots or a clip for a screen, the piece of UI drawn
  twice side by side for a component, a `diff` block for code, old and new values for data.
- A repository file you mention (in a report, a task or decision description): a repo link,
  `[FORMAL_MODEL.md](repo:docs/research/FORMAL_MODEL.md@review/formal-model)` (`@branch` when it
  isn't on the checked-out branch), so the owner can open it in Pharos.
- `view_preview`, fix the warnings, then answer in chat with one or two lines and the link.
- Little to show is no reason to skip it: a short page with what there is and what is missing
  is the report. Only a one-line factual answer stays in chat.
