# Start here: how a report page opens

2026-10-12 · written by Opus 5.5 · task R3.1

> **Rules the owner approved** in the decision "Start-here opening and evidence behind each
> finding". The reasons come from the research in [methods.md](methods.md) (R3.0).

## The rule in one line

**Every report page has one purpose, and its first block tells the reader what the page is for,
what it says, where it sits, and where to look next.**

A report page is any page an agent makes to tell the reader about work: what it did, what it
found, or what it needs from them. Task boards and other project views are not report pages.

## The opening

Every report page opens with a **StartHere** block, at the top and full width. It holds five
things:

1. **A purpose tag**: _Done_, _Found_ or _Needs you_. One page, one purpose. If a page has two
   purposes, make two pages. (Diátaxis in methods.md: mixing kinds of page is "at the heart of a
   vast number of problems".)
2. **One headline sentence**: the outcome, with a verb, under about 160 characters. (BLUF and the
   GOV.UK summary rule in methods.md.)
3. **Where it sits**: the project, the stage or goal, and the date. (NN/g "you are here"
   wayfinding.)
4. **A reading path**: 2 to 4 short steps, each saying what the reader will find there, such as
   "How it was checked", never "More". Tapping a step scrolls to that part of the page. Details
   open on request, two levels at most: the step, then the part and what it opens. (Information
   scent and progressive disclosure.)
5. **Evidence for every claim**: the headline links to what backs it: a stored finding with its
   source, a test run, a commit, a decision. (Agent run reports, and the Liu et al. 2023 audit:
   a link the reader can follow, not just a sentence.)

## Then, by purpose

| Purpose       | After the opening                                                                                                                                                          | From methods.md                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Done**      | What changed (show it: before and after, the output). How it was checked, with links. What is left or not done.                                                            | BLUF, agent run reports, inverted pyramid        |
| **Found**     | The main finding is the headline. Why it matters, in one line. 3–5 finding cards, each with its source. How sure, and what is still unknown.                               | Minto pyramid and SCQ, executive summary, GRADE  |
| **Needs you** | The decision and the deadline. The options, each with what it leads to. The agent's recommendation and why. A way to answer: accept or reject a proposed decision, or ask. | ADR, decision memo (not confirmed in methods.md) |

## One example per purpose

**Done.**
_Tag:_ Done · _Where:_ Pharos › R3 Reader-first › 12 Oct
_Headline:_ "Report pages now open with a start-here block that says what the page is for."
_Evidence:_ the test run, the commit.
_Path:_ 1 What changed: the new block, before and after · 2 How it was checked: tests and a phone
check · 3 What is left: two open points.

**Found.**
_Tag:_ Found · _Where:_ Generative UI map › Research › 11 Oct
_Headline (a stored finding):_ "Nobody offers the middle layer, so Pharos keeps its own recipe
format." _Mark:_ Our reading, 11 Oct, 3 sources.
_Path:_ 1 How it is built: five layers, tap one to open it · 2 What it means for us: what to keep
and what to build · 3 Where it comes from: every source, linked.

**Needs you.**
_Tag:_ Needs you · _Where:_ Pharos › R4 Blocks › 12 Oct · _Answer by:_ 15 Oct
_Headline:_ "Choose which two new blocks to build first, by Wednesday."
_Evidence:_ the proposed decision.
_Path:_ 1 The choice: three options and what each leads to · 2 What I recommend: sparklines and
source quotes, and why · 3 How to answer: accept, change or ask.

## What Pharos checks

When an agent saves or previews a report page (any view with a StartHere, ClaimCard or Layers),
Pharos returns warnings. They never block the save; the agent fixes them before saying the page is
ready.

- No StartHere, the StartHere is not first, or more than one.
- The headline is over 160 characters, missing, or has no evidence (no claim and no evidence ids).
- A claim or evidence id, stage or goal isn't in the project; no stage or goal is set when the
  project has some.
- The path has fewer than 2 or more than 4 steps, or a step points at a widget not on the page.
- A _Needs you_ page has no answer-by date.
- The point comes too late: more than 30 words, or another block, before the opening.

Not checked, and left to the agent: that the headline has a verb, that a page keeps to one purpose
below the opening, and the per-purpose parts after it.
