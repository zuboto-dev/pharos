import {
  BOARD_GUIDE,
  COMPONENT_INFO,
  FILE_TEXT_TOOL,
  PACK_GUIDE,
  REPORT_LIMITS,
  similarAnswers,
  type ComponentName,
  type Entity,
} from '@pharos/schema';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AgentFiles } from './store/agent-files.js';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { evidenceState, projectFreshness } from './views/freshness.js';
import { isExpired, requestContext } from './views/service.js';

/**
 * Guidance for agents as MCP resources and prompts, so clients can load it without a tool call.
 * The same rules back the catalog tools; this adds the judgement about what makes a good view.
 */
/**
 * How to write a report page (R13): returned by report_guide and served as
 * pharos://guide/reports. docs/reframe/r13-report-pages.md has the contract.
 */
/**
 * What an MCP request can carry (R13.6): the HTTP transport refuses bodies over 4 MB, and base64
 * adds a third, so files over ~3 MB go over REST instead. Said in report_asset_put, its error and
 * the report guide.
 */
export const MCP_ASSET_NOTE =
  'Over MCP keep each file under 3 MB: a request carries at most 4 MB and base64 adds a third. Upload a larger file (up to 10 MB) over REST instead: PUT /api/views/<viewId>/page/<path> on this Pharos server (the host and port of /mcp), the raw file as the body, with the header X-Pharos-Author: agent:<your name>.';

/**
 * The worked example in the report guide's "Report documents" section (R14). Kept as data so a
 * test can check it is a valid document that previews without warnings.
 */
export const DOC_EXAMPLE = {
  summary: 'Groceries rose every month from July to September while rent stayed the same.',
  data: { spend: { type: 'record', filter: { where: { recordType: 'spending' } } } },
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content:
          '# Groceries climbed every month\n\nWe spent **${total}** across ${count} receipts; groceries were ${groceries} of it. (Source: the spending records in this project.)',
        values: {
          total: {
            sum: {
              query: { type: 'record', where: { recordType: 'spending' } },
              field: 'fields.amount',
            },
          },
          count: { count: { type: 'record', where: { recordType: 'spending' } } },
          groceries: {
            sum: {
              query: {
                type: 'record',
                where: { recordType: 'spending', 'fields.category': 'Groceries' },
              },
              field: 'fields.amount',
            },
          },
        },
      },
    },
    {
      kind: 'columns',
      id: 'numbers',
      columns: [
        [
          {
            kind: 'block',
            id: 'spent',
            node: {
              component: 'Stat',
              label: 'Spent',
              query: { type: 'record', where: { recordType: 'spending' } },
              sum: 'fields.amount',
              caption: 'All spending records',
            },
          },
        ],
        [
          {
            kind: 'block',
            id: 'groceries',
            node: {
              component: 'Stat',
              label: 'Groceries',
              query: {
                type: 'record',
                where: { recordType: 'spending', 'fields.category': 'Groceries' },
              },
              sum: 'fields.amount',
              caption: 'Records in Groceries',
            },
          },
        ],
        [
          {
            kind: 'block',
            id: 'receipts',
            node: {
              component: 'Stat',
              label: 'Receipts',
              query: { type: 'record', where: { recordType: 'spending' } },
              caption: 'One record per receipt',
            },
          },
        ],
      ],
    },
    {
      kind: 'block',
      id: 'by-month',
      node: {
        component: 'CountChart',
        title: 'Groceries cost more each month',
        query: {
          type: 'record',
          where: { recordType: 'spending', 'fields.category': 'Groceries' },
        },
        by: 'fields.date',
        bucket: 'month',
        sum: 'fields.amount',
      },
    },
    {
      kind: 'drawing',
      id: 'dots',
      reads: ['spend'],
      height: 120,
      caption: 'Each receipt as a dot, by day',
      html: '<!doctype html><style>:root{--dot:#c2410c}[data-theme=dark]{--dot:#fb923c}body{margin:0}</style><svg id="s" width="100%" height="110"></svg><script>pharos.data("spend").then((rows) => { const s = document.getElementById("s"); s.innerHTML = rows.map((r, i) => `<circle cx="${8 + i * 14}" cy="55" r="5" fill="var(--dot)"/>`).join(""); });</script>',
    },
    {
      kind: 'block',
      id: 'honest',
      node: {
        component: 'Callout',
        tone: 'info',
        body: "**What this doesn't say:** cash isn't recorded, and three months is too short to call a trend; an October below September would undo the claim.",
      },
    },
  ],
};

