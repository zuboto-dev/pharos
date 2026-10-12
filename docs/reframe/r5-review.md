# Independent check of “Agent reports at a glance”

2026-10-12 · written by GPT-6.1-Sol · commit 77c83b3

**Verdict: revise before the owner's check.** This works as a topic page: readable pictures,
short labels, references on demand, no task scoreboard. All 22 source quotations check out,
but the counts mix product modes and omit documented features. The headline promises more
than that sample establishes. Desktop is close to the 30-second bar; phone requires a jump
or scroll before the first picture. These are predictions, not an owner test.

1. **Page — define the comparison and recount it.** Show seven named tools with the mode
   checked and four evidence categories; mark missing documentation “not found”. Broad tool
   coverage adds Codex and Cursor plans, Claude test output and Cursor questions (details below).
   Replace the headline with “The pages we checked describe tests or citations more often than
   explicit confidence ratings.” A citation is evidence to inspect, not proof that work passed.
2. **Page — preserve the sources' limits.** Change Copilot “runs tests” to “can run tests”.
   Label GitHub confidence “supported issue changes · public preview”; Devin “2.1 announcement,
   2025 · current availability unconfirmed”. Put “2023 · four search engines · averages” beside
   the citation figures, including opened bar statements.
3. **Code — expose a count's basis when its bar opens.** In
   [BarDetail](../../apps/web/src/catalog/components/finding-chart.tsx), render `ClaimBasis`
   and every contributing tool/source. The current panel has no assumption control and displays
   only the first source directly; its source popover also omits the assumption.
4. **Page — show categories without a false sequence or unsupported gaps.** Use stacked
   evidence categories instead of arrows under “How a report reaches you”. Rename the last
   section “Limits and cautions”: “Code review screens”, “Detail needs balance”, “Published
   safety evidence”. Three coding-tool sources do not establish “most reports”; Anthropic's
   design advice does not establish a measured gap.
5. **Code — give proportion charts their denominator.** Add an explicit maximum to
   [FindingChart](../../apps/web/src/catalog/components/finding-chart.tsx): 7 for tool counts,
   100 for percentages, with a faint full-length track. Currently 6 of 7 and 74.5% fill the
   available bar area, and 51.5% occupies 69% of it. The ratios are correct; the whole is unclear.

<details>
<summary>Supporting detail: live source audit, tool counts, readings and 30-second prediction</summary>

**Audit boundary.** Live public pages checked on **12 Oct 2026**, independently of the
builder's saved texts and quote checker. Reviewed the patch, notes, five screenshots,
chart/evidence rendering code and scoped read-only SQLite records: 29 claims, comprising
22 From-source and seven Our-reading claims. No patch execution, server startup, live owner
instance or private case access. The document date above follows the requested review header.

**Every From-source claim — quotation words and named locators verified.** The figure values
51.5 and 74.5 occur in the quoted abstract; the Index abstract separately confirms 30 agents.
Section locators identify the passages, although most source URLs open at the page top.
The following groups cover all 22 claims, including those behind boxes and tabs.

