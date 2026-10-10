# Reader's paths: two real cases and a pattern for decisions

2026-10-10 · written by Opus 5.5 · commit 6efa535

> **Design only.** Nothing here is built yet. Text in "quotes" is exactly what the reader sees, and
> the clickable sketches use it word for word.

## In short

- **Case A** opens with "The models built a test for Pharos. The new G1 tests have not run with a real agent." and a picture of the test whose last box, "Results", is empty. The owner
  then judges the work from the work itself: one real test with its answer key, five problems
  shown happening, the release check's actual results, what is left and what it would ask of them,
  and finally their own verdict.
- **Case B** opens with "Generative UI means an AI answers you by putting a view together; Pharos
  puts its views together from tested building blocks and live project data." and a band of four
  approaches with Pharos marked. Then the idea shown working, the map, Pharos's spot, how well it
  does, and two proposals the owner can accept or reject in place.
- **Pattern C** turns a decision into "which situation are you in?" questions, shows only what
  applies, and never lets an uncertain finding look certain or be acted on without saying so.
- Both cases need the same few new building blocks (a reading path, a flow picture, an exhibit of
  real work, a question card; case B also a position map) and new data: claims with source and
  certainty, terms, the reader's answers, and captured excerpts (§5).

## How to read this

This document designs, piece by piece, what the owner should see for two real questions, and a
reusable pattern for a third kind of question:

- **Case A:** "What did the models do in G1, and is it good?"
- **Case B:** "What is Generative UI, and where does Pharos sit?"
- **Pattern C:** a decision that depends on the reader's own situation (the held case; this
  document contains none of its content).

For each case: the reader's starting state, the first screen (one sentence plus one picture), a
path of at most five parts, what stays one click away, every element in detail, a prediction for
the 30-second check, and a check of every fact against its source.

Every element card has the same fields:

| Field         | What it says                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Sees          | The exact words and the picture                                                                   |
| Does          | What happens on click or tap                                                                      |
| Work or words | Whether it **shows the work** itself (the actual output, data or test result) or **describes** it |
| Terms         | Words explained where they appear (the popover texts are in §1.4)                                 |
| Certainty     | Which badge it carries (§1.3) and why                                                             |
| Asks          | Any question the view asks the reader, and what the answer changes                                |
| Maps to       | An **existing** catalog component, a **new** component, or **new data**                           |
| Facts         | Ids in the case's fact table (§2.9, §3.9)                                                         |

A _catalog component_ is one of the 26 kinds of building blocks that Pharos views are made of
(`packages/schema/src/views/catalog.ts:296–333`). A _view_ is a page inside a project, opened from
a tab (the wording of `docs/reframe/goal.md`).

## 1 Shared parts

### 1.1 One onboarding strategy per purpose

Principle 3 of the goal draft asks the agent to choose where the reader starts, by the view's
purpose. These cases need three strategies:

| View's purpose                       | Strategy                                                                                                                                                    | Used by   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Judge work that was done             | **Judge it:** the verdict first, labelled as an agent's reading; then the evidence in the order the reader needs to judge it; the reader's own verdict last | Case A    |
| Learn a topic                        | **Learn it:** show the idea working; then the map; then "you are here"; then strengths and gaps; then what needs the reader                                 | Case B    |
| Decide something that depends on you | **Find your case:** find the reader's situation first; then only what applies to it; act only on firm ground                                                | Pattern C |

### 1.2 The first-screen frame

Every case's first screen has the same order, top to bottom:

1. Sketch label strip: "Sketch with fixed content, 10 Oct 2026. Not live data."
2. Title.
3. **Headline:** one sentence, no unexplained term, ending in a certainty badge.
4. **One picture.**
5. **Needs-you line:** either "Nothing needs you now" with the reason, or the one thing and by when.
6. A certainty or verdict line, when the picture or headline rests on an agent's reading.
7. **The path:** "Look closer, in this order:" and at most five labels, each with a short preview.
   Clicking a label opens that part below the first screen and scrolls to it. Each part ends
   with "Next: {label}" and "Back to the top". Never write "step N of M" anywhere: it was once
   read as "page N of M".
8. **More:** one row of links to everything else, one click away.

Budget: about 80 words of sentences outside the picture and the path. Once the reader has answered
any question, a line appears under the headline: "Your answers so far: …" with a "Change" link.

### 1.3 Certainty badges and status pills