export const REPORT_GUIDE = `# Writing a Pharos report

Two ways to write a report, both read live data and are marked out of date when it changes:

- **A report document** (\`doc\`): the default for a report. You write the structure (blocks in
  reading order); Pharos draws it as a well-set document in its own style, light and dark, at any
  width. Use it for an explanation, research, a summary of work, "what we found".
- **A report page** (\`page\`): a whole HTML page you design yourself. Only when the whole page
  needs a design no document can give (a bespoke interactive, its own visual world).
- For one visual no component can draw (a map, a custom diagram), use a drawing block inside a
  document, not a whole page.
- Use a board (widgets) for a live working page the owner uses day to day (tasks, money this
  month, files, quick answers).

## The glance test

The reader should know where they stand in one glance. Check every report against these five:

1. **Its own visual world**: a palette, a type pairing and one motif that fit the subject, not
   the Pharos look. For a report page and a drawing; a document is drawn in Pharos's style, so
   it gets its look from the other four.
2. **The claim and 3–5 key numbers first**: a heading that states the claim, then the numbers.
3. **Headings are claims, not topics**: "Groceries climbed every month", not "Spending".
4. **Interactives only where they answer the reader's question**: a slider, a toggle, a filter,
   a simulator (in a document, a drawing). Never one for show.
5. **A source on every number, and an honesty box**: say what each number counts and where it
   comes from; then what the evidence doesn't show, and what would change the conclusion.

It fails if it is either of these:

- **A results view that proves what the workers did**: logs, scoreboards, who did what. That is
  a pile of words about the work; explain the subject to the reader instead.
- **A three-column table of full sentences with no TLDR at the top**. Lead with the claim and
  numbers; keep cells short.

## Report documents

- view_create {projectId, name, doc: {blocks, data?, summary}, message}. view_update {viewId,
  expectedRevision, doc, message} replaces the whole document (send it whole); view_get shows it.
- Blocks, in reading order, each with a stable \`id\`:
  - \`{kind: "block", id, node}\`: any catalog component. Prose is a Text node: Markdown with
    live values (\`\${total}\` from \`values\`: count, sum, percent, bar), so numbers stay right.
    Headings are Markdown headings in Text. Callout for the honesty box or a key message; Stat
    for one number; CountChart, DataTable, Timeline and the rest read data with queries.
  - \`{kind: "columns", id, columns: [[blocks], [blocks]], widths?: [2, 1]}\`: 2–4 columns side by
    side (one column on a phone), e.g. a row of Stats. No columns inside columns.
  - \`{kind: "drawing", id, html, reads: ["spend"], height, caption?}\`: HTML for one section,
    in the same locked frame as a report page; \`pharos.data(name)\` gives only the named reads
    it lists (from doc.data). Use colour tokens with a [data-theme=dark] set.
  - \`{kind: "embed", id, url: "https://…", caption?, height?}\`: another site shown in place,
    with a link to open it (many sites refuse to be framed).
- \`width\`: "text" (the reading column; default for Text, Markdown, Callout), "wide" (charts and
  tables; default for the rest) or "full".
- \`data\`: named reads for drawings only: {"spend": {"type": "record", "filter": {"where": {…}}}}.
- No titles on every block, no cards, no grid: it reads top to bottom like an article. For the
  glance test: the claim in a Text heading, its key numbers as a row of Stats (a caption says
  what each counts), claim headings and chart titles, an honesty Callout; and a summary of one
  or two sentences.
- view_preview {projectId, doc} checks a draft: what each block shows now (empty ones, unknown
  fields, query problems), each drawing (files, blocked hosts, navigation, reads), embeds that
  aren't https, and reads missing from data. Fix every warning before you say it is ready.
- Example (made-up spending records):

\`\`\`json
${JSON.stringify(DOC_EXAMPLE)}
\`\`\`

## Report pages: when to write one

- A report page is a whole HTML document you write, with its own look, story and
  interactives, shown in a locked frame beside the project with live data through named reads.
  Write one only when the whole page needs a design a document can't give; otherwise write a
  document.

## How it fits

- view_create {projectId, name, page: {html, data, summary}, message}. view_update {viewId,
  expectedRevision, page, message} replaces the whole page; view_get shows it and its assets.
- data: named reads, {"spend": {"type": "record", "filter": {"where": {"recordType": "spending"}}}}.
  The same filters as blocks, checked the same way; at most ${REPORT_LIMITS.reads}.
- In the page, \`await pharos.data("spend")\` returns the rows: items as {id, type, data} (a record's
  values are in data.fields; money is {amount in cents, currency}).
  \`pharos.onData(fresh => …)\` runs again when the project data changes (fresh: rows by name).
- \`pharos.theme\` is "light" or "dark" and \`pharos.onTheme(cb)\` tells you when it changes; Pharos
  also sets data-theme on <html>. \`pharos.openFile(fileId)\` opens a project file in the viewer.
- Pictures, fonts and scripts you ship are assets: report_asset_put {viewId, path, base64} after
  the page is saved, then refer to them relatively ("img/map.svg"). Types: png jpg gif webp avif
  svg css js json woff woff2 ttf otf mp4 webm; 10 MB each, 64 MB per page. ${MCP_ASSET_NOTE}
- The frame has no network: no fetch, no forms, no other sites. Allowed: scripts from
  cdnjs.cloudflare.com, cdn.jsdelivr.net and unpkg.com, Google Fonts.
- Sources are plain links, \`<a href="https://…">\`: they open through Pharos in a new tab (a link
  with a query or a long path asks the reader first, showing where it goes). From a script, use
  \`pharos.openLink(url)\`. Never navigate the page: no location.href = …, window.open or meta
  refresh; Pharos refuses them and stops the page.
- view_preview {viewId} (or {projectId, page} for a draft) checks the size, the reads (rows now,
  query findings), assets the HTML names that aren't uploaded, hosts the frame will block, and
  scripts that would navigate the page.

## Write it well

- Pass the glance test (above): its own visual world, the claim and 3–5 key numbers first,
  claim headings, a source on every number, an honesty box, interactives only where they answer.
- Live numbers come from pharos.data, never typed into the HTML when the project has them.
  Charts drawn in SVG or canvas from the rows.
- Real pictures with credits (as assets, or data: URLs).
- Colour tokens on :root with a dark set under [data-theme=dark]; check both.
- Works at 390 px wide: one column, no horizontal scroll, tap targets of 44 px.
- A summary (one or two sentences: what the page says), shown in lists and to agents.

## Skeleton

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg: #fbf7f0; --ink: #1d1a16; --accent: #c2410c; --muted: #6b6257; }
  [data-theme=dark] { --bg: #16130f; --ink: #f3ece2; --accent: #fb923c; --muted: #a39686; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.55 Georgia, serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px; }
  .num { font: 600 2.4rem/1 system-ui, sans-serif; color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Groceries took a third of September's spending</h1>
  <p><span class="num" id="total">…</span> spent, from <span id="count">…</span> records.</p>
  <aside><strong>What this doesn't say:</strong> cash payments aren't recorded.</aside>
</main>
<script>
  const euros = (cents) => (cents / 100).toLocaleString('en', { style: 'currency', currency: 'EUR' });
  async function render() {
    const rows = await pharos.data('spend');
    const total = rows.reduce((n, r) => n + (r.data.fields.amount?.amount ?? 0), 0);
    document.getElementById('total').textContent = euros(total);
    document.getElementById('count').textContent = rows.length;
  }
  render();
  pharos.onData(render);
</script>
</body>
</html>
\`\`\`

with page.data = {"spend": {"type": "record", "filter": {"where": {"recordType": "spending"}}}}.
`;

