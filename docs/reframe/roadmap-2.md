# Roadmap 2: the reader, many kinds of projects, and project files

2026-10-12 · written by Opus 5.5 · task R6.2 · commit f96da91 · design only, nothing built

> **Draft for the owner to approve (R6.3).** Research input: [r6-methods.md](r6-methods.md).
> Nothing here changes Pharos until the owner approves it.

## Summary

Six stages, R7 to R12. **R7** lets a project hold its files: documents stay where they are on
disk, and Pharos lists them, previews them and hands them on (download, reveal in Finder, copy
path). Agents see only file details, never contents. **R8** adds _records_: a project can keep
its own kinds of records (a car service, a bill) with typed fields, and two ready-made _packs_
(car, money) give a working page on day one. **R9** adds music, study and company-document packs
and the blocks they need, and checks that a GPT agent can set one up alone. **R10** lets the
reader act in place (log a service, mark a bill paid) without losing anyone's edits. **R11**,
alongside R9–R10, makes pages live and calm: what changed since you looked, which agent is
working where, smooth motion. **R12** measures the result with readers' checks, not the old
project-management benchmark, and ends in a release call. Of the 114 open G1–G5 tasks, 34 are
kept, 53 reshaped, and 27 dropped or folded into stage checks.

```
R7 Files ─▶ R8 Records: car + money ─▶ R9 More packs ─▶ R10 Act in place ─▶ R12 Measure + release
                                          └──── R11 Live and calm (runs alongside R9–R10) ────┘
```

How every stage runs (as R4–R5): one contract item touches the shared schema files first, then
Opus 5.5 agents build in parallel with clear file ownership, GPT-6.1-Sol checks independently,
one fix round, and the owner checks **one real page** at the end, only when it meets the bar.
Demo data is public or made up; the owner's own files and money are only ever added by the owner.

## 1. Stages

| Stage                              | Outcome                                                                                      | At the end the owner can …                                                                                                                                                                                     | Exit check                                                                                                                                                                                                        | Size                                       | Absorbs                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| **R7 · Project files**             | A project lists its documents and opens them safely; claim sources on disk finally open too. | Add a folder in Settings, add files to a project, find "the 2025 tax certificate" on a Files page, preview it, download it with its real name, reveal it in Finder, copy its path into an upload dialog (⌘⇧G). | Owner finds and hands on a named document in 30 s without Finder search. GPT-6.1-Sol attack tests pass (path tricks, symlinks, dotfiles, foreign `Origin`, HTML/SVG). An MCP test proves agents get details only. | M–L · ~10 tasks · 3 batches                | reliable (safe local serving); Option "offer to reload"                  |
| **R8 · Records, car and money**    | Projects keep their own kinds of records; two packs give a useful page on day one.           | Start a "Car" project from a pack and see what's due; start "Money" and see planned vs spent by category, upcoming bills, a savings target.                                                                    | Every total and due date on both pages matches the records (automatic fact check). Both pages pass the 30-second check (GPT prediction, then owner).                                                              | L · ~14 tasks · biggest and riskiest stage | capability (W12), reliable (W4 query checks), measure (W3.4 fact checks) |
| **R9 · More packs**                | Music, study and company-document packs, plus the blocks they need.                          | Hear the latest mix of each song next to its stage; see study hours against a target and the next exam; see which company documents expire soon.                                                               | A GPT agent sets up one pack project from the guide alone; repair count recorded against Opus. Owner checks one pack page.                                                                                        | M–L · ~10 tasks                            | capability (W13 two agents)                                              |
| **R10 · Act in place**             | The reader changes data from a page, safely.                                                 | Tap "Log a service" or "Mark paid" on the page, fill a short form, see every page update, Undo. Ask about one block and have the agent change just that block.                                                 | Stale, duplicate and invalid submissions each show a clear result; a human edit survives an agent retry; core flow works by keyboard.                                                                             | L · ~12 tasks                              | act (W8–W10), reliable (W6 conflicts), keyboard (W11)                    |
| **R11 · Live and calm** (parallel) | Pages say what changed and who is working, without jumping.                                  | See a dot on views changed since they last looked, "Claude Code is editing…" on the block being changed, and run states that are true.                                                                         | Pause/stop shows what actually continues; marks clear on opening; motion respects reduced-motion.                                                                                                                 | M · ~9 tasks                               | reliable (W5 freshness, W7 run states); the four Options ideas           |
| **R12 · Measure and release**      | Evidence that pages help, and a release call.                                                | Use two real projects of their own for two weeks; read a short evidence page; decide release or not.                                                                                                           | Reader checks across all packs, fact checks green, old saved views still load, fresh checkout passes, independent review of the recommendation.                                                                   | M · ~8 tasks                               | measure (G1), release (G5)                                               |

Size is honest guesswork from R4 (11 tasks, about a day with parallel agents). R8 carries the
risk: it touches the store, queries and catalog at once, and a generic model can make generic,
wordy pages unless every pack ships a hand-made page.

### What happens to G1–G5

