# R8 notes: records, car and money

2026-10-13 · Opus 5.5 · v0.2 track A, batch 1 (A1 + A2) · R8.0 breakdown, R8.5 policy and R8.14
block choice, built as one piece of work. The two policies below are **proposed**: the owner
accepts them in R8's single owner check. The independent checks (R8.11, R8.16) go to the batched
review at the end of v0.2.

## Breakdown (R8.0)

Stage pattern: one contract item first (it touches the shared schema files), then builders with
clear file ownership, one independent check, one fix round, one owner check on one real page.
The 16 tasks already in R8 keep their numbers; the new ones continue at R8.17.

| Task  | What                                                                                                               | Depends on       | Files                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------- |
| R8.17 | Contract: `record` entity, `project.data.recordTypes`, field kinds, money, interval, `fields.x` paths, sums        | —                | `entities.ts`, `records.ts`, `query.ts`, `run-query.ts`               |
| R8.18 | Store: records checked against their type at write time; references in fields unset on delete; packs in one apply  | R8.17            | `store.ts`                                                            |
| R8.19 | Packs as data: Car and Money, applied in one apply, undone by revert (REST, MCP, New project dialog)               | R8.17, R8.18     | `packs/`, `app.ts`, `mcp.ts`, `NewProjectDialog.tsx`                  |
| R8.6  | Field metadata from ENTITIES and record types                                                                      | R8.17            | `views/fields.ts`                                                     |
| R8.5  | Policy: reject or warn (below)                                                                                     | R8.6             | this file                                                             |
| R8.7  | Validator for every query-bearing prop                                                                             | R8.5, R8.6       | `views/check-queries.ts`                                              |
| R8.8  | Checks on every view write path (one code path: `Store.apply` and the preview)                                     | R8.7             | `store.ts`, `preview.ts`                                              |
| R8.9  | Suggestions, allowed fields and a corrected example; one guidance paragraph                                        | R8.7             | `check-queries.ts`, `guidance.ts`, `mcp.ts`                           |
| R8.13 | Gap record from the pack cases (below)                                                                             | R8.2             | this file                                                             |
| R8.14 | Smallest change per gap (below)                                                                                    | R8.13            | this file                                                             |
| R8.15 | Blocks: DueTracker, CategoryBreakdown, DataTable totals, sums on Stat, CountChart and Text                         | R8.14            | `catalog.ts`, `catalog-info.ts`, `views/blocks.ts`, web `components/` |
| R8.2  | Versioned pack cases (car, money) with a schema and a version lock                                                 | R8.19            | `packs/cases/`                                                        |
| R8.3  | Fact checker over the page's own block values                                                                      | R8.2, R8.15      | `packs/fact-check.ts`                                                 |
| R8.10 | Query-check regression cases in the pack cases                                                                     | R8.2, R8.7       | `packs/cases/`                                                        |
| R8.11 | Adversarial review of the query checks (GPT-6.1-Sol)                                                               | R8.8, R8.9       | batched review                                                        |
| R8.16 | Independent check of the new blocks (GPT-6.1-Sol)                                                                  | R8.15, R8.3      | batched review                                                        |
| R8.20 | Owner check of one real page (Car or Money), including the R8.5 policy (W4.8) and the R8.14 block decision (W12.5) | everything above | —                                                                     |

R8.1, R8.4 and R8.12 stay sign-off items over their sub-tasks. There is exactly one owner check,
R8.20, at the end.

## Records (R8.17, R8.18)

