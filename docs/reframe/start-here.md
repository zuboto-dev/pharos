# Start here: how a report page opens

2026-10-12 · written by Opus 5.5 · task R3.1, updated for R3.6

> **Rules the owner approved** in the decision "Start-here opening and evidence behind each
> finding". The reasons come from the research in [methods.md](methods.md) (R3.0).

## The rule in one line

**Every report page has one purpose, and its first block tells the reader what the page is for,
why the work exists, what it says, what they have to do, where it sits, and where to look next.**

A report page is any page an agent makes to tell the reader about work: what it did, what it
found, or what it needs from them. Task boards and other project views are not report pages.

## The opening

Every report page opens with a **StartHere** block, at the top and full width. It holds seven
things:

1. **A purpose tag**: _Done_, _Found_ or _Needs you_. One page, one purpose. If a page has two
   purposes, make two pages. (Diátaxis in methods.md: mixing kinds of page is "at the heart of a
   vast number of problems".)
2. **Why the work exists** (R3.6): one line under 100 characters on what the work is for or the
   question it answers, shown above the headline. The owner, on the G1 page: "I don't understand
   what the goal wants to measure."
3. **One headline sentence**: the outcome, with a verb, under about 160 characters. (BLUF and the
   GOV.UK summary rule in methods.md.)
4. **The reader's part** (R3.6): one line under 120 characters, even "Nothing now. When G1
   resumes: approve the 3 test cases and targets." It is the only place the page says it: no
   "Your part" card, no "nothing needs you" in the text.
5. **Where it sits**: the project, the stage or goal, and the date. (NN/g "you are here"
   wayfinding.)
6. **A reading path**: 2 to 4 short steps, each saying what the reader will find there, such as
   "How it was checked", never "More". Tapping a step scrolls to that part of the page. Details
   open on request, two levels at most: the step, then the part and what it opens. (Information
   scent and progressive disclosure.)
7. **Evidence for every claim**: the headline links to what backs it: a stored finding with its
   source, a test run, a commit, a decision. (Agent run reports, and the Liu et al. 2023 audit:
   a link the reader can follow, not just a sentence.)

## Keep it short (R3.6)

The owner found the rebuilt G1 page too long ("TLDR"), its three-column rows of full sentences
distracting, and too many words underlined. So:

- **About 150 words** on the page before the reader opens anything: the opening, text blocks,
  claim statements and details on cards, layer labels. Data tables don't count. At most **25
  words on one card**.
- **One item per line.** A list of findings reads as one column, one short line each, details on
  tap. Cards side by side only for short items: numbers, labels.
- **Few underlines.** A term only for a word a non-specialist wouldn't know, never an everyday
  phrase like "test case"; at most 5 on a page.
- Keep the colours, labels and legend: the owner found them helpful.

## Then, by purpose

| Purpose       | After the opening                                                                                                                                                          | From methods.md                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Done**      | What changed (show it: before and after, the output). How it was checked, with links. What is left or not done.                                                            | BLUF, agent run reports, inverted pyramid        |
| **Found**     | The main finding is the headline. Why it matters, in one line. 3–5 finding cards, each with its source. How sure, and what is still unknown.                               | Minto pyramid and SCQ, executive summary, GRADE  |
| **Needs you** | The decision and the deadline. The options, each with what it leads to. The agent's recommendation and why. A way to answer: accept or reject a proposed decision, or ask. | ADR, decision memo (not confirmed in methods.md) |

## One example per purpose

**Done.**
_Tag:_ Done · _Where:_ Pharos › R3 Reader-first › 12 Oct
_Why:_ "So a reader knows at once what a report page is for and what it asks of them."
_Headline:_ "Report pages now open with a start-here block that says what the page is for."
_Evidence:_ the test run, the commit. _Your part:_ "Nothing now."
_Path:_ 1 What changed: the new block, before and after · 2 How it was checked: tests and a phone
check · 3 What is left: two open points.

**Found.**
_Tag:_ Found · _Where:_ Generative UI map › Research › 11 Oct
_Headline (a stored finding):_ "Nobody offers the middle layer, so Pharos keeps its own recipe
format." _Mark:_ Our reading, 11 Oct, 3 sources.
_Why:_ "Which parts of generative UI Pharos should build, and which it can reuse?"
_Your part:_ "Nothing now. Tell me if a layer is unclear."
_Path:_ 1 How it is built: five layers, tap one to open it · 2 What it means for us: what to keep
and what to build · 3 Where it comes from: every source, linked.

**Needs you.**
_Tag:_ Needs you · _Where:_ Pharos › R4 Blocks › 12 Oct · _Answer by:_ 15 Oct
_Why:_ "R4 can only build two blocks before the next review."
_Headline:_ "Choose which two new blocks to build first, by Wednesday."
_Evidence:_ the proposed decision. _Your part:_ "Accept or change the proposed two blocks by 15 Oct."
_Path:_ 1 The choice: three options and what each leads to · 2 What I recommend: sparklines and
source quotes, and why · 3 How to answer: accept, change or ask.

## What Pharos checks

When an agent saves or previews a report page (any view with a StartHere, ClaimCard or Layers),
Pharos returns warnings. They never block the save; the agent fixes them before saying the page is
ready.

- No StartHere, the StartHere is not first, or more than one.
- The headline is over 160 characters, missing, or has no evidence (no claim and no evidence ids).
- No `why`, or one over 100 characters; no `yourPart`, or one over 120 characters. Both are
  optional in the schema, so older views still load and only warn.
- Another widget also tells the reader their part: a title, kicker, heading or text with words
  like "Your part", "What you need to do" or "nothing needs you".
- More than 150 words before any detail (counted as above; a Tabs counts its first tab, a Layers
  stack its open layer), with the three widgets that have the most; a card over 25 words.
- A board row (or a Grid of 3 or more columns) with 3 or more claim cards over 12 words each.
- More than 5 underlined terms (each widget marks a term's first use in it).
- A claim or evidence id, stage or goal isn't in the project; no stage or goal is set when the
  project has some.
- The path has fewer than 2 or more than 4 steps, or a step points at a widget not on the page.
- A _Needs you_ page has no answer-by date.
- The point comes too late: more than 30 words, or another block, before the opening.

Not checked, and left to the agent: that the headline has a verb, that `why` says why rather than
what, that a page keeps to one purpose below the opening, the per-purpose parts after it, and
whether an underlined word is really an everyday one.
