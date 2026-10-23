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
- Always a document, never an HTML report page (`page`): Pharos refuses one. Another website goes
  in an `embed` block of the document; a `drawing` block only for one visual no component can draw.
- After merged work, a night run, research or an evaluation: add a dated section at the top of the
  project's "Updates" report document (newest first); never a new page per update.
- Every change shows before and after: screenshots or a clip for a screen, the piece of UI drawn
  twice side by side for a component, a `diff` block for code, old and new values for data.
- `view_preview`, fix the warnings, then answer in chat with one or two lines and the link.
- Little to show is no reason to skip it: a short page with what there is and what is missing
  is the report. Only a one-line factual answer stays in chat.