export const VIEW_GUIDELINES = `# Designing Pharos views

Pharos shows a project as views made of widgets. People read views instead of long text, so a
good view replaces a paragraph you would otherwise write.

## Pick the kind of view
- **Answer view** (view_answer): someone asked a question. It expires after a week unless kept.
- **Saved view** (view_create): an angle someone will come back to (a release, a weekly check-in).
- **Edit** an existing view (view_update) when they ask to change "the board" or "the overview".

## Shape
1. **Lead with the answer.** The first widget says it in one or two sentences: a Text with live
   numbers, or a Callout when it is a warning, blocker, or recommendation. (Asked to explain or
   compare? Write a report document instead: report_guide, then view_answer with doc.)
2. **Then the evidence**, most important first: the table, chart, or list that proves the answer.
3. **One question per view, 3–8 widgets.** If you need more, it is two questions.
4. **Widths in a row add up to 12.** Typical rows: 12 · 6+6 · 4+8 · 3+3+3+3 (stats).
   Never go below a component's minColumns.

## Choosing components
- Prefer domain components when they fit: KanbanBoard (work by status), StageTracker and
  Timeline (where and when), GoalTree and ScopeBoard (why and what), DependencyGraph (what waits
  on what), DecisionLog (what was decided).
- Use the generic tier when you need a specific field or type: DataTable (chosen columns),
  CountChart (distribution), Stat (one number), DataList (short list), Text (sentence with numbers).
- Filter instead of copying: never put counts or names into text by hand; use Text values or a
  query so the view stays right as the project changes.

## Report pages: start here
A report page tells the reader about work: what was done, what was found, or what needs them.
Any view with a StartHere, ClaimCard or Layers is a report page, and its preview checks the rules
marked "checked"; task boards and other views without them are not checked.

- **One purpose, one opening** (checked): a StartHere comes first, full width, with purpose
  "done", "found" or "needs-you". Two purposes are two views.
- **Why first** (checked): \`why\`, one line under 100 characters on what the work is for or the
  question it answers ("To measure whether a new reader understands a Pharos page without help").
  The reader needs to know why the work exists before what it produced.
- **Headline** (checked): the outcome in one sentence with a verb, under 160 characters. Back it:
  on a found page set \`claim\` (its statement, mark and sources show); otherwise list \`evidence\`
  ids (artifacts such as test results and links, tasks, decisions), or \`{id, label}\` with a
  short label (24 characters or fewer) instead of renaming the artifact.
- **The reader's part, once** (checked): \`yourPart\`, one line under 120 characters, even when it
  is "Nothing now." ("Nothing now. When G1 resumes: approve the 3 test cases and targets."). No
  other widget says what the reader has to do: no "Your part" card, no "nothing needs you" in text.
- **Where it sits** (checked): \`stageId\` or \`goalId\`, and \`date\`; the project is shown for you.
- **Reading path** (checked): 2–4 steps, each a label saying what the reader finds there ("How it
  was checked", never "More"), a \`says\` line, and a \`target\`: the id of a widget on this board.
  Detail opens on request, two levels at most: step, then the widget and what it opens.
- **Short** (checked): about 150 words on the page before the reader opens anything (StartHere,
  text blocks, claim statements and details on cards, layer labels; data tables don't count), and
  at most 25 words on one card. Cut repeats and background; put the rest behind a tap.
- **One item per line**: a list of findings reads as one column, one short line each, with details
  on tap (full-width cards or a Layers stack). Cards side by side only for short items: numbers,
  labels. The preview warns when a row puts 3 or more wordy claim cards (over 12 words) side by side.
- **Few underlines** (checked): a term only for a word a non-specialist wouldn't know, never an
  everyday phrase like "test case"; at most 5 underlined terms on a page.
- **Then, by purpose.** Done: what changed (show it), how it was checked (with links), what is left.
  Found: why it matters in one line, 3–5 findings with sources (one per line), how sure and what is
  unknown.
  Needs you (set \`due\`): the decision, the options with what each leads to, your recommendation
  and why, and a way to answer: a DecisionBlock (see "Decisions for the reader" below), or Ask.

## Decisions for the reader
When the reader has to choose, store the choice on a decision and show it in a DecisionBlock:
- Create the decision with \`title\` (the question), \`options\` (2–5, each \`{id, label, summary,
  pros, cons, claimIds}\`: a short label, what it leads to in one line, pros and cons in a few
  words each, and the claims that back it as sources), \`recommendedOptionId\` and
  \`recommendationReason\` (one line). It stays "proposed" until the reader answers.
- Only the reader chooses, writes another answer or decides later; Pharos refuses
  \`chosenOptionId\`, \`answer\` and \`deferredUntil\` from agents, and an "accepted" status on a
  decision with options. Read the answer back from the decision (project_snapshot shows it).
- The page: a StartHere with purpose "needs-you", \`due\`, and \`yourPartTarget\` set to the
  DecisionBlock's widget id ("Choose an empty state by Friday"), then the DecisionBlock, full
  width. The preview warns about fewer than 2 options and a recommendation without a reason.
  Once answered, the block shows the answer and DecisionLog lists it.

## Explanation views
Use one when the reader needs to understand something (research, a concept, what a result
means) rather than track work. It is a found report page, so it starts as above, and the preview
also checks the rules marked "checked" here.

1. **The point first, in one short sentence** (checked): a StartHere with purpose "found" and
   \`claim\` set to the headline claim opens the view (on its own, a ClaimCard with size "headline"
   also states the point). At most 30 words of text and no other block may come before it.
2. **Then the picture**: right under the point, Layers shows how the parts fit (a stack the reader
   taps open, steps in a row, or a flow of boxes), before any list or long text. See "Pictures".
3. **Every claim stored and sourced** (checked): each finding is a claim record (one finding, one
   plain sentence) with checkedOn, sourceIds and authorId. Views show claims by id or tag and
   never copy their words. "From source" only with a linked (http/https) source you read and
   checkedOn; otherwise keep "Our reading". "Confirmed by you" only after the owner accepts a
   decision in Pharos: create it with status "proposed" (the default, "accepted", can't back it).
   Give "From source" its quote, the passage word for word (quoteSourceId if it has several
   sources), and "Our reading" its assumption, so the reader sees what each rests on.
4. **Terms explained in place**: store a word a non-specialist wouldn't know as a term (word,
   explanation, alsoCalled); not everyday words. Pharos marks its first use in each widget and
   explains it on tap.
5. **Certainty visible**: every claim shows its mark (Our reading, From source, Confirmed by you).
   Don't word a reading as a fact; a clean view must not look surer than the research.
6. **Detail on demand**: put more in a claim's detail, in layers the reader opens, and in a sources
   list at the bottom, not in text up front.

The preview also warns about a claim id that isn't in the project and a layer whose items match
nothing. These are warnings, not refusals: fix them before you say the view is ready. Worked
example: "Explaining" in pharos://examples/answers.

## Pictures
Less words, more pictures: a picture replaces a paragraph. Every picture reads stored claims or
project queries; the view holds ids, tags, filters and short labels, never a finding's words or
numbers. Labels go on the picture, not in a paragraph beside it. Pictures don't underline terms
unless \`terms: true\`. Every item opens to its claim's mark, quote and source.

- **A process: Layers \`orientation: "flow"\`** (checked): 2–5 boxes joined by arrows, each label
  under 30 characters ("Your question", "AI arranges blocks", "Pharos draws the screen"), with
  its pill colour. A tapped box opens its claims below the row. A step may leave \`items\` out and
  be a label only. Use it instead of columns of sentences.
- **Where each part stands: a layer's \`progress\`** (checked): a task where per step, e.g.
  {"stageId": "stg_1"}, draws a bar and "2 of 9" on one scale for every step (cancelled left out);
  tapping it lists the step's open tasks without work codes.
- **What changed: BeforeAfter** (checked): two claims whose \`quote\` is the passage before and
  after, word for word, each with \`locator\` (file and line, or commit) and its source;
  \`claim\` states the change in 15 words or fewer; \`beforeLabel\`/\`afterLabel\` such as a commit
  and "main". About 40 words in all: quote only the lines that changed.
- **A number-backed finding: FindingChart** (checked): the title is the stored \`claim\` stating
  the finding (15 words or fewer), never free \`title\` text. Bars from claims with \`bars\` (each
  claim's \`figure\` {value, unit, label} is one bar; on "From source" the value must appear in the
  quote) or from a query with \`count\` ({query, by}). 2–12 bars, one unit, one \`highlight\`.
- **What it looks like: Gallery** (checked): research about anything visual (UI, products,
  places, cars, diagrams) shows its examples as pictures, never only as words. Store each example
  as an artifact with \`image\` (an https address of the picture, or the id of a project image
  file from project_snapshot.files), \`alt\` (what it shows, one sentence), \`uri\` (the page it
  comes from; its host shows under the picture) and a shared tag in \`tags\`, then add a Gallery
  with \`artifacts\` {"where": {"tags": "<tag>"}}. Use \`layout: "compare"\` with exactly two
  pictures for before/after or option A/B (\`highlight\` the one you recommend), "grid" for a
  set of examples, "strip" for a row the reader scrolls; \`claim\` heads it with the finding the
  pictures show. Only https pictures load; the preview warns about a gallery with no matching
  pictures, missing alt text and images that aren't https.
- **Shares at a glance: mini bars**: StatCards with \`of\` draw a word-sized bar; in Text, a value
  \`{bar: {query, of}}\` draws one inline.
- **How strong the evidence is**: the mark shows how many sources back a claim, or "no source
  yet". Set a claim's \`weakBecause\` ("one-source", "indirect", "disagree") when it is thin.
- **Work codes**: on a report page, TaskTable and DataList take \`hideCodes: true\` so
  "W3.8 · Measure the baseline" reads "Measure the baseline".

## Document sets
When the owner asks you to manage a set of documents ("make a view to manage the company's
documents and link everything related"), bring the files into Pharos, link what they belong to,
and give the set one view.

1. **Get the folder**: project_snapshot.files lists the files already in the project. If the
   documents aren't there and no shared folder holds them (files_unadded is empty), ask for their
   folder once with folder_request {path, level: "details" (or "contents" when you must read
   .txt/.csv/.md text), reason: one plain sentence, projectId}. Tell the owner in one line to
   click Approve in Pharos, then wait: check with folder_request_status. Never approve it
   yourself, never ask again for a declined folder, and don't read the folder on disk yourself.
2. **Add the files**: files_unadded lists what you can add (folderId, path, name, size, type).
   In one apply, create each one ({op: "create", type: "file", ref: "f1", data: {projectId,
   rootId: <folderId>, path, title, kind, tags}}; the scan fills in the rest) and update it in
   the same apply ("$f1") with \`issuer\`, \`issuedDate\` and \`expiryDate\` (YYYY-MM-DD) when the
   document or the owner states them, a shared tag for the set (e.g. "business-registration") and
   its \`kind\` (certificate, contract, statement, …). Leave a date empty rather than guess. You
   can't remove or move files.
3. **Link what is related**: set \`fileIds\` on the tasks, decisions, goals, stages and claims a
   file belongs to (a renewal task → the letter it renews; a decision → the notice that records
   it). Create the task or decision if it doesn't exist yet. Sources (artifacts) may keep a path
   relative to the approved folder in \`uri\` ("business-registration/company-seal.png"); Pharos
   links them to the file once it is added. Queries find linked items: {"fileIds": "<file id>"}.
4. **Compose the view** (view_create): a StartHere (purpose "done", or "needs-you" with \`due\`
   when a paper expires soon), a FileList filtered to the tag, and the linked work: a TaskTable
   and a DecisionLog (or a DataList) filtered to the linked items, which show their files as
   small links. A FileList alone is enough: it shows each file at a glance (icon, name, the one
   date that matters), and tapping one opens it in the file viewer (preview, actions, details on
   request, ← → through the list). Add a FileView only when one key document should always be on
   the page (\`file\`: its id; \`size: "compact"\` at 5–6 columns beside a 6–7 column list, or
   full width below it); then give the FileList \`showIn\` set to the FileView's id so a tapped
   row shows there instead, and linked files open there too. When a paper has an expiry date, add a FileList filtered to
   {"tags": "<tag>", "expiryDate": {"exists": true}} with \`details: ["expiryDate"]\` so the
   dates show as badges, or a DueTracker over {"type": "file", "where": {"tags": "<tag>",
   "expiryDate": {"exists": true}}} to sort them by urgency (60 days counts as urgent; the
   project page also reminds the owner). The preview warns when a FileView's file isn't in the project or
   \`showIn\` names no FileView.

Example board (ids from project_snapshot.files):
[{"id": "start", "node": {"component": "StartHere", "purpose": "done", "why": "Keep the company's registration papers in one place", "headline": "The four registration papers are tagged and one tap away.", "yourPart": "Nothing now. Renew the tax registration before it expires.", "evidence": ["<certificate file id>"], "date": "<YYYY-MM-DD>", "path": [{"label": "The papers", "says": "Tap one to read it", "target": "papers"}, {"label": "Linked work", "says": "The tasks and decisions they belong to", "target": "work"}]}},
 {"id": "papers", "node": {"component": "FileList", "title": "Registration papers", "filter": {"where": {"tags": "business-registration"}}}},
 {"id": "work", "w": 6, "node": {"component": "TaskTable", "title": "Linked tasks", "filter": {"where": {"fileIds": ["<file ids of the set>"]}}, "columns": ["status", "dueDate"]}},
 {"id": "decisions", "w": 6, "node": {"component": "DecisionLog", "title": "Linked decisions", "filter": {"where": {"fileIds": ["<file ids of the set>"]}}}}]

## Queries that answer common questions
- Overdue: {dueDate: {lt: "$today"}, status: {not: ["done", "cancelled"]}}
- Due this week: {dueDate: {gte: "$today", lte: "$today+7d"}}
- Late stages' work: {"stage.targetDate": {lt: "$today"}, status: {not: "done"}}
- Blocked or overdue: anyOf [{status: "blocked"}, {dueDate: {lt: "$today"}, status: {not: ["done", "cancelled"]}}]
- Current stage: {stageId: "$currentStage"}
- High priority and up: {priority: {gte: "high"}}

## Before you say it is ready
- Read the preview that view_answer, view_create, and view_update return (or run view_preview on
  a draft). Fix unknown fields, unintended empty widgets, width warnings, and the view-level
  warnings of an explanation view. An empty widget is fine only when "nothing" is the answer, and then
  say so in the headline.
- Empty blocks explain themselves: the page shows what's missing and the next step, with a button
  the reader can use (Add task, Add files, Record a decision, Ask an agent). Don't add a Text or
  Callout saying "nothing here yet"; a question asked from an empty block arrives prefilled, so
  answer it by adding the missing data, not by changing the view.
- In chat, keep it short: one or two sentences with the answer and the link. The view carries the detail.
`;