132 tasks: 18 done (kept as history), 114 open. "Folded" means a separate owner approval of a
policy becomes part of that stage's single owner check, as the owner asked (no checks on
text-only pages).

| Work item                          | Open | Fate                                                                                                                                                                              |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 workflow cases and targets      | 2    | **Dropped.** The three cases measure project-management questions. Withdraw the _proposed_ decision "Pre-registered G5 targets".                                                  |
| W2 release gate                    | 2    | **Kept**, in R12 (re-verify on the release commit).                                                                                                                               |
| W3 baseline                        | 8    | **Reshaped 3** (W3, W3.2 corpus becomes pack cases, W3.4 fact checks guard totals and due dates in R8). **Dropped 5** (W3.5–3.9: static-vs-GenUI baseline runs and report).       |
| W4 query validation                | 9    | **Reshaped 8**, R8: field metadata now includes each project's record fields, so checking queries matters more. W4.8 folded.                                                      |
| W5 freshness                       | 9    | **Reshaped 8**, R11: "updated since you looked" and stale answers. W5.8 folded.                                                                                                   |
| W6 conflicts                       | 9    | **Kept 8**, R10 (needed before in-page actions). W6.8 folded.                                                                                                                     |
| W7 run states                      | 11   | **Kept 10**, R11 (the agent-working marks rely on true run states). W7.8 folded.                                                                                                  |
| W8 action contract, W10 one action | 14   | **Reshaped 13**, R10: the action is a record-type form ("Log a service"), not only a task change. W8.5 folded.                                                                    |
| W9 refinement editors              | 9    | **Reshaped 5** (W9, 9.1, 9.5 ask-about-this-block, 9.6 Undo/layout tests, 9.8 owner try). **Dropped 4** (9.2–9.4 query and column editors, 9.7): builder tools, not reader tools. |
| W11 keyboard                       | 7    | **Kept**, R10; W11.6 bundle split moves to R9 (new blocks grow the bundle).                                                                                                       |
| W12 capability gaps                | 6    | **Reshaped 5** into R8/R9 block work driven by pack cases. W12.5 folded.                                                                                                          |
| W13 two agents                     | 7    | **Reshaped**, R9: a GPT agent builds a pack project instead of running the PM corpus.                                                                                             |
| W14 external UI survey             | 4    | **Dropped.** Already decided: keep Pharos's own recipe format, AG-UI/A2UI later as add-ons.                                                                                       |
| W15 baseline comparison            | 6    | **Dropped.** Replaced by reader checks per stage and R12's evidence page.                                                                                                         |
| W16 real cycle                     | 4    | **Reshaped**, R12: two real projects of the owner's (one pack project, plus Pharos itself).                                                                                       |
| W17 docs and release               | 7    | **Kept**, R12; docs gain packs and file safety; W17.6 stays the owner's release call.                                                                                             |

Totals: kept 34, reshaped 53, dropped 21, folded 6. The four open goals are rewritten in reader
terms; the old decision "Defer custom fields" is superseded by records (decision 1 below).

## 2. Many kinds of projects

**Choice: typed records, with packs as data on top.** A new `record` entity has a `recordType`
and `fields`; each project's record types live in `project.data.recordTypes`, next to `options`.
A **pack** is a JSON bundle (record types, option lists, interval templates, a hand-made overview
page, a short agent guide, optional made-up examples) applied in one `apply` and undone by
revert.

- _Why not fixed types per domain_ (a `vehicle` type, a `transaction` type in `entities.ts`):
  tighter blocks and tests, but every new kind of project needs code, a release and a schema
  change, and the owner said "and more". Records reach any domain with no code.
- _The cost of records:_ blocks must work from field metadata, not known field names; the store
  checks references per type at run time (today `ENTITIES` refs are fixed); queries need field
  paths like `fields.odometer` and a **sum** (today they only count); agents can invent messy
  types. Mitigations: W4 query checks, save-time warnings like the page checks, and packs as the
  starting point.

**Field kinds** (from r6-methods A3/A7): text, number, money (amount in cents plus currency; no
exchange rates, mixed currencies shown apart), date, option, reference, file, meter (number with
a unit, e.g. km). **Interval** is built in: every N days and/or N meter units, whichever first,
fixed or rolling, with LubeLogger's four bands: not urgent, urgent, very urgent, past due.

**First packs and their day-one page**

| Pack                  | Stage | Record types                                                  | Day-one page                                                                                                                       |
| --------------------- | ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Car**               | R8    | Vehicle, Service, Fuel, Reminder (interval)                   | "What's due" with the four bands (oil every 10,000 km or 12 months), service log, cost per year, registration and insurance files. |
| **Money**             | R8    | Category (planned per month), Spending, Bill (interval), Goal | Planned vs spent by category, upcoming bills, savings progress, statements. Entered by hand or by an agent; bank import later.     |
| **Music**             | R9    | Song (stage option), Version (file), Session                  | Songs by stage, latest mix to play in place, session log.                                                                          |
| **Study**             | R9    | Subject, Session (minutes), Resource, Exam                    | Hours against a target, next exams on a calendar, practice log; links to Anki, no scheduler.                                       |
| **Company documents** | R9    | Document details live on files; Filing (interval)             | Documents by kind and issuer, what expires soon, filing deadlines.                                                                 |