- A **record** (`type: "record"`) has `recordType` (a key from the project's record types), a
  `title`, `fields` (values by field key), an optional `interval`, `notes` and `fileIds`.
- **Record types** live in `project.data.recordTypes` next to `options`: `{key, name, plural?,
fields: [{key, label, kind, …}], interval?}`.
- **Field kinds**: `text`, `number` (optional `unit`), `money` (`{amount, currency}`, amount in
  minor units such as cents, ISO currency; never converted), `date` (YYYY-MM-DD), `option`
  (`options` on the field), `reference` (`to`: a record type key; the value is a record id),
  `file` (a project file id), `meter` (a number with a `unit`, e.g. km).
- The store checks every written record against its type: known field, right kind, option value
  in the list, reference to a record of the right type in the same project, file in the same
  project, required fields present, `interval` only where the type allows it. Changing a
  project's record types re-checks its records, so a type in use can't be removed. Deleting a
  record or a file unsets fields that point at it.
- **Interval** (built in): `every` (n days, weeks, months or years) and/or `meter` (every n units,
  read from `from`, e.g. `fields.vehicle.fields.odometer`), whichever comes first; `rolling` (from
  when it was last done) or `fixed` (on a schedule from `startDate` / `startMeter`). Four bands:
  not urgent, urgent (30 days or 1,000 units), very urgent (7 days or 250 units), past due.
  Records with an interval have read-only paths `due.date`, `due.meter`, `due.band`, `due.days`.
- **Queries**: `type: "record"`, with paths `recordType`, `title`, `fields.<key>`, one hop through a
  reference or file field (`fields.vehicle.title`), `fields.<money>.amount` and `.currency`, and
  `due.*`. Dates gain `$monthStart` and `$yearStart`, and offsets in months and years
  (`$monthStart+1m`, `$today-1y`).
- **Sums**: a sum over a number or meter field is a number; over a money field it is one total per
  currency, shown apart.

## Packs (R8.19)

A pack is data (`packages/schema/src/packs/`): record types, option lists, a project summary, the
hand-made pages (boards), a short agent guide and made-up examples. Applying it is one `apply`
(one revision), so History's revert undoes it; a pack project skips the default project-management
Overview because the pack brings its own page. REST `GET /api/packs` and `POST /api/packs/apply`,
MCP `pack_list` and `pack_apply`, and a "Start from" choice in the New project dialog.

- **Car**: Vehicle (odometer meter), Service (date, odometer, cost, kind), Fuel (date, odometer,
  litres, cost), Reminder (interval). Page "What's due": a DueTracker with the four bands, the
  service log, cost per year, and the registration and insurance papers.
- **Money**: Category (planned per month), Spending (date, amount, category), Bill (interval,
  amount), Goal (target, saved). Page "This month": planned vs spent by category, upcoming bills,
  savings progress, recent spending with totals per currency, and statements.

## Query-check policy (R8.5, proposed)

Every view write (view_create, view_update, view_answer, REST `/api/apply`, pack apply) runs the
same checker as view_preview. A write is refused when it **adds** a reject-level finding; findings
an older saved view already had don't block an unrelated edit such as a resize. Warnings come back
with the successful result.

| Finding                                          | Code                  | Level  | Why                                                                    |
| ------------------------------------------------ | --------------------- | ------ | ---------------------------------------------------------------------- |
| Unknown field or record field                    | `unknown-field`       | reject | It silently matches nothing: the page would show a wrong zero.         |
| Unknown reference hop                            | `unknown-hop`         | reject | Same: the hop never resolves.                                          |
| Unknown record type                              | `unknown-record-type` | reject | Same; usually a typo of a pack's type.                                 |
| Invalid sort field                               | `unknown-sort-field`  | reject | The order would be arbitrary while looking deliberate.                 |
| Invalid group field                              | `unknown-group-field` | reject | Every row lands in "None".                                             |
| Invalid sum field                                | `unknown-sum-field`   | reject | The total would be 0.                                                  |
| Sum over something that isn't a number           | `sum-not-number`      | reject | Text, dates and options can't be added up.                             |
| Unknown column (DataTable, DataList, DueTracker) | `unknown-column`      | reject | An empty column on every row.                                          |
| Operator or value doesn't fit the field          | `operator-mismatch`   | reject | e.g. `contains` on a number, a range on a money field (use `.amount`). |
| Unknown option value                             | `unknown-option`      | reject | Matches nothing; the allowed values are listed.                        |
| Relative date that can't be read                 | `bad-relative-date`   | reject | e.g. `$today+7x`, `$tomorrow`: compared as text, it's wrong.           |
| Record query without a record type               | `no-record-type`      | warn   | Mixes every kind of record; sometimes meant (a log of everything).     |
| Field only some of the queried record types have | `mixed-record-types`  | warn   | Rows of the other types show "—".                                      |
| Group by a value that is unique per row          | `group-by-unique`     | warn   | One bar per row; rarely meant.                                         |
| Sort or group by a list field                    | `sort-by-list`        | warn   | Lists have no natural order.                                           |

**Allowed, never a finding:** an intentional empty result (`{"where": {"status": "blocked"}}` on a
project with nothing blocked shows an empty state and is fine); a project's custom option value
(`"status": "in_review"` when the project defines it) and an option's meaning (`"in_progress"`);
mixed currencies (`sum: "fields.amount"` over EUR and USD spending gives two totals, shown apart);
special values (`$today`, `$currentStage`, `$project`); `exists` on any field.

**Error format:** each finding has a JSON path into the widgets (e.g.
`widgets[1].node.query.where["fields.odomter"]`), a message, the allowed values, a closest-match
suggestion and, where one applies, a corrected example. Refusals list them as
`path: message (did you mean "fields.odometer"?) Allowed: … Example: …`.

## Gaps and blocks (R8.13, R8.14, proposed)

Gaps found by writing the pack cases against the catalog of 2026-10-13, worst first:

| #   | Gap                                                                     | Class                     | Choice                                                                                             |
| --- | ----------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Nothing can say what's due by date or by meter, in four bands           | computation, presentation | **New block DueTracker** (the interval needs a calculation no chart can do)                        |
| 2   | Planned vs spent per category: no block joins two record types and sums | computation, presentation | **New block CategoryBreakdown**                                                                    |
| 3   | Queries only count; no totals of money, litres, kilometres              | query                     | **Query change:** sums (`sum` on Stat, CountChart, Text `{sum}`), per currency                     |
| 4   | A ledger: amounts in a table with a total row                           | presentation              | **Mode on DataTable:** `total: true` (the plan's "Ledger"); money is formatted from field metadata |
| 5   | Savings progress: an amount against a target                            | presentation              | **Mode on Stat:** `target` (sum of the target field; bar and "of")                                 |
| 6   | Cost per year, spending per month                                       | query                     | **Mode on CountChart:** `bucket` (month or year) with `sum`                                        |
| 7   | "This month" filters                                                    | query                     | **Query change:** `$monthStart`, `$yearStart`, month and year offsets                              |
| 8   | A service log                                                           | —                         | **No change:** DataTable sorted by date, newest first                                              |
| 9   | Registration and insurance papers                                       | —                         | **No change:** FileList filtered by tag                                                            |

Presentation gaps (4, 5, 8) are separate from the missing calculations (1, 2, 3, 6, 7) that no
chart could fix. Bank import, currency conversion and in-place actions ("Log a service", R10) stay
out.

## Pack cases and fact checks (R8.2, R8.3, R8.10)

Cases live in `packages/schema/src/packs/cases/` (made-up data only). Each case has an id, a
version, tags, a fixed `today`, a fixture (records) and expected facts; `versions.json` locks each
case's content hash, so changing a case without bumping its version fails the test. The fact
checker computes what each block of the pack page shows with the same functions the web app
renders from (`views/blocks.ts`) and compares it with every expected fact; prose with numbers that
aren't bound to data is reported as unverifiable, never passed. Query-check cases assert that the
store refuses or accepts each spec.