/** Question → good answer view pairs, used as worked examples. */
export const EXAMPLES: { question: string; why: string; widgets: unknown[] }[] = [
  {
    question: "What's overdue?",
    why: 'Headline with the count, then the overdue tasks with who has them and how late.',
    widgets: [
      {
        id: 'headline',
        node: {
          component: 'Text',
          content: '**${late}** tasks are overdue; **${soon}** more are due this week.',
          values: {
            late: {
              count: {
                type: 'task',
                where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
              },
            },
            soon: {
              count: {
                type: 'task',
                where: {
                  dueDate: { gte: '$today', lte: '$today+7d' },
                  status: { not: ['done', 'cancelled'] },
                },
              },
            },
          },
        },
      },
      {
        id: 'late',
        node: {
          component: 'DataTable',
          title: 'Overdue',
          query: {
            type: 'task',
            where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } },
            sort: [{ field: 'dueDate' }],
          },
          columns: [
            { field: 'title' },
            { field: 'dueDate', label: 'Due' },
            { field: 'assigneeId', label: 'Who' },
            { field: 'stage.name', label: 'Stage' },
          ],
        },
      },
    ],
  },
  {
    question: "What's blocking the current stage?",
    why: 'A Callout names the bottleneck; the dependency graph shows why; progress gives context.',
    widgets: [
      {
        id: 'answer',
        node: {
          component: 'Callout',
          tone: 'warning',
          title: 'Bottleneck: <task>',
          body: 'Explain what waits on it, in one or two sentences.',
        },
      },
      {
        id: 'progress',
        w: 4,
        node: {
          component: 'ProgressRing',
          title: 'Current stage',
          where: { stageId: '$currentStage' },
        },
      },
      {
        id: 'open',
        w: 8,
        node: {
          component: 'TaskTable',
          title: 'Not done yet',
          filter: { where: { stageId: '$currentStage', status: { not: ['done', 'cancelled'] } } },
          columns: ['status', 'assignee', 'dependsOn'],
        },
      },
      {
        id: 'order',
        node: {
          component: 'DependencyGraph',
          title: 'What waits on what',
          filter: { where: { stageId: '$currentStage' } },
        },
      },
    ],
  },
  {
    question: 'Who is working on what?',
    why: 'Workload by person, then the board grouped by assignee.',
    widgets: [
      {
        id: 'load',
        w: 6,
        node: {
          component: 'CountChart',
          title: 'Open tasks per person',
          query: { type: 'task', where: { status: { not: ['done', 'cancelled'] } } },
          by: 'assigneeId',
          sort: 'count',
        },
      },
      { id: 'matrix', w: 6, node: { component: 'AssigneeMatrix', title: 'By status' } },
      {
        id: 'board',
        node: {
          component: 'KanbanBoard',
          title: 'Work by person',
          groupBy: 'assignee',
          filter: { where: { status: { not: ['done', 'cancelled'] } } },
        },
      },
    ],
  },
  {
    question: 'Are we on track?',
    why: 'Overall progress and the schedule, with the stages at risk called out.',
    widgets: [
      {
        id: 'headline',
        node: {
          component: 'Text',
          content: '**${pct}** done overall; current stage **${stage}** is due **${due}**.',
          values: {
            pct: {
              percent: {
                query: { type: 'task', where: { status: 'done' } },
                of: { type: 'task', where: { status: { not: 'cancelled' } } },
              },
            },
            stage: { project: 'currentStage' },
            due: { project: 'currentStageTarget' },
          },
        },
      },
      { id: 'stages', node: { component: 'StageTracker', title: 'Stages' } },
      { id: 'timeline', node: { component: 'Timeline', title: 'Schedule' } },
    ],
  },
  {
    question: 'What did we decide about <topic>?',
    why: 'Text search over decisions, newest first.',
    widgets: [
      {
        id: 'decisions',
        node: {
          component: 'DecisionLog',
          title: 'Decisions about <topic>',
          filter: { where: { title: { contains: '<topic>' } } },
        },
      },
    ],
  },
];