Later candidates, same machinery: home and warranties, job search, trips, health (very private).

**New blocks, in order** (a mode on an existing block where it fits, as R4 did with Layers):
R7 FileList and the file drawer; R8 Ledger (DataTable money format with a total row), Log,
DueTracker, CategoryBreakdown (planned vs actual); R9 Calendar, Trend (a value over time),
ProgressRing with a target, a record board (KanbanBoard grouped by any option field), audio in
the file drawer.

## 3. Project files

**Model.** A `file` entity: title, `rootId`, path relative to its root, size, modified time,
SHA-256 (finds a moved file), mime type, `file.kind` option (statement, receipt, contract,
certificate, manual, audio, other), issuer, issued and expiry dates, tags, notes, links to
records and tasks. Files stay where they are. An artifact can point at a file, so a claim's
local source opens (today local sources show a path that can't be opened).

**Folders (roots).** The owner adds folders on the Settings page, as app settings like the agent
pause, never through MCP. Pharos scans a folder into a cache (not revisions) and the owner adds
files from it to a project; each added file is a revision.

**Views.** FileList: grouped by kind, filters for kind, tag, issuer and expiry, a name search.
File drawer: preview (PDF, images, text, Markdown in R7; audio in R9), details, linked records,
actions. Expiry dates feed the DueTracker.

**Actions.** Preview · Download (real file name) · Reveal in Finder (server runs macOS
`open -R`, to be confirmed) · Copy path. "Open in default app" only for an allowlist of document
kinds, never scripts or apps.

**Safety rules** (r6-methods B9–B12): read-only, no upload, rename or delete; URLs carry the file
id, never a path; real path resolved through symlinks and rejected outside its root; dotfiles,
`.env`, keys and `.ssh` never scanned or served; 127.0.0.1 only and an `Origin` check on every file
route and action; `nosniff`, CSP `sandbox`, mime from an allowlist, HTML and SVG only as
downloads; contents never written to logs or agent prompts.

**What agents see.** By default, the details of files added to a project (title, kind, issuer,
dates, tags, size), and nothing else: not the folder's other names, not contents. Each folder has
a level the owner sets: _hidden_ (owner only), _details_ (default), _contents_ (an MCP tool may
read text). Honest limit: Pharos can enforce this over MCP, but an agent with shell access, such
as Claude Code, can read the disk directly. R7 ships a matching Claude Code deny rule for those
folders and says so on the Settings page. With details only, the owner fills issuer and expiry
by hand unless a folder is set to _contents_. Since R7.9 the same holds over REST for requests
sent with `X-Pharos-Author: agent:…`, which are also refused the owner's file and folder routes;
that header is a declared role, not authentication, so a local process that leaves it out is
served as the owner. Sources, findings and terms copied only from hidden files are hidden too,
no source shows a local path to agents, and quotes from _details_ files are left out.

**Risks.** Chrome may refuse a PDF inside a sandboxed frame (fallback: open in a new tab).
iCloud files not yet downloaded are fetched when read, so hashing is lazy. Big audio folders make
scans slow.

## 4. Where the Options ideas fit

| Idea                                    | Where | Note                                                                                                       |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| Offer to reload after an update         | R7    | Small; the events stream carries the server version. Prevents "Unknown component" as blocks keep arriving. |
| Mark views updated since you looked     | R11   | "Last seen" per view is an app setting, not a revision; dot on the tab and the project.                    |
| Show that an agent is working on a view | R11   | Needs W7's true run states; who, since when, what it said.                                                 |
| Show which block an agent is editing    | R11   | Needs a live signal from the `view_*` tools, not only finished revisions.                                  |
| Smooth transitions                      | R11   | Our own CSS (transitions.dev snippets can't be redistributed); respects reduced motion.                    |

The other Options (desktop shell, themes, marketplace, agent pool, agent picker, ScopeBoard
dragging) stay unscheduled. A pack marketplace becomes plausible after R9.

## 5. Decisions for the owner

1. **Typed records with packs as data, or fixed types per domain?** Recommend records plus packs:
   any kind of project without code, at the cost of R8 being the hardest stage. Supersedes
   "Defer custom fields".
2. **What agents may see of files.** Recommend a level per folder, default _details of added
   files only_, _contents_ by explicit opt-in per folder, plus a Claude Code deny rule for shell
   access.
3. **Order: files first (R7) or records first?** Recommend files first: it answers the most
   concrete request, needs no record model, and fixes claim sources on disk.
4. **Drop the project-management benchmark.** Recommend dropping W3.5–3.9, W14 and W15 and
   withdrawing "Pre-registered G5 targets"; measure with reader checks, fact checks and two
   weeks of the owner's real use instead.
5. **First packs and money scope.** Recommend car and money in R8, music, study and company
   documents in R9; money as planned vs spent with hand- or agent-entered spending, no bank
   connections. Built on made-up data; the owner adds real figures, which agents then see.
