# How Pharos stores knowledge and asks you questions

2026-10-10 · written by Opus 5.5 · commit 458ad52

> **Proposal for the owner to approve.** Nothing here is built, and no product code was changed.
> The first section is for the owner. Everything after it is for whoever builds or reviews the
> change.

## In short

**Pharos would keep what is known, not only what is being done, and a view could ask you a
question and narrow itself to your answer.** Three choices need you (at the end of this section).

Four new kinds of records, next to today's goals, stages, tasks, documents and decisions:

| Record         | What it holds                                                                                    | Example                                                                |
| -------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Claim**      | One sentence a view shows as true, with how sure it is, where it comes from, when it was checked | "Pharos's own example counts cancelled work as late." Verified, 10 Oct |
| **Question**   | Something a view asks you (two to four answers plus "Not sure"), or something nobody knows yet   | "Is this the kind of question you'd really ask Pharos?"                |
| **Saved copy** | A piece of real work kept exactly as it was, with where and when it was taken                    | A sentence in the setup instructions, before and after it was fixed    |
| **Term**       | A word and its plain explanation                                                                 | "Practice project: a made-up project built for testing"                |

- **How sure.** Every claim carries one of three labels: _Confirmed by you_, _Verified_ (an
  official source, or someone ran it and saw the result) or _Agent's reading_. A question nobody
  has answered shows _Not known yet_. A summary always shows the weakest label of what it rests
  on. Each project can rename the labels or add its own.
- **Your answers.** When you pick an answer in a view, Pharos keeps it with the date, and every
  view that depends on it narrows at once, without waiting for an agent. You can change it at any
  time; the old answer stays in the history. Agents see your answers the next time they look.
- **Kept as it is.** Documents and links stay where claims come from; decisions stay decisions,
  and you can accept or reject one inside a view; asking an agent works as today. Tasks,
  documents and decisions get an optional plain title, so views never show codes.
- **Safety.** Pharos refuses to delete a claim or question that something else rests on, so a
  view can't quietly become surer, or apply to more situations, than the research behind it.
- **Size.** About two medium tasks and one small one, one per step, with no change to how your
  data is stored. The new building blocks that show these records are a separate proposal.

**Needs you:** (1) Are the three labels right? (2) Should only you be able to answer your
questions, so an agent can never record an answer for you? (3) Build it in the three steps of §15?

---

## Engineering detail

How to read it: §1 is what the code does today; §2–§11 are the proposal; §12 walks through the
two cases and the decision pattern of `docs/reframe/cases.md`; §13–§16 cover alternatives, what is
left out, size, and open points. Every statement about current behaviour cites the code at commit
458ad52 as `path:line`. "Cases" means `docs/reframe/cases.md`; "the goal" means
`docs/reframe/goal.md`.

### 1 Where Pharos stands today

- **One list of types, one table.** Entity types are a fixed list
  (`packages/schema/src/entities.ts:170–183`), each defined once in `ENTITIES` with its schema,
  defaults, references and label field (`entities.ts:194–202`, `:206–296`). All of them are JSON in
  one `entities` table (`apps/server/src/store/database.ts:41–52`), so a new type needs no SQL
  migration.
- **Every write is a revision.** `Store.apply` runs all operations in one transaction, records the
  author and message, and stores each change's full before and after
  (`apps/server/src/store/store.ts:399–410`, `:453–488`, `:675–701`).
- **References** name one target type and choose `unset` or `cascade` on delete
  (`entities.ts:187–192`). They are checked at the end of the transaction and must stay inside the
  same project (`store.ts:780–818`, especially `:796–800`). Only top-level fields holding an id or
  an array of ids are resolved, checked and searched (`store.ts:511–522`, `:790–791`, `:770–775`).
  There is no way to refuse a delete.
- **Defaults apply only on create.** `withDefaults` runs on create (`store.ts:528–531`,
  `:625–655`); an update re-validates the whole stored record (`store.ts:535–545`, `:715–716`). So
  a new _required_ field on an existing type would make every older record fail its next update.
  That is why migration v2 back-filled `order` (`database.ts:68–79`).
- **Options.** Per-project option lists map to built-in meanings (`packages/schema/src/options.ts:16–65`,
  `:114–139`). Every option field must hold one of the project's values (`store.ts:826–835`);
  create fills the default by meaning (`store.ts:625–634`); filters match a value or its meaning
  (`packages/schema/src/views/run-query.ts:93–108`); ranges use the list order (`run-query.ts:110–117`).
- **What views can query.** Six types (`packages/schema/src/views/query.ts:57–64`,
  `run-query.ts:5–12`), from one project's dataset (`query.ts:71–83`, `store.ts:331–347`, served by
  `apps/server/src/app.ts:180`). A path may follow one reference through `stage`, `assignee`,
  `task`, `parent` or `project` (`run-query.ts:15–21`; lookups cover only the project, assignees,
  goals, stages and tasks, `run-query.ts:192–201`). Besides stored fields, a path may read `id`,
  `createdAt`, `updatedAt` (`run-query.ts:78–85`). Special values are `$currentStage`, `$project`
  and `$today±n` (`run-query.ts:46–58`). Array fields match when they contain the value
  (`query.ts:36`, `run-query.ts:107`).
- **Generic building blocks** (DataTable, DataList, Stat, CountChart, Text counts) work for any
  queryable type (`packages/schema/src/views/catalog.ts:226–292`). An option field renders as a
  badge and a reference as a link chip without extra code
  (`apps/web/src/catalog/components/generic.tsx:65–79`). The detail drawer shows and edits any
  type's fields from its schema (`apps/web/src/catalog/drawer.tsx:123–157`).
