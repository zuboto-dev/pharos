# R14 · Report documents

Asked by Chaeeon on 2026-10-19: Pharos should draw flexible reports itself, so any agent connected
over MCP gets a good report, not only agents that design whole web pages well. The R13 report page
(agent HTML in a locked frame) stays for bespoke pages; it is no longer the default for reports.

## What it is

A view with `doc` (`packages/schema/src/views/doc.ts`) is a report document: blocks in reading
order that Pharos lays out as a document in its own style. A view has exactly one of `spec`,
`page` or `doc` (the store refuses two). The agent writes structure; Pharos owns typography,
spacing, colour, light/dark and the phone layout.

Blocks:

- `block`: any catalog component (`node`). Text with live values (`${name}` → `values[name]`)
  is the prose block; Markdown, Callout, Stat, StatCards, charts, Timeline, tables and the rest
  work as they do on boards and read data the same way (queries, never copied rows).
- `columns`: two to four columns side by side, each a list of leaf blocks; one column on narrow
  screens. No nested columns.
- `drawing`: agent HTML for one section, for visuals no component can draw (a map, a custom
  diagram). Served in the R13 locked frame with the R13 bridge; `pharos.data(name)` gives only the
  named reads the drawing lists from `doc.data`. Fixed height. It may use the view's report
  assets (`report_asset_put`).
- `embed`: another website shown in place (https only), e.g. a reference page. A link to open it
  is always shown, since many sites refuse to be framed.

`width`: `text` (the reading column, ~68 characters), `wide` (a band for charts and tables) or
`full`. Default: `text` for Text, Markdown and Callout nodes; `wide` for everything else.

Limits (`DOC_LIMITS`): 200 blocks, 12 drawings (300k characters each), 6 embeds, 30 named reads.

## Looks like a report, not a board

Chaeeon rejected agent-built block pages on 2026-10-10 as "made to prove what workers have
done". A document must not look like a board: no widget cards, borders, widget title bars,
drag handles or grid. Components render plain inside the flow (`document` variant), headings
in Markdown/Text are document headings, and there's generous vertical rhythm. The page reads
top to bottom like a well-set article, at 1440 px and at 390 px, light and dark.

## Server

- Store: refuse a view with more than one of `spec`, `page`, `doc`; block asks on a doc are
  refused (read-only for now, as R13).
- Reads and freshness (R11): `docReads` in `packages/schema/src/views/reads.ts`; a doc is
  agent-built, so it gets `evidenceRevision` and goes out of date like a report page.
- Refresh loop (R2): Ask to refresh on a doc asks the agent to rewrite the doc with fresh data
  (same steps as a page, adapted); `updateView` refuses a refresh that turns it into a board or
  page, or drops all its reads.
- Drawing route: `GET /api/views/:id/doc/:blockId/` serves the drawing's HTML with the R13 CSP,
  sandbox and bridge; its rows are only its listed reads. Assets resolve as for the page.
- Embed route: `GET /api/views/:id/embed/:blockId` serves a small wrapper page with no script
  (`default-src 'none'`), `frame-src` set to the embed's origin only and a sandbox that lets the
  site run as itself (`allow-scripts allow-same-origin allow-forms allow-popups
  allow-popups-to-escape-sandbox`, never top navigation). The app's own `frame-src 'self'` stays
  as is, so R13.6 still holds.
- MCP: `view_create`, `view_update` and `view_preview` accept `doc`. `view_preview` reports the
  same query warnings as for boards, plus embeds that are not https and drawings that read names
  missing from `data`. `report_guide` gains a "Report documents" section and says: write a doc
  for a report; write a page only when the whole page needs a design no document can give; use a
  drawing for one visual. Tool descriptions say the same.

## Web

- `apps/web/src/pages/document.tsx`: the document renderer. Components come from the existing
  renderer with live data; a `document` variant (context) drops board chrome.
- Freshness bar, Ask to refresh, version history and Undo work as on a report page.
- Drawing: a sandboxed frame like report pages (same guard: the app answers only the token that
  said `ready`, stops a frame that leaves its page), sized to its height.
- Embed: frame of the embed route, with the caption and an "Open site" link above it.

## Proof

- Sample: "Spending story (document)", built on the same made-up fixture as the R13 sample,
  installed by `samples/install` with a step file.
- `eval/report-doc/`: Claude Code and Codex each write a report document over MCP against a test
  server on made-up data; checked by schema, preview warnings, and screenshots.
- Real page: g-do "Where it stands" rewritten as a document (by Claude Code in the owner's
  session, and by Codex on a test server with a copy), compared with the HTML page.
- Kill criterion (Chaeeon agreed): if the Codex-written document isn't as good as the HTML page
  to Chaeeon, stop and keep HTML only.

## Not in R14

Hand editing, per-block asks, sharing and export, automatic refresh on data change.