/**
 * A worked explanation view: the start-here opening (stating the headline claim), the picture,
 * two takeaways, then the sources. Ids in
 * angle brackets stand for claims the agent stores first (tags pick a layer's claims).
 */
export const EXPLAIN_EXAMPLE: {
  question: string;
  why: string;
  claims: string;
  widgets: unknown[];
} = {
  question: 'What is <topic>, and where does this project stand?',
  why: "StartHere opens it: purpose, why the work exists, the headline claim with its mark and sources, the reader's part in one line, where it sits, and a path to the parts below; the layers show how the parts fit, each holding its claims (the reader opens one at a time); two short cards say what it means; the sources list lets the reader check. About 150 words before anything the reader opens.",
  claims:
    'First store, with apply, the claims (statement, checkedOn, sourceIds, quote or assumption, authorId, tags such as "layer-2") and terms the view shows; the ids below are theirs.',
  widgets: [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'found',
        why: '<what the work is for, or the question it answers, in one line>',
        claim: '<headline claim id>',
        yourPart: '<what the reader has to do, in one line; "Nothing now." when nothing>',
        stageId: '<stage id>',
        date: '<YYYY-MM-DD>',
        path: [
          { label: 'How it is built', says: 'Three layers; tap one to open it', target: 'layers' },
          { label: 'What it means for us', says: 'What to keep and what to build', target: 'keep' },
          { label: 'Where it comes from', says: 'Every source, linked', target: 'sources' },
        ],
      },
    },
    {
      id: 'layers',
      node: {
        component: 'Layers',
        title: 'How it is built',
        prompt: 'Tap a layer to see what is in it.',
        open: '2',
        legend: [
          { tone: 'own', label: 'We have it' },
          { tone: 'gap', label: 'Nobody offers it' },
        ],
        layers: [
          {
            key: '3',
            title: '<top layer name>',
            hint: '<what it does, in one line>',
            pill: { label: 'We have it', tone: 'own' },
            items: { where: { tags: 'layer-3' } },
          },
          {
            key: '2',
            title: '<middle layer name>',
            hint: '<what it does, in one line>',
            pill: { label: 'Nobody offers it', tone: 'gap', claim: '<gap claim id>' },
            highlight: true,
            items: { where: { tags: 'layer-2' } },
          },
          {
            key: '1',
            title: '<bottom layer name>',
            hint: '<what it does, in one line>',
            items: { where: { tags: 'layer-1' } },
          },
        ],
      },
    },
    {
      id: 'keep',
      w: 6,
      node: { component: 'ClaimCard', claim: '<keep claim id>', kicker: 'Keep', tone: 'own' },
    },
    {
      id: 'build',
      w: 6,
      node: { component: 'ClaimCard', claim: '<build claim id>', kicker: 'Build', tone: 'gap' },
    },
    {
      id: 'sources',
      node: {
        component: 'DataList',
        title: 'Sources',
        query: { type: 'artifact', where: { kind: 'link' } },
        secondary: ['uri'],
      },
    },
  ],
};

