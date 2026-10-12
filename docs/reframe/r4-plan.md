# R4 plan: picture and interaction blocks

2026-10-12 · written by Opus 5.5 · task R4.1 · commit ea48e99 · design only, nothing built

> **Draft for the owner to approve.** The owner's bar: "less words, more infographics,
> interactive, and deliverable with true references". Their next check is at the end of R4, on a
> page that uses these blocks.

Sources for the gaps: R3.3, R3.4fix and R3.7 builder notes (the G1 page; scratchpad `reframe/work/…/notes.md`),
[r3-review.md](r3-review.md) and [slice-1-review.md](slice-1-review.md) (the Generative UI page).
Methods come from [methods.md](methods.md) part B.

**Rules for every new block.** Each one reads stored records (claims, terms, artifacts) or project
queries; the spec holds ids, tags, filters and short labels, never a finding's words or numbers.
Labels go on the picture, not in a paragraph (split attention). Status colours, pill labels and
the legend stay as they are (the owner liked them). Terms are off by default inside pictures, so
no dotted underlines there. Every picture item opens to its claim's mark, quote and source.
No chart library: the existing CountChart and ProgressRing are plain HTML/SVG in our own code, and
these blocks need nothing more, so there is no licence question to settle.

## 1. New blocks and block modes, ranked

