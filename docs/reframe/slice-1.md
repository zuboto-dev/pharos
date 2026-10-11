# Slice 1: the Generative UI map as one live page

2026-10-11 · written by Opus 5.5 · commit db3e32b

> **Build plan.** The first section is for the owner. The rest is for the agent that builds it.
> Nothing here is built yet.

## In short

**One page in the "Generative UI map" project that looks and works like the one-page map you
liked: a five-layer picture you tap open, a three-step spectrum, claim cards with "From source,
11 Oct" or "Our reading" marks and real links, a short takeaway, and a sources list.** The
difference: every sentence on it is a stored finding, so when a finding changes the page
changes, and Pharos refuses to show a finding as "From source" without a working link.

- **What gets built:** two kinds of stored records (findings and terms), two new building blocks
  (the layer picture and the claim card), tap-to-explain terms in any text, and warnings that
  tell agents when a finding has no source or the page's point comes too late.
- **Size:** about 1,000 lines of code and 500 of tests in 22 files, then the page's content
  (26 findings, 8 terms, 3 new links), loaded by an agent while you watch.
- **Needs you (three small things):** (1) keep the labels the page used, _From source_, _Our
  reading_ and _Confirmed by you_? (2) may an agent give 10 source records plain titles, such as
  "Tambo" in place of "3 Interaction runtime · Tambo"? Old titles stay in the history. (3) After the content is
  loaded, accept one decision in the app ("Keep Pharos's own recipe format and drawing code") so
  the takeaway card can say _Confirmed by you_.
- **One change from the page you liked:** its takeaway said "Adopt, don't rebuild" (swap
  Pharos's recipe format and drawing code for shared ones). You have since decided to keep
  Pharos's own, so that card becomes **Keep**, marked _Confirmed by you_.

---

## 1 The page, part by part

The page you liked is the target. Each part maps to a block and stored data. "Today" says whether
an existing building block already covers it (blocks listed in
`packages/schema/src/views/catalog.ts:296–320`).

| Part of the page                                                     | Block                                                                                                 | Data                                                                                            | Today                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Top label "Generative UI · checked 11 Oct 2026"                      | ClaimCard `size: "headline"`, `kicker: "Generative UI"`; date from its mark                           | The headline claim's `checkedOn`                                                                | New                                                       |
| Headline "Five layers. Pharos rebuilt two …"                         | Same ClaimCard: statement as the page heading                                                         | Claim `statement` (Our reading)                                                                 | New                                                       |
| Lede "The missing one decides …"                                     | Same ClaimCard: `detail` under the heading                                                            | Claim `detail`                                                                                  | New                                                       |
| "Tap a layer to see the tools in it."                                | Layers `prompt`                                                                                       | View wording (an instruction, not a claim)                                                      | New                                                       |
| Legend: Pharos has its own / Watch out / Nobody offers it            | Layers `legend`                                                                                       | View wording                                                                                    | New                                                       |
| Five layer buttons: number, title, one-line hint, pill               | Layers `orientation: "stack"`, one entry per layer                                                    | `key`, `title`, `hint`, `pill` are names in the view; nothing factual                           | New                                                       |
| Layer 5 note "None of the tools below decides …"                     | Layers: a claim without `aboutId` shows as a line at the top of its panel                             | Claim tagged `layer-5`                                                                          | New                                                       |
| Tool cards (heading, sentence, mark, Source ↗)                       | Layers: claims grouped by `aboutId`, one card per tool                                                | Claims tagged `layer-N`; heading = the `aboutId` artifact's title; link = source artifact `uri` | New                                                       |
| "Pharos" cards drawn in the accent colour                            | Layers `highlightAbout`                                                                               | The "Pharos" artifact's id                                                                      | New                                                       |
| Tambo warning "Tambo Cloud closes 31 Oct …"                          | Layers `warnTag: "watch"`: shown as a warning inside the Tambo card                                   | Claim about Tambo tagged `layer-4` and `watch`                                                  | New                                                       |
| Layer 4 opens first                                                  | Layers `open: "4"`                                                                                    | —                                                                                               | New                                                       |
| "How much of the screen the AI makes": three steps, axis             | Layers `orientation: "row"`, `axis`, widget `title`                                                   | Three claims tagged `spectrum-static/-declarative/-open`, from the OpenUI report                | New                                                       |
| "Declarative · Pharos is here"                                       | Step `highlight: true`, `pill: {label: "Pharos is here", claim}`                                      | A claim that Pharos's agents write a recipe from a fixed set of blocks (from Pharos's code)     | New                                                       |
| One "From source: OpenUI, … 10 Jun 2026" line under the spectrum     | Shared mark (rule in §4): all three step claims share certainty, date and source                      | The claims' `certainty`, `checkedOn`, `sourceIds`                                               | New                                                       |
| "What it means for Pharos": two cards                                | Grid (2 columns) of two ClaimCards: `kicker: "Keep"`, `tone: "own"`; `kicker: "Build"`, `tone: "gap"` | Keep: Confirmed by you, `confirmedById` → the decision you accept; Build: Our reading           | Grid exists; cards new                                    |
| "Skills to learn before building": three cards                       | Grid (3 columns) of three ClaimCards, kickers "Choose", "Explain", "Prove"                            | Three claims (Our reading), each with the sources it rests on                                   | Grid exists; cards new                                    |
| "All sources (11)"                                                   | DataList over `{type: "artifact", where: {id: [the 11 ids]}}`, `secondary: ["uri"]`                   | Source artifacts                                                                                | DataList exists; `uri` as a link is a 10-line change (§7) |
| Footer "Facts marked … This page doesn't change anything in Pharos." | Dropped                                                                                               | Every mark now carries its own word and date; the last sentence isn't true of a live view       | —                                                         |
| Ask about any part                                                   | Existing Ask button on every widget (`apps/web/src/catalog/board.tsx:257–271`)                        | `request`                                                                                       | Exists                                                    |
| Tap-to-explain terms (not on the target page; the goal requires it)  | Every statement, detail, Markdown and Text                                                            | `term` records                                                                                  | New                                                       |