function examplesMarkdown(): string {
  return [
    '# Example answer views',
    '',
    'Question → widgets that answer it well. Adapt titles, filters, and texts to the project.',
    ...EXAMPLES.flatMap((e) => [
      '',
      `## ${e.question}`,
      '',
      e.why,
      '',
      '```json',
      JSON.stringify(e.widgets, null, 2),
      '```',
    ]),
    '',
    `## Explaining: ${EXPLAIN_EXAMPLE.question}`,
    '',
    EXPLAIN_EXAMPLE.why,
    EXPLAIN_EXAMPLE.claims,
    '',
    '```json',
    JSON.stringify(EXPLAIN_EXAMPLE.widgets, null, 2),
    '```',
  ].join('\n');
}

function catalogMarkdown(): string {
  return [
    '# Pharos component catalog',
    '',
    BOARD_GUIDE,
    '',
    ...(Object.keys(COMPONENT_INFO) as ComponentName[]).map(
      (name) =>
        `- **${name}** (${COMPONENT_INFO[name].category}, min ${COMPONENT_INFO[name].minColumns} cols): ${COMPONENT_INFO[name].use}`,
    ),
    '',
    'Use the catalog_describe tool for each component’s exact props.',
  ].join('\n');
}

function text(uri: string, body: string, mimeType = 'text/markdown') {
  return { contents: [{ uri, mimeType, text: body }] };
}

/** What kind of report a view is (R13 page, R14 document), or null for a board. */
const reportKind = (store: Store, viewId: string | undefined) => {
  const view = viewId ? store.get(viewId) : null;
  const data = view?.type === 'view' ? (view as Entity<'view'>).data : null;
  return data?.page ? 'report page' : data?.doc ? 'report document' : null;
};

/** For a refresh request (R11): what changed in the data since the answer was written. */
function refreshContext(store: Store, request: Entity<'request'>): string[] {
  const view = request.data.viewId ? store.get(request.data.viewId) : null;
  if (view?.type !== 'view') return [];
  // Worked out as agents see the data: nothing of hidden files, no withheld fields (R7.5).
  const files = new AgentFiles(store);
  const evidence = projectFreshness(store, request.data.projectId, { view: view.id, files }).views[
    view.id
  ]?.evidence;
  if (!evidence || !('stale' in evidence))
    return ['  Its evidence is unknown: rebuild it from the data now.'];
  const items = (evidence.stale?.recent ?? [])
    .flatMap((c) => c.items)
    .filter((i) => files.visible(i.id))
    .slice(0, 8)
    .map((i) => `${i.type} ${i.label ? `"${i.label}" ` : ''}(${i.id}, ${i.op}d)`);
  const calendar = evidence.stale?.calendar;
  return [
    `  Written from the data at revision ${evidence.revision}; changed since: ${items.length ? items.join(', ') : 'see history_diff from that revision'}.`,
    calendar
      ? `  It was written on ${calendar.from}; today (${calendar.to}) its date-based blocks show other items.`
      : '',
  ].filter(Boolean);
}

