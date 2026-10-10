# Independent review of the reframe

2026-10-10 · written by GPT-6.1-Sol · commit a99eb55

**Verdict: useful direction; revise before building.** The goal follows the owner's conclusions and the sketches offer visible paths. Some claims overstate the evidence, reader understanding remains untested, and the first proposed change is too broad.

1. **[Separate the release checks.](#release-evidence)** The sketch implies a post-fix verification that never happened. **Fix:** separate the revisions and show the repeat check as open.
2. **[Make certainty earned.](#certainty)** Badges cover interpretation; stronger labels need no linked evidence. **Fix:** require checked sources or owner answers; label deductions as readings.
3. **[Shorten the route to understanding.](#reading-test)** Some parts become another reading assignment. **Fix:** takeaway first, evidence on demand, then a 30-second owner comprehension check.
4. **[Narrow the author's verdict.](#independence)** “Solid groundwork” supports preparation, not reader value. **Fix:** “Useful test material; reader value untested”, with the self-review disclosure beside it.
5. **[Reduce the first build.](#smallest-change)** Four record types are justified; the full machinery is premature. **Fix:** one working explanation and saved answer before generalizing.
6. **[Keep preference separate from truth.](#preference)** The model makes unselected gaps inapplicable. **Fix:** reorder by preference while retaining every factual capability finding.
7. **[Reconcile the contracts.](#contracts)** The gap map contradicts the model's promises. **Fix:** resolve the pause, question roles, demonstrations and decision actions before estimating.
8. **[Correct misleading wording.](#wording)** “No results”, “only way back”, “AI wrote” and “raw output” overpromise. **Fix:** apply the specific replacements below to cases and sketches.

---

## Supporting detail

### Release evidence

The [fresh-checkout record](../evidence/G1/W2.1-clean-checkout.md) and [local/CI comparison](../evidence/G1/W2.2-checks.md) tested public commit `8bb6b32`. The [repair record](../evidence/G1/W2.5-findings.md) explicitly separates later working-tree documentation fixes and says the fresh-checkout/CI repeat was **not re-run**. The [Settings browser check](../evidence/G1/W2.7-settings-browser.md) used later commit `d000836`. In the source export, “Re-verify the release gate on the next release commit, including the service path” remains open.

Thus the first-screen sentence “passed, after seven fixes” and the part-three heading “on the published version” merge different evidence. Replace them with: **“The public copy passed installation and code checks. The instructions were improved afterward; checking the updated release again and trying the background service remain open.”** Show the later Settings check separately. The build warning was non-blocking, not demonstrated harmless: runtime performance was not measured.

### Certainty

[The cases' badge rules](cases.md#13-certainty-badges-and-status-pills) distinguish quoted material or observed results from conclusions drawn by reading code. That distinction is useful, but inconsistently applied:

- Case B's definition shares a “Verified” badge with Pharos's implementation although the definition is the researcher's wording. Its assessment says “Measured” while its popover admits nobody ran those behaviors on screen. Use **“Agent's definition”** and **“Assessed from code”** respectively.
- Case A's answer key matches filters and fixture checks. That verifies the declared rules against synthetic data; it does not verify that “risk” or “holding it up” matches the owner's intent. Show those as two separate questions.
- Case B's “All sources” assigns certainty to whole sources. A source's existence, its author's claim and an agent's interpretation require different labels. “MCP Apps … walled off from everything else” also turns a sandbox boundary into an absolute guarantee.

[The knowledge proposal](knowledge-model.md), §§3, 6 and 8, defaults source/evidence arrays to empty, requires only free-text `howWeKnow` for stronger labels, and relegates missing evidence to a preview warning. Agents can also create a “Confirmed by you” claim without linking an owner answer. Require a checked source or captured observation for verification, and a recorded owner answer/decision for confirmation. Keep separate labels for the fact that the owner chose something and the certainty of the underlying claim. Fix semantic certainty comparisons too: current [range filters](../../packages/schema/src/views/run-query.ts) follow reorderable option-list order, as the gap map correctly notes.

### Reading test

This is a critical prediction from HTML and event-handler inspection, not a timed owner study or a visual-layout test. I also evaluated the self-contained scripts in an isolated DOM, with no network or live project connection, to include generated tables, cards and questions in the counts.

**Case A: partial pass.** In 30 seconds a newcomer could find “test material exists”, “the new agent runs have not happened” and “nothing needs me now”. They could mistake the five-box chain for near-completion, “test” for the 207 code checks, and the release sentence for an overall pass. “No results” also obscures the earlier trial. The five links are obvious; deciding whether the preparation is good requires substantial further reading.

**Case B: partial pass.** A newcomer could see that Pharos arranges prepared blocks and that two proposals wait without a deadline. They may still not understand what makes this different from an ordinary dashboard. The example helps, but the sentence explaining who chooses the blocks and who draws them is hidden inside the recipe disclosure. Move that sentence outside the code. The horizontal “more freedom” band can still read as a ladder despite the warning; the research supports different approaches, not a superiority ranking. “Any of the above” for connectors must mean potentially usable with additional integration, not verified compatibility.

Approximate word counts below follow source order, exclude hidden details/popovers/code, include generated controls, and assume desktop labels and no saved answers. Readers can scan instead of reading every word; these are exposure and route costs, not measured reading times.

| Part                            |                                                                        Words before its point | Initially exposed words |
| ------------------------------- | --------------------------------------------------------------------------------------------: | ----------------------: |
| A: One test, up close           |                            161 before the answer-key button; another click reveals the answer |   458; 528 after reveal |
| A: Problems it turned up        |                                             24 before the first problem; 439 before the fifth |                     554 |
| A: The release check            |                                 48 before the first “Passed”; 182 before the untested service |                     273 |
| A: What's left before results   |                                               Pause is immediate; 103 before the owner burden |                     358 |
| A: Your verdict                 |                                                                49 before the overall question |                     238 |
| B: See it happen                | 80 before the view example; 142 before the recipe toggle that hides the mechanism explanation |                     224 |
| B: The map                      |                                                                  49 before Pharos's placement |                     158 |
| B: Pharos's spot                |                                                         25 before the agent writes the recipe |                     238 |
| B: How well Pharos does it      |          32 before the first capability; the overall assessment requires scanning eight cards |                     315 |
| B: Open questions and proposals |                                          112 before the first proposal; 173 before the second |                     241 |

The landing pages expose about **260 / 210 words** through the More links. The files contain 92,730 / 95,017 bytes, much of it styling, scripts and hidden material; size alone does not make them word piles. Nevertheless, A's five-problem part and B's capability list expose too much at once. Give each a one-sentence takeaway and short selectable summaries. Put release limitations beside the first result, not after all the passes. The 16,436-word case design can serve builders, but the owner should approve a demonstrated path, not be assigned that specification as prerequisite reading.

After the 30-second viewing, ask the owner to explain the conclusion in their own words, identify what needs them, and open one requested detail. Do not feed them the expected answers. Neither the old six-question trial nor automated fixture correctness establishes this success test.

### Independence

The [three test situations](../evidence/G1/W1.2-case-A-risks.md) and [pass marks](../evidence/G1/W1.6-targets.md) identify Opus 5.5 as author. The sketch discloses that conflict in a first-screen popover and again in part five. Disclosure is good; it does not make the verdict independent.

The favorable part is supported: concrete fixtures, known answers, a second-model [review with 45 resolved findings](../evidence/G1/W1.7-review.md), and an example query that wrongly includes cancelled work. Four fixture tests passed again for this review. But several depicted defects are code deductions or illustrations, not reproduced observations. The [runner record](../evidence/G1/W3.3-harness.md) says no real-agent baseline was recorded; useful-content timing, correction burden and human comprehension remain unscored. The sketch itself concedes that none of the three situations asks whether the reader knows where they stand.

**My independent judgment:** keep the checked test material and confirmed defect evidence; reconsider the oversized approval process and the reader-success criteria. “Already caught real problems” is fair for the confirmed query defect, with the remaining concerns described as code-review findings. “Solid” is not established against the owner's actual goal. Likewise, “more rules than one person can review” is an inference from the measured burden, not a fact about the owner's capacity.

### Smallest change

Claims, questions/answers, saved excerpts and terms each serve an explicit brief requirement; reusing artifacts for sources and decisions for decisions is sensible. The overbuilding is in the proposed initial delivery: generalized claim dependency graphs, nested conditional references, map axes modeled as questions, computed applicability, hypothetical answers and a multi-mode demonstration system. The proposal both includes some held-pattern machinery and says it is deferred. “Two medium tasks and one small” excludes the components and content conversion needed for the owner to experience any benefit.

Start with a live case A opening: sourced claims, one captured example, terms and one answer recorded in history, shown through the smallest catalog extensions that actually render them. Keep that data shape usable for B; add the map and remaining interactions after the owner checks the first path. Defer hypothetical branches, disputes and action gating until a supplied case needs them. Re-estimate a complete working slice, including conversion and display, rather than storage alone. No private held-case material is needed for that boundary.

### Preference

The case B sketch's `renderCaps` moves the chosen card above the others and retains them. The model's §12 instead conditions four factual capability claims on the preference answer; §7 then offers queries based on whether they “apply”. A preference does not make the other deficiencies false or irrelevant. Store a choice-to-card association for ordering, separate from conditions that determine whether a factual finding applies to the reader's circumstances. [The gap map](gaps.md#cross-check-with-the-knowledge-model-proposal) already identifies this disagreement correctly.

### Contracts

The goal, cases and sketches agree on the retained outer frame, closed catalog, visible paths and two-way answers. The gap map is the most accurate account of present product support: it treats browser-local sketch answers as demonstrations and does not count static prose as a working interaction. Its remaining disagreements need actual resolution:

- The model calls A's needs-you line “As today”, but unfinished-task counts cannot express the owner-confirmed roadmap pause. Specify that claim and conditional wording.
- Map axes and open research questions share `askedOf: "others"`; B's broad open-question query would display the axes as unanswered research. Give questions distinct roles or explicit selection tags.
- Existing generic components do not automatically deliver claim text, provenance, expandable cards or term explanations. The model's “no further change” conflicts with [the renderer implementations](../../apps/web/src/catalog/components/generic.tsx).
- Saved examples need declared simulation changes, row identities and a frozen-date route through nested queries. Decision actions need recorded deferral, attribution and a reset rule that preserves accepted decisions. These are missing contracts, not supported features.

Use the gap map's corrections to revise the model and case mappings; do not ask the owner to reconcile three competing descriptions. Its 77-element audit is useful engineering evidence, not an owner-facing progress measure.

### Wording

Apply these specific corrections in the designs and sketches:

- **“No results yet” → “The new G1 tests have not run with a real agent.”** Keep the earlier six-question trial visible as limited historical evidence. “Too small to repeat” → “Not enough runs to establish repeatable quality.”
- **“The only way back is History” → “No Undo button; a second click reopens the task as another change, or History can revert it.”** The [checkbox implementation](../../apps/web/src/catalog/interactive.tsx) explicitly toggles done/todo; reopening does not necessarily restore the previous status.
- **“Show the recipe the AI wrote” → “Show the recipe for this prepared example.”** It matches [the fixture](../../eval/fixtures/workshop-renovation.json), not a recorded live agent answer. The nearby “made for testing” label does not cure the button's contrary implication.
- **“Show the raw output” → “Show the recorded check summary.”** The displayed table contains output summaries; the evidence says raw logs were retained elsewhere.
- **“An empty list says ‘No tasks yet’” → “Some task views say ‘No tasks yet’ when nothing matches.”** [TaskTable](../../apps/web/src/catalog/components/work.tsx) does; the generic lists/tables already use “Nothing matches”.

Other checked facts hold within their stated limits: the workshop jobs, dependencies and frozen date; the copied two-widget recipe; 26 catalog entries; two proposed research decisions; seven promoted tasks; missing generic-widget settings; pause leaving an active run alive; missing keyboard behavior in internal tabs; and query-field warnings rather than refusal. The source exports also support the 15-task model run, distinct from 17 total finished tasks in that stage.

For the prominent outside claims, primary sources corroborate the dated exports: the [Google paper](https://generativeui.github.io/static/pdfs/paper.pdf) reports 82.8% preference against Markdown with generation time excluded; [OpenUI's README](https://raw.githubusercontent.com/thesysdev/openui/main/README.md) makes the “up to 67%” token claim; [Tambo's README](https://raw.githubusercontent.com/tambo-ai/tambo/main/README.md) gives the shutdown/deletion dates and self-hosting option; and [A2UI's specification](https://a2ui.org/specification/v0.9.1-a2ui/) labels 0.9.1 current and 1.0 candidate. These do not establish Pharos performance or interoperability. [A2UI actions](https://a2ui.org/concepts/actions/) include local functions as well as server events, so the sources panel's “actions back to the agent” should say “local actions or events sent to the server”.

Review boundary: read all five documents and both HTML sketches; checked their cited exports, repository evidence, fixtures and relevant code, with independent read-only evidence and model audits. No browser usability test, live Pharos access or held-case inspection. Only this review was written in the repository.