Wording that changes on the way in, because a mark must match what the record holds:

| Target page                        | Live page                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| "From Pharos's code"               | "From source, 11 Oct", Source ↗ links to the file in the repository                           |
| "From the 6 Oct review"            | "From source, 6 Oct": checked on that date, not re-read since                                 |
| "Claim from OpenUI's own report"   | The statement itself says "OpenUI says its format uses about half the words of json-render"   |
| "Any agent" card heading (layer 1) | Shown as a line: the claim is about Pharos's agents in general, not about one tool record     |
| "All sources" folded away          | Shown open at the bottom: the catalog has no fold-away block, and adding one is left out (§8) |

The view is a Board (`packages/schema/src/views/board.ts:37–53`) of six full-width widgets in
this order: headline ClaimCard, Layers (stack), Layers (row), Grid of two ClaimCards, Grid of
three ClaimCards, DataList.

## 2 Stored data

Two new types. Sources stay `artifact` records (they already hold a title and a `uri`,
`packages/schema/src/entities.ts:112–121`), the author is an `assignee`, and the owner's answer is
a `decision` (`entities.ts:123–132`). Nothing else from the knowledge-model proposal is in this
slice (§8).

```ts
// packages/schema/src/options.ts — additions
export const Certainty = z.enum(['reading', 'verified', 'confirmed']); // weakest first
// in OPTION_FIELDS (options.ts:16–65)
'claim.certainty': { type: 'claim', field: 'certainty', meanings: Certainty.options, label: 'Certainty' },
// in MEANING_COLORS (options.ts:82–107)
reading: 'amber', verified: 'green', confirmed: 'violet',
// in DEFAULT_LABELS (options.ts:159–161)
'claim.certainty': { reading: 'Our reading', verified: 'From source', confirmed: 'Confirmed by you' },

/** Meanings with a fixed strength, weakest first. Ranges and sorting use this, never list order. */
export const RANKED_MEANINGS: Partial<Record<OptionKey, readonly string[]>> = {
  'claim.certainty': Certainty.options,
};
```

