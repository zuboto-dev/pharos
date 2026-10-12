# R3.0 · Public methods for reader-first reports

Searched 2026-10-12 at the owner's request, before writing the "start here" rules (R3.1). Two Opus 5.5 agents: part A on how a report is structured, part B on pictures, sources and certainty. Every source was opened on the date shown; anything not confirmed is marked.

### Part A: R3.0a — Methods for structuring a report so the reader knows where to start

Checked 2026-10-12. "Checked" means I opened the page and read it. Where I could not open the primary page, I say "not confirmed".

### 1. Methods at a glance

| Method                                 | What it is                                                                                                | Origin                                                   | Source (checked)                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLUF                                   | Put the main point at the very start of the message.                                                      | US Army, AR 25-50 (version read: 17 May 2013)            | [AR 25-50 PDF, para 1-36b](https://home.army.mil/wood/application/files/3015/5751/8343/AR_25_50_Army_Correspondence.pdf) (2026-10-12)                                                                                                                                                                                                                |
| Inverted pyramid                       | Most important information first, details after, in falling order.                                        | Journalism                                               | [NN/g, Schade 2018](https://www.nngroup.com/articles/inverted-pyramid/) (2026-10-12)                                                                                                                                                                                                                                                                 |
| Minto Pyramid / SCQ(A)                 | One governing thought on top, grouped supporting ideas below; intro uses Situation–Complication–Question. | Barbara Minto, McKinsey                                  | [barbaraminto.com/concept](https://www.barbaraminto.com/concept), [home](https://www.barbaraminto.com/) (2026-10-12)                                                                                                                                                                                                                                 |
| Amazon six-page narrative memo         | Narrative memo instead of slides, read silently at the start of the meeting.                              | Amazon                                                   | [Bezos 2017 shareholder letter](https://www.aboutamazon.com/news/company-news/2017-letter-to-shareholders) (2026-10-12)                                                                                                                                                                                                                              |
| Executive summary                      | A short stand-alone version of a report that leads with findings and recommendations.                     | Business / technical writing                             | [WAC Clearinghouse, Colorado State](https://wacclearinghouse.org/repository/writing/guides-old/execsum) (2026-10-12)                                                                                                                                                                                                                                 |
| Diátaxis                               | Split docs into four kinds by reader need: tutorial, how-to, reference, explanation.                      | Daniele Procida                                          | [diataxis.fr](https://diataxis.fr/), [start-here](https://diataxis.fr/start-here/) (2026-10-12)                                                                                                                                                                                                                                                      |
| Progressive disclosure                 | Show a few key items first; reveal the rest on request.                                                   | Jakob Nielsen / NN/g, 2006                               | [NN/g](https://www.nngroup.com/articles/progressive-disclosure/) (2026-10-12)                                                                                                                                                                                                                                                                        |
| F-pattern scanning                     | Eye-tracking: readers scan the top, then the left edge; first lines and first words get most looks.       | NN/g eye-tracking, 2006                                  | [NN/g, Pernice 2017](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/) (2026-10-12)                                                                                                                                                                                                                                            |
| Information scent                      | Readers guess a link's value from its label and nearby summary before clicking.                           | Information-foraging theory                              | [NN/g, Budiu 2020](https://www.nngroup.com/articles/information-scent/) (2026-10-12)                                                                                                                                                                                                                                                                 |
| Plain language / GOV.UK content design | Start from the user need; most important information first; front-load headings.                          | UK Government Digital Service; US Plain Writing Act 2010 | [GOV.UK clear structure](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/), [GOV.UK summaries](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/summaries/), [digital.gov plain language](https://digital.gov/guides/plain-language) (2026-10-12) |
| Architecture decision record (ADR)     | Short record of one decision: title, context, decision, status, consequences.                             | Michael Nygard, 2011                                     | [Cognitect blog](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2026-10-12)                                                                                                                                                                                                                                              |
| "You are here" wayfinding              | Pages must show where the reader is, using headings, highlights, breadcrumbs and progress steps.          | NN/g (web navigation)                                    | [NN/g, Farrell 2015](https://www.nngroup.com/articles/navigation-you-are-here/) (2026-10-12)                                                                                                                                                                                                                                                         |
| Decision / action memo                 | Purpose up front, short background, then a recommendation with Approve / Disapprove lines.                | US government staff practice                             | Not confirmed. [DoD action memo guidance](https://www.esd.whs.mil/Portals/54/Documents/CMD/Templates/Action%20Memo%20Guidance.pdf) returned 403. Structure is from search snippets only.                                                                                                                                                             |
| Agent run reports                      | Agent products let the reader trace what changed, what was checked, and why, back to logs.                | GitHub Copilot coding agent; OpenAI Codex                | [GitHub docs: agent logs](https://docs.github.com/en/copilot/using-github-copilot/coding-agent/using-the-copilot-coding-agent-logs) (2026-10-12). OpenAI Codex page returned 403: not confirmed.                                                                                                                                                     |

Dropped: Lullabot's wayfinding article (secondary, and it did not hold the "four questions" claimed in search results).

### 2. Each method: core rule and what Pharos takes

**BLUF.** AR 25-50: "Two essential requirements include putting the main point at the beginning of the correspondence (bottom line up front) and using the active voice."
BORROW. Every report page opens with one sentence that states the outcome. It is the cheapest fix for "I don't know where to stand".

**Inverted pyramid.** "Start content with the most important piece of information so readers can get the main point, regardless of how much they read" (NN/g).
BORROW, at every level: page, section, card. Each block's first line carries its point.

**Minto Pyramid / SCQ.** One "single thought" on top; ideas grouped under it; "guide the reader down the pyramid". SCQ frames the reader's question. The "A" (answer) in SCQA is widely added; I did not confirm it on Minto's own site.
ADAPT. Use the pyramid as the page's shape: one headline claim, 3–5 supporting cards, evidence below. Use SCQ only as a one-line "why this matters" for found-type pages. Skip the full formal method.

**Amazon six-page memo.** Narrative, not slides, read silently at the start.
SKIP the format; our owner wants fewer words. BORROW one idea: the reader gets a self-contained page they can read alone, without the agent there to explain.

**Executive summary.** Stand-alone, findings first, then concrete recommendations naming who acts. WAC: "usually no longer than 10% of the original document"; "Accuracy is essential because decisions will be made based on your summary."
BORROW stand-alone and "who acts". ADAPT the length rule to a hard cap (for example, one screen).

**Diátaxis.** Four kinds of docs, set on two axes (action vs cognition, acquisition vs application). "Crossing or blurring the boundaries ... is at the heart of a vast number of problems."
ADAPT. The lesson is "one page, one purpose". Our three purposes (done / found / needs you) play the same role as Diátaxis types. A page should declare its purpose and not mix them in the opening.

**Progressive disclosure.** Show the few most-used items first, the rest on request. Clear labels for what opens. Rarely more than two levels.
BORROW directly, including the two-level limit: opening layer, then details on tap. It fits "interactive" and "less words".

**F-pattern.** "First lines of text on a page receive more gazes"; "Include the most important points in the first two paragraphs."
BORROW. Put the start-here block at top-left. Headings and labels front-load the key word.

**Information scent.** Readers judge where to go from labels and summaries; misleading labels erode trust.
BORROW. Each "next step" link in the opening says what the reader will find, in plain words. No vague "See more".

**Plain language / GOV.UK.** "Put the most important information first." GOV.UK notes users read about "20 to 28%" of a page and scan in an F shape. Headings are descriptive and front-loaded; summaries stay under 160 characters and include a verb.
BORROW the 160-character summary as a concrete limit for the headline sentence. BORROW "start from the user need".

**ADR.** Title, Context, Decision ("We will ..."), Status, Consequences (good, bad, neutral). One to two pages.
ADAPT for "needs you" pages: show the open decision with its context, options and consequences, and status (proposed). After the reader decides, it becomes a record.

**"You are here" wayfinding.** Pages must show location; test by asking "Pretend you just arrived at this web page. Where are you?" Progress indicators number and name steps.
BORROW the test as a review check for agent pages. ADAPT: show where this report sits in the project (stage, goal) and the reading path (step 1 of 3).

**Decision / action memo.** Not confirmed from a primary source. My reading: the recommendation and a clear approve/decline choice sit near the top.
ADAPT for "needs you": the ask goes first, with explicit choices. Mark as unconfirmed until we open a primary template.

**Agent run reports.** GitHub: session logs show "the tools it used to understand your repository, make changes, and validate its work". Each commit links to the logs "so you can trace why a change was made". OpenAI Codex reportedly cites terminal logs and test output; not confirmed (page blocked).
BORROW traceability: every claim in the opening links to its evidence (revision, file, test, source). This is "true references". SKIP raw logs as the main view; they sit behind disclosure.

### 3. Synthesis: what "start here" should contain

Common to all three (BLUF, inverted pyramid, F-pattern, GOV.UK, NN/g "you are here"):

- A purpose tag: Done, Found, or Needs you (Diátaxis: one page, one purpose).
- A headline sentence, under about 160 characters, with a verb (BLUF, GOV.UK summaries).
- Where this sits: project, stage or goal, date (you-are-here wayfinding).
- A short numbered path of 2–4 labeled steps, each saying what you will see (information scent, progressive disclosure, two levels max).
- Every claim links to its evidence (agent run reports, executive summary accuracy).

**What was done.**

- Headline: what changed, in outcome terms (BLUF).
- Proof it works: what was checked and the result, linked to evidence (Copilot logs, Codex: not confirmed).
- What is left or not done (inverted pyramid: ranked by importance).
- Details and logs behind disclosure (progressive disclosure).

**What was found.**

- Headline: the single main finding (Minto top, BLUF).
- One line of why it matters: situation and complication (SCQ).
- 3–5 supporting findings as cards, each with a source (Minto grouping, executive summary).
- Confidence and limits stated plainly (executive summary accuracy; my reading).
- Method and raw data on tap (progressive disclosure).

**What needs you.**

- Headline: the decision asked, and by when (BLUF, action memo: not confirmed).
- The options, each with its consequences (ADR).
- The agent's recommendation and why (executive summary, Minto).
- Context, kept short (ADR context, action memo background).
- A clear way to answer: choose, ask, or defer (action memo approve/disapprove: not confirmed).

### Part B: R3.0b — Public methods for showing information, sources and certainty

Checked 2026-10-12. "Our reading" marks my interpretation, not the source's words.

### 1. Methods

| Method                                  | What it is                                                                                                            | Origin                                                                       | Source (checked 2026-10-12)                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data-ink, small multiples               | Spend the ink on data; repeat one small chart across cases.                                                           | Tufte, _The Visual Display of Quantitative Information_, 1983 / 2nd ed. 2001 | https://www.edwardtufte.com/book/the-visual-display-of-quantitative-information/ (book page lists "The data-ink ratio" and "small multiples"; I did not read the book text)  |
| Sparklines                              | "A small intense, simple, word-sized graphic with typographic resolution."                                            | Tufte, 2004                                                                  | https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/                                                                                             |
| Storytelling with Data                  | Know context and audience, pick the right chart, cut clutter, direct attention, design, tell a story.                 | Knaflic, Wiley 2015                                                          | https://www.wiley.com/en-us/Storytelling+with+Data%3A+A+Data+Visualization+Guide+for+Business+Professionals-p-9781119002253                                                  |
| Visual information-seeking mantra       | "Overview first, zoom and filter, then details-on-demand." Plus relate, history, extract.                             | Shneiderman, "The Eyes Have It", 1996                                        | https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf                                                                                                                   |
| Explorable explanations                 | Reactive documents, explorable examples, contextual information.                                                      | Bret Victor, 10 Mar 2011                                                     | https://worrydream.com/ExplorableExplanations/                                                                                                                               |
| Narrative visualization (martini glass) | Author-driven path first, then open up for reader exploration.                                                        | Segel & Heer, IEEE InfoVis 2010                                              | https://homes.cs.washington.edu/~jheer/files/narrative.pdf                                                                                                                   |
| Scrollytelling ("How to Scroll")        | Scroll-driven stories; never hijack native scrolling.                                                                 | Bostock, 3 Nov 2014                                                          | https://bost.ocks.org/mike/scroll/                                                                                                                                           |
| Titles that state the finding           | Title slant strongly shapes the message readers take from a chart.                                                    | Kong, Liu, Karahalios, CHI 2018                                              | https://mail.zcliu.cs.umd.edu/vistitles/CHI18-VisTitles.pdf                                                                                                                  |
| Dashboard design                        | Most important information for an objective, on one screen, read at a glance.                                         | Few, "Dashboard Confusion", 20 Mar 2004                                      | https://www.perceptualedge.com/articles/ie/dashboard_confusion.pdf                                                                                                           |
| IPCC calibrated language                | Confidence (evidence × agreement, 5 levels) kept apart from likelihood (% ranges).                                    | Mastrandrea et al., IPCC AR5 Guidance Note, 2010                             | https://www.ipcc.ch/site/assets/uploads/2017/08/AR5_Uncertainty_Guidance_Note.pdf                                                                                            |
| ICD 203 estimative language             | Fixed likelihood words with % bands; separate information from assumptions and judgments.                             | US DNI, signed 2 Jan 2015 (amended)                                          | https://archive.dni.gov/files/documents/ICD/ICD-203.pdf                                                                                                                      |
| GRADE certainty                         | Four levels (high, moderate, low, very low) with named reasons to downgrade or upgrade.                               | Schünemann et al., Cochrane Handbook ch. 14                                  | https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-14                                                                                           |
| Wikipedia verifiability                 | Claims must be attributable to reliable published sources; inline cites for challenged claims; "citation needed" tag. | Wikipedia policy                                                             | https://en.wikipedia.org/wiki/Wikipedia:Verifiability                                                                                                                        |
| Verifiability of AI citations           | Audit of AI search engines: citations often don't support the sentence.                                               | Liu, Zhang, Liang, 2023                                                      | https://arxiv.org/abs/2304.09848                                                                                                                                             |
| Tooltip guidelines                      | Tooltips are brief extras; never hide essential info in them; support keyboard.                                       | Kendrick, NN/g, 27 Jan 2019                                                  | https://www.nngroup.com/articles/tooltip-guidelines/                                                                                                                         |
| Cognitive load / split attention        | Working memory is limited; place text next to the picture it explains; remove extras.                                 | Sweller, van Merriënboer, Paas 1998; Chandler & Sweller 1991                 | https://research.utwente.nl/en/publications/cognitive-architecture-and-instructional-design/ (abstract) and https://en.wikipedia.org/wiki/Split_attention_effect (secondary) |

Dropped: none fully. Few's "13 common mistakes" list is in his 2006 book; I could not open it, so only his dashboard definition is used.

### 2. Rules and what Pharos should do

**Tufte: data-ink, small multiples.** Remove decoration; show many cases in one repeated frame for comparison. BORROW. Agents should prefer one repeated mini-chart over several different charts. Data-ink detail is from my memory of the book, not the page I opened — not confirmed.

**Tufte: sparklines.** Graphics "can be everywhere a word or number can be." BORROW. A word-sized trend inside a sentence or table cell fits "less words" directly.

**Storytelling with Data.** Context first, cut clutter, direct attention to one thing. BORROW the "direct attention" rule: each picture highlights one item; the rest goes grey. SKIP the business-slide framing.

**Shneiderman's mantra.** Overview first, then zoom/filter, details on demand. BORROW as the page order rule: one overview picture at top, claim cards below, sources and raw detail behind a tap. This matches Pharos's layered picture block.

**Explorable explanations.** Let readers change an assumption and see the result; give context just-in-time so they can "cross-check the author's claims." ADAPT. Tap-to-explain terms already cover "contextual information." Reactive sliders are costly; add only where a report has a real number that depends on an assumption.

**Martini glass (Segel & Heer).** Short fixed path first, then free exploration. BORROW. This is the right shape for a report view: 3–5 claim cards in order, then the explorable board.

**Scrollytelling (Bostock).** Prefer scrolling to clicking; scrolling must stay fast, reversible and native. ADAPT. Use a sticky picture with steps if needed. SKIP scroll-jacking and auto-play.

**Finding-as-title (Kong et al.).** Title slant shapes what readers take away, and viewers over-trust charts as neutral. BORROW with a guard: the title states the finding, and it must be the same sentence as a claim card with its certainty. A slanted title with no claim behind it should get a save-time warning (our reading).

**Few: dashboards.** One screen, at a glance, for an objective. ADAPT. Good for a project status view, not for an explanation. Use as the rule for the Overview view only.

**IPCC.** Rate confidence from evidence (limited/medium/robust) and agreement (low/medium/high), 5 levels; likelihood is a separate % scale; give a "traceable account" of the evaluation. CHALLENGES Pharos: our three levels say _who_ stands behind a claim, not _how strong_ it is. "From source" can be one weak blog or ten studies. ADAPT: keep the three levels as provenance; add an optional evidence note (how many sources, do they agree). Do not invent percentages.

**ICD 203.** Fixed likelihood words with % bands (e.g. "likely" 55–80%). Don't mix confidence and likelihood in one sentence. Clearly separate underlying information from assumptions and judgments. CONFIRMS Pharos: "from source" vs "our reading" is exactly the information-vs-judgment split. BORROW the rule that an agent must state the key assumption when a claim is "our reading." SKIP the % table unless a report forecasts events. ICD 203 also asks for visuals "where appropriate", including interactive displays.

**GRADE.** Four certainty levels, each lowered for named reasons (risk of bias, inconsistency, indirectness, imprecision, publication bias). ADAPT the idea of _named reasons_: when a claim is weak, show why (one source, sources disagree, source is indirect). SKIP the medical-trial specifics.

**Wikipedia verifiability.** Every claim attributable; "citation needed" marks gaps openly. BORROW. A claim card with no source should show a visible "no source yet" mark, not hide it.

**Liu et al. 2023.** In 4 AI search engines, only 51.5% of sentences were fully supported by citations, and only 74.5% of citations supported their sentence. CHALLENGES naive linking: a link is not proof. BORROW: a "from source" claim should carry the quoted passage or locator, not just a URL. This is the strongest argument for "true references."

**NN/g tooltips.** Brief, never essential, keyboard and touch accessible, consistent. CONFIRMS tap-to-explain. Rule: the claim must make sense without opening the term.

**Cognitive load / split attention.** Limited working memory; text placed apart from its picture costs effort; remove non-essential material. BORROW: labels go on the picture (direct labeling), not in a legend or a separate paragraph. Supports "less words."

**Overall on the three certainty levels.** Confirmed: separating source facts from our judgment (ICD 203, Wikipedia). Challenged: no strength axis (IPCC, GRADE) and links alone don't prove support (Liu et al.). Suggestion: keep three provenance levels, add (a) a quoted passage for "from source," (b) a stated assumption for "our reading," (c) an optional short "why weak" reason.

### 3. Candidate blocks for R4

1. **Sparkline / inline mini-chart** — word-sized trend in text or table cells. (Tufte sparklines)
2. **Small-multiples grid** — one mini-chart repeated per item, shared scale. (Tufte)
3. **Finding chart** — chart whose title is a linked claim card, one highlighted series, direct labels. (Kong et al.; Knaflic; split attention)
4. **Annotated picture** — callouts placed on the image, no separate legend. (Split attention; Knaflic)
5. **Overview → detail drill** — overview tile that opens filtered detail on tap. (Shneiderman)
6. **Guided steps then explore** — numbered claim sequence, then an open board. (Segel & Heer martini glass; Bostock)
7. **Assumption slider** — change one stated assumption, see the result update. Use rarely. (Victor reactive documents; ICD 203 assumptions)
8. **Source quote card** — the exact passage, its locator and link, under a "from source" claim. (Liu et al.; Wikipedia)
9. **Evidence strength strip** — count of sources and whether they agree, with a reason if weak. (IPCC evidence/agreement; GRADE downgrade reasons)
10. **Gap marker** — visible "no source yet" / open question in place of a claim. (Wikipedia "citation needed"; ICD 203 knowledge gaps)