| Source and claims                                                                                                                                         | Locator and statement judgment                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GitHub sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents): log, tests (2)                | Review session logs. Log is fair; tests changes a capability into an unconditional action. Fix 2.                                                                                                |
| [GitHub issue controls](https://github.blog/changelog/2026-07-23-agent-automation-controls-in-github-issues-in-public-preview/): approval, confidence (2) | What's new. Fair for supported issue actions; Supported platforms and actions includes Copilot cloud automations. Public preview, optional suggest mode, no general coding-confidence guarantee. |
| [Codex Cloud](https://learn.chatgpt.com/docs/cloud): test results, asks (2)                                                                               | Quickstart step 5; Start with your project. Fair descriptions of documented review and missing-information/access requests.                                                                      |
| [Claude Code](https://code.claude.com/docs/en/how-claude-code-works): permissions (1)                                                                     | Control what Claude can do. Fair because the statement says “in one setting”; not every permission mode.                                                                                         |
| [Anthropic framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents): checklist, detail balance (2)             | Transparency in agent behavior. Both fair; August 2025 design guidance, not a survey of today's reporting failures.                                                                              |
| [Devin session tools](https://docs.devin.ai/work-with-devin/devin-session-tools): log, testing captures (2)                                               | Progress Tab; Browser use cases. Fair: logging is documented, captures are explicitly a capability.                                                                                              |
| [Devin 2.1](https://cognition.com/blog/devin-2-1): confidence, plan approval (2)                                                                          | Confidence Ratings; Plan Confirmation Simplification. Exact historical feature claims from May 2025; live availability of the announcement does not establish present behaviour.                 |
| [Cursor background agents](https://cursor.com/help/ai-features/background-agents.md): captures/logs (1)                                                   | How do background agents show their work? Fair for this mode; quote verified on the live help page.                                                                                              |
| [Replit Agent](https://docs.replit.com/features/agent/overview): task list, approval (2)                                                                  | Plan mode. Fair, conditional on using Plan mode.                                                                                                                                                 |
| [Replit App Testing](https://docs.replit.com/features/agent/app-testing): summary (1)                                                                     | The Testing Process. Fair for supported Full Stack JavaScript/Streamlit apps in Power/Max modes; the agent chooses when to test.                                                                 |
| [Perplexity help](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work): citations (1)                                     | Citing sources. Faithfully summarizes that page's answer behaviour; says nothing about citation accuracy or autonomous agent runs.                                                               |
| [Liu et al.](https://arxiv.org/abs/2304.09848): audit headline, both figures (3)                                                                          | Abstract. Correct pooled averages across Bing Chat, NeevaAI, perplexity.ai and YouChat in 2023. Not current Perplexity performance, seven-tool results, or two complementary percentages.        |
| [AI Agent Index](https://arxiv.org/abs/2602.17753): safety disclosure (1)                                                                                 | Abstract. Fair about makers' published safety/evaluation information across 30 agents; indirect evidence about individual work reports. “Little disclosed” does not mean “little testing done”.  |

**Recount, tool by tool.** Entries reproduce the builder's 4 / 6 / 5 / 2 from the selected
passages, then show evidence I would count differently under the page's broad “tools” wording.
“—” means no positive found in this review, not a product lacks the feature. “Yes” denotes a
documented capability in at least one mode, not an observed run.

| Tool           | Plan / steps         | Tests / citations      | Choices / questions    | Explicit confidence rating                   |
| -------------- | -------------------- | ---------------------- | ---------------------- | -------------------------------------------- |
| GitHub Copilot | Yes                  | Yes, can run           | Yes, issue suggestions | Yes, supported issue actions in preview      |
| OpenAI Codex   | — → Yes, app/CLI/IDE | Yes                    | Yes                    | —                                            |
| Claude Code    | Yes                  | — → Yes, transcript    | Yes                    | —                                            |
| Devin          | Yes                  | Yes                    | Yes, 2.1 announcement  | Yes historically; current status unconfirmed |
| Cursor         | — → Yes, Plan Mode   | Yes, background agents | — → Yes, Plan Mode     | —                                            |
| Replit Agent   | Yes, Plan mode       | Yes, App Testing       | Yes, Plan mode         | —                                            |
| Perplexity     | —                    | Yes, citations         | —                      | —                                            |

**Changed inclusions and their sources:** [OpenAI's plan-mode description](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)
under Plan.md explicitly covers app, CLI and IDE, rather than Cloud. [Cursor Plan Mode](https://cursor.com/docs/agent/plan-mode)
describes a reviewable plan, clarification questions and a build choice. [Claude's agent loop](https://code.claude.com/docs/en/how-claude-code-works)
describes test execution/error output; [Desktop transcript and CI status](https://code.claude.com/docs/en/desktop)
make tool activity and check results visible. Excluding Claude while accepting comparable logs
elsewhere is too narrow for “test proof or citations”.

For broad products, I count **6 / 7 / 6 / 1 confirmed plus 1 historical**. Keeping the original
cloud/background restrictions does not justify adding the app/IDE positives; it instead requires
mode-specific labels and an explicit restricted comparison. [Cursor run modes](https://cursor.com/docs/agent/security/run-modes)
specifically distinguish cloud agents, which do not request approval. The confidence count of
2 is defensible only as “two sources describe ratings”, accepting Devin's older announcement.
No audited source establishes that a rating is calibrated or reliable.

**All seven Our-reading claims.** The headline and chart title are **overstated**: citations
do not describe testing, and sparse documentation does not measure how often agents express
uncertainty. “Explicit confidence ratings are less documented” is the fair, stronger distinction.
The four bars are **reproducible but incomplete**, with ambiguous mode boundaries and no
proof of negatives. “Most reports land where coders work” is **overstated** from three selected
coding tools; their code review evidence is real, but no owner comprehension study was done.
The last two cautions are sourced claims, rather than Our-reading records: keep their meanings
as advice and maker disclosure, not measured report shortcomings.

**Predicted first 30 seconds.** The server reports **137 words** before detail, under the
agreed limit; renderer labels and navigation still consume space.

| View    | What the owner gets                                                                                                                        | What they miss                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop | Clear question, main conclusion, nothing needed now, four comparable counts, named routes to passages; a bar/box can open evidence.        | Which seven tools and which modes; what a negative means; whether confidence is current. The bars offer no visible opening cue, and the flow suggests a universal sequence.                       |
| Phone   | Readable wrapping and stacked boxes; path buttons offer direct jumps; the supplied open-flow capture shows readable individual tool cards. | The app frame plus opening reaches roughly 906 pixels before the first chart. A typical initial screen shows no infographic; scope caveats and the bottom cautions require additional navigation. |

This is a knowledge comparison that works beyond project management. Its limitation is the
comparison's evidence and framing, not a need for task/progress widgets. No interactive browser
or timed owner test was performed; screenshots establish layout, not successful interaction.

**Checks:** typecheck, lint and format check passed. The first full test run had two web-test timeouts and
a server fixture failure before the recursive run stopped. The full suite passed on rerun with
`--maxWorkers=1`: **446 tests** (39 schema, 233 web, 174 server), without code changes.

</details>