```ts
// packages/schema/src/entities.ts — additions
export const ClaimData = z.strictObject({
  projectId: Id,
  statement: Text.max(200).describe(
    'One plain sentence the reader sees; no task codes. When a source speaks about itself, write "X says …"',
  ),
  detail: z.string().max(400).optional().describe('One or two more plain sentences, shown under the statement'),
  certainty: optionField('claim.certainty'),
  checkedOn: IsoDate.describe('YYYY-MM-DD it was last checked against its sources'),
  sourceIds: z.array(Id).describe('Artifacts it comes from; a link needs an http(s) uri'),
  confirmedById: Id.optional().describe('For "Confirmed by you": the decision the owner accepted'),
  aboutId: Id.optional().describe('The artifact it is about (a tool, Pharos); its title heads the card'),
  authorId: Id.optional().describe('Assignee (agent or person) whose claim it is'),
  tags: z.array(z.string()).describe('Keys views pick claims by, e.g. "layer-4"; never shown'),
  order: Order,
});

export const TermData = z.strictObject({
  projectId: Id,
  word: Text.max(40).describe('As it appears in text, e.g. "recipe"'),
  explanation: Text.max(240).describe('One or two plain sentences'),
  alsoCalled: z.array(z.string().min(1).max(40)).describe('Other forms to match, e.g. ["recipes"]'),
  sourceId: Id.optional().describe('Artifact the explanation comes from; without one it says "Our wording"'),
});

// ENTITY_TYPES (entities.ts:170–183) gains 'claim' and 'term'. ENTITIES (entities.ts:206–296) gains:
claim: {
  prefix: 'clm',
  data: ClaimData,
  defaults: { certainty: 'reading', sourceIds: [], tags: [] }, // a meaning; the store picks the project's value
  refs: {
    projectId: projectRef,
    sourceIds: { type: 'artifact', many: true, onDelete: 'unset' },
    confirmedById: { type: 'decision', onDelete: 'unset' },
    aboutId: { type: 'artifact', onDelete: 'unset' },
    authorId: { type: 'assignee', onDelete: 'unset' },
  },
  label: 'statement',
},
term: {
  prefix: 'term',
  data: TermData,
  defaults: { alsoCalled: [] },
  refs: { projectId: projectRef, sourceId: { type: 'artifact', onDelete: 'unset' } },
  label: 'word',
},
```

**What happens on delete.** No new delete mode is needed. Clearing a reference updates the claim
(`apps/server/src/store/store.ts:726–745`), every update is re-checked at the end of the
transaction (`store.ts:699`, `:795–833`), and the certainty rule (§3) then refuses the change.

| Field                 | Points to | On delete | Effect                                                                                                                            |
| --------------------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `claim.projectId`     | project   | cascade   | As every project record (`entities.ts:204`)                                                                                       |
| `claim.sourceIds`     | artifact  | unset     | A From-source claim losing its last linked source makes the delete fail, naming the claim, unless the same call changes the claim |
| `claim.confirmedById` | decision  | unset     | The same for Confirmed by you                                                                                                     |
| `claim.aboutId`       | artifact  | unset     | The card loses its heading; the claim shows as a line                                                                             |
| `claim.authorId`      | assignee  | unset     | As `decision.decidedById` (`entities.ts:275`)                                                                                     |
| `term.projectId`      | project   | cascade   | —                                                                                                                                 |
| `term.sourceId`       | artifact  | unset     | The explanation shows "Our wording"                                                                                               |

**Other store changes** (`store.ts`): `dataset()` (`:331–347`) returns `claims` and `terms`;
`ProjectDataset` (`packages/schema/src/views/query.ts:71–83`), `QueryableType` (`query.ts:57–64`)
and `DATASET_KEYS` (`packages/schema/src/views/run-query.ts:5–12`) gain both. Two term records in
a project may not share a word or `alsoCalled` form, ignoring case (error).

## 3 Certainty rule

