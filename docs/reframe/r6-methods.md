# R6.1 · Public methods for many kinds of projects and project files

Searched 2026-10-12 by an Opus 5.5 agent before designing R6. Every source was opened that day; anything else is marked "not confirmed". IDs: A = many kinds of projects, B = project files.

## 1. Methods at a glance

| #   | Method                                                                     | Source (checked 2026-10-12)                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Notion databases: properties, views, filters                               | [Intro to databases](https://www.notion.com/help/intro-to-databases), [Property types](https://www.notion.com/help/database-properties)                                                                                                                                                                                                   |
| A2  | Notion database templates (incl. repeating)                                | [Database templates](https://www.notion.com/help/database-templates), [Personal finance gallery](https://www.notion.com/templates/category/personal-finance)                                                                                                                                                                              |
| A3  | Airtable field types (linked record, lookup, rollup, currency, attachment) | [Field types overview](https://support.airtable.com/docs/supported-field-types-in-airtable-overview)                                                                                                                                                                                                                                      |
| A4  | Obsidian Bases (views over file properties)                                | [Bases](https://obsidian.md/help/bases)                                                                                                                                                                                                                                                                                                   |
| A5  | Obsidian Dataview (index metadata, query it)                               | [Dataview docs](https://blacksmithgu.github.io/obsidian-dataview/)                                                                                                                                                                                                                                                                        |
| A6  | Tana supertags (typed nodes, extend)                                       | [Supertags](https://outliner.tana.inc/learn/features/supertags)                                                                                                                                                                                                                                                                           |
| A7  | Capacities object types (basic vs custom)                                  | [Content types](https://docs.capacities.io/reference/content-types)                                                                                                                                                                                                                                                                       |
| A8  | Coda, now "Superhuman Docs": pages + tables + many views                   | [What is Coda](https://coda.io/resources/guides/what-is-coda)                                                                                                                                                                                                                                                                             |
| A9  | YNAB method ("What's it for?")                                             | [YNAB method](https://www.ynab.com/ynab-method). The classic "four rules" page returned 404: not confirmed.                                                                                                                                                                                                                               |
| A10 | Actual Budget reports (net worth, cash flow, spending, summary, calendar)  | [Reports](https://actualbudget.org/docs/reports/), [Docs home](https://actualbudget.org/docs/)                                                                                                                                                                                                                                            |
| A11 | LubeLogger vehicle records and reminders (date, mileage, whichever first)  | [Docs home](https://docs.lubelogger.com/), [Reminders](https://docs.lubelogger.com/Records/Reminders)                                                                                                                                                                                                                                     |
| A12 | Anki: note types, card templates, spaced repetition, FSRS                  | [Background](https://docs.ankiweb.net/background.html), [Getting started](https://docs.ankiweb.net/getting-started.html), [Deck options](https://docs.ankiweb.net/deck-options.html)                                                                                                                                                      |
| A13 | Music mix versions (DISCO)                                                 | [Managing mix versions](https://school.disco.ac/article/how-to-manage-mix-versions-and-collaborate-effectively-with-disco). Stage lists: search snippets only, not confirmed.                                                                                                                                                             |
| B1  | Obsidian attachments and accepted formats                                  | [Attachments](https://obsidian.md/help/attachments), [File formats](https://obsidian.md/help/file-formats)                                                                                                                                                                                                                                |
| B2  | VS Code Explorer ("Reveal in Finder", `files.exclude`) and Workspace Trust | [User interface](https://code.visualstudio.com/docs/getstarted/userinterface), [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)                                                                                                                                                                   |
| B3  | Finder tags and Smart Folders                                              | [Tags](https://support.apple.com/guide/mac-help/tag-files-and-folders-mchlp15236/mac), [Smart Folders](https://support.apple.com/guide/mac-help/create-or-change-a-smart-folder-mchlp2804/mac)                                                                                                                                            |
| B4  | Notion "Files & media" property                                            | [Property types](https://www.notion.com/help/database-properties)                                                                                                                                                                                                                                                                         |
| B5  | Google Drive custom file properties                                        | [Properties guide](https://developers.google.com/workspace/drive/api/guides/properties)                                                                                                                                                                                                                                                   |
| B6  | Paperless-ngx document metadata                                            | [usage.md on GitHub](https://raw.githubusercontent.com/paperless-ngx/paperless-ngx/dev/docs/usage.md). (docs site: 403)                                                                                                                                                                                                                   |
| B7  | Electron `shell.showItemInFolder` / `openPath`                             | [shell API](https://www.electronjs.org/docs/latest/api/shell)                                                                                                                                                                                                                                                                             |
| B8  | Browser File System Access API                                             | [Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)                                                                                                                                                                                                                                       |
| B9  | Static serving rules (root, dotfiles ignored by default)                   | [serve-static](https://expressjs.com/en/resources/middleware/serve-static.html)                                                                                                                                                                                                                                                           |
| B10 | OWASP path traversal                                                       | [Path Traversal](https://community.owasp.org/attacks/Path_Traversal)                                                                                                                                                                                                                                                                      |
| B11 | Safe response headers: `Content-Disposition`, `nosniff`, CSP `sandbox`     | [Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition), [nosniff](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options), [CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) |
| B12 | MCP local-server rules (Origin check, bind to localhost)                   | [MCP transports, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)                                                                                                                                                                                                                                   |
| B13 | PDF.js                                                                     | [PDF.js](https://mozilla.github.io/pdf.js/)                                                                                                                                                                                                                                                                                               |

Not confirmed: Firefly III docs (403); a macOS command for "reveal in Finder" from a web server (B2 and B7 show the pattern).

## 2. Each method: core idea and what Pharos does with it

### Scope A — many kinds of projects

**A1 Notion databases.** "Every item you enter into your database is a Notion page." One dataset, many views: table, board, calendar, list, gallery, chart.
BORROW. One record, many views. Pharos already does this with `runQuery`.

**A2 Notion templates.** A template pre-fills properties and page content; repeating templates create a copy on a schedule. The gallery groups finance into budgets, expenses, net worth, debt, taxes, investing.
ADAPT. A pack ships starter records and a layout, not just a schema. Repeating records map to intervals (A11).

**A3 Airtable.** 31 field types; lookup and rollup compute across linked records; currency is "a specific type of number field".
BORROW a small typed field set. ADAPT rollup as a sum computed in blocks.

**A4 Obsidian Bases.** "Each row is a file, and each column is a property." Views: table, list, cards, kanban, map. Data stays in Markdown files.
ADAPT views apart from data. SKIP Markdown storage; SQLite with revisions is Pharos's core.

**A5 Dataview.** Two parts: index metadata, then query it as LIST, TABLE, TASK or CALENDAR. "Dataview is about displaying, not editing."
BORROW. This is Pharos's reader-first stance. A calendar output is worth adding.

**A6 Tana supertags.** "Supertags turn a node into a typed object with a template of fields." A supertag can extend another.
BORROW "a type is fields plus a template". SKIP inheritance chains.

**A7 Capacities.** Fixed basic types (pages, images, PDFs, files) plus custom types with properties, layouts and a type dashboard.
BORROW the split: built-in types Pharos owns (task, finding, file) and custom types defined per project.

**A8 Coda / Superhuman Docs.** Text and tables on one page; many views over one source.
BORROW prose with data. SKIP Packs and automations; they widen scope.

**A9 YNAB.** Ask "What's it for?"; set aside "manageable monthly amounts" for later.
ADAPT. Finance needs categories with a planned amount and a "planned vs spent" block. SKIP envelope logic in the app.

**A10 Actual Budget.** Cards: net worth over time, cash flow, spending, a summary number, a calendar, a text widget.
BORROW the set. It matches Pharos's board of widgets.

**A11 LubeLogger.** Records: service, repair, fuel, odometer, taxes, inspections. Reminders are due "via a due date, a future odometer reading, or whichever comes first", in four bands: not urgent, urgent, very urgent, past due. "Fixed Intervals" keep the anniversary date.
BORROW the interval rule as a general type. Attachments on records: not confirmed.

**A12 Anki.** A note type has fields and card templates (`{{French}}`). Intervals lengthen with each success; FSRS: "Higher retention leads to shorter intervals."
ADAPT: the type decides the layout. SKIP a scheduler; a study pack shows a practice log and links to Anki.

**A13 Music versions.** Name versions clearly and keep "all the various mix versions … in close proximity". Stage lists are not confirmed.
ADAPT. A music pack is a song record with stages (an option list) and a list of file versions. This reuses project files.

### Scope B — project files

**B1 Obsidian attachments.** Attachments "are regular files that you can access using your file system". A setting picks where new ones go. Images, audio, video and PDF embed in notes.
BORROW plain files on disk, never a blob store. Previews: image, PDF, text and Markdown first; audio and video later.

**B2 VS Code.** "Reveal in Finder"; `files.exclude` hides by glob; unknown folders open in Restricted Mode.
BORROW reveal and exclude globs. ADAPT trust: a folder is visible only after the owner adds it.

**B3 Finder.** Many tags per file; a Smart Folder is a saved search, and files stay in place.
BORROW. A file list is a saved query over file records.

**B4 Notion Files & media.** A property holding uploads or links.
ADAPT. Use a `file` entity linked to records, not a property holding many files, so each file has its own metadata and history.

**B5 Google Drive properties.** Key-value metadata on the file; 124-byte limit.
SKIP metadata on files. Keep it in SQLite.

**B6 Paperless-ngx.** Correspondent ("the person, institution or company that a document either originates from, or is sent to"), document type, tags, created vs added date, custom fields, notes.
BORROW this field set. It fits official documents.

**B7 Electron shell.** `showItemInFolder`: "Show the given file in a file manager." `openPath`: open "in the desktop's default manner."
ADAPT. Pharos is a local web server, not Electron. The server can offer "Reveal" and "Open" actions for registered files only. The exact macOS command is not confirmed here.

**B8 File System Access API.** Native picker; access ends when the tab closes; full support only in Chromium.
SKIP: agents and the server need access too.

**B9 serve-static.** Files resolve against a `root`; dotfiles default to `ignore` (404).
BORROW both.

**B10 OWASP.** "Use indexes rather than actual portions of file names." Accept known good, do not sanitize. Normalize before use.
BORROW. URLs carry a file id, never a path.

**B11 Headers.** `attachment; filename*=…` saves with the real name; `nosniff` stops text running as HTML; CSP `sandbox` blocks scripts.
BORROW all three.

**B12 MCP transports.** Servers "MUST validate the Origin header … to prevent DNS rebinding" and should bind to 127.0.0.1.
BORROW, above all for file routes.

**B13 PDF.js.** A web-standards PDF renderer.
ADAPT: use the browser's PDF viewer first; add PDF.js only for thumbnails.

## 3. Synthesis: recommended approach

### Many kinds of projects

**Pattern.** Tools combine built-in types, user-defined types with typed fields, many views over one dataset, and templates bundling all three. Domain apps add one mechanic each: money totals, intervals, spaced review.

**Data model.**

- Keep the current built-in types (task, stage, goal, decision, finding, term). Add two: `record` and `file`.
- A `record` has a `recordType` and `fields`. Record types live in `project.data.recordTypes`, next to `options`, so each project owns its list (as with options today).
- A record type is a name, an icon, and fields. Field kinds: text, number, money (amount + currency), date, option, reference (to any entity), file, meter (a number with a unit, such as km).
- Add an `interval` record type to the core: every N days and/or every N meter units, whichever first, fixed or rolling. It drives "due" for car service, renewals, document expiry and practice.
- Everything still goes through `Store.apply` with revisions.

**Catalog blocks to add.**

- Ledger: a table with a running total and money formatting.
- Log: dated entries, newest first (service log, practice log).
- Calendar: items by date, as in Dataview and Actual.
- Due tracker: interval items with LubeLogger's four urgency bands.
- Progress to target: current vs target (savings goal, practice hours).
- Category breakdown: totals by an option field, with "planned vs actual".
- Trend: a value over time (net worth, odometer, scores).
- File list (see below).

**What a domain pack holds.** Data, not code: record types and fields; option lists; board specs for an overview; interval templates (oil change every 10,000 km or 12 months); a short agent guide (what to ask, which fields matter); optional example records. Applying a pack is one `apply`; reverting undoes it. Starters: finance, vehicle, music, study.

### Project files

**Model.** A `file` entity: title, `rootId`, relative path, size, modified time, SHA-256, mime type, kind (option: statement, receipt, contract, certificate, manual, audio, other), issuer (Paperless "correspondent"), issued date, expiry date, tags, notes, links to records. Files stay where they are (Finder Smart Folder model). The hash lets Pharos find a moved file.

**Roots.** The owner adds folder roots in Settings. Like the agent pause, they are app settings: no agent or API call can add one.

**Views.** A file list block filtered by kind, tag, issuer, expiry. A file card: preview (image, PDF, text, Markdown), metadata, linked records. Expiry dates feed the due tracker.

**Hand on.** Download (real file name), Reveal in Finder, Copy path. Reveal runs on the server, for registered files only.

**Safety rules.**

1. Read-only. No upload, rename or delete through Pharos in the first version.
2. URLs use the file id. The server maps id → root + relative path (OWASP indexes).
3. Resolve the real path, following symlinks, and reject it unless it is inside its root.
4. Never serve dotfiles, and skip `.env`, keys, `.ssh`, and `files.exclude`-style globs when scanning.
5. Keep binding to 127.0.0.1 and check `Origin` on file routes (MCP rule).
6. Send `nosniff`, `CSP: sandbox`, and a mime type from an allowlist. Show PDF, images and plain text inline. Send everything else, including HTML and SVG, as `attachment`.
7. Agents see metadata and link files. Reading contents over MCP is a later decision.