**Certainty badges** (a circle glyph plus a word; never colour alone). They follow principle 4 of
the goal draft (confirmed by the owner, official source, agent's analysis), plus "not known":

| Glyph | Word                 | Popover says                                                                                                                       |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ◆     | "Confirmed by you"   | "You said so: an answer you gave or a decision you made." Plus the date.                                                           |
| ●     | "Verified"           | "Matches an official source, or someone ran it and saw the result." Plus which source or run, who, and when.                       |
| ◐     | "Agent's reading"    | "An AI agent's analysis, for example from reading code or documents. Reasonable, but not tried or confirmed." Plus agent and date. |
| ○     | "Not known yet"      | "An open question." Plus who could answer it.                                                                                      |
| ◐     | "Agent's definition" | "A definition an AI agent wrote for this view. It is not an official standard." Used for the meaning of a term the review defined. |
| ◐     | "Assessed from code" | "An AI agent read the code and concluded how it behaves. Nobody ran it on screen." Used for case B's capability assessment.        |

Rules:

- A summary (a headline, a picture, a verdict) shows the **weakest** badge among the facts it
  rests on.
- Every badge opens a popover: "How we know: …", the date, and a plain source name linked to the
  file. File paths appear only as link targets, never as visible text, because they contain
  task codes.
- Reading Pharos's code and concluding how it behaves is an **agent's reading**. A word-for-word
  quote of code, or of Pharos's own docs, or a result someone ran, is **verified**.
- Proposals are not facts. They carry a dashed label "Proposal, not approved" instead of a badge.

**Status pills** say whether something exists. They are rounded rectangles with text only, a
different shape from the badges: "Built" (solid), "Partly built" (half filled), "Not done yet"
(dashed outline), "None yet" (dashed outline), "Needs you" (warm outline). Never use a check mark
for status: it would read as "verified".

### 1.4 Terms

A term has a dotted underline. Tap or hover opens a small popover; Esc or a tap outside closes
it. A term is explained at its first appearance in **every part**, not only once per page. The
"(In the files: …)" note lets the reader match the plain word to the documents.

| Term               | Popover text                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1                 | "The first stage of Pharos's roadmap: measure how well Pharos works today, so later changes can be compared. Paused since 10 Oct."                                                                                     |
| reframed           | "Rethinking what Pharos views should show, so they help you understand rather than prove what the agents did. Started 10 Oct."                                                                                         |
| view               | "A page inside a project, opened from a tab."                                                                                                                                                                          |
| AI agent           | "An AI program, such as Claude Code, that can read and change things through tools."                                                                                                                                   |
| test situation     | "A realistic thing a person does with Pharos, written down so it can be repeated exactly. (In the files: workflow case.)"                                                                                              |
| practice project   | "A made-up project built for testing, so the right answers are known in advance. (In the files: fixture.)"                                                                                                             |
| answer key         | "The right answer to a test question, written down before any test runs. (In the files: expected facts.)"                                                                                                              |
| test runner        | "A program that sets up a private copy of Pharos with a practice project, asks the question, waits for the agent's view, and records time, cost and correctness. (In the files: harness.)"                             |
| stand-in agent     | "A small fake program that behaves like an AI agent, so the test runner can be tried without a real one."                                                                                                              |
| results            | "How today's Pharos does on the tests, before any improvement. Later versions are compared with them. (In the files: baseline.)"                                                                                       |
| pass mark          | "The result Pharos must reach after improvements to count as better. (In the files: target.)"                                                                                                                          |
| phase              | "A group of jobs in a project. Pharos calls it a stage."                                                                                                                                                               |
| filter             | "A rule that picks which items a building block shows, for example 'tasks due before today'."                                                                                                                          |
| widget             | "One building block placed on a view."                                                                                                                                                                                 |
| README             | "The instructions file at the top of the code, for people setting Pharos up."                                                                                                                                          |
| automated checks   | "Small programs that check the code still works."                                                                                                                                                                      |
| Node.js            | "The program Pharos runs on."                                                                                                                                                                                          |
| polling            | "Checking for changes at a regular interval."                                                                                                                                                                          |
| background service | "Runs Pharos by itself when you log in, and restarts it if it stops."                                                                                                                                                  |
| Overview           | "The view every project gets automatically: stages, a task board and goals."                                                                                                                                           |
| freeze             | "Lock the tests so they can't change between the first results and later ones."                                                                                                                                        |
| Generative UI      | "The AI decides what a view shows and how it is laid out, for your question, instead of a developer designing every view in advance."                                                                                  |
| building block     | "One piece of a view, such as a table, a chart or a number. Pharos has 26 kinds, built and tested in advance; an AI can arrange them but can't add its own. (In the files: component; the set is the closed catalog.)" |
| live project data  | "A building block looks up the project's current data when the view opens and whenever it changes. Nothing is copied into the view."                                                                                   |
| recipe             | "What the AI actually writes: which building blocks go where, and which data each one shows. Pharos draws the view from it. (In the files: view spec.)"                                                                |
| dependency graph   | "A picture of which jobs wait for which."                                                                                                                                                                              |
| MCP                | "The standard way AI agents connect to apps and tools. Agents use it to read and change Pharos projects. (Model Context Protocol.)"                                                                                    |
| token              | "The unit AI models read and write in. More tokens means more time and cost."                                                                                                                                          |
| history            | "Every change to a project or a view is saved with who made it and why, and can be undone."                                                                                                                            |
| field              | "One piece of information on a record, such as a task's due date."                                                                                                                                                     |

### 1.5 Question cards (the view asks the reader)

- A plain question, two to four answers plus "Not sure", then "Why we ask:" (one line) and
  "What happens:" (one line).
- Choosing an answer saves it with the date and shows "Your answer (10 Oct): … · Change".
- Each card says what the answer changes in the view (it narrows or reorders something).
- In the product: a **new component, QuestionCard**, and **new data** (the question, the answer,
  who answered and when). The knowledge-model proposal decides the shape.

### 1.6 Notes for the sketch builder

- One self-contained HTML file per case; no network.
- Phone width: one column; pictures turn vertical; side-by-side comparisons stack ("before" above
  "after").
- Light and dark themes through colour tokens; status and certainty never shown by colour alone.
- Use quoted text verbatim. Where this document says "(illustration)", show that label on the
  page.
- Keep answers in `localStorage` inside try/catch, and add "Reset my answers" to the footer.
- No task codes in visible text. "G1" is allowed, because it is the stage's name and the owner
  uses it; it always has its popover.
- If something here can't be built as written, list the change and the reason in the sketch notes.

## 2 Case A: "What did the models do in G1, and is it good?"

Strategy: **judge it.**

### 2.1 The reader's starting state

- **Knows:** they asked four AI models to run G1; 15 tasks came back done; the "G1 run results"
  view (counts, tables, two notes) didn't help; the "Where you stand" page was shorter but still a
  pile of words; on 10 Oct they paused G1 to reframe Pharos.
- **Doesn't know:** what G1 actually produced; what "baseline", "fixture", "harness", "corpus" or
  "targets" mean; whether the work is any good; whether anything needs them.
- **Won't do:** read the 15 evidence notes (about 46,000 words in all).
- **Wants:** a judgment they can trust because they have seen the evidence with their own eyes.

What went wrong before, and what this design does instead:

| Counter-example                                                                                                                            | This design                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| "G1 run results" led with counts ("x of y tasks done", "done by model subagents", a chart by model), then tables of task titles with codes | Leads with what exists and what doesn't, as a picture; no counts by model; no task titles on the first screen |
| Its notes named codes and files ("W1.8", "Q01–Q26", `docs/evidence/G1/W1.7-review.md`)                                                     | No codes in visible text; files only behind links                                                             |
| "Where you stand" used "Step 1 is mostly built", read as "page 1 of 5"                                                                     | No "step N"; parts have names                                                                                 |
| Both said findings in words ("Stale writes win silently")                                                                                  | Each finding is shown happening, on the practice project                                                      |

### 2.2 The first screen

Desktop wireframe (the phone puts everything in one column, with the picture vertical):

```
┌─ Sketch with fixed content, 10 Oct 2026. Not live data. ───────────────────────────────┐
│ What the models did in G1                                                               │
│ The models built a test for Pharos. The new G1 tests have not run with a real           │
│ agent. ●                                                                                │
│                                                                                         │
│ [Practice projects]→[Questions and   ]→[An AI agent   ]→[Check the view  ]→┌ Results ┐ │
│  Built: 2            answer keys        answers with a   against the key    │None yet │ │
│                      Built: 3 test      view             Partly built       └─ ─ ─ ─ ┘ │
│                      situations         Not done yet                                    │
│ └──────── Test runner: does all of this by itself. Built; tried only with a stand-in ───┘│
│                                                                                         │
│ Needs you: nothing now. G1 has been paused since 10 Oct while Pharos is reframed.  ◆    │
│ Earlier evidence, limited: one six-question trial; not enough runs to establish         │
│   repeatable quality.                                                                   │
│ ◐ Agent's reading: Useful test material; whether it helps a reader is untested.         │
│   Not independent: Opus 5.5 wrote this verdict and three of the test situations. The    │
│   rules come to about 21,000 words and 26 questions (a count); that looks like more     │
│   than one person can review (a reading).                                               │
│ Also in G1: The public copy passed installation and code checks. The instructions were  │
│   improved afterward; checking the updated release again and trying the background      │
│   service remain open.  ●                                                               │
│                                                                                         │
│ Look closer, in this order:                                                             │
│ 1 One test, up close · 2 Problems it turned up · 3 The release check ·                  │
│ 4 What's left before results · 5 Your verdict                                           │
│ More: All 15 finished tasks · Proposed pass marks · The 26 questions for you · …        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 The path

| Order | Label                        | Preview (small text)                                              | What the reader can judge there           |
| ----- | ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| 1     | "One test, up close"         | "a practice project, a question, the right answer"                | Does the test ask something worth asking? |
| 2     | "Problems it turned up"      | "five ways Pharos can mislead you or lose work"                   | Did the work find anything real?          |
| 3     | "The release check"          | "the public copy, installed from scratch, and what is still open" | Can the published version be trusted?     |
| 4     | "What's left before results" | "and what it would ask of you"                                    | Is the rest worth its cost to the reader? |
| 5     | "Your verdict"               | "is this work good?"                                              | The reader's own answer, kept             |

### 2.4 Elements on the first screen

**A1 · Headline**

- Sees: "The models built a test for Pharos. The new G1 tests have not run with a real agent." followed by a ● badge.
- Does: badge popover: "How we know: the work that would run the test isn't done, and the test
  runner has only been tried with a stand-in agent. Checked 10 Oct in the project records and the
  runner's notes."
- Work or words: describes (the whole answer in one sentence); the picture below shows it.
- Terms: G1 (in the title).
- Certainty: ● Verified.
- Asks: nothing.
- Maps to: existing **Text** (fixed content) plus **new data** for its badge (a claim with
  certainty, source and date).
- Facts: A-F3, A-F10, A-F12, A-F27.

**A2 · Picture: "How the test works, and what exists"**

- Sees: five boxes joined by arrows, left to right (top to bottom on a phone). No numbers on the
  boxes. The "Results" box is the widest, dashed and empty, so the eye lands on what is missing.

  | Box label                               | Small text                                                          | Pill                                                             |
  | --------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | "Practice projects"                     | "Made-up projects with known right answers"                         | "Built: 2"                                                       |
  | "Questions and answer keys"             | "What a person would ask, and the right answer, written in advance" | "Built: 3 test situations"                                       |
  | "An AI agent answers with a view"       | "The part being tested"                                             | "Not done yet", with the line "Tried only with a stand-in agent" |
  | "Check the view against the answer key" | "Done by a program"                                                 | "Partly built"                                                   |
  | "Results"                               | "How today's Pharos does"                                           | "None yet"                                                       |

  A bracket under all five boxes: "Test runner: does all of this by itself. Built; tried only
  with a stand-in agent."

- Does: the first two boxes open part 1; the last two open part 4; the middle box and the
  bracket open a popover: "The test runner is built, and its 13 automated checks pass. It has
  only been tried with a stand-in agent. It can't yet measure how long it takes until a view is
  useful, or how much a person has to fix."
- Work or words: describes the structure, but every pill is a checked fact and every box opens
  the actual work.
- Terms: practice project, answer key, test situation, AI agent, view, stand-in agent, test
  runner, results.
- Certainty: ● Verified; each pill's popover names its source.
- Asks: nothing.
- Maps to: **new component, Flow** (boxes, arrows, a status pill and a link per box, an optional
  bracket). The statuses come from existing task data, but task titles start with codes, so the
  boxes need **plain labels (new data, or a naming convention)**.
- Facts: A-F4, A-F5, A-F10, A-F11, A-F12.

**A3 · Needs-you line**

- Sees: "Needs you: nothing now. G1 has been paused since 10 Oct while Pharos is reframed." with
  a ◆ badge.
- Does: popovers on "G1" and "reframed".
- Work or words: describes.
- Terms: G1, reframed.
- Certainty: ◆ Confirmed by you (you accepted the reframe decision on 10 Oct).
- Asks: nothing.
- Maps to: existing **Text**, with a live count of open tasks assigned to the owner in G1 while G1
  is active. Choosing the words ("nothing now" or "2 things") needs **conditional wording in Text
  (an extension)**.
- Facts: A-F2, A-F3.

**A4 · Agent's-reading line**

- Sees: "◐ Agent's reading: Useful test material; whether it helps a reader is untested. Not independent: Opus 5.5 wrote this verdict and also wrote three of the test situations and the pass marks. The rules and pass marks come to about 21,000 words and 26 questions for you (a count). That looks like more than one person can review (a reading)." The self-review disclosure is visible text beside the verdict, not only in the popover. A second small line follows the headline area: "Earlier evidence, limited: before G1, one trial had six AI agents each answer one question. All six views were clean, but six runs are not enough to establish repeatable quality." with a link to part 4.
- Does: badge popover: "Written by Opus 5.5 on 10 Oct. The evidence is in the five parts below; 'Your verdict' is where you give yours."
- Work or words: describes (a judgment).
- Terms: none.
- Certainty: ◐ Agent's reading.
- Asks: nothing (part 5 asks).
- Maps to: existing **Callout** plus **new data** (a claim with certainty, author and date).
- Facts: A-F8, A-F13 to A-F18, A-F29, A-F31, A-F35.

**A5 · Release line**

- Sees: "Also in G1: The public copy passed installation and code checks. The instructions were improved afterward; checking the updated release again and trying the background service remain open." with a ● badge.
- Does: opens part 3.
- Work or words: describes; part 3 shows the work.
- Terms: none.
- Certainty: ● Verified.
- Asks: nothing.
- Maps to: existing **Text** with a link.
- Facts: A-F22 to A-F26.

**A6 · Path** — as in §2.3. Maps to: **new component, ReadingPath** (ordered parts that open in
place; no existing component can open or target a widget). Work or words: describes (navigation).
Terms: none. Certainty: none (navigation only). Asks: nothing.

**A7 · More row** — "More: All 15 finished tasks · Proposed pass marks · The 26 questions for you ·
The test runner · What changed in the code · Earlier views". Each item is described in §2.6. Work or
words: describes (navigation). Terms: none. Certainty: none. Asks: nothing.

### 2.5 Elements in the five parts

#### Part 1 · "One test, up close"

**A10 · Intro**

- Sees: "Each test situation asks a realistic question about a practice project whose right
  answer was written down in advance. This is one of three."
- Work or words: describes. Terms: test situation, practice project. Certainty: ● Verified.
  Asks: nothing. Maps to: existing **Text**. Facts: A-F5.

**A11 · The practice project, and "try it first"**

- Sees: a header "Practice project: Workshop renovation. Its 'today' is fixed at 7 Oct 2026, so
  every date is compared with 7 Oct." Above the table, a speech bubble: "What is holding up
  installation?" Then the project's seven jobs:

  | Job                              | Phase        | Status                | Due    | Waits on                 |
  | -------------------------------- | ------------ | --------------------- | ------ | ------------------------ |
  | Measure work surfaces            | Preparation  | Signed off            | 7 Oct  | —                        |
  | Order lighting materials         | Installation | Queued                | 6 Oct  | —                        |
  | Fit workshop lighting            | Installation | Waiting for materials | 6 Oct  | Order lighting materials |
  | Paint prepared work area         | Installation | Queued                | 10 Oct | Measure work surfaces    |
  | Book inspection slot             | Installation | Queued                | 17 Oct | Fit workshop lighting    |
  | Cancel exterior extension option | Preparation  | Cancelled             | 4 Oct  | —                        |
  | Clear temporary storage area     | —            | Queued                | —      | —                        |

  Above the table: "Try it first: tap the jobs you think are holding up installation, then
  'Show the answer key'."

- Does: rows toggle as picks; the button reveals A12.
- Work or words: **shows the work**: the actual practice project the models built.
- Terms: practice project, phase.
- Certainty: ● Verified (the project file).
- Asks: the try-it question (not kept; it is for the reader's own judgment).
- Maps to: **new component, Exhibit**, with a "try it first" option. A view can only query its
  own project, and this data lives in a practice project, so it needs **new data: a captured
  excerpt with source and date**.
- Facts: A-F6.

**A12 · The answer key**

- Sees: each row gets a tag and a reason:

  | Job                              | Tag             | Reason                                         |
  | -------------------------------- | --------------- | ---------------------------------------------- |
  | Order lighting materials         | "Holding it up" | "Late: was due 6 Oct, still queued"            |
  | Fit workshop lighting            | "Holding it up" | "Late, and waiting for the materials order"    |
  | Book inspection slot             | "Holding it up" | "Can't start until the lighting is fitted"     |
  | Cancel exterior extension option | "Trap"          | "Its date has passed, but it was cancelled"    |
  | Paint prepared work area         | "Trap"          | "It waits on measuring, which is already done" |
  | Clear temporary storage area     | "Trap"          | "No date, and nothing in its way"              |
  | Measure work surfaces            | "Not relevant"  | "Finished, and part of the earlier phase"      |

  Then: "You picked {a} of the 3, and {b} of the 3 traps." (only if the reader picked anything).
  A trap is a job a careless answer would list; the test fails an answer that lists one.

- Does: nothing more.
- Work or words: **shows the work**: the real answer key and the traps.
- Terms: answer key.
- Certainty: ● Verified (see A14).
- Asks: nothing.
- Maps to: the same **Exhibit** (reveal state).
- Facts: A-F7.

**A13 · The three test situations**

- Sees: three small cards, each with a byline "Written by Opus 5.5 · checked by GPT-6.1-Sol":
  - "Ask what's at risk" — "You ask a question; an agent answers with a view. Is it right, and can
    you read it at a glance?" — marked "This one".
  - "Adjust a generated view" — "You change what a table shows. Does Pharos keep your change after
    an agent edits the same view?" — with the note "Can't be done in today's Pharos: the test will
    record 'not possible'." and a ◐ badge.
  - "Tick off a task, come back later" — "You mark a task done from a view. Does every view agree
    right away, and is the view still right days later?"
- Does: each card links to its evidence note (link target only).
- Work or words: describes.
- Terms: test situation, view.
- Certainty: ● Verified for what each tests; ◐ for "can't be done" (read in the code).
- Asks: nothing.
- Maps to: existing **DataList** over the three case documents as artifacts, which needs a plain
  one-line summary on each (**new data or a convention**).
- Facts: A-F5, A-F35, A-F36, A-F37.

**A14 · How sure is the answer key?**

- Sees: two separate questions. "1. Does the answer key match its own rules?" "● Verified: yes, on the made-up practice projects. The answer key matches what Pharos's own filters return, and the automated checks confirm it." "2. Do the rules match what you mean by risk?" "○ Not known yet: nobody has checked these rules against what you mean; 'What counts as at risk?' is the first of the 26 questions for you." Then: "A second
  AI model, from another company, then checked all three test situations: 45 issues, each fixed
  or accepted with a reason. One of them:" and two panels:
  - Before: "First draft: the answer key used made-up task names, written before the practice
    project was built. It expected 5 tasks at risk."
  - After: "After the check: matched to the real project. 4 tasks at risk."
  - Caption: "(This was in the other practice project, 'Catalog delivery'.)"
- Does: nothing more.
- Work or words: **shows the work**: an actual correction the review made.
- Terms: filter, practice project.
- Certainty: ● Verified.
- Asks: nothing.
- Maps to: **Exhibit** in compare mode (two panels) plus **new data** (the claim).
- Facts: A-F7, A-F8, A-F9.

**A15 · Question**

- Sees: "Is this the kind of question you'd really ask Pharos?" — "Yes" / "Partly" / "No" / "Not
  sure". "Why we ask: if the tests ask the wrong things, good results would mean little." "What
  happens: your answer is kept and shown in 'Your verdict'."
- Work or words: asks. Terms: none. Certainty: the answer counts as ◆ once given.
- Asks: yes, kept. Maps to: **QuestionCard** (new) plus **new data** (the answer).

#### Part 2 · "Problems it turned up"

**A20 · Intro**

- Sees: "To write the tests, the models read Pharos closely and found these five problems. None
  is fixed yet." with a ● badge on "None is fixed yet" (Pharos's code hasn't changed since the
  published version, apart from new automated checks).
- Work or words: describes. Terms: none. Certainty: ● on "None is fixed yet". Asks: nothing.
- Maps to: existing **Text**. Facts: A-F19.

Part 2 opens with one sentence: "In one sentence: one problem is confirmed by running it (cancelled work counted as late); the other four are findings from reading the code that nobody has yet seen on screen. Pick a problem to see the detail." Each problem is first a short selectable summary (title plus one sentence; for example "Confirmed by running it: a cancelled task is listed as late."); the detail below opens on selection. Each problem card has the same layout: a plain title; "What you'd see" (a small demonstration);
"Why it matters" (one line); a certainty badge with "How we know"; "What happens next".

**A21 · "Pharos's own example counts cancelled work as late"**

- Sees: two panels side by side:
  - Left, "Pharos's example filter 'Blocked or overdue', on the workshop project": "Order lighting
    materials · Queued · due 6 Oct", "Fit workshop lighting · Waiting for materials · due 6 Oct",
    "Cancel exterior extension option · Cancelled · due 4 Oct" (this row marked "Wrong: it was
    cancelled").
  - Right, "What's really blocked or late": the first two rows only.
  - "Why it matters: Pharos gives this example to agents as a pattern to copy, so their views can
    warn you about cancelled work."
  - "What happens next: not fixed. The suggestion is to fix it after the first results, so the
    test can show the difference. That's one of the questions for you."
- Work or words: **shows the work**: the example's real output on the practice project.
- Terms: filter.
- Certainty: ● Verified: "Ran the example on both practice projects (7 Oct, and again on 10 Oct);
  it lists a cancelled task in both."
- Asks: nothing.
- Maps to: **Exhibit** (compare) plus **new data** (a finding with certainty and status).
- Facts: A-F13, A-F21.

**A22 · "Some task views say 'No tasks yet' when nothing matches"**

- Sees: (illustration, on the practice project "Catalog delivery")
  - Left: a task list titled "Blocked or late in Foundation" showing "No tasks yet".
  - Right: "Foundation has 2 tasks, both finished: 'Define catalog data shape' and 'Record
    baseline import'. The honest message is 'Nothing matches'."
  - "Why it matters: it tells you a phase is empty when it is actually finished."
  - "What happens next: not planned yet. Whether to require 'Nothing matches' is one of the
    questions for you."
- Work or words: shows the work (what the code would display), labelled as an illustration, not a
  screenshot.
- Terms: phase.
- Certainty: ◐ Agent's reading: "Read in the code; not yet seen on screen."
- Asks: nothing (A26 asks about all five).
- Maps to: **Exhibit** (compare) plus **new data** (finding).
- Facts: A-F14, A-F15, A-F21.

**A23 · "If you and an agent change the same thing at nearly the same moment, one change is lost
without a warning"**

- Sees: (illustration, on "Catalog delivery") a two-lane timeline, "You" and "An agent":
  1. You: "Your view shows 'Document rollback path: Queued'."
  2. An agent: "Sets it to 'Waiting'." with the note "Your view hasn't caught up yet; that can take
     about a second."
  3. You: "You tick it done."
  4. Result, across both lanes: "Saved as done (in this project the word is 'Accepted'). The
     agent's 'Waiting' is gone. Neither of you is told. History still has it."
  - "Why it matters: work can quietly disappear."
  - "What happens next: planned in a later stage (protecting your changes from being
    overwritten), paused with the roadmap."
- Work or words: shows the work as a re-enactment; labelled as an illustration.
- Terms: history.
- Certainty: ◐ Agent's reading: "Read in the code; not yet reproduced."
- Asks: nothing (A26 asks about all five).
- Maps to: **Exhibit** (a sequence) plus **new data** (finding).
- Facts: A-F16, A-F20.

**A24 · "You can't change what a generated table or chart shows"**

- Sees: a small copy of the settings dialog for a table an agent made: one field, "Title", then
  the grey text "Other settings for this widget can be changed by your agent." and "Cancel" and
  "Save" buttons. Caption: "For a table or chart an agent made, the title is all you can change:
  no filter, no columns, no grouping. One of the three test situations ('Adjust a generated view')
  can't be done in today's Pharos."
  - "What happens next: planned in a later stage (letting you adjust views yourself), paused."
- Work or words: **shows the work**: the dialog's real content, quoted from the code.
- Terms: widget (it appears in the quoted text), filter.
- Certainty: ● Verified for the quoted text; ◐ Agent's reading for "the title is all you can
  change" (read in the code).
- Asks: nothing (A26 asks about all five).
- Maps to: **Exhibit** plus **new data** (finding).
- Facts: A-F17, A-F20, A-F36.

**A25 · "Ticking a task done has no Undo, and a second click can reopen it"**

- Sees: (illustration) a task row with a round checkbox. First click: the row shows "Done", and no
  Undo appears. The view refreshes. Second click: the task is reopened, shown as "Queued", with the note
  "Recorded as a second change; the status may not be the one it had before."
  - "Why it matters: a slip of the mouse changes your project, and No Undo button; a second click reopens the task as another change, or History can revert it."
  - "What happens next: planned in a later stage (one safe task action, with Undo), paused."
- Work or words: shows the work as a re-enactment; labelled as an illustration.
- Terms: history.
- Certainty: ◐ Agent's reading: "Read in the code; not yet reproduced."
- Asks: nothing (A26 asks about all five).
- Maps to: **Exhibit** plus **new data** (finding).
- Facts: A-F18, A-F20.

**A26 · Question**

- Sees: "Do these problems matter to you?" — "Yes" / "Some of them" / "Not really" / "Not sure".
  "Some of them" opens a tick list of the five titles. "Why we ask: it helps decide what to fix
  first if G1 restarts." "What happens: kept, and shown in 'Your verdict'."
- Work or words: asks. Terms: none. Certainty: the answer counts as ◆ once given.
- Maps to: **QuestionCard** (new) plus **new data**.

#### Part 3 · "The release check"

**A30 · Intro**

- Sees: "On 7 Oct Pharos was published as an early preview, version 0.1.0. G1 re-checked it the
  way a newcomer would meet it: a fresh copy and only the README."
- Work or words: describes. Asks: nothing.
- Terms: README. Certainty: ● Verified. Maps to: existing **Text**. Facts: A-F22.

**A31 · What was run**

- Sees: first, beside the results, a box: "Open. Read this first. The public copy passed installation and code checks. The instructions were improved afterward; checking the updated release again and trying the background service remain open." Then a list headed "Run on 7 Oct, on the public copy, before the later instruction fixes", one line per check, each with a pill "Passed":
  - "Install, following the README"
  - "Code checks: types, style and formatting"
  - "207 automated checks, in about 5 seconds"
  - "Build" — with "(one warning: the app's main file is large. It did not stop the build; nobody measured whether it slows the app.)"
  - "Connect an AI agent and read a project"
  - "GitHub's own automatic checks for the same version, on 3 versions of Node.js"
    - A separate small card, "Run later, on a newer version": "Settings view in a real browser: the dark theme stays after reloading; pausing automatic answers in one tab shows in another; 'answering off' explains itself" (Passed).
- Does: "Show the recorded check summary" toggles the table of recorded summaries from the evidence (the full logs were kept elsewhere).
- Work or words: **shows the work**: the actual outcomes.
- Terms: automated checks, Node.js, AI agent.
- Certainty: ● Verified (ran it).
- Asks: nothing (A34 asks).
- Maps to: **Exhibit** (captured output) plus **new data** (claims).
- Facts: A-F23, A-F24.

**A32 · One of the fixes**

- Sees: "Seven fixes to the README and the contributor guide, made after the 7 Oct checks. The checks above did not test them. For example:" and two panels:
  - Before: "…the web app picks up its changes within a second."
  - After: "Changes it makes are found by polling about once a second, so the web app normally
    shows them within a few seconds."
- Work or words: **shows the work**: the actual before and after text.
- Terms: polling, README. Certainty: ● Verified.
- Asks: nothing.
- Maps to: **Exhibit** (compare). Facts: A-F25.

**A33 · Not checked**

- Sees: a dashed box with the pills "Open" and "Needs you": "Not re-run: the fresh install and GitHub checks on the updated release." and "Not checked: the background service, which starts Pharos when you log in. Trying it would have replaced the copy you use, so it waits for you, if G1 restarts."
- Work or words: describes a gap in the work. Asks: nothing.
- Terms: background service. Certainty: ● Verified. Maps to: existing **Callout**. Facts: A-F26.

**A34 · Question**

- Sees: "Is this enough for you to trust the public copy for now, with the repeat check and the service still open?" — "Yes" / "No" / "Not
  sure". "What happens: kept, and shown in 'Your verdict'."
- Work or words: asks. Terms: none. Certainty: the answer counts as ◆ once given.
- Maps to: **QuestionCard** (new) plus **new data**.

#### Part 4 · "What's left before results"

**A40 · What still has to happen**

- Sees: a header line "Paused since 10 Oct. None of this needs you now." Then a vertical chain,
  no numbers, the two "You" items with a "Needs you" pill:
  - "You approve the test rules" — "26 questions, each with a suggested answer"
  - "Freeze the set of tests"
  - "Build the program that checks agent answers automatically"
  - "Measure the plain Overview view, with no agent"
  - "Measure today's agent-made views, each test at least 3 times" — "uses paid agent runs"
  - "Score how much fixing each view needs"
  - "Write the first results report"
  - "You accept the report"
- Work or words: describes the plan; each item opens its task.
- Terms: Overview, freeze, results.
- Certainty: ● Verified (the project's open tasks).
- Asks: nothing (A43 asks).
- Maps to: **Flow** (new) over existing task data, with **plain labels** (new data or
  convention). Existing **DependencyGraph** would draw the same tasks, but with coded titles.
- Facts: A-F27, A-F28.

**A41 · What it would ask of you**

- Sees: four items:
  1. "Answer 26 questions about the test rules." Below it, two panels:
     - As written: "What counts as risk? … Blocked ∪ overdue open ∪ unfinished-dependency
       obstruction; due soon is labelled context."
     - In plain words, labelled "Rewritten for this view": "When you ask 'what's at risk?', should
       a view list only work that is blocked, late, or waiting on unfinished work, and show 'due
       soon' work separately?"
  2. "Read the rules before approving them: the three test situations and the pass marks come to
     about 21,000 words." Beside it, four bars sized by words: "Ask what's at risk: 4,700",
     "Adjust a generated view: 4,700", "Tick off a task: 4,700", "Pass marks: 6,900".
  3. "Read about 46 test answer views for the first results, and about 100 by the end, to check
     each can be read at a glance. Or hand this to another reader."
  4. "Run the background-service check yourself."
- Work or words: **shows the work**: a real question as written, and its length.
- Terms: pass mark, background service.
- Certainty: ● Verified for items 1 (as written), 2, 3 and 4; the rewrite is marked as this view's
  own wording.
- Asks: nothing (A43 asks).
- Maps to: **Exhibit** (compare) for the question; existing **CountChart** cannot draw word
  counts from documents, so the bars need **new data** (a number on each document) or a simple
  bar option in Exhibit.
- Facts: A-F29, A-F30, A-F31.

**A42 · Already known about Pharos's quality**

- Sees: a small box: "One earlier trial, before G1: six AI agents each answered one question about
  a copy of Pharos's own project. All six views were clean, and the two counts that were checked (overdue,
  due this week) were exact. Not enough runs to establish repeatable quality, which is why G1 set out to build a proper test."
- Terms: none. Asks: nothing.
- Work or words: describes a result. Certainty: ● Verified. Maps to: existing **Callout** plus
  **new data** (claim). Facts: A-F1, A-F32.

**A43 · Question**

- Sees: "Is the rest worth doing, given what it asks of you?" — "Yes, as planned" / "Yes, but
  smaller" / "No" / "Not sure". "What happens: kept, and shown in 'Your verdict'."
- Work or words: asks. Terms: none. Certainty: the answer counts as ◆ once given.
- Maps to: **QuestionCard** (new) plus **new data**.

#### Part 5 · "Your verdict"

**A50 · Your answers so far**

- Sees: four rows, one per part: the part's name and the reader's answer, or "Not answered" with
  a link back to that part.
- Work or words: shows the reader's own answers. Terms: none. Certainty: ◆ on each answer.
  Asks: nothing new.
- Maps to: **QuestionCard** summary mode (new) over the kept answers.

**A51 · Overall question**

- Sees: "Overall, is the G1 work good?" — "Good: keep it for if G1 restarts" / "Good, but change
  it first" / "Not worth continuing" / "Not sure yet". Choosing "Good, but change it first" opens
  "What should change? (pick any)": "Also test whether I can tell where I stand" / "Make it
  smaller" / "Fewer questions for me" / "Something else" (a text box).
- Does: kept; next time, the answer appears under the headline ("Your verdict (10 Oct): …").
  "Why we ask: your verdict decides what happens to this work after the reframe."
- Work or words: asks. Terms: none. Certainty: the answer counts as ◆ once given.
- Asks: yes, kept. Maps to: **QuestionCard** (new) plus **new data**.

**A52 · The agent's reading, in full**

- Sees: a box headed "◐ Agent's reading · Opus 5.5 · 10 Oct", with the note "Opus 5.5 also wrote
  three of the test situations and the pass marks." Four short points:
  - "Worth keeping: the answer keys are concrete, were checked by running them on made-up data, and a second model caught real mistakes in the first drafts."
  - "Already useful: writing the tests exposed one problem confirmed by running it (the cancelled-work example) and four more found by reading the code, like a task view saying 'No tasks yet' when nothing matches."
  - "Not good yet: the new tests have not run with a real agent, and the rules grew to about 21,000 words and 26 questions before you saw anything. The work ran ahead of you."
  - "A gap: only one of the three test situations checks whether a person can read the view at a
    glance; the other two check that views are correct and keep your changes. None asks whether
    you know where you stand." A fifth point: "Untested: whether a reader finds the results easier to understand. Nobody has tried it with you yet." The note under the heading reads "Not independent: Opus 5.5 also wrote three of the test situations and the pass marks."
- Work or words: describes (a judgment), after the evidence.
- Certainty: ◐ Agent's reading.
- Terms: none. Asks: nothing (A51 asks).
- Maps to: existing **Callout** plus **new data** (claims with certainty and author).
- Facts: A-F7 to A-F9, A-F13, A-F14, A-F29 to A-F31, A-F34.

### 2.6 One click away (the "More" row)

| Link                       | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Maps to                                                    | Facts        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ |
| "All 15 finished tasks"    | A table: what each produced (plain words), which model did it, link to its evidence note                                                                                                                                                                                                                                                                                                                                                                               | existing **DataTable** over tasks; plain titles needed     | A-F3, A-F35  |
| "Proposed pass marks"      | Dashed "Proposal, not approved" label, then four lines for "Ask what's at risk": "At least 9 in 10 facts right in the first answer, and at most 2 points below today's", "At least 4 in 5 answers fully usable, with half as many failures as today (up to 9 in 10 usable)", "Typically useful within 45 seconds, and at most a quarter slower than today", "Typically at most 1 US dollar per answer and never more than 2, and at most a quarter above today's cost" | existing **DataList** over **new data** (proposal records) | A-F33        |
| "The 26 questions for you" | The questions in plain words, each with its suggested answer; header "Paused: none needed now"                                                                                                                                                                                                                                                                                                                                                                         | **QuestionCard** list (new)                                | A-F8, A-F30  |
| "The test runner"          | What it does, the 13 automated checks that pass, "tried only with a stand-in agent", and what it can't measure yet                                                                                                                                                                                                                                                                                                                                                     | existing **Text** plus **new data**                        | A-F10, A-F11 |
| "What changed in the code" | "Pharos's app code: unchanged. Added: two practice projects, the test runner and its automated checks, 15 evidence notes. Fixed: the README and the contributor guide."                                                                                                                                                                                                                                                                                                | **Exhibit** (captured file list)                           | A-F19, A-F25 |
| "Earlier views"            | Links to "G1 run results" and "Where you stand", labelled "Earlier attempts, kept for reference"                                                                                                                                                                                                                                                                                                                                                                       | existing tabs                                              | —            |

Left out on purpose: counts by model, a chart of finished tasks, and any table of task titles on
the first screen. The bylines on each piece of work answer "which model did what".

### 2.7 How case A maps to the catalog

| Element                               | Existing          | New component                       | New data                                        |
| ------------------------------------- | ----------------- | ----------------------------------- | ----------------------------------------------- |
| A1 headline, A5, A10, A20, A30        | Text              | —                                   | claim with certainty                            |
| A2 picture, A40                       | (task data)       | Flow                                | plain labels on tasks                           |
| A3 needs-you                          | Text (live count) | — (extension: conditional words)    | —                                               |
| A4, A42, A52                          | Callout           | —                                   | claim with certainty, author, date              |
| A6 path                               | —                 | ReadingPath                         | —                                               |
| A11, A12, A14, A21–A25, A31, A32, A41 | —                 | Exhibit (compare, try-it, sequence) | captured excerpt with source and date; findings |
| A13                                   | DataList          | —                                   | plain summary on case documents                 |
| A33                                   | Callout           | —                                   | —                                               |
| A15, A26, A34, A43, A50, A51          | —                 | QuestionCard                        | reader question and answer                      |

### 2.8 The 30-second check: prediction

**After 30 seconds the owner should be able to say:**

1. "They built a test, but the new tests haven't run with a real agent."
2. "Nothing needs me now; G1 is paused."
3. "The agent thinks it's useful test material but oversized, with no proof yet that it helps a reader, and I can check that myself in five parts."

**Why it should pass:** the headline answers "what did they do" without jargon; the empty
"Results" box shows the main fact without reading; the needs-you line comes before any detail;
the path labels are concrete; no counts compete for attention.

**What would make it fail:**

- The picture is read as progress ("four of five boxes, nearly there"). Guard: no numbers on the
  boxes; "Results" is the largest box, dashed and empty; the pills say "Not done yet" and "None
  yet".
- "Test" is mixed up with "207 automated checks" or the "test runner". Guard: three different
  words, and "test situation" for the three cases.
- "Paused" is read as the Settings switch that pauses automatic answers. Guard: always "G1 has
  been paused"; the Settings check always says "pausing automatic answers".
- The agent's-reading line is taken as a fact, or as the owner's own view. Guard: the ◐ badge,
  the "Agent's reading:" prefix, and the note that Opus 5.5 judges partly its own work.
- More than about 80 words of sentences outside the picture, or a popover needed to understand
  the headline.
- The owner wants "which model did best", the old view's framing, and doesn't find it on the
  first screen. Accepted on purpose: bylines on each piece of work, no scoreboard.

**How to check it when the owner tries the sketch:** after 30 seconds, ask "Has the test been
run?" (expected: no), "Does anything need you?" (no), "How close is G1 to giving results?" (not
close: several things are still needed), and "Where would you look to decide whether it's good?"
(the five parts, ending in "Your verdict").

### 2.9 Fact check for case A

Sources: repository files at commit 6efa535, and two snapshots exported for this work (not in the
repository): the Pharos project data and the Generative UI map project data, cited by record
title.

| Id    | Fact as used                                                                                                                                                                                                                                  | Source                                                                                                                                                                                                      | How it was checked                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A-F1  | G1 is the first roadmap stage: write workflows and a versioned test set, choose pass marks before comparing, take first measurements, re-check the old release gate                                                                           | `docs/PLAN.md:19`; Pharos project data, stage "G1 · Establish the workflow baseline" (description)                                                                                                          | Read                                                                      |
| A-F2  | G1 paused since 10 Oct while Pharos is reframed; the owner accepted the reframe decision                                                                                                                                                      | The coordinator's applied R1 plan (Pharos revision 281, 10 Oct): stage G1 set to Planned, decision "Reframe Pharos around the reader" accepted, decided by the owner; R1 brief                              | Read the applied plan record; the live instance was not read (off limits) |
| A-F3  | 15 G1 tasks finished by the four models; 12 G1 tasks open, 2 of them the owner's                                                                                                                                                              | Pharos project data, tasks in stage G1                                                                                                                                                                      | Counted: 17 done (2 earlier, by another agent), 12 open                   |
| A-F4  | Two practice projects: "Catalog delivery" (10 tasks) and "Workshop renovation" (7 jobs)                                                                                                                                                       | `docs/evidence/G1/W3.1-fixtures.md:20–33`; `eval/fixtures/catalog-delivery.json`, `eval/fixtures/workshop-renovation.json`                                                                                  | Read; listed by script                                                    |
| A-F5  | Three test situations, each revised after the review                                                                                                                                                                                          | `docs/evidence/G1/W1.2-case-A-risks.md:7`, `W1.3-case-B-refine.md:9`, `W1.4-case-C-act-reuse.md:14` (version 2.0.0); `W1.7-review.md:7–10`                                                                  | Read                                                                      |
| A-F6  | The seven workshop jobs: phase, status label, due date, what each waits on; "today" fixed at 7 Oct 2026                                                                                                                                       | `eval/fixtures/workshop-renovation.json` (tasks, options, `today`)                                                                                                                                          | Read; listed by script on 10 Oct                                          |
| A-F7  | Key for "What is holding up installation?": material order, fitting, inspection booking; must not show the cancelled extension, painting, cleanup                                                                                             | `W1.2-case-A-risks.md:301`; `eval/fixtures/workshop-renovation.json` (`expected`), asserted by `apps/server/src/eval-fixtures.test.ts`                                                                      | Read; the late-or-blocked half re-run on 10 Oct                           |
| A-F8  | A second model from another company found 45 issues, each fixed or accepted; 26 questions for the owner                                                                                                                                       | `W1.7-review.md:233` (45 ids, 26 questions); `:27–90`; `:182–216`                                                                                                                                           | Read                                                                      |
| A-F9  | The first draft's key used made-up task names, written before the project was built, and expected 5 at risk; the real answer is 4                                                                                                             | `W1.7-review.md:37` (finding R02)                                                                                                                                                                           | Read                                                                      |
| A-F10 | Test runner built; tried with a stand-in agent; 13 automated checks pass; never run with a real agent                                                                                                                                         | `W3.3-harness.md:7`, `:69`; Pharos project data, task "Build the baseline harness runner" (result note)                                                                                                     | Read                                                                      |
| A-F11 | The runner can't yet measure time until a view is useful, or how much a person must fix                                                                                                                                                       | `W3.3-harness.md:40`                                                                                                                                                                                        | Read                                                                      |
| A-F12 | The automatic answer checker isn't built; the runner checks one sample                                                                                                                                                                        | Pharos project data, task "Implement automatic fact checks for answer views" (todo); `W3.3-harness.md:40`                                                                                                   | Read                                                                      |
| A-F13 | Pharos's "Blocked or overdue" example lists cancelled tasks; on the workshop project it lists the material order, the fitting and the cancelled extension                                                                                     | `apps/server/src/guidance.ts:43`; `W1.2-case-A-risks.md:188`, `:300–301`                                                                                                                                    | Re-run on 10 Oct on both practice projects (§6)                           |
| A-F14 | A filtered task list with no matches says "No tasks yet"                                                                                                                                                                                      | `apps/web/src/catalog/components/work.tsx:330`, `:591`; `W1.2-case-A-risks.md:299`                                                                                                                          | Read the code at 6efa535                                                  |
| A-F15 | Foundation in "Catalog delivery" has 2 tasks, both Accepted ("Define catalog data shape", "Record baseline import")                                                                                                                           | `eval/fixtures/catalog-delivery.json`                                                                                                                                                                       | Listed by script                                                          |
| A-F16 | Near-simultaneous changes: the later one wins silently; history keeps the old value; up to about a second's delay for agents in another program                                                                                               | `W1.3-case-B-refine.md:288`; `W1.4-case-C-act-reuse.md:207`                                                                                                                                                 | Read (those notes read the code; not reproduced)                          |
| A-F17 | A table's settings offer only "Title", then "Other settings for this widget can be changed by your agent."                                                                                                                                    | `apps/web/src/catalog/settings.tsx:187–198`, `:449–455`; `W1.3-case-B-refine.md:283`                                                                                                                        | Read the code at 6efa535                                                  |
| A-F18 | The task checkbox has no Undo, and a click after a refresh reopens the task                                                                                                                                                                   | `apps/web/src/catalog/interactive.tsx:212–247`; `W1.4-case-C-act-reuse.md:206`, `:210`                                                                                                                      | Read the code at 6efa535                                                  |
| A-F19 | None of the five is fixed: app code unchanged since the published version, apart from two new test files                                                                                                                                      | `git diff --stat 8bb6b32 6efa535 -- apps packages`                                                                                                                                                          | Ran on 10 Oct                                                             |
| A-F20 | Fixes planned in paused later stages: protecting changes, adjusting views, one task action with Undo                                                                                                                                          | Pharos project data, tasks "Protect human changes from stale agent view updates", "Enable human refinement of generic view data and layout", "Deliver one validated task-change action in a generated view" | Read                                                                      |
| A-F21 | When to fix the example, and whether to require "Nothing matches", are questions for the owner                                                                                                                                                | `W1.7-review.md:194` (Q05), `:195` (Q06)                                                                                                                                                                    | Read                                                                      |
| A-F22 | Version 0.1.0 published 7 Oct as an early preview                                                                                                                                                                                             | Pharos project data, task "Publish the initial public Pharos v0.1 release"; decision "Publish the initial open-source preview as v0.1.0"                                                                    | Read                                                                      |
| A-F23 | Release check: install, code checks, 207 automated checks in about 5 s, build with a size warning, agent connects, GitHub checks pass on Node.js 22.13.0, 24 and 26                                                                           | `W2.2-checks.md:23–31`, `:52–54`; `W2.1-clean-checkout.md:10`, `:92`                                                                                                                                        | Read                                                                      |
| A-F24 | Settings in a real browser: dark theme persists; pausing in one tab shows in another; the off state explains itself                                                                                                                           | `W2.7-settings-browser.md:56–60`                                                                                                                                                                            | Read                                                                      |
| A-F25 | Seven fixes to the README and contributor guide; the "within a second" before and after                                                                                                                                                       | `W2.5-findings.md:23`, `:26–31`; `W2.4-release-docs-audit.md:57–59`; `README.md:109–110`                                                                                                                    | Read                                                                      |
| A-F26 | The background service was not tried and needs the owner; the checks covered the published version                                                                                                                                            | `W2.5-findings.md:15`, `:17`, `:34–37`, `:45`                                                                                                                                                               | Read                                                                      |
| A-F27 | Left before results: owner approval, freeze, checker, two measurements, scoring, report, owner acceptance                                                                                                                                     | Pharos project data, open G1 tasks (the approval, corpus, fact-check, two baseline runs, scoring, report and acceptance tasks)                                                                              | Read                                                                      |
| A-F28 | Each test at least 3 times with the current agent                                                                                                                                                                                             | Pharos project data, task "Run the current Generative UI baseline with the default answering agent" (criteria)                                                                                              | Read                                                                      |
| A-F29 | About 46 reader exercises per round, about 100 overall                                                                                                                                                                                        | `W1.6-targets.md:244–249`, `:433`                                                                                                                                                                           | Read                                                                      |
| A-F30 | The first owner question, word for word                                                                                                                                                                                                       | `W1.7-review.md:190`                                                                                                                                                                                        | Read                                                                      |
| A-F31 | Approval asks the owner to read the three test situations and the pass marks: 4,656 + 4,659 + 4,696 + 6,912 = 20,923 words                                                                                                                    | Pharos project data, task "Approve the workflow cases and pre-registered targets" (criteria); `wc -w` on W1.2, W1.3, W1.4, W1.6                                                                             | Counted on 10 Oct (includes table markup)                                 |
| A-F32 | Earlier trial: six agents, six questions, six clean views; overdue and due-this-week counts exact                                                                                                                                             | Pharos project data, artifact "M4 agent evaluation"                                                                                                                                                         | Read                                                                      |
| A-F33 | Proposed pass marks for "Ask what's at risk": facts ≥ 0.90 in the first answer, completion ≥ 0.80, median time to a useful view ≤ 45 s, median cost ≤ USD 1.00 and every run ≤ USD 2.00, each also relative to today; decision still proposed | `W1.6-targets.md:118–126`; Pharos project data, decision "Pre-registered G5 targets for the Generative UI workflows" (proposed)                                                                             | Read                                                                      |
| A-F34 | Only "Ask what's at risk" has a reader check (say what's at risk without scrolling)                                                                                                                                                           | `W1.2-case-A-risks.md:281–289`; `W1.3-case-B-refine.md:294–311`; `W1.4-case-C-act-reuse.md:212–231`                                                                                                         | Read                                                                      |
| A-F35 | Who wrote what: Opus 5.5 (three test situations, pass marks), GPT-6.1-Sol (measuring rules, review), GPT-6-Astra (inventory, practice projects, runner, release checks, docs audit), Sonnet 5.5 (Settings checks, doc fixes)                  | the header of each file in `docs/evidence/G1/`                                                                                                                                                              | Read                                                                      |
| A-F36 | "Adjust a generated view" can't be completed in today's interface                                                                                                                                                                             | `W1.3-case-B-refine.md:306`                                                                                                                                                                                 | Read                                                                      |
| A-F37 | What each test situation checks                                                                                                                                                                                                               | `W1.2-case-A-risks.md:12–19`, `W1.3-case-B-refine.md:21–35`, `W1.4-case-C-act-reuse.md:16–31`                                                                                                               | Read                                                                      |

## 3 Case B: "What is Generative UI, and where does Pharos sit?"

Strategy: **learn it.**

### 3.1 The reader's starting state

- **Has:** a research project, "Generative UI map": a long description with an eight-row
  comparison table, an assessment table, 32 records of sources and notes, 12 scope items, 15
  tasks (7 of them moved to the main roadmap) and 2 proposals waiting for a decision.
- **Doesn't know:** what Generative UI means beyond the phrase, even though Pharos was introduced
  as "Generative UI project management"; what A2UI, AG-UI, MCP Apps or json-render are; which
  statements were verified and which are opinion; what the two proposals ask.
- **Wants:** to understand the idea, see where Pharos is, and know what (if anything) to decide.

The research project itself is a counter-example: its pinned view leads with a Callout ("Pharos
already implements Generative UI; improve the complete workflow"), then the whole 640-word
project description with an eight-row table, a second eight-row table, and a table of sources
whose notes run to 25–45 words each.
Its sources are stored as deliverables with the category typed into the title ("1 Transport ·",
"2 Format ·"), because Pharos has no place for knowledge.

### 3.2 The first screen

```
┌─ Sketch with fixed content, 10 Oct 2026. Not live data. ───────────────────────────────┐
│ Generative UI, and where Pharos sits                                                    │
│ Generative UI means an AI answers you by putting a view together ◐; Pharos puts its     │
│ views together from tested building blocks and live project data. ●                     │
│                                                                                         │
│ Four approaches, sorted by how much of the view the AI makes                            │
│ [Writes text] — [Shows one ready-made] — [Arranges blocks    ] — [Writes the view's  ]  │
│  ≡≡≡≡             block  ▭                 into a view  ▦▦      code itself  </>       │
│                                            ★ Pharos is here                             │
│  Not Generative UI └────────────────── Generative UI ──────────────────────────┘        │
│ Different approaches, not stages of progress. They trade freedom against checking:      │
│ where the AI makes more of the view, more of it needs checking. None is better in       │
│ general.                                                                                │
│                                                                                         │
│ ◐ Based on a review of official documents and Pharos's code on 6 Oct. Where each       │
│   approach sits is an agent's reading.                                                  │
│ Waiting for you: 2 proposals from this research, no deadline. They're at the end,      │
│   after the map.                                                                        │
│                                                                                         │
│ Look closer, in this order:                                                             │
│ 1 See it happen · 2 The map · 3 Pharos's spot · 4 How well Pharos does it ·             │
│ 5 Open questions and your two proposals                                                 │
│ More: All sources · The full review · Pharos and A2UI in detail · …                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 The path

| Order | Label                                   | Preview                                             |
| ----- | --------------------------------------- | --------------------------------------------------- |
| 1     | "See it happen"                         | "one question, answered as text and as a view"      |
| 2     | "The map"                               | "the main approaches, with examples"                |
| 3     | "Pharos's spot"                         | "what's particular about it, and what it rules out" |
| 4     | "How well Pharos does it"               | "what works, what's partial, what's missing"        |
| 5     | "Open questions and your two proposals" | "what nobody knows yet, and what waits for you"     |

### 3.4 Elements on the first screen

**B1 · Headline**

- Sees: "Generative UI means an AI answers you by putting a view together ◐ Agent's definition; Pharos puts its views together from tested building blocks and live project data. ● Verified."
- Does: popovers on the terms; the first badge's popover: "How we know: this is the 6 Oct review's own wording of the term, not an official definition."; the second: "How we know: Pharos's own docs and code for how Pharos works."
- Work or words: describes; part 1 shows it.
- Terms: Generative UI, view, building block, live project data.
- Certainty: ● Verified (Pharos's part); ◐ Agent's definition for the meaning of "Generative UI" (the review's wording).
- Asks: nothing.
- Maps to: existing **Text** plus **new data** (claim, terms).
- Facts: B-F1, B-F2, B-F12, B-F13.

**B2 · Picture: "How much of the view the AI makes"**

- Sees: a horizontal band with four equal stops, each with a tiny drawing (lines of text; one
  card; a grid of three blocks; code brackets): "Writes text", "Shows one ready-made block",
  "Arranges blocks into a view" (marked "★ Pharos is here"), "Writes the view's code itself".
  Under the first stop: "Not Generative UI". Under the other three, one bracket: "Generative
  UI". Heading: "Four approaches, sorted by how much of the view the AI makes". Below: "Different approaches, not stages of progress. They trade freedom against checking: where the AI makes more of the view, more of what it makes needs checking. None is better in general." No arrowheads pointing right; no words like
  "level" or "advanced".
- Does: tapping a stop opens a small card under the band:
  - "Writes text": "A chat answer in paragraphs. Nothing on screen is built for your question."
  - "Shows one ready-made block": "The app has prepared blocks; the AI picks one to show a result.
    Examples: Vercel AI SDK, Tambo."
  - "Arranges blocks into a view": "The AI chooses several blocks, lays them out and says which
    data each one shows; the app draws them. Pharos works this way. Others: json-render, A2UI,
    OpenUI."
  - "Writes the view's code itself": "The AI writes the page's code, so almost anything is
    possible, but each result needs checking. Examples: a Google research study, app builders.
    Pharos rules this out."
  - Each card ends with "See the map" (opens part 2).
- Work or words: describes (a diagram).
- Terms: building block, view.
- Certainty: ◐ Agent's reading for where each example sits; the caption's "not stages of progress"
  is the review's conclusion.
- Asks: nothing.
- Maps to: **new component, PositionMap** (band mode) plus **new data** (approaches as knowledge
  records with a position, certainty, source and date).
- Facts: B-F2, B-F3, B-F4, B-F17.

**B3 · Certainty line** — "◐ Based on a review of official documents and Pharos's code on 6 Oct.
Where each approach sits is an agent's reading." Maps to: existing **Text** plus badge data. Facts:
B-F11. Work or words: describes. Terms: none. Certainty: it is the certainty line (◐). Asks:
nothing.

**B4 · Waiting-for-you line** — "Waiting for you: 2 proposals from this research, no deadline.
They're at the end, after the map." ● Verified. Opens part 5. Maps to: existing **Text** with a live
count of proposed decisions. Facts: B-F21. Work or words: describes. Terms: none. Asks: nothing.

**B5 · Path** — as in §3.3. Maps to: **ReadingPath** (new). Work or words: describes (navigation).
Terms: none. Certainty: none. Asks: nothing.

**B6 · More row** — see §3.6. Work or words: describes (navigation). Terms: none. Certainty: none.
Asks: nothing.

### 3.5 Elements in the five parts

#### Part 1 · "See it happen"

**B10 · Intro and question**

- Sees: "Same question, same practice project, two kinds of answer." A speech bubble: "What is
  holding up installation?" and the note "Practice project: Workshop renovation, the same one used
  in the G1 test."
- Work or words: describes. Certainty: ● Verified. Asks: nothing.
- Terms: practice project. Maps to: existing **Text**. Facts: B-F23.

**B11 · Two answers side by side**

- Sees:
  - Left, "Answer as text" (label: "written for this example"): "Installation is held up by the
    lighting. 'Order lighting materials' was due on 6 Oct and is still queued. 'Fit workshop
    lighting', also due on 6 Oct, is waiting for those materials. 'Book inspection slot' can't
    start until the lighting is fitted."
  - Right, "Answer as a view" (label: "from the practice project; made for testing, not by a live
    run"): a number block "Waiting for materials: 1" in a warning tone; beside it a dependency graph
    titled "Work package dependencies" in three columns, left to right: "Order lighting materials"
    and "Paint prepared work area"; then "Fit workshop lighting"; then "Book inspection slot". Two
    arrows: material order → fitting → inspection booking. Each node shows its status label.
    Small tags on the blocks: "Building block: one number" and "Building block: dependency graph".
- Does: two toggles under the right panel:
  - "Show the recipe for this prepared example": reveals the recipe (the JSON from the practice project, verbatim; labelled "not a recording of a live answer"). Hovering or tapping a block highlights its lines in the recipe, and the reverse.
  - Visible text between the two panels and the toggles, not inside the recipe: "In a live answer, the AI chooses which blocks to use, where they go and which data each one shows, and writes that down as a recipe. The AI doesn't draw anything: Pharos draws the view and keeps it current."
  - "Pretend the materials arrived" (label: "simulated change, for this sketch"): "Order lighting
    materials" becomes "Signed off" and "Fit workshop lighting" becomes "Queued"; the number turns
    to 0 and the graph updates. The text answer stays the same and gets a marker: "This text is
    now out of date." Caption: "Building blocks read live data. Written text doesn't update by
    itself."
- Work or words: **shows the work**: a real recipe and what it draws, and the difference between
  live blocks and fixed text.
- Terms: recipe, building block, live project data, dependency graph, practice project.
- Certainty: ● Verified: the recipe is from the practice project's file; "blocks read live data,
  written text doesn't" is in Pharos's own docs and schema.
- Asks: nothing here (B12 asks).
- Maps to: **Exhibit** (new) in compare mode, rendering a captured recipe against captured data,
  with a simulated change. Pharos's renderer already draws recipes; what's new is drawing one from
  another project, frozen, inside a view. **New data:** the captured excerpt.
- Facts: B-F13, B-F23, B-F27.

**B12 · Question**

- Sees: "For questions like this, which would you rather get?" — "The text" / "The view" / "Both:
  a sentence, then the view" / "Not sure". "Why we ask: it tells agents how much to show and how
  much to say when they build views for you." "What happens: kept as your preference."
- Work or words: asks. Terms: view. Certainty: the answer counts as ◆ once given.
- Asks: yes, kept. Maps to: **QuestionCard** (new) plus **new data** (a reader preference agents
  can read).

#### Part 2 · "The map"

**B20 · Intro** — "Two questions sort the approaches: how much of the view the AI makes, and when it
makes it." Maps to: existing **Text**. Work or words: describes. Terms: view. Certainty: ◐, as the
map. Asks: nothing.

**B21 · The map**

- Sees: a grid. Columns (the three Generative UI stops of the band): "Shows one ready-made block",
  "Arranges blocks into a view", "Writes the view's code itself". Rows: "While you use the app, to
  answer you" and "While a developer builds the app". Named chips in the cells:

  | Row ↓ / column →         | Shows one ready-made block | Arranges blocks into a view                            | Writes the view's code itself             |
  | ------------------------ | -------------------------- | ------------------------------------------------------ | ----------------------------------------- |
  | While you use the app    | Vercel AI SDK · Tambo      | **Pharos** (highlighted) · json-render · A2UI · OpenUI | Google research study · Runtime artifacts |
  | While a developer builds | "none in this review"      | "none in this review"                                  | App builders (for example v0)             |

  Below the grid, a strip: "Connectors: not ways to make views. They link agents and apps. In principle they could be used with any of the above, with extra integration work; none is verified here:" with chips "MCP (Pharos uses it)", "MCP Apps", "AG-UI", "A2A".
  Caption: "◐ Where each one sits is an agent's reading of its documents (6 Oct). The examples
  come from a discovery list, which is not a ranking."

- Does: tapping a chip opens a card under the map (not a modal), with the text below, a badge, the
  date checked, a source link, and "Ask about this" (the existing Ask).

  | Chip                  | Card text                                                                                                                                                                                                                       | Badge                                                      |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
  | Vercel AI SDK         | "Shows a ready-made block for each result of a tool the AI uses, inside a chat app. A simpler form of Generative UI. Saving is left to the app."                                                                                | ● Verified (official docs, 6 Oct)                          |
  | Tambo                 | "Lets an AI update blocks placed in an existing app, and stores them with the conversation. As of 6 Oct, its hosted service was announced to close on 31 Oct, with data deleted on 30 Nov; running it yourself stays possible." | ● Verified (its README, 6 Oct)                             |
  | Pharos                | "Arranges blocks from a fixed set of 26 kinds into a view, filled with live project data, and saves it with its history."                                                                                                       | ● Verified (Pharos's code)                                 |
  | json-render           | "Describes a view as data built from a fixed set of blocks. The closest to Pharos in structure."                                                                                                                                | ● for the description; ◐ for "closest"                     |
  | A2UI                  | "An open format, from Google, for describing a view from a set of blocks, which the app then draws. The closest to Pharos in idea. Current version 0.9.1; 1.0 is a candidate. Pharos views are not A2UI-compatible today."      | ● Verified (official docs; Pharos's code); ◐ for "closest" |
  | OpenUI                | "Builds views from a fixed set of blocks using its own compact language, sent piece by piece as it is written. Its maker says it needs up to 67% fewer tokens; not tested on Pharos."                                           | ● Verified (that the maker says so)                        |
  | Google research study | "A study of AI-generated pages. It reports an 83% preference over formatted text, with the time to make them left out. Not a test of Pharos."                                                                                   | ● Verified (as read by the 6 Oct review); ◐ for its place  |
  | Runtime artifacts     | "Small interactive pages an AI writes on the spot. Listed together with app builders, but a different job."                                                                                                                     | ◐ Agent's reading                                          |
  | App builders          | "Write an app's code while a developer builds it: a different job from answering your question while you work."                                                                                                                 | ◐ Agent's reading                                          |
  | MCP                   | "The standard way AI agents connect to apps and tools. Agents use it to read and change Pharos projects."                                                                                                                       | ● Verified (Pharos docs)                                   |
  | MCP Apps              | "Lets a chat app show an interactive view supplied by a tool, The view runs in a sandbox (a restricted area), which limits what it can reach. It doesn't need AI-written code: a developer's own view can run inside it."       | ● Verified (official overview)                             |
  | AG-UI                 | "Lets an app follow what an agent is doing, step by step, and share state with it. Pharos only announces that data changed, and shows a simple answering status."                                                               | ● for the description; ◐ for the comparison                |
  | A2A                   | "For agents talking to other agents. Not needed for Generative UI."                                                                                                                                                             | ◐ Agent's reading                                          |

  Under the connectors: "◐ None of these connectors is needed for Pharos to count as Generative
  UI."

- Work or words: describes (a map); each card quotes its source.
- Terms: MCP, token, building block.
- Certainty: as in the table; the map as a whole carries ◐.
- Asks: "Ask about this" on each card creates an ordinary question for an agent (existing).
- Maps to: **PositionMap** (new) in grid mode, plus **new data** (approach records with two
  positions, certainty, source, date). Today these live as artifacts with category numbers in
  their titles.
- Facts: B-F4 to B-F10, B-F12.

#### Part 3 · "Pharos's spot"

**B30 · How Pharos does it**

- Sees: a chain of six boxes (vertical on a phone): "You ask a question, in Pharos or to your
  agent" → "An AI agent reads the project through MCP" → "It writes a recipe using Pharos's
  building blocks" → "Pharos checks the recipe and draws the view" → "The blocks read live project
  data" → "The view is saved: you and agents can change it, and every change is kept in history".
- Work or words: describes (a diagram).
- Terms: MCP, recipe, building block, live project data, history.
- Certainty: ● Verified (Pharos's docs).
- Asks: nothing.
- Maps to: **Flow** (new), the same component as case A.
- Facts: B-F13, B-F14, B-F15.

**B31 · What's particular about this spot**

- Sees: a heading "What's particular about this spot (none of it is unique)" and four lines, each
  with a badge:
  - "Blocks made for projects (stages, tasks, decisions), plus general blocks for any record." ●
  - "Views read live data, so numbers stay current without asking the AI again. Written text on a
    view doesn't update." ●
  - "Views are saved with a history of every change, and both you and agents can edit them." ●
  - "Other tools can save their views too; this combination fits a project workspace, but it
    isn't exclusive to Pharos." ◐
- Work or words: describes. Terms: history.
- Certainty: one badge per line, as shown. Asks: nothing.
- Maps to: existing **DataList** over **new data** (claims with certainty).
- Facts: B-F12 to B-F14, B-F16.

**B32 · What Pharos rules out, and why**

- Sees: two cards with the pill "Ruled out":
  - "AI-written view code. The AI may only arrange tested blocks, so a view can't run code nobody
    reviewed."
  - "Swapping its blocks for A2UI's basic set. Pharos would lose its blocks made for projects."
- Certainty: ● Verified (Pharos's scope and goal draft).
- Work or words: describes. Terms: building block. Asks: nothing.
- Maps to: existing **ScopeBoard** showing only the "out" column (`kinds: ["out"]`); its stored
  reasons are in jargon ("domain-level PM widgets"), so they need **plain wording (data)**.
- Facts: B-F17.

**B33 · Nearest relatives**

- Sees: "Nearest relatives: json-render (closest in structure) and A2UI (closest in idea). Pharos
  can't exchange views with A2UI apps today; making it able to is a separate choice nobody has
  made." Chips open the map cards.
- Work or words: describes. Terms: none. Asks: nothing.
- Certainty: ● for "can't exchange today"; ◐ for "closest". Maps to: existing **DataList** over
  approach records (new data). Facts: B-F5.

#### Part 4 · "How well Pharos does it"

**B40 · Intro** — "Compared with the idea of Generative UI. Assessed from code on 6 Oct by an agent reading it; spot-checked again on 10 Oct: unchanged." with the badge "◐ Assessed from code" (popover: an agent read the code; nobody ran these on screen). A one-sentence takeaway follows: "In one sentence: Pharos builds views and saves them well; adjusting them yourself, acting from them and seeing what the agent is doing are only partly there, and the only quality check so far is one small trial. Pick a group to see its findings." The eight cards are shown as five selectable group summaries (name, count, card titles); a group opens to show its cards. Maps to: existing **Text**. Facts: B-F18,
B-F19. Work or words: describes. Terms: none. Asks: nothing.

**B41 · Capability cards, grouped**

- Sees: eight cards in five groups, each card a short title, a status pill and a one-line example:

  | Group                | Card title                                      | Example line                                                                                                                                                                       | Badge |
  | -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
  | "Works"              | "Builds a view for your question"               | "Agents choose the blocks, layout and data for each question."                                                                                                                     | ◐     |
  | "Works"              | "Saves views, and you and agents can edit them" | "Every change is kept and can be undone."                                                                                                                                          | ◐     |
  | "Works, with limits" | "Shows live data"                               | "A misspelled field name is saved anyway, with only a warning; written text goes out of date."                                                                                     | ◐     |
  | "Partly"             | "You can adjust generated views yourself"       | "Only some settings; changing a table's filter or columns needs an agent." Plus the link "The G1 test found this too"                                                              | ◐     |
  | "Partly"             | "You can act from a view"                       | "Asking questions and simple task edits work; forms and general buttons don't exist yet."                                                                                          | ◐     |
  | "Partly"             | "It shows what the agent is doing"              | "Pausing can show 'Paused' while an agent is still answering."                                                                                                                     | ◐     |
  | "Gap found"          | "Keyboard use of tabs inside views"             | "Arrow keys don't move between tabs. Only this part was checked, not the whole app."                                                                                               | ◐     |
  | "Measured once"      | "Quality of AI-made views"                      | "One trial: 6 questions, 6 clean views. Not enough runs to establish repeatable quality; the paused G1 work was meant to build a repeatable test." Plus the link "See the G1 work" | ●     |

- Does: tapping a card opens its detail: the evidence in plain words, the date, the source link,
  and "Ask about this".
- Work or words: describes; the cross-links lead to case A, where two of these are shown.
- Terms: field, filter.
- Certainty: as in the table.
- Asks: nothing (B42 asks).
- Maps to: existing **DataList**, extended with **grouping** (by status), over **new data**
  (assessment claims: capability, status, example, certainty, source, date).
- Facts: B-F18, B-F19, B-F20.

**B42 · Question**

- Sees: "Which gap matters most to you?" — "Adjusting views myself" / "Acting from a view" /
  "Seeing what the agent is doing" / "Keyboard use" / "None of these". "Why we ask: it helps
  decide what to improve first." "What happens: the card you pick moves to the top of this part, marked 'You said this matters most (date)'. Every finding stays listed; your answer only changes the order."
- Work or words: asks. Terms: view. Certainty: the answer counts as ◆ once given.
- Asks: yes, kept; it **reorders** the view and never hides a finding. Maps to: **QuestionCard** (new) plus **new data**.

#### Part 5 · "Open questions and your two proposals"

**B50 · Not known yet**

- Sees: three lines, each with ○:
  - "Would letting other apps show Pharos views (through A2UI or MCP Apps) help you? Nobody has
    tried; it first needs a specific app to target."
  - "Would it help to see a view appear while the agent is still building it? Not measured."
  - "Do generated views help you understand and act better than a plain Overview? Not measured;
    the paused G1 test was meant to find out."
- Work or words: describes what is missing. Asks: nothing; each line has "Ask about this".
- Terms: Overview. Certainty: ○ Not known yet. Maps to: existing **DataList** over **new data**
  (open questions). Facts: B-F22.

**B51 · Proposal 1**

- Sees: a card with the dashed label "Proposal, not approved":
  - Title, in plain words: "Keep Pharos's own building blocks and project data at the centre;
    treat outside standards as optional, adopted only for a clear need."
  - Small text: "Original title: 'Preserve Pharos's catalog and project store; keep integrations
    optional'."
  - ◐ "Your reframe decision of 10 Oct already keeps the fixed set of building blocks, which covers
    the first half."
  - Buttons: "Accept" / "Reject" / "Not now".
- Does: the choice is kept: "Recorded: you accepted this on 10 Oct." In the product this sets the
  decision's status, with the owner as the one who decided.
- Work or words: describes the proposal. Terms: building block. Certainty: the proposal
  has no badge (it is not a fact); the context line is ◐; the choice counts as ◆.
- Asks: yes. Maps to: existing **DecisionLog** shows the decision; deciding in place is new
  (**QuestionCard**, decision mode). Facts: B-F21, B-F24.

**B52 · Proposal 2**

- Sees: the same card layout:
  - Title: "Before choosing the next new kind of building block, try forms and buttons that change
    project data on one real task, and compare them with asking and editing in place."
  - Small text: "Original title: 'Evaluate structured actions before choosing the next catalog
    capability'."
  - ◐ "The reframe (10 Oct) puts building blocks for explaining first, which may change what 'next'
    means here."
  - Buttons: "Accept" / "Reject" / "Not now".
- Work or words, terms, certainty, asks, maps to and facts: as B51.

### 3.6 One click away (the "More" row)

| Link                          | Shows                                                                                                                                                                                                                        | Maps to                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| "All sources"                 | Every source with a one-line plain note and what was done with it (read in the review, or only listed); what a source says is its authors' account, and the note is an agent's summary; no single certainty label per source | existing **DataTable** over artifacts; plain notes are new data |
| "The full review (6 Oct)"     | The review document                                                                                                                                                                                                          | existing **ArtifactGallery** link                               |
| "Pharos and A2UI in detail"   | The existing detailed view                                                                                                                                                                                                   | existing view tab                                               |
| "Keep, consider, leave alone" | The 12 scope items                                                                                                                                                                                                           | existing **ScopeBoard**                                         |
| "Follow-up tasks"             | The remaining research tasks                                                                                                                                                                                                 | existing **TaskTable**                                          |
| "Glossary"                    | Every term on this view with its plain explanation                                                                                                                                                                           | **new data** (terms) in an existing **DataList**                |

### 3.7 How case B maps to the catalog

| Element                   | Existing                       | New component | New data                                 |
| ------------------------- | ------------------------------ | ------------- | ---------------------------------------- |
| B1, B3, B4, B10, B20, B40 | Text                           | —             | claims with certainty; terms             |
| B2, B21                   | —                              | PositionMap   | approach records with positions          |
| B5                        | —                              | ReadingPath   | —                                        |
| B11                       | (renderer)                     | Exhibit       | captured recipe and data                 |
| B30                       | —                              | Flow          | —                                        |
| B31, B33, B50             | DataList                       | —             | claims, approach records, open questions |
| B32                       | ScopeBoard                     | —             | plain reasons                            |
| B41                       | DataList (extension: grouping) | —             | assessment claims                        |
| B12, B42, B51, B52        | DecisionLog (B51–B52)          | QuestionCard  | reader answers and preferences           |

### 3.8 The 30-second check: prediction

**After 30 seconds the owner should be able to say:**

1. "Generative UI means the AI answers with a view it puts together, not paragraphs."
2. "Pharos does it by arranging tested building blocks with live data. Others do it differently,
   and further right isn't better."
3. "Two proposals wait for me, with no deadline, at the end."

**Why it should pass:** a one-sentence definition with Pharos in it; a band that places Pharos
among the alternatives at a glance; no product names on the first screen; a certainty line that
says how firm the picture is.

**What would make it fail:**

- The band is read as a ladder ("Pharos is behind the code-writing tools"). Guard: the heading says "approaches, sorted by", the caption says the approaches trade freedom against checking and none is better in general, equal-size stops, no arrows pointing right, no "levels" wording.
- "Building blocks" or "live project data" are not understood without opening the popovers.
- The certainty line is overlooked, so the clean band looks settled.
- The two proposals pull the owner into deciding before reading the map. Guard: "They're at the
  end, after the map."
- The headline (25 words) feels long. If the owner stumbles, the sketch may split it into two
  sentences, listed as a deviation.

**How to check it:** after 30 seconds, ask "What is Generative UI, in your words?", "Is Pharos
behind the tools on the right?" (expected: no, it's a different approach), and "What is waiting
for you?" (two proposals, no deadline).

### 3.9 Fact check for case B

"Map data" means the Generative UI map project snapshot exported for this work (not in the
repository), cited by record.

| Id    | Fact as used                                                                                                                                                                                                                                                                                                                                         | Source                                                                                                                                                                                                                                                                                                                                                                          | How it was checked                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| B-F1  | Generative UI: the agent chooses what the view shows and how, for a question; the app draws and keeps it; not prose in a chat bubble                                                                                                                                                                                                                 | Map data: project description (first paragraph); artifact "Generative UI review — findings, evidence and evaluation plan" (Overall assessment)                                                                                                                                                                                                                                  | Read                                               |
| B-F2  | Pharos's AI writes a view spec from trusted components, not code                                                                                                                                                                                                                                                                                     | Map data: project description ("What does the model generate?" row); `docs/SCOPE.md:115`                                                                                                                                                                                                                                                                                        | Read                                               |
| B-F3  | The approaches are not stages of maturity                                                                                                                                                                                                                                                                                                            | Map data: review artifact (second paragraph); project description ("cannot infer that unrestricted code generation is the next maturity level")                                                                                                                                                                                                                                 | Read                                               |
| B-F4  | Which example belongs to which approach                                                                                                                                                                                                                                                                                                              | Map data: artifacts "3 Framework · Vercel AI SDK", "3 Interaction runtime · Tambo", "2 Composition runtime · json-render", "2 Format · A2UI (Google)", "2 UI language/runtime · OpenUI (Thesys)", "5 Research · Generative UI: LLMs are Effective UI Generators", "4 Discovery category · app builders and runtime artifacts"; project description ("Where the ecosystem fits") | Read; the placement is this document's reading (◐) |
| B-F5  | A2UI 0.9.1 current, 1.0 a candidate; Pharos views not A2UI-compatible today                                                                                                                                                                                                                                                                          | Map data: artifact "A2UI specification v0.9.1 …"; view "Pharos on the A2UI map", widget "map"                                                                                                                                                                                                                                                                                   | Read                                               |
| B-F6  | OpenUI's maker claims up to 67% fewer tokens; untested on Pharos                                                                                                                                                                                                                                                                                     | Map data: artifact "2 UI language/runtime · OpenUI (Thesys)"                                                                                                                                                                                                                                                                                                                    | Read                                               |
| B-F7  | Tambo's hosted service to close 31 Oct, data deleted 30 Nov, as of 6 Oct                                                                                                                                                                                                                                                                             | Map data: artifact "3 Interaction runtime · Tambo"; review artifact ("Operational note")                                                                                                                                                                                                                                                                                        | Read                                               |
| B-F8  | The Google study reports an 83% preference over formatted text, generation speed excluded                                                                                                                                                                                                                                                            | Map data: artifact "5 Research · …"; review artifact (overstated item 6)                                                                                                                                                                                                                                                                                                        | Read                                               |
| B-F9  | Roles of MCP, MCP Apps, AG-UI, A2A; none is required for Pharos to be Generative UI                                                                                                                                                                                                                                                                  | Map data: artifacts "1 Transport · Model Context Protocol", "2 Host UI surface · MCP Apps", "1 Interaction protocol · AG-UI", "1 Agent protocol · A2A"; project description                                                                                                                                                                                                     | Read                                               |
| B-F10 | The example list is a discovery list, not a ranking                                                                                                                                                                                                                                                                                                  | Map data: project description (second paragraph); artifact "0 Reference · awesome-generative-ui"                                                                                                                                                                                                                                                                                | Read                                               |
| B-F11 | Reviewed 6 Oct, against Pharos's code as it was then                                                                                                                                                                                                                                                                                                 | Map data: project description (second paragraph)                                                                                                                                                                                                                                                                                                                                | Read                                               |
| B-F12 | 26 kinds of building blocks                                                                                                                                                                                                                                                                                                                          | `packages/schema/src/views/catalog.ts:296–333`                                                                                                                                                                                                                                                                                                                                  | Counted: 23 plus 3 layout                          |
| B-F13 | Blocks read data by query, nothing copied; Callout and Markdown text is fixed                                                                                                                                                                                                                                                                        | `docs/SCOPE.md:69`; `CLAUDE.md:95`; `packages/schema/src/views/catalog.ts:98–109`                                                                                                                                                                                                                                                                                               | Read                                               |
| B-F14 | Every change is a revision with author and reason; people and agents both edit views                                                                                                                                                                                                                                                                 | `docs/SCOPE.md:45`, `:75`                                                                                                                                                                                                                                                                                                                                                       | Read                                               |
| B-F15 | Recipes are checked against the catalog                                                                                                                                                                                                                                                                                                              | `docs/SCOPE.md:86`                                                                                                                                                                                                                                                                                                                                                              | Read                                               |
| B-F16 | Saving views is not unique to Pharos                                                                                                                                                                                                                                                                                                                 | Map data: review artifact (overstated item 1)                                                                                                                                                                                                                                                                                                                                   | Read                                               |
| B-F17 | Ruled out: AI-written view code; replacing the catalog with A2UI's basic set                                                                                                                                                                                                                                                                         | Map data: scope items "Arbitrary agent-generated executable HTML/JS" and "Replacing Pharos's catalog with A2UI's Basic Catalog" (both "out"); `docs/reframe/goal.md` (Unchanged)                                                                                                                                                                                                | Read                                               |
| B-F18 | The eight capability rows and their verdicts                                                                                                                                                                                                                                                                                                         | Map data: view "Generative UI map", widget "assessment"                                                                                                                                                                                                                                                                                                                         | Read                                               |
| B-F19 | Still true on 10 Oct: table settings (`apps/web/src/catalog/settings.tsx:449–455`); pausing clears the queue but doesn't stop a running answer (`apps/server/src/agent-runner.ts:147–154`); tabs have no key handling (`apps/web/src/catalog/renderer.tsx:92–125`); unknown field names produce a message (`apps/server/src/views/preview.ts:45–60`) | the files named                                                                                                                                                                                                                                                                                                                                                                 | Read the code at 6efa535                           |
| B-F20 | One earlier trial: 6 questions, 6 clean views                                                                                                                                                                                                                                                                                                        | Map data: artifact "6 Evidence · Pharos M4 agent evaluation"; Pharos project data, artifact "M4 agent evaluation"                                                                                                                                                                                                                                                               | Read                                               |
| B-F21 | Two proposed decisions; a task for the owner to accept or reject them                                                                                                                                                                                                                                                                                | Map data: decisions "Preserve Pharos's catalog and project store; keep integrations optional" and "Evaluate structured actions before choosing the next catalog capability" (proposed); task "Accept or reject the proposed decisions" (todo)                                                                                                                                   | Read                                               |
| B-F22 | Open: delivery to other apps not evaluated; progressive rendering a "maybe"; usefulness of generated views not measured                                                                                                                                                                                                                              | Map data: task "Evaluate available MCP delivery routes and track v1.0 separately" (todo); scope "Progressive (streamed) rendering …" (maybe); goal "Demonstrate useful Generative UI across complete project workflows" (open)                                                                                                                                                  | Read                                               |
| B-F23 | The practice project's answer view: a "Waiting for materials" number and a dependency graph of the current phase                                                                                                                                                                                                                                     | `eval/fixtures/workshop-renovation.json` (view `wr_answer_installation`); the graph draws only arrows between shown jobs: `apps/web/src/catalog/components/work.tsx:551–589`                                                                                                                                                                                                    | Read                                               |
| B-F24 | The reframe keeps the closed catalog and adds blocks for explaining when a real case needs one                                                                                                                                                                                                                                                       | R1 brief (owner's conclusions 5 and 6); `docs/reframe/goal.md` (principle 7)                                                                                                                                                                                                                                                                                                    | Read                                               |
| B-F25 | Pharos was introduced as "Generative UI project management"                                                                                                                                                                                                                                                                                          | `docs/OVERVIEW.md:3`                                                                                                                                                                                                                                                                                                                                                            | Read                                               |
| B-F26 | Sources stored as artifacts with category numbers in their titles                                                                                                                                                                                                                                                                                    | Map data: artifact titles ("0 Reference ·", "1 Transport ·", "2 Format ·" …)                                                                                                                                                                                                                                                                                                    | Read                                               |
| B-F27 | The text answer's facts (due dates, statuses, what waits on what)                                                                                                                                                                                                                                                                                    | `eval/fixtures/workshop-renovation.json`                                                                                                                                                                                                                                                                                                                                        | Read                                               |

## 4 Pattern: a decision that depends on your situation (case C, held)

The held case is private and not shared with agents. This pattern uses no content from it. The
illustration at the end is invented and unrelated.

### 4.1 When to use it

The reader has to decide or act; the right answer depends on facts about their own situation;
the research holds only under conditions ("if this, then that"); some inputs only the reader can
give; and a wrong answer is costly, so how sure each finding is matters as much as the finding.

### 4.2 The reader's starting state (template)

- Has a decision to make: {decision}.
- Has a pile of research: findings mixed with conditions, sources and caveats, written as prose.
- Doesn't know which findings apply to them, or which facts about themselves matter.
- Can't tell how sure each finding is, or what would change the answer.

### 4.3 The first screen

- **Headline**, in one of two forms:
  - While inputs are open: "Your answer depends on {n} things about your situation; {k} are still
    open." followed by "Next: {the next question}".
  - When all are answered: "{The answer for your situation, in one sentence}." followed by the
    weakest badge among the findings it rests on.
- **Picture: a branch map.** Each fork is one deciding question; each end is an outcome in at most
  eight words, with its weakest badge. Answered forks fold into one highlighted path labelled
  with the reader's answers. Unanswered forks show every branch, dashed. "You are here" marks the
  first unanswered fork. A link that rests on ◐ or ○ is dashed, never solid.
- **Needs-you line:** "Needs you: answer '{question}'", or "Needs you: {action} by {date}", or
  "Nothing needs you now".
- **Path:** 1 "Which situation are you in?" · 2 "What applies to you" · 3 "What's still open" · 4
  "What to do, and by when" · 5 "Your decision".

### 4.4 Elements

| Id  | Element                 | Sees and does                                                                                                                                                                                                                                                                                                   | Work or words                     | Certainty                                    | Asks                             | Maps to                                                                                                            |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| C1  | Situation questions     | One card per fork: a plain question, its answers plus "Not sure", "Why it matters:" (what changes with each answer), "If you're not sure:" (how to find out). Answering narrows the branch map; "Not sure" keeps both branches open.                                                                            | Asks; shows the reader's own case | Answers are ◆                                | Yes, kept with the date          | **QuestionCard** (new, in a sequence) plus **new data** (situation question, reader answer)                        |
| C2  | What applies to you     | Findings filtered by the reader's answers. Each: the statement, "Applies because you said: …", source, badge, date checked, and "What if I answered differently?" (shows the other branch side by side). Findings for other situations are hidden but counted: "{m} findings apply to other situations · Show". | Shows the findings themselves     | Per finding                                  | No                               | existing **DataList** plus **new data** (finding with conditions) and a new filter: "matches the reader's answers" |
| C3  | What's still open       | Open questions, each with "Who can answer: you / an official source / a professional" and "What changes: if A, then …; if B, then …", both shown.                                                                                                                                                               | Describes                         | ○                                            | Some can be answered in place    | existing **DataList** plus **new data** (open question)                                                            |
| C4  | What to do, and by when | Actions that follow from the findings, with deadlines. Each shows the weakest badge of what it rests on. An action resting on ◐ or ○ shows "Check before acting" and can't be ticked off until the finding is verified, or until the reader accepts the risk on purpose (that acceptance is kept as ◆).         | Describes                         | Weakest of its findings                      | The accept-the-risk choice       | existing **TaskChecklist** plus **new data** (task ↔ finding links) and **new** gating                             |
| C5  | Your decision           | What was decided, on which answers and findings. If any of them changes later, the decision shows "Re-check: {what changed}".                                                                                                                                                                                   | Shows the reader's record         | ◆ for the decision; the findings keep theirs | Yes                              | existing **DecisionLog** plus **new data** (links to answers and findings) and a re-check flag                     |
| C6  | Sources that disagree   | Both findings side by side, with their badges and sources; the better-argued one first, with the reason. Never merged into one clean sentence.                                                                                                                                                                  | Shows both                        | Per finding                                  | Optionally "Which do you trust?" | **Exhibit** (compare) plus **new data** (alternative findings)                                                     |

Terms are explained where they appear, as in §1.4, with the domain's own words in "(In the
files: …)".

### 4.5 Certainty rules for high stakes

1. **Weakest link.** Any summary, branch end or action shows the lowest badge among what it rests
   on.
2. **No visual promotion.** Bold, colour, size or position never make a finding look surer than
   its badge. Findings resting on ◐ say "may" or "likely".
3. **Dashed when unsure.** Branches and links resting on ◐ or ○ are dashed.
4. **Act only on firm ground.** As in C4.
5. **Dates.** Every finding shows when it was checked; past an age set for the topic, it shows
   "May be out of date".
6. **The reader's answers are ◆, but they don't lend certainty.** A finding derived from an
   answer is only as sure as the rule that connects them.
7. **Always offer "What if I answered differently?"**, so one wrong answer can't quietly lead to a
   wrong conclusion.

### 4.6 What it needs as data (for the knowledge-model proposal)

- **Situation question:** text, allowed answers, why it matters, how to find out.
- **Reader answer:** value or "not sure", who, when; kept across visits.
- **Finding:** statement, conditions (pairs of question and answer), source, certainty, date
  checked, alternatives.
- **Open question:** text, who can answer, what each answer would change.
- **Action:** the findings it rests on, a deadline.
- **Decision:** the answers and findings it rests on.

### 4.7 The 30-second check

**Should pass when** the reader can say: "My answer depends on {n} things; I've answered {k}; next
I need to answer {question}; the best answer so far is {answer}, and it's only as sure as its
weakest finding."

**Would fail if:** the branch map shows one clean path while forks are unanswered; a conclusion
looks final but rests on an agent's reading; the deciding questions use the domain's jargon; the
reader can't tell which findings apply to them; "What if I answered differently?" is missing.

### 4.8 An invented illustration (not the held case)

"Can I return this lamp?" Deciding questions: "Bought online or in a shop?", "Has it been
opened?", "How many days since it arrived?". One finding: "Online, unopened, within 30 days: full
refund" (● the shop's returns page, with a date). Another: "Opened items: a refund minus a fee"
(◐ an agent's reading of the small print, so its action shows "Check before acting"). Open: "Do
sale items count?" (○, who can answer: the shop). All of it is made up.

## 5 What the cases need, together

For the knowledge-model proposal and the gap map. "Used by" lists element ids.

| Need                                                                             | Kind                                  | Used by                                                  | Why today's catalog or data doesn't cover it                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ReadingPath                                                                      | new component                         | A6, B5, pattern path                                     | No component orders parts or opens them in place; a Markdown link can't target a widget                                                                                     |
| Flow                                                                             | new component                         | A2, A40, B30                                             | StageTracker draws only stages from data, not chosen boxes with statuses and links                                                                                          |
| Exhibit (compare, try it first, sequence, simulated change)                      | new component                         | A11, A12, A14, A21–A25, A31, A32, A41, B11, C6           | A view can query only its own project's live data. Showing a frozen piece of other work (another project, a file, command output, a drawn recipe) needs a captured snapshot |
| PositionMap (band, grid)                                                         | new component                         | B2, B21                                                  | CountChart counts things; nothing places items in categories with cards                                                                                                     |
| QuestionCard (single, multiple, decision, summary)                               | new component                         | A15, A26, A34, A43, A50, A51, B12, B42, B51, B52, C1, C4 | Views can't ask the reader anything today; only the reader asks, through requests                                                                                           |
| Branch map                                                                       | new component (pattern only)          | pattern first screen                                     | Build only when the held case is shared                                                                                                                                     |
| Certainty badge and term popover                                                 | marks inside any component            | every case                                               | No component carries certainty or definitions                                                                                                                               |
| Grouping in DataList                                                             | extension                             | B41                                                      | DataList is a flat list                                                                                                                                                     |
| Chosen wording in Text                                                           | extension                             | A3                                                       | Text fills in numbers but can't choose words                                                                                                                                |
| Claim or finding: statement, certainty, source, date, author, conditions, status | new data                              | A1, A4, A21–A25, A42, A52, B31, B41, C2                  | Knowledge lives as prose in descriptions, or as deliverables with category numbers typed into their titles                                                                  |
| Term: word, plain explanation, also called                                       | new data                              | every case                                               | No place for definitions                                                                                                                                                    |
| Reader question and answer, reader preference                                    | new data                              | every question card                                      | No place for the reader's answers                                                                                                                                           |
| Captured excerpt with source and date                                            | new data                              | every Exhibit                                            | Artifacts hold a link, not content                                                                                                                                          |
| Approach with positions                                                          | new data (or a claim with attributes) | B2, B21, B33                                             | Today: artifacts titled "1 Transport ·", "2 Format ·"                                                                                                                       |
| Open question                                                                    | new data                              | B50, C3                                                  | Today: free text in task descriptions and scope reasons                                                                                                                     |
| Plain labels for tasks, plain summaries for documents                            | data convention or field              | A2, A13, A40, the "More" tables                          | Task titles start with codes like "W3.2 ·"                                                                                                                                  |

Existing components the cases use as they are: Text, Callout, DataTable, DataList, DecisionLog,
ScopeBoard, TaskTable, TaskChecklist, ArtifactGallery, and the existing Ask (requests).

## 6 How the facts were checked

- **Read:** every G1 evidence note (its results, findings and questions), the G1 tasks, decisions
  and artifacts in the Pharos project snapshot, the Generative UI map snapshot, both earlier
  views, the two practice projects, `docs/OVERVIEW.md`, `docs/SCOPE.md`, `docs/PLAN.md`,
  `CLAUDE.md`, `docs/reframe/goal.md`, and `catalog.ts`, `catalog-info.ts`, `query.ts` in
  `packages/schema/src/views/`.
- **Re-ran on 10 Oct:** Pharos's "Blocked or overdue" example and a corrected filter, with the real
  `runQuery`, on both practice projects with "today" set to 7 Oct (a throwaway script outside the
  repository, not kept). The example returned a cancelled task on both; the corrected filter did
  not. Word counts with `wc -w`. `git diff` of the app code since the published version.
- **Read in the code at 6efa535:** `apps/server/src/guidance.ts:39–45`;
  `apps/web/src/catalog/components/work.tsx:330`, `:551–591`;
  `apps/web/src/catalog/settings.tsx:187–198`, `:449–455`;
  `apps/web/src/catalog/interactive.tsx:212–247`; `apps/server/src/agent-runner.ts:147–154`;
  `apps/web/src/catalog/renderer.tsx:92–125`; `apps/server/src/views/preview.ts:45–60`.
- **Not checked:** the live Pharos instance (off limits). That G1 is paused comes from the
  coordinator's applied plan (revision 281). Case B's facts about outside tools come from the 6 Oct
  review; this design did not re-open those websites, which is why their cards carry the date.