Checked in `Transaction.validate` (`store.ts:795–833`) for every claim written in the call, and
for every claim that points at an artifact or decision written in the call (found with
`referrers`, `store.ts:783–788`). A failure is an error: the whole call is refused. The rule looks
at the **meaning** of the stored value (`meaningOf`, `options.ts:190–196`), so a renamed label
changes nothing.

| Meaning (default label)          | Needs                                                                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reading` ("Our reading")        | `checkedOn` (required by the schema). No source needed, but views warn without one (§5).                                                                                                                              |
| `verified` ("From source")       | `checkedOn` no later than the revision's date, and at least one `sourceIds` artifact whose `uri` starts with `http://` or `https://` (only those open as links, `apps/web/src/catalog/components/outputs.tsx:23–38`). |
| `confirmed` ("Confirmed by you") | `confirmedById` → a decision whose status means `accepted`, **and** whose latest status change (or creation) was written by a person: the revision's `author_kind` is `human`. Query below.                           |

```sql
-- the author of the decision's latest status change; changes of the running call are already inserted
SELECT r.author_kind FROM changes c JOIN revisions r ON r.id = c.revision_id
WHERE c.entity_id = ? AND c.after IS NOT NULL
  AND (c.before IS NULL OR json_extract(c.before, '$.status') IS NOT json_extract(c.after, '$.status'))
ORDER BY c.revision_id DESC, c.seq DESC LIMIT 1
```

Error texts name the claim and the fix, e.g. `claim clm_… "Pharos keeps its own …": "Confirmed by
you" needs confirmedById → a decision the owner accepted in Pharos`.

Limit: the web app writes as `human:me` when no author header is sent (`apps/server/src/app.ts:28–33`),
so an agent posting to `/api/apply` without the header would pass as the owner. That is true of
every human-marked change today; this rule does not make it worse.

**Compared by meaning, never by list order.** Range filters and sorting use `optionPosition`
(`run-query.ts:110–117`, used at `:127` and `:224`), which follows the project's list order. For a
key in `RANKED_MEANINGS`, it returns the index of the value's meaning in that fixed list instead.
So `{certainty: {gte: "verified"}}` means From source or Confirmed even if the owner reorders
the list, and sorting by certainty sorts by strength.

## 4 Blocks

Added to `catalog.ts` in a new "explain" section, in the existing `component()` style
(`catalog.ts:20–26`), and to `LEAF_NODES` (`:296–320`).

```ts
const Tone = z
  .enum(['neutral', 'own', 'watch', 'gap'])
  .describe('own: Pharos has it · watch: take care · gap: missing');
const terms = z
  .boolean()
  .optional()
  .describe('Explain project terms where they first appear in this widget (default true)');

const Layer = z.strictObject({
  key: z.string().min(1).max(3).describe('Marker in the circle, e.g. "5"; `open` refers to it'),
  title: z.string().min(1).max(60).describe('A name, not a claim, e.g. "The recipe format"'),
  hint: z
    .string()
    .max(90)
    .optional()
    .describe('One line under the title, e.g. "How the AI writes down which blocks go where"'),
  pill: z
    .strictObject({
      label: z.string().min(1).max(30),
      tone: Tone,
      claim: z
        .string()
        .optional()
        .describe('Id of the claim behind the label; shown first in the layer with its mark'),
    })
    .optional(),
  highlight: z.boolean().optional().describe('Draw this one as the layer that matters most'),
  items: Filter.describe(
    'Which claims it holds, e.g. {"where": {"tags": "layer-4"}}; sorted by order unless sort is given',
  ),
});

export const LayersNode = component(
  'Layers',
  'Ordered layers or steps, each holding stored claims: a stack the reader taps open, or steps side by side.',
  {
    layers: z.array(Layer).min(2).max(7).describe('Top to bottom (stack) or left to right (row)'),
    orientation: z
      .enum(['stack', 'row'])
      .optional()
      .describe('stack (default): one layer open at a time; row: every step shown'),
    open: z.string().optional().describe('stack: key of the layer open at first (default none)'),
    prompt: z
      .string()
      .max(80)
      .optional()
      .describe('What to do, e.g. "Tap a layer to see the tools in it."'),
    legend: z
      .array(z.strictObject({ tone: Tone, label: z.string().min(1).max(30) }))
      .max(4)
      .optional(),
    axis: z
      .strictObject({ from: z.string().max(30), to: z.string().max(30) })
      .optional()
      .describe('row: labels at the two ends, e.g. "more control" and "more freedom"'),
    highlightAbout: z
      .string()
      .optional()
      .describe('Artifact id; the card about it is drawn in the accent colour'),
    warnTag: z
      .string()
      .optional()
      .describe('Claims with this tag show as a warning in their card (default "watch")'),
    terms,
  },
);

export const ClaimCardNode = component(
  'ClaimCard',
  'One stored claim: its statement, how sure it is (a mark with a word and the checked date) and its source link.',
  {
    claim: z.string().min(1).describe('Id of a claim in this project'),
    size: z
      .enum(['headline', 'card'])
      .optional()
      .describe("headline: the view's point, large, first on the page; card (default)"),
    kicker: z
      .string()
      .max(30)
      .optional()
      .describe('One to three words above the statement, e.g. "Build"'),
    tone: Tone.optional(),
    terms,
  },
);

// `terms` is also added to MarkdownNode, TextNode and CalloutNode (catalog.ts:98–109, :282–292).
```

