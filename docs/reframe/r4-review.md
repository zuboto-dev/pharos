# Independent check of the demo pages

2026-10-12 · written by GPT-6.1-Sol · commit 2860c15

**Verdict: revise once before the owner's check.** The flows, progress bars and actual guide
diff deliver a clear improvement. OpenUI's numbers are correct. Desktop largely meets the
30-second test; phone navigation is promising, but terminology and evidence access still get
in the way. This is a prediction from screenshots and code, not a timed owner test.

1. **Page — make the spectrum understandable and keep the source's scope.** Replace the closed
   labels “Static / Declarative / Open-ended” with “AI fills one block / AI arranges blocks / AI
   writes page code”; keep the technical names inside the opened detail. Replace “most products
   land here” with “OpenUI says most production agent interfaces use this approach.” Its report
   describes production agent interfaces, not products generally.
2. **Code — give the guide-change headline its evidence.** In
   [BeforeAfter](../../apps/web/src/catalog/components/before-after.tsx), render
   `CertaintyMark` and the assumption control for `stated`, beneath its statement. The two pane
   marks currently leave the framing claim's own sources and assumption unreachable.
3. **Code — keep source panels inside the phone screen.** In
   [Popover](../../apps/web/src/catalog/popover.tsx), replace the fixed 240-pixel placement
   estimate with available viewport space; clamp the panel to an eight-pixel inset and give it
   `overflow-y-auto`. Check the seven-source headline near both viewport edges.
4. **Code — show the whole open-task title on phone.** In
   [OpenTasks](../../apps/web/src/catalog/components/layer-progress.tsx), replace the title's
   `truncate` with wrapping (`whitespace-normal break-words`). The owner should see which task
   they are opening without opening a drawer to finish its name.
5. **Code — recognise reordered passages as changes.** Replace the line-membership comparison in
   [changedLines](../../packages/schema/src/views/text-tools.ts) with a sequence-aware diff;
   determine “same” from the complete passages. `A\nB` → `B\nA` currently produces “The two
   passages are the same.” The demo's single-line edit is correct, but the block is not reliable
   for another quoted passage.

<details>
<summary>Supporting detail: source checks, readings, blocks and the 30-second prediction</summary>

**Public-source audit — all 11 shown From-source claims checked against live web content on
12 Oct.** The web reader failed to open OpenUI; direct HTTP succeeded. This review fetched the
report independently of the builder's verification. The checks below cover stored passages,
figures, locators and statement scope, including claims hidden behind a box or bar. The old
207-test release claim remains in the project but is not shown by these demo specs.