/**
 * Words that ask to explain, report on or compare something, rather than look a status up. A
 * report is asked for by "report on" or "write a report": "which reports are due?" is a lookup
 * of report records (R4 review).
 */
const REPORT_WORDS =
  /\b(why|explain\w*|report (on|about)|(write|make|prepare|draft|give me) (me )?an? (short |quick |full )?report|compar\w*|comparison|versus|vs\.?|how (did|has|have|was|were)\b|went|summar\w*|walk me through|what happened|what('s| has| is)? changed|breakdown|analy[sz]\w*|retrospective)\b/i;

/**
 * The kind of answer a question gets (R4): a report document when it asks to explain, report on
 * or compare something ("why …", "how did … go", "compare …"), a board for a quick status lookup
 * ("what's blocked?", "what's due this week?"). A first guess written into the brief; the agent
 * reads the question and may know better.
 */
export function answerKind(question: string): 'report' | 'board' {
  return REPORT_WORDS.test(question) ? 'report' : 'board';
}

/**
 * Everything an agent needs to answer the open questions in some projects in one go: the
 * questions, the guidelines, the catalog, and worked examples. Given to the question-answering
 * agent up front, so it doesn't spend calls discovering them.
 */
export function answerBrief(
  store: Store,
  projectIds: string[],
  /** Where to note each reuse choice (R11.6): the runner writes it to the agent log. */
  log?: (line: string) => void,
): string {
  const questions = projectIds.flatMap((projectId) => {
    const project = store.getOfType('project', projectId);
    const answers = store
      .list('view', { projectId })
      .filter((v) => v.data.kind === 'answer' && !v.data.archived && !isExpired(v));
    // Agents see file details only, and nothing of hidden files (R7.5).
    const requests = new AgentFiles(store).entities(
      store.list('request', { projectId, where: { status: 'open' } }),
    );
    return requests.map((r) =>
      [
        `- requestId ${r.id} in project "${project.data.name}" (${projectId}): ${r.data.question}`,
        r.data.about ? `  Asked from: ${r.data.about}` : '',
        r.data.mode === 'block' || r.data.mode === 'refresh'
          ? ''
          : answerKind(r.data.question) === 'report'
            ? '  Kind: a report document (it asks to explain, report on or compare)'
            : '  Kind: a board (a quick lookup)',
        r.data.mode === 'block' ? '  Change this block (mode "block")' : '',
        r.data.mode === 'refresh'
          ? reportKind(store, r.data.viewId)
            ? `  Refresh this ${reportKind(store, r.data.viewId)} (mode "refresh")`
            : '  Refresh this answer (mode "refresh")'
          : '',
        ...requestContext(store, r).map((line) => `  ${line}`),
        ...(r.data.mode === 'refresh' ? refreshContext(store, r) : []),
        ...similarAnswers(r.data.question, answers, (v) => v.data.question)
          .filter((v) => v.id !== r.data.viewId || r.data.mode !== 'refresh')
          .slice(0, 2)
          .map((v) => {
            // R11.6: an answer whose data changed since it was written is never reused.
            const state = evidenceState(store, v);
            log?.(
              `[pharos] request ${r.id}: earlier answer ${v.id} is ${state}; ${state === 'fresh' ? 'offered for reuse' : 'not offered for reuse'}`,
            );
            if (state === 'stale')
              return `  Answered before: view ${v.id} ("${v.data.question}"), but data it was written from changed since, so its text may be wrong. Don't link it: answer again.`;
            // Nothing says whether its words still hold (R11 review, gap 2): no confident reuse.
            if (state === 'unknown')
              return `  Answered before: view ${v.id} ("${v.data.question}"), but Pharos can't tell whether what it says still holds (its evidence is unknown). Don't link it: read it with view_get if it helps, check it against the data now, and answer again.`;
            return `  Answered before: view ${v.id} ("${v.data.question}"). Its blocks are live and nothing it was written from changed; if it still answers this, link it instead of building a new view: apply an update to request ${r.id} with {status: "answered", answerViewId: "${v.id}"}.`;
          }),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });
  return [
    'Handle these requests from people using Pharos. Each was sent with Ask from a widget or an',
    'item, so read it together with what it was asked about. Nobody reads your chat reply; put what',
    'you have to say in a view.',
    '',
    ...questions,
    '',
    'A request marked "Change this block" (mode "block") asks you to change that one block in',
    'place, not to answer in a new view: read the view with view_get, then view_update with its',
    'revision as expectedRevision, the requestId, ops on that block only and a one-sentence reply',
    'saying what you changed. Every other block and the view itself must stay as they are (the',
    "change is refused otherwise). If the block can't do what was asked, change nothing: dismiss",
    'the request with a reply saying why and what would work instead (apply, request status',
    '"dismissed", reply).',
    '',
    'A request marked "Refresh this answer" (mode "refresh") says the data behind an earlier',
    'answer view changed since it was written. Answer the question again in that same view: read it',
    'with view_get, then view_update with its revision as expectedRevision, the requestId and the',
    'whole page as new widgets (check every number and sentence against the data now; ops or a',
    'rename are refused), and a one-sentence reply saying what changed. Never link an answer that',
    'is marked stale or unknown.',
    'When the view is a report page (the request says "Refresh this report page"), write the page',
    'again instead: call report_guide, view_get it (its html, page.data and summary), read what',
    'each named read selects now, and view_update with expectedRevision, the requestId and the',
    'whole page as page: new html and summary worked out from the data now, the same page.data.',
    'Its assets stay. Never send widgets for a report page.',
    'When the view is a report document (the request says "Refresh this report document"), write',
    'the document again the same way: report_guide ("Report documents"), view_get it (its doc),',
    'view_preview it to see what every block shows now, and view_update with expectedRevision, the',
    'requestId and the whole document as doc: the same blocks and ids, words and summary from the',
    'data now, the same doc.data. Never send widgets or page for a report document.',
    '',
    'People use Ask for three things. Work out which one each request is:',
    '- A question about the project: answer it with view_answer (pass the requestId).',
    '- A request to change the project (tasks, stages, decisions, …) or a view: make the change',
    '  (apply, or view_update for views), then use view_answer to show what changed. Asked for a',
    '  way to log something from a pack page ("let me log fuel here")? Add an Action block (see',
    '  Action below and pharos://guide/packs) rather than logging it yourself each time.',
    '- Feedback about Pharos itself: how a component looks or behaves, or a missing feature',
    '  (e.g. "the text in this column wraps", "this has no field for X"). That is about the app,',
    "  not this project's data, so don't rearrange their view to work around it. If a project",
    '  tracks Pharos itself, add a task there for it; then answer with view_answer in one or two',
    '  sentences: what you understood and what you recorded.',
    '',
    'Pick the kind of answer by the question ("Kind" above is a first guess; the question wins):',
    '- Asked to explain, report on or compare something ("why …", "how did … go", "compare …"):',
    '  a report document. Call report_guide first and follow it, then view_answer with doc, not',
    '  widgets. A report page (page) only when the person asks for a whole bespoke design.',
    '- A quick status lookup ("what\'s blocked?", "what\'s due this week?"): a board, view_answer',
    '  with widgets, as below.',
    '',
    'For each request: call project_snapshot for its project (once per project), use get or list',
    'only for details the snapshot lacks, then do the above. view_answer returns a preview; fix',
    'problems with view_update if it shows any, then move on. Use catalog_describe only for a',
    "component whose props aren't shown in the examples below.",
    '',
    'Files: you see only the details of files in a project (project_snapshot.files: title, kind,',
    'issuer, dates, tags, size), never their notes or files in folders the owner hid.',
    `${FILE_TEXT_TOOL} returns a file's text only when canReadText is true; otherwise work from the`,
    "details, and don't look for the files on disk. Asked to manage a set of documents? Ask for",
    'their folder with folder_request if no shared folder has them (the owner approves it in',
    'Pharos), add them from files_unadded, tag them and fill kind, issuer and dates, link the',
    'related tasks and decisions with fileIds, then build one view (see "Document sets" below):',
    'a StartHere, a FileList filtered to the tag (tapping a file opens it in the file viewer) and',
    'the linked work; a FileView only when one key document should always be on the page.',
    '',
    VIEW_GUIDELINES,
    catalogMarkdown(),
    '',
    examplesMarkdown(),
  ].join('\n');
}

export function registerGuidance(server: McpServer, store: Store): void {
  server.registerResource(
    'view-guidelines',
    'pharos://guide/views',
    {
      title: 'View design guidelines',
      description: 'How to design good Pharos views and answers',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, VIEW_GUIDELINES),
  );
  server.registerResource(
    'catalog',
    'pharos://guide/catalog',
    {
      title: 'Component catalog',
      description: 'Every view component, when to use it, and the board and filter rules',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, catalogMarkdown()),
  );
  server.registerResource(
    'answer-examples',
    'pharos://examples/answers',
    {
      title: 'Example answer views',
      description: 'Common questions and the widgets that answer them well',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, examplesMarkdown()),
  );
  server.registerResource(
    'report-guide',
    'pharos://guide/reports',
    {
      title: 'Writing a report',
      description:
        'Report documents (R14, the default for a report) and report pages (R13): blocks Pharos draws, or a whole HTML page with live data through pharos.data; assets and the frame’s limits',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, REPORT_GUIDE),
  );
  server.registerResource(
    'pack-guide',
    'pharos://guide/packs',
    {
      title: 'Setting up a pack project',
      description:
        'Pick a pack, apply it, add records and files, adjust the page and pass the query and fact checks',
      mimeType: 'text/markdown',
    },
    (uri) => text(uri.href, PACK_GUIDE),
  );
  server.registerResource(
    'project-snapshot',
    new ResourceTemplate('pharos://projects/{projectId}/snapshot', {
      list: () => ({
        resources: store.list('project').map((p) => ({
          uri: `pharos://projects/${p.id}/snapshot`,
          name: `${p.data.name} snapshot`,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Project snapshot',
      description: 'A compact summary of one project',
      mimeType: 'application/json',
    },
    (uri, { projectId }) =>
      text(
        uri.href,
        JSON.stringify(projectSnapshot(store, String(projectId)), null, 2),
        'application/json',
      ),
  );

  const guideAndExamples = `${VIEW_GUIDELINES}\n\n${examplesMarkdown()}`;
  server.registerPrompt(
    'answer_question',
    {
      title: 'Answer a question with a view',
      description: 'Answer a question about a project with a focused Pharos answer view',
      argsSchema: {
        question: z.string().describe('The question'),
        project: z.string().optional().describe('Project name or id'),
      },
    },
    ({ question, project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Answer this question about ${project ? `the project "${project}"` : 'my project'} in Pharos with an answer view (view_answer), following these guidelines. Check the preview it returns, then reply in one or two sentences with the answer and the link.\n\nQuestion: ${question}\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'catch_up',
    {
      title: 'Catch up on a project',
      description: 'See what people changed since you last looked and answer their open questions',
      argsSchema: { project: z.string().optional().describe('Project name or id') },
    },
    ({ project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Catch up on ${project ? `"${project}"` : 'my project'} in Pharos: call changes_since and summarize what people changed in a few bullets, then answer every open question in project_snapshot.requests with view_answer (pass its requestId), following these guidelines.\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'design_view',
    {
      title: 'Design a saved view',
      description: 'Build a saved Pharos view for a purpose, e.g. a weekly check-in',
      argsSchema: {
        purpose: z.string().describe('What the view is for'),
        project: z.string().optional(),
      },
    },
    ({ purpose, project }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a saved view in Pharos for ${project ? `"${project}"` : 'my project'}: ${purpose}. Follow these guidelines, check the preview view_create returns, and reply with the link.\n\n${guideAndExamples}`,
          },
        },
      ],
    }),
  );
}