**How each reads data.** Components never copy a claim's words into the view (`catalog.ts:4–7`);
the spec holds ids, tags and filters only.

| Block                 | Reads                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layers                | Per layer `runQuery(data, 'claim', {sort: [{field: 'order'}], ...layer.items})`; `pill.claim` by id; the `aboutId` and `sourceIds` artifacts from `entityById` (`apps/web/src/catalog/context.tsx:57–75`, which gains claims and terms) |
| ClaimCard             | `runQuery(data, 'claim', {where: {id: claim}})[0]`; its source artifacts, `confirmedById` decision and `authorId` assignee from `entityById`                                                                                            |
| Terms (in any text)   | `runQuery(data, 'term')` once per dataset version; matches `word` and `alsoCalled`                                                                                                                                                      |
| Certainty mark (both) | The claim's value, its label and colour from the project's options (`optionsFor`, `options.ts:175–179`), its meaning for the glyph                                                                                                      |

**Rendering rules** (new file `apps/web/src/catalog/components/knowledge.tsx`):

| Element           | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Certainty mark    | Glyph by meaning (◐ reading, ● verified, ◆ confirmed), then the option's label and date: "◐ Our reading, 11 Oct". Date: `checkedOn`; for confirmed, the decision's `decisionDate`, else `checkedOn`. Format with `formatDate` (`apps/web/src/lib/format.ts:26`). Colour never carries meaning alone: the word is always there.                                                                                                                                                                                                                                                |
| Source link       | After the mark: "Source ↗" opening the first source with an http(s) `uri` in a new tab; "Sources (n) ↗" opens the popover when there are several. Move `Uri` out of `outputs.tsx:23–38` into `ui.tsx` and reuse it.                                                                                                                                                                                                                                                                                                                                                           |
| Mark popover      | Tapping the mark opens: one fixed line for the meaning (reading: "An agent's analysis of the sources. Not checked as a fact, and not tested." · verified: "Read from the linked source on {date}." · confirmed: "You decided this: {decision title}, {date}."), "By {author}" when set, and every source as a link.                                                                                                                                                                                                                                                           |
| Popover behaviour | A `<button aria-expanded>`; opens on tap or Enter, closes on a second tap, Escape or a tap outside; portal-positioned like `useGlance` (`apps/web/src/catalog/interactive.tsx:145–182`) but clickable. Shared by marks and terms.                                                                                                                                                                                                                                                                                                                                             |
| Missing claim     | "This finding was deleted or isn't in this project", in the `Empty` style (`apps/web/src/catalog/ui.tsx:136–140`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ClaimCard sizes   | headline: kicker, statement as the page heading (`text-2xl`, bold), detail as a lede, mark below. card: kicker in small capitals, statement bold, detail, mark. `tone` colours the border and kicker.                                                                                                                                                                                                                                                                                                                                                                         |
| Layers, stack     | Each layer is a full-width `<button aria-expanded aria-controls>`: key in a circle, title, hint, pill (label + tone colour). One layer open at a time; tapping the open one closes it. `highlight` gives a stronger border. Below the open layer, its panel: claims without `aboutId` as lines (statement + mark), then one card per `aboutId` in first-seen order, heading = the artifact's title, body = its claims; `warnTag` claims show as a ⚠ warning box in that card; `highlightAbout` cards in the accent colour. `pill.claim`, when set, is the panel's first line. |
| Layers, row       | Steps side by side in equal columns from 640 px wide, stacked below that. Each step: `pill` label, title, hint, its claims as lines. `axis` shows "from ← → to" under the row (above and below when stacked). Nothing to tap.                                                                                                                                                                                                                                                                                                                                                 |
| Shared mark       | Within one Layers block: when every item claim has the same certainty value, the same `checkedOn` and the same single source, hide the per-claim marks and show one line under the block: "● From source, 11 Oct · {source title} ↗". Otherwise every claim keeps its own mark. `pill.claim` lines always keep their own.                                                                                                                                                                                                                                                     |
| Empty layer       | "Nothing here yet" in the panel or step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Phone and dark    | Full width at 360 px with no sideways scroll; tool cards in `grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]`; every colour has a `dark:` variant like the existing blocks.                                                                                                                                                                                                                                                                                                                                                                                                   |

**Terms** (new file `apps/web/src/catalog/terms.tsx`):

| Rule      | Detail                                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching  | Every `word` and `alsoCalled` form, ignoring case, whole words only (letters and digits on either side don't match), longest form first.                                                                                                                 |
| Where     | Claim statements and details in Layers and ClaimCard, layer titles and hints, Markdown, Text and Callout bodies. Never inside links or code. Off when the widget sets `terms: false`.                                                                    |
| How often | Only the first use in each widget, in reading order. Computed by a pure function over the widget's texts in order (`firstUses(texts, terms) → ranges per text`), not by shared state, so double rendering can't drop or repeat a mark.                   |
| Markdown  | The shared `Markdown` (`ui.tsx:142–148`) takes an optional set of words to mark and passes a small remark plugin that splits text nodes into a `term` element, rendered through react-markdown's `components`. No new dependency: walk the tree by hand. |
| Look      | Dotted underline, same text colour; a button. The popover shows the word, the explanation, and "Source ↗" (term's `sourceId` with an http(s) `uri`) or "Our wording".                                                                                    |

## 5 Warnings when saving

Warnings go back to the agent; they don't block the save. They are added to `previewBoard`
(`apps/server/src/views/preview.ts:389–441`), which every `view_create`/`view_update` result
already includes (`apps/server/src/views/service.ts:266–277`), and `view_preview`.

| Warning                  | When                                                                                                                                                                                                                         | Text                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Point too late**       | The view contains a Layers or ClaimCard, and before its first ClaimCard (in reading order) there is (a) any widget other than Markdown, Text or Callout, or (b) more than **30 words**; or the view has no ClaimCard at all. | `the point comes too late: {n} words (or a {Component}) before the first ClaimCard; put a ClaimCard with size "headline" first and keep what comes before it under 30 words` |
| **Claim without source** | A claim the view shows (a ClaimCard's claim, a layer's items, a `pill.claim`) has `sourceIds` empty and its certainty means `reading`. (From-source claims can't exist without one; Confirmed claims rest on a decision.)    | `claim clm_… "{first 60 characters, then … if longer}" has no source: add sourceIds so the reader can check it`                                                              |
| Missing claim            | A ClaimCard `claim` or `pill.claim` isn't a claim in this project.                                                                                                                                                           | `claim clm_… not found in this project`                                                                                                                                      |
| Empty layer              | A layer's `items` match nothing.                                                                                                                                                                                             | `layer "{key}" shows nothing`                                                                                                                                                |

**"Too late", exactly.** Reading order: `board.widgets` in array order (the order rows flow,
`packages/schema/src/views/board.ts:53`), depth-first through Grid and Section children; for Tabs,
only the first tab (the others start hidden). Words: split on whitespace after removing Markdown
symbols, counted from every `title` (including the first ClaimCard's own title, which is read before its statement), Markdown `content` (or the project description it shows),
Text content after filling its values, Callout `body`, and Section `description`. Why 30: about
two short sentences, under ten seconds of reading, which leaves most of the 30-second check for the
point and the picture. In the review's word counts, parts whose point came within 25 words read
well, and parts with 49 to 161 words before it did not ([review](review.md#reading-test)).

The MCP `apply` result (`apps/server/src/mcp.ts:144–154`) also gains `warnings` with the
"claim without source" text for every claim the call created or updated, since an agent may write
findings before any view shows them.

Agent guidance: the MCP instructions (`mcp.ts:35`) list `claim` and `term`, and the view
guidelines (`apps/server/src/guidance.ts:12`) gain five rules: one finding per claim, one plain
sentence; set `checkedOn`, `sourceIds` and `authorId`; "From source" only with a linked source you
read; "Confirmed by you" only through a decision the owner accepted in Pharos; start a knowledge
view with a headline ClaimCard. `project_snapshot` (`apps/server/src/store/snapshot.ts`, next to
artifacts at `:124`) lists claims (id, statement, certainty, checkedOn, source count, aboutId,
tags) and term words.

## 6 The page's content

Loaded through MCP `apply` and `view_create` into the "Generative UI map" project, after the code
is merged and the service reinstalled, by an agent with the owner watching. It is not committed to
the repository; tests use small made-up data. Every statement is re-read against its source on
the day it is loaded, and `checkedOn` is that day.

| Records               | Count | Detail                                                                                                                                                                                                                                    |
| --------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New artifacts (links) |     3 | The OpenUI "State of Generative UI in 2026" report (not in the project yet); "Pharos" (the repository's public page, used as `aboutId`); Pharos's block list (`catalog.ts` at a fixed commit, the source for "from Pharos's code" claims) |
| Retitled artifacts    |    10 | A2UI, json-render, OpenUI, Tambo, CopilotKit, Vercel AI SDK, assistant-ui, Model Context Protocol, AG-UI, MCP Apps: category prefixes leave the titles (needs the owner's yes)                                                            |
| Decision              |     1 | "Keep Pharos's own recipe format and drawing code; don't adopt A2UI or AG-UI for now", created as proposed; the owner accepts it in the app                                                                                               |
| Claims                |    26 | Headline 1 · layer 5: 2 · layer 4: 6 (with the Tambo warning) · layer 3: 4 · layer 2: 3 · layer 1: 1 · spectrum 3 + "Pharos is here" 1 · takeaway 2 · skills 3                                                                            |
| Terms                 |     8 | recipe, building block, MCP, JSON, React, open source, sealed box, licence                                                                                                                                                                |
| View                  |     1 | "Generative UI at a glance", pinned; the six widgets of §1. Existing views stay as they are                                                                                                                                               |

Order: (1) one `apply` with the artifacts, retitles, decision, terms and claims, the Keep claim
saved as _Our reading_; (2) `view_create`, fixing warnings until only accepted ones remain;
(3) the owner accepts the decision in the app; (4) one `apply` sets the Keep claim to confirmed
with `confirmedById`; (5) the owner's 30-second check: explain the page in their own words, say
what needs them, open one layer and one source, without being told the expected answer.

## 7 Files and size

| Area                                     | Files                                                                                                                                                                                                             |      Code |     Tests |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | --------: |
| Types, certainty option, ranking         | `packages/schema/src/entities.ts`, `options.ts`, `views/query.ts`, `views/run-query.ts`                                                                                                                           |       110 |        70 |
| Block props and guidance                 | `packages/schema/src/views/catalog.ts`, `views/catalog-info.ts` (new "explain" category; Layers min 6 / suggested 12 columns, ClaimCard 3 / 6)                                                                    |       120 |         — |
| Certainty rule, term uniqueness, dataset | `apps/server/src/store/store.ts`                                                                                                                                                                                  |        80 |       140 |
| Warnings                                 | `apps/server/src/views/preview.ts`, `apps/server/src/mcp.ts`                                                                                                                                                      |       100 |       100 |
| Agent-facing text and snapshot           | `apps/server/src/mcp.ts`, `guidance.ts`, `store/snapshot.ts`                                                                                                                                                      |        40 |        10 |
| Blocks, marks, popover, terms            | `apps/web/src/catalog/components/knowledge.tsx` and `terms.tsx` (new), `ui.tsx`, `components/index.ts`, `components/outputs.tsx`                                                                                  |       500 |       160 |
| Small web changes                        | `context.tsx` (claims, terms in `entityById`), `interactive.tsx` (`TYPE_LABELS`, `:27–40`), `options.tsx` (usage, `:97–104`), `components/generic.tsx` (`FieldValue` links an artifact's http(s) `uri`, `:48–95`) |        30 |        20 |
| Fixtures with the two new dataset keys   | `apps/web/src/catalog/__fixtures__/dataset.json`, `renderer.test.tsx` (two new samples, `:33`), `pages/onboarding.test.tsx`, schema query and options tests                                                       |        10 |        20 |
| **Total**                                | **about 22 files**                                                                                                                                                                                                | **≈ 990** | **≈ 520** |
| The page itself                          | Content of §6: about 600 lines of `apply` and view JSON in three calls, plus one click by the owner                                                                                                               |           |           |

No database migration: new types are rows in the existing `entities` table
(`apps/server/src/store/database.ts:41–52`), and no existing type gains a field.

Build in three commits, each with its tests passing: (1) data and the certainty rule; (2) the
blocks and terms; (3) warnings and agent guidance. Then the content (§6).

Tests that must exist:

| Where                      | Test                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.test.ts`            | From source without an http(s) source is refused; deleting its last source is refused and names the claim, and works when the same call makes it _Our reading_; Confirmed with an agent-accepted decision is refused, with an owner-accepted one saved; turning that decision to rejected is refused while the claim stays Confirmed; a duplicate term word is refused |
| `run-query` test           | With the certainty list reordered (confirmed first), `{certainty: {gte: "verified"}}` returns exactly the From source and Confirmed claims, and sorting puts them in strength order                                                                                                                                                                                    |
| `preview` test             | 30 words before the first ClaimCard: no warning; 31: warning; a DataTable first: warning; Layers with no ClaimCard: warning; a reading claim with no source in a layer: warning                                                                                                                                                                                        |
| `knowledge.test.tsx` (new) | Tapping a layer sets `aria-expanded` and closes the other; the shared mark appears once when items share source and date; the `watch` claim renders as a warning; the mark shows the project's renamed label; the popover closes on Escape; a term is marked only at its first use and never inside a link                                                             |

## 8 Left out

| Left out                                                      | Why, or when                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| Questions the page asks you, and your saved answers           | The next slice; this page asks nothing                          |
| Saved copies of work (excerpts), conditions, "applies to you" | Not on this page                                                |
| Summaries that inherit the weakest certainty (`restsOnIds`)   | Each claim here stands on its own sources                       |
| Sources that disagree; "out of date" dates                    | No disagreement on this page; re-checking is a content step     |
| New delete modes (`restrict`, cycle checks)                   | The certainty rule already refuses the deletes that matter (§2) |
| A `plainTitle` field                                          | Retitling ten records does the same here                        |
| A fold-away block, a reading path, jump links                 | The page is short enough to scroll                              |
| Remembering which layer you left open                         | The page opens on layer 4 each time                             |
| Decision buttons inside the page                              | The decision drawer already lets you accept                     |
| Applying this to other projects, other views or the Overview  | After the owner's check of this page                            |
| Shared formats for recipes and drawing (A2UI, AG-UI)          | Decided against by the owner                                    |

## 9 Open points for the owner

1. Labels: _From source_, _Our reading_, _Confirmed by you_ (the page you liked) as the defaults
   for every project? Each project can still rename them.
2. May an agent give the 10 source records plain titles?
3. Is "the point comes after more than 30 words" the right line, or should it be stricter?