| #   | Block                                                  | Gap it closes                                                                                                                                                                                                                      | Method                                                                                                                                          | Looks like / reader does                                                                                                                                                                                                                                      | Reads                                                                                                                                       | Words                                           | Size |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- |
| 1   | **Layers `flow` mode**                                 | Three columns of full sentences ("How a Pharos screen is made", owner's dislike); slice-1 fix 2 asked for the picture "Your question → AI arranges blocks → Pharos draws the screen"; R3.7: an empty layer says "Nothing here yet" | Overview first, details on demand (Shneiderman); martini glass (Segel & Heer); progressive disclosure                                           | 2–5 boxes in a row joined by arrows, each with a ≤30-char label and its pill colour; claims stay hidden. Tap a box: it opens below the row with its claims, mark and quote. Keyboard: arrow keys move. Phone: boxes stack with down arrows                    | Claims by tag per step (as Layers today). A step may hold no claims (label only)                                                            | ~3 per step                                     | M    |
| 2   | **Layers progress** (per step)                         | R3.3 #4 no "2 of 9" picture per part in one widget; R3.3 #5 a part can't show its tasks; r3-review 4 counts belong in detail                                                                                                       | Small multiples (Tufte); overview → detail drill (Shneiderman)                                                                                  | A thin bar and "2 of 9" under each step's label, same scale for all. Tap "2 of 9": that step's open tasks list in plain titles (codes hidden), each opening the task drawer                                                                                   | Task `where` per step, counted live by meaning (`taskProgress`), cancelled excluded                                                         | ~3 per step                                     | S    |
| 3   | **BeforeAfter**                                        | R3.3 #7 and R3.4fix #5 no real before/after (two ClaimCards approximated it); goal principle 2 "show the work"                                                                                                                     | Show the work (goal.md); small multiples, one frame twice; Liu et al.: the passage, not a link                                                  | Two panes side by side (stacked on phone), headed "Before · 8bb6b32" and "After · main". Each shows its claim's quoted passage; removed words struck in red, added in green. Each pane's mark opens its source and locator. One claim states the change above | Two claim ids (`before`, `after`); text is each claim's stored `quote`; the diff is computed in the browser                                 | Statement ≤15 + the changed lines; warn over 40 | M    |
| 4   | **FindingChart**                                       | Gen UI page states numbers in sentences (OpenUI 4,800 vs 10,180 tokens; Google's 82.8%); "more infographics"                                                                                                                       | Finding as title (Kong et al.); direct attention, one bar highlighted (Knaflic); direct labels (split attention); quote per number (Liu et al.) | Horizontal bars, values and labels on the bars, no axis or legend, one bar in the accent colour, the rest grey. Title = the headline claim with its mark. Tap a bar: its claim, quote and source                                                              | Mode A: claims by tag, each with a new optional `figure` {value, unit, label}. Mode B: a project query counted by a field (like CountChart) | Title ≤15 + ~2 per bar                          | L    |
| 5   | **Evidence strength in the mark** (CertaintyMark mode) | R3.3 #1 cards with local sources look unsourced; slice-1 "a date alone cannot establish support"                                                                                                                                   | Wikipedia "citation needed"; IPCC/GRADE evidence count and named reason                                                                         | After the mark: "3 sources" or a grey "no source yet". Optional named reason when weak: "one source", "indirect", "sources disagree"                                                                                                                          | `sourceIds` count; new optional claim field `weakBecause`                                                                                   | 2                                               | S    |
| 6   | **Mini bars in StatCards and Text**                    | R3.3 #4: StatCards show numbers with no bar                                                                                                                                                                                        | Sparklines, word-sized graphics (Tufte)                                                                                                         | When a stat has `of`, a word-sized bar under or beside the number; in Text, `${x}` with `{bar: {query, of}}` draws one inline                                                                                                                                 | Existing queries                                                                                                                            | 0                                               | S    |

Not ranked, kept for later: the assumption slider (no page has a number that depends on a stated
assumption, so methods.md's "use rarely" applies) and the annotated screenshot (see section 5).

**Claim fields this needs** (in `entities.ts`, all optional, old claims unchanged): `figure`
{value, unit ≤12, label ≤24}, `locator` (≤60, e.g. "§7 Completion", "line 42", "commit deb7096"),
`weakBecause` (enum). New save-time warnings: a "From source" claim whose `figure` value does not
appear in its `quote`; a FindingChart title that isn't a stored claim; a BeforeAfter whose claims
have no quote.

## 2. Fixes to existing blocks

| Fix                                                                                                                                                                                                                                                           | Gap                                                              | Where                      | Size |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------- | ---- |
| F1 **Local sources are reachable.** "Sources (n)" counts every source, not only http ones. The popover shows a local source's title, path and `locator`, and the quoted passage when the claim quotes it; tapping opens the artifact drawer. "(no link)" goes | R3.3 #1, R3.4fix #1, r3-review 3                                 | knowledge.tsx              | S    |
| F2 **Locator with the quote**: "— G1 measures · §2 Metrics" under the passage                                                                                                                                                                                 | R3.4fix #3                                                       | knowledge.tsx              | S    |
| F3 **Quote toggle in Layers lines** (ClaimLine), and per line when a mark is shared                                                                                                                                                                           | R3.4fix #2, R3.7                                                 | knowledge.tsx              | S    |
| F4 **Pill claim first** in its layer, as slice-1 describes                                                                                                                                                                                                    | R3.3 #3                                                          | knowledge.tsx              | S    |
| F5 **Short evidence labels in StartHere**: an item can be `{id, label ≤24}`; plain ids still work                                                                                                                                                             | R3.3 #9, R3.4fix #4 (artifacts were renamed to get short labels) | catalog.ts, start-here.tsx | S    |
| F6 **Hide work codes**: `hideCodes` on TaskTable and DataList shows "Measure the baseline" for "W3.8 · Measure the baseline"; terms apply in their rows                                                                                                       | R3.3 #8, R3.4fix #7                                              | work.tsx, generic.tsx      | S    |
| F7 **Punctuation stays with the term**: no line break between an underlined word and ";" or "."                                                                                                                                                               | R3.3 #2                                                          | terms.tsx                  | S    |
| F8 **DecisionLog excerpt as plain text**, Markdown removed                                                                                                                                                                                                    | R3.3 #6                                                          | outputs.tsx                | S    |

Before/after is block 3, not a fix.

## 3. Build order

Shared files (`catalog.ts`, `entities.ts`, `catalog-info.ts`, `preview.ts`,
`components/index.ts`, `renderer.test.tsx`) are touched only in batch 1, by item A. After that
each item owns its files. Each item commits when finished; nothing is pushed without asking.

**Batch 1, three in parallel**

- **A · contract** (Opus 5.5): every schema change in this plan (blocks 1–6, the claim fields,
  F5, F6 options), their guidance in `catalog-info.ts` and the MCP instructions, word counting and
  the new warnings in `preview.ts`, server tests, and stub components for BeforeAfter and
  FindingChart in their own new files, registered with renderer samples.
  Files: `packages/schema/src/**`, `apps/server/src/views/preview.ts`, `apps/server/src/mcp.ts`,
  `components/index.ts`, `renderer.test.tsx`, two new stub files.
- **B · evidence fixes F1, F3, F4** (Sonnet 5.5): `knowledge.tsx`, `knowledge.test.tsx`.
- **C · F7 and F8** (Sonnet 5.5): `terms.tsx`, `outputs.tsx` and their tests.

**Batch 2, four in parallel** (after A and B are merged)

- **D · Layers flow and progress, F2** (Opus 5.5): `knowledge.tsx`, `knowledge.test.tsx`.
- **E · BeforeAfter** (Opus 5.5): `components/before-after.tsx` and its own test file.
- **F · FindingChart** (Opus 5.5): `components/finding-chart.tsx` and its own test file.
- **G · F5, F6, mini bars, evidence count in the mark** (Sonnet 5.5): `start-here.tsx`,
  `work.tsx`, `generic.tsx`, `overview.tsx`. The count in the mark sits in `knowledge.tsx`, so it
  moves to D.

**Batch 3**

- **H · demo pages** (Opus 5.5): rebuild both pages on an isolated copy with patch scripts, as in
  R3.7 (never on 4300); `verify-quotes`, `view_preview` with no warnings, desktop and phone
  screenshots.
- **I · independent check** (GPT-6.1-Sol), after H: the new blocks against this plan, every
  quote and figure against its source, a predicted 30-second test on desktop and phone, and
  keyboard use. Then one fix round (Opus 5.5) before the owner's check.

## 4. The demo for the owner's end-of-R4 check

Both pages are rebuilt, each still within 150 words.

**G1 at a glance** (Done)

- Opening as in R3.7, with short evidence labels.
- Parts as a flow with progress (blocks 1 and 2): Agree the test → Check v0.1.0 → Measure. Each
  step has its pill, its bar and its "x of y", and opens its open tasks without W-codes.
- The setup-guide fix as a BeforeAfter (README at 8bb6b32 against main).
- The three test jobs, each with "3 sources" and a quote that opens to file and section.

**Generative UI at a glance** (Found)

- Opening.
- "How a Pharos screen is made" as a flow: Your question → AI arranges blocks → Pharos draws the
  screen. This replaces the three columns of sentences.
- The spectrum as a flow with the legend: Static → Declarative (Pharos is here) → Open-ended.
- One FindingChart: OpenUI's own token benchmark (4,800 against 10,180, attributed to OpenUI, From
  source, with the quote). The figures go into claims only after re-checking them against
  the report.
- Keep and Build as two short cards; the long "All sources" list sits behind a tap.

**In 30 seconds the owner can:** say what each page is for and whether anything needs them; point
to where G1 stands per part without reading a sentence; tap one part and see its open tasks;
see exactly what the guide fix changed; tap any bar, box or mark and read the passage behind it
with its file and section or link. If they have to read a paragraph to do any of these, R4 missed.

## 5. Out of scope for R4

- Animations, scroll-driven stories, and live "agent is editing" indicators (parked in Options).
- Annotated screenshots: they need the server to serve local image files, a new surface that
  needs its own safety design. First candidate for R5.
- The assumption slider, and trends over time (sparklines from revision history).
- A claim citing a decision or task as a source (R3.4fix #6). Certainty rules rest on artifacts;
  the StartHere evidence row covers it for now.
- Agents editing pictures freely: new blocks still come only through the closed catalog and
  `view_*` tools.
- Re-styling the term underline beyond F7 and "off inside pictures"; the R3.6 limit of 5 stays.