- **Knowledge today is prose.** It sits in descriptions, or, in the Generative UI map, as 32
  artifact records, 20 of them with a category typed into the title (for example "2 Format · A2UI
  (Google)"). An artifact holds a title, description, kind, status and a link, not content
  (`entities.ts:112–121`), and its status means expected, in progress or delivered (`options.ts:13`).
- **Questions go one way.** Ask creates a `request` (`apps/web/src/pages/requests.tsx:46–63`;
  `entities.ts:159–168`). When automatic answering is on, creating a request starts the answering
  agent (`apps/server/src/agent-runner.ts:208–216`). Open requests are listed to agents as questions to
  answer (`apps/server/src/store/snapshot.ts:159–169`, `apps/server/src/guidance.ts:262–271`), and
  an answer view marks one answered (`apps/server/src/views/service.ts:171–180`).
- **Agents and the web app write the same way.** MCP `apply` takes every type except views
  (`apps/server/src/mcp.ts:33`, `:145–155`); `list` and `get` take any type (`mcp.ts:108–143`); an
  agent's revisions carry its client name (`mcp.ts:86–89`). The web app posts to `/api/apply`
  without an author header (`apps/web/src/lib/api.ts:35`), so it writes as `human:me`
  (`app.ts:28–33`).
- **Live updates.** Each new revision is announced over SSE (`apps/server/src/feed.ts:43–61`), and
  the project page reloads its dataset (`apps/web/src/pages/ProjectPage.tsx:183–185`, and after its
  own writes `:211`).

### 2 The proposal at a glance

Each need from cases §5 and §4.6, and where it would live:

| Need                                                     | Stored as                                                                       | New or reused                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Claim: statement, certainty, source, date, author        | `claim`                                                                         | new type                             |
| Certainty                                                | `claim.certainty`, a project option field                                       | new option field                     |
| Conditions ("applies when you answered …")               | `conditions` on `claim` and `question`                                          | fields on the new types              |
| Reader question, the reader's answer, a preference       | `question` with `askedOf: "reader"`; the answer is stored on the question       | new type                             |
| Open question (who can answer, what each answer changes) | `question` with `askedOf: "others"`; answered later by claims                   | same new type                        |
| Captured excerpt with source and date                    | `excerpt`                                                                       | new type                             |
| Term                                                     | `term`                                                                          | new type                             |
| Source of a claim                                        | `artifact` (documents, files, links), as the map project already does           | reused, unchanged                    |
| Approach with positions (case B's map)                   | the approach as an `artifact` (its link) plus claims answering an axis question | reused plus new                      |
| Deciding a proposal in place                             | `decision` status, `decidedById`, `decisionDate` (`entities.ts:123–132`)        | reused, unchanged                    |
| "Ask about this" on a claim or question                  | `request` with `aboutId` (`entities.ts:165`)                                    | reused, unchanged                    |
| Action or decision resting on findings                   | `restsOnIds` on `task` and `decision`                                           | new optional field                   |
| Plain labels instead of codes                            | `plainTitle` on `task`, `artifact`, `decision`                                  | new optional field                   |
| Sources that disagree                                    | `contradictsIds` and `preferred` on `claim`                                     | fields on the new type (built later) |

Two computed fields make it work in views without new query syntax: **`applies`** (does this
apply to the reader, given their answers?) and **`shownCertainty`** (the weakest certainty of
everything a record rests on). Both are described in §7.

### 3 Definitions, in the form of `ENTITIES`

```ts
// packages/schema/src/entities.ts — proposed additions (OptionValue comes from options.ts:109–112)

/** "Applies only when the reader answered …": one question and the answers that count. */
export const Condition = z.strictObject({
  questionId: Id.describe('A question asked of the reader'),
  values: z.array(OptionValue).min(1).describe("Matches when the reader's answer is one of these"),
});

export const ClaimData = z.strictObject({
  projectId: Id,
  statement: Text.describe('One plain sentence the reader sees; no task codes'),
  detail: Markdown.optional().describe('More for whoever opens it: why it matters, an example'),
  certainty: optionField('claim.certainty'),
  howWeKnow: z.string().optional().describe('One plain line, e.g. "Ran it on both practice projects on 10 Oct"'),
  checkedOn: IsoDate.describe('YYYY-MM-DD it was last checked'),
  recheckBy: IsoDate.optional().describe('After this date views show "May be out of date"'),
  authorId: Id.optional().describe('Assignee (person, agent or model) whose claim it is'),
  sourceIds: z.array(Id).describe('Artifacts (documents, files, links) it comes from'),
  evidenceIds: z.array(Id).describe('Excerpts that show it: the captured work itself'),
  restsOnIds: z.array(Id).describe('Claims it summarizes or follows from; its label is never stronger'),
  aboutIds: z.array(Id).describe('Artifacts it is about, e.g. an outside tool through its link'),
  questionId: Id.optional().describe('The question it answers: an open question, or an axis'),
  value: OptionValue.optional().describe('With questionId: the choice it answers with'),
  conditions: z.array(Condition).describe('Applies to the reader only when all of these match'),
  contradictsIds: z.array(Id).optional().describe('Claims that say otherwise; shown side by side'),
  preferred: z.boolean().optional().describe('Among contradicting claims, the better-argued one'),
  tags: z.array(z.string()).describe('Keys agents use to pick sets, e.g. "problem"; never shown'),
  order: Order,
});

export const Choice = z.strictObject({
  value: OptionValue.describe('Stored when chosen; keep it stable. "not_sure" is reserved'),
  label: Text.describe('What the reader sees'),
  whatChanges: z.string().optional().describe('What this answer changes, one line'),
});

export const QuestionData = z.strictObject({
  projectId: Id,
  text: Text.describe('The question in plain words'),
  askedOf: z
    .enum(['reader', 'others'])
    .describe('reader: a view asks it and the reader answers there; others: an open question'),
  choices: z.array(Choice).describe('Possible answers; "Not sure" is always added for the reader'),
  multiple: z.boolean().optional().describe('The reader may pick several'),
  allowText: z.boolean().optional().describe('Also offer a text box, e.g. "Something else"'),
  whyWeAsk: z.string().optional(),
  whatHappens: z.string().optional().describe('What the answer changes in views'),
  ifNotSure: z.string().optional().describe('How the reader can find out'),
  whoCanAnswer: z.string().optional().describe('For open questions, e.g. "the shop", "a test nobody ran"'),
  conditions: z.array(Condition).describe('Ask only when earlier answers match (a fork in a branch)'),
  status: z.enum(['open', 'answered', 'dropped']),
  answer: z.array(OptionValue).optional().describe('Chosen values; ["not_sure"] for Not sure'),
  answerText: z.string().optional().describe('What the reader wrote in the text box'),
  answeredAt: z.iso.datetime().optional().describe('Set by the store when the answer changes'),
  tags: z.array(z.string()),
  order: Order,
});

const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ExcerptContent = z.discriminatedUnion('format', [
  z.strictObject({
    format: z.literal('text'), // command output, a quote from a file or a page
    text: z.string(),
    language: z.enum(['plain', 'markdown', 'json', 'shell']).optional(),
  }),
  z.strictObject({
    format: z.literal('table'), // records from another project, a check log, a sequence of steps
    columns: z.array(z.strictObject({ key: z.string(), label: Text })).min(1),
    rows: z.array(z.record(z.string(), Cell)),
  }),
  z.strictObject({
    format: z.literal('compare'), // before and after
    before: z.strictObject({ label: Text, text: z.string() }),
    after: z.strictObject({ label: Text, text: z.string() }),
  }),
  z.strictObject({
    format: z.literal('view'), // a recipe and the data it was drawn from
    spec: ViewSpec,
    data: z.record(z.string(), z.unknown()).describe('In the shape GET /api/projects/:id/data returns'),
    today: IsoDate.optional().describe('The date the captured data is read against'),
  }),
]);

export const ExcerptData = z.strictObject({
  projectId: Id,
  title: Text.describe('Plain name, e.g. "The workshop practice project: its seven jobs"'),
  caption: z.string().optional(),
  content: ExcerptContent,
  capturedAt: IsoDate.describe('YYYY-MM-DD it was taken'),
  source: Text.describe('Exactly where it came from: a file and commit, a command, another project'),
  sourceId: Id.optional().describe('The artifact it was taken from, if there is one'),
  illustration: z.boolean().optional().describe('Written to re-enact something, not copied'),
  tags: z.array(z.string()),
  order: Order,
});

export const TermData = z.strictObject({
  projectId: Id,
  word: Text.describe('As it appears in views, e.g. "practice project"'),
  explanation: Text.describe('One or two plain sentences'),
  alsoCalled: z.array(z.string()).describe('Words the files use for it, shown as "In the files: …"'),
});

// Existing types gain optional fields only (a required one would break older records, §1).
// TaskData:     plainTitle: z.string().optional(), restsOnIds: z.array(Id).optional()
// ArtifactData: plainTitle: z.string().optional()
// DecisionData: plainTitle: z.string().optional(), restsOnIds: z.array(Id).optional()

export const ENTITY_TYPES = [/* … today's twelve …, */ 'claim', 'question', 'excerpt', 'term'] as const;

export type RefSpec = {
  type: EntityType;
  many?: boolean;
  /** New: for an array of objects, the key in each object that holds the id. */
  key?: string;
  /** New: 'restrict' refuses the delete while this entity still points at the target. */
  onDelete: 'unset' | 'cascade' | 'restrict';
  /** New: following this reference may never lead back to where it started. */
  acyclic?: boolean;
};

// Added to ENTITIES:
claim: {
  prefix: 'clm',
  data: ClaimData,
  defaults: {
    certainty: 'reading', // a meaning; the store turns it into the project's value (store.ts:625–634)
    sourceIds: [], evidenceIds: [], restsOnIds: [], aboutIds: [], conditions: [], tags: [],
  },
  refs: {
    projectId: projectRef,
    authorId: { type: 'assignee', onDelete: 'unset' },
    sourceIds: { type: 'artifact', many: true, onDelete: 'restrict' },
    evidenceIds: { type: 'excerpt', many: true, onDelete: 'restrict' },
    restsOnIds: { type: 'claim', many: true, onDelete: 'restrict', acyclic: true },
    aboutIds: { type: 'artifact', many: true, onDelete: 'unset' },
    questionId: { type: 'question', onDelete: 'restrict' },
    conditions: { type: 'question', many: true, key: 'questionId', onDelete: 'restrict' },
    contradictsIds: { type: 'claim', many: true, onDelete: 'unset' },
  },
  label: 'statement',
},
question: {
  prefix: 'qst',
  data: QuestionData,
  defaults: { status: 'open', choices: [], conditions: [], tags: [] },
  refs: {
    projectId: projectRef,
    conditions: { type: 'question', many: true, key: 'questionId', onDelete: 'restrict', acyclic: true },
  },
  label: 'text',
},
excerpt: {
  prefix: 'exc',
  data: ExcerptData,
  defaults: { tags: [] },
  refs: { projectId: projectRef, sourceId: { type: 'artifact', onDelete: 'unset' } },
  label: 'title',
},
term: {
  prefix: 'term',
  data: TermData,
  defaults: { alsoCalled: [] },
  refs: { projectId: projectRef },
  label: 'word',
},
// Changed entries: task.refs and decision.refs gain
//   restsOnIds: { type: 'claim', many: true, onDelete: 'restrict' }
```

Notes on the fields:

- **`statement` is the reader's text; `tags` are the agents'.** Views pick sets of claims by tag
  (`{tags: "problem"}` matches because array fields match when they contain the value,
  `query.ts:36`). Tags are never shown, so codes and working names can live there.
- **`howWeKnow`** is the badge popover's "How we know" line (cases §1.3). It is required whenever
  the certainty means _verified_ or _confirmed_ (§6).
- **`questionId` + `value`** let a claim answer a question. That covers three things with one
  field pair: research answering an open question; a claim placing something on an axis ("How
  much of the view does the AI make?" → `arranges`, case B's map); and an agent's suggested answer
  to a reader question (a claim with the agent's reading, shown as "Suggested").
- **`aboutIds` points only at artifacts.** References name one target type (`entities.ts:187–192`);
  the cases only need "about an outside tool or a document". Links the other way go on the task or
  decision (`restsOnIds`), so no reference has to accept several types.
- **`question.status`** is a plain enum, like `request.status` (`entities.ts:166`), because it
  drives behaviour; it is not something a project renames.
- **Answers live on the question.** One reader, one answer per question (several readers are out
  of scope, `docs/SCOPE.md:113`). Who answered is the revision's author (`store.ts:462–466`); when
  is `answeredAt`, stamped by the store from the revision time (`store.ts:459`) whenever `answer`
  or `answerText` changes, so it can't come from a wrong clock. Earlier answers stay in the
  history.
- **No `order` on terms**: a glossary sorts by word.

### 4 Certainty as a project option

```ts
// packages/schema/src/options.ts — proposed additions
export const Certainty = z.enum(['reading', 'verified', 'confirmed']); // weakest first, like priority
// OPTION_FIELDS
'claim.certainty': { type: 'claim', field: 'certainty', meanings: Certainty.options, label: 'Certainty' },
// DEFAULT_LABELS (options.ts:159–161)
'claim.certainty': { reading: "Agent's reading", verified: 'Verified', confirmed: 'Confirmed by you' },
// MEANING_COLORS (options.ts:82–107; the names are new, so nothing clashes)
reading: 'amber', verified: 'green', confirmed: 'violet',
```

| Meaning     | Default label      | Means                                                                                    | Badge (cases §1.3) |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------- | ------------------ |
| `confirmed` | "Confirmed by you" | The reader said so: an answer they gave or a decision they made; `howWeKnow` says when   | ◆                  |
| `verified`  | "Verified"         | Matches an official source, or someone ran it and saw the result; `howWeKnow` says which | ●                  |
| `reading`   | "Agent's reading"  | An agent's analysis, for example from reading code or documents; not tried or confirmed  | ◐                  |
| (none)      | "Not known yet"    | Not a claim level: shown for open questions and for anything still waiting on one        | ○                  |

Why these three, against the alternatives the goal left open:

- **"Official source" and "ran it and saw the result" share one level.** Both are checks outside
  the agent's own reasoning, and the reader can't weigh one against the other at a glance. The
  source link and `howWeKnow` say which it was.
- **"Not known yet" is a question, not a level.** A claim says something; if nobody knows, the
  honest record is an open question with who could answer it.
- **"Disputed" is a link, not a level.** Each side keeps its own label and source; the
  better-argued one is marked `preferred`, with the reason in `detail`, and both are shown (cases
  §4.4, C6). A summary resting on a disputed claim shows at most _Agent's reading_ (§7), because
  picking a side is itself a judgment, unless the reader confirmed it.
- **"Out of date" is time, not a level.** `recheckBy` turns it on.
- **The options mechanism already allows more.** A project can rename a label or add its own
  options, each counted as one of the three meanings (`options.ts:114–139`). A high-stakes project
  might add "Advised by a professional", and the owner decides whether that counts as verified or
  as a reading.

Ranking for "weakest" is fixed by meaning, `reading` < `verified` < `confirmed`, not by the
project's list order, so a reordered list can't make anything look surer. Because the default list
is weakest first, `{certainty: {gte: "verified"}}` reads "verified or better", as `{priority:
{gte: "high"}}` does today (`guidance.ts:45`). A new claim defaults to the project's value for
`reading` (`store.ts:625–634`): nothing is ever verified by default.

### 5 References and what happens on delete

Rule: **a link that holds up how sure a claim looks, or whom it applies to, refuses deletion
(`restrict`); a link that only adds context is cleared (`unset`).**

| Field                                    | Points to | On delete           | Why                                                                                             |
| ---------------------------------------- | --------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `claim.sourceIds`                        | artifact  | restrict            | A verified claim must not lose its source without anyone noticing                               |
| `claim.evidenceIds`                      | excerpt   | restrict            | The same, for the captured work                                                                 |
| `claim.restsOnIds`                       | claim     | restrict, no cycles | Removing a weak support would make a summary look surer                                         |
| `claim.questionId`                       | question  | restrict            | A `value` means nothing without its question                                                    |
| `claim.conditions[].questionId`          | question  | restrict            | Clearing it would make a conditional finding apply to everyone; cascading would delete research |
| `question.conditions[].questionId`       | question  | restrict, no cycles | A follow-up must not lose its fork                                                              |
| `task.restsOnIds`, `decision.restsOnIds` | claim     | restrict            | An action or decision must not look firmer once its basis is gone                               |
| `claim.aboutIds`                         | artifact  | unset               | Context only                                                                                    |
| `claim.authorId`                         | assignee  | unset               | As `decision.decidedById` today (`entities.ts:275`)                                             |
| `claim.contradictsIds`                   | claim     | unset               | If one side is deliberately removed, there is no dispute left                                   |
| `excerpt.sourceId`                       | artifact  | unset               | The required `source` text still says where it came from                                        |
| `projectId` on all four new types        | project   | cascade             | As every project record (`entities.ts:204`)                                                     |

`restrict` blocks only while the referring record survives: deleting both in one `apply`, or
deleting the whole project, works, the same way `unset` skips records that are being deleted
anyway (`store.ts:733`). The error names what still rests on the target, so an agent can fix it in
the same call, as it already must for option values still in use (`store.ts:836–851`).

Store changes this needs (all in `apps/server/src/store/store.ts`):

1. **`key`** (ids inside an array of objects): resolve `$ref` names there (`:511–522`), collect ids
   for validation (`:790–791`), and find referrers with `json_each(data, '$.conditions')` plus
   `json_extract(value, '$.questionId')` (`:770–775`).
2. **`restrict`**: after `deletionClosure` (`:753–768`), refuse if a surviving record points at a
   doomed one through a `restrict` reference (next to the `unset` loop, `:726–744`). Reverting a
   create deletes through the same code (`:612`), so such a revert fails with a conflict, as it
   already does for later records that would cascade (`:594–599`).
3. **`acyclic`**: one generic cycle check per flagged reference. The two existing special cases
   (goal parents and task dependencies, `:806–814`) could move onto it.

### 6 Checks on save

Added to `Transaction.validate` (`store.ts:780–818`), which already sees the revision and its
author (`store.ts:467–474`):

1. A condition's `values`, a claim's `value`, and a reader's `answer` must be among the referenced
   question's choice values (`not_sure` is allowed for answers and reserved in choices). If a
   question's choices change, records still using a removed value must be updated in the same
   call, mirroring option values (`store.ts:836–851`). A typo would otherwise make a finding
   silently never apply.
2. A reader question needs two to four choices, or `allowText`; without `multiple`, at most one
   answer.
3. **Only people answer reader questions.** A revision whose author is not `human` may not set
   `answer`, `answerText` or `answeredAt` on a question with `askedOf: "reader"`. Agents may set
   its status to `dropped` or rewrite its wording. (Open point 2.)
4. A claim whose certainty means `verified` or `confirmed` needs `howWeKnow`.
5. `restsOnIds` and question `conditions` may not form cycles.
6. An excerpt's `content` stays under a size cap (64 KB serialized is a starting point), because
   the whole dataset reloads after every change (`ProjectPage.tsx:183–185`, `:211`).

### 7 How views read it

**Dataset and types.** `ProjectDataset` gains `claims`, `questions`, `excerpts` and `terms`
(`query.ts:71–83`, filled in `store.ts:331–347`); `QueryableType` and `DATASET_KEYS` gain the four
types (`query.ts:57–64`, `run-query.ts:5–12`); the lookup index gains claims and questions
(`run-query.ts:192–201`); a `question.` hop follows `questionId` (`run-query.ts:15–21`, and the
copy in `apps/server/src/views/preview.ts:36–42`). In the web app, the context adds them to
`entityById` (`apps/web/src/catalog/context.tsx:57–69`), and the type names
(`apps/web/src/catalog/interactive.tsx:27–40`) and the options editor's usage count
(`apps/web/src/catalog/options.tsx:97–104`) gain entries. The generic building blocks then show the new types with no further change: certainty renders as a
badge, sources as link chips (`generic.tsx:65–79`).

**Two computed fields**, read like `id` and `createdAt` are today (`run-query.ts:78–85`; preview
learns the names next to `preview.ts:43`):

- **`applies`** — `"yes"`, `"open"` or `"no"`.
  - Claim or question: with no conditions, `"yes"`. For each condition, look at its question: if
    the question's own `applies` is `"no"`, the condition fails; if that is `"open"`, or the
    question is unanswered or answered "Not sure", the condition is open; otherwise it holds when
    the answer contains one of the values. Any failed condition gives `"no"`, else any open one gives `"open"`, else `"yes"`.
    Because a question's own `applies` counts, changing an early answer hides everything further
    down that branch, even answers given before.
  - Task or decision: combined the same way from the claims in `restsOnIds`.
- **`shownCertainty`** — the weakest certainty among the record and everything it rests on.
  - Claim: the weakest of its own certainty and the `shownCertainty` of each claim in `restsOnIds`;
    at most `reading` while another claim contradicts it (either direction), unless its own
    certainty is `confirmed`.
  - Task or decision: the weakest over `restsOnIds`; empty when there are none.
  - It returns the project's option value and reports itself as the `certainty` field of a claim,
    so badges, labels and matching by meaning work as for any option field (`run-query.ts:60–65`,
    `:93–108`; `generic.tsx:65–67`).

Conditions feed `applies`, never certainty: the reader's answers are certain, but they "don't lend
certainty" to a finding derived from them (cases §4.5, rule 6).

**Hypothetical answers.** `QueryContext` (`run-query.ts:23–26`) gains `answers?: Record<string,
string[]>`, used in place of stored answers. "What if I answered differently?" (cases §4.5, rule 7)
is evaluated in the browser and saves nothing.

**Example queries**, all in today's filter syntax:

| Purpose                                                     | Query                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| One claim, for a headline                                   | `{type: "claim", where: {id: "clm_…"}}`, its badge from `shownCertainty`                                 |
| A set of claims                                             | `{type: "claim", where: {tags: "problem"}, sort: [{field: "order"}]}`                                    |
| What applies to you                                         | `{type: "claim", where: {tags: "finding", applies: "yes"}}`                                              |
| "{m} apply to other situations"                             | Stat over `{type: "claim", where: {tags: "finding", applies: "no"}}`                                     |
| Questions waiting for you                                   | `{type: "question", where: {askedOf: "reader", status: "open", applies: "yes"}}`                         |
| Still open, counting "Not sure"                             | `anyOf: [{status: "open"}, {answer: "not_sure"}]`                                                        |
| Open questions nobody can answer yet                        | `{type: "question", where: {askedOf: "others", status: "open"}}`                                         |
| Weak claims, or out of date                                 | `{shownCertainty: "reading"}`; `{recheckBy: {lt: "$today"}}`                                             |
| The one you said matters most                               | `{conditions: {exists: true}, applies: "yes"}` (an empty array counts as absent, `run-query.ts:144–148`) |
| Your pick first, in a list that all depends on one question | `sort: [{field: "applies", dir: "desc"}]` (`yes` sorts before `open` and `no`)                           |
| A saved copy for an Exhibit                                 | `{type: "excerpt", where: {id: "exc_…"}}`                                                                |
| Tasks that act on a finding                                 | `{type: "task", where: {restsOnIds: "clm_…"}}`                                                           |
| Glossary                                                    | `{type: "term", sort: [{field: "word"}]}`                                                                |

Views still never copy data (`catalog.ts:4–7`): a spec holds ids, tags and filters, never a
claim's sentence. How a building block shows a statement with its badge, or a term's popover, is
for the component proposal; the data side only promises `statement`, `shownCertainty`,
`howWeKnow`, `checkedOn`, the source links, and term lookup by `word` or `alsoCalled`.

### 8 How agents write it

**Through `apply`, unchanged.** MCP `apply` accepts every type except views (`mcp.ts:33`), and
`list` and `get` accept any type (`mcp.ts:108–143`), so the four new types are available to agents
as soon as they are in `ENTITY_TYPES`. No new tool is needed. One call records a finding together
with its source, the captured work and the task that would fix it:

```json
{
  "message": "Record the cancelled-work problem found while writing the tests, with its captured output",
  "operations": [
    {
      "op": "create",
      "type": "artifact",
      "ref": "note",
      "data": {
        "projectId": "prj_…",
        "title": "(working title of the evidence note)",
        "plainTitle": "Test situation: ask what's at risk",
        "kind": "doc",
        "status": "delivered",
        "uri": "docs/evidence/…"
      }
    },
    {
      "op": "create",
      "type": "excerpt",
      "ref": "run",
      "data": {
        "projectId": "prj_…",
        "title": "Pharos's 'Blocked or overdue' example on the workshop project",
        "content": {
          "format": "table",
          "columns": [
            { "key": "job", "label": "Job" },
            { "key": "status", "label": "Status" },
            { "key": "due", "label": "Due" }
          ],
          "rows": [
            { "job": "Cancel exterior extension option", "status": "Cancelled", "due": "4 Oct" }
          ]
        },
        "capturedAt": "2026-10-10",
        "sourceId": "$note",
        "source": "The example filter run on the workshop practice project, today set to 7 Oct, at commit 6efa535"
      }
    },
    {
      "op": "create",
      "type": "claim",
      "ref": "p1",
      "data": {
        "projectId": "prj_…",
        "statement": "Pharos's own example counts cancelled work as late",
        "detail": "Why it matters: agents copy this example, so their views can warn you about cancelled work.",
        "certainty": "verified",
        "howWeKnow": "Ran the example on both practice projects (7 Oct, and again on 10 Oct).",
        "checkedOn": "2026-10-10",
        "sourceIds": ["$note"],
        "evidenceIds": ["$run"],
        "tags": ["problem"]
      }
    },
    { "op": "update", "type": "task", "id": "task_…", "data": { "restsOnIds": ["$p1"] } }
  ]
}
```

**What agents see.** `project_snapshot` (`snapshot.ts:27–178`) gains compact lists: claims (id,
statement, certainty, tags, `questionId`/`value`, number of conditions, `checkedOn`), questions
(id, text, `askedOf`, status, answer, `answeredAt`), excerpts (id, title, format, `capturedAt`; no
content) and term words. `get` returns the full record. A reader's answer reaches agents through
`changes_since`, which lists people's changes since the agent last looked
(`apps/server/src/views/changes.ts:9–46`).

**What agents are told.** The MCP instructions list the data types (`mcp.ts:35`) and gain a short
"Knowledge" section; the view guide (`guidance.ts:12–23` onward) gains the same rules:

- Write findings as claims, one plain sentence each, not as prose in a description. Fill
  `howWeKnow` and `checkedOn`. Leave certainty at the default unless you have a source or ran it
  (_verified_) or the reader said so (_confirmed_, with when and how).
- A summary lists what it rests on in `restsOnIds`; Pharos computes its badge.
- When a view shows work from elsewhere (another project, a file, a command), save an excerpt with
  its source and date, and show that; never paste it into a Text widget.
- Ask the reader with a reader question: two to four choices, why you ask, what happens. Never
  answer it yourself (the store refuses, §6); you may add a claim with your suggested answer.
- Give tasks, documents and decisions a `plainTitle` before a reader-facing view shows them; keep
  codes in titles and tags.

**What `view_preview` warns about** (the preview is already returned after every view save,
`service.ts:266–277`): a verified claim with no source and no evidence; a claim whose own
certainty is stronger than its `shownCertainty`; and reader-facing text (statements, question
texts, plain titles, Text and Callout content) that looks like a task code, for example a capital
letter followed by numbers with a dot. These are warnings, not errors: "G1" is a stage's name the
owner uses (cases §1.6).

### 9 How your answer flows back and narrows the view

1. **An agent sets up** a reader question and a view: a question card reads the question (by id or
   tag), and the rest of the view filters or sorts by `applies`.
2. **You pick "Partly".** The card calls the view's `apply` action (`context.tsx:16–21`), which
   posts one update to `/api/apply` (`ProjectPage.tsx:187–215`, `app.ts:175–178`):
   `{op: "update", type: "question", id, data: {answer: ["partly"], status: "answered"}}`, with a
   message such as "Answer: Is this the kind of question you'd really ask Pharos? Partly". The
   author is `human:me` (`app.ts:28–33`).
3. **The store checks** the value is one of the choices and that a person wrote it (§6), stamps
   `answeredAt`, and records the revision with before and after (`store.ts:675–701`).
4. **The view narrows.** The feed announces the revision (`feed.ts:43–61`), the project page
   reloads its data (`ProjectPage.tsx:183–185`), and `runQuery` recomputes `applies`: findings for
   other situations drop out of "What applies to you", follow-up questions appear, a branch picture
   folds to your path, and a list sorted by `applies` moves your choice to the top. No agent runs,
   so this takes about as long as ticking off a task.
5. **Change or undo.** "Change" sends the same update with a new value; the earlier answer stays
   in the history. The web app already offers Undo after an undoable write
   (`ProjectPage.tsx:202`), which reverts the revision (`store.ts:427–451`).
6. **Agents catch up.** Their next `changes_since` lists "human:me updated question …", and
   `project_snapshot` shows the answer. Answering never starts the answering agent, which reacts
   only to new requests (`agent-runner.ts:208–216`). If you want an agent to act on an answer,
   "Ask about this" creates an ordinary request with `aboutId` set to the question
   (`requests.tsx:46–63`), whose label the agent sees (`service.ts:325–331`).

### 10 Saved copies of real work

The reader's-paths design found that showing the work needs captured snapshots, because a view
can only query its own project's live data (cases §5, the Exhibit row). The code confirms it: the
dataset is one project's (`store.ts:331–347`), references can't cross projects
(`store.ts:796–800`), and an artifact holds a link, not content (`entities.ts:118`). The excerpt
type covers each kind the cases use:

| Kind of work (cases)                                                | Format                                         |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| Another project's records (the workshop jobs and their answer key)  | `table`                                        |
| Command or check output (the release check log)                     | `table` or `text`                              |
| A quote from code or a page (the table settings dialog's text)      | `text`                                         |
| Before and after (the README fix; the answer key before the review) | `compare`                                      |
| A recipe and what it draws (case B's "Answer as a view")            | `view`, with the captured data and its "today" |
| A re-enactment (the lost-change timeline)                           | `table`, with `illustration: true`             |

What makes them honest: `capturedAt` and `source` are required, so every copy can say "Captured
10 Oct from …"; a copy never changes when its source does, and re-capturing is an update with a
new date, the old copy staying in the history; `illustration` marks anything written rather than
copied, and the view must label it. A `view` copy's recipe is checked as a view spec on save
(`packages/schema/src/views/board.ts:58–61`); the renderer reads data from a provider that can be
given any dataset with read-only actions (`context.tsx:42–56`), so a building block should be able
to draw a captured recipe without touching live data. Simulated changes ("Pretend the materials
arrived") belong to the building block, not the data.

### 11 Plain labels, never task codes

Most G1 task titles in the Pharos project start with a code, and the map project types categories
into artifact titles (§1). Rewriting them would break the owner's working convention, and workers
need the codes to match evidence files and commits, so a title serves two readers. The proposal:

- **`plainTitle`** on task, artifact and decision, written for the reader. Reader-facing building
  blocks show it when present; the web helper behind entity chips and drawer titles,
  `labelOf` (`apps/web/src/catalog/interactive.tsx:42–45`), prefers it; the detail drawer shows
  both ("Original title", as cases B51 does). History and agent output keep `title`
  (`store.ts:108–111`).
- **The new types are reader-facing by definition**: `statement`, question `text` and choice
  labels, excerpt `title`, term `word`. Codes and working names go in `tags`, which are never
  shown.
- **Scope items** get no new field: their reader is the owner, so an agent rewrites their title
  and rationale in plain words (cases B32).
- **A check**: the preview warning on code-like text in reader-facing fields (§8).

### 12 Walk-throughs

#### Case A: "What did the models do in G1, and is it good?" (the Pharos project)

The fact table in cases §2.9 (37 facts, each with a source) is what an agent would now store as
claims instead of checking by hand.

| Element (cases §2)                | Records                                                                                                                                                                                                             | How the view reads them                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A1 headline                       | Claim ● "The models built a test … no results yet", resting on four claims (answering step not done; runner tried only with a stand-in; checker not built; work left before results)                                | By id; badge from `shownCertainty`, the weakest of the four                                |
| A2 picture, A40 what's left       | G1 tasks with `plainTitle` ("Freeze the set of tests", "You approve the test rules"); statuses live                                                                                                                 | Tasks by stage; labels from `plainTitle`                                                   |
| A3 needs you                      | Existing tasks, unchanged                                                                                                                                                                                           | As today                                                                                   |
| A4, A52 agent's reading           | Claims ◐ with `authorId` = the Opus 5.5 assignee, tag `verdict`; the conflict-of-interest note in `detail`                                                                                                          | `{tags: "verdict"}`                                                                        |
| A10–A12 one test, its answer key  | Excerpt `table`: the seven jobs with phase, status, due, waits on, tag, reason; source = the practice project file at a commit                                                                                      | By id; tag and reason stay hidden until "Show the answer key"                              |
| A13 three test situations         | The three case documents as artifacts with `plainTitle` and a one-line description (bylines in the description)                                                                                                     | Artifacts by id (artifacts have no tags)                                                   |
| A14 how sure the key is           | Claim ●; excerpt `compare` (first-draft key, after review)                                                                                                                                                          | Claim by id, its evidence                                                                  |
| A20–A25 five problems             | Claims tagged `problem`: ● for the example and the dialog (real output, a quoted text), ◐ for the three read in code (`illustration` excerpts); the fixing tasks rest on them                                       | `{tags: "problem"}`; "What happens next" = `{type: "task", where: {restsOnIds: id}}`, live |
| A30–A33 release check             | Claims ●; excerpt `table` (the check log); excerpt `compare` (README before and after)                                                                                                                              | By tag `release`                                                                           |
| A41 what it would ask of you      | Excerpt `compare` (a question as written; the plain rewrite labelled "Rewritten for this view"); claims ● for the word counts                                                                                       | By id                                                                                      |
| A42 earlier trial                 | Claim ● with source = the earlier evaluation's artifact                                                                                                                                                             | By id                                                                                      |
| A15, A26, A34, A43, A51 questions | Reader questions tagged `verdict`. Follow-ups: "Which ones?" (`multiple`, the five problems as choices, condition A26 = `some`); "What should change?" (`multiple`, `allowText`, condition A51 = `good_but_change`) | `{tags: "verdict", applies: "yes"}`: a follow-up appears once its condition holds          |
| A50 your answers so far           | The same questions                                                                                                                                                                                                  | Columns text, answer, `answeredAt`                                                         |
| Terms                             | The case's terms from cases §1.4 (G1, practice project, answer key, …)                                                                                                                                              | Lookup by word                                                                             |

In case A the answers mostly collect the owner's verdict for the agents to read; the narrowing is
the two follow-ups. Case B and the pattern show more.

#### Case B: "What is Generative UI, and where does Pharos sit?" (the map project)

| Element (cases §3)                       | Records                                                                                                                                                                                                                                                                                                                                       | How the view reads them                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Approaches                               | The existing source artifacts, with `plainTitle` "A2UI", "Tambo", … (categories leave the titles); one artifact for Pharos itself                                                                                                                                                                                                             | —                                                                                                                                     |
| B2 band, B21 map                         | Two open questions used as axes: "How much of the view does the AI make?" (choices `writes_text`, `one_block`, `arranges`, `writes_code`, `connector`) and "When does it make it?" (`in_use`, `in_build`). Per approach, a claim ◐ for each axis (`aboutIds` = the approach, `questionId`, `value`) and a description claim ● with its source | Claims with `questionId` in the two axes, grouped by `aboutIds`; the choices give the columns, rows and their labels                  |
| B1 headline, B3 certainty line           | Claim ● resting on the definition and Pharos's description; the map's ◐ is the axis claims' `shownCertainty`                                                                                                                                                                                                                                  | By id                                                                                                                                 |
| B11 see it happen                        | Excerpt `view`: the practice project's recipe and data, `today` 7 Oct; source = the fixture file                                                                                                                                                                                                                                              | By id                                                                                                                                 |
| B12 which would you rather get?          | Reader question (a preference agents read in the snapshot)                                                                                                                                                                                                                                                                                    | By id                                                                                                                                 |
| B31 Pharos's spot, B33 nearest relatives | Claims tagged `spot` (●, ●, ●, ◐) and `nearest` (◐, about json-render and A2UI)                                                                                                                                                                                                                                                               | `{tags: "spot"}`, `{tags: "nearest"}`                                                                                                 |
| B32 ruled out                            | Existing scope items, rewritten in plain words                                                                                                                                                                                                                                                                                                | As today                                                                                                                              |
| B41 eight capability cards               | An axis question "How well does Pharos do this?" (`works`, `works_with_limits`, `partly`, `gap`, `measured_once`); eight claims answering it, example in `detail`                                                                                                                                                                             | `{questionId: …}`, grouped by `value`                                                                                                 |
| B42 which gap matters most?              | Reader question; each of the four cards it names has a condition on it with its own choice                                                                                                                                                                                                                                                    | A widget above the cards: `{questionId: …, conditions: {exists: true}, applies: "yes"}`, the card you picked, with your answer's date |
| B50 not known yet                        | Three open questions (`askedOf: "others"`) with `whoCanAnswer`                                                                                                                                                                                                                                                                                | `{askedOf: "others", status: "open"}`                                                                                                 |
| B51, B52 proposals                       | The two existing proposed decisions with `plainTitle` (the original title stays in `title`) and `restsOnIds` → a ◐ claim ("Your reframe decision … covers the first half")                                                                                                                                                                    | Decision by id; Accept/Reject sets its status, `decisionDate` (and `decidedById` when known)                                          |
| Glossary                                 | Terms: Generative UI, building block, live project data, recipe, …                                                                                                                                                                                                                                                                            | `{type: "term"}`                                                                                                                      |

What narrows: B42 brings the card you picked to the top of the part; B51 and B52 change a
decision in place; B12 is kept for agents. Unanswered, every gap claim `applies: "open"`, so
nothing is hidden.

#### The decision pattern (case C held; the invented example from cases §4.8)

Records: three reader questions — "Bought online or in a shop?" (`online`, `shop`), "Has it been
opened?" (`yes`, `no`), "How many days since it arrived?" (`within_30`, `over_30`); claim f1 ●
"Online, unopened, within 30 days: full refund" (source: the shop's returns page; conditions:
online, not opened, within 30); claim f2 ◐ "Opened items: a refund minus a fee" (condition:
opened); an open question "Do sale items count?" (`askedOf: "others"`, `whoCanAnswer`: "the
shop"); tasks "Send it back" resting on f1 and "Ask the shop about the fee" resting on f2.

| Your answers                    | f1 applies | f2 applies | The first screen says                                                               |
| ------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------- |
| None yet                        | open       | open       | "Your answer depends on 3 things; 3 are still open." Next: the first question       |
| Online                          | open       | open       | "…; 2 are still open." Next: "Has it been opened?"                                  |
| Online, opened                  | no         | yes        | "A refund minus a fee." ◐; "Ask the shop about the fee" shows "Check before acting" |
| Online, not opened, within 30   | yes        | no         | "Full refund." ●; "Send it back" can be acted on                                    |
| Online, "Not sure" about opened | open       | open       | Both branches stay, dashed; "If you're not sure" says how to find out               |

- The branch picture is the questions (forks, via `conditions`) and the claims (ends, via
  `applies` and `shownCertainty`). A link resting on ◐ or ○ is dashed (cases §4.5, rule 3).
- "Check before acting" is a task whose `shownCertainty` is `reading`; how the building block
  blocks ticking it off, and how the reader accepts the risk on purpose, is component work.
- "What if I answered differently?" runs the same queries with `QueryContext.answers` (§7).
- "Your decision" (C5) is a decision resting on the claims used. It shows "Re-check" when one of
  them changed after `decisionDate` (`updatedAt` is kept for every record, `store.ts:718–720`), or
  when its `applies` turns `no` because an answer changed.
- "Sources that disagree" (C6) uses `contradictsIds` and `preferred`.

### 13 Alternatives considered

| Alternative                                                                                                                                         | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stretch existing types**: findings and copies as artifacts, view questions as requests                                                            | An artifact's status (expected, in progress, delivered; `options.ts:13`) and gallery (`catalog.ts:198–202`) don't fit a finding, and every artifact would carry a certainty. A request created by an agent would start the answering agent when automatic answering is on (`agent-runner.ts:208–216`), be listed to agents as a person's question to answer (`snapshot.ts:159–169`, `guidance.ts:262–271`) and appear in the requests list (`requests.tsx:155`); each consumer would need a direction filter, and the fields differ. Kept where honest: artifacts as sources, decisions for deciding, requests for "Ask about this". |
| **One open-ended record** (a "note" with free fields), or custom fields per project (`docs/SCOPE.md:122`)                                           | The store checks references and option values only for declared fields (`store.ts:787–835`), so certainty couldn't be required, conditions couldn't be checked, and building blocks and agents couldn't rely on any shape.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Keep answers out of project data**: browser storage (as the sketches do, cases §1.6), the settings table (`store.ts:357–371`), or the view's spec | Agents couldn't read them; there would be no history (settings are not revisions, `CLAUDE.md:70`); answers wouldn't carry across views or devices; an agent editing the view could overwrite them.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **The reader's answer as a claim** (◆) rather than a field on the question                                                                          | Neat (one place for every answer), but the web app would create a record on the first answer and update it later, and two open tabs could create two. One update on the question is simpler and can be repeated safely.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Findings as marked-up prose** in the documents                                                                                                    | Views would show frozen text again (the goal, principle 5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

The choice: add a type only where reuse would distort it (claim, question, excerpt, term), reuse
artifacts, decisions and requests as they are, and lean on what the store already guarantees
(revisions, references, options, the generic building blocks).

### 14 Left out on purpose

- **Several readers with their own answers**; one answer per question (multi-user is out of
  scope, `docs/SCOPE.md:113`).
- **Knowledge shared across projects.** References stay inside a project (`store.ts:796–800`);
  a fact needed in two projects is stored in both, or copied as an excerpt with its source.
  Pharos's own words ("view", "building block") could later ship as built-in terms that a project
  overrides, the way default options do (`options.ts:163–170`).
- **Live views of other projects inside a view**; excerpts are frozen copies by design.
- **Answers starting an agent run**; "Ask about this" stays the way to call an agent.
- **Richer conditions**: only "the answer is one of these"; no numbers, no "or" across questions
  (two claims do that).
- **Probabilities or percentages** for certainty, and automatic re-checking; agents re-check, and
  `recheckBy` shows when it is due.
- **Images and files in excerpts**: text, tables, before-and-after and recipes only.
- **Reader preferences across all projects** (B12 applies everywhere); project-scoped for now.
- **"Who decided" from the web app.** The web app doesn't know which assignee is the reader
  (decisions are created without `decidedById`,
  `apps/web/src/catalog/components/outputs.tsx:115`); the revision author records it.
- **The building blocks** (question card, exhibit, map, flow, reading path), and **converting
  existing data**: agents restructure it with `apply` when asked; no SQL migration is needed.

### 15 Size and steps

| Area                                                                    | Files                                                   | Rough lines (code + tests) |
| ----------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------- |
| Four types, the option field, plain titles                              | `entities.ts`, `options.ts`                             | 160 + 60                   |
| New types in queries; `applies`, `shownCertainty`, hypothetical answers | `query.ts`, `run-query.ts`                              | 110 + 150                  |
| `key`, `restrict`, `acyclic`; the checks of §6                          | `store.ts`                                              | 110 + 180                  |
| Snapshot, instructions, guidance, preview warnings                      | `snapshot.ts`, `mcp.ts`, `guidance.ts`, `preview.ts`    | 120 + 60                   |
| Web: dataset, type labels, plain titles                                 | `context.tsx`, `catalog/options.tsx`, `interactive.tsx` | 20 + 20                    |
| **Total**                                                               | about a dozen files                                     | **about 520 + 470**        |

No database migration: new types are rows in the existing table, and fields added to existing
types are optional. In small steps, each one shown to the owner:

1. **Show what is known** (medium): claims, certainty, excerpts, plain titles, `restsOnIds`,
   `shownCertainty`, `restrict` and `acyclic`. Enough for case A's first screen from data.
2. **Ask and narrow** (medium): questions, conditions (`key`), `applies`, the answer checks,
   snapshot and instructions.
3. **Explain words** (small): terms.

When the held case is shared: contradicting claims, hypothetical answers, and the action gate.

### 16 Open points

**For the owner** (the "Needs you" line at the top):

1. Are the three labels right: _Confirmed by you_, _Verified_, _Agent's reading_, with _Not known
   yet_ for open questions?
2. Should only you be able to answer your questions? If yes, an agent can't record an answer you
   gave in chat; it asks you to click it, or records a claim "Confirmed by you" that says when you
   said it.
3. Build in the three steps of §15, with a look after each?

**For the reviewers:**

- `restrict` makes some deletes fail until dependants are updated. Is that acceptable for agents,
  given the same already holds for option values in use (`store.ts:836–851`)?
- `applies` on a question counts its own branch (§7). Is hiding a stale answer further down a
  branch the right default, or should it be shown as "from an earlier path"?
- Excerpts are reloaded with the whole dataset after every change; is a size cap enough, or should
  `content` be fetched on demand (`app.ts:170–173` already serves one entity)?

### How this was checked

Read at commit 458ad52: `entities.ts`, `options.ts`, `revisions.ts`, the `views/` folder of the
schema package (query, run-query, catalog, board), the server's store (`store.ts`, `database.ts`,
`snapshot.ts`), `mcp.ts`, `app.ts`, `agent-runner.ts`, `feed.ts`, `guidance.ts`,
`views/service.ts`, `views/changes.ts`, `views/preview.ts`, and in the web app `context.tsx`,
`generic.tsx`, `drawer.tsx`, `interactive.tsx`, `catalog/options.tsx`, `requests.tsx`,
`ProjectPage.tsx`, `lib/api.ts`. Counts about the map project (32 artifacts, 20 of them with a
category in the title; two proposed decisions) come from the exported snapshot used for the cases.
The live Pharos instance was not used. Nothing was built or run.
