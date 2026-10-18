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
  ≤ 64 MB per view, ≤ 1 GB for all report pages together, the kept files of deleted pages
  included (R13.6, `REPORT_LIMITS.totalAssetBytes`). Assets are page files, not project data, so not revisions. Deleting the view
  stops serving them but keeps them, so undoing the delete brings the whole page back; assets of
  views gone for 30 days are purged (at server start and once a day).
- Uploads aren't revisions, so the change feed (`GET /api/events`) announces them as
  `event: report-assets`, `data: { type: 'report-assets', viewId, at }` (polled by `updated_at`,
  so uploads from the stdio process count; one event per view per poll). An open frame of that
  view reloads (`?v=<updatedAt>-<n>`) once the uploads have paused for 1.5 s.
- `evidenceRevision` is set by Pharos when an agent writes the page (same rule as R11).

## Serving and the frame

- `GET /api/views/:id/page/` serves `page.html`; `GET /api/views/:id/page/<path>` serves an asset.
  Relative URLs in the page (`images/a.jpg`) therefore resolve to assets.
- Both responses carry:
  - `Content-Security-Policy: sandbox allow-scripts allow-modals;
default-src 'none'; script-src OWN 'unsafe-inline' https://cdnjs.cloudflare.com
https://cdn.jsdelivr.net https://unpkg.com; style-src OWN 'unsafe-inline'
https://fonts.googleapis.com; font-src OWN data: https://fonts.gstatic.com;
img-src OWN data: blob:; media-src OWN data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; base-uri 'none'`, where `OWN` is the view's own page path
    as an absolute source, `http://<host>/api/views/<id>/page/` (R13.6; `reportCsp`/`pageSource`
    in `views/report.ts`). `'self'` would be the whole origin, and with `Access-Control-Allow-Origin: *`
    on scripts and fonts a page could load another view's (another project's) files. `<host>` is
    the request's Host, used only when it is 127.0.0.1, localhost or [::1] with an optional port
    (and the id only when it looks like one); otherwise the page gets no own-file source at all.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`
    for the page.
- The page can't reach the API, other sites or the parent's storage: opaque origin, no `fetch`,
  no popups (the frame has neither `allow-popups` nor `allow-popups-to-escape-sandbox`, R13.6).
- Links (sources) open through Pharos: the bridge catches clicks on `<a href>`/`<area href>` with
  an http(s) address (any click, middle clicks too; a link to a place in the same page is left
  alone) and sends `link`; `pharos.openLink(url)` does the same from a script. The parent opens
  only http/https addresses of at most 2,000 characters: a plain one (no query, no fragment, no
  user name, a path of at most 120 characters) at once in a new tab (`noopener,noreferrer`) when
  the reader just clicked in the frame and fewer than 3 opened in the last 10 s; anything else
  shows a strip above the frame with the whole address ("This page wants to open: …", Open /
  Cancel), one at a time. Other schemes are ignored.
- The frame never leaves its page (R13.6). The app's own pages are served with
  `Content-Security-Policy: frame-src 'self'` (the built server's HTML and Vite's dev server), and
  the browser checks the parent's `frame-src` on every navigation of the frame, including one the
  page starts itself (`location.href = …`, a meta refresh, a link that gets past the bridge): a
  navigation to another site is refused before any request is made. (The Navigation API can't
  cancel it from inside: it has no events in an opaque origin.) The frame then shows the
  browser's error page, a second `load`, and the parent stops the frame; it also stops it when
  the bridge says `leaving` (`beforeunload`/`pagehide`) or a second `ready` comes. Stopping
  means: nothing more is answered or posted, the frame goes to `about:blank`, and in its place:
  "This page tried to leave Pharos, so it was stopped." with "Reload page". The destination
  isn't shown (the parent can't know it).
- What is and isn't guaranteed:
  - Guaranteed: the page can't read the API, the app's storage, other views' files or other
    sites; it can't open windows; the parent answers only the document whose bridge said `ready`
    (by its token), never a page the frame was taken to.
  - Not guaranteed: a page can put data into a link, and when the reader chooses to open it, the
    data goes with it. A plain link opens on a click without asking, so up to ~120 characters of
    path (and the host name) can carry data on each click; anything longer, any query or fragment,
    and anything without a click is shown to the reader in full first. A navigation of the frame
    to another Pharos address (same origin) isn't refused, but it carries nothing out and stops
    the frame. Opened in a tab of its own ("Open in new tab"), a page has no live data
    (`pharos.data` rejects) and can go where it likes, like any web page.
- Pharos injects one small script at the top of the served HTML that defines `window.pharos`:
  - `pharos.data(name)` → Promise of rows for a named read (runs `runQuery` in the parent, with the
    owner's dataset); `pharos.onData(cb)` → called again when the project data changes.
  - `pharos.theme` (`"light" | "dark"`) and `pharos.onTheme(cb)`; the injected script also sets
    `data-theme` on `<html>` so pages built with the usual tokens follow the app.
  - `pharos.openFile(fileId)` → asks the parent to open the file viewer (A6), only for a file agents can see (the same dataset `pharos.data` reads; never one in a hidden folder).
  - `pharos.openLink(url)` → asks the parent to open a web address in a new tab (R13.6).
  - Messages go only to `window.parent`; the parent accepts messages only from that frame's
    `contentWindow`, only the kinds below, and only with the token of the bridge that said
    `ready` for this load.
- The web app renders a report view as a full-width frame (no board grid), with a slim bar above:
  page summary, "Updated <date> by <agent>", the R11 out-of-date mark with "Ask to refresh",
  and "Open in new tab".

## Agents (MCP)

- `view_create` / `view_update` accept `page` (replace whole page; `expectedRevision` as today).
- `report_asset_put { viewId, path, base64 }` and `report_asset_list { viewId }`.
- `report_guide` returns the report-writing guide (see below). `view_preview` checks a page:
  size, the named reads (query check, as for blocks), asset paths the HTML references that don't
  exist, external hosts the CSP will block, and scripts that would navigate the page (setting
  `location`, `location.assign/replace`, `window.open`, `<meta http-equiv=refresh>`). References are looked for only where the browser
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

Frame → parent (every one carries `token`: 32 hex characters the bridge picks when it starts,
kept from the page's scripts; R13.6):

| Message                                          | When                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ pharos: 1, token, kind: 'ready' }`            | As soon as the bridge runs (before the page's own scripts), once per document. The parent keeps the token and answers with `theme`; a second `ready` stops the frame. |
| `{ pharos: 1, token, kind: 'data', id, name }`   | `pharos.data(name)`. `id` is a string unique within the frame (`"r1"`, `"r2"`, …).                                                                                    |
| `{ pharos: 1, token, kind: 'openFile', fileId }` | `pharos.openFile(fileId)`: the parent opens the file viewer (A6) only for a file agents can see.                                                                      |
| `{ pharos: 1, token, kind: 'link', url }`        | A click on a web link or `pharos.openLink(url)`: the parent opens it or asks the reader (see "Serving and the frame").                                                |
| `{ pharos: 1, token, kind: 'leaving' }`          | The document is unloading (`beforeunload`, `pagehide`): the parent stops the frame.                                                                                   |

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
  `/api/views/:id/page/…` and adds `Access-Control-Allow-Origin: *` to font and script assets;
  the page's CSP (its own page path only) keeps it to its own view's files.
- Uploads: `PUT /api/views/:id/page/<path>` with the raw file as the body (owner, or an agent by
  `X-Pharos-Author`), `GET /api/views/:id/assets` lists them. The body is read as a stream and
  refused as soon as it passes 10 MB, with or without a Content-Length (R13.6). `GET /api/views/:id/page`
  redirects to `/page/`.

## Not in R13

Comments per section, sharing/exporting a page, editing a page by hand in Pharos.