| Claims                                                 | Quote and locator                                                                                                                                                                                           | Statement judgment                                                                                                                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guide before (one)                                     | Exact passage at [README lines 105–106, v0.1.0](https://github.com/zuboto-dev/pharos/blob/8bb6b32/README.md#L105-L106).                                                                                     | Fair within its stdio context: changes written by the separate agent process, rather than every update path.                                                                                                                   |
| Question and live drawing (two)                        | Exact passages at [README lines 11–13](https://github.com/zuboto-dev/pharos/blob/8bb6b32/README.md#L11-L13).                                                                                                | Fair descriptions of the documented question-to-view and live-update behaviour; no measured speed claim.                                                                                                                       |
| Agent arranges blocks and Pharos's fixed catalog (two) | Exact comment at [catalog line 5, pinned commit](https://github.com/zuboto-dev/pharos/blob/8bb6b3289bafc4f21c3b2390f64600404b25cde2/packages/schema/src/views/catalog.ts#L5).                               | Fair with the catalog definitions and README's composition description. The one-line excerpt describes the allowed blocks and props, rather than proving the whole runtime.                                                    |
| Static, declarative and open-ended (three)             | Each excerpt's words occur verbatim under its named generation section in [OpenUI's report](https://www.openui.com/blog/state-of-generative-ui-report); the declarative excerpt flattens a paragraph break. | Static and open-ended are fair summaries; “walled off” describes the cited sandboxed iframe, not an independently tested security guarantee. “Most products” broadens the declarative passage's population; fix 1 restores it. |
| Token finding and both bars (three)                    | Exact shared excerpt in the report's token-efficiency section; the table separately confirms 4,800 and 10,180.                                                                                              | Fair, explicitly OpenUI's own benchmark: seven scenarios, GPT-5 tokenizer, output-format tokens. 4,800 / 10,180 = 47.15%; “under half” is correct. It does not establish Pharos's cost, quality or measured latency.           |

**Our-reading audit — all 15 shown claims checked against their evidence and read-only replay
records.** The owner-confirmed Keep claim was checked separately against its accepted decision.

| Reading                                | Judgment and basis                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 headline                            | **Fair in this context.** The [case review](../evidence/G1/W1.7-review.md), [measures](../evidence/G1/W1.5-metrics.md) and [runner note](../evidence/G1/W3.3-harness.md) distinguish preparation from measurement. The accepted pause decision and open measurement/report tasks agree. “Nothing measured” concerns this baseline, not earlier historical experiments.                                                                   |
| Three part-status claims               | **Fair, bounded.** Written/reviewed tests await approval; release findings are fixed or filed and the service remains untested; fixtures and the sample runner are built. The runner's “ready” means sample infrastructure: browser/provider capture and the frozen corpus remain prerequisites. Quote locators resolve to the introductory summaries.                                                                                   |
| Three test-job claims                  | **Fair descriptions of intended tests, not demonstrated capabilities.** Each purpose passage matches [risk](../evidence/G1/W1.2-case-A-risks.md), [refinement](../evidence/G1/W1.3-case-B-refine.md) or [task action](../evidence/G1/W1.4-case-C-act-reuse.md). All three show their case, [targets](../evidence/G1/W1.6-targets.md) and review as sources. Those are three supporting documents, not three independent successful runs. |
| Guide after and stated change          | **Fair.** Local [README](../../README.md) lines 109–110 and [release findings](../evidence/G1/W2.5-findings.md) support both. The after passage is exact. Public main still has the old wording; the stored assumption correctly says the change is unpublished. Fix 2 exposes the framing claim's basis.                                                                                                                                |
| Facts, completion and fixes (three)    | **Fair.** All three quoted definitions and locators match the measures file's section 3. “Every check passes” is a completion criterion, not a measured result.                                                                                                                                                                                                                                                                          |
| Time, tokens, dollars                  | **Fair summary; passage could be stronger.** Section 3 defines all three, but this claim quotes and locates only Total latency. Its passage does not explain the token or dollar measures. Tool calls and time to useful content also exist in the full procedure.                                                                                                                                                                       |
| Generative UI headline and Build (two) | **Fair recommendations, not a proved market-wide absence.** They agree with the approved reader-first direction and the research records. Their assumptions limit the comparison to surveyed tools; five source links alone do not establish that no other product supplies reader guidance.                                                                                                                                             |
| Keep (owner-confirmed)                 | **Supported.** The accepted decision preserves Pharos's catalog/store and makes integrations conditional on a named need. The claim retains that condition.                                                                                                                                                                                                                                                                              |

The replay task counts independently reproduce **7/8, 6/7 and 2/9**, with **1, 1 and 7 open
tasks**. The queries exclude umbrella tasks and the progress code excludes cancelled tasks by
status meaning. The approval and release recheck are still open. No task count certifies an
outcome gate.

**Blocks against the plan.** Flow boxes are pictures with arrows, status pills, hidden claims
and a common progress scale; they stack with down arrows on phone. Tapping the box also covers
tapping its count and opens the task list, then its claim. BeforeAfter shows the real changed
words, stacks its panes, and uses deletion/insertion cues beyond colour; fixes 2 and 5 address
its evidence and diff gaps. FindingChart binds both numbers to stored figures, highlights one
bar, labels values directly and opens the passage beside the bar. The evidence mark counts
local documents and exposes their quote, path and locator; source count indicates provenance,
not independent corroboration. StartHere's short evidence labels retain the full accessible
name. Mini bars are implemented for stat query/denominator pairs and inline Text counts, with
text equivalents; these demos exercise the per-part bars, not the separate mini-bar modes.
Specs hold references and labels rather than copied findings.

**Keyboard and screen-reader basics — mostly sound by inspection.** Native buttons provide
Enter/Space; flows support arrows/Home/End, chart bars support Up/Down/Home/End and Escape.
Expanded states and named detail regions are present. Reading-path buttons scroll and move
focus; popovers receive focus and Escape returns it. Decorative arrows/bars are hidden while
counts remain readable. BeforeAfter speaks added/removed text. Fix 3 concerns visible evidence
access; fix 4's truncation is visual, since the accessible text retains the full title. No
interactive browser or assistive-technology run was performed.

| Predicted 30-second result | What the owner gets                                                                                                                         | What they miss or must work for                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 desktop                 | Paused, nothing needed now; all three part statuses; opening Measure reveals seven tasks; the guide's softened promise is directly visible. | The guide-change headline's own certainty/basis; some task titles still use technical language.                                                       |
| G1 phone                   | The same status and diff pictures remain readable; Parts and Guide fix provide direct jumps.                                                | The opening fills roughly a phone screen after the app frame. Scrolling is necessary; open-task titles can truncate and large source panels can clip. |
| Generative UI desktop      | Question → blocks → screen; Pharos's highlighted position; the attributed token comparison; Keep and Build. A bar opens its actual passage. | The closed spectrum's jargon does not explain the distinction until tapped. “Tokens” lacks an explanation beside the figures.                         |
| Generative UI phone        | Flows stack cleanly and the proportional bars retain labels and numbers. The reading path can skip straight to a picture.                   | More vertical travel; the same terminology gap. The captures show opened details only on desktop, so phone interactions remain predictions from code. |

The server counts **146 / 112 words** before opening details, below the agreed limit. It excludes
renderer-added marks and labels; the screenshots, not those totals alone, establish reading
effort. Colours and legends remain helpful. The three-column prose problem is gone, and
unnecessary term underlines are largely absent inside pictures. Local passages are substantially
more reachable than in the [earlier review](r3-review.md), subject to the fixes above.

Boundary: patch data, builder notes/checks, all seven supplied screenshots, relevant repository
evidence/code and scoped SQLite reads. No live instance, manually started server, patch execution
or held private case. Typecheck, lint, format check and all **435 tests** passed. Tests use
isolated data.

</details>
