# R13 · Report pages (contract)

Decided 2026-10-17 (owner): Pharos keeps two kinds of pages.

- **Working pages**: what exists today (a Board of catalog blocks over live data): money, tasks,
  files, quick answers.
- **Report pages** (new): the agent writes the whole page as HTML, with its own look, story and
  interactives, like a claude.ai artifact. Pharos shows it in a locked frame and adds what a
  stand-alone page can't: the data stays local, the page is marked out of date when the data it
  used changes, every version is kept, any MCP agent (Claude Code, Codex) can write one, and it
  sits next to the project's tasks and decisions.

## Data model

`ViewData.page` (optional, `packages/schema/src/views/report.ts`). A view with `page` is a report
page; `spec`/`template` are ignored for it. A view has either a board or a page, not both.

```ts
ReportPage = {
  html: string;            // the whole document the agent wrote, ≤ 2,000,000 chars
  data?: Record<string, { type: QueryableType; filter?: Filter }>; // ≤ 30 named reads
  summary?: string;        // one or two sentences: what the page says (shown in lists and to agents)
}
```

- Pictures, fonts and scripts the page ships go in **report assets**: a `report_assets` SQLite
  table (migration), keyed by `(view_id, path)`, `mime` from the extension
  (png jpg jpeg gif webp svg avif css js json woff woff2 ttf otf mp4 webm), ≤ 10 MB each,
  ≤ 64 MB per view. Assets are page files, not project data, so not revisions; deleting the view
  deletes them.
- `evidenceRevision` is set by Pharos when an agent writes the page (same rule as R11).

## Serving and the frame

- `GET /api/views/:id/page/` serves `page.html`; `GET /api/views/:id/page/<path>` serves an asset.
  Relative URLs in the page (`images/a.jpg`) therefore resolve to assets.
- Both responses carry:
  - `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals;
default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com
https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline'
https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; base-uri 'none'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`
    for the page.
- The page can't reach the API, other sites or the parent's storage: opaque origin, no `fetch`.
  Links (sources) open in a new tab.
- Pharos injects one small script at the top of the served HTML that defines `window.pharos`:
  - `pharos.data(name)` → Promise of rows for a named read (runs `runQuery` in the parent, with the
    owner's dataset); `pharos.onData(cb)` → called again when the project data changes.
  - `pharos.theme` (`"light" | "dark"`) and `pharos.onTheme(cb)`; the injected script also sets
    `data-theme` on `<html>` so pages built with the usual tokens follow the app.
  - `pharos.openFile(fileId)` → asks the parent to open the file viewer (A6).
  - Messages go only to `window.parent`; the parent accepts messages only from that frame's
    `contentWindow`, and only these four kinds.
- The web app renders a report view as a full-width frame (no board grid), with a slim bar above:
  page summary, "Updated <date> by <agent>", the R11 out-of-date mark with "Ask to refresh",
  and "Open in new tab".

## Agents (MCP)

- `view_create` / `view_update` accept `page` (replace whole page; `expectedRevision` as today).
- `report_asset_put { viewId, path, base64 }` and `report_asset_list { viewId }`.
- `report_guide` returns the report-writing guide (see below). `view_preview` checks a page:
  size, the named reads (query check, as for blocks), asset paths the HTML references that don't
  exist, and external hosts the CSP will block. References are looked for only where the browser
  loads them: `src`, `poster`, `srcset`, `<object data>`, `<link href>` that loads (stylesheet,
  icon, preload; never `<a href>`), and `url()`/`@import` in `<style>` blocks and `style`
  attributes; never in script text, comments or plain text.
- Reads: `boardReads` for a report page = the queries in `page.data`, so R11 freshness works
  unchanged: when data a page read changes, the page is out of date and the reader can ask for a
  refresh (request `mode: "refresh"`).

## The report guide (agents)

Short, practical, in `guidance.ts`: one subject → one visual world (palette, type, a motif);
open with the claim and 3–5 key numbers; headings are claims; a source on every number; an
honesty box for what the evidence doesn't say; interactives only where they answer the reader's
question (a slider, a toggle, a filter, a simulator); real pictures with credits; colour tokens on
`:root` with a dark set under `[data-theme=dark]`; works at 390 px; no network except fonts and
the three CDNs; live numbers come from `pharos.data`, never copied into the HTML when the project
has them.

## Bridge messages

The injected script (`apps/server/src/views/bridge.ts`) and the web app's frame talk only with
`postMessage`. Every message is a plain object with `pharos: 1` and a `kind`; anything else is
ignored on both sides. The frame has an opaque origin, so both sides post with target origin
`"*"` and check the sender instead: the frame accepts a message only when
`event.source === window.parent`; the parent only when `event.source` is that frame's
`contentWindow`.

Frame → parent:

| Message                                   | When                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `{ pharos: 1, kind: 'ready' }`            | As soon as the bridge runs (before the page's own scripts). The parent answers with `theme`.    |
| `{ pharos: 1, kind: 'data', id, name }`   | `pharos.data(name)`. `id` is a string unique within the frame (`"r1"`, `"r2"`, …).              |
| `{ pharos: 1, kind: 'openFile', fileId }` | `pharos.openFile(fileId)`: the parent opens the file viewer (A6) if the file is in the project. |

Parent → frame:

| Message                                               | Meaning                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{ pharos: 1, kind: 'data', id, name, rows, error? }` | The answer to the `data` request with that `id`: `rows` is `runQuery(dataset, read.type, read.filter)` for `page.data[name]` (entities as `{id, type, data, …}`, the owner's dataset). With `error` (a string, e.g. an unknown name), `pharos.data` rejects with it and `rows` is ignored (send `[]`). |
| `{ pharos: 1, kind: 'changed' }`                      | The project data changed. The frame asks again (`data`) for every name it has asked for so far and, once all have answered, calls each `onData` callback once with `{ [name]: rows }`.                                                                                                                 |
| `{ pharos: 1, kind: 'theme', theme }`                 | `"light"` or `"dark"`. The frame sets `data-theme` on `<html>` and, when it changed, calls each `onTheme` callback with it.                                                                                                                                                                            |

Details:

- The initial theme comes from the page address: `GET /api/views/:id/page/?theme=dark|light`
  (the frame's `src`), so the first paint is right; without it the bridge uses
  `prefers-color-scheme`. `pharos.theme` always holds the current one.
- `pharos.data` rejects after 20 s without an answer, and at once when the page is opened outside
  a frame (top level): "open this page in Pharos to see it".
- `window.pharos` can't be replaced or changed by the page (a frozen object on a read-only
  property).
- Assets: fonts and module scripts load in CORS mode from the frame's opaque origin
  (`Origin: null`). The server accepts `Origin: null` only for `GET`/`HEAD` of
  `/api/views/:id/page/…` and adds `Access-Control-Allow-Origin: *` to font and script assets.
- Uploads: `PUT /api/views/:id/page/<path>` with the raw file as the body (owner, or an agent by
  `X-Pharos-Author`), `GET /api/views/:id/assets` lists them. `GET /api/views/:id/page`
  redirects to `/page/`.

## Not in R13

Comments per section, sharing/exporting a page, editing a page by hand in Pharos.
